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

// *** PUNTO CLAVE 1: Asegurarse de que Maps_API_KEY se lea correctamente del entorno ***
const Maps_API_KEY = process.env.Maps_API_KEY; 

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
            // Añadir ubicacion_actual a los usuarios existentes en caso de inicialización, si ya existe se mantendría
            initialData.usuarios = initialData.usuarios.map(u => ({
                ...u,
                lat: null, // Nueva propiedad
                lng: null, // Nueva propiedad
                ultima_actualizacion_ubicacion: null // Nueva propiedad
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
                // Asegurarse de que todos los usuarios tienen las nuevas propiedades al cargar la DB
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
            // Solo intentar geocodificar si hay una dirección y la API Key está disponible
            if (cliente.direccion && Maps_API_KEY) { 
                try {
                    let direccionCompleta = `${cliente.direccion}, CDMX, México`.replace(/,\s+/g, ', ').replace(/\s+/g, '+');
                    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
                        params: { address: direccionCompleta, key: Maps_API_KEY, region: 'mx' }
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
        // Añadir lógica para que la API Key esté disponible para el geocoding
        if (!Maps_API_KEY) {
            return res.status(500).json({ status: "error", mensaje: "API Key de Google Maps no configurada en el servidor." });
        }

        let direccionCompleta = direccion.trim().replace(/\s+/g, ' ').replace(/,+/g, ',').replace(/(^,|,$)/g, '').replace(/\b(colonia|col|cdmx|mexico)\b/gi, '').trim();
        if (!direccionCompleta.toLowerCase().includes('méxico') && !direccionCompleta.toLowerCase().includes('cdmx') && !direccionCompleta.toLowerCase().includes('ciudad de méxico')) {
            direccionCompleta += ', CDMX, México';
        }
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address: direccionCompleta.replace(/\s+/g, '+'),
                key: Maps_API_KEY, 
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
            case "REQUEST_DENIED": // Este es el error que te aparece
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
        lat: null, // Inicializar nuevas propiedades
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

app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en http://localhost:${PORT}`);
    // Añade esto para verificar la clave al inicio del servidor
    console.log(`Google Maps API Key (server): ${Maps_API_KEY ? 'Cargada' : 'ERROR: No cargada'}`);
    const dataDir = path.dirname(DB_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`📂 Directorio de datos creado en: ${dataDir}`);
    }
    console.log(`💾 Ruta de base de datos: ${DB_FILE}`);
    readDB();
});

module.exports = app;