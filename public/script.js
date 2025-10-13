// public/script.js (multi-tenant ready + superadmin UI helpers)
let usuarioActual = null;
let esAdmin = false;
let mapInstance = null;
let directionsRendererInstance = null;
let usuariosParaAsignacionMasiva = [];
let gestoresMarkers = [];

window.Maps_API_KEY = null;

async function ensureGoogleMapsKey() {
  if (window.Maps_API_KEY) return true;
  try {
    const res = await fetch('/api-key');
    if (!res.ok) return false;
    const data = await res.json();
    window.Maps_API_KEY = data.key;
    const s = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (s && !s.src.includes('key=')) {
      const before = s.src.split('&callback')[0];
      const cb = s.src.split('&callback=')[1] || 'inicializarMapa';
      s.src = `${before}&key=${window.Maps_API_KEY}&callback=${cb}`;
    }
    return true;
  } catch (e) {
    console.error("No se pudo obtener la API Key de Maps:", e);
    return false;
  }
}

function inicializarMapa() {
  if (typeof window.googleMapsApiLoadedCallback === 'function') {
    window.googleMapsApiLoadedCallback();
  }
}

function withAuthHeaders(init = {}) {
  const u = JSON.parse(localStorage.getItem("user"));
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (u?.id !== undefined) headers["x-user-id"] = u.id;
  return { ...init, headers };
}

function login() {
  const nombre = document.getElementById("usuario").value;
  const password = document.getElementById("password").value;
  const messageElement = document.getElementById("login-message");
  if (!nombre || !password) { messageElement.textContent = "Por favor complete ambos campos"; return; }
  messageElement.textContent = "";
  fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: nombre, password }) })
    .then(res => { if (!res.ok) throw new Error(`Error HTTP: ${res.status}`); return res.json(); })
    .then(data => {
      if (data.status === "ok") { localStorage.setItem("user", JSON.stringify(data)); window.location.href = "/clientes.html"; }
      else { messageElement.textContent = data.mensaje || "Error al iniciar sesión"; }
    })
    .catch(err => { console.error("Error en login:", err); messageElement.textContent = "Error de conexión con el servidor"; });
}

window.googleMapsApiLoadedCallback = function() {
  if (window.location.pathname.includes("clientes.html") && esAdmin) {
    inicializarMapaManual();
  }
};

function mostrarMensajeFlotante(mensaje) {
  const el = document.getElementById('floatingMessage');
  if (!el) return;
  el.textContent = mensaje;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

window.addEventListener("load", async () => {
  const userData = JSON.parse(localStorage.getItem("user"));
  if (!userData && window.location.pathname.includes("clientes.html")) { window.location.href = "/"; return; }
  usuarioActual = userData || null;
  esAdmin = !!usuarioActual && (usuarioActual.esAdmin === true);

  await ensureGoogleMapsKey();

  if (window.location.pathname.includes("clientes.html")) {
    const span = document.getElementById("nombreUsuario");
    if (span && usuarioActual?.usuario) span.textContent = usuarioActual.usuario;
    mostrarMensajeFlotante("Hecho con 🧡 por Leonardo Luna");

    const inputFecha = document.getElementById('fechaInicioBonos');
    if (inputFecha) {
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const yyyy = firstDay.getFullYear();
      const mm = String(firstDay.getMonth() + 1).padStart(2, '0');
      const dd = String(firstDay.getDate()).padStart(2, '0');
      inputFecha.value = `${yyyy}-${mm}-${dd}`;
    }

    // Superadmin: mostrar sección empresas si existe
    if (usuarioActual?.rol === 'superadmin') {
      const sec = document.getElementById('seccionEmpresas');
      if (sec) sec.classList.remove('hidden');
    }

    if (esAdmin) {
      document.getElementById("seccionAdmin")?.classList.remove("hidden");
      document.getElementById("seccionAsignacion")?.classList.remove("hidden");
      cargarTodosLosClientes();
      cargarUsuarios();
      if (typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
    } else {
      document.getElementById("seccionAdmin")?.classList.add("hidden");
      document.getElementById("seccionAsignacion")?.classList.add("hidden");
      if (usuarioActual?.id !== undefined) cargarClientes(usuarioActual.id);
      solicitarYEnviarUbicacion();
      setInterval(solicitarYEnviarUbicacion, 30 * 60 * 1000);
    }
  }
});

// --- Clientes (gestor) ---
function cargarClientes(usuarioId) {
  fetch(`/clientes/${usuarioId}`, withAuthHeaders())
    .then(res => { if (!res.ok) throw new Error(`Error ${res.status}`); return res.json(); })
    .then(clientes => {
      const tbody = document.querySelector("#tablaClientes tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      if (clientes.length === 0) { tbody.innerHTML = `<tr><td colspan="10">No tienes clientes asignados</td></tr>`; return; }
      clientes.forEach(cliente => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${cliente.nombre}</td>
          <td>${cliente.telefono ? `<a href="tel:${cliente.telefono}" class="telefono-link">${cliente.telefono}</a> <button onclick="enviarWhatsapp('${cliente.telefono}', '${cliente.nombre}')" class="btn-whatsapp">💬 WhatsApp</button>` : "-"}</td>
          <td>${cliente.direccion || "-"} <button onclick="geocodificarCliente(${cliente.id}, this)" class="btn-geo">🌍 Geolocalizar</button>
            <span id="geo-status-${cliente.id}" class="geo-status">${cliente.lat && cliente.lng ? `✓ Ubicada <button onclick="abrirEnGoogleMaps(${cliente.lat}, ${cliente.lng}, '${cliente.direccion || ''}')" class="btn-map-shortcut">Ver en Mapa</button>` : ''}</span>
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
  botonGeo.disabled = true;
  botonGeo.innerHTML = '⌛ Procesando';

  try {
    const response = await fetch('/actualizar-coordenadas', withAuthHeaders({ method: 'POST', body: JSON.stringify({ clienteId, direccion }) }));
    const data = await response.json();
    if (data.status === "ok") {
      statusElement.innerHTML = `<span class="geo-status geo-success">✓ Ubicada</span>
        <button onclick="abrirEnGoogleMaps(${data.lat}, ${data.lng}, '${data.direccion_formateada || direccion}')" class="btn-map-shortcut">Ver en Mapa</button>`;
      botonGeo.innerHTML = '🌍 Ubicada';
      botonGeo.style.backgroundColor = '#4CAF50';
      if (document.getElementById('mapa') && mapInstance) {
        const nombreCliente = fila.querySelector('td:first-child').textContent;
        mostrarClienteEnMapa(mapInstance, data.lat, data.lng, data.direccion_formateada || direccion, nombreCliente);
      }
    } else {
      let mensajeError = data.mensaje || "Error en geocodificación";
      if (data.detalle) mensajeError += ` (${data.detalle})`;
      statusElement.textContent = mensajeError;
      statusElement.className = "geo-status geo-error";
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

function abrirEnGoogleMaps(lat, lng, direccion) {
  window.open(`http://maps.google.com/maps?daddr=${lat},${lng}&dirflg=d`, '_blank');
}

// --- Admin ---
function cargarTodosLosClientes() {
  fetch("/clientes", withAuthHeaders())
    .then(res => { if (!res.ok) throw new Error(`Error ${res.status}`); return res.json(); })
    .then(allClients => {
      const clientesNoAsignados = allClients.filter(c => c.asignado_a === null);
      const tbody = document.querySelector("#tablaAsignarClientes tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      if (clientesNoAsignados.length === 0) { tbody.innerHTML = `<tr><td colspan="8">No hay clientes no asignados</td></tr>`; return; }
      fetch("/usuarios", withAuthHeaders())
        .then(r => r.json())
        .then(usuarios => {
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
        })
        .catch(err => {
          console.error("Error usuarios:", err);
          tbody.innerHTML = `<tr><td colspan="8" class="error">Error al cargar usuarios.</td></tr>`;
        });
    })
    .catch(err => {
      console.error("Error clientes:", err);
      const tbody = document.querySelector("#tablaAsignarClientes tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="error">Error al cargar clientes.</td></tr>`;
    });
}

function guardarAsignaciones() {
  const actualizaciones = Array.from(document.querySelectorAll("#tablaAsignarClientes .usuarioSelect"))
    .map(select => ({ id: parseInt(select.dataset.id), asignado_a: select.value ? parseInt(select.value) : null }));
  const botonGuardar = document.querySelector('button[onclick="guardarAsignaciones()"]');
  if (botonGuardar) { botonGuardar.disabled = false; botonGuardar.textContent = 'Guardando...'; }
  fetch("/actualizar-clientes", withAuthHeaders({ method: "POST", body: JSON.stringify({ clientes: actualizaciones }) }))
    .then(res => res.ok ? res.json() : res.json().then(e => { throw new Error(e.mensaje || 'Error'); }))
    .then(data => {
      const cont = document.getElementById('seccionAsignacion');
      if (cont) {
        let msg = cont.querySelector('.admin-message');
        if (!msg) { msg = document.createElement('p'); msg.className = 'admin-message success'; cont.insertBefore(msg, document.getElementById('tablaAsignarClientes')); }
        msg.className = 'admin-message success';
        msg.textContent = `✅ ${data.mensaje || 'Asignaciones guardadas.'}`;
        setTimeout(() => msg.textContent = '', 3000);
      }
      cargarTodosLosClientes();
      if (esAdmin && typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
    })
    .catch(err => {
      const cont = document.getElementById('seccionAsignacion');
      if (cont) {
        let msg = cont.querySelector('.admin-message');
        if (!msg) { msg = document.createElement('p'); msg.className = 'admin-message error'; cont.insertBefore(msg, document.getElementById('tablaAsignarClientes')); }
        msg.className = 'admin-message error';
        msg.textContent = `❌ Error al guardar: ${err.message}`;
      }
    })
    .finally(() => { if (botonGuardar) { botonGuardar.disabled = false; botonGuardar.textContent = '💾 Guardar Asignaciones Individuales'; } });
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
    if (esAdmin && typeof cargarKPIsConFecha === 'function') cargarKPIsConFecha();
  } catch (error) {
    if (massAssignMessage) { massAssignMessage.className = 'error'; massAssignMessage.textContent = `❌ Error: ${error.message}`; }
  } finally {
    if (assignButton) { assignButton.disabled = false; assignButton.textContent = '🚀 Asignar Clientes Seleccionados'; }
  }
}

// --- Usuarios ---
function cargarUsuarios() {
  fetch("/usuarios", withAuthHeaders()).then(r => r.json()).then(usuarios => {
    const tbody = document.querySelector("#tablaUsuarios tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    usuarios.forEach(u => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${u.id}</td><td>${u.nombre}</td><td><button class="button-danger" onclick="eliminarUsuario(${u.id})">Eliminar</button></td>`;
      tbody.appendChild(tr);
    });
  });
}

function agregarUsuario() {
  const nombre = document.getElementById("nuevoUsuarioNombre")?.value;
  const password = document.getElementById("nuevoUsuarioPassword")?.value;
  if (!nombre || !password) return;
  fetch("/usuarios", withAuthHeaders({ method: "POST", body: JSON.stringify({ nombre, password }) }))
    .then(r => r.json()).then(_ => { document.getElementById("nuevoUsuarioNombre").value=''; document.getElementById("nuevoUsuarioPassword").value=''; cargarUsuarios(); });
}

function eliminarUsuario(id) {
  if (!confirm("¿Eliminar usuario?")) return;
  fetch("/usuarios/eliminar", withAuthHeaders({ method: "POST", body: JSON.stringify({ id }) }))
    .then(r => r.json()).then(_ => cargarUsuarios());
}

// --- Llamadas ---
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
    resultadoSelect.focus();
    return;
  }
  btn.disabled = true; btn.textContent = 'Registrando...';
  fetch("/llamadas", withAuthHeaders({ method: "POST", body: JSON.stringify({ cliente_id: clienteId, usuario_id: usuarioActual.id, fecha: new Date().toISOString().split("T")[0], monto_cobrado: monto || 0, resultado, observaciones: observaciones || "" }) }))
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

// --- Map ---
function inicializarMapaManual() {
  if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
    const info = document.getElementById('info-ruta');
    if (info) info.innerHTML = '<p class="error">Google Maps no está disponible.</p>';
    return;
  }
  const mapaElement = document.getElementById('mapa');
  if (!mapaElement) return;
  if (!mapInstance) mapInstance = new google.maps.Map(mapaElement, { zoom: 12, center: { lat: 19.4326, lng: -99.1332 }, mapTypeControl: true, streetViewControl: true });
  if (!directionsRendererInstance) directionsRendererInstance = new google.maps.DirectionsRenderer({ suppressMarkers: true });
  directionsRendererInstance.setMap(mapInstance);
  const info = document.getElementById('info-ruta');
  if (info) info.innerHTML = '<p class="info">Obteniendo tu ubicación...</p>';
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      gestoresMarkers.forEach(m => m.setMap(null)); gestoresMarkers = [];
      new google.maps.Marker({ position: userPos, map: mapInstance, title: esAdmin ? "Ubicación del Admin" : "Tu ubicación actual", icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" });
      mapInstance.setCenter(userPos); mapInstance.setZoom(13);
      try {
        if (!esAdmin) {
          const response = await fetch(`/clientes/${usuarioActual.id}`, withAuthHeaders());
          if (!response.ok) throw new Error(`Error ${response.status}`);
          const clientes = await response.json();
          const clientesConCoords = clientes.filter(c => c.lat && c.lng);
          if (clientesConCoords.length === 0) { if (info) info.innerHTML = `<p class="info">No tienes clientes con coordenadas. Usa "🌍 Geolocalizar".</p>`; return; }
          clientesConCoords.forEach(cliente => {
            const marker = new google.maps.Marker({ position: { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) }, map: mapInstance, title: `${cliente.nombre}\n${cliente.direccion || ''}`, icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" });
            marker.addListener('click', () => { mostrarRuta(mapInstance, directionsRendererInstance, userPos, cliente); });
          });
        } else {
          if (info) info.innerHTML = '<p class="info">Mapa cargado.</p>';
        }
      } catch (error) {
        console.error("Error inicializarMapaManual:", error);
        if (info) info.innerHTML = `<p class="error">Error al cargar datos: ${error.message}</p>`;
      }
    }, () => { const info = document.getElementById('info-ruta'); if (info) info.innerHTML = `<p class="error">No se pudo obtener tu ubicación.</p>`; }, { timeout: 10000, enableHighAccuracy: true });
  } else {
    if (info) info.innerHTML = '<p class="info">Tu navegador no soporta geolocalización.</p>';
  }
}

function mostrarRuta(map, directionsRenderer, origen, cliente) {
  if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
    document.getElementById('info-ruta').innerHTML = '<p class="error">Google Maps API no disponible.</p>'; return;
  }
  const destino = { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) };
  const directionsService = new google.maps.DirectionsService();
  directionsService.route({ origin: origen, destination: destino, travelMode: google.maps.TravelMode.DRIVING }, (response, status) => {
    if (status === google.maps.DirectionsStatus.OK) {
      directionsRenderer.setDirections(response);
      const leg = response.routes[0].legs[0];
      const url = `http://maps.google.com/maps?saddr=${origen.lat},${origen.lng}&daddr=${destino.lat},${destino.lng}&dirflg=d`;
      document.getElementById('info-ruta').innerHTML = `<h3>Ruta a ${cliente.nombre}</h3>
        <p><strong>Dirección:</strong> ${cliente.direccion || 'No disponible'}</p>
        <p><strong>Distancia:</strong> ${leg.distance.text}</p>
        <p><strong>Duración:</strong> ${leg.duration.text}</p>
        <a href="${url}" target="_blank" class="btn-navegar" style="display:inline-block; margin-top:15px; padding:10px 18px;">🗺️ Abrir en Google Maps</a>`;
    } else {
      document.getElementById('info-ruta').innerHTML = `<p class="info">No se pudo calcular la ruta.</p>`;
    }
  });
}

function mostrarClienteEnMapa(map, lat, lng, direccion, nombreCliente) {
  if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
    document.getElementById('info-ruta').innerHTML = '<p class="error">Google Maps API no disponible.</p>'; return;
  }
  const pos = { lat: parseFloat(lat), lng: parseFloat(lng) };
  new google.maps.Marker({ position: pos, map: map, title: nombreCliente, icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" });
  map.setCenter(pos);
  document.getElementById('info-ruta').innerHTML = `<h3>Cliente: ${nombreCliente}</h3><p><strong>Dirección:</strong> ${direccion}</p><p>Calculando ruta...</p>`;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((p) => {
      const userPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      new google.maps.Marker({ position: userPos, map: map, title: "Tu ubicación actual", icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" });
      const renderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true });
      mostrarRuta(map, renderer, userPos, { lat, lng, nombre: nombreCliente, direccion });
    }, () => { document.getElementById('info-ruta').innerHTML = `<p class="info">No se pudo obtener tu ubicación.</p>`; }, { timeout: 10000, enableHighAccuracy: true });
  }
}

function solicitarYEnviarUbicacion() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    fetch('/actualizar-ubicacion-usuario', withAuthHeaders({ method: 'POST', body: JSON.stringify({ usuario_id: usuarioActual?.id, lat: pos.coords.latitude, lng: pos.coords.longitude }) }));
  }, () => {}, { enableHighAccuracy: true, timeout: 10000 });
}

function cerrarSesion() {
  localStorage.removeItem("user");
  window.location.href = "/";
}

// ---- Superadmin UI helpers ----
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
    })
    .catch(e => { if (msg) { msg.className='error'; msg.textContent=e.message; } });
}

function listarEmpresas() {
  const ul = document.getElementById('listaEmpresas');
  const msg = document.getElementById('empresasMensaje');
  fetch('/empresas', withAuthHeaders())
    .then(r => r.json())
    .then(empresas => {
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
