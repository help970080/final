let usuarioActual = null;
let esAdmin = false;
let mapInstance = null;
let directionsRendererInstance = null;
let usuariosParaAsignacionMasiva = [];
let gestoresMarkers = [];

// *** PUNTO CLAVE 1: Configura tu API Key de Google Maps aquí ***
window.Maps_API_KEY = 'AIzaSyC29ORCKKiOHa-PYtWI5_UjbNQ8vvTXP9k'; // <-- ¡Reemplaza con tu clave real!

// NUEVA FORMA DE CARGAR LA API DE GOOGLE MAPS
// Esto asegura que la clave API esté en la URL desde el principio.
function loadGoogleMapsScript() {
    if (window.google && window.google.maps) {
        // La API ya está cargada
        console.log("Google Maps API ya cargada.");
        if (typeof window.googleMapsApiLoadedCallback === 'function') {
            window.googleMapsApiLoadedCallback();
        }
        return;
    }

    if (!window.Maps_API_KEY) {
        console.error("Maps_API_KEY no está definida. No se puede cargar Google Maps.");
        if (document.getElementById('info-ruta')) {
            document.getElementById('info-ruta').innerHTML = '<p class="error">Error: API Key de Google Maps no configurada. Contacta al administrador.</p>';
        }
        return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${window.Maps_API_KEY}&libraries=places,geometry&callback=inicializarMapa`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        console.error("Error al cargar el script de Google Maps. Verifique su conexión o API Key.");
        if (document.getElementById('info-ruta')) {
            document.getElementById('info-ruta').innerHTML = '<p class="error">Error al cargar Google Maps. Verifique conexión y API Key.</p>';
        }
    };
    document.head.appendChild(script);
}


function login() {
    const nombre = document.getElementById("usuario").value;
    const password = document.getElementById("password").value;
    const messageElement = document.getElementById("login-message");

    if (!nombre || !password) {
        messageElement.textContent = "Por favor complete ambos campos";
        return;
    }

    messageElement.textContent = "";

    fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: nombre, password })
    })
    .then(res => {
        if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
        return res.json();
    })
    .then(data => {
        if (data.status === "ok") {
            localStorage.setItem("user", JSON.stringify(data));
            window.location.href = "/clientes.html";
        } else {
            messageElement.textContent = data.mensaje || "Error al iniciar sesión";
        }
    })
    .catch(err => {
        console.error("Error en login:", err);
        messageElement.textContent = "Error de conexión con el servidor";
    });
}

window.googleMapsApiLoadedCallback = function() {
    console.log("Google Maps API cargada y lista.");
    if (window.location.pathname.includes("clientes.html")) {
        if (esAdmin) {
            inicializarMapaManual();
        }
    }
};

function mostrarMensajeFlotante(mensaje) {
    const floatingMessage = document.getElementById('floatingMessage');
    if (!floatingMessage) return;

    floatingMessage.textContent = mensaje;
    floatingMessage.classList.remove('hidden');
    setTimeout(() => {
        floatingMessage.classList.add('hidden');
    }, 3000);
}

window.addEventListener("load", () => {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData && window.location.pathname.includes("clientes.html")) {
        console.log("Usuario no autenticado, redirigiendo a login.");
        window.location.href = "/";
        return;
    }

    usuarioActual = userData;
    if (!usuarioActual) return;

    esAdmin = usuarioActual.id === 0;
    
    if (window.location.pathname.includes("clientes.html")) {
        document.getElementById("nombreUsuario").textContent = usuarioActual.usuario;
        
        mostrarMensajeFlotante("Hecho con 🧡 por Leonardo Luna");

        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const yyyy = firstDayOfMonth.getFullYear();
        const mm = String(firstDayOfMonth.getMonth() + 1).padStart(2, '0');
        const dd = String(firstDayOfMonth.getDate()).padStart(2, '0');
        const fechaInicioBonosInput = document.getElementById('fechaInicioBonos');
        if (fechaInicioBonosInput) {
            fechaInicioBonosInput.value = `${yyyy}-${mm}-${dd}`;
        }


        if (esAdmin) {
            document.getElementById("seccionAdmin").classList.remove("hidden");
            document.getElementById("seccionAsignacion").classList.remove("hidden");
            cargarTodosLosClientes(); 
            cargarUsuarios();
            cargarKPIsConFecha();
            loadGoogleMapsScript();
        } else {
            document.getElementById("seccionAdmin").classList.add("hidden");
            document.getElementById("seccionAsignacion").classList.add("hidden");
            cargarClientes(usuarioActual.id);
            solicitarYEnviarUbicacion();
            setInterval(solicitarYEnviarUbicacion, 30 * 60 * 1000);
            loadGoogleMapsScript();
        }
    }
});

function cargarClientes(usuarioId) {
    fetch(`/clientes/${usuarioId}`)
        .then(res => {
            if (!res.ok) throw new Error(`Error ${res.status}`);
            return res.json();
        })
        .then(clientes => {
            const tbody = document.querySelector("#tablaClientes tbody");
            tbody.innerHTML = "";

            if (clientes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="10">No tienes clientes asignados</td></tr>`;
                return;
            }

            clientes.forEach(cliente => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${cliente.nombre}</td>
                    <td>${cliente.telefono ? `<a href="tel:<span class="math-inline">\{cliente\.telefono\}" class\="telefono\-link"\></span>{cliente.telefono}</a> <button onclick="enviarWhatsapp('<span class="math-inline">\{cliente\.telefono\}', '</span>{cliente.nombre}')" class="btn-whatsapp">💬 WhatsApp</button>` : "-"}</td>
                    <td>${cliente.direccion || "-"}
                      <button onclick="geocodificarCliente(${cliente.id}, this)" class="btn-geo">
                        🌍 Geolocalizar
                      </button>
                      <span id="geo-status-${cliente.id}" class="geo-status">
                        ${cliente.lat && cliente.lng ? 
                            // CORRECCIÓN FINAL EN ESTA LÍNEA (quitado el `"` extra)
                            `✓ Ubicada <button onclick="abrirEnGoogleMaps(${cliente.lat}, <span class="math-inline">\{cliente\.lng\}, '</span>{CSS.escape(cliente.direccion)}')" class="btn-map-shortcut">Ver en Mapa</button>` 
                            : ''}
                      </span>
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
                    <td><button onclick="registrarLlamada(this, ${cliente.id})">Registrar</button></td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(error => {
            console.error("Error al cargar clientes:", error);
            document.querySelector("#tablaClientes tbody").innerHTML = `<tr><td colspan="10" class="error">Error al cargar clientes asignados.</td></tr>`;
        });
}

function enviarWhatsapp(telefono, nombreCliente) {
    if (!telefono) {
        alert("El cliente no tiene un número de teléfono registrado.");
        return;
    }

    let numeroLimpio = telefono.replace(/\D/g, '');

    if (!numeroLimpio.startsWith('52') && numeroLimpio.length === 10) {
        numeroLimpio = '52' + numeroLimpio;
    } else if (numeroLimpio.startsWith('044') || numeroLimpio.startsWith('045')) {
        numeroLimpio = numeroLimpio.substring(3);
        if (numeroLimpio.length === 10) {
             numeroLimpio = '52' + numeroLimpio;
        }
    } else if (numeroLimpio.length === 11 && numeroLimpio.startsWith('1')) {
        numeroLimpio = '1' + numeroLimpio;
    }

    const mensaje = encodeURIComponent(`Hola ${nombreCliente},\nLe escribo de su compañía de gestión de cobranza. Me gustaría hablar sobre su saldo pendiente y las opciones de pago disponibles. ¿Podría indicarnos un buen momento para contactarle?\n\nGracias.`);
    
    const whatsappUrl = `https://wa.me/${numeroLimpio}?text=${mensaje}`;
    window.open(whatsappUrl, '_blank');
}

async function geocodificarCliente(clienteId, boton) {
    const fila = boton.closest('tr');
    const celdas = fila.querySelectorAll('td');
    let direccion = celdas[2].textContent.split('🌍')[0].trim();
    const statusElement = document.getElementById(`geo-status-${clienteId}`);
    const botonGeo = fila.querySelector('.btn-geo');

    if (!direccion || direccion === "-") {
        statusElement.textContent = "Sin dirección";
        statusElement.className = "geo-status geo-error";
        return;
    }

    direccion = direccion.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/,+/g, ',').trim();

    statusElement.textContent = "Buscando coordenadas...";
    statusElement.className = "geo-status geo-loading";
    botonGeo.disabled = true;
    botonGeo.innerHTML = '⌛ Procesando';

    try {
        const response = await fetch('/actualizar-coordenadas', {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clienteId, direccion })
        });

        const data = await response.json();

        if (data.status === "ok") {
            // CORRECCIÓN FINAL EN ESTA LÍNEA
            statusElement.innerHTML = `
                <span class="geo-status geo-success">✓ Ubicada</span>
                <button onclick="abrirEnGoogleMaps(${data.lat}, ${data.lng}, '${CSS.escape(data.direccion_formateada || direccion)}')" class="btn-map-shortcut">Ver en Mapa</button>
            `;
            botonGeo.innerHTML = '🌍 Ubicada';
            botonGeo.style.backgroundColor = '#4CAF50';
            
            if (document.getElementById('mapa') && mapInstance) {
                const nombreCliente = fila.querySelector('td:first-child').textContent;
                mostrarClienteEnMapa(mapInstance, data.lat, data.lng, data.direccion_formateada || direccion, nombreCliente);
            }
        } else {
            let mensajeError = data.mensaje || "Error en geocodificación";
            if (data.detalle) mensajeError += ` (${data.detalle})`;
            if (data.sugerencia) mensajeError += `. ${data.sugerencia}`;
            statusElement.textContent = mensajeError;
            statusElement.className = "geo-status geo-error";
            botonGeo.innerHTML = '🌍 Reintentar';
            console.error("Error en geocodificación devuelto por servidor:", data);
        }
    } catch (error) {
        statusElement.textContent = "Error de conexión al geocodificar";
        statusElement.className = "geo-status geo-error";
        botonGeo.innerHTML = '🌍 Reintentar';
        console.error("Error en fetch geocodificarCliente:", error);
    } finally {
        botonGeo.disabled = false;
         if (!statusElement.textContent.includes('✓ Ubicada')) {
             botonGeo.style.backgroundColor = '';
         }
    }
}

function mostrarRuta(map, directionsRenderer, origen, cliente) {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps API no está disponible.");
        document.getElementById('info-ruta').innerHTML = '<p class="error">Google Maps API no disponible.</p>';
        return;
    }

    const destino = { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) };
    
    const directionsService = new google.maps.DirectionsService();

    directionsService.route({
        origin: origen,
        destination: destino,
        travelMode: google.maps.TravelMode.DRIVING
    }, (response, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            directionsRenderer.setDirections(response);
            
            const route = response.routes[0];
            const leg = route.legs[0];
            let instructionsHTML = '<h4>Indicaciones detalladas:</h4><ol style="padding-left: 20px; max-height: 200px; overflow-y: auto;">';
            leg.steps.forEach(step => {
                instructionsHTML += `<li style="margin-bottom: 5px;">${step.instructions} <span style="font-size:0.9em; color:#555;">(${step.distance.text}, ${step.duration.text})</span></li>`;
            });
            instructionsHTML += '</ol>';

            const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lng}&destination=${destino.lat},${destino.lng}&travelmode=driving`;
            const navigationLink = `<a href="${googleMapsUrl}" target="_blank" class="btn-navegar" style="display:inline-block; margin-top:15px; padding:10px 18px; background-color:#28a745; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">🗺️ Abrir en Google Maps</a>`;

            document.getElementById('info-ruta').innerHTML = `
                <h3>Ruta a ${cliente.nombre}</h3>
                <p><strong>Desde:</strong> Tu ubicación actual</p>
                <p><strong>Hacia:</strong> ${direccion || 'No disponible'}</p>
                <p><strong>Distancia Total:</strong> ${leg.distance.text}</p>
                <p><strong>Duración Estimada:</strong> ${leg.duration.text}</p>
                ${navigationLink}
                ${instructionsHTML}
            `;
        } else {
            console.warn('Error al calcular la ruta en mostrarRuta: ' + status);
            document.getElementById('info-ruta').innerHTML = `
                <h3>Cliente: ${cliente.nombre}</h3>
                <p><strong>Dirección:</strong> ${direccion}</p>
                <p class="info">No se pudo calcular la ruta desde tu ubicación. Verifica los permisos de ubicación.</p>`;
        }
    });
}


function mostrarClienteEnMapa(map, lat, lng, direccion, nombreCliente) {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps API no está disponible.");
        document.getElementById('info-ruta').innerHTML = '<p class="error">Google Maps API no disponible.</p>';
        return;
    }

    const clientePos = { lat: parseFloat(lat), lng: parseFloat(lng) };

    new google.maps.Marker({
        position: clientePos,
        map: map,
        title: nombreCliente,
        icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" // Cliente en rojo
    });
    map.setCenter(clientePos);

    document.getElementById('info-ruta').innerHTML = `<h3>Cliente: ${nombreCliente}</h3><p><strong>Dirección:</strong> ${direccion}</p><p>Calculando ruta...</p>`;

    const geoTimeout = setTimeout(() => {
        console.warn("Tiempo de espera agotado para la geolocalización. Verifique permisos o conexión.");
        document.getElementById('info-ruta').innerHTML = '<p class="error">No se pudo obtener su ubicación. Tiempo de espera agotado.</p>';
    }, 15000);


    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(geoTimeout);
                const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                new google.maps.Marker({
                    position: userPos,
                    map: map,
                    title: "Tu ubicación actual",
                    icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" // Usuario en azul
                });

                const directionsService = new google.maps.DirectionsService();
                const directionsRenderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true });

                mostrarRuta(map, directionsRenderer, userPos, { lat: lat, lng: lng, nombre: nombreCliente, direccion: direccion });

            },
            (error) => {
                clearTimeout(geoTimeout);
                console.warn("Error obteniendo ubicación del usuario:", error.message);
                let errorMsg = "Error al obtener tu ubicación: ";
                switch(error.code) {
                    case error.PERMISSION_DENIED: errorMsg += "Permiso denegado."; break;
                    case error.POSITION_UNAVAILABLE: errorMsg += "Información de ubicación no disponible."; break;
                    case error.TIMEOUT: errorMsg += "Tiempo de espera agotado."; break;
                    default: errorMsg += "Error desconocido."; break;
                }
                document.getElementById('info-ruta').innerHTML = `<p class="error">${errorMsg} Asegúrate de haber concedido permisos de ubicación.</p>`;
            }, 
            { timeout: 10000, enableHighAccuracy: true }
        );
    } else {
        document.getElementById('info-ruta').innerHTML = `
            <h3>Cliente: ${nombreCliente}</h3>
            <p><strong>Dirección:</strong> ${direccion}</p>
            <p class="info">La geolocalización no es soportada por tu navegador para calcular la ruta.</p>`;
    }
}


function cargarTodosLosClientes() {
    fetch("/clientes")
        .then(res => {
            if (!res.ok) throw new Error(`Error ${res.status}`);
            return res.json();
        })
        .then(allClients => {
            const clientesNoAsignados = allClients.filter(c => c.asignado_a === null);

            const tbody = document.querySelector("#tablaAsignarClientes tbody");
            tbody.innerHTML = "";

            if (clientesNoAsignados.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8">No hay clientes no asignados en el sistema</td></tr>`;
                return;
            }
            
            fetch("/usuarios")
                .then(resUsuarios => resUsuarios.json())
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
                            <td>${cliente.telefono ? `<a href="tel:<span class="math-inline">\{cliente\.telefono\}" class\="telefono\-link"\></span>{cliente.telefono}</a>` : "-"}</td>
                            <td>${cliente.direccion || "-"}</td>
                            <td>${cliente.tarifa || "-"}</td>
                            <td>${cliente.saldo_exigible || "-"}</td>
                            <td>${cliente.saldo || "-"}</td>
                            <td>
                                <select class="usuarioSelect" data-id="${cliente.id}">
                                    <option value="">-- Sin asignar --</option>
                                    ${usuarios.map(u => `<option value="${u.id}" <span class="math-inline">\{cliente\.asignado\_a \=\=\= u\.id ? "selected" \: ""\}\></span>{u.nombre}</option>`).join("")}
                                </select>
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
                })
                .catch(errorUsuarios => {
                     console.error("Error al cargar usuarios para asignación:", errorUsuarios);
                     tbody.innerHTML = `<tr><td colspan="8" class="error">Error al cargar la lista de usuarios.</td></tr>`;
                });
        })
        .catch(error => {
            console.error("Error al cargar todos los clientes:", error);
            document.querySelector("#tablaAsignarClientes tbody").innerHTML = `<tr><td colspan="8" class="error">Error al cargar clientes.</td></tr>`;
        });
}

function inicializarMapaManual() {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps API no se cargó correctamente. No se puede inicializar el mapa.");
        document.getElementById('info-ruta').innerHTML = '<p class="error">Google Maps no está disponible. Intenta recargar o verifica tu conexión.</p>';
        return;
    }

    const mapaElement = document.getElementById('mapa');
    if (!mapaElement) {
        console.error("Elemento del mapa no encontrado en el DOM.");
        return;
    }

    if (!mapInstance) {
        mapInstance = new google.maps.Map(mapaElement, {
            zoom: 12,
            center: { lat: 19.4326, lng: -99.1332 },
            mapTypeControl: true,
            streetViewControl: true,
        });
    }
    if (!directionsRendererInstance) {
        directionsRendererInstance = new google.maps.DirectionsRenderer({ suppressMarkers: true });
    }
    directionsRendererInstance.setMap(mapInstance);

    document.getElementById('info-ruta').innerHTML = '<p class="info">Obteniendo tu ubicación...</p>';

    const geoTimeout = setTimeout(() => {
        console.warn("Tiempo de espera agotado para la geolocalización. Verifique permisos o conexión.");
        document.getElementById('info-ruta').innerHTML = '<p class="error">No se pudo obtener su ubicación. Tiempo de espera agotado.</p>';
    }, 15000);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                clearTimeout(geoTimeout);
                const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

                directionsRendererInstance.setDirections({routes: []});
                gestoresMarkers.forEach(marker => marker.setMap(null));
                gestoresMarkers = [];

                new google.maps.Marker({
                    position: userPos,
                    map: mapInstance,
                    title: esAdmin ? "Ubicación del Admin" : "Tu ubicación actual",
                    icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" // Icono azul para el Admin/Usuario
                });

                mapInstance.setCenter(userPos);
                mapInstance.setZoom(13);


                try {
                    if (esAdmin) {
                        await cargarYMostrarGestoresEnMapa();
                        document.getElementById('info-ruta').innerHTML = '<p class="info">Mapa cargado. Actualizando ubicaciones de gestores cada 30 min.</p>';

                    } else { // Si es gestor
                        if (!usuarioActual || usuarioActual.id === undefined) {
                             document.getElementById('info-ruta').innerHTML = '<p class="error">No se pudo identificar al usuario.</p>';
                             return;
                        }
                        const response = await fetch(`/clientes/${usuarioActual.id}`);
                        if (!response.ok) throw new Error(`Error al obtener clientes: ${response.status}`);
                        const clientes = await response.json();
                        
                        const clientesConCoords = clientes.filter(c => c.lat && c.lng);
                        
                        if (clientesConCoords.length === 0) {
                            document.getElementById('info-ruta').innerHTML = `
                                <p class="info">No tienes clientes asignados con coordenadas válidas para mostrar en el mapa.</p>
                                <p>Usa el botón "🌍 Geolocalizar" junto a cada dirección en tu lista de clientes.</p>`;
                            return;
                        }

                        clientesConCoords.forEach(cliente => {
                            const marker = new google.maps.Marker({
                                position: { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) },
                                map: mapInstance,
                                title: `${cliente.nombre}\n${cliente.direccion || ''}`,
                                icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" // Clientes en rojo
                            });
                            marker.addListener('click', () => {
                                mostrarRuta(mapInstance, directionsRendererInstance, userPos, cliente);
                            });
                        });
                        
                        const clienteCercano = encontrarClienteMasCercano(userPos, clientesConCoords);
                        if (clienteCercano) {
                            mostrarRuta(mapInstance, directionsRendererInstance, userPos, clienteCercano);
                        } else {
                             document.getElementById('info-ruta').innerHTML = '<p class="info">Calcula la ruta a un cliente haciendo clic en su marcador.</p>';
                        }
                    }
                    
                } catch (error) {
                    console.error("Error al cargar o procesar datos en inicializarMapa:", error);
                    document.getElementById('info-ruta').innerHTML = `<p class="error">Error al cargar datos: ${error.message}</p>`;
                }
            },
            (error) => {
                clearTimeout(geoTimeout);
                console.warn("Error obteniendo ubicación del usuario:", error.message);
                let errorMsg = "Error al obtener tu ubicación: ";
                switch(error.code) {
                    case error.PERMISSION_DENIED: errorMsg += "Permiso denegado."; break;
                    case error.POSITION_UNAVAILABLE: errorMsg += "Información de ubicación no disponible."; break;
                    case error.TIMEOUT: errorMsg += "Tiempo de espera agotado."; break;
                    default: errorMsg += "Error desconocido."; break;
                }
                document.getElementById('info-ruta').innerHTML = `<p class="error">${errorMsg} Asegúrate de haber concedido permisos de ubicación.</p>`;
            },
            { timeout: 10000, enableHighAccuracy: true }
        );
    } else {
        document.getElementById('info-ruta').innerHTML = '<p class="info">Tu navegador no soporta geolocalización para cargar el mapa.</p>';
    }
}


function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function encontrarClienteMasCercano(posicionActual, clientes) {
    if (!posicionActual || !clientes || clientes.length === 0) return null;
    
    let clienteMasCercano = null;
    let distanciaMinima = Infinity;

    clientes.forEach(cliente => {
        if (cliente.lat && cliente.lng) {
            const distancia = calcularDistancia(
                posicionActual.lat, posicionActual.lng,
                parseFloat(cliente.lat), parseFloat(cliente.lng)
            );
            if (distancia < distanciaMinima) {
                distanciaMinima = distancia;
                clienteMasCercano = cliente;
            }
        }
    });
    return clienteMasCercano;
}


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
        setTimeout(() => { originalText; }, 3000);
        resultadoSelect.focus();
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Registrando...';

    fetch("/llamadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            cliente_id: clienteId,
            usuario_id: usuarioActual.id,
            fecha: new Date().toISOString().split("T")[0],
            monto_cobrado: monto || 0,
            resultado,
            observaciones: observaciones || ""
        })
    })
    .then(res => {
        if (!res.ok) { 
            return res.json().then(errorData => {
                throw new Error(errorData.mensaje || `Error HTTP ${res.status}`);
            });
        }
        return res.json();
    })
    .then(data => {
        if (data.status === "ok") {
            fila.style.transition = "opacity 0.5s ease-out";
            fila.style.opacity = "0";
            setTimeout(() => {
                fila.remove();
                if (document.querySelectorAll("#tablaClientes tbody tr").length === 0) {
                    document.querySelector("#tablaClientes tbody").innerHTML = `<tr><td colspan="10">¡Todos los clientes asignados han sido procesados!</td></tr>`;
                }
                if (esAdmin) cargarKPIsConFecha();
            }, 500);
        } else {
            const errorCell = fila.querySelector('td:last-child');
            errorCell.innerHTML = `<span style="color:red;">${data.mensaje || "Error"}</span>`;
             btn.disabled = false;
             btn.textContent = 'Registrar';
        }
    })
    .catch(error => {
        console.error("Error en fetch registrarLlamada:", error);
        const errorCell = fila.querySelector('td:last-child');
        errorCell.innerHTML = `<span style="color:red;">${error.message}</span> <button onclick="registrarLlamada(this, ${clienteId})">Reintentar</button>`;
        btn.disabled = false;
        btn.textContent = 'Registrar';
    });
}


function cerrarSesion() {
    localStorage.removeItem("user");
    window.location.href = "/";
}

function guardarAsignaciones() {
    const actualizaciones = Array.from(document.querySelectorAll("#tablaAsignarClientes .usuarioSelect")).map(select => ({
        id: parseInt(select.dataset.id),
        asignado_a: select.value ? parseInt(select.value) : null
    }));

    if (actualizaciones.length === 0) {
        const mensajeContenedor = document.getElementById('seccionAsignacion');
        if(mensajeContenedor){
            let msgEl = mensajeContenedor.querySelector('.admin-message');
            if(!msgEl){
                msgEl = document.createElement('p');
                msgEl.className = 'admin-message info';
                mensajeContenedor.insertBefore(msgEl, document.getElementById('tablaAsignarClientes'));
            }
            msgEl.textContent = "No hay cambios en las asignaciones para guardar.";
            setTimeout(() => msgEl.textContent = '', 3000);
        }
        return;
    }
    
    const botonGuardar = document.querySelector('button[onclick="guardarAsignaciones()"]');
    if(botonGuardar) {
        botonGuardar.disabled = true;
        botonGuardar.textContent = 'Guardando...';
    }


    fetch("/actualizar-clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientes: actualizaciones })
    })
    .then(res => {
        if (!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
        return res.json();
    })
    .then(data => {
        const mensajeContenedor = document.getElementById('seccionAsignacion');
         if(mensajeContenedor){
            let msgEl = mensajeContenedor.querySelector('.admin-message');
            if(!msgEl){
                msgEl = document.createElement('p');
                msgEl.className = 'admin-message success';
                mensajeContenedor.insertBefore(msgEl, document.getElementById('tablaAsignarClientes'));
            }
            msgEl.className = 'admin-message success';
            msgEl.textContent = `✅ ${data.mensaje || 'Asignaciones guardadas exitosamente!'}`;
            setTimeout(() => msgEl.textContent = '', 3000);
        }
        cargarTodosLosClientes();
        if (!esAdmin && usuarioActual) cargarClientes(usuarioActual.id);
        if (esAdmin) cargarKPIsConFecha();
    })
    .catch(error => {
        console.error("Error al guardar asignaciones:", error);
         const mensajeContenedor = document.getElementById('seccionAsignacion');
         if(mensajeContenedor){
            let msgEl = mensajeContenedor.querySelector('.admin-message');
             if(!msgEl){
                msgEl = document.createElement('p');
                msgEl.className = 'admin-message error';
                mensajeContenedor.insertBefore(msgEl, document.getElementById('tablaAsignarClientes'));
            }
            msgEl.className = 'admin-message error';
            msgEl.textContent = `❌ Error al guardar: ${error.message}`;
        }
    }).finally(() => {
        if(botonGuardar) {
            botonGuardar.disabled = false;
            botonGuardar.textContent = '💾 Guardar Asignaciones Individuales';
        }
    });
}

function toggleAllClients(source) {
    const checkboxes = document.querySelectorAll('.client-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = source.checked;
    });
}

async function asignarClientesMasivamente() {
    const selectedUserElement = document.getElementById('massAssignUserSelect');
    const targetUserId = selectedUserElement.value ? parseInt(selectedUserElement.value) : null;
    const massAssignMessage = document.getElementById('massAssignMessage');
    const assignButton = document.querySelector('button[onclick="asignarClientesMasivamente()"]');

    if (targetUserId === null) {
        massAssignMessage.className = 'error';
        massAssignMessage.textContent = "❌ Por favor, selecciona un usuario para la asignación masiva.";
        setTimeout(() => massAssignMessage.textContent = '', 4000);
        return;
    }

    const selectedClientCheckboxes = document.querySelectorAll('.client-checkbox:checked');
    if (selectedClientCheckboxes.length === 0) {
        massAssignMessage.className = 'info';
        massAssignMessage.textContent = "ℹ️ No hay clientes seleccionados para asignar.";
        setTimeout(() => massAssignMessage.textContent = '', 4000);
        return;
    }

    if (!confirm(`¿Está seguro de asignar ${selectedClientCheckboxes.length} clientes al usuario seleccionado?`)) {
        return;
    }

    const clientesToUpdate = Array.from(selectedClientCheckboxes).map(checkbox => ({
        id: parseInt(checkbox.dataset.id),
        asignado_a: targetUserId
    }));

    assignButton.disabled = true;
    assignButton.textContent = 'Asignando...';
    massAssignMessage.className = 'info';
    massAssignMessage.textContent = `Asignando ${clientesToUpdate.length} clientes...`;

    try {
        const response = await fetch("/actualizar-clientes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientes: clientesToUpdate })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`Error HTTP ${res.status}`);
        }

        massAssignMessage.className = 'success';
        massAssignMessage.textContent = `✅ ${data.mensaje || `${clientesToUpdate.length} clientes asignados masivamente.`}`;
        
        document.getElementById('selectAllClients').checked = false;
        toggleAllClients(document.getElementById('selectAllClients'));
        selectedUserElement.value = '';
        cargarTodosLosClientes();
        if (esAdmin) cargarKPIsConFecha();
    } catch (error) {
        console.error("Error al asignar clientes masivamente:", error);
        massAssignMessage.className = 'error';
        massAssignMessage.textContent = `❌ Error al asignar clientes: ${error.message}`;
    }).finally(() => {
        assignButton.disabled = false;
        assignButton.textContent = '🚀 Asignar Clientes Seleccionados';
        setTimeout(() => massAssignMessage.textContent = '', 5000);
    });
}


function cargarUsuarios() {
    fetch("/usuarios")
        .then(res => {
            if (!res.ok) throw new Error(`Error ${res.status}`);
            return res.json();
        })
        .then(usuarios => {
            const tbody = document.querySelector("#tablaUsuarios tbody");
            tbody.innerHTML = "";
            if (usuarios.length === 0) { 
                tbody.innerHTML = `<tr><td colspan="3">No hay usuarios (aparte del admin)</td></tr>`;
                return;
            }
                
            usuarios.forEach(usuario => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${usuario.id}</td>
                    <td>${usuario.nombre}</td>
                    <td><button onclick="eliminarUsuario(${usuario.id})" class="btn-eliminar" style="background-color:#f44336;">🗑️ Eliminar</button></td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(error => {
            console.error("Error al cargar usuarios:", error);
            document.querySelector("#tablaUsuarios tbody").innerHTML = `<tr><td colspan="3" class="error">Error al cargar usuarios: ${error.message}`;
        });
}

function agregarUsuario() {
    const nombreInput = document.getElementById("nuevoUsuarioNombre");
    const passwordInput = document.getElementById("nuevoUsuarioPassword");
    const nombre = nombreInput.value.trim();
    const password = passwordInput.value.trim();

    const botonAgregar = document.querySelector('button[onclick="agregarUsuario()"]');

    if (!nombre || !password) {
        const msgEl = obtenerMensajeAdmin("seccionAdmin", ".admin-message");
        msgEl.className = 'admin-message error';
        msgEl.textContent = "❌ Nombre y contraseña son obligatorios.";
        return;
    }
    
    if(botonAgregar) {
        botonAgregar.disabled = true;
        botonAgregar.textContent = 'Agregando...';
    }

    fetch("/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, password })
    })
    .then(res => {
        if (!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
        return res.json();
    })
    .then(data => {
        if (data.status === "ok") {
            const msgEl = obtenerMensajeAdmin("seccionAdmin", ".admin-message");
            msgEl.className = 'admin-message success';
            msgEl.textContent = `✅ Usuario "${data.usuario.nombre}" creado exitosamente.`