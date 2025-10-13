/* ===========================
   public/script.js
   Multi-tenant: Admin / Gestor
   - Asignación individual y masiva
   - Reporte Admin + Exportar a Excel
   - Maps (opcional)
=========================== */

// ===== Estado global =====
let usuarioActual = null;
let esAdmin = false;
let esSuperadmin = false;
let empresaActivaId = null;

let mapInstance = null;
let directionsRendererInstance = null;

window.Maps_API_KEY = null;

// ===== Util: headers de autenticación/tenant =====
function withAuthHeaders(init = {}) {
  const u = JSON.parse(localStorage.getItem("user"));
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (u?.id !== undefined) headers["x-user-id"] = u.id;
  const act = localStorage.getItem("empresaActivaId");
  if (act) headers["x-empresa-id"] = act;
  return { ...init, headers };
}

// ====== Login (solo si usas index.html) ======
function login() {
  const nombre = document.getElementById("usuario")?.value;
  const password = document.getElementById("password")?.value;
  const messageElement = document.getElementById("login-message");
  if (!nombre || !password) { if (messageElement) messageElement.textContent = "Completa ambos campos"; return; }

  fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: nombre, password }) })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") { localStorage.setItem("user", JSON.stringify(data)); window.location.href = "/clientes.html"; }
      else if (messageElement) messageElement.textContent = data.mensaje || "Error";
    })
    .catch(() => { if (messageElement) messageElement.textContent = "Error de conexión"; });
}

function cerrarSesion() {
  localStorage.removeItem("user");
  localStorage.removeItem("empresaActivaId");
  window.location.href = "/";
}

function mostrarMensajeFlotante(mensaje) {
  const el = document.getElementById('floatingMessage');
  if (!el) return;
  el.textContent = mensaje;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

// ====== Google Maps (opcional) ======
async function ensureGoogleMapsKey() {
  if (window.google && window.google.maps) return true;
  try {
    if (!window.Maps_API_KEY) {
      const res = await fetch('/api-key');
      if (!res.ok) throw new Error('No API key configurada');
      const data = await res.json();
      if (!data?.key) throw new Error('API key inválida');
      window.Maps_API_KEY = data.key;
    }
    const old = Array.from(document.scripts).find(s => s.src.includes('maps.googleapis.com/maps/api/js'));
    if (old && !old.src.includes('key=')) { try { old.parentNode.removeChild(old); } catch(_){} }

    if (!(window.google && window.google.maps)) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.async = true; s.defer = true;
        s.src = `https://maps.googleapis.com/maps/api/js?libraries=places,geometry&key=${encodeURIComponent(window.Maps_API_KEY)}&callback=inicializarMapa`;
        s.onerror = () => reject(new Error('Fallo al cargar Google Maps'));
        window.googleMapsApiLoadedCallback = () => resolve();
        document.head.appendChild(s);
      });
    }
    return true;
  } catch {
    return false;
  }
}
function inicializarMapa() {
  if (typeof window.googleMapsApiLoadedCallback === 'function') {
    window.googleMapsApiLoadedCallback();
  }
}
window.googleMapsApiLoadedCallback = function(){
  // Si quieres auto-inicializar el mapa al abrir clientes.html, descomenta:
  // inicializarMapaManual();
};
function inicializarMapaManual() {
  if (typeof google === 'undefined' || typeof google.maps === 'undefined') return;
  const el = document.getElementById('mapa'); if (!el) return;
  if (!mapInstance) mapInstance = new google.maps.Map(el, { zoom: 12, center: { lat: 19.4326, lng: -99.1332 } });
  if (!directionsRendererInstance) directionsRendererInstance = new google.maps.DirectionsRenderer({ suppressMarkers: true });
  directionsRendererInstance.setMap(mapInstance);
}

// ====== Boot ======
window.addEventListener("load", async () => {
  const userData = JSON.parse(localStorage.getItem("user"));
  if (!userData && window.location.pathname.includes("clientes.html")) { window.location.href = "/"; return; }

  usuarioActual = userData || null;
  esAdmin = (usuarioActual?.rol === 'admin');
  esSuperadmin = (usuarioActual?.rol === 'superadmin');
  empresaActivaId = localStorage.getItem("empresaActivaId");

  await ensureGoogleMapsKey();

  if (window.location.pathname.includes("clientes.html")) {
    const span = document.getElementById("nombreUsuario");
    if (span && usuarioActual?.usuario) span.textContent = usuarioActual.usuario;

    // Superadmin: muestra módulo y pobla selector
    if (esSuperadmin) {
      document.getElementById("seccionEmpresas")?.classList.remove("hidden");
      poblarSelectorEmpresas();
    }

    const actingAsEmpresa = (esSuperadmin && !!empresaActivaId);

    if (esAdmin || actingAsEmpresa) {
      document.getElementById("seccionAdmin")?.classList.remove("hidden");
      document.getElementById("seccionAsignacion")?.classList.remove("hidden");

      // Asegura controles de Asignación Masiva si no existen en HTML
      ensureMassAssignControls();

      cargarTodosLosClientes();
      cargarUsuarios();

      // Asegura controles de Reporte si no existen en HTML
      ensureReportControls();

    } else if (!esSuperadmin) {
      if (usuarioActual?.id !== undefined) cargarClientes(usuarioActual.id);
    }
  }
});

// ===== Superadmin: empresas =====
function poblarSelectorEmpresas() {
  const select = document.getElementById('empresaActivaSelect');
  const msg = document.getElementById('empresaActivaMsg');
  fetch('/empresas', withAuthHeaders())
    .then(r => r.json())
    .then(empresas => {
      if (!Array.isArray(empresas)) throw new Error('Respuesta inválida');
      if (select) {
        select.innerHTML = '<option value="">-- Selecciona empresa --</option>';
        empresas.forEach(e => {
          const o = document.createElement('option');
          o.value = e.id; o.textContent = `#${e.id} - ${e.nombre}`;
          select.appendChild(o);
        });
        if (empresaActivaId) { select.value = String(empresaActivaId); if (msg) msg.textContent = `Empresa activa: #${empresaActivaId}`; }
      }
    })
    .catch(e => { if (msg) { msg.className='error'; msg.textContent = e.message; } });
}
function activarEmpresaParaSuperadmin() {
  const sel = document.getElementById('empresaActivaSelect');
  const msg = document.getElementById('empresaActivaMsg');
  if (!sel?.value) { if (msg) { msg.className='error'; msg.textContent='Selecciona una empresa.'; } return; }
  localStorage.setItem("empresaActivaId", sel.value);
  if (msg) { msg.className='success'; msg.textContent=`Ahora administras la empresa #${sel.value}`; }
  location.reload();
}
function salirDeEmpresaActiva() { localStorage.removeItem("empresaActivaId"); location.reload(); }

// ===== Admin: Usuarios =====
function cargarUsuarios() {
  fetch("/usuarios", withAuthHeaders())
    .then(r => r.json())
    .then(usuarios => {
      const tbody = document.querySelector("#tablaUsuarios tbody");
      if (tbody) {
        tbody.innerHTML = "";
        (usuarios || []).forEach(u => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${u.id}</td><td>${u.nombre}</td><td><button class="button-danger" onclick="eliminarUsuario(${u.id})">Eliminar</button></td>`;
          tbody.appendChild(tr);
        });
      }

      // Pobla select de Asignación Masiva si existe
      const sel = document.getElementById('massAssignUserSelect');
      if (sel) {
        sel.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        (usuarios || []).forEach(u => {
          const o = document.createElement('option');
          o.value = u.id; o.textContent = u.nombre;
          sel.appendChild(o);
        });
      }
    });
}
function agregarUsuario() {
  const nombre = document.getElementById("nuevoUsuarioNombre")?.value;
  const password = document.getElementById("nuevoUsuarioPassword")?.value;
  if (!nombre || !password) return;
  fetch("/usuarios", withAuthHeaders({ method: "POST", body: JSON.stringify({ nombre, password }) }))
    .then(r => r.json())
    .then(data => {
      if (data.status === 'ok') {
        document.getElementById("nuevoUsuarioNombre").value = '';
        document.getElementById("nuevoUsuarioPassword").value = '';
        cargarUsuarios();
        mostrarMensajeFlotante('Usuario creado');
      } else {
        alert(data.mensaje || 'Error');
      }
    });
}
function eliminarUsuario(id) {
  if (!confirm("¿Eliminar usuario?")) return;
  fetch("/usuarios/eliminar", withAuthHeaders({ method: "POST", body: JSON.stringify({ id }) }))
    .then(r => r.json())
    .then(_ => cargarUsuarios());
}

// ===== Admin: Clientes (Asignación Individual & Masiva) =====
function cargarTodosLosClientes() {
  fetch("/clientes", withAuthHeaders())
    .then(res => res.json())
    .then(all => {
      const noAsig = (all || []).filter(c => c.asignado_a === null);
      const tbody = document.querySelector("#tablaAsignarClientes tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

      // Asegurar listado de usuarios para selects (si no se cargó aún)
      fetch("/usuarios", withAuthHeaders())
        .then(r => r.json())
        .then(usuarios => {
          noAsig.forEach(c => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
              <td><input type="checkbox" class="client-checkbox" data-id="${c.id}"></td>
              <td>${c.nombre}</td><td>${c.telefono || "-"}</td><td>${c.direccion || "-"}</td>
              <td>${c.tarifa || "-"}</td><td>${c.saldo_exigible || "-"}</td><td>${c.saldo || "-"}</td>
              <td>
                <select class="usuarioSelect" data-id="${c.id}">
                  <option value="">-- Sin asignar --</option>
                  ${(usuarios || []).map(u => `<option value="${u.id}">${u.nombre}</option>`).join("")}
                </select>
              </td>`;
            tbody.appendChild(tr);
          });
        });
    });
}

function guardarAsignaciones() {
  const actualizaciones = Array.from(document.querySelectorAll("#tablaAsignarClientes .usuarioSelect"))
    .map(s => ({ id: parseInt(s.dataset.id), asignado_a: s.value ? parseInt(s.value) : null }));

  fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: actualizaciones }) }))
    .then(r => r.json())
    .then(_ => { mostrarMensajeFlotante('Asignaciones guardadas'); cargarTodosLosClientes(); });
}

function ensureMassAssignControls() {
  // Si ya existen, no hacer nada
  if (document.getElementById('massAssignUserSelect')) return;

  // Inserta UI encima de la tabla de asignación
  const seccion = document.getElementById('seccionAsignacion');
  if (!seccion) return;

  const cont = document.createElement('div');
  cont.className = 'admin-section-card';
  cont.innerHTML = `
    <h3>Asignación masiva</h3>
    <div class="form-row">
      <select id="massAssignUserSelect"><option value="">-- Seleccionar usuario --</option></select>
      <button id="massAssignBtn" class="button-purple">🚀 Asignar clientes seleccionados</button>
    </div>
    <p id="massAssignMessage" class="info"></p>
  `;
  seccion.insertBefore(cont, seccion.querySelector('div[style*="overflow-y"]'));
  document.getElementById('massAssignBtn').addEventListener('click', asignarClientesMasivamente);
}

async function asignarClientesMasivamente() {
  const sel = document.getElementById('massAssignUserSelect');
  const msg = document.getElementById('massAssignMessage');
  const btn = document.getElementById('massAssignBtn');

  const targetUserId = sel?.value ? parseInt(sel.value) : null;
  if (!targetUserId) { if (msg) { msg.className = 'error'; msg.textContent = 'Selecciona un usuario.'; } return; }

  const selected = Array.from(document.querySelectorAll('.client-checkbox:checked')).map(ch => parseInt(ch.dataset.id));
  if (selected.length === 0) { if (msg) { msg.className = 'info'; msg.textContent = 'No hay clientes seleccionados.'; } return; }

  if (!confirm(`¿Asignar ${selected.length} clientes al usuario seleccionado?`)) return;

  const payload = selected.map(id => ({ id, asignado_a: targetUserId }));
  btn.disabled = true; btn.textContent = 'Asignando...';
  if (msg) { msg.className = 'info'; msg.textContent = `Asignando ${selected.length} clientes...`; }

  try {
    const res = await fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: payload }) }));
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.mensaje || `HTTP ${res.status}`);
    if (msg) { msg.className = 'success'; msg.textContent = '✅ Asignación masiva completada.'; }
    cargarTodosLosClientes();
  } catch (e) {
    if (msg) { msg.className = 'error'; msg.textContent = `❌ ${e.message}`; }
  } finally {
    btn.disabled = false; btn.textContent = '🚀 Asignar clientes seleccionados';
  }
}

// Filtros y helpers de asignación
function filtrarClientes() {
  const filtro = (document.getElementById('filtroCliente')?.value || '').toLowerCase();
  document.querySelectorAll('#tablaAsignarClientes tbody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(filtro) ? '' : 'none';
  });
}
function toggleAllClients(cb) {
  document.querySelectorAll('#tablaAsignarClientes .client-checkbox').forEach(ch => ch.checked = cb.checked);
}

// ===== Excel (import) =====
function _norm(s){ return String(s||'').normalize("NFD").replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function _pick(row, keys){
  for (const k of keys) if (row[k] != null && String(row[k]).trim() !== '') return row[k];
  const m = {}; Object.keys(row).forEach(h => m[_norm(h)] = row[h]);
  for (const k of keys){ const nk = _norm(k); if (m[nk] != null && String(m[nk]).trim() !== '') return m[nk]; }
  return '';
}
async function procesarArchivo(event) {
  const file = event.target.files?.[0];
  const msg = document.getElementById('mensajeExcel');
  if (!file) { if (msg) { msg.className='info'; msg.textContent='Selecciona archivo'; } return; }
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const clientes = json.map(r => ({
      nombre: _pick(r, ['Nombre','Cliente','name']),
      telefono: _pick(r, ['Teléfono','Telefono','Phone','Celular']),
      direccion: _pick(r, ['Dirección','Direccion','Domicilio','Address']),
      tarifa: _pick(r, ['Tarifa','Plan','Paquete']),
      saldo_exigible: _pick(r, ['Saldo Exigible','Saldo_Exigible','Exigible']),
      saldo: _pick(r, ['Saldo','Adeudo','Deuda']),
      asignado_a: null
    })).filter(c => c.nombre);

    const res = await fetch('/cargar-clientes', withAuthHeaders({ method: 'POST', body: JSON.stringify({ clientes }) }));
    const dataRes = await res.json();
    if (res.ok && dataRes.status !== 'error') {
      if (msg) { msg.className='success'; msg.textContent = `✅ ${dataRes.mensaje}`; }
      cargarTodosLosClientes();
    } else {
      if (msg) { msg.className='error'; msg.textContent = dataRes.mensaje || 'Error'; }
    }
  } catch (e) { if (msg) { msg.className='error'; msg.textContent = e.message; } }
}
async function limpiarClientes() {
  if (!confirm('¿Eliminar TODOS los clientes de esta empresa?')) return;
  const msg = document.getElementById('mensajeExcel');
  const res = await fetch('/limpiar-clientes', withAuthHeaders({ method: 'POST' }));
  const d = await res.json();
  if (res.ok && d.status !== 'error') { if (msg) { msg.className='success'; msg.textContent = d.mensaje; } cargarTodosLosClientes(); }
  else { if (msg) { msg.className='error'; msg.textContent = d.mensaje || 'Error'; } }
}

// ===== Gestor: tabla de trabajo =====
function cargarClientes(uid) {
  fetch(`/clientes/${uid}`, withAuthHeaders())
    .then(res => res.json())
    .then(clientes => {
      const tbody = document.querySelector("#tablaClientes tbody"); if (!tbody) return;
      tbody.innerHTML = "";
      if (!Array.isArray(clientes) || clientes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10">No tienes clientes asignados</td></tr>`; return;
      }
      clientes.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${c.nombre}</td>
          <td>${c.telefono ? `<a href="tel:${c.telefono}">${c.telefono}</a>` : "-"}</td>
          <td>${c.direccion || "-"}</td>
          <td>${c.tarifa || "-"}</td>
          <td>${c.saldo_exigible || "-"}</td>
          <td>${c.saldo || "-"}</td>
          <td><input type="number" class="monto" data-id="${c.id}" /></td>
          <td>
            <select class="resultado" data-id="${c.id}">
              <option value="">Selecciona</option>
              <option value="Éxito">Éxito</option>
              <option value="En proceso">En proceso</option>
              <option value="No contestó">No contestó</option>
              <option value="Rechazado">Rechazado</option>
            </select>
          </td>
          <td><input type="text" class="observaciones" data-id="${c.id}" /></td>
          <td><button onclick="registrarLlamada(this, ${c.id})">Registrar</button></td>`;
        tbody.appendChild(tr);
      });
    });
}
function registrarLlamada(btn, clienteId) {
  const fila = btn.closest("tr");
  const monto = fila.querySelector(".monto").value || 0;
  const resultado = fila.querySelector(".resultado").value;
  const observaciones = fila.querySelector(".observaciones").value || "";
  if (!resultado) return alert("Selecciona un resultado");

  btn.disabled = true; btn.textContent = '...';
  fetch("/llamadas", withAuthHeaders({ method: "POST", body: JSON.stringify({
    cliente_id: clienteId, usuario_id: usuarioActual.id, fecha: new Date().toISOString().split("T")[0],
    monto_cobrado: monto, resultado, observaciones
  })}))
    .then(r => r.json())
    .then(d => {
      if (d.status !== 'error') { fila.remove(); }
      else { alert(d.mensaje || 'Error'); btn.disabled = false; btn.textContent = 'Registrar'; }
    })
    .catch(() => { btn.disabled = false; btn.textContent = 'Registrar'; });
}

// ===== Admin: Reporte & Export =====
function ensureReportControls() {
  // Si ya existe tabla/controles de reporte en HTML, no crear
  if (document.getElementById('tablaReporte')) return;

  // Inserta sección de reporte al final del main
  const main = document.querySelector('main.container');
  if (!main) return;

  const section = document.createElement('section');
  section.className = 'seccion-card';
  section.innerHTML = `
    <h2>Reporte General</h2>
    <div class="form-row">
      <label>Desde: <input type="date" id="repDesde"></label>
      <label>Hasta: <input type="date" id="repHasta"></label>
      <button id="btnCargarReporte" class="button-report">🔄 Mostrar</button>
      <button id="btnExportarReporte" class="button-export">📄 Exportar Excel</button>
    </div>
    <p class="report-message" id="reporteMsg"></p>
    <div style="max-height: 500px; overflow-y: auto;">
      <table id="tablaReporte">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Cliente</th>
            <th>Resultado</th>
            <th>Monto Cobrado</th>
            <th>Fecha</th>
            <th>Observaciones</th>
            <th>Tarifa</th>
            <th>Saldo Exigible</th>
            <th>Saldo</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>`;
  main.appendChild(section);

  // Set default dates: mes actual
  const d = new Date(); const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const fmt = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  document.getElementById('repDesde').value = fmt(first);
  document.getElementById('repHasta').value = fmt(d);

  document.getElementById('btnCargarReporte').addEventListener('click', cargarReporte);
  document.getElementById('btnExportarReporte').addEventListener('click', exportarReporte);
}

let _ultimoReporte = []; // cache para exportación

async function cargarReporte() {
  const desde = document.getElementById('repDesde')?.value || '';
  const hasta = document.getElementById('repHasta')?.value || '';
  const msg = document.getElementById('reporteMsg');
  const tbody = document.querySelector('#tablaReporte tbody');
  if (tbody) tbody.innerHTML = '';

  try {
    const qs = new URLSearchParams({});
    if (desde) qs.set('desde', desde);
    if (hasta) qs.set('hasta', hasta);
    const url = `/reporte${qs.toString() ? `?${qs.toString()}` : ''}`;

    const res = await fetch(url, withAuthHeaders());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data?.reporte || []);

    if (!Array.isArray(rows)) throw new Error('Formato de reporte no válido');

    _ultimoReporte = rows;

    if (rows.length === 0) {
      if (msg) { msg.className='info'; msg.textContent='Sin registros para el periodo.'; }
      return;
    }
    if (msg) { msg.className=''; msg.textContent=''; }

    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.usuario || ''}</td>
        <td>${r.cliente || ''}</td>
        <td>${r.resultado || ''}</td>
        <td>${r.monto_cobrado != null ? Number(r.monto_cobrado).toLocaleString() : ''}</td>
        <td>${r.fecha || ''}</td>
        <td>${r.observaciones || ''}</td>
        <td>${r.tarifa || ''}</td>
        <td>${r.saldo_exigible || ''}</td>
        <td>${r.saldo || ''}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    if (msg) { msg.className='error'; msg.textContent = `No se pudo cargar el reporte: ${e.message}. ¿Existe el endpoint /reporte?`; }
  }
}

function exportarReporte() {
  if (!Array.isArray(_ultimoReporte) || _ultimoReporte.length === 0) {
    alert('Carga el reporte primero.');
    return;
  }
  // Asegurar columnas en el mismo orden mostrado
  const rows = _ultimoReporte.map(r => ({
    Usuario: r.usuario || '',
    Cliente: r.cliente || '',
    Resultado: r.resultado || '',
    "Monto Cobrado": r.monto_cobrado != null ? Number(r.monto_cobrado) : 0,
    Fecha: r.fecha || '',
    Observaciones: r.observaciones || '',
    Tarifa: r.tarifa || '',
    "Saldo Exigible": r.saldo_exigible || '',
    Saldo: r.saldo || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  XLSX.writeFile(wb, `reporte_${new Date().toISOString().slice(0,10)}.xlsx`);
}
