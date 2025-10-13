// server.js

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;
const MAPS_API_KEY = process.env.MAPS_API_KEY || process.env.Maps_API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.status(200).send('ok'));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));

// ===== Storage helpers =====
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const EMPRESAS_PATH = path.join(DATA_DIR, 'empresas.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const readJSON = (p, fb) => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')||'') : fb; } catch { return fb; } };
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');

const loadDB = () => readJSON(DB_PATH, { usuarios:[], clientes:[], llamadas:[], ubicaciones:[] });
const saveDB = (db) => writeJSON(DB_PATH, db);
const loadEmpresas = () => readJSON(EMPRESAS_PATH, []);
const saveEmpresas = (e) => writeJSON(EMPRESAS_PATH, e);
const nextId = (l) => l.length ? Math.max(...l.map(x => x.id||0))+1 : 1;
const s = (v) => (v==null ? '' : String(v));

// ===== Seed =====
(function seed(){
  let empresas = loadEmpresas();
  if (!empresas.length) { empresas = [{ id:1, nombre:'Empresa Demo'}]; saveEmpresas(empresas); }
  const db = loadDB();
  if (!db.usuarios.some(u=>u.rol==='superadmin')) db.usuarios.push({ id:0, nombre:'superadmin', password:'admin123', rol:'superadmin', empresa_id:null });
  if (!db.usuarios.some(u=>u.rol==='admin' && u.empresa_id===1)) db.usuarios.push({ id:1, nombre:'admin', password:'admin123', rol:'admin', empresa_id:1 });
  saveDB(db);
})();

function getEmpresaIdFromReq(req){
  if (req.headers['x-empresa-id']) return Number(req.headers['x-empresa-id']);
  const uid = req.headers['x-user-id'];
  if (uid!=null){
    const db = loadDB();
    const u = db.usuarios.find(x=>String(x.id)===String(uid));
    if (u && u.empresa_id!=null) return Number(u.empresa_id);
  }
  return null;
}

// ===== API Key para Maps =====
app.get('/api-key', (req, res) => {
  if (!MAPS_API_KEY) return res.status(500).json({ error:'Maps_API_KEY no configurada' });
  res.json({ key: MAPS_API_KEY });
});

// ===== Auth =====
app.post('/login', (req,res)=>{
  const { usuario, password } = req.body || {};
  const db = loadDB();
  const u = db.usuarios.find(x=>x.nombre===usuario && x.password===password);
  if (!u) return res.json({ status:'error', mensaje:'Usuario o contraseña incorrectos' });
  res.json({ status:'ok', id:u.id, usuario:u.nombre, rol:u.rol, empresa_id:u.empresa_id ?? null });
});

// ===== Empresas (superadmin) =====
app.get('/empresas', (req,res)=>{
  if (String(req.headers['x-user-id'])!=='0') return res.status(403).json({ status:'error', mensaje:'Solo superadmin' });
  res.json(loadEmpresas());
});
app.post('/empresas/crear', (req,res)=>{
  if (String(req.headers['x-user-id'])!=='0') return res.status(403).json({ status:'error', mensaje:'Solo superadmin' });
  const { nombre, admin_nombre, admin_password } = req.body || {};
  if (!nombre || !admin_nombre || !admin_password) return res.status(400).json({ status:'error', mensaje:'Campos requeridos' });

  const empresas = loadEmpresas();
  const id = nextId(empresas);
  empresas.push({ id, nombre });
  saveEmpresas(empresas);

  const db = loadDB();
  db.usuarios.push({ id: nextId(db.usuarios), nombre: admin_nombre, password: admin_password, rol:'admin', empresa_id:id });
  saveDB(db);
  res.json({ status:'ok', mensaje:'Empresa creada', empresa:{ id, nombre } });
});

// ===== Usuarios (empresa) =====
app.get('/usuarios',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });
  const db = loadDB();
  res.json(db.usuarios.filter(u=>u.empresa_id===empresaId && u.rol!=='superadmin'));
});
app.post('/usuarios',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });
  const { nombre, password } = req.body || {};
  if (!nombre || !password) return res.status(400).json({ status:'error', mensaje:'nombre y password requeridos' });
  const db = loadDB();
  if (db.usuarios.find(u=>u.empresa_id===empresaId && u.nombre===nombre)) return res.json({ status:'error', mensaje:'Usuario ya existe' });
  const nuevo = { id: nextId(db.usuarios), nombre, password, rol:'gestor', empresa_id:empresaId };
  db.usuarios.push(nuevo); saveDB(db);
  res.json({ status:'ok', usuario:nuevo });
});
app.post('/usuarios/eliminar',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });
  const { id } = req.body || {};
  const db = loadDB();
  const before = db.usuarios.length;
  db.usuarios = db.usuarios.filter(u=>!(u.empresa_id===empresaId && u.id===Number(id)));
  if (db.usuarios.length===before) return res.json({ status:'error', mensaje:'No encontrado' });
  saveDB(db); res.json({ status:'ok', mensaje:'Eliminado' });
});

// ===== Clientes =====
app.get('/clientes',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });
  const db = loadDB();
  res.json(db.clientes.filter(c=>c.empresa_id===empresaId));
});
app.get('/clientes/:usuarioId',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });
  const uid = Number(req.params.usuarioId);
  const db = loadDB();
  res.json(db.clientes.filter(c=>c.empresa_id===empresaId && c.asignado_a===uid));
});
app.post('/actualizar-clientes',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });
  const { clientes, clienteIds, asignado_a } = req.body || {};
  const db = loadDB();

  if (Array.isArray(clienteIds)){
    let count=0;
    clienteIds.forEach(id=>{
      const i = db.clientes.findIndex(x=>x.empresa_id===empresaId && x.id===Number(id));
      if (i>=0){ db.clientes[i].asignado_a = (asignado_a==null?null:Number(asignado_a)); count++; }
    });
    saveDB(db); return res.json({ status:'ok', mensaje:`Asignados ${count} clientes` });
  }

  if (Array.isArray(clientes)){
    clientes.forEach(c=>{
      const i = db.clientes.findIndex(x=>x.empresa_id===empresaId && x.id===Number(c.id));
      if (i>=0) db.clientes[i].asignado_a = (c.asignado_a==null?null:Number(c.asignado_a));
    });
    saveDB(db); return res.json({ status:'ok', mensaje:'Asignaciones guardadas' });
  }

  res.status(400).json({ status:'error', mensaje:'Payload inválido' });
});
app.post('/cargar-clientes', async (req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });

  const { clientes } = req.body || {};
  if (!Array.isArray(clientes) || !clientes.length) return res.status(400).json({ status:'error', mensaje:'Sin clientes' });

  const db = loadDB();
  let conCoords = 0;
  for (const c of clientes){
    const nuevo = {
      id: nextId(db.clientes),
      empresa_id: empresaId,
      nombre: s(c.nombre).trim(),
      telefono: s(c.telefono).trim(),
      direccion: s(c.direccion).trim(),
      tarifa: s(c.tarifa).trim(),
      saldo_exigible: s(c.saldo_exigible).trim(),
      saldo: s(c.saldo).trim(),
      asignado_a: c.asignado_a ?? null,
      lat:null, lng:null
    };
    if (MAPS_API_KEY && nuevo.direccion){
      try{
        const r = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
          params:{ address:nuevo.direccion, key:MAPS_API_KEY }, timeout:5000, validateStatus:()=>true
        });
        if (r.data?.results?.[0]){ const g=r.data.results[0].geometry.location; nuevo.lat=g.lat; nuevo.lng=g.lng; conCoords++; }
      }catch(e){ console.warn('Geocode fallo:', e.message); }
    }
    db.clientes.push(nuevo);
  }
  saveDB(db);
  res.json({ status:'ok', mensaje:`Se cargaron ${clientes.length} clientes`, clientesConCoordenadas: conCoords });
});
app.post('/limpiar-clientes',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });
  const db = loadDB();
  const before = db.clientes.length;
  db.clientes = db.clientes.filter(c=>c.empresa_id!==empresaId);
  saveDB(db);
  res.json({ status:'ok', mensaje:`Eliminados ${before-db.clientes.length} clientes` });
});

// ===== Llamadas =====
app.post('/llamadas',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });

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
  res.json({ status:'ok', mensaje:'Llamada registrada' });
});
app.get('/reporte',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });

  const { desde, hasta, usuario_id, resultado } = req.query;
  let start=null, end=null;
  try{ if (desde) start=new Date(`${desde}T00:00:00`); if (hasta) end=new Date(`${hasta}T23:59:59`);}catch{}

  const db = loadDB();
  const usuariosIdx = {}; db.usuarios.forEach(u=>{ if(u.empresa_id===empresaId) usuariosIdx[u.id]=u; });
  const clientesIdx = {}; db.clientes.forEach(c=>{ if(c.empresa_id===empresaId) clientesIdx[c.id]=c; });

  let llamadas = (db.llamadas||[]).filter(l=>Number(l.empresa_id)===Number(empresaId));
  if (start) llamadas = llamadas.filter(l=> new Date(`${l.fecha}T00:00:00`) >= start);
  if (end)   llamadas = llamadas.filter(l=> new Date(`${l.fecha}T23:59:59`) <= end);
  if (usuario_id) llamadas = llamadas.filter(l=> Number(l.usuario_id)===Number(usuario_id));
  if (resultado)  llamadas = llamadas.filter(l=> String(l.resultado||'').toLowerCase()===String(resultado).toLowerCase());

  const filas = llamadas.map(l=>{
    const u = usuariosIdx[l.usuario_id] || {};
    const c = clientesIdx[l.cliente_id] || {};
    return {
      usuario_id: l.usuario_id, usuario: u.nombre || `#${l.usuario_id}`,
      cliente_id: l.cliente_id, cliente: c.nombre || `#${l.cliente_id}`,
      resultado: l.resultado || '', monto_cobrado: Number(l.monto_cobrado||0),
      fecha: l.fecha, observaciones: l.observaciones || '',
      tarifa: c.tarifa || '', saldo_exigible: c.saldo_exigible || '', saldo: c.saldo || ''
    };
  }).sort((a,b)=> (a.fecha<b.fecha?1:a.fecha>b.fecha?-1:0));

  res.json(filas);
});

// ===== Ubicaciones (tracking de gestores) =====
app.post('/ubicacion',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });

  const { usuario_id, lat, lng, fecha } = req.body || {};
  if (usuario_id==null || lat==null || lng==null) return res.status(400).json({ status:'error', mensaje:'usuario_id, lat, lng requeridos' });

  const db = loadDB();
  db.ubicaciones.push({
    id: nextId(db.ubicaciones),
    empresa_id: empresaId,
    usuario_id: Number(usuario_id),
    lat: Number(lat), lng: Number(lng),
    fecha: fecha || new Date().toISOString()
  });
  saveDB(db);
  res.json({ status:'ok' });
});

app.get('/ubicaciones/ultimas',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });

  const db = loadDB();
  const usuarios = db.usuarios.filter(u=>u.empresa_id===empresaId);
  const byUser = {};
  (db.ubicaciones||[]).filter(u=>Number(u.empresa_id)===Number(empresaId)).forEach(u=>{
    const k=u.usuario_id;
    if (!byUser[k] || new Date(u.fecha)>new Date(byUser[k].fecha)) byUser[k]=u;
  });
  const resp = Object.values(byUser).map(u=>{
    const usu = usuarios.find(x=>x.id===u.usuario_id) || {};
    return { usuario_id:u.usuario_id, usuario:usu.nombre||`#${u.usuario_id}`, lat:u.lat, lng:u.lng, fecha:u.fecha };
  });
  res.json(resp);
});

app.get('/ubicaciones',(req,res)=>{
  const empresaId = getEmpresaIdFromReq(req);
  if (empresaId==null) return res.status(403).json({ status:'error', mensaje:'Sin empresa activa' });

  const { desde, hasta, usuario_id } = req.query || {};
  let start = desde ? new Date(desde) : null;
  let end   = hasta ? new Date(hasta)  : null;

  const db = loadDB();
  let lista = (db.ubicaciones||[]).filter(u=>Number(u.empresa_id)===Number(empresaId));
  if (usuario_id) lista = lista.filter(u=>Number(u.usuario_id)===Number(usuario_id));
  if (start) lista = lista.filter(u=> new Date(u.fecha)>=start);
  if (end)   lista = lista.filter(u=> new Date(u.fecha)<=end);

  res.json(lista.sort((a,b)=> new Date(b.fecha)-new Date(a.fecha)));
});

// ===== Start =====
app.listen(PORT, ()=> console.log(`Servidor en puerto ${PORT}`));
