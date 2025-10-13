// server.js (multi-tenant + superadmin endpoints)
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

// Serve static assets from /public
app.use(express.static(path.join(__dirname, 'public')));

// Persistent DB path (Render allows writes here)
const DB_FILE = '/opt/render/project/src/data/database.json';

let dbCache = null;
let lastDbUpdate = 0;

const Maps_API_KEY = process.env.Maps_API_KEY;

// ---------- DB helpers ----------
function ensureDataDir() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readDB() {
  const stats = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE) : null;
  if (!dbCache || (stats && stats.mtimeMs > lastDbUpdate)) {
    if (!fs.existsSync(DB_FILE)) {
      ensureDataDir();
      const initialData = {
        empresas: [{ id: 1, nombre: "Celexpress" }],
        usuarios: [
          { id: 0, nombre: "superadmin", password: "admin123", empresa_id: null, rol: "superadmin", lat: null, lng: null, ultima_actualizacion_ubicacion: null },
        ],
        clientes: [],
        llamadas: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
      dbCache = initialData;
    } else {
      try {
        dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        dbCache.usuarios = (dbCache.usuarios || []).map(u => ({
          ...u,
          rol: u.rol || (u.id === 0 ? 'superadmin' : 'gestor'),
          lat: u.lat ?? null,
          lng: u.lng ?? null,
          ultima_actualizacion_ubicacion: u.ultima_actualizacion_ubicacion ?? null
        }));
        dbCache.empresas = dbCache.empresas || [];
        dbCache.clientes = dbCache.clientes || [];
        dbCache.llamadas = dbCache.llamadas || [];
      } catch (err) {
        console.error("Error al leer database.json:", err);
        dbCache = { empresas: [], usuarios: [], clientes: [], llamadas: [] };
      }
    }
    lastDbUpdate = Date.now();
  }
  return dbCache;
}

function writeDB(data) {
  try {
    ensureDataDir();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    dbCache = data;
    lastDbUpdate = Date.now();
  } catch (err) {
    console.error("Error al escribir en database.json:", err);
  }
}

function getUserById(userId) {
  const db = readDB();
  return db.usuarios.find(u => parseInt(u.id) === parseInt(userId));
}

function getAuthUser(req) {
  const uid = req.headers['x-user-id'] ?? req.body.usuario_id ?? req.params.usuarioId;
  if (uid === undefined || uid === null || uid === '') return null;
  return getUserById(uid);
}

function requireSuperadmin(req, res) {
  const u = getAuthUser(req);
  if (!u || (u.rol !== 'superadmin' && u.id !== 0)) {
    res.status(403).json({ status: "error", mensaje: "Solo superadmin puede realizar esta acción" });
    return null;
  }
  return u;
}

function resolveEmpresaIdFromReq(req) {
  const uid = req.body.usuario_id ?? req.params.usuarioId ?? req.headers['x-user-id'];
  if (uid !== undefined && uid !== null && uid !== '') {
    const u = getUserById(uid);
    if (u && u.empresa_id) return parseInt(u.empresa_id);
  }
  if (req.body && req.body.empresa_id) return parseInt(req.body.empresa_id);
  if (req.query && req.query.empresa_id) return parseInt(req.query.empresa_id);
  if (req.headers['x-empresa-id']) return parseInt(req.headers['x-empresa-id']);
  return null;
}

// ---------- Base routes ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api-key', (req, res) => {
  if (!Maps_API_KEY) return res.status(404).json({ status: "error", mensaje: "Maps API Key no configurada" });
  res.json({ key: Maps_API_KEY });
});

// ---------- Auth ----------
app.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  const db = readDB();
  const user = db.usuarios.find(u => u.nombre === usuario && u.password === password);
  if (!user) return res.status(401).json({ status: "error", mensaje: "Usuario o contraseña incorrectos" });
  res.json({
    status: "ok",
    usuario: user.nombre,
    id: user.id,
    empresa_id: user.empresa_id,
    rol: user.rol || (user.id === 0 ? "superadmin" : "gestor"),
    esAdmin: (user.rol === "admin") || (user.rol === "superadmin") || (user.id === 0)
  });
});

// ---------- Superadmin: empresas ----------
app.get('/empresas', (req, res) => {
  const superadmin = requireSuperadmin(req, res);
  if (!superadmin) return;
  const db = readDB();
  res.json(db.empresas);
});

app.post('/empresas/crear', (req, res) => {
  const superadmin = requireSuperadmin(req, res);
  if (!superadmin) return;

  const { nombre, admin_nombre, admin_password } = req.body || {};
  if (!nombre || !admin_nombre || !admin_password) {
    return res.status(400).json({ status: "error", mensaje: "nombre, admin_nombre y admin_password son requeridos" });
  }

  const db = readDB();
  if (db.empresas.some(e => String(e.nombre).toLowerCase() === String(nombre).toLowerCase())) {
    return res.status(400).json({ status: "error", mensaje: "Ya existe una empresa con ese nombre" });
  }

  const nextEmpresaId = db.empresas.length ? Math.max(...db.empresas.map(e => e.id)) + 1 : 1;
  const nuevaEmpresa = { id: nextEmpresaId, nombre: String(nombre).trim() };
  db.empresas.push(nuevaEmpresa);

  const nextUserId = db.usuarios.length ? Math.max(...db.usuarios.map(u => u.id)) + 1 : 1;
  if (db.usuarios.some(u => u.empresa_id === nuevaEmpresa.id && String(u.nombre).toLowerCase() === String(admin_nombre).toLowerCase())) {
    return res.status(400).json({ status: "error", mensaje: "El usuario admin ya existe dentro de esa empresa" });
  }
  const adminUser = {
    id: nextUserId,
    nombre: String(admin_nombre).trim(),
    password: String(admin_password).trim(),
    rol: 'admin',
    empresa_id: nuevaEmpresa.id,
    lat: null, lng: null, ultima_actualizacion_ubicacion: null
  };
  db.usuarios.push(adminUser);

  writeDB(db);
  res.json({ status: "ok", mensaje: "Empresa y usuario admin creados", empresa: nuevaEmpresa, admin: { id: adminUser.id, nombre: adminUser.nombre, empresa_id: adminUser.empresa_id, rol: adminUser.rol } });
});

app.post('/empresas/:empresaId/admins', (req, res) => {
  const superadmin = requireSuperadmin(req, res);
  if (!superadmin) return;

  const empresaId = parseInt(req.params.empresaId);
  const { nombre, password } = req.body || {};
  if (!nombre || !password) return res.status(400).json({ status: "error", mensaje: "nombre y password son requeridos" });

  const db = readDB();
  const empresa = db.empresas.find(e => parseInt(e.id) === empresaId);
  if (!empresa) return res.status(404).json({ status: "error", mensaje: "Empresa no encontrada" });

  if (db.usuarios.some(u => u.empresa_id === empresaId && String(u.nombre).toLowerCase() === String(nombre).toLowerCase())) {
    return res.status(400).json({ status: "error", mensaje: "El usuario ya existe en esta empresa" });
  }

  const nextUserId = db.usuarios.length ? Math.max(...db.usuarios.map(u => u.id)) + 1 : 1;
  const nuevoAdmin = {
    id: nextUserId,
    nombre: String(nombre).trim(),
    password: String(password).trim(),
    rol: 'admin',
    empresa_id: empresaId,
    lat: null, lng: null, ultima_actualizacion_ubicacion: null
  };
  db.usuarios.push(nuevoAdmin);
  writeDB(db);
  res.json({ status: "ok", mensaje: "Admin creado", admin: { id: nuevoAdmin.id, nombre: nuevoAdmin.nombre } });
});

// ---------- Clientes ----------
app.get('/clientes', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const db = readDB();
  const list = (db.clientes || []).filter(c => parseInt(c.empresa_id) === parseInt(empresa_id));
  res.json(list);
});

app.get('/clientes/:usuarioId', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const db = readDB();
  const userId = parseInt(req.params.usuarioId);
  const clientesAsignados = db.clientes.filter(c =>
    parseInt(c.empresa_id) === parseInt(empresa_id) &&
    c.asignado_a !== null &&
    parseInt(c.asignado_a) === userId
  );
  res.json(clientesAsignados);
});

app.post('/cargar-clientes', async (req, res) => {
  try {
    const empresa_id = resolveEmpresaIdFromReq(req);
    if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });

    const nuevosClientes = Array.isArray(req.body.clientes) ? req.body.clientes : [];
    const db = readDB();
    const maxId = db.clientes.reduce((max, c) => Math.max(max, c.id || 0), 0);
    let nextId = maxId + 1;
    const loteClientes = [];
    let clientesConCoordenadas = 0;

    for (const cliente of nuevosClientes) {
      let lat = null, lng = null;
      if (cliente.direccion && Maps_API_KEY) {
        try {
          let direccionCompleta = `${cliente.direccion}, México`.replace(/,\s+/g, ', ').replace(/\s+/g, '+');
          const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: { address: direccionCompleta, key: Maps_API_KEY, region: 'mx' }
          });
          if (response.data.status === "OK") {
            const location = response.data.results[0].geometry.location;
            lat = location.lat; lng = location.lng;
            clientesConCoordenadas++;
          }
        } catch (err) {
          console.error("Error geocodificando:", cliente.nombre, err.message);
        }
      }
      loteClientes.push({
        ...cliente,
        empresa_id: parseInt(empresa_id),
        id: nextId++,
        asignado_a: cliente.asignado_a || null,
        lat, lng
      });
    }

    db.clientes = [...db.clientes, ...loteClientes];
    writeDB(db);
    res.json({ status: "ok", mensaje: `${loteClientes.length} clientes cargados`, totalClientes: db.clientes.filter(c => parseInt(c.empresa_id) === parseInt(empresa_id)).length, clientesConCoordenadas });
  } catch (error) {
    console.error("Error en /cargar-clientes:", error);
    res.status(500).json({ status: "error", mensaje: "Error al procesar carga de clientes" });
  }
});

app.post('/actualizar-coordenadas', async (req, res) => {
  try {
    const empresa_id = resolveEmpresaIdFromReq(req);
    if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
    const { clienteId, direccion } = req.body;
    const db = readDB();
    if (!direccion || direccion.trim().length < 5) return res.status(400).json({ status: "error", mensaje: "Dirección inválida" });
    if (!Maps_API_KEY) return res.status(500).json({ status: "error", mensaje: "API Key no configurada" });

    let direccionCompleta = direccion.trim().replace(/\s+/g, ' ').replace(/,+/g, ',').replace(/(^,|,$)/g, '');
    if (!/méxico|cdmx|ciudad de méxico|estado de méxico/i.test(direccionCompleta)) direccionCompleta += ', México';

    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: direccionCompleta.replace(/\s+/g, '+'), key: Maps_API_KEY, region: 'mx', components: 'country:MX' }
    });

    if (response.data.status === "OK") {
      const location = response.data.results[0].geometry.location;
      const idx = db.clientes.findIndex(c => parseInt(c.id) === parseInt(clienteId) && parseInt(c.empresa_id) === parseInt(empresa_id));
      if (idx === -1) return res.status(404).json({ status: "error", mensaje: "Cliente no encontrado" });
      db.clientes[idx].lat = location.lat;
      db.clientes[idx].lng = location.lng;
      writeDB(db);
      return res.json({ status: "ok", lat: location.lat, lng: location.lng, direccion_formateada: response.data.results[0].formatted_address, direccion_original: direccion });
    }

    res.status(400).json({ status: "error", mensaje: "No se pudo geocodificar", detalle: response.data.status });
  } catch (error) {
    console.error("Error geocodificación:", error);
    res.status(500).json({ status: "error", mensaje: "Error interno al geocodificar" });
  }
});

app.post('/limpiar-clientes', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const db = readDB();
  const before = db.clientes.length;
  db.clientes = db.clientes.filter(c => parseInt(c.empresa_id) !== parseInt(empresa_id));
  writeDB(db);
  const removed = before - db.clientes.length;
  res.json({ status: "ok", mensaje: `${removed} clientes eliminados` });
});

app.post('/actualizar-clientes', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const actualizaciones = Array.isArray(req.body.clientes) ? req.body.clientes : [];
  const db = readDB();
  let actualizados = 0;
  db.clientes = db.clientes.map(cliente => {
    if (parseInt(cliente.empresa_id) !== parseInt(empresa_id)) return cliente;
    const upd = actualizaciones.find(a => parseInt(a.id) === parseInt(cliente.id));
    if (!upd) return cliente;
    actualizados++;
    return {
      ...cliente,
      asignado_a: (upd.asignado_a !== undefined) ? (upd.asignado_a ? parseInt(upd.asignado_a) : null) : cliente.asignado_a,
      lat: (upd.lat !== undefined) ? upd.lat : cliente.lat,
      lng: (upd.lng !== undefined) ? upd.lng : cliente.lng
    };
  });
  writeDB(db);
  res.json({ status: "ok", mensaje: `${actualizados} clientes actualizados` });
});

// ---------- Usuarios ----------
app.get('/usuarios', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const db = readDB();
  const list = db.usuarios.filter(u => (u.rol !== 'superadmin') && parseInt(u.empresa_id) === parseInt(empresa_id));
  res.json(list);
});

app.post('/usuarios', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const { nombre, password, rol } = req.body;
  if (!nombre || !password) return res.status(400).json({ status: "error", mensaje: "Nombre y contraseña requeridos" });

  const db = readDB();
  if (db.usuarios.some(u => parseInt(u.empresa_id) === parseInt(empresa_id) && u.nombre.toLowerCase() === String(nombre).toLowerCase())) {
    return res.status(400).json({ status: "error", mensaje: "El usuario ya existe en esta empresa" });
  }
  const nuevoId = db.usuarios.length ? Math.max(...db.usuarios.map(u => u.id)) + 1 : 1;
  const nuevoUsuario = { id: nuevoId, nombre: String(nombre).trim(), password: String(password).trim(), rol: rol || 'gestor', empresa_id: parseInt(empresa_id), lat: null, lng: null, ultima_actualizacion_ubicacion: null };
  db.usuarios.push(nuevoUsuario);
  writeDB(db);
  res.json({ status: "ok", usuario: { id: nuevoUsuario.id, nombre: nuevoUsuario.nombre, rol: nuevoUsuario.rol } });
});

app.post('/usuarios/eliminar', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const { id } = req.body;
  const db = readDB();
  const usuarioIndex = db.usuarios.findIndex(u => parseInt(u.id) === parseInt(id) && u.rol !== 'superadmin' && parseInt(u.empresa_id) === parseInt(empresa_id));
  if (usuarioIndex === -1) return res.status(404).json({ status: "error", mensaje: "Usuario no encontrado" });
  const userId = db.usuarios[usuarioIndex].id;
  db.clientes = db.clientes.map(c => (parseInt(c.empresa_id) === parseInt(empresa_id) && parseInt(c.asignado_a) === parseInt(userId)) ? { ...c, asignado_a: null } : c);
  db.usuarios.splice(usuarioIndex, 1);
  writeDB(db);
  res.json({ status: "ok", mensaje: "Usuario eliminado y clientes desasignados" });
});

// ---------- Llamadas / Reporte ----------
app.get('/reporte', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const db = readDB();
  const llamadas = db.llamadas.filter(l => parseInt(l.empresa_id) === parseInt(empresa_id));
  const reporte = llamadas.map(l => {
    const cliente = db.clientes.find(c => c.id === l.cliente_id && parseInt(c.empresa_id) === parseInt(empresa_id));
    const usuario = db.usuarios.find(u => u.id === l.usuario_id && parseInt(u.empresa_id) === parseInt(empresa_id));
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
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const nueva = req.body;
  const db = readDB();

  const clienteIndex = db.clientes.findIndex(c => c.id === nueva.cliente_id && parseInt(c.empresa_id) === parseInt(empresa_id));
  if (clienteIndex === -1) return res.status(404).json({ status: "error", mensaje: "Cliente no encontrado en tu empresa." });

  const cliente = db.clientes[clienteIndex];
  if (cliente.asignado_a !== nueva.usuario_id) {
    return res.status(403).json({ status: "error", mensaje: "Este cliente no está asignado a tu usuario." });
  }

  const hoy = new Date().toISOString().split("T")[0];
  if (db.llamadas.find(l => l.cliente_id === nueva.cliente_id && l.fecha === hoy)) {
    return res.status(400).json({ status: "error", mensaje: "Este cliente ya fue procesado hoy." });
  }

  const maxId = db.llamadas.reduce((max, l) => Math.max(max, l.id || 0), 0);
  db.llamadas.push({ ...nueva, id: maxId + 1, empresa_id: parseInt(empresa_id), fecha: nueva.fecha || hoy });
  db.clientes[clienteIndex].asignado_a = null;
  writeDB(db);
  res.json({ status: "ok", mensaje: "Llamada registrada", id: maxId + 1 });
});

app.post('/actualizar-ubicacion-usuario', (req, res) => {
  const empresa_id = resolveEmpresaIdFromReq(req);
  if (!empresa_id) return res.status(403).json({ status: "error", mensaje: "Empresa no resuelta" });
  const { usuario_id, lat, lng } = req.body;
  const db = readDB();
  const idx = db.usuarios.findIndex(u => parseInt(u.id) === parseInt(usuario_id) && parseInt(u.empresa_id) === parseInt(empresa_id));
  if (idx === -1) return res.status(404).json({ status: "error", mensaje: "Usuario no encontrado en tu empresa" });
  db.usuarios[idx].lat = lat ?? null;
  db.usuarios[idx].lng = lng ?? null;
  db.usuarios[idx].ultima_actualizacion_ubicacion = new Date().toISOString();
  writeDB(db);
  res.json({ status: "ok", mensaje: "Ubicación actualizada" });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
