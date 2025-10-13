// .env solo en desarrollo; en Render se usan vars del panel
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const MAPS_API_KEY = process.env.Maps_API_KEY || process.env.MAPS_API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== Rutas de datos =====
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const EMPRESAS_PATH = path.join(DATA_DIR, 'empresas.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const t = fs.readFileSync(p, 'utf8');
    return t ? JSON.parse(t) : fallback;
  } catch { return fallback; }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function loadDB() {
  return readJSON(DB_PATH, {
    usuarios: [],      // {id, nombre, password, rol, empresa_id}
    clientes: [],      // {id, empresa_id, nombre, telefono, direccion, tarifa, saldo_exigible, saldo, asignado_a, lat, lng}
    llamadas: [],      // {id, empresa_id, cliente_id, usuario_id, fecha, monto_cobrado, resultado, observaciones}
    ubicaciones: []    // {usuario_id, empresa_id, lat, lng, fecha}
  });
}
function saveDB(db) { writeJSON(DB_PATH, db); }

function loadEmpresas() { return readJSON(EMPRESAS_PATH, []); }
function saveEmpresas(list) { writeJSON(EMPRESAS_PATH, list); }

function nextId(list) { return list.length ? Math.max(...list.map(x => x.id || 0)) + 1 : 1; }

// ===== Seed mínimo =====
(function seed() {
  let empresas = loadEmpresas();
  if (empresas.length === 0) {
    empresas = [{ id: 1, nombre: 'Empresa Demo' }];
    saveEmpresas(empresas);
  }
  const db = loadDB();
  if (!db.usuarios.some(u => u.rol === 'superadmin')) {
    db.usuarios.push({ id: 0, nombre: 'superadmin', password: 'admin123', rol: 'superadmin', empresa_id: null });
  }
  if (!db.usuarios.some(u => u.rol === 'admin' && u.empresa_id === 1)) {
    db.usuarios.push({ id: 1, nombre: 'admin', password: 'admin123', rol: 'admin', empresa_id: 1 });
  }
  saveDB(db);
})();

// ===== Helpers de tenant =====
function getEmpresaIdFromReq(req) {
  // Superadmin actuando como empresa
  if (req.headers['x-empresa-id']) return Number(req.headers['x-empresa-id']);
  // Usuario normal (admin/gestor): empresa del usuario
  const uid = req.headers['x-user-id'];
  if (uid != null) {
    const db = loadDB();
    const u = db.usuarios.find(x => String(x.id) === String(uid));
    if (u && u.empresa_id != null) return Number(u.empresa_id);
  }
  return null;
}

// ===== API KEY Maps =====
app.get('/api-key', (req, res) => {
  if (!MAPS_API_KEY) return res.status(500).json({ error: 'Maps_API_KEY no configurada' });
  res.json({ key: MAPS_API_KEY });
});

// ===== Auth =====
app.post('/login', (req, res) => {
  const { usuario, password } = req.body || {};
  const db = loadDB();
  const u = db.usuarios.find(x => x.nombre === usuario && x.password === password);
  if (!u) return res.json({ status: 'error', mensaje: 'Usuario o contraseña incorrectos' });
  return res.json({ status: 'ok', id: u.id, usuario: u.nombre, rol: u.rol, empresa_id: u.empresa_id ?? null });
});

// ===== Empresas (solo superadmin) =====
app.get('/empresas', (req, res) => {
  if (String(req.headers['x-user-id']) !== '0') return res.status(403).json({ status: 'error', mensaje: 'Solo superadmin' });
  res.json(loadEmpresas());
});

app.post('/empresas/crear', (req, res) => {
  if (String(req.headers['x-user-id']) !== '0') return res.status(403).json({ status: 'error', mensaje: 'Solo superadmin' });
  const { nombre, admin_nombre, admin_password } = req.body || {};
  if (!nombre || !admin_nombre || !admin_password) return res.status(400).json({ status: 'error', mensaje: 'Campos requeridos' });
  const empresas = loadEmpresas();
  const id = nextId(empresas);
  empresas.push({ id, nombre });
  saveEmpresas(empresas);
  const db = loadDB();
  db.usuarios.push({ id: nextId(db.usuarios), nombre: admin_nombre, password: admin_password, rol: 'admin', empresa_id: id });
  saveDB(db);
  res.json({ status: 'ok', mensaje: 'Empresa creada', empresa: { id, nombre } });
});

// ===== Usuarios (por empresa) =====
app.get('/usuarios', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const db = loadDB();
  const usuarios = db.usuarios.filter(u => u.empresa_id === empresaId && u.rol !== 'superadmin');
  res.json(usuarios);
});

app.post('/usuarios', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const { nombre, password } = req.body || {};
  if (!nombre || !password) return res.status(400).json({ status: 'error', mensaje: 'nombre y password requeridos' });
  const db = loadDB();
  const existe = db.usuarios.find(u => u.empresa_id === empresaId && u.nombre === nombre);
  if (existe) return res.json({ status: 'error', mensaje: 'Usuario ya existe en esta empresa' });
  const nuevo = { id: nextId(db.usuarios), nombre, password, rol: 'gestor', empresa_id: empresaId };
  db.usuarios.push(nuevo);
  saveDB(db);
  res.json({ status: 'ok', usuario: nuevo });
});

app.post('/usuarios/eliminar', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const { id } = req.body || {};
  const db = loadDB();
  const before = db.usuarios.length;
  db.usuarios = db.usuarios.filter(u => !(u.empresa_id === empresaId && u.id === Number(id)));
  if (db.usuarios.length === before) return res.json({ status: 'error', mensaje: 'No encontrado' });
  saveDB(db);
  res.json({ status: 'ok', mensaje: 'Eliminado' });
});

// ===== Clientes =====
app.get('/clientes', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const db = loadDB();
  res.json(db.clientes.filter(c => c.empresa_id === empresaId));
});

app.get('/clientes/:usuarioId', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const uid = Number(req.params.usuarioId);
  const db = loadDB();
  const list = db.clientes.filter(c => c.empresa_id === empresaId && c.asignado_a === uid);
  res.json(list);
});

app.post('/actualizar-clientes', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const { clientes } = req.body || {};
  const db = loadDB();
  (clientes || []).forEach(c => {
    const idx = db.clientes.findIndex(x => x.empresa_id === empresaId && x.id === Number(c.id));
    if (idx >= 0) db.clientes[idx].asignado_a = c.asignado_a;
  });
  saveDB(db);
  res.json({ status: 'ok', mensaje: 'Asignaciones guardadas' });
});

app.post('/cargar-clientes', async (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const { clientes } = req.body || {};
  if (!Array.isArray(clientes) || clientes.length === 0) {
    return res.status(400).json({ status: 'error', mensaje: 'Sin clientes' });
  }
  const db = loadDB();
  let conCoords = 0;
  for (const c of clientes) {
    const nuevo = {
      id: nextId(db.clientes),
      empresa_id: empresaId,
      nombre: (c.nombre || '').trim(),
      telefono: (c.telefono || '').trim(),
      direccion: (c.direccion || '').trim(),
      tarifa: (c.tarifa || '').trim(),
      saldo_exigible: (c.saldo_exigible || '').trim(),
      saldo: (c.saldo || '').trim(),
      asignado_a: c.asignado_a ?? null,
      lat: null, lng: null
    };
    // geocodificación best-effort (si hay dirección y API key)
    if (MAPS_API_KEY && nuevo.direccion) {
      try {
        const url = 'https://maps.googleapis.com/maps/api/geocode/json';
        const r = await axios.get(url, { params: { address: nuevo.direccion, key: MAPS_API_KEY } });
        if (r.data && r.data.results && r.data.results[0]) {
          const g = r.data.results[0].geometry.location;
          nuevo.lat = g.lat; nuevo.lng = g.lng; conCoords++;
        }
      } catch (_) {}
    }
    db.clientes.push(nuevo);
  }
  saveDB(db);
  res.json({ status: 'ok', mensaje: `Se cargaron ${clientes.length} clientes`, clientesConCoordenadas: conCoords });
});

app.post('/limpiar-clientes', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const db = loadDB();
  const before = db.clientes.length;
  db.clientes = db.clientes.filter(c => c.empresa_id !== empresaId);
  saveDB(db);
  res.json({ status: 'ok', mensaje: `Eliminados ${before - db.clientes.length} clientes` });
});

app.post('/actualizar-coordenadas', async (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const { clienteId, direccion } = req.body || {};
  const db = loadDB();
  const idx = db.clientes.findIndex(c => c.empresa_id === empresaId && c.id === Number(clienteId));
  if (idx < 0) return res.json({ status: 'error', mensaje: 'Cliente no encontrado' });

  if (!MAPS_API_KEY) return res.json({ status: 'error', mensaje: 'API key no configurada' });
  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json';
    const r = await axios.get(url, { params: { address: direccion, key: MAPS_API_KEY } });
    if (r.data && r.data.results && r.data.results[0]) {
      const g = r.data.results[0].geometry.location;
      db.clientes[idx].lat = g.lat; db.clientes[idx].lng = g.lng;
      saveDB(db);
      return res.json({ status: 'ok', lat: g.lat, lng: g.lng, direccion_formateada: r.data.results[0].formatted_address });
    }
    return res.json({ status: 'error', mensaje: 'Sin resultados' });
  } catch (e) {
    return res.json({ status: 'error', mensaje: 'Error geocodificación' });
  }
});

// ===== Llamadas =====
app.post('/llamadas', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const { cliente_id, usuario_id, fecha, monto_cobrado, resultado, observaciones } = req.body || {};
  const db = loadDB();
  db.llamadas.push({
    id: nextId(db.llamadas),
    empresa_id: empresaId,
    cliente_id: Number(cliente_id),
    usuario_id: Number(usuario_id),
    fecha,
    monto_cobrado: Number(monto_cobrado || 0),
    resultado: resultado || '',
    observaciones: observaciones || ''
  });
  saveDB(db);
  res.json({ status: 'ok', mensaje: 'Llamada registrada' });
});

// ===== Ubicación de usuario (opcional) =====
app.post('/actualizar-ubicacion-usuario', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  const { usuario_id, lat, lng } = req.body || {};
  const db = loadDB();
  db.ubicaciones.push({ usuario_id: Number(usuario_id), empresa_id: empresaId, lat, lng, fecha: new Date().toISOString() });
  saveDB(db);
  res.json({ status: 'ok' });
});

// ======== REPORTE DE GESTIONES ========
// GET /reporte?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&usuario_id=123&resultado=Éxito
app.get('/reporte', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) {
    return res.status(403).json({ status: 'error', mensaje: 'Sin empresa activa' });
  }

  const { desde, hasta, usuario_id, resultado } = req.query;

  // Normaliza fechas (inclusivo)
  let start = null, end = null;
  try {
    if (desde) start = new Date(`${desde}T00:00:00`);
    if (hasta) end   = new Date(`${hasta}T23:59:59`);
  } catch (_) { /* ignorar */ }

  const db = loadDB();

  // Índices para enriquecer filas
  const usuariosIdx = {};
  for (const u of db.usuarios) {
    if (u.empresa_id === empresaId) usuariosIdx[u.id] = u;
  }
  const clientesIdx = {};
  for (const c of db.clientes) {
    if (c.empresa_id === empresaId) clientesIdx[c.id] = c;
  }

  // Filtra llamadas de la empresa
  let llamadas = (db.llamadas || []).filter(l => Number(l.empresa_id) === Number(empresaId));

  // Fecha (inclusivo)
  if (start) llamadas = llamadas.filter(l => {
    const f = new Date(`${l.fecha}T00:00:00`);
    return f >= start;
  });
  if (end) llamadas = llamadas.filter(l => {
    const f = new Date(`${l.fecha}T23:59:59`);
    return f <= end;
  });

  // Filtros opcionales
  if (usuario_id) {
    const uid = Number(usuario_id);
    llamadas = llamadas.filter(l => Number(l.usuario_id) === uid);
  }
  if (resultado) {
    const rnorm = String(resultado).toLowerCase();
    llamadas = llamadas.filter(l => String(l.resultado || '').toLowerCase() === rnorm);
  }

  // Arma filas enriquecidas
  const filas = llamadas.map(l => {
    const u = usuariosIdx[l.usuario_id] || {};
    const c = clientesIdx[l.cliente_id] || {};
    return {
      usuario_id: l.usuario_id,
      usuario: u.nombre || `#${l.usuario_id}`,
      cliente_id: l.cliente_id,
      cliente: c.nombre || `#${l.cliente_id}`,
      resultado: l.resultado || '',
      monto_cobrado: Number(l.monto_cobrado || 0),
      fecha: l.fecha, // YYYY-MM-DD
      observaciones: l.observaciones || '',
      tarifa: c.tarifa || '',
      saldo_exigible: c.saldo_exigible || '',
      saldo: c.saldo || ''
    };
  });

  // Ordena por fecha desc (más reciente primero)
  filas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  return res.json(filas);
});

// ===== Start =====
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
