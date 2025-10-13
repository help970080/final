// public/script.js (multi-tenant + superadmin empresa activa + Excel + Objetivos + KPIs semáforo)
let usuarioActual = null;
let esAdmin = false;          // admin de empresa
let esSuperadmin = false;     // superadmin global
let empresaActivaId = null;   // para superadmin "entrar como" empresa
let mapInstance = null;
let directionsRendererInstance = null;
let usuariosParaAsignacionMasiva = [];
let gestoresMarkers = [];

window.Maps_API_KEY = null;

/* =========================================
   Google Maps con API key (carga robusta)
   ========================================= */
async function ensureGoogleMapsKey() {
  if (window.google && window.google.maps) return true;
  try {
    if (!window.Maps_API_KEY) {
      const res = await fetch('/api-key');
      if (!res.ok) throw new Error('No API key configurada en el backend');
      const data = await res.json();
      if (!data?.key) throw new Error('Respuesta /api-key inválida');
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
  } catch (e) {
    console.error("No se pudo cargar Google Maps:", e);
    return false;
  }
}
function inicializarMapa() {
  if (typeof window.googleMapsApiLoadedCallback === 'function') {
    window.googleMapsApiLoadedCallback();
  }
}

/* =========================================
   Auth & Headers
   ========================================= */
function withAuthHeaders(init = {}) {
  const u = JSON.parse(localStorage.getItem("user"));
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (u?.id !== undefined) headers["x-user-id"] = u.id;
  const act = localStorage.getItem("empresaActivaId");
  if (act) headers["x-empresa-id"] = act; // clave para evitar 403 en superadmin
  return { ...init, headers };
}

function login() {
  const nombre = document.getElementById("usuario")?.value;
  const password = document.getElementById("password")?.value;
  const messageElement = document.getElementById("login-message");
  if (!nombre || !password) { if (messageElement) messageElement.textContent = "Por favor complete ambos campos"; return; }
  if (messageElement) messageElement.textContent = "";

  fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: nombre, password }) })
    .then(res => { if (!res.ok) throw new Error(`Error HTTP: ${res.status}`); return res.json(); })
    .then(data => {
      if (data.status === "ok") {
        localStorage.setItem("user", JSON.stringify(data));
        window.location.href = "/clientes.html";
      } else {
        if (messageElement) messageElement.textContent = data.mensaje || "Error al iniciar sesión";
      }
    })
    .catch(err => {
      console.error("Error en login:", err);
      if (messageElement) messageElement.textContent = "Error de conexión con el servidor";
    });
}

window.googleMapsApiLoadedCallback = function() {
  if (window.location.pathname.includes("clientes.html")) {
    const actingAsEmpresa = !!localStorage.getItem("empresaActivaId");
    if (esAdmin || (!esSuperadmin) || (esSuperadmin && actingAsEmpresa)) {
      inicializarMapaManual();
    }
  }
};

function mostrarMensajeFlotante(mensaje) {
  const el = document.getElementById('floatingMessage');
  if (!el) return;
  el.textContent = mensaje;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

/* =========================================
   Boot
   ========================================= */
window.addEventListener("load", async () => {
  const userData = JSON.parse(localStorage.getItem("user"));
  if (!userData && window.location.pathname.includes("clientes.html")) {
    window.location.href = "/";
    return;
  }
  usuarioActual = userData || null;
  esAdmin = (usuarioActual?.rol === 'admin');
  esSuperadmin = (usuarioActual?.rol === 'superadmin');
  empresaActivaId = localStorage.getItem("empresaActivaId");

  await ensureGoogleMapsKey();

  if (window.location.pathname.includes("clientes.html")) {
    const span = document.getElementById("nombreUsuario");
    if (span && usuarioActual?.usuario) span.textContent = usuarioActual.usuario;
    mostrarMensajeFlotante("Hecho con 🧡 por Leonardo Luna");

    const inputFecha = document.getElementById('fechaInicioBonos');
    if (inputFecha) {
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      inputFecha.value = `${firstDay.getFullYear()}-${String(firstDay.getMonth()+1).padStart(2,'0')}-${String(firstDay.getDate()).padStart(2,'0')}`;
    }

    // SUPERADMIN: muestra módulo y selector de empresa
    if (esSuperadmin) {
      document.getElementById("seccionEmpresas")?.classList.remove("hidden");
      poblarSelectorEmpresas();
    }

    const actingAsEmpresa = (esSuperadmin && !!empresaActivaId);
    if (esAdmin || actingAsEmpresa) {
      document.getElementById("seccionAdmin")?.classList.remove("hidden");
      document.getElementById("seccionAsignacion")?.classList.remove("hidden");
      cargarTodosLosClientes();
      cargarUsuarios();
      if (typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
      if (typeof cargarObjetivos === 'function') cargarObjetivos();
    } else if (!esSuperadmin) {
      // GESTOR
      document.getElementById("seccionAdmin")?.classList.add("hidden");
      document.getElementById("seccionAsignacion")?.classList.add("hidden");
      if (usuarioActual?.id !== undefined) cargarClientes(usuarioActual.id);
      solicitarYEnviarUbicacion();
      setInterval(solicitarYEnviarUbicacion, 30 * 60 * 1000);
    } else {
      // Superadmin sin empresa activa
      document.getElementById("seccionAdmin")?.classList.add("hidden");
      document.getElementById("seccionAsignacion")?.classList.add("hidden");
    }
  }
});

/* =========================================
   Superadmin: seleccionar empresa activa
   ========================================= */
function poblarSelectorEmpresas() {
  const select = document.getElementById('empresaActivaSelect');
  const msg = document.getElementById('empresaActivaMsg');
  if (!select) return;
  fetch('/empresas', withAuthHeaders())
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(empresas => {
      if (!Array.isArray(empresas)) throw new Error("Respuesta /empresas no es lista");
      select.innerHTML = '<option value="">-- Selecciona empresa --</option>';
      empresas.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `#${e.id} - ${e.nombre}`;
        select.appendChild(opt);
      });
      if (empresaActivaId) {
        select.value = String(empresaActivaId);
        if (msg) msg.textContent = `Empresa activa: #${empresaActivaId}`;
      } else {
        if (msg) msg.textContent = 'Selecciona una empresa para administrar.';
      }
    })
    .catch(e => { if (msg) { msg.className='error'; msg.textContent=e.message; } });
}

function activarEmpresaParaSuperadmin() {
  const sel = document.getElementById('empresaActivaSelect');
  const msg = document.getElementById('empresaActivaMsg');
  const val = sel?.value;
  if (!val) { if (msg) { msg.className='error'; msg.textContent='Selecciona una empresa.'; } return; }
  localStorage.setItem("empresaActivaId", val);
  empresaActivaId = val;
  if (msg) { msg.className='success'; msg.textContent=`Ahora administras la empresa #${val}`; }
  location.reload();
}

function salirDeEmpresaActiva() {
  const msg = document.getElementById('empresaActivaMsg');
  localStorage.removeItem("empresaActivaId");
  empresaActivaId = null;
  if (msg) { msg.className='info'; msg.textContent='Saliste del modo empresa.'; }
  location.reload();
}

/* =========================================
   Gestor: clientes asignados (tabla principal)
   ========================================= */
function cargarClientes(usuarioId) {
  fetch(`/clientes/${usuarioId}`, withAuthHeaders())
    .then(res => { if (!res.ok) throw new Error(`Error ${res.status}`); return res.json(); })
    .then(clientes => {
      if (!Array.isArray(clientes)) throw new Error("Respuesta /clientes/:usuarioId no es lista");
      const tbody = document.querySelector("#tablaClientes tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      if (clientes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10">No tienes clientes asignados</td></tr>`;
        return;
      }
      clientes.forEach(cliente => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${cliente.nombre}</td>
          <td>${cliente.telefono ? `<a href="tel:${cliente.telefono}" class="telefono-link">${cliente.telefono}</a> <button onclick="enviarWhatsapp('${cliente.telefono}', '${cliente.nombre}')" class="btn-whatsapp">💬 WhatsApp</button>` : "-"}</td>
          <td>${cliente.direccion || "-"} <button onclick="geocodificarCliente(${cliente.id}, this)" class="btn-geo">🌍 Geolocalizar</button>
            <span id="geo-status-${cliente.id}" class="geo-status">${cliente.lat && cliente.lng ? `✓ Ubicada <button onclick="abrirEnGoogleMaps(${cliente.lat}, ${cliente.lng})" class="btn-map-shortcut">Ver en Mapa</button>` : ''}</span>
          </td>
          <td>${cliente.tarifa || "-"}</td>
          <td>${cliente.saldo_exigible || "-"}</td>
          <td>${cliente.saldo || "-"}</td>
          <td><input type="number" class="monto" data-id="${cliente.id}" /></td>
          <td>
            <select class="resultado" data-id="${cliente.id}">
              <option value="">Selecciona</option>
              <option value="Éxito">Éxito</option>
              <option value="En proceso">En proceso</option>
              <option value="No contestó">No contestó</option>
              <option value="Rechazado">Rechazado</option>
            </select>
          </td>
          <td><input type="text" class="observaciones" data-id="${cliente.id}" /></td>
          <td><button onclick="registrarLlamada(this, ${cliente.id})">Registrar</button></td>`;
        tbody.appendChild(tr);
      });
    })
    .catch(err => {
      console.error("Error al cargar clientes:", err);
      const tbody = document.querySelector("#tablaClientes tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="error">Error al cargar clientes.</td></tr>`;
    });
}

function enviarWhatsapp(telefono, nombreCliente) {
  if (!telefono) return alert("El cliente no tiene teléfono.");
  let numero = telefono.replace(/\D/g, '');
  if (!numero.startsWith('52') && numero.length === 10) numero = '52' + numero;
  const mensaje = encodeURIComponent(`Hola ${nombreCliente},\nLe escribo de su compañía de gestión de cobranza...`);
  window.open(`https://wa.me/${numero}?text=${mensaje}`, '_blank');
}

async function geocodificarCliente(clienteId, boton) {
  const fila = boton.closest('tr');
  const celdas = fila.querySelectorAll('td');
  let direccion = celdas[2].textContent.split('🌍')[0].trim();
  const statusElement = document.getElementById(`geo-status-${clienteId}`);
  const botonGeo = fila.querySelector('.btn-geo');
  if (!direccion || direccion === "-") { statusElement.textContent = "Sin dirección"; statusElement.className = "geo-status geo-error"; return; }

  direccion = direccion.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/,+/g, ',').trim();
  statusElement.textContent = "Buscando coordenadas...";
  statusElement.className = "geo-status geo-loading";
  botonGeo.disabled = true; botonGeo.innerHTML = '⌛ Procesando';

  try {
    const response = await fetch('/actualizar-coordenadas', withAuthHeaders({ method: 'POST', body: JSON.stringify({ clienteId, direccion }) }));
    const data = await response.json();
    if (data.status === "ok") {
      statusElement.innerHTML = `<span class="geo-status geo-success">✓ Ubicada</span>
        <button onclick="abrirEnGoogleMaps(${data.lat}, ${data.lng})" class="btn-map-shortcut">Ver en Mapa</button>`;
      botonGeo.innerHTML = '🌍 Ubicada'; botonGeo.style.backgroundColor = '#4CAF50';
      if (document.getElementById('mapa') && mapInstance) {
        const nombreCliente = fila.querySelector('td:first-child').textContent;
        mostrarClienteEnMapa(mapInstance, data.lat, data.lng, data.direccion_formateada || direccion, nombreCliente);
      }
    } else {
      let mensajeError = data.mensaje || "Error en geocodificación";
      if (data.detalle) mensajeError += ` (${data.detalle})`;
      statusElement.textContent = mensajeError; statusElement.className = "geo-status geo-error";
      botonGeo.innerHTML = '🌍 Reintentar';
    }
  } catch (error) {
    statusElement.textContent = "Error de conexión al geocodificar";
    statusElement.className = "geo-status geo-error";
    botonGeo.innerHTML = '🌍 Reintentar';
  } finally {
    botonGeo.disabled = false;
    if (!statusElement.textContent.includes('✓ Ubicada')) botonGeo.style.backgroundColor = '';
  }
}

function abrirEnGoogleMaps(lat, lng) {
  window.open(`http://maps.google.com/maps?daddr=${lat},${lng}&dirflg=d`, '_blank');
}

/* =========================================
   Admin: listar/asignar clientes
   ========================================= */
function cargarTodosLosClientes() {
  fetch("/clientes", withAuthHeaders())
    .then(res => { if (!res.ok) throw new Error(`Error ${res.status}`); return res.json(); })
    .then(allClients => {
      if (!Array.isArray(allClients)) throw new Error("Respuesta /clientes no es lista");
      const clientesNoAsignados = allClients.filter(c => c.asignado_a === null);
      const tbody = document.querySelector("#tablaAsignarClientes tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      if (clientesNoAsignados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8">No hay clientes no asignados</td></tr>`;
        return;
      }
      return fetch("/usuarios", withAuthHeaders())
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(usuarios => {
          if (!Array.isArray(usuarios)) throw new Error("Respuesta /usuarios no es una lista");
          usuariosParaAsignacionMasiva = usuarios;

          const massAssignSelect = document.getElementById('massAssignUserSelect');
          if (massAssignSelect) {
            massAssignSelect.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
            usuarios.forEach(u => {
              const option = document.createElement('option');
              option.value = u.id;
              option.textContent = u.nombre;
              massAssignSelect.appendChild(option);
            });
          }

          clientesNoAsignados.forEach(cliente => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
              <td><input type="checkbox" class="client-checkbox" data-id="${cliente.id}"></td>
              <td>${cliente.nombre}</td>
              <td>${cliente.telefono ? `<a href="tel:${cliente.telefono}" class="telefono-link">${cliente.telefono}</a>` : "-"}</td>
              <td>${cliente.direccion || "-"}</td>
              <td>${cliente.tarifa || "-"}</td>
              <td>${cliente.saldo_exigible || "-"}</td>
              <td>${cliente.saldo || "-"}</td>
              <td>
                <select class="usuarioSelect" data-id="${cliente.id}">
                  <option value="">-- Sin asignar --</option>
                  ${usuarios.map(u => `<option value="${u.id}" ${cliente.asignado_a === u.id ? "selected" : ""}>${u.nombre}</option>`).join("")}
                </select>
              </td>`;
            tbody.appendChild(tr);
          });
        });
    })
    .catch(err => {
      console.error("Error clientes/usuarios:", err);
      const tbody = document.querySelector("#tablaAsignarClientes tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="error">Error al cargar datos (${err.message}).</td></tr>`;
    });
}

function guardarAsignaciones() {
  const actualizaciones = Array.from(document.querySelectorAll("#tablaAsignarClientes .usuarioSelect"))
    .map(select => ({ id: parseInt(select.dataset.id), asignado_a: select.value ? parseInt(select.value) : null }));

  const botonGuardar = document.querySelector('button[onclick="guardarAsignaciones()"]');
  if (botonGuardar) { botonGuardar.disabled = true; botonGuardar.textContent = 'Guardando...'; }

  fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: actualizaciones }) }))
    .then(res => res.ok ? res.json() : res.json().then(e => { throw new Error(e.mensaje || 'Error'); }))
    .then(data => {
      const cont = document.getElementById('seccionAsignacion');
      if (cont) {
        let msg = cont.querySelector('.admin-message');
        if (!msg) { msg = document.createElement('p'); cont.insertBefore(msg, document.getElementById('tablaAsignarClientes')); }
        msg.className = 'admin-message success';
        msg.textContent = `✅ ${data.mensaje || 'Asignaciones guardadas.'}`;
        setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
      }
      cargarTodosLosClientes();
      if ((esAdmin || esSuperadmin) && typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
    })
    .catch(err => {
      const cont = document.getElementById('seccionAsignacion');
      if (cont) {
        let msg = cont.querySelector('.admin-message');
        if (!msg) { msg = document.createElement('p'); cont.insertBefore(msg, document.getElementById('tablaAsignarClientes')); }
        msg.className = 'admin-message error';
        msg.textContent = `❌ Error al guardar: ${err.message}`;
      }
    })
    .finally(() => {
      if (botonGuardar) { botonGuardar.disabled = false; botonGuardar.textContent = '💾 Guardar Asignaciones Individuales'; }
    });
}

async function asignarClientesMasivamente() {
  const selectedUserElement = document.getElementById('massAssignUserSelect');
  const targetUserId = selectedUserElement?.value ? parseInt(selectedUserElement.value) : null;
  const massAssignMessage = document.getElementById('massAssignMessage');
  const assignButton = document.querySelector('button[onclick="asignarClientesMasivamente()"]');

  if (targetUserId === null) { if (massAssignMessage) { massAssignMessage.className = 'error'; massAssignMessage.textContent = "❌ Selecciona un usuario."; } return; }
  const selectedClientCheckboxes = document.querySelectorAll('.client-checkbox:checked');
  if (selectedClientCheckboxes.length === 0) { if (massAssignMessage) { massAssignMessage.className = 'info'; massAssignMessage.textContent = "ℹ️ No hay clientes seleccionados."; } return; }
  if (!confirm(`¿Asignar ${selectedClientCheckboxes.length} clientes al usuario seleccionado?`)) return;

  const clientesToUpdate = Array.from(selectedClientCheckboxes).map(checkbox => ({ id: parseInt(checkbox.dataset.id), asignado_a: targetUserId }));
  if (assignButton) { assignButton.disabled = true; assignButton.textContent = 'Asignando...'; }
  if (massAssignMessage) { massAssignMessage.className = 'info'; massAssignMessage.textContent = `Asignando ${clientesToUpdate.length} clientes...`; }

  try {
    const response = await fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: clientesToUpdate }) }));
    const data = await response.json();
    if (massAssignMessage) { massAssignMessage.className = 'success'; massAssignMessage.textContent = `✅ ${data.mensaje || 'Asignación completa.'}`; }
    cargarTodosLosClientes();
    if ((esAdmin || esSuperadmin) && typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
  } catch (error) {
    if (massAssignMessage) { massAssignMessage.className = 'error'; massAssignMessage.textContent = `❌ Error: ${error.message}`; }
  } finally {
    if (assignButton) { assignButton.disabled = false; assignButton.textContent = '🚀 Asignar Clientes Seleccionados'; }
  }
}

/* =========================================
   Usuarios (Admin)
   ========================================= */
function cargarUsuarios() {
  fetch("/usuarios", withAuthHeaders())
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(usuarios => {
      if (!Array.isArray(usuarios)) throw new Error("Respuesta /usuarios no es una lista");
      const tbody = document.querySelector("#tablaUsuarios tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      usuarios.forEach(u => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${u.id}</td><td>${u.nombre}</td><td><button class="button-danger" onclick="eliminarUsuario(${u.id})">Eliminar</button></td>`;
        tbody.appendChild(tr);
      });
    })
    .catch(err => {
      console.error("Error usuarios:", err);
      const tbody = document.querySelector("#tablaUsuarios tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="error">Error al cargar usuarios (${err.message}).</td></tr>`;
    });
}

function agregarUsuario() {
  const nombre = document.getElementById("nuevoUsuarioNombre")?.value;
  const password = document.getElementById("nuevoUsuarioPassword")?.value;
  if (!nombre || !password) return;
  fetch("/usuarios", withAuthHeaders({ method: "POST", body: JSON.stringify({ nombre, password }) }))
    .then(r => r.json())
    .then(_ => {
      const n = document.getElementById("nuevoUsuarioNombre");
      const p = document.getElementById("nuevoUsuarioPassword");
      if (n) n.value = ''; if (p) p.value = '';
      cargarUsuarios();
    })
    .catch(err => console.error("Error agregar usuario:", err));
}

function eliminarUsuario(id) {
  if (!confirm("¿Eliminar usuario?")) return;
  fetch("/usuarios/eliminar", withAuthHeaders({ method: "POST", body: JSON.stringify({ id }) }))
    .then(r => r.json())
    .then(_ => cargarUsuarios())
    .catch(err => console.error("Error eliminar usuario:", err));
}

/* =========================================
   Llamadas (Gestor)
   ========================================= */
function registrarLlamada(btn, clienteId) {
  const fila = btn.closest("tr");
  const montoInput = fila.querySelector(".monto");
  const resultadoSelect = fila.querySelector(".resultado");
  const observacionesInput = fila.querySelector(".observaciones");
  const monto = montoInput.value;
  const resultado = resultadoSelect.value;
  const observaciones = observacionesInput.value;

  if (!resultado) {
    const errorCell = fila.querySelector('td:last-child');
    const originalText = errorCell.innerHTML;
    errorCell.innerHTML = '<span style="color:red;">Selecciona un resultado</span>';
    setTimeout(() => { errorCell.innerHTML = originalText; }, 3000);
    resultadoSelect.focus(); return;
  }
  btn.disabled = true; btn.textContent = 'Registrando...';

  fetch("/llamadas", withAuthHeaders({
    method: "POST",
    body: JSON.stringify({
      cliente_id: clienteId,
      usuario_id: usuarioActual.id,
      fecha: new Date().toISOString().split("T")[0],
      monto_cobrado: monto || 0,
      resultado,
      observaciones: observaciones || ""
    })
  }))
    .then(res => res.ok ? res.json() : res.json().then(e => { throw new Error(e.mensaje || `Error HTTP ${res.status}`) }))
    .then(data => {
      if (data.status === "ok") {
        fila.style.transition = "opacity 0.5s ease-out"; fila.style.opacity = "0";
        setTimeout(() => {
          fila.remove();
          if (document.querySelectorAll("#tablaClientes tbody tr").length === 0) {
            document.querySelector("#tablaClientes tbody").innerHTML = `<tr><td colspan="10">¡Todos los clientes asignados han sido procesados!</td></tr>`;
          }
        }, 500);
      } else {
        const errorCell = fila.querySelector('td:last-child');
        errorCell.innerHTML = `<span style="color:red;">${data.mensaje || "Error"}</span>`;
        btn.disabled = false; btn.textContent = 'Registrar';
      }
    })
    .catch(error => {
      const errorCell = fila.querySelector('td:last-child');
      errorCell.innerHTML = `<span style="color:red;">${error.message}</span> <button onclick="registrarLlamada(this, ${clienteId})">Reintentar</button>`;
      btn.disabled = false; btn.textContent = 'Registrar';
    });
}

/* =========================================
   Mapas
   ========================================= */
function inicializarMapaManual() {
  if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
    const info = document.getElementById('info-ruta');
    if (info) info.innerHTML = '<p class="error">Google Maps no está disponible.</p>';
    return;
  }
  const mapaElement = document.getElementById('mapa');
  if (!mapaElement) return;

  if (!mapInstance) mapInstance = new google.maps.Map(mapaElement, {
    zoom: 12, center: { lat: 19.4326, lng: -99.1332 }, mapTypeControl: true, streetViewControl: true
  });
  if (!directionsRendererInstance) directionsRendererInstance = new google.maps.DirectionsRenderer({ suppressMarkers: true });
  directionsRendererInstance.setMap(mapInstance);

  const info = document.getElementById('info-ruta');
  if (info) info.innerHTML = '<p class="info">Obteniendo tu ubicación...</p>';

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      gestoresMarkers.forEach(m => m.setMap(null)); gestoresMarkers = [];
      new google.maps.Marker({ position: userPos, map: mapInstance, title: "Tu ubicación", icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" });
      mapInstance.setCenter(userPos); mapInstance.setZoom(13);

      try {
        // Si estoy en modo gestor, carga sus clientes con coords
        if (!esAdmin && !esSuperadmin) {
          const response = await fetch(`/clientes/${usuarioActual.id}`, withAuthHeaders());
          if (!response.ok) throw new Error(`Error ${response.status}`);
          const clientes = await response.json();
          const clientesConCoords = Array.isArray(clientes) ? clientes.filter(c => c.lat && c.lng) : [];
          if (clientesConCoords.length === 0) {
            if (info) info.innerHTML = `<p class="info">No tienes clientes con coordenadas. Usa "🌍 Geolocalizar".</p>`;
            return;
          }
          clientesConCoords.forEach(cliente => {
            const marker = new google.maps.Marker({
              position: { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) },
              map: mapInstance, title: `${cliente.nombre}\n${cliente.direccion || ''}`,
              icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
            });
            marker.addListener('click', () => { mostrarRuta(mapInstance, directionsRendererInstance, userPos, cliente); });
          });
        } else {
          if (info) info.innerHTML = '<p class="info">Mapa cargado.</p>';
        }
      } catch (error) {
        console.error("Error inicializarMapaManual:", error);
        if (info) info.innerHTML = `<p class="error">Error al cargar datos: ${error.message}</p>`;
      }
    }, () => {
      const info2 = document.getElementById('info-ruta');
      if (info2) info2.innerHTML = `<p class="error">No se pudo obtener tu ubicación.</p>`;
    }, { timeout: 10000, enableHighAccuracy: true });
  } else {
    if (info) info.innerHTML = '<p class="info">Tu navegador no soporta geolocalización.</p>';
  }
}

function mostrarRuta(map, directionsRenderer, origen, cliente) {
  if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
    const info = document.getElementById('info-ruta');
    if (info) info.innerHTML = '<p class="error">Google Maps API no disponible.</p>';
    return;
  }
  const destino = { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) };
  const directionsService = new google.maps.DirectionsService();
  directionsService.route(
    { origin: origen, destination: destino, travelMode: google.maps.TravelMode.DRIVING },
    (response, status) => {
      if (status === google.maps.DirectionsStatus.OK) {
        directionsRenderer.setDirections(response);
        const leg = response.routes[0].legs[0];
        const url = `http://maps.google.com/maps?saddr=${origen.lat},${origen.lng}&daddr=${destino.lat},${destino.lng}&dirflg=d`;
        const info = document.getElementById('info-ruta');
        if (info) {
          info.innerHTML = `<h3>Ruta a ${cliente.nombre}</h3>
            <p><strong>Dirección:</strong> ${cliente.direccion || 'No disponible'}</p>
            <p><strong>Distancia:</strong> ${leg.distance.text}</p>
            <p><strong>Duración:</strong> ${leg.duration.text}</p>
            <a href="${url}" target="_blank" class="btn-navegar" style="display:inline-block; margin-top:15px; padding:10px 18px;">🗺️ Abrir en Google Maps</a>`;
        }
      } else {
        const info = document.getElementById('info-ruta');
        if (info) info.innerHTML = `<p class="info">No se pudo calcular la ruta.</p>`;
      }
    }
  );
}

function mostrarClienteEnMapa(map, lat, lng, direccion, nombreCliente) {
  if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
    const info = document.getElementById('info-ruta');
    if (info) info.innerHTML = '<p class="error">Google Maps API no disponible.</p>';
    return;
  }
  const pos = { lat: parseFloat(lat), lng: parseFloat(lng) };
  new google.maps.Marker({ position: pos, map: map, title: nombreCliente, icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" });
  map.setCenter(pos);
  const info = document.getElementById('info-ruta');
  if (info) info.innerHTML = `<h3>Cliente: ${nombreCliente}</h3><p><strong>Dirección:</strong> ${direccion}</p><p>Calculando ruta...</p>`;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((p) => {
      const userPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      new google.maps.Marker({ position: userPos, map: map, title: "Tu ubicación actual", icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" });
      const renderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true });
      mostrarRuta(map, renderer, userPos, { lat, lng, nombre: nombreCliente, direccion });
    }, () => {
      const info2 = document.getElementById('info-ruta');
      if (info2) info2.innerHTML = `<p class="info">No se pudo obtener tu ubicación.</p>`;
    }, { timeout: 10000, enableHighAccuracy: true });
  }
}

/* =========================================
   Ubicación (ping periódico)
   ========================================= */
function solicitarYEnviarUbicacion() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    fetch('/actualizar-ubicacion-usuario', withAuthHeaders({
      method: 'POST',
      body: JSON.stringify({ usuario_id: usuarioActual?.id, lat: pos.coords.latitude, lng: pos.coords.longitude })
    }));
  }, () => {}, { enableHighAccuracy: true, timeout: 10000 });
}

function cerrarSesion() {
  localStorage.removeItem("user");
  localStorage.removeItem("empresaActivaId");
  window.location.href = "/";
}

/* =========================================
   Superadmin: alta y listado de empresas
   ========================================= */
function crearEmpresa() {
  const nombre = document.getElementById('empresaNombre')?.value;
  const admin_nombre = document.getElementById('empresaAdminNombre')?.value;
  const admin_password = document.getElementById('empresaAdminPassword')?.value;
  const msg = document.getElementById('empresasMensaje');
  if (!nombre || !admin_nombre || !admin_password) { if (msg) { msg.className='error'; msg.textContent='Completa todos los campos'; } return; }
  fetch('/empresas/crear', withAuthHeaders({ method: 'POST', body: JSON.stringify({ nombre, admin_nombre, admin_password }) }))
    .then(r => r.json())
    .then(data => {
      if (msg) {
        if (data.status === 'ok') { msg.className='success'; msg.textContent='Empresa creada y admin generado'; }
        else { msg.className='error'; msg.textContent=data.mensaje || 'Error al crear empresa'; }
      }
      poblarSelectorEmpresas();
    })
    .catch(e => { if (msg) { msg.className='error'; msg.textContent=e.message; } });
}

function listarEmpresas() {
  const ul = document.getElementById('listaEmpresas');
  const msg = document.getElementById('empresasMensaje');
  fetch('/empresas', withAuthHeaders())
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(empresas => {
      if (!Array.isArray(empresas)) throw new Error("Respuesta /empresas no es lista");
      if (ul) ul.innerHTML = '';
      empresas.forEach(e => {
        const li = document.createElement('li');
        li.textContent = `#${e.id} - ${e.nombre}`;
        if (ul) ul.appendChild(li);
      });
      if (msg) msg.textContent = empresas.length ? '' : 'No hay empresas registradas.';
    })
    .catch(e => { if (msg) { msg.className='error'; msg.textContent=e.message; } });
}

/* =========================================
   Carga de clientes desde Excel (Admin / Superadmin actuando como empresa)
   ========================================= */
// Normaliza nombre de encabezados (sin acentos, minúsculas)
function _norm(s) {
  if (!s) return '';
  return String(s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

// Intenta encontrar un valor en una fila con múltiples claves posibles
function _pick(row, keys) {
  for (const k of keys) {
    if (row.hasOwnProperty(k) && row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  // probar por equivalencia normalizada
  const normMap = {};
  Object.keys(row).forEach(h => normMap[_norm(h)] = row[h]);
  for (const k of keys) {
    const nk = _norm(k);
    if (normMap.hasOwnProperty(nk) && normMap[nk] != null && String(normMap[nk]).trim() !== '') return normMap[nk];
  }
  return '';
}

async function procesarArchivo(event) {
  const file = event.target.files?.[0];
  const msg = document.getElementById('mensajeExcel');
  if (!file) { if (msg) { msg.className = 'info'; msg.textContent = 'Selecciona un archivo .xlsx'; } return; }

  try {
    if (msg) { msg.className = 'info'; msg.textContent = 'Leyendo archivo…'; }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!Array.isArray(json) || json.length === 0) {
      if (msg) { msg.className = 'error'; msg.textContent = 'La hoja está vacía o no se pudo leer.'; }
      return;
    }

    // Mapeo de columnas esperadas (admite variaciones de encabezado)
    const clientes = json.map(r => {
      const nombre = _pick(r, ['Nombre', 'Cliente', 'name', 'cliente']);
      const telefono = _pick(r, ['Telefono', 'Teléfono', 'Phone', 'Celular', 'Movil', 'Móvil']);
      const direccion = _pick(r, ['Direccion', 'Dirección', 'Domicilio', 'Address']);
      const tarifa = _pick(r, ['Tarifa', 'Plan', 'Paquete']);
      const saldo_exigible = _pick(r, ['Saldo Exigible', 'Saldo_Exigible', 'SaldoExigible', 'Exigible']);
      const saldo = _pick(r, ['Saldo', 'Adeudo', 'Deuda']);
      const asignado_a = _pick(r, ['AsignadoA', 'Asignado_a', 'UsuarioId', 'GestorId', 'ID Gestor']);

      return {
        nombre: String(nombre || '').trim(),
        telefono: String(telefono || '').trim(),
        direccion: String(direccion || '').trim(),
        tarifa: String(tarifa || '').trim(),
        saldo_exigible: String(saldo_exigible || '').trim(),
        saldo: String(saldo || '').trim(),
        asignado_a: /^\d+$/.test(String(asignado_a).trim()) ? parseInt(String(asignado_a).trim(), 10) : null,
      };
    }).filter(c => c.nombre);

    if (clientes.length === 0) {
      if (msg) { msg.className = 'error'; msg.textContent = 'No se encontraron filas válidas (verifica encabezados y datos).'; }
      return;
    }

    if (msg) { msg.className = 'info'; msg.textContent = `Procesando ${clientes.length} clientes…`; }

    // Enviar al backend (con x-user-id y x-empresa-id si aplica)
    const res = await fetch('/cargar-clientes', withAuthHeaders({
      method: 'POST',
      body: JSON.stringify({ clientes })
    }));

    const dataRes = await res.json();
    if (!res.ok || dataRes.status !== 'ok') {
      const detalle = dataRes?.mensaje || `HTTP ${res.status}`;
      if (msg) { msg.className = 'error'; msg.textContent = `❌ Error al cargar: ${detalle}`; }
      return;
    }

    if (msg) { msg.className = 'success'; msg.textContent = `✅ ${dataRes.mensaje}. Con coordenadas: ${dataRes.clientesConCoordenadas || 0}.`; }

    // refresca tablas
    if (esAdmin || esSuperadmin) {
      cargarTodosLosClientes();
      if (typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
    }
  } catch (e) {
    console.error('Error procesarArchivo:', e);
    if (msg) { msg.className = 'error'; msg.textContent = `❌ ${e.message}`; }
  }
}

async function limpiarClientes() {
  const msg = document.getElementById('mensajeExcel');
  if (!confirm('¿Seguro que deseas eliminar TODOS los clientes de esta empresa?')) return;
  try {
    const res = await fetch('/limpiar-clientes', withAuthHeaders({ method: 'POST' }));
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      if (msg) { msg.className = 'success'; msg.textContent = `✅ ${data.mensaje}`; }
      cargarTodosLosClientes();
    } else {
      if (msg) { msg.className = 'error'; msg.textContent = `❌ ${data.mensaje || 'Error al limpiar'}`; }
    }
  } catch (e) {
    if (msg) { msg.className = 'error'; msg.textContent = `❌ ${e.message}`; }
  }
}

/* =========================================
   Utilidades de asignación
   ========================================= */
function filtrarClientes() {
  const filtro = (document.getElementById('filtroCliente')?.value || '').toLowerCase();
  const rows = document.querySelectorAll('#tablaAsignarClientes tbody tr');
  rows.forEach(tr => {
    const texto = tr.textContent.toLowerCase();
    tr.style.display = texto.includes(filtro) ? '' : 'none';
  });
}

function toggleAllClients(checkbox) {
  const checks = document.querySelectorAll('#tablaAsignarClientes .client-checkbox');
  checks.forEach(ch => ch.checked = checkbox.checked);
}

/* =========================================
   Objetivos por Gestor (Admin)
   ========================================= */
async function cargarObjetivos() {
  try {
    const ures = await fetch('/usuarios', withAuthHeaders());
    if (!ures.ok) throw new Error(`HTTP ${ures.status}`);
    const usuarios = await ures.json();
    if (!Array.isArray(usuarios)) throw new Error('Usuarios no es array');

    const res = await fetch('/objetivos', withAuthHeaders());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const objetivos = (data && data.objetivos) ? data.objetivos : [];

    const tbody = document.querySelector('#tablaObjetivos tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    usuarios.forEach(u => {
      const obj = objetivos.find(o => Number(o.usuario_id) === Number(u.id));
      const valor = obj ? Number(obj.objetivo_monto) : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.nombre}</td>
        <td><input type="number" min="0" step="1" class="input-objetivo" data-uid="${u.id}" value="${valor !== '' ? valor : ''}" placeholder="0" /></td>
        <td>
          <button class="button-primary" onclick="guardarObjetivo(${u.id})">💾 Guardar</button>
          ${valor !== '' ? `<button class="button-danger" onclick="eliminarObjetivo(${u.id})">🗑️ Eliminar</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('cargarObjetivos:', e);
    const tbody = document.querySelector('#tablaObjetivos tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="error">Error al cargar objetivos: ${e.message}</td></tr>`;
  }
}

async function guardarObjetivo(usuarioId) {
  try {
    const input = document.querySelector(`.input-objetivo[data-uid="${usuarioId}"]`);
    const valor = input && input.value ? Number(input.value) : 0;
    const res = await fetch('/objetivos/upsert', withAuthHeaders({
      method: 'POST',
      body: JSON.stringify({ usuario_id: usuarioId, objetivo_monto: valor })
    }));
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') throw new Error(data.mensaje || `HTTP ${res.status}`);
    mostrarMensajeFlotante('Objetivo guardado');
    await cargarObjetivos();
    if (typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
  } catch (e) {
    alert('Error al guardar objetivo: ' + e.message);
  }
}

async function eliminarObjetivo(usuarioId) {
  if (!confirm('¿Eliminar objetivo de este gestor?')) return;
  try {
    const res = await fetch('/objetivos/eliminar', withAuthHeaders({
      method: 'POST',
      body: JSON.stringify({ usuario_id: usuarioId })
    }));
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') throw new Error(data.mensaje || `HTTP ${res.status}`);
    mostrarMensajeFlotante('Objetivo eliminado');
    await cargarObjetivos();
    if (typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
  } catch (e) {
    alert('Error al eliminar objetivo: ' + e.message);
  }
}

/* =========================================
   KPIs con avance vs objetivo y semáforo
   ========================================= */
function renderSemaforo(color) {
  const map = {
    rojo:   '#d32f2f',
    amarillo:'#f9a825',
    naranja:'#fb8c00',
    verde:  '#2e7d32',
    gris:   '#9e9e9e'
  };
  const c = map[color] || map.gris;
  return `<span title="${color}" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c};vertical-align:middle;"></span>`;
}

function renderBar(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `
    <div style="width:140px;height:12px;border:1px solid #ccc;border-radius:6px;overflow:hidden;display:inline-block;vertical-align:middle;">
      <div style="width:${p}%;height:100%;background:#1976d2;"></div>
    </div>
    <span style="margin-left:6px;min-width:48px;display:inline-block;">${p}%</span>
  `;
}

async function cargarKPIsConFecha() {
  try {
    const desdeInput = document.getElementById('fechaInicioBonos');
    const desde = desdeInput && desdeInput.value ? desdeInput.value : null;

    const url = desde ? `/kpis-gestores?desde=${encodeURIComponent(desde)}` : `/kpis-gestores`;
    const res = await fetch(url, withAuthHeaders());
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') throw new Error(data.mensaje || `HTTP ${res.status}`);

    const tbody = document.querySelector('#tablaRendimientoGestores tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    data.kpis.forEach(k => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${k.nombre}</td>
        <td>$ ${Number(k.total_cobrado || 0).toLocaleString()}</td>
        <td>${k.efectividad}%</td>
        <td>${k.llamadas_totales}</td>
        <td>$ ${Number(k.objetivo || 0).toLocaleString()}</td>
        <td>${renderBar(k.avance_porcentaje)}</td>
        <td>${renderSemaforo(k.semaforo)}</td>
        <td>${desde || data.desde}</td>
        <td colspan="2"></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('cargarKPIsConFecha:', e);
    const tbody = document.querySelector('#tablaRendimientoGestores tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="error">Error KPIs: ${e.message}</td></tr>`;
  }
}
