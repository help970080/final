const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ruta persistente para el archivo de base de datos
const DB_FILE = '/opt/render/project/src/data/database.json'; 

let dbCache = null;
let lastDbUpdate = 0;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY; 

// Definición de los niveles de bono y cuotas
const BONO_TIERS = [
    { target: 10000, base_salary: 2000, percentage: 0.15 },
    { target: 15000, base_salary: 3000, percentage: 0.16 },
    { target: 20000, base_salary: 4000, percentage: 0.17 },
    { target: 25000, base_salary: 5000, percentage: 0.18 },
    { target: 30000, base_salary: 6000, percentage: 0.19 },
];
const PERIOD_DAYS = 15; // Días del período para el objetivo (15 días)

function readDB() {
    const now = Date.now();
    const stats = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE) : null;
    
    if (!dbCache || (stats && stats.mtimeMs > lastDbUpdate)) {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = {
                usuarios: [
                    { id: 0, nombre: "admin", password: "admin123" },
                    { id: 1, nombre: "juan", password: "123" },
                    { id: 2, nombre: "ana", password: "123" },
                    { id: 3, nombre: "leo", password: "123" }
                ],
                clientes: [],
                llamadas: []
            };
            initialData.usuarios = initialData.usuarios.map(u => ({
                ...u,
                lat: null, 
                lng: null,
                ultima_actualizacion_ubicacion: null
            }));

            const dir = path.dirname(DB_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
            dbCache = initialData;
        } else {
            try {
                dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
                dbCache.usuarios = dbCache.usuarios.map(u => ({
                    ...u,
                    lat: u.lat !== undefined ? u.lat : null,
                    lng: u.lng !== undefined ? u.lng : null,
                    ultima_actualizacion_ubicacion: u.ultima_actualizacion_ubicacion !== undefined ? u.ultima_actualizacion_ubicacion : null
                }));
            } catch (err) {
                console.error("Error al leer database.json:", err);
                dbCache = { usuarios: [{ id: 0, nombre: "admin", password: "admin123" }], clientes: [], llamadas: [] };
            }
        }
        lastDbUpdate = now;
    }
    return dbCache;
}

function writeDB(data) {
    try {
        const dir = path.dirname(DB_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
        dbCache = data; 
        lastDbUpdate = Date.now(); 
    } catch (err) {
        console.error("Error al escribir en database.json:", err);
    }
}

// Endpoints
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/login', (req, res) => {
    const { usuario, password } = req.body;
    const db = readDB();
    const user = db.usuarios.find(u => u.nombre === usuario && u.password === password);
    if (user) {
        res.json({ 
            status: "ok", 
            usuario: user.nombre, 
            id: user.id,
            esAdmin: user.id === 0 
        });
    } else {
        res.status(401).json({ status: "error", mensaje: "Usuario o contraseña incorrectos" });
    }
});

app.get('/clientes', (req, res) => {
    const db = readDB();
    res.json(db.clientes || []);
});

app.get('/clientes/:usuarioId', (req, res) => {
    const db = readDB();
    const userId = parseInt(req.params.usuarioId);
    const clientesAsignados = db.clientes.filter(c => c.asignado_a !== null && parseInt(c.asignado_a) === userId);
    res.json(clientesAsignados);
});

app.post('/cargar-clientes', async (req, res) => {
    try {
        const nuevosClientes = Array.isArray(req.body.clientes) ? req.body.clientes : [];
        const db = readDB();
        const maxId = db.clientes.reduce((max, c) => Math.max(max, c.id || 0), 0);
        let nextId = maxId + 1;
        const loteClientes = [];
        let clientesConCoordenadas = 0;
        
        for (const cliente of nuevosClientes) {
            let lat = null;
            let lng = null;
            if (cliente.direccion && GOOGLE_MAPS_API_KEY) { 
                try {
                    let direccionCompleta = `${cliente.direccion}, CDMX, México`.replace(/,\s+/g, ', ').replace(/\s+/g, '+');
                    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
                        params: { address: direccionCompleta, key: GOOGLE_MAPS_API_KEY, region: 'mx' }
                    });
                    if (response.data.status === "OK") {
                        const location = response.data.results[0].geometry.location;
                        lat = location.lat;
                        lng = location.lng;
                        clientesConCoordenadas++;
                    } else {
                        console.warn(`Geocodificación para cliente ${cliente.nombre} falló: ${response.data.status}`);
                    }
                } catch (error) {
                    console.error("Error en geocodificación para cliente:", cliente.nombre, error.message);
                }
            }
            loteClientes.push({ ...cliente, id: nextId++, asignado_a: cliente.asignado_a || null, lat, lng });
        }
        db.clientes = [...db.clientes, ...loteClientes];
        writeDB(db);
        res.json({ 
            status: "ok", 
            mensaje: `${loteClientes.length} clientes cargados exitosamente`,
            totalClientes: db.clientes.length,
            clientesConCoordenadas
        });
    } catch (error) {
        console.error("Error en /cargar-clientes:", error);
        res.status(500).json({ status: "error", mensaje: "Error al procesar la carga de clientes" });
    }
});

app.post('/actualizar-coordenadas', async (req, res) => {
    try {
        const { clienteId, direccion } = req.body;
        const db = readDB();
        if (!direccion || direccion.trim().length < 5) {
            return res.status(400).json({ 
                status: "error", 
                mensaje: "La dirección proporcionada es demasiado corta o inválida. Debe tener al menos 5 caracteres." 
            });
        }
        if (!GOOGLE_MAPS_API_KEY) {
            return res.status(500).json({ status: "error", mensaje: "API Key de Google Maps no configurada en el servidor." });
        }

        let direccionCompleta = direccion.trim().replace(/\s+/g, ' ').replace(/,+/g, ',').replace(/(^,|,$)/g, '').replace(/\b(colonia|col|cdmx|mexico)\b/gi, '').trim();
        if (!direccionCompleta.toLowerCase().includes('méxico') && !direccionCompleta.toLowerCase().includes('cdmx') && !direccionCompleta.toLowerCase().includes('ciudad de méxico')) {
            direccionCompleta += ', CDMX, México';
        }
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address: direccionCompleta.replace(/\s+/g, '+'),
                key: GOOGLE_MAPS_API_KEY, 
                region: 'mx',
                components: 'country:MX',
                bounds: '19.0,-99.5|19.6,-98.9'
            }
        });
        if (response.data.status === "OK") {
            const location = response.data.results[0].geometry.location;
            const clienteIndex = db.clientes.findIndex(c => c.id === clienteId);
            if (clienteIndex !== -1) {
                db.clientes[clienteIndex].lat = location.lat;
                db.clientes[clienteIndex].lng = location.lng;
                writeDB(db);
                return res.json({ 
                    status: "ok",
                    lat: location.lat,
                    lng: location.lng,
                    direccion_formateada: response.data.results[0].formatted_address,
                    direccion_original: direccion
                });
            }
            return res.status(404).json({ status: "error", mensaje: "Cliente no encontrado en la base de datos" });
        }
        let mensajeError = "No se pudo geocodificar la dirección";
        let sugerencia = "Verifica que la dirección esté completa (calle, número, colonia)";
        switch(response.data.status) {
            case "ZERO_RESULTS":
                mensajeError = "La dirección no fue encontrada por Google Maps";
                sugerencia = "Intenta con una dirección más específica o verifica que sea correcta. Incluye número y colonia si es posible.";
                break;
            case "OVER_QUERY_LIMIT":
                mensajeError = "Se ha excedido el límite de consultas a la API de Google Maps";
                sugerencia = "Intenta nuevamente más tarde o revisa tu cuota de la API Key.";
                break;
            case "REQUEST_DENIED":
                mensajeError = "Acceso denegado a la API de Google Maps";
                sugerencia = "Verifica la configuración de tu API Key y asegúrate de que los servicios de Geocoding estén habilitados.";
                break;
        }
        res.status(400).json({
            status: "error",
            mensaje: mensajeError,
            detalle: response.data.status,
            direccion_solicitada: direccion,
            direccion_formateada: response.data.results?.[0]?.formatted_address,
            sugerencia: sugerencia
        });
    } catch (error) {
        console.error("Error en el proceso de geocodificación:", error);
        res.status(500).json({ 
            status: "error", 
            mensaje: "Error interno del servidor al intentar geocodificar.",
            error: process.env.NODE_ENV === 'development' ? error.message : null 
        });
    }
});

app.post('/limpiar-clientes', (req, res) => {
    const db = readDB();
    const count = db.clientes.length;
    db.clientes = [];
    writeDB(db);
    res.json({ status: "ok", mensaje: `${count} clientes han sido eliminados de la base de datos` });
});

app.post('/actualizar-clientes', (req, res) => {
    const actualizaciones = Array.isArray(req.body.clientes) ? req.body.clientes : [];
    const db = readDB();
    let actualizados = 0;
    db.clientes = db.clientes.map(cliente => {
        const actualizacion = actualizaciones.find(a => parseInt(a.id) === parseInt(cliente.id));
        if (actualizacion) {
            actualizados++;
            return {
                ...cliente,
                asignado_a: actualizacion.asignado_a !== undefined ? 
                    (actualizacion.asignado_a ? parseInt(actualizacion.asignado_a) : null) : 
                    cliente.asignado_a,
                lat: actualizacion.lat !== undefined ? actualizacion.lat : cliente.lat,
                lng: actualizacion.lng !== undefined ? actualizacion.lng : cliente.lng
            };
        }
        return cliente;
    });
    writeDB(db);
    res.json({ 
        status: "ok", 
        mensaje: `${actualizados} clientes actualizados correctamente`,
        total: db.clientes.length 
    });
});

app.get('/usuarios', (req, res) => {
    const db = readDB();
    res.json(db.usuarios.filter(u => u.id !== 0)); 
});

app.post('/usuarios', (req, res) => {
    const { nombre, password } = req.body;
    const db = readDB();
    if (!nombre || !password) {
        return res.status(400).json({ status: "error", mensaje: "El nombre y la contraseña son requeridos" });
    }
    if (db.usuarios.some(u => u.nombre.toLowerCase() === nombre.toLowerCase())) {
        return res.status(400).json({ status: "error", mensaje: "El nombre de usuario ya existe. Por favor, elige otro." });
    }
    const nuevoId = db.usuarios.length > 0 ? Math.max(...db.usuarios.map(u => u.id)) + 1 : 1;
    const nuevoUsuario = { 
        id: nuevoId, 
        nombre: nombre.trim(), 
        password: password.trim(),
        lat: null, 
        lng: null,
        ultima_actualizacion_ubicacion: null
    };
    db.usuarios.push(nuevoUsuario);
    writeDB(db);
    res.json({ status: "ok", usuario: { id: nuevoUsuario.id, nombre: nuevoUsuario.nombre } });
});

app.post('/usuarios/eliminar', (req, res) => {
    const { id } = req.body;
    const db = readDB();
    if (id === 0) { 
        return res.status(400).json({ status: "error", mensaje: "No se puede eliminar al usuario administrador." });
    }
    const usuarioIndex = db.usuarios.findIndex(u => u.id === parseInt(id));
    if (usuarioIndex === -1) {
        return res.status(404).json({ status: "error", mensaje: "Usuario no encontrado." });
    }
    db.clientes = db.clientes.map(c => {
        if (parseInt(c.asignado_a) === parseInt(id)) {
            return { ...c, asignado_a: null };
        }
        return c;
    });
    db.usuarios.splice(usuarioIndex, 1);
    writeDB(db);
    res.json({ status: "ok", mensaje: "Usuario eliminado correctamente. Los clientes asignados han sido desasignados." });
});

app.get('/reporte', (req, res) => {
    const db = readDB();
    const reporte = db.llamadas.map(l => {
        const cliente = db.clientes.find(c => c.id === l.cliente_id);
        const usuario = db.usuarios.find(u => u.id === l.usuario_id);
        return {
            usuario: usuario?.nombre || "Desconocido",
            cliente: cliente?.nombre || "Desconocido",
            resultado: l.resultado,
            fecha: l.fecha,
            observaciones: l.observaciones,
            monto_cobrado: l.monto_cobrado || 0,
            tarifa: cliente?.tarifa || "-",
            saldo_exigible: cliente?.saldo_exigible || "-",
            saldo: cliente?.saldo || "-"
        };
    });
    res.json(reporte);
});

app.post('/llamadas', (req, res) => {
    const nuevaLlamada = req.body;
    const db = readDB();
    
    const clienteIndex = db.clientes.findIndex(c => c.id === nuevaLlamada.cliente_id);
    if (clienteIndex === -1) {
        return res.status(404).json({ status: "error", mensaje: "Cliente no encontrado en la base de datos." });
    }
    
    const cliente = db.clientes[clienteIndex];
    if (cliente.asignado_a !== nuevaLlamada.usuario_id) {
        return res.status(403).json({ status: "error", mensaje: "Este cliente no está asignado a tu usuario. No puedes registrar la llamada." });
    }

    const hoy = new Date().toISOString().split("T")[0];
    if (db.llamadas.find(l => l.cliente_id === nuevaLlamada.cliente_id && l.fecha === hoy)) {
        return res.status(400).json({ status: "error", mensaje: "Este cliente ya fue procesado hoy. Solo se permite una llamada por día." });
    }

    const maxIdLlamada = db.llamadas.reduce((max, l) => Math.max(max, l.id || 0), 0);
    nuevaLlamada.id = maxIdLlamada + 1;
    nuevaLlamada.fecha = nuevaLlamada.fecha || new Date().toISOString().split("T")[0]; 
    db.llamadas.push(nuevaLlamada);
    db.clientes[clienteIndex].asignado_a = null; 
    writeDB(db);
    res.json({ status: "ok", mensaje: "Llamada registrada exitosamente.", id: nuevaLlamada.id });
});

// Nuevo endpoint para que los gestores envíen su ubicación
app.post('/actualizar-ubicacion-usuario', (req, res) => {
    const { userId, lat, lng } = req.body;
    const db = readDB();
    const usuarioIndex = db.usuarios.findIndex(u => u.id === parseInt(userId));

    if (usuarioIndex !== -1) {
        db.usuarios[usuarioIndex].lat = lat;
        db.usuarios[usuarioIndex].lng = lng;
        db.usuarios[usuarioIndex].ultima_actualizacion_ubicacion = new Date().toISOString();
        writeDB(db);
        res.json({ status: "ok", mensaje: "Ubicación actualizada." });
    } else {
        res.status(404).json({ status: "error", mensaje: "Usuario no encontrado." });
    }
});

// Nuevo endpoint para que el admin obtenga las ubicaciones de todos los gestores
app.get('/ubicaciones-gestores', (req, res) => {
    const db = readDB();
    // Excluir al admin y devolver solo los usuarios con ubicación
    const gestoresConUbicacion = db.usuarios
        .filter(u => u.id !== 0 && u.lat !== null && u.lng !== null)
        .map(u => ({
            id: u.id,
            nombre: u.nombre,
            lat: u.lat,
            lng: u.lng,
            ultima_actualizacion: u.ultima_actualizacion_ubicacion
        }));
    res.json(gestoresConUbicacion);
});

// Nuevo endpoint para obtener estadísticas (KPIs) generales y de gestores
app.get('/kpis', (req, res) => {
    const db = readDB();
    const clientes = db.clientes || [];
    const llamadas = db.llamadas || [];
    const usuarios = db.usuarios.filter(u => u.id !== 0) || []; // Solo gestores, excluye admin

    const clientesTotales = clientes.length;
    const clientesAsignados = clientes.filter(c => c.asignado_a !== null).length;
    const clientesPendientesAsignar = clientes.filter(c => c.asignado_a === null).length;

    const llamadasTotales = llamadas.length;
    const montoTotalCobrado = llamadas.reduce((sum, l) => sum + (parseFloat(l.monto_cobrado) || 0), 0);
    
    const llamadasExito = llamadas.filter(l => l.resultado === 'Éxito').length;
    const efectividadLlamadas = llamadasTotales > 0 ? (llamadasExito / llamadasTotales * 100).toFixed(2) : 0;

    const hoy = new Date().toISOString().split("T")[0];
    const clientesProcesadosHoy = llamadas.filter(l => l.fecha === hoy).length;

    // Calcular KPIs de Riesgo (Semaforo)
    let riesgoClientes = { verde: 0, amarillo: 0, rojo: 0, montoRiesgoAlto: 0 };
    clientes.forEach(cliente => {
        let puntajeRiesgo = 0;
        const llamadasCliente = llamadas.filter(l => l.cliente_id === cliente.id);

        llamadasCliente.forEach(llamada => {
            switch (llamada.resultado) {
                case 'Rechazado':
                    puntajeRiesgo += 30;
                    break;
                case 'No contestó':
                    puntajeRiesgo += 10;
                    break;
                case 'En proceso':
                    puntajeRiesgo += 5;
                    break;
                case 'Éxito':
                    puntajeRiesgo = Math.max(0, puntajeRiesgo - 10);
                    break;
            }
        });

        if (cliente.saldo_exigible > 500 && puntajeRiesgo > 10) {
            puntajeRiesgo += 5;
        }

        let clasificacionRiesgo = 'verde';
        if (puntajeRiesgo >= 40) {
            clasificacionRiesgo = 'rojo';
            riesgoClientes.montoRiesgoAlto += (parseFloat(cliente.saldo_exigible) || 0);
        } else if (puntajeRiesgo >= 15) {
            clasificacionRiesgo = 'amarillo';
        } else {
            clasificacionRiesgo = 'verde';
        }

        riesgoClientes[clasificacionRiesgo]++;
    });

    // Calcular KPIs de Rendimiento de Gestores y Bonos
    const rendimientoGestores = usuarios.map(gestor => {
        const llamadasGestor = llamadas.filter(l => l.usuario_id === gestor.id);
        const montoCobradoGestor = llamadasGestor.reduce((sum, l) => sum + (parseFloat(l.monto_cobrado) || 0), 0);
        const llamadasExitoGestor = llamadasGestor.filter(l => l.resultado === 'Éxito').length;
        const efectividadGestor = llamadasGestor.length > 0 ? (llamadasExitoGestor / llamadasGestor.length * 100).toFixed(2) : 0;
        const totalLlamadasGestor = llamadasGestor.length;

        // Calcular bono y porcentaje de cuota
        let salarioBaseGanado = 0;
        let porcentajeBonoGanado = 0;
        let cuotaActualNivel = 0;
        let proximoNivelTarget = null;
        let proximoNivelPorcentaje = null;

        let reachedTier = null;
        for (let i = BONO_TIERS.length - 1; i >= 0; i--) {
            if (montoCobradoGestor >= BONO_TIERS[i].target) {
                reachedTier = BONO_TIERS[i];
                break;
            }
        }

        if (reachedTier) {
            salarioBaseGanado = reachedTier.base_salary;
            porcentajeBonoGanado = montoCobradoGestor * reachedTier.percentage;
            cuotaActualNivel = reachedTier.target;
        }

        // Encontrar el próximo nivel para la tendencia
        for (const tier of BONO_TIERS) {
            if (montoCobradoGestor < tier.target) {
                proximoNivelTarget = tier.target;
                proximoNivelPorcentaje = ((montoCobradoGestor / tier.target) * 100).toFixed(2);
                break;
            }
        }
        if (proximoNivelTarget === null && montoCobradoGestor >= BONO_TIERS[BONO_TIERS.length - 1].target) {
            proximoNivelTarget = BONO_TIERS[BONO_TIERS.length - 1].target; // Ya alcanzó el nivel más alto
            proximoNivelPorcentaje = 100;
        } else if (proximoNivelTarget === null) { // Si no alcanzó el primer nivel
            proximoNivelTarget = BONO_TIERS[0].target;
            proximoNivelPorcentaje = ((montoCobradoGestor / BONO_TIERS[0].target) * 100).toFixed(2);
        }

        // Proyección a 15 días (tendencia)
        // ASUNCIÓN: Días transcurridos. Para una tendencia real, necesitaríamos el día actual del periodo de 15 días.
        // Aquí usaremos una aproximación: si tenemos registros de hoy, asumimos que hoy es un día activo.
        // Si no hay llamadas hoy, la proyección sería 0.
        const firstCallDate = llamadasGestor.length > 0 ? new Date(Math.min(...llamadasGestor.map(l => new Date(l.fecha)))) : null;
        const today = new Date();
        let daysTranscurred = 1; // Asumimos al menos 1 día para evitar división por cero
        if (firstCallDate) {
            daysTranscurred = Math.floor((today.getTime() - firstCallDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            daysTranscurred = Math.min(daysTranscurred, PERIOD_DAYS); // No exceder el periodo total
        }

        let projectedAmount = 0;
        if (daysTranscurred > 0) {
             projectedAmount = (montoCobradoGestor / daysTranscurred) * PERIOD_DAYS;
        }

        let trendStatus = 'neutral'; // verde, amarillo, rojo
        if (projectedAmount >= (proximoNivelTarget || BONO_TIERS[0].target) * 0.95) { // 95% del próximo objetivo
            trendStatus = 'verde';
        } else if (projectedAmount >= (proximoNivelTarget || BONO_TIERS[0].target) * 0.75) { // 75% del próximo objetivo
            trendStatus = 'amarillo';
        } else {
            trendStatus = 'rojo';
        }

        return {
            id: gestor.id,
            nombre: gestor.nombre,
            montoCobrado: montoCobradoGestor.toFixed(2),
            efectividad: efectividadGestor,
            totalLlamadas: totalLlamadasGestor,
            salarioBaseGanado: salarioBaseGanado.toFixed(2),
            porcentajeBonoGanado: porcentajeBonoGanado.toFixed(2),
            cuotaAlcanzada: cuotaActualNivel,
            proximoNivelTarget: proximoNivelTarget,
            proximoNivelPorcentaje: proximoNivelPorcentaje,
            projectedAmount: projectedAmount.toFixed(2),
            trendStatus: trendStatus // Nuevo campo para resaltar
        };
    });

    res.json({
        clientesTotales,
        clientesAsignados,
        clientesPendientesAsignar,
        llamadasTotales,
        montoTotalCobrado: montoTotalCobrado.toFixed(2),
        efectividadLlamadas,
        clientesProcesadosHoy,
        riesgoClientes,
        rendimientoGestores // Añadimos el rendimiento de los gestores
    });
});


app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en http://localhost:${PORT}`);
    console.log(`Google Maps API Key (server): ${GOOGLE_MAPS_API_KEY ? 'Cargada' : 'ERROR: No cargada'}`);
    const dataDir = path.dirname(DB_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📂 Directorio de datos creado en: ${dataDir}`);
    }
    console.log(`💾 Ruta de base de datos: ${DB_FILE}`);
    readDB();
});

module.exports = app;