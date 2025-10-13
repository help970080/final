/* =========================================================
   public/script.js — versión estable y simple
   Funciones:
   - Login / Logout
   - Subir clientes (Excel) por empresa
   - Gestionar usuarios (agregar / eliminar)
   - Asignación 1×1 y MASIVA de clientes a gestores
   - Bandeja de gestor (registrar llamadas)
   - Reporte de gestiones + Exportar Excel
   Notas:
   - Requiere endpoints: /login, /usuarios, /usuarios/eliminar, /clientes,
     /clientes/:uid, /cargar-clientes, /limpiar-clientes,
     /actualizar-clientes, /llamadas, /reporte
   - Usa encabezados multi-tenant: x-user-id y x-empresa-id
========================================================= */

/* ====== Estado global ====== */
let usuarioActual = null;
let esAdmin = false;
let esSuperadmin = false;
let empresaActivaId = null;

/* ====== Utilidades ====== */
function withAuthHeaders(init = {}) {
  const u = JSON.parse(localStorage.getItem("user"));
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (u?.id !== undefined) headers["x-user-id"] = u.id;
  const act = localStorage.getItem("empresaActivaId");
  if (act) headers["x-empresa-id"] = act;
  return { ...init, headers };
}

function toast(msg, type = "info", idHint = "mensajeExcel") {
  const el = document.getElementById(idHint) || document.getElementById("floatingMessage");
  if (!el) return;
  el.className = type;     // usa .info / .success / .error si las tienes
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2500);
}

// Parseo seguro (si vuelve HTML por 502/403 no truena)
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

/* ====== Login / Logout ====== */
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

/* ====== Inicio ====== */
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

    // Admin o Superadmin actuando como empresa
    const actingAsEmpresa = (esSuperadmin && !!empresaActivaId);
    if (esAdmin || actingAsEmpresa) {
      document.getElementById("seccionAdmin")?.classList.remove("hidden");
      document.getElementById("seccionAsignacion")?.classList.remove("hidden");
      cargarUsuarios();
      cargarTodosLosClientes(); // para la tabla de asignación
      // listeners UI existentes en tu HTML
      const massBtn = document.getElementById("massAssignBtn");
      if (massBtn) massBtn.addEventListener("click", asignarClientesMasivamente);
    }

    // Gestor: su bandeja
    if (!esSuperadmin && usuarioActual?.id !== undefined) {
      cargarClientes(usuarioActual.id);
    }
  }
});

/* ====== Admin: Usuarios ====== */
function cargarUsuarios() {
  fetch("/usuarios", withAuthHeaders())
    .then(r => r.json())
    .then(usuarios => {
      // Tabla
      const tbody = document.querySelector("#tablaUsuarios tbody");
      if (tbody) {
        tbody.innerHTML = "";
        (usuarios || []).forEach(u => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${u.id}</td><td>${u.nombre}</td><td><button class="button-danger" onclick="eliminarUsuario(${u.id})">Eliminar</button></td>`;
          tbody.appendChild(tr);
        });
      }
      // Select de masiva
      const sel = document.getElementById("massAssignUserSelect");
      if (sel) {
        sel.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        (usuarios || []).forEach(u => {
          const o = document.createElement("option");
          o.value = String(u.id);   // valor = ID (requerido por backend)
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

/* ====== Admin: Clientes (lista sin asignar) ====== */
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

/* ====== Asignación 1×1 (ya existía) ====== */
function guardarAsignaciones() {
  const actualizaciones = Array.from(document.querySelectorAll("#tablaAsignarClientes .usuarioSelect"))
    .map(s => ({ id: parseInt(s.dataset.id), asignado_a: s.value ? parseInt(s.value) : null }));

  fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: actualizaciones }) }))
    .then(r => r.json())
    .then(() => { toast("Asignaciones guardadas", "success"); cargarTodosLosClientes(); });
}

/* ====== Asignación MASIVA ====== */
async function asignarClientesMasivamente(ev) {
  const sel = document.getElementById("massAssignUserSelect");
  const msg = document.getElementById("massAssignMessage");
  const btn = ev?.target || document.getElementById("massAssignBtn");

  const targetId = sel?.value ? parseInt(sel.value) : null;
  if (targetId == null || Number.isNaN(targetId)) { if (msg){ msg.className='error'; msg.textContent='Selecciona un usuario.'; } return; }

  const ids = Array.from(document.querySelectorAll(".client-checkbox:checked"))
              .map(ch => parseInt(ch.dataset.id))
              .filter(n => !Number.isNaN(n));
  if (ids.length === 0) { if (msg){ msg.className='info'; msg.textContent='No hay clientes seleccionados.'; } return; }

  if (!confirm(`¿Asignar ${ids.length} clientes al gestor #${targetId}?`)) return;

  if (btn) { btn.disabled = true; btn.textContent = "Asignando..."; }
  if (msg) { msg.className = "info"; msg.textContent = `Asignando ${ids.length} clientes...`; }

  try {
    // Usa el formato masivo que tu backend soporta: { clienteIds, asignado_a }
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

/* ====== Importar Excel (empresa activa) ====== */
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
  } catch (e) {
    if (msg) { msg.className = "error"; msg.textContent = e.message; }
  }
}

/* ====== Gestor: bandeja (ver asignados & registrar llamadas) ====== */
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

/* ====== Filtros de asignación ====== */
function filtrarClientes() {
  const filtro = (document.getElementById("filtroCliente")?.value || "").toLowerCase();
  document.querySelectorAll("#tablaAsignarClientes tbody tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(filtro) ? "" : "none";
  });
}
function toggleAllClients(cb) {
  document.querySelectorAll("#tablaAsignarClientes .client-checkbox").forEach(ch => ch.checked = cb.checked);
}
