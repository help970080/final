// server.js — API multi-empresa + objetivos + KPIs + carga Excel + Maps
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// === Rutas de datos ===
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const OBJETIVOS_PATH = path.join(DATA_DIR, 'objetivos.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ===== Helpers de persistencia =====
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = {
      empresas: [
        { id: 1, nombre: "Empresa Demo" }
      ],
      usuarios: [
        // superadmin (global)
        { id: 0, nombre: 'superadmin', usuario: 'superadmin', password: 'admin123', rol: 'superadmin', empresa_id: null },
        // admin demo
        { id: 1, nombre: 'admin-demo', usuario: 'admin', password: 'admin123', rol: 'admin', empresa_id: 1 },
        // gestor demo
        { id: 2, nombre: 'gestor1', usuario: 'gestor', password: 'gestor123', rol: 'usuario', empresa_id: 1 }
      ],
      clientes: [
        { id: 1, empresa_id: 1, nombre: 'Carlos Pérez', telefono: '5511111111', direccion: 'CDMX', tarifa: 'Plan A', saldo_exigible:'1200', saldo:'1500', asignado_a: null, lat:null, lng:null },
      ],
      llamadas: [],
      ubicaciones_usuarios: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || '{}');
  } catch {
    return { empresas: [], usuarios: [], clientes: [], llamadas: [], ubicaciones_usuarios: [] };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function loadObjetivos() {
  try {
    if (!fs.existsSync(OBJETIVOS_PATH)) return [];
    return JSON.parse(fs.readFileSync(OBJETIVOS_PATH, 'utf8') || '[]');
  } catch {
    return [];
  }
}
function saveObjetivos(arr) {
  fs.writeFileSync(OBJETIVOS_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

// ===== Helpers de empresa/usuario =====
function getEmpresaIdFromReq(req) {
  if (req.headers['x-empresa-id']) return Number(req.headers['x-empresa-id']);
  if (req.user && req.user.empresa_id != null) return Number(req.user.empresa_id);
  return null;
}
function getUserIdFromReq(req) {
  if (req.headers['x-user-id']) return Number(req.headers['x-user-id']);
  return null;
}
function nextId(arr) {
  return arr.length ? Math.max(...arr.map(o => Number(o.id))) + 1 : 1;
}

// ===== API key de Google Maps para el frontend =====
app.get('/api-key', (req, res) => {
  const key = process.env.Maps_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  res.json({ key });
});

// ===== Login =====
app.post('/login', (req, res) => {
  const { usuario, password } = req.body || {};
  const db = loadDB();
  const u = (db.usuarios || []).find(us => us.usuario === usuario && us.password === password);
  if (!u) return res.json({ status: 'error', mensaje: 'Usuario o contraseña incorrectos' });

  return res.json({
    status: 'ok',
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    empresa_id: u.empresa_id
  });
});

// ===== Middleware de “auth” simplificado: inyecta req.user si x-user-id válido =====
app.use((req, _res, next) => {
  const db = loadDB();
  const uid = getUserIdFromReq(req);
  if (uid != null) {
    const u = (db.usuarios || []).find(x => Number(x.id) === Number(uid));
    if (u) req.user = u;
  }
  next();
});

// ===== Empresas =====
app.get('/empresas', (req, res) => {
  const db = loadDB();
  res.json((db.empresas || []).map(e => ({ id: e.id, nombre: e.nombre })));
});

app.post('/empresas/crear', (req, res) => {
  const { nombre, admin_nombre, admin_password } = req.body || {};
  if (!nombre || !admin_nombre || !admin_password) {
    return res.status(400).json({ status: 'error', mensaje: 'nombre, admin_nombre y admin_password son requeridos' });
  }
  const db = loadDB();
  const id = nextId(db.empresas);
  db.empresas.push({ id, nombre });

  const adminUserId = nextId(db.usuarios);
  db.usuarios.push({
    id: adminUserId,
    nombre: admin_nombre,
    usuario: admin_nombre,
    password: admin_password,
    rol: 'admin',
    empresa_id: id
  });

  saveDB(db);
  res.json({ status: 'ok', mensaje: 'Empresa creada', empresa: { id, nombre }, admin: { id: adminUserId, usuario: admin_nombre }});
});

// ===== Usuarios (por empresa) =====
app.get('/usuarios', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });
  const usuarios = (db.usuarios || []).filter(u => u.rol !== 'superadmin' && Number(u.empresa_id) === Number(empresaId));
  res.json(usuarios.map(u => ({ id: u.id, nombre: u.nombre })));
});

app.post('/usuarios', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  const uid = getUserIdFromReq(req);
  const user = db.usuarios.find(u => u.id === uid);

  if (!user || !['admin','superadmin'].includes(user.rol) || (user.rol==='admin' && user.empresa_id !== empresaId)) {
    return res.status(403).json({ status:'error', mensaje: 'Sin permisos' });
  }

  const { nombre, password } = req.body || {};
  if (!nombre || !password) return res.status(400).json({ status:'error', mensaje:'nombre y password requeridos' });

  const id = nextId(db.usuarios);
  db.usuarios.push({ id, nombre, usuario: nombre, password, rol:'usuario', empresa_id: empresaId });
  saveDB(db);
  res.json({ status:'ok', id });
});

app.post('/usuarios/eliminar', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  const uid = getUserIdFromReq(req);
  const user = db.usuarios.find(u => u.id === uid);

  if (!user || !['admin','superadmin'].includes(user.rol) || (user.rol==='admin' && user.empresa_id !== empresaId)) {
    return res.status(403).json({ status:'error', mensaje:'Sin permisos' });
  }
  const { id } = req.body || {};
  if (id == null) return res.status(400).json({ status:'error', mensaje:'id requerido' });

  db.usuarios = db.usuarios.filter(u => Number(u.id)!==Number(id));
  // quitar asignaciones si existieran
  db.clientes = (db.clientes || []).map(c => (c.asignado_a === id ? { ...c, asignado_a: null } : c));
  saveDB(db);
  res.json({ status:'ok' });
});

// ===== Clientes =====
app.get('/clientes', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });
  const lista = (db.clientes || []).filter(c => Number(c.empresa_id) === Number(empresaId));
  res.json(lista);
});

app.get('/clientes/:usuarioId', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });

  const usuarioId = Number(req.params.usuarioId);
  const list = (db.clientes || []).filter(c => Number(c.empresa_id) === Number(empresaId) && Number(c.asignado_a) === usuarioId);
  res.json(list);
});

app.post('/actualizar-clientes', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  const uid = getUserIdFromReq(req);
  const user = db.usuarios.find(u => u.id === uid);

  if (!user || !['admin','superadmin'].includes(user.rol) || (user.rol==='admin' && user.empresa_id !== empresaId)) {
    return res.status(403).json({ status:'error', mensaje:'Sin permisos' });
  }

  const { clientes } = req.body || {};
  if (!Array.isArray(clientes)) return res.status(400).json({ status:'error', mensaje:'clientes debe ser arreglo' });

  db.clientes = (db.clientes || []).map(c => {
    if (Number(c.empresa_id) !== Number(empresaId)) return c;
    const upd = clientes.find(x => Number(x.id) === Number(c.id));
    if (!upd) return c;
    return { ...c, asignado_a: upd.asignado_a != null ? Number(upd.asignado_a) : null };
  });

  saveDB(db);
  res.json({ status:'ok', mensaje:'Asignaciones actualizadas' });
});

app.post('/cargar-clientes', async (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  const uid = getUserIdFromReq(req);
  const user = db.usuarios.find(u => u.id === uid);

  if (!user || !['admin','superadmin'].includes(user.rol) || (user.rol==='admin' && user.empresa_id !== empresaId)) {
    return res.status(403).json({ status:'error', mensaje:'Sin permisos' });
  }
  const { clientes } = req.body || {};
  if (!Array.isArray(clientes) || !clientes.length) {
    return res.status(400).json({ status:'error', mensaje:'clientes vacío o inválido' });
  }

  let maxId = db.clientes.length ? Math.max(...db.clientes.map(c => Number(c.id))) : 0;
  let withCoords = 0;
  for (const cli of clientes) {
    maxId += 1;
    const nuevo = {
      id: maxId,
      empresa_id: empresaId,
      nombre: cli.nombre || '',
      telefono: cli.telefono || '',
      direccion: cli.direccion || '',
      tarifa: cli.tarifa || '',
      saldo_exigible: cli.saldo_exigible || '',
      saldo: cli.saldo || '',
      asignado_a: cli.asignado_a != null ? Number(cli.asignado_a) : null,
      lat: null, lng: null
    };
    db.clientes.push(nuevo);
  }
  saveDB(db);

  res.json({ status:'ok', mensaje:`${clientes.length} clientes cargados`, clientesConCoordenadas: withCoords });
});

app.post('/limpiar-clientes', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  const uid = getUserIdFromReq(req);
  const user = db.usuarios.find(u => u.id === uid);

  if (!user || !['admin','superadmin'].includes(user.rol) || (user.rol==='admin' && user.empresa_id !== empresaId)) {
    return res.status(403).json({ status:'error', mensaje:'Sin permisos' });
  }
  const prev = db.clientes.length;
  db.clientes = (db.clientes || []).filter(c => Number(c.empresa_id) !== Number(empresaId));
  saveDB(db);
  res.json({ status:'ok', mensaje:`Eliminados ${prev - db.clientes.length} clientes de la empresa #${empresaId}` });
});

// ===== Llamadas =====
app.post('/llamadas', (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  const { cliente_id, usuario_id, fecha, monto_cobrado, resultado, observaciones } = req.body || {};
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });

  const id = nextId(db.llamadas || []);
  const reg = {
    id,
    empresa_id: empresaId,
    cliente_id: Number(cliente_id),
    usuario_id: Number(usuario_id),
    fecha: fecha || new Date().toISOString().slice(0,10),
    monto_cobrado: Number(monto_cobrado || 0),
    resultado: resultado || '',
    observaciones: observaciones || ''
  };
  db.llamadas.push(reg);
  saveDB(db);
  res.json({ status:'ok', llamada: reg });
});

// ===== Ubicación de usuarios =====
app.post('/actualizar-ubicacion-usuario', (req, res) => {
  const db = loadDB();
  const { usuario_id, lat, lng } = req.body || {};
  if (usuario_id == null) return res.status(400).json({ status:'error', mensaje:'usuario_id requerido' });

  db.ubicaciones_usuarios = db.ubicaciones_usuarios || [];
  db.ubicaciones_usuarios.push({ usuario_id: Number(usuario_id), lat: Number(lat), lng: Number(lng), ts: Date.now() });
  saveDB(db);
  res.json({ status:'ok' });
});

// ===== Geocodificación (usa Google Maps Geocoding) =====
app.post('/actualizar-coordenadas', async (req, res) => {
  const db = loadDB();
  const empresaId = getEmpresaIdFromReq(req);
  const { clienteId, direccion } = req.body || {};
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });
  if (!clienteId || !direccion) return res.status(400).json({ status:'error', mensaje:'clienteId y direccion requeridos' });

  const key = process.env.Maps_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ status:'error', mensaje:'Maps_API_KEY no configurada' });

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccion)}&key=${key}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!j.results || !j.results.length) {
      return res.json({ status:'error', mensaje:'No se encontraron coordenadas', detalle: j.status });
    }
    const loc = j.results[0].geometry.location;
    db.clientes = (db.clientes || []).map(c => {
      if (Number(c.id) === Number(clienteId) && Number(c.empresa_id) === Number(empresaId)) {
        return { ...c, lat: loc.lat, lng: loc.lng, direccion: j.results[0].formatted_address || c.direccion };
      }
      return c;
    });
    saveDB(db);
    res.json({ status:'ok', lat: loc.lat, lng: loc.lng, direccion_formateada: j.results[0].formatted_address });
  } catch (e) {
    res.status(500).json({ status:'error', mensaje:'Fallo geocoding', detalle: e.message });
  }
});

// ===== Objetivos (CRUD) =====
app.get('/objetivos', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });
  const all = loadObjetivos();
  const objetivos = all.filter(o => Number(o.empresa_id) === Number(empresaId));
  res.json({ status: 'ok', objetivos });
});

app.post('/objetivos/upsert', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });
  const { usuario_id, objetivo_monto } = req.body || {};
  if (usuario_id == null || objetivo_monto == null) {
    return res.status(400).json({ status: 'error', mensaje: 'usuario_id y objetivo_monto son requeridos' });
  }
  const all = loadObjetivos();
  const idx = all.findIndex(o => Number(o.empresa_id) === Number(empresaId) && Number(o.usuario_id) === Number(usuario_id));
  const nuevo = { empresa_id: Number(empresaId), usuario_id: Number(usuario_id), objetivo_monto: Number(objetivo_monto) };
  if (idx >= 0) all[idx] = nuevo; else all.push(nuevo);
  saveObjetivos(all);
  res.json({ status: 'ok', mensaje: 'Objetivo guardado', objetivo: nuevo });
});

app.post('/objetivos/eliminar', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });
  const { usuario_id } = req.body || {};
  if (usuario_id == null) return res.status(400).json({ status:'error', mensaje:'usuario_id requerido' });
  const all = loadObjetivos();
  const filtered = all.filter(o => !(Number(o.empresa_id) === Number(empresaId) && Number(o.usuario_id) === Number(usuario_id)));
  saveObjetivos(filtered);
  res.json({ status: 'ok', mensaje: 'Objetivo eliminado' });
});

// ===== KPIs por gestor vs objetivo + semáforo =====
// /kpis-gestores?desde=YYYY-MM-DD
app.get('/kpis-gestores', (req, res) => {
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId == null) return res.status(403).json({ status:'error', mensaje:'Empresa no seleccionada' });

  const desde = req.query.desde; // opcional
  const today = new Date();
  const inicio = desde ? new Date(desde + 'T00:00:00') : new Date(today.getFullYear(), today.getMonth(), 1);

  const db = loadDB();
  const usuarios = (db.usuarios || []).filter(u => u.rol !== 'superadmin' && Number(u.empresa_id) === Number(empresaId));
  const llamadas = (db.llamadas || []).filter(l => Number(l.empresa_id) === Number(empresaId));

  const llamadasPeriodo = llamadas.filter(l => new Date(l.fecha + 'T00:00:00') >= inicio);
  const objetivos = loadObjetivos().filter(o => Number(o.empresa_id) === Number(empresaId));

  const agg = {};
  for (const u of usuarios) agg[u.id] = { usuario_id: u.id, nombre: u.nombre, total_cobrado: 0, llamadas_totales: 0, exitosas: 0 };

  for (const l of llamadasPeriodo) {
    const target = agg[l.usuario_id];
    if (!target) continue;
    target.llamadas_totales += 1;
    const monto = Number(l.monto_cobrado || 0);
    target.total_cobrado += isNaN(monto) ? 0 : monto;
    const r = String(l.resultado || '').toLowerCase();
    if (r.includes('éxito') || r.includes('exito')) target.exitosas += 1;
  }

  const filas = Object.values(agg).map(row => {
    const obj = objetivos.find(o => Number(o.usuario_id) === Number(row.usuario_id));
    const objetivo = obj ? Number(obj.objetivo_monto) : 0;
    const avance = objetivo > 0 ? (row.total_cobrado / objetivo) : 0;
    let semaforo = 'gris';
    if (objetivo > 0) {
      if (avance < 0.5) semaforo = 'rojo';
      else if (avance < 0.8) semaforo = 'amarillo';
      else if (avance < 1.0) semaforo = 'naranja';
      else semaforo = 'verde';
    }
    const efectividad = row.llamadas_totales > 0 ? (row.exitosas / row.llamadas_totales) : 0;

    return {
      ...row,
      objetivo,
      avance_porcentaje: Math.round(avance * 100),
      semaforo,
      efectividad: Math.round(efectividad * 100)
    };
  });

  res.json({ status: 'ok', desde: inicio.toISOString().slice(0,10), kpis: filas });
});

// ===== Fallback: index =====
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
