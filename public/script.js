/* =========================================================
   public/script.js — multi-empresa estable y completo
   (fechas locales + headers corregidos)
========================================================= */

let usuarioActual = null;
let esAdmin = false;
let esSuperadmin = false;
let empresaActivaId = null;

/* ===== Utilidades ===== */

// Enviar headers de autenticación.
// x-empresa-id SOLO para superadmin o admin (evita cruces cuando entra un gestor).
function withAuthHeaders(init = {}) {
  const u = JSON.parse(localStorage.getItem("user"));
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };

  if (u?.id !== undefined) headers["x-user-id"] = u.id;

  const act = localStorage.getItem("empresaActivaId");
  if (act && (u?.rol === "superadmin" || u?.rol === "admin")) {
    headers["x-empresa-id"] = act;
  }

  return { ...init, headers };
}

function toast(msg, type = "info", idHint = "floatingMessage") {
  const el = document.getElementById(idHint) || document.getElementById("floatingMessage");
  if (!el) return;
  el.className = `toast ${type}`;
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2600);
}

async function safeJson(res) {
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return await res.json();
  } catch {
    const t = await res.text();
    return { status: "error", mensaje: `HTTP ${res.status} - ${t.slice(0, 200)}` };
  }
}

// Fecha local en formato YYYY-MM-DD (evita desfase por UTC)
function hoyLocalYMD() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function ymdLocal(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/* ===== Login / Logout ===== */
function login() {
  const usuario = document.getElementById("usuario")?.value?.trim();
  const password = document.getElementById("password")?.value?.trim();
  const msg = document.getElementById("login-message");
  if (!usuario || !password) { if (msg) msg.textContent = "Completa usuario y contraseña"; return; }

  fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, password })
  })
  .then(r => r.json())
  .then(data => {
    if (data.status === "ok") {
      localStorage.setItem("user", JSON.stringify(data));
      // Si NO es superadmin, evita heredar empresaActivaId de sesiones previas
      if (data.rol !== "superadmin") localStorage.removeItem("empresaActivaId");
      window.location.href = "/clientes.html";
    } else {
      if (msg) msg.textContent = data.mensaje || "Credenciales inválidas";
    }
  })
  .catch(() => { if (msg) msg.textContent = "Error de conexión"; });
}

function cerrarSesion() {
  localStorage.removeItem("user");
  localStorage.removeItem("empresaActivaId");
  window.location.href = "/";
}

/* ===== Boot ===== */
window.addEventListener("load", () => {
  const userData = JSON.parse(localStorage.getItem("user"));
  if (!userData && window.location.pathname.includes("clientes.html")) { window.location.href = "/"; return; }
  usuarioActual = userData || null;
  esAdmin = (usuarioActual?.rol === "admin");
  esSuperadmin = (usuarioActual?.rol === "superadmin");
  empresaActivaId = localStorage.getItem("empresaActivaId");

  if (window.location.pathname.includes("clientes.html")) {
    const span = document.getElementById("nombreUsuario");
    if (span && usuarioActual?.usuario) span.textContent = usuarioActual.usuario;

    // Superadmin: panel de empresas
    if (esSuperadmin) {
      const sec = document.getElementById("seccionEmpresas");
      if (sec) {
        sec.classList.remove("hidden");
        poblarSelectorEmpresas();
        document.getElementById('btnEntrarEmpresa')?.addEventListener('click', activarEmpresaParaSuperadmin);
        document.getElementById('btnSalirEmpresa')?.addEventListener('click', salirDeEmpresaActiva);
        document.getElementById('btnCrearEmpresa')?.addEventListener('click', crearEmpresaSuperadmin);
      }
    }

    const actingAsEmpresa = (esSuperadmin && !!empresaActivaId);
    if (esAdmin || actingAsEmpresa) {
      document.getElementById("seccionAdmin")?.classList.remove("hidden");
      document.getElementById("seccionAsignacion")?.classList.remove("hidden");
      cargarUsuarios();
      cargarTodosLosClientes();

      document.getElementById("massAssignBtn")?.addEventListener("click", asignarClientesMasivamente);
      document.getElementById("btnCargarReporte")?.addEventListener("click", cargarReporte);
      document.getElementById("btnExportarReporte")?.addEventListener("click", exportarReporte);

      // Fechas por defecto (local)
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const repDesde = document.getElementById("repDesde");
      const repHasta = document.getElementById("repHasta");
      if (repDesde) repDesde.value = ymdLocal(first);
      if (repHasta) repHasta.value = ymdLocal(d);
    }

    // Gestor
    if (!esSuperadmin && usuarioActual?.id !== undefined) {
      cargarClientes(usuarioActual.id);
    }
  }
});

/* ===== Superadmin: empresas ===== */
function poblarSelectorEmpresas() {
  const select = document.getElementById('empresaActivaSelect');
  const msg = document.getElementById('empresaActivaMsg');
  if (!select) return;

  fetch('/empresas', { method: 'GET', headers: { 'Content-Type': 'application/json', 'x-user-id': 0 } })
  .then(r => r.json())
  .then(empresas => {
    select.innerHTML = '<option value="">-- Selecciona empresa --</option>';
    (empresas || []).forEach(e => {
      const o = document.createElement('option');
      o.value = e.id; o.textContent = `#${e.id} - ${e.nombre}`;
      select.appendChild(o);
    });
    const actual = localStorage.getItem('empresaActivaId');
    if (actual) { select.value = String(actual); if (msg) { msg.className='info'; msg.textContent = `Empresa activa: #${actual}`; } }
  })
  .catch(err => { if (msg) { msg.className='error'; msg.textContent = `Error: ${err.message}`; } });
}
function activarEmpresaParaSuperadmin() {
  const sel = document.getElementById('empresaActivaSelect');
  const msg = document.getElementById('empresaActivaMsg');
  if (!sel?.value) { if (msg) { msg.className='error'; msg.textContent='Selecciona una empresa.'; } return; }
  localStorage.setItem('empresaActivaId', sel.value);
  if (msg) { msg.className='success'; msg.textContent=`Ahora administras la empresa #${sel.value}`; }
  location.reload();
}
function salirDeEmpresaActiva() {
  localStorage.removeItem('empresaActivaId');
  const msg = document.getElementById('empresaActivaMsg');
  if (msg) { msg.className='info'; msg.textContent='Sin empresa activa.'; }
  location.reload();
}
function crearEmpresaSuperadmin() {
  const nombre = document.getElementById('nuevaEmpresaNombre')?.value?.trim();
  const adminNombre = document.getElementById('nuevaEmpresaAdmin')?.value?.trim();
  const adminPass = document.getElementById('nuevaEmpresaPass')?.value?.trim();
  const msg = document.getElementById('empresaCreateMsg');

  if (!nombre || !adminNombre || !adminPass) {
    if (msg) { msg.className = 'error'; msg.textContent = 'Completa todos los campos.'; }
    return;
  }

  fetch('/empresas/crear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 0 },
    body: JSON.stringify({ nombre, admin_nombre: adminNombre, admin_password: adminPass })
  })
  .then(safeJson)
  .then(data => {
    if (data.status !== 'ok') throw new Error(data.mensaje || 'Error al crear la empresa');

    if (msg) { msg.className = 'success'; msg.textContent = `✅ ${data.mensaje}: #${data.empresa.id} - ${data.empresa.nombre}`; }

    // Limpia campos
    const n = document.getElementById('nuevaEmpresaNombre'); if (n) n.value = '';
    const an = document.getElementById('nuevaEmpresaAdmin'); if (an) an.value = '';
    const ap = document.getElementById('nuevaEmpresaPass'); if (ap) ap.value = '';

    // Repoblar el selector, seleccionar la nueva y entrar
    poblarSelectorEmpresas();
    localStorage.setItem('empresaActivaId', String(data.empresa.id));
    const m2 = document.getElementById('empresaActivaMsg');
    if (m2) { m2.className = 'success'; m2.textContent = `Ahora administras la empresa #${data.empresa.id}`; }
    setTimeout(() => location.reload(), 500);
  })
  .catch(err => {
    if (msg) { msg.className = 'error'; msg.textContent = `❌ ${err.message}`; }
  });
}

/* ===== Usuarios (admin) ===== */
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
      const sel = document.getElementById("massAssignUserSelect");
      if (sel) {
        sel.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        (usuarios || []).forEach(u => {
          const o = document.createElement("option");
          o.value = String(u.id);
          o.textContent = u.nombre;
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
    .then(d => {
      if (d.status === "ok") {
        document.getElementById("nuevoUsuarioNombre").value = "";
        document.getElementById("nuevoUsuarioPassword").value = "";
        cargarUsuarios();
        toast("Usuario creado", "success");
      } else {
        toast(d.mensaje || "Error al crear", "error");
      }
    });
}
function eliminarUsuario(id) {
  if (!confirm("¿Eliminar usuario?")) return;
  fetch("/usuarios/eliminar", withAuthHeaders({ method: "POST", body: JSON.stringify({ id }) }))
    .then(() => cargarUsuarios());
}

/* ===== Clientes (admin) ===== */
function cargarTodosLosClientes() {
  fetch("/clientes", withAuthHeaders())
    .then(res => res.json())
    .then(all => {
      const noAsig = (all || []).filter(c => c.asignado_a === null);
      const tbody = document.querySelector("#tablaAsignarClientes tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

      fetch("/usuarios", withAuthHeaders())
        .then(r => r.json())
        .then(users => {
          noAsig.forEach(c => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
              <td><input type="checkbox" class="client-checkbox" data-id="${c.id}"></td>
              <td>${c.nombre}</td>
              <td>${c.telefono || "-"}</td>
              <td>${c.direccion || "-"}</td>
              <td>${c.tarifa || "-"}</td>
              <td>${c.saldo_exigible || "-"}</td>
              <td>${c.saldo || "-"}</td>
              <td>
                <select class="usuarioSelect" data-id="${c.id}">
                  <option value="">-- Sin asignar --</option>
                  ${(users || []).map(u => `<option value="${u.id}">${u.nombre}</option>`).join("")}
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
    .then(() => { toast("Asignaciones guardadas", "success"); cargarTodosLosClientes(); });
}

/* ===== Asignación MASIVA ===== */
async function asignarClientesMasivamente(ev) {
  const sel = document.getElementById("massAssignUserSelect");
  const msg = document.getElementById("massAssignMessage");
  const btn = ev?.target || document.getElementById("massAssignBtn");

  const targetId = sel?.value ? parseInt(sel.value) : null;
  if (!targetId || Number.isNaN(targetId)) { if (msg){ msg.className='error'; msg.textContent='Selecciona un usuario.'; } return; }

  const ids = Array.from(document.querySelectorAll(".client-checkbox:checked"))
              .map(ch => parseInt(ch.dataset.id))
              .filter(n => !Number.isNaN(n));
  if (!ids.length) { if (msg){ msg.className='info'; msg.textContent='No hay clientes seleccionados.'; } return; }

  if (!confirm(`¿Asignar ${ids.length} clientes al gestor #${targetId}?`)) return;

  if (btn) { btn.disabled = true; btn.textContent = "Asignando..."; }
  if (msg) { msg.className = "info"; msg.textContent = `Asignando ${ids.length} clientes...`; }

  try {
    const res = await fetch("/actualizar-clientes", withAuthHeaders({
      method: "POST",
      body: JSON.stringify({ clienteIds: ids, asignado_a: targetId })
    }));
    const data = await safeJson(res);
    if (!res.ok || data.status === "error") throw new Error(data.mensaje || `HTTP ${res.status}`);

    if (msg) { msg.className = "success"; msg.textContent = `✅ ${data.mensaje || 'Asignación completada'}`; }
    cargarTodosLosClientes();
  } catch (e) {
    if (msg) { msg.className = "error"; msg.textContent = `❌ ${e.message}`; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🚀 Asignar Clientes Seleccionados"; }
  }
}

/* ===== Importar Excel ===== */
async function procesarArchivo(event) {
  const file = event.target.files?.[0];
  const msg = document.getElementById("mensajeExcel");
  if (!file) { if (msg) { msg.className = "info"; msg.textContent = "Selecciona archivo"; } return; }

  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const _norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const _pick = (row, keys) => {
      for (const k of keys) if (row[k] != null && String(row[k]).trim() !== "") return row[k];
      const m = {}; Object.keys(row).forEach(h => m[_norm(h)] = row[h]);
      for (const k of keys) { const nk = _norm(k); if (m[nk] != null && String(m[nk]).trim() !== "") return m[nk]; }
      return "";
    };

    const clientes = json.map(r => ({
      nombre: _pick(r, ["Nombre","Cliente","name"]),
      telefono: _pick(r, ["Teléfono","Telefono","Phone","Celular"]),
      direccion: _pick(r, ["Dirección","Direccion","Domicilio","Address"]),
      tarifa: _pick(r, ["Tarifa","Plan","Paquete"]),
      saldo_exigible: _pick(r, ["Saldo Exigible","Saldo_Exigible","Exigible"]),
      saldo: _pick(r, ["Saldo","Adeudo","Deuda"]),
      asignado_a: null
    })).filter(c => c.nombre);

    if (!clientes.length) { if (msg) { msg.className = "error"; msg.textContent = "El archivo no contiene clientes válidos."; } return; }

    const res = await fetch("/cargar-clientes", withAuthHeaders({
      method: "POST",
      headers: { "Content-Type": "application/json", ...(withAuthHeaders().headers || {}) },
      body: JSON.stringify({ clientes })
    }));

    const dataRes = await safeJson(res);
    if (!res.ok || dataRes.status === "error") {
      const tip = res.status === 403 ? " (Si eres superadmin, primero ENTRA a una empresa.)" : "";
      if (msg) { msg.className = "error"; msg.textContent = (dataRes.mensaje || `Error ${res.status}`) + tip; }
      return;
    }

    if (msg) { msg.className = "success"; msg.textContent = `✅ ${dataRes.mensaje}`; }
    cargarTodosLosClientes();
  } catch (e) {
    if (msg) { msg.className = "error"; msg.textContent = e.message || "Error procesando el archivo."; }
  }
}
async function limpiarClientes() {
  if (!confirm("¿Eliminar TODOS los clientes de esta empresa?")) return;
  const msg = document.getElementById("mensajeExcel");
  try {
    const res = await fetch("/limpiar-clientes", withAuthHeaders({ method: "POST" }));
    const d = await safeJson(res);
    if (!res.ok || d.status === "error") throw new Error(d.mensaje || `HTTP ${res.status}`);
    if (msg) { msg.className = "success"; msg.textContent = d.mensaje || "Eliminados"; }
    cargarTodosLosClientes();
  } catch (e) { if (msg) { msg.className = "error"; msg.textContent = e.message; } }
}

/* ===== Gestor ===== */
function cargarClientes(uid) {
  fetch(`/clientes/${uid}`, withAuthHeaders())
    .then(res => res.json())
    .then(clientes => {
      const tbody = document.querySelector("#tablaClientes tbody");
      if (!tbody) return;
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

  btn.disabled = true; btn.textContent = "...";
  fetch("/llamadas", withAuthHeaders({
    method: "POST",
    body: JSON.stringify({
      cliente_id: clienteId,
      usuario_id: usuarioActual.id,
      fecha: hoyLocalYMD(), // fecha local
      monto_cobrado: monto,
      resultado,
      observaciones
    })
  }))
    .then(r => r.json())
    .then(d => {
      if (d.status !== "error") { fila.remove(); }
      else { alert(d.mensaje || "Error"); btn.disabled = false; btn.textContent = "Registrar"; }
    })
    .catch(() => { btn.disabled = false; btn.textContent = "Registrar"; });
}

/* ===== Filtros ===== */
function filtrarClientes() {
  const filtro = (document.getElementById("filtroCliente")?.value || "").toLowerCase();
  document.querySelectorAll("#tablaAsignarClientes tbody tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(filtro) ? "" : "none";
  });
}
function toggleAllClients(cb) {
  document.querySelectorAll("#tablaAsignarClientes .client-checkbox").forEach(ch => ch.checked = cb.checked);
}

/* ===== Reporte & Export ===== */
let _ultimoReporte = [];
async function cargarReporte() {
  const desde = document.getElementById("repDesde")?.value || "";
  const hasta = document.getElementById("repHasta")?.value || "";
  const msg = document.getElementById("reporteMsg");
  const tbody = document.querySelector("#tablaReporte tbody");
  if (tbody) tbody.innerHTML = "";

  try {
    const qs = new URLSearchParams({});
    if (desde) qs.set("desde", desde);
    if (hasta) qs.set("hasta", hasta);

    const res = await fetch(`/reporte${qs.toString() ? `?${qs.toString()}` : ""}`, withAuthHeaders());
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.mensaje || `HTTP ${res.status}`);

    const rows = Array.isArray(data) ? data : (data?.reporte || []);
    _ultimoReporte = rows;

    if (!rows.length) { if (msg) { msg.className = "info"; msg.textContent = "Sin registros en el periodo."; } return; }
    if (msg) msg.textContent = "";

    rows.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.usuario || ""}</td>
        <td>${r.cliente || ""}</td>
        <td>${r.resultado || ""}</td>
        <td>${r.monto_cobrado != null ? Number(r.monto_cobrado).toLocaleString() : ""}</td>
        <td>${r.fecha || ""}</td>
        <td>${r.observaciones || ""}</td>
        <td>${r.tarifa || ""}</td>
        <td>${r.saldo_exigible || ""}</td>
        <td>${r.saldo || ""}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    if (msg) { msg.className = "error"; msg.textContent = e.message; }
  }
}
function exportarReporte() {
  if (!Array.isArray(_ultimoReporte) || !_ultimoReporte.length) { alert("Primero carga el reporte."); return; }
  const rows = _ultimoReporte.map(r => ({
    Usuario: r.usuario || "",
    Cliente: r.cliente || "",
    Resultado: r.resultado || "",
    "Monto Cobrado": r.monto_cobrado != null ? Number(r.monto_cobrado) : 0,
    Fecha: r.fecha || "",
    Observaciones: r.observaciones || "",
    Tarifa: r.tarifa || "",
    "Saldo Exigible": r.saldo_exigible || "",
    Saldo: r.saldo || ""
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reporte");
  XLSX.writeFile(wb, `reporte_${hoyLocalYMD()}.xlsx`);
}

/* ===== Mapa (placeholder opcional para evitar errores si no hay API Key) ===== */
let mapInstance = null, directionsRendererInstance = null;
function inicializarMapaManual() {
  const el = document.getElementById('mapa');
  if (el && !el.dataset.inited) { el.dataset.inited = '1'; el.innerHTML = '<div style="padding:12px;">Mapa cargado (demo)</div>'; }
}
