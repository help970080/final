let usuarioActual = null;
let esAdmin = false;
// Variable global para DirectionsRenderer para reutilizarlo si es necesario, o se puede crear localmente.
// Por ahora, se creará localmente en las funciones que lo necesiten.

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

window.addEventListener("load", () => {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData && window.location.pathname.includes("clientes.html")) {
        // No mostrar alert, simplemente redirigir si es necesario o manejar de otra forma.
        // alert("Debes iniciar sesión primero."); 
        console.log("Usuario no autenticado, redirigiendo a login.");
        window.location.href = "/";
        return;
    }

    usuarioActual = userData;
    if (!usuarioActual) return;

    esAdmin = usuarioActual.id === 0;
    
    if (window.location.pathname.includes("clientes.html")) {
        document.getElementById("nombreUsuario").textContent = usuarioActual.usuario;

        if (esAdmin) {
            document.getElementById("seccionAdmin").classList.remove("hidden");
            document.getElementById("seccionAsignacion").classList.remove("hidden");
            cargarTodosLosClientes();
            cargarUsuarios();
        } else {
            document.getElementById("seccionAdmin").classList.add("hidden");
            document.getElementById("seccionAsignacion").classList.add("hidden");
            cargarClientes(usuarioActual.id);
        }
        // La función inicializarMapa se llama mediante el callback en la URL de la API de Google Maps,
        // o mediante el botón "Mostrar Ruta".
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
                    <td>${cliente.telefono ? `<a href="tel:${cliente.telefono}" class="telefono-link">${cliente.telefono}</a>` : "-"}</td>
                    <td>${cliente.direccion || "-"}
                      <button onclick="geocodificarCliente(${cliente.id}, this)" class="btn-geo">
                        🌍 Geolocalizar
                      </button>
                      <span id="geo-status-${cliente.id}" class="geo-status">
                        ${cliente.lat && cliente.lng ? '✓ Ubicada' : ''}
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
            // Considerar mostrar mensaje en la UI en lugar de alert
            document.querySelector("#tablaClientes tbody").innerHTML = `<tr><td colspan="10" class="error">Error al cargar clientes asignados.</td></tr>`;
        });
}

async function geocodificarCliente(clienteId, boton) {
    const fila = boton.closest('tr');
    const celdas = fila.querySelectorAll('td');
    let direccion = celdas[2].textContent.split('🌍')[0].trim(); // Obtener solo el texto de la dirección
    const statusElement = document.getElementById(`geo-status-${clienteId}`);
    const botonGeo = fila.querySelector('.btn-geo');

    if (!direccion || direccion === "-") {
        statusElement.textContent = "Sin dirección";
        statusElement.className = "geo-status geo-error";
        return;
    }

    // Limpieza de la dirección
    direccion = direccion.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/,+/g, ',').trim();

    statusElement.textContent = "Buscando coordenadas...";
    statusElement.className = "geo-status geo-loading";
    botonGeo.disabled = true;
    botonGeo.innerHTML = '⌛ Procesando';

    try {
        const response = await fetch('/actualizar-coordenadas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clienteId, direccion })
        });

        const data = await response.json();

        if (data.status === "ok") {
            statusElement.textContent = `✓ Ubicada (${data.direccion_formateada || 'Coords: ' + data.lat.toFixed(5) + ', ' + data.lng.toFixed(5)})`;
            statusElement.className = "geo-status geo-success";
            botonGeo.innerHTML = '🌍 Ubicada';
            botonGeo.style.backgroundColor = '#4CAF50';
            
            // Mostrar este cliente específico en el mapa y la ruta si es posible
            if (document.getElementById('mapa') && window.mostrarClienteEnMapa) {
                const nombreCliente = fila.querySelector('td:first-child').textContent;
                // Pasamos el mapa como argumento si lo tenemos disponible globalmente o lo reinicializamos
                const mapaElement = document.getElementById('mapa');
                const map = new google.maps.Map(mapaElement, { // Se reinicializa el mapa aquí
                    zoom: 15,
                    center: { lat: parseFloat(data.lat), lng: parseFloat(data.lng) },
                    mapTypeControl: true,
                    streetViewControl: true
                });
                mostrarClienteEnMapa(map, data.lat, data.lng, data.direccion_formateada || direccion, nombreCliente);
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
        botonGeo.disabled = false; // Siempre re-habilitar el botón
         if (!statusElement.textContent.includes('✓ Ubicada')) {
             botonGeo.style.backgroundColor = ''; // Restablecer color si falló
         }
    }
}

/**
 * Muestra un cliente específico en el mapa y, si es posible, la ruta desde la ubicación del usuario.
 * @param {google.maps.Map} map - Instancia del mapa de Google.
 * @param {number} lat - Latitud del cliente.
 * @param {number} lng - Longitud del cliente.
 * @param {string} direccion - Dirección del cliente.
 * @param {string} nombreCliente - Nombre del cliente.
 */
function mostrarClienteEnMapa(map, lat, lng, direccion, nombreCliente) {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps API no está disponible.");
        document.getElementById('info-ruta').innerHTML = '<p class="error">Google Maps API no disponible.</p>';
        return;
    }

    const clientePos = { lat: parseFloat(lat), lng: parseFloat(lng) };

    // Marcador del cliente
    new google.maps.Marker({
        position: clientePos,
        map: map,
        title: nombreCliente,
        icon: "https://maps.google.com/mapfiles/ms/icons/red-dot.png" // Icono rojo para el cliente
    });
    map.setCenter(clientePos); // Centrar mapa en el cliente

    document.getElementById('info-ruta').innerHTML = `<h3>Cliente: ${nombreCliente}</h3><p><strong>Dirección:</strong> ${direccion}</p><p>Calculando ruta...</p>`;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                new google.maps.Marker({ // Marcador del usuario
                    position: userPos,
                    map: map,
                    title: "Tu ubicación actual",
                    icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png" // Icono azul para el usuario
                });

                const directionsService = new google.maps.DirectionsService();
                const directionsRenderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true }); // Suprimir marcadores por defecto de renderer

                directionsService.route({
                    origin: userPos,
                    destination: clientePos,
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

                        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${userPos.lat},${userPos.lng}&destination=${clientePos.lat},${clientePos.lng}&travelmode=driving`;
                        const navigationLink = `<a href="${googleMapsUrl}" target="_blank" class="btn-navegar" style="display:inline-block; margin-top:15px; padding:10px 18px; background-color:#28a745; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">🗺️ Abrir en Google Maps</a>`;

                        document.getElementById('info-ruta').innerHTML = `
                            <h3>Ruta a ${nombreCliente}</h3>
                            <p><strong>Desde:</strong> Tu ubicación actual</p>
                            <p><strong>Hacia:</strong> ${direccion || 'No disponible'}</p>
                            <p><strong>Distancia Total:</strong> ${leg.distance.text}</p>
                            <p><strong>Duración Estimada:</strong> ${leg.duration.text}</p>
                            ${navigationLink}
                            ${instructionsHTML}
                        `;
                    } else {
                        console.warn('Error al calcular la ruta en mostrarClienteEnMapa: ' + status);
                        document.getElementById('info-ruta').innerHTML = `
                            <h3>Cliente: ${nombreCliente}</h3>
                            <p><strong>Dirección:</strong> ${direccion}</p>
                            <p class="info">No se pudo calcular la ruta desde tu ubicación. Verifica los permisos de ubicación.</p>`;
                    }
                });
            },
            (error) => {
                console.warn("Error obteniendo ubicación del usuario:", error.message);
                document.getElementById('info-ruta').innerHTML = `
                    <h3>Cliente: ${nombreCliente}</h3>
                    <p><strong>Dirección:</strong> ${direccion}</p>
                    <p class="info">No se pudo obtener tu ubicación para calcular la ruta.</p>`;
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
            if (!res.ok) throw new Error('Error al cargar todos los clientes');
            return res.json();
        })
        .then(clientes => {
            const tbody = document.querySelector("#tablaAsignarClientes tbody");
            tbody.innerHTML = ""; // Limpiar tabla antes de llenar

            if (clientes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7">No hay clientes registrados en el sistema</td></tr>`;
                return;
            }
            
            fetch("/usuarios") // Obtener lista de usuarios para el dropdown
                .then(resUsuarios => resUsuarios.json())
                .then(usuarios => {
                    clientes.forEach(cliente => {
                        const tr = document.createElement("tr");
                        tr.innerHTML = `
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
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
                })
                .catch(errorUsuarios => {
                     console.error("Error al cargar usuarios para asignación:", errorUsuarios);
                     tbody.innerHTML = `<tr><td colspan="7" class="error">Error al cargar la lista de usuarios.</td></tr>`;
                });
        })
        .catch(error => {
            console.error("Error al cargar todos los clientes:", error);
            document.querySelector("#tablaAsignarClientes tbody").innerHTML = `<tr><td colspan="7" class="error">Error al cargar clientes.</td></tr>`;
        });
}
// Variable global para el mapa y el renderer para que no se creen múltiples instancias innecesariamente
let mapInstance = null;
let directionsRendererInstance = null;

function inicializarMapa() {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps API no se cargó correctamente. Reintentando...");
        // No mostrar alert, el usuario ya tiene un botón para reintentar.
        document.getElementById('info-ruta').innerHTML = '<p class="error">Google Maps no está disponible. Intenta recargar o verifica tu conexión.</p>';
        return; // Salir si Google Maps no está listo
    }

    const mapaElement = document.getElementById('mapa');
    if (!mapaElement) {
        console.error("Elemento del mapa no encontrado en el DOM.");
        return;
    }

    // Inicializar el mapa si aún no existe
    if (!mapInstance) {
        mapInstance = new google.maps.Map(mapaElement, {
            zoom: 12,
            center: { lat: 19.4326, lng: -99.1332 }, // Centro en CDMX por defecto
            mapTypeControl: true,
            streetViewControl: true,
            // Considerar añadir más opciones como zoomControl, scaleControl etc.
        });
    }
     // Inicializar DirectionsRenderer si aún no existe y asociarlo al mapa
    if (!directionsRendererInstance) {
        directionsRendererInstance = new google.maps.DirectionsRenderer({ suppressMarkers: true }); // Suprimir marcadores por defecto
    }
    directionsRendererInstance.setMap(mapInstance); // Siempre asegurarse que está en el mapa actual


    if (!navigator.geolocation) {
        document.getElementById('info-ruta').innerHTML = '<p class="info">Tu navegador no soporta geolocalización.</p>';
        return;
    }
    
    document.getElementById('info-ruta').innerHTML = '<p class="info">Obteniendo tu ubicación...</p>';

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

            // Limpiar rutas anteriores del renderer
            directionsRendererInstance.setDirections({routes: []});


            // Marcador para la ubicación del usuario (azul)
            new google.maps.Marker({
                position: userPos,
                map: mapInstance,
                title: "Tú estás aquí",
                icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
            });
            mapInstance.setCenter(userPos); // Centrar mapa en la ubicación del usuario
            mapInstance.setZoom(13);


            try {
                // Solo obtener clientes asignados al usuario actual (no admin)
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

                // Marcadores para los clientes (rojos)
                clientesConCoords.forEach(cliente => {
                    const marker = new google.maps.Marker({
                        position: { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) },
                        map: mapInstance,
                        title: `${cliente.nombre}\n${cliente.direccion || ''}`,
                        icon: "https://maps.google.com/mapfiles/ms/icons/red-dot.png"
                    });
                    // Event listener para mostrar ruta al hacer clic en un marcador de cliente
                    marker.addListener('click', () => {
                        mostrarRuta(mapInstance, directionsRendererInstance, userPos, cliente);
                    });
                });
                
                // Encontrar y mostrar ruta al cliente más cercano
                const clienteCercano = encontrarClienteMasCercano(userPos, clientesConCoords);
                if (clienteCercano) {
                    mostrarRuta(mapInstance, directionsRendererInstance, userPos, clienteCercano);
                } else {
                     document.getElementById('info-ruta').innerHTML = '<p class="info">Calcula la ruta a un cliente haciendo clic en su marcador.</p>';
                }
                
            } catch (error) {
                console.error("Error al cargar o procesar clientes en inicializarMapa:", error);
                document.getElementById('info-ruta').innerHTML = `<p class="error">Error al cargar clientes: ${error.message}</p>`;
            }
        },
        (error) => {
            console.warn("Error al obtener ubicación del usuario:", error.message);
            let errorMsg = "Error al obtener tu ubicación: ";
            switch(error.code) {
                case error.PERMISSION_DENIED: errorMsg += "Permiso denegado."; break;
                case error.POSITION_UNAVAILABLE: errorMsg += "Información de ubicación no disponible."; break;
                case error.TIMEOUT: errorMsg += "Tiempo de espera agotado."; break;
                default: errorMsg += "Error desconocido."; break;
            }
            document.getElementById('info-ruta').innerHTML = `<p class="error">${errorMsg} Asegúrate de haber concedido permisos de ubicación.</p>`;
        },
        { timeout: 10000, enableHighAccuracy: true } // Opciones para geolocalización
    );
}


/**
 * Calcula la distancia haversine entre dos puntos geográficos.
 * @param {number} lat1 Latitud del primer punto.
 * @param {number} lon1 Longitud del primer punto.
 * @param {number} lat2 Latitud del segundo punto.
 * @param {number} lon2 Longitud del segundo punto.
 * @returns {number} Distancia en kilómetros.
 */
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distancia en km
}

/**
 * Encuentra el cliente más cercano a una posición dada.
 * @param {{lat: number, lng: number}} posicionActual - Posición del usuario.
 * @param {Array<Object>} clientes - Array de objetos cliente con propiedades lat, lng.
 * @returns {Object|null} El cliente más cercano o null si no hay clientes.
 */
function encontrarClienteMasCercano(posicionActual, clientes) {
    if (!posicionActual || !clientes || clientes.length === 0) return null;
    
    let clienteMasCercano = null;
    let distanciaMinima = Infinity;

    clientes.forEach(cliente => {
        if (cliente.lat && cliente.lng) { // Asegurarse que el cliente tiene coordenadas
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


/**
 * Muestra la ruta en el mapa y proporciona información detallada.
 * @param {google.maps.Map} map - Instancia del mapa.
 * @param {google.maps.DirectionsRenderer} directionsRenderer - Instancia del renderizador de direcciones.
 * @param {{lat: number, lng: number}} origen - Coordenadas de origen (usuario).
 * @param {Object} cliente - Objeto del cliente con lat, lng, nombre, direccion.
 */
function mostrarRuta(map, directionsRenderer, origen, cliente) {
    if (!origen || !cliente || !cliente.lat || !cliente.lng) {
        console.warn("Origen o destino inválido para mostrarRuta.");
        document.getElementById('info-ruta').innerHTML = '<p class="error">No se pueden mostrar detalles de la ruta: faltan coordenadas de origen o destino.</p>';
        return;
    }
    const destino = { lat: parseFloat(cliente.lat), lng: parseFloat(cliente.lng) };
    
    const directionsService = new google.maps.DirectionsService();

    directionsService.route({
        origin: origen,
        destination: destino,
        travelMode: google.maps.TravelMode.DRIVING // Opcional: permitir al usuario cambiar esto
    }, (response, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            directionsRenderer.setDirections(response); // Dibuja la ruta en el mapa

            const route = response.routes[0];
            if (!route || !route.legs || route.legs.length === 0) {
                document.getElementById('info-ruta').innerHTML = '<p class="error">No se encontraron detalles de la ruta en la respuesta.</p>';
                return;
            }
            const leg = route.legs[0];

            // Construir HTML para las instrucciones paso a paso
            let instructionsHTML = '<h4>Indicaciones detalladas:</h4><ol style="padding-left: 20px; max-height: 200px; overflow-y: auto; border: 1px solid #eee; padding-top:10px; padding-bottom:10px; background-color: #fff; border-radius: 4px;">';
            leg.steps.forEach(step => {
                instructionsHTML += `<li style="margin-bottom: 8px; padding-left:5px;">${step.instructions} <span style="font-size:0.9em; color:#555;">(${step.distance.text}, ${step.duration.text})</span></li>`;
            });
            instructionsHTML += '</ol>';

            // Construir URL para abrir en Google Maps
            const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lng}&destination=${destino.lat},${destino.lng}&travelmode=driving`;
            const navigationLink = `<a href="${googleMapsUrl}" target="_blank" class="btn-navegar" style="display:inline-block; margin-top:15px; padding:10px 18px; background-color:#28a745; color:white; text-decoration:none; border-radius:5px; font-weight:bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">🗺️ Abrir en Google Maps</a>`;

            // Actualizar el panel de información de la ruta
            document.getElementById('info-ruta').innerHTML = `
                <h3>Ruta a ${cliente.nombre || 'Cliente'}</h3>
                <p><strong>Desde:</strong> Tu ubicación actual</p>
                <p><strong>Hacia:</strong> ${cliente.direccion || 'No disponible'}</p>
                <p style="margin-bottom: 5px;"><strong>Distancia Total:</strong> ${leg.distance.text}</p>
                <p style="margin-top: 0px;"><strong>Duración Estimada:</strong> ${leg.duration.text}</p>
                ${navigationLink}
                ${instructionsHTML}
            `;
        } else {
            console.warn('Error al calcular la ruta en mostrarRuta: ' + status);
            document.getElementById('info-ruta').innerHTML = `<p class="error">No se pudo calcular la ruta. Código de error: ${status}</p>`;
        }
    });
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
        // Usar un mensaje más amigable que alert
        const errorCell = fila.querySelector('td:last-child'); // o una celda específica para mensajes
        const originalText = errorCell.innerHTML;
        errorCell.innerHTML = '<span style="color:red;">Selecciona un resultado</span>';
        setTimeout(() => { errorCell.innerHTML = originalText; }, 3000);
        resultadoSelect.focus();
        return;
    }
    
    // Deshabilitar botón para evitar múltiples envíos
    btn.disabled = true;
    btn.textContent = 'Registrando...';

    fetch("/llamadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            cliente_id: clienteId,
            usuario_id: usuarioActual.id,
            fecha: new Date().toISOString().split("T")[0],
            monto_cobrado: monto || 0, // Enviar 0 si está vacío
            resultado,
            observaciones: observaciones || "" // Enviar cadena vacía si está vacío
        })
    })
    .then(res => {
        // Verificar si la respuesta no es OK (ej. 400, 403, 404, 500)
        if (!res.ok) { 
            return res.json().then(errorData => { // Intentar parsear el JSON del error
                throw new Error(errorData.mensaje || `Error HTTP ${res.status}`);
            });
        }
        return res.json(); // Proceder si la respuesta es OK
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
            }, 500);
        } else {
            // Este else podría no alcanzarse si el !res.ok maneja todos los errores con .mensaje
            // alert(data.mensaje || "Error desconocido al registrar llamada");
            const errorCell = fila.querySelector('td:last-child');
            errorCell.innerHTML = `<span style="color:red;">${data.mensaje || "Error"}</span>`;
             btn.disabled = false; // Re-habilitar botón si hay error
             btn.textContent = 'Registrar';
        }
    })
    .catch(error => {
        console.error("Error en fetch registrarLlamada:", error);
        // alert(`Error: ${error.message}`); // Mostrar el mensaje de error capturado
        const errorCell = fila.querySelector('td:last-child');
        const originalText = errorCell.innerHTML; // Guardar el botón
        errorCell.innerHTML = `<span style="color:red;">${error.message}</span> <button onclick="registrarLlamada(this.nextElementSibling.firstChild, ${clienteId})">Reintentar</button>`;
        // Para que el reintentar funcione, el botón original debe ser pasado correctamente o la función debe encontrarlo de otra manera.
        // Lo más simple es re-habilitar el botón original.
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
        // alert("No hay cambios en las asignaciones para guardar.");
        // Mostrar mensaje en UI
        const mensajeContenedor = document.getElementById('seccionAsignacion'); // O un elemento específico para mensajes
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
    
    const botonGuardar = document.querySelector('#seccionAsignacion button[onclick="guardarAsignaciones()"]');
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
        if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
        return res.json();
    })
    .then(data => {
        // alert("✅ Asignaciones guardadas exitosamente!"); // Reemplazar con mensaje en UI
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
        cargarTodosLosClientes(); // Recargar la tabla de asignación
        if (!esAdmin && usuarioActual) cargarClientes(usuarioActual.id); // Si el usuario no es admin, recargar sus clientes
    })
    .catch(error => {
        console.error("Error al guardar asignaciones:", error);
        // alert(`❌ Error al guardar asignaciones: ${error.message}`);
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
            // No ocultar mensaje de error inmediatamente
        }
    }).finally(() => {
        if(botonGuardar) {
            botonGuardar.disabled = false;
            botonGuardar.textContent = '💾 Guardar Asignaciones';
        }
    });
}


function seleccionarTodo() {
    // Esta función parece asignar todos los clientes al usuario actual (que debe ser admin para ver esta sección)
    // O podría ser para seleccionar todos los clientes en la tabla para alguna acción masiva.
    // El comportamiento actual es asignar al `usuarioActual.id` que podría no ser lo deseado si es un admin genérico.
    // Confirmar la lógica deseada. Por ahora, asume que se asigna al primer usuario admin o uno específico.
    
    const selects = document.querySelectorAll("#tablaAsignarClientes .usuarioSelect");
    if (selects.length === 0) {
        // alert("No hay clientes para seleccionar.");
        return;
    }

    // Obtener el ID del primer usuario disponible en los selectores (o un ID de admin predeterminado si es necesario)
    // O mejor, permitir al admin elegir a qué usuario asignar masivamente.
    // Por simplicidad, si es admin, podría asignarse a sí mismo (ID 0) o dejar que elija de una lista.
    // Para este ejemplo, si el usuario actual es admin (ID 0), no tiene sentido que se autoasigne tareas así.
    // Esta función necesita una lógica más clara sobre a QUIÉN se le asignan todos.
    // Si el objetivo es que un admin asigne TODO a UN usuario específico:
    // 1. El admin necesitaría seleccionar a qué usuario.
    // 2. Luego presionar "Seleccionar Todo" (que se renombraría a "Asignar todo a [Usuario Seleccionado]")

    // Comportamiento actual (original): asigna todos los clientes al 'usuarioActual.id'
    // Esto solo tiene sentido si el admin está actuando como un usuario normal o quiere tomar todos los clientes.
    if (!usuarioActual || !esAdmin) { // Solo admin puede hacer esto.
        console.warn("Seleccionar todo solo disponible para administradores.");
        return;
    }
    
    // Si la idea es que el Admin asigne todos los clientes a UN usuario específico de la lista de usuarios:
    // Primero, necesitaríamos obtener la lista de usuarios (como en cargarTodosLosClientes)
    // y permitir al admin seleccionar uno. Por ahora, mantendremos el comportamiento original
    // pero con una advertencia si no hay un usuario "objetivo" claro.

    let targetUserId = null;
    if (esAdmin) {
        // Si es admin, ¿a quién se asignan? ¿Al propio admin (id 0)?
        // O quizás debería haber un dropdown para que el admin elija a quién asignar todos.
        // Por ahora, si es admin, no se auto-asigna a menos que explícitamente sea el comportamiento.
        // alert("Como administrador, por favor selecciona un usuario específico de la lista desplegable para cada cliente o usa la asignación individual.");
        // return;
        // Si el admin quiere asignarse a si mismo (ID 0), esto funcionaría si el ID 0 está en los <select>
        // Pero usualmente el admin no se autoasigna llamadas así.
        // Vamos a asumir que el admin quiere asignar todos a un usuario que ELEGIRÁ de la lista
        // pero la función actual no tiene esa capacidad.
        // Para que "Seleccionar todo" funcione como "asignar todo al usuario actual", el usuarioActual.id debe ser válido en los <select>
    }
    // Si no es admin, esta sección no debería ser visible, pero por si acaso:
    targetUserId = usuarioActual.id; 
    
    if (targetUserId === null || targetUserId === undefined) {
        // alert("No se pudo determinar a qué usuario asignar todos los clientes.");
        return;
    }

    let count = 0;
    selects.forEach(select => {
        // Verificar si el targetUserId es una opción válida en el select
        if (Array.from(select.options).some(opt => opt.value == targetUserId)) {
            select.value = targetUserId;
            count++;
        }
    });
    
    if (count > 0) {
        // alert(`${count} clientes han sido pre-seleccionados para ser asignados a "${usuarioActual.nombre}". Recuerda Guardar Asignaciones.`);
        const mensajeContenedor = document.getElementById('seccionAsignacion');
        if(mensajeContenedor){
            let msgEl = mensajeContenedor.querySelector('.admin-message');
            if(!msgEl){
                msgEl = document.createElement('p');
                msgEl.className = 'admin-message info';
                mensajeContenedor.insertBefore(msgEl, document.getElementById('tablaAsignarClientes'));
            }
            msgEl.textContent = `${count} clientes pre-seleccionados para ${usuarioActual.nombre}. ¡No olvides Guardar!`;
            setTimeout(() => msgEl.textContent = '', 4000);
        }
    } else {
        // alert(`No se pudieron asignar clientes a "${usuarioActual.nombre}". Verifica que el usuario esté en la lista de opciones.`);
    }
}


function cargarUsuarios() {
    fetch("/usuarios")
        .then(res => {
            if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
            return res.json();
        })
        .then(usuarios => {
            const tbody = document.querySelector("#tablaUsuarios tbody");
            tbody.innerHTML = ""; // Limpiar antes de añadir
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
            document.querySelector("#tablaUsuarios tbody").innerHTML = `<tr><td colspan="3" class="error">Error al cargar usuarios: ${error.message}</td></tr>`;
        });
}

function agregarUsuario() {
    const nombreInput = document.getElementById("nuevoUsuarioNombre");
    const passwordInput = document.getElementById("nuevoUsuarioPassword");
    const nombre = nombreInput.value.trim();
    const password = passwordInput.value.trim();

    const botonAgregar = document.querySelector('#seccionAdmin button[onclick="agregarUsuario()"]');

    if (!nombre || !password) {
        // alert("❌ Nombre y contraseña son obligatorios");
        // Mostrar mensaje en UI
        const msgEl = obtenerMensajeAdmin("seccionAdmin", "#tablaUsuarios");
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
        if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
        return res.json();
    })
    .then(data => {
        if (data.status === "ok") {
            // alert(`✅ Usuario "${data.usuario.nombre}" creado exitosamente`);
            const msgEl = obtenerMensajeAdmin("seccionAdmin", "#tablaUsuarios");
            msgEl.className = 'admin-message success';
            msgEl.textContent = `✅ Usuario "${data.usuario.nombre}" creado exitosamente.`;
            
            nombreInput.value = "";
            passwordInput.value = "";
            cargarUsuarios(); // Recargar la lista de usuarios
            cargarTodosLosClientes(); // Recargar clientes para actualizar los <select> de asignación
        } else {
            // Este 'else' es redundante si el !res.ok ya lanza error
            throw new Error(data.mensaje || "Error desconocido al crear usuario");
        }
    })
    .catch(error => {
        console.error("Error al crear usuario:", error);
        // alert(`❌ ${error.message}`);
        const msgEl = obtenerMensajeAdmin("seccionAdmin", "#tablaUsuarios");
        msgEl.className = 'admin-message error';
        msgEl.textContent = `❌ ${error.message}`;
    }).finally(() => {
        if(botonAgregar){
            botonAgregar.disabled = false;
            botonAgregar.textContent = '➕ Agregar Usuario';
        }
    });
}
// Helper para mensajes de admin
function obtenerMensajeAdmin(seccionId, antesDeSelector) {
    const contenedor = document.getElementById(seccionId);
    let msgEl = contenedor.querySelector('.admin-message');
    if (!msgEl) {
        msgEl = document.createElement('p');
        msgEl.className = 'admin-message';
        const elementoReferencia = contenedor.querySelector(antesDeSelector);
        if (elementoReferencia) {
            contenedor.insertBefore(msgEl, elementoReferencia);
        } else {
            contenedor.appendChild(msgEl); //Fallback
        }
    }
    setTimeout(() => msgEl.textContent = '', 5000); // Autocerrar mensaje
    return msgEl;
}


function eliminarUsuario(id) {
    // Usar un modal custom en lugar de confirm
    if (!confirm(`¿Está seguro que desea eliminar este usuario? Esta acción no se puede deshacer y los clientes asignados a él quedarán sin asignar.`)) return;

    fetch("/usuarios/eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
    })
    .then(res => {
        if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
        return res.json();
    })
    .then(data => {
        if (data.status === "ok") {
            // alert("✅ Usuario eliminado correctamente.");
             const msgEl = obtenerMensajeAdmin("seccionAdmin", "#tablaUsuarios");
             msgEl.className = 'admin-message success';
             msgEl.textContent = "✅ Usuario eliminado correctamente.";
            cargarUsuarios(); // Recargar lista de usuarios
            cargarTodosLosClientes(); // Recargar clientes para actualizar selects
        } else {
            throw new Error(data.mensaje || "Error desconocido al eliminar usuario");
        }
    })
    .catch(error => {
        console.error("Error al eliminar usuario:", error);
        // alert(`❌ ${error.message}`);
        const msgEl = obtenerMensajeAdmin("seccionAdmin", "#tablaUsuarios");
        msgEl.className = 'admin-message error';
        msgEl.textContent = `❌ ${error.message}`;
    });
}

function limpiarClientes() {
    if (!confirm("⚠️ ¿Está seguro que desea eliminar TODOS los clientes de la base de datos? Esta acción es irreversible.")) return;

    const botonLimpiar = document.querySelector('#seccionAdmin button[onclick="limpiarClientes()"]');
    if(botonLimpiar){
        botonLimpiar.disabled = true;
        botonLimpiar.textContent = 'Limpiando...';
    }

    fetch("/limpiar-clientes", { method: "POST" })
        .then(res => {
            if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
            return res.json();
        })
        .then(data => {
            if (data.status === "ok") {
                // alert("✅ Todos los clientes han sido eliminados.");
                const msgEl = document.getElementById("mensajeExcel"); // Usar el p existente para mensajes de Excel
                msgEl.className = 'success';
                msgEl.textContent = "✅ Todos los clientes han sido eliminados.";

                cargarTodosLosClientes(); // Actualizar tabla de asignación (debería estar vacía)
                if (usuarioActual && !esAdmin) { // Si es un usuario normal, actualizar su lista (debería estar vacía)
                    cargarClientes(usuarioActual.id);
                }
            } else {
                 throw new Error(data.mensaje || "Error desconocido al limpiar clientes");
            }
        })
        .catch(error => {
            console.error("Error al limpiar clientes:", error);
            // alert(`❌ Error al eliminar clientes: ${error.message}`);
            const msgEl = document.getElementById("mensajeExcel");
            msgEl.className = 'error';
            msgEl.textContent = `❌ Error al eliminar clientes: ${error.message}`;
        }).finally(()=>{
            if(botonLimpiar){
                botonLimpiar.disabled = false;
                botonLimpiar.textContent = '🧹 Limpiar Todos los Clientes';
            }
        });
}

function procesarArchivo(event) {
    const file = event.target.files[0];
    const mensajeExcel = document.getElementById("mensajeExcel");

    if (!file) {
        mensajeExcel.textContent = "❌ No se seleccionó ningún archivo.";
        mensajeExcel.className = "error";
        return;
    }

    mensajeExcel.textContent = "Procesando archivo Excel...";
    mensajeExcel.className = "info";
    const botonCargar = event.target; // El input type file
    if(botonCargar) botonCargar.disabled = true;


    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }); // Usar defval para celdas vacías

            if (rows.length === 0) {
                mensajeExcel.textContent = "❌ El archivo Excel está vacío o no tiene datos en la primera hoja.";
                mensajeExcel.className = "error";
                if(botonCargar) botonCargar.disabled = false;
                event.target.value = ""; // Resetear el input file
                return;
            }
            
            // Detección de columnas más flexible
            function detectarColumna(rowSample, posiblesNombres) {
                const header = Object.keys(rowSample).map(key => key.toLowerCase().trim());
                for (let nombre of posiblesNombres) {
                    const nombreLower = nombre.toLowerCase();
                    const foundKey = Object.keys(rowSample).find(key => key.toLowerCase().trim() === nombreLower);
                    if (foundKey) return foundKey;
                }
                // Si no se encuentra por nombre exacto, buscar por inclusión (menos preciso)
                for (let nombre of posiblesNombres) {
                    const nombreLower = nombre.toLowerCase();
                    const foundKey = Object.keys(rowSample).find(key => key.toLowerCase().trim().includes(nombreLower));
                    if (foundKey) return foundKey;
                }
                return null;
            }

            const primerFila = rows[0];
            const colNombre = detectarColumna(primerFila, ["nombre", "cliente", "nombre completo"]);
            const colTelefono = detectarColumna(primerFila, ["telefono", "tel", "celular", "teléfono"]);
            const colDireccion = detectarColumna(primerFila, ["direccion", "dirección", "domicilio"]);
            const colTarifa = detectarColumna(primerFila, ["tarifa", "monto", "costo"]);
            const colSaldoExigible = detectarColumna(primerFila, ["saldo exigible", "exigible", "saldo_exigible"]);
            const colSaldo = detectarColumna(primerFila, ["saldo", "saldo actual", "saldo_actual"]);


            if (!colNombre) {
                mensajeExcel.textContent = "❌ No se encontró una columna de 'Nombre' o 'Cliente' en el Excel.";
                mensajeExcel.className = "error";
                if(botonCargar) botonCargar.disabled = false;
                event.target.value = "";
                return;
            }

            const clientesExcel = rows.map(row => {
                // Función para limpiar y convertir a número, devolviendo 0 si no es válido
                const toNumber = (val) => {
                    if (typeof val === 'string') val = val.replace(/[^0-9.-]+/g,""); // Quitar símbolos de moneda, etc.
                    const num = parseFloat(val);
                    return isNaN(num) ? 0 : num;
                };

                return {
                    nombre: String(row[colNombre] || "Desconocido").trim(),
                    telefono: colTelefono ? String(row[colTelefono] || "").trim() : "",
                    direccion: colDireccion ? String(row[colDireccion] || "").trim() : "",
                    tarifa: colTarifa ? toNumber(row[colTarifa]) : 0,
                    saldo_exigible: colSaldoExigible ? toNumber(row[colSaldoExigible]) : 0,
                    saldo: colSaldo ? toNumber(row[colSaldo]) : 0,
                    asignado_a: null // Por defecto no asignado
                };
            }).filter(cliente => cliente.nombre !== "Desconocido" && cliente.nombre !== ""); // Filtrar filas vacías por nombre

            if (clientesExcel.length === 0) {
                mensajeExcel.textContent = "❌ No se encontraron datos de clientes válidos en el archivo.";
                mensajeExcel.className = "error";
                if(botonCargar) botonCargar.disabled = false;
                event.target.value = "";
                return;
            }


            fetch("/cargar-clientes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientes: clientesExcel })
            })
            .then(res => {
                if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
                return res.json();
            })
            .then(data => {
                if (data.status === "ok") {
                    let msg = `✅ ${data.mensaje || `${clientesExcel.length} clientes procesados.`}`;
                    if (data.clientesConCoordenadas > 0) {
                        msg += ` (${data.clientesConCoordenadas} geocodificados).`;
                    } else if (colDireccion) {
                         msg += `. ${data.clientesConCoordenadas || 0} direcciones pudieron ser geocodificadas inicialmente.`;
                    }
                    mensajeExcel.textContent = msg;
                    mensajeExcel.className = "success";
                    event.target.value = ""; // Reset file input
                    cargarTodosLosClientes(); // Actualizar la tabla de asignación
                } else {
                    throw new Error(data.mensaje || "Error desconocido del servidor");
                }
            })
            .catch(error => {
                mensajeExcel.textContent = `❌ Error al cargar clientes: ${error.message}`;
                mensajeExcel.className = "error";
            }).finally(()=>{
                 if(botonCargar) botonCargar.disabled = false;
            });
        } catch (error) {
            console.error("Error al procesar archivo Excel:", error);
            mensajeExcel.textContent = "❌ Error crítico al leer el archivo Excel. Asegúrate que el formato es correcto.";
            mensajeExcel.className = "error";
            if(botonCargar) botonCargar.disabled = false;
            event.target.value = "";
        }
    };
    reader.readAsArrayBuffer(file);
}

function cargarReporte() {
    const botonReporte = document.querySelector('button[onclick="cargarReporte()"]');
    if(botonReporte){
        botonReporte.disabled = true;
        botonReporte.textContent = 'Cargando Reporte...';
    }

    fetch("/reporte")
        .then(res => {
            if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
            return res.json();
        })
        .then(datos => {
            const tbody = document.querySelector("#tablaReporte tbody");
            tbody.innerHTML = ""; // Limpiar
            if (datos.length === 0) { 
                tbody.innerHTML = `<tr><td colspan="9">No hay registros de llamadas para mostrar.</td></tr>`;
                return;
            }
                
            datos.forEach(row => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${row.usuario || "-"}</td>
                    <td>${row.cliente || "-"}</td>
                    <td>${row.resultado || "-"}</td>
                    <td>$${parseFloat(row.monto_cobrado || 0).toFixed(2)}</td>
                    <td>${row.fecha ? new Date(row.fecha + 'T00:00:00').toLocaleDateString() : "-"}</td>
                    <td>${row.observaciones || "-"}</td>
                    <td>${row.tarifa || "-"}</td>
                    <td>${row.saldo_exigible || "-"}</td>
                    <td>${row.saldo || "-"}</td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(error => {
            console.error("Error al cargar reporte:", error);
            document.querySelector("#tablaReporte tbody").innerHTML = `<tr><td colspan="9" class="error">Error al cargar el reporte: ${error.message}</td></tr>`;
        }).finally(()=>{
            if(botonReporte){
                botonReporte.disabled = false;
                botonReporte.textContent = '🔄 Mostrar Todos los Registros';
            }
        });
}

function exportarReporte() {
    const botonExportar = document.querySelector('button[onclick="exportarReporte()"]');
     if(botonExportar){
        botonExportar.disabled = true;
        botonExportar.textContent = 'Exportando...';
    }

    fetch("/reporte")
        .then(res => {
            if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
            return res.json();
        })
        .then(datos => {
            if (datos.length === 0) {
                // alert("No hay datos en el reporte para exportar.");
                const tablaReporte = document.getElementById('tablaReporte');
                let msgEl = tablaReporte.querySelector('.report-message');
                if(!msgEl){
                    msgEl = document.createElement('p');
                    msgEl.className = 'report-message info';
                    tablaReporte.parentNode.insertBefore(msgEl, tablaReporte);
                }
                msgEl.textContent = "No hay datos para exportar.";
                setTimeout(()=>msgEl.textContent = '', 3000);
                return;
            }
            // Mapear datos para asegurar el orden de columnas y formato si es necesario
            const datosMapeados = datos.map(d => ({
                "Usuario": d.usuario,
                "Cliente": d.cliente,
                "Resultado Llamada": d.resultado,
                "Monto Cobrado": parseFloat(d.monto_cobrado || 0),
                "Fecha": d.fecha ? new Date(d.fecha + 'T00:00:00').toLocaleDateString() : "", // Formato de fecha local
                "Observaciones": d.observaciones,
                "Tarifa Cliente": d.tarifa,
                "Saldo Exigible Cliente": d.saldo_exigible,
                "Saldo Cliente": d.saldo
            }));
            
            const ws = XLSX.utils.json_to_sheet(datosMapeados);
            // Ajustar ancho de columnas (opcional, pero mejora la legibilidad)
            const colWidths = Object.keys(datosMapeados[0]).map(key => ({ wch: Math.max(20, key.length + 2) })); // Ancho mínimo 20 o largo del header
            ws['!cols'] = colWidths;

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "ReporteLlamadas");
            XLSX.writeFile(wb, `Reporte_Llamadas_${new Date().toISOString().split('T')[0]}.xlsx`);
        })
        .catch(error => {
            console.error("Error al generar datos para exportar:", error);
            // alert(`Error al exportar: ${error.message}`);
            const tablaReporte = document.getElementById('tablaReporte');
            let msgEl = tablaReporte.querySelector('.report-message');
            if(!msgEl){
                msgEl = document.createElement('p');
                msgEl.className = 'report-message error';
                tablaReporte.parentNode.insertBefore(msgEl, tablaReporte);
            }
            msgEl.textContent = `Error al exportar: ${error.message}`;
        }).finally(()=>{
            if(botonExportar){
                botonExportar.disabled = false;
                botonExportar.textContent = '📄 Exportar a Excel';
            }
        });
}
// Filtrado de clientes en la tabla de asignación (Admin)
function filtrarClientes() {
    const filtro = document.getElementById('filtroCliente').value.toLowerCase();
    const filas = document.querySelectorAll("#tablaAsignarClientes tbody tr");
    filas.forEach(fila => {
        // Asegurarse que no sea la fila de "No hay clientes"
        if (fila.querySelector('td[colspan="7"]')) {
            fila.style.display = ""; // Mostrar siempre si es el mensaje de no clientes
            return;
        }
        const nombreCliente = fila.cells[0].textContent.toLowerCase();
        const telefonoCliente = fila.cells[1].textContent.toLowerCase();
        const direccionCliente = fila.cells[2].textContent.toLowerCase();
        if (nombreCliente.includes(filtro) || telefonoCliente.includes(filtro) || direccionCliente.includes(filtro)) {
            fila.style.display = "";
        } else {
            fila.style.display = "none";
        }
    });
}


// Hacer funciones globales para que sean accesibles desde el HTML inline onclick
window.login = login;
window.cerrarSesion = cerrarSesion;
window.procesarArchivo = procesarArchivo;
window.guardarAsignaciones = guardarAsignaciones;
window.seleccionarTodo = seleccionarTodo;
window.cargarReporte = cargarReporte;
window.exportarReporte = exportarReporte;
window.agregarUsuario = agregarUsuario;
window.limpiarClientes = limpiarClientes;
window.eliminarUsuario = eliminarUsuario;
window.registrarLlamada = registrarLlamada;
window.inicializarMapa = inicializarMapa; // Asegurarse que esté global si se usa como callback en URL de API
window.geocodificarCliente = geocodificarCliente;
window.mostrarClienteEnMapa = mostrarClienteEnMapa; // Puede ser útil globalmente o mantenerse local
window.filtrarClientes = filtrarClientes; // Para el input de filtro en admin


// Pequeña mejora para la recarga automática: solo si la ventana está visible.
setInterval(() => {
    if (document.visibilityState === "visible" && usuarioActual && !esAdmin && window.location.pathname.includes("clientes.html")) {
        console.log("Recargando clientes para usuario...");
        cargarClientes(usuarioActual.id);
    }
}, 60000); // 60 segundos
