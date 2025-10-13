/* =========================================
   public/script.js – estable y enfocado
   - Subida de clientes por empresa
   - Asignación MASIVA robusta
   - Reporte + Exportar a Excel
========================================= */

// ====== Estado global ======
let usuarioActual = null;
let esAdmin = false;
let esSuperadmin = false;
let empresaActivaId = null;

// ====== Utilidades ======
function withAuthHeaders(init = {}) {
  const u = JSON.parse(localStorage.getItem("user"));
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (u?.id !== undefined) headers["x-user-id"] = u.id;
  const act = localStorage.getItem("empresaActivaId");
  if (act) headers["x-empresa-id"] = act;
  return { ...init, headers };
}

function showToast(msg, type = "info") {
  const el = document.getElementById("mensajeExcel") || document.getElementById("floatingMessage");
  if (!el) return;
  el.className = type; // usa tus clases .info .success .error si existen
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2600);
}

// Parseo seguro (evita "Unexpected token <")
async function safeJson(res) {
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return await res.json(); // puede lanzar; lo capturamos abajo
  } catch {
    const t = await res.text();
    return { status: "error", mensaje: `HTTP ${res.status} - ${t.slice(0, 200)}` };
  }
}

// ====== Login / Logout ======
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

// ====== Inicio ======
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

    // Si es Admin o Superadmin actuando como empresa, habilita paneles
    const actingAsEmpresa = (esSuperadmin && !!empresaActivaId);
    if (esAdmin || actingAsEmpresa) {
      document.getElementById("seccionAdmin")?.classList.remove("hidden");
      document.getElementById("seccionAsignacion")?.classList.remove("hidden");
      ensureMassAssignControls();
      ensureReportControls();
      cargarUsuarios();
      cargarTodosLosClientes(); // clientes sin asignar para tabla de asignación
    }

    // Gestor: su bandeja
    if (!esSuperadmin && usuarioActual?.id !== undefined) {
      cargarClientes(usuarioActual.id);
    }
  }
});

// ====== Admin: Usuarios ======
function cargarUsuarios() {
  fetch("/usuarios", withAuthHeaders())
    .then(r => r.json())
    .then(usuarios => {
      // Tabla de usuarios (si existe)
      const tbody = document.querySelector("#tablaUsuarios tbody");
      if (tbody) {
        tbody.innerHTML = "";
        (usuarios || []).forEach(u => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${u.id}</td><td>${u.nombre}</td><td><button class="button-danger" onclick="eliminarUsuario(${u.id})">Eliminar</button></td>`;
          tbody.appendChild(tr);
        });
      }
      // Select de asignación masiva (si existe)
      const sel = document.getElementById("massAssignUserSelect");
      if (sel) {
        sel.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        (usuarios || []).forEach(u => {
          const o = document.createElement("option");
          o.value = String(u.id);   // SIEMPRE ID
          o.textContent = u.nombre; // etiqueta
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
        showToast("Usuario creado", "success");
      } else {
        showToast(d.mensaje || "Error al crear", "error");
      }
    });
}

function eliminarUsuario(id) {
  if (!confirm("¿Eliminar usuario?")) return;
  fetch("/usuarios/eliminar", withAuthHeaders({ method: "POST", body: JSON.stringify({ id }) }))
    .then(() => cargarUsuarios());
}

// ====== Admin: Clientes (lista sin asignar) ======
function cargarTodosLosClientes() {
  fetch("/clientes", withAuthHeaders())
    .then(res => res.json())
    .then(all => {
      const noAsig = (all || []).filter(c => c.asignado_a === null);
      const tbody = document.querySelector("#tablaAsignarClientes tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

      // Carga usuarios para options 1×1
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

// ====== Asignación 1×1 (ya la tienes) ======
function guardarAsignaciones() {
  const actualizaciones = Array.from(document.querySelectorAll("#tablaAsignarClientes .usuarioSelect"))
    .map(s => ({ id: parseInt(s.dataset.id), asignado_a: s.value ? parseInt(s.value) : null }));

  fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: actualizaciones }) }))
    .then(r => r.json())
    .then(() => { showToast("Asignaciones guardadas", "success"); cargarTodosLosClientes(); });
}

// ====== Asignación MASIVA ======
function ensureMassAssignControls() {
  if (document.getElementById("massAssignUserSelect")) return; // ya existen

  const seccion = document.getElementById("seccionAsignacion");
  if (!seccion) return;

  const cont = document.createElement("div");
  cont.className = "admin-section-card";
  cont.innerHTML = `
    <div class="form-row">
      <select id="massAssignUserSelect"><option value="">-- Seleccionar usuario --</option></select>
      <button id="massAssignBtn" class="button-purple">🚀 Asignar seleccionados</button>
    </div>
    <p id="massAssignMessage" class="info"></p>
  `;
  const before = seccion.querySelector('div[style*="overflow-y"]');
  seccion.insertBefore(cont, before || seccion.firstChild);

  // Listener que pasa el botón como "this" para evitar null
  document.getElementById("massAssignBtn").addEventListener("click", (ev) => asignarClientesMasivamente(ev.target));
}

async function asignarClientesMasivamente(btnEl) {
  const msg = document.getElementById("massAssignMessage");
  const sel = document.getElementById("massAssignUserSelect");
  if (!sel) { showToast("No hay selector de usuario", "error"); return; }

  const val = sel.value;
  const targetUserId = /^\d+$/.test(val) ? parseInt(val) : null; // solo ID
  if (!targetUserId) { if (msg) { msg.className = "error"; msg.textContent = "Selecciona un usuario válido."; } return; }

  const selected = Array.from(document.querySelectorAll(".client-checkbox:checked")).map(ch => parseInt(ch.dataset.id));
  if (selected.length === 0) { if (msg) { msg.className = "info"; msg.textContent = "No hay clientes seleccionados."; } return; }

  if (!confirm(`¿Asignar ${selected.length} clientes al usuario #${targetUserId}?`)) return;

  const payload = selected.map(id => ({ id, asignado_a: targetUserId }));

  // Evita error "Cannot set properties of null"
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Asignando..."; }
  if (msg) { msg.className = "info"; msg.textContent = `Asignando ${selected.length} clientes...`; }

  try {
    const res = await fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: payload }) }));
    const data = await safeJson(res);
    if (!res.ok || data.status === "error") throw new Error(data.mensaje || `HTTP ${res.status}`);
    if (msg) { msg.className = "success"; msg.textContent = "✅ Asignación masiva completada."; }
    cargarTodosLosClientes();
  } catch (e) {
    if (msg) { msg.className = "error"; msg.textContent = `❌ ${e.message}`; }
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = "🚀 Asignar seleccionados"; }
  }
}

// ====== Importar Excel (empresa activa) ======
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

    // Importar
    const res = await fetch("/cargar-clientes", withAuthHeaders({
      method: "POST",
      headers: { "Content-Type": "application/json", ...(withAuthHeaders().headers || {}) },
      body: JSON.stringify({ clientes })
    }));

    const dataRes = await safeJson(res);
    if (!res.ok || dataRes.status === "error") {
      const tip = res.status === 403 ? " (Si eres superadmin, primero ENTRA a una empresa)." : "";
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
  } catch (e) {
    if (msg) { msg.className = "error"; msg.textContent = e.message; }
  }
}

// ====== Gestor: bandeja (ver clientes asignados & registrar) ======
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
      fecha: new Date().toISOString().split("T")[0],
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

// ====== Reporte (admin) + Exportar Excel ======
function ensureReportControls() {
  if (document.getElementById("tablaReporte")) return;

  const main = document.querySelector("main.container");
  if (!main) return;

  const section = document.createElement("section");
  section.className = "seccion-card";
  section.innerHTML = `
    <h2>Reporte de Gestiones</h2>
    <div class="form-row">
      <label>Desde: <input type="date" id="repDesde"></label>
      <label>Hasta: <input type="date" id="repHasta"></label>
      <button id="btnCargarReporte" class="button-report">🔄 Mostrar</button>
      <button id="btnExportarReporte" class="button-export">📄 Exportar Excel</button>
    </div>
    <p id="reporteMsg" class="info"></p>
    <div style="max-height: 420px; overflow-y:auto;">
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

  const d = new Date(); const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const fmt = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  document.getElementById("repDesde").value = fmt(first);
  document.getElementById("repHasta").value = fmt(d);

  document.getElementById("btnCargarReporte").addEventListener("click", cargarReporte);
  document.getElementById("btnExportarReporte").addEventListener("click", exportarReporte);
}

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
    if (msg) { msg.textContent = ""; }

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
  XLSX.writeFile(wb, `reporte_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ====== Filtros de la tabla de asignación (opcional) ======
function filtrarClientes() {
  const filtro = (document.getElementById("filtroCliente")?.value || "").toLowerCase();
  document.querySelectorAll("#tablaAsignarClientes tbody tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(filtro) ? "" : "none";
  });
}
function toggleAllClients(cb) {
  document.querySelectorAll("#tablaAsignarClientes .client-checkbox").forEach(ch => ch.checked = cb.checked);
}
