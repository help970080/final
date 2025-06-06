let usuarioActual = null;
let esAdmin = false;
let mapInstance = null;
let directionsRendererInstance = null;
let usuariosParaAsignacionMasiva = [];
let gestoresMarkers = []; // Nueva variable global para almacenar los marcadores de gestores

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
            // Si es admin, refrescar las ubicaciones de los gestores cada 30 minutos
            // Llama a inicializarMapa al cargar y luego refresca gestores cada 30 min
            if(window.google) inicializarMapa(); // Asegurarse que Google Maps API ya cargó
            setInterval(cargarYMostrarGestoresEnMapa, 30 * 60 * 1000); // 30 minutos
        } else {
            document.getElementById("seccionAdmin").classList.add("hidden");
            document.getElementById("seccionAsignacion").classList.add("hidden");
            cargarClientes(usuarioActual.id);
            // Si es gestor, enviar su ubicación cada 30 minutos
            solicitarYEnviarUbicacion(); // Enviar al cargar la página
            setInterval(solicitarYEnviarUbicacion, 30 * 60 * 1000); // Cada 30 minutos
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
                    <td>${cliente.telefono ? `<a href="tel:${cliente.telefono}" class="telefono-link">${cliente.telefono}</a> <button onclick="enviarWhatsapp('${cliente.telefono}', '${cliente.nombre}')" class="btn-whatsapp">💬 WhatsApp</button>` : "-"}</td>
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clienteId, direccion })
        });

        const data = await response.json();

        if (data.status === "ok") {
            statusElement.textContent = `✓ Ubicada (${data.direccion_formateada || 'Coords: ' + data.lat.toFixed(5) + ', ' + data.lng.toFixed(5)})`;
            statusElement.className = "geo-status geo-success";
            botonGeo.innerHTML = '🌍 Ubicada';
            botonGeo.style.backgroundColor = '#4CAF50';
            
            if (document.getElementById('mapa') && window.mostrarClienteEnMapa && mapInstance) {
                const nombreCliente = fila.querySelector('td:first-child').textContent;
                // No reiniciar el mapa, usar la instancia existente
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
        icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
    });
    map.setCenter(clientePos);

    document.getElementById('info-ruta').innerHTML = `<h3>Cliente: ${nombreCliente}</h3><p><strong>Dirección:</strong> ${direccion}</p><p>Calculando ruta...</p>`;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                new google.maps.Marker({
                    position: userPos,
                    map: map,
                    title: "Tu ubicación actual",
                    icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
                });

                const directionsService = new google.maps.DirectionsService();
                const directionsRenderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true });

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
            tbody.innerHTML = "";

            if (clientes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8">No hay clientes registrados en el sistema</td></tr>`;
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

                    clientes.forEach(cliente => {
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

function inicializarMapa() {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps API no se cargó correctamente. Reintentando...");
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


    if (!navigator.geolocation) {
        document.getElementById('info-ruta').innerHTML = '<p class="info">Tu navegador no soporta geolocalización.</p>';
        return;
    }
    
    document.getElementById('info-ruta').innerHTML = '<p class="info">Obteniendo tu ubicación...</p>';

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

            directionsRendererInstance.setDirections({routes: []});

            if (esAdmin) {
                new google.maps.Marker({
                    position: userPos,
                    map: mapInstance,
                    title: "Ubicación del Admin",
                    icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
                });
            } else {
                 new google.maps.Marker({
                    position: userPos,
                    map: mapInstance,
                    title: "Tú estás aquí",
                    icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
                });
            }

            mapInstance.setCenter(userPos);
            mapInstance.setZoom(13);


            try {
                if (esAdmin) {
                    await cargarYMostrarGestoresEnMapa();
                    document.getElementById('info-ruta').innerHTML = '<p class="info">Mapa cargado. Actualizando ubicaciones de gestores cada 30 min.</p>';

                } else {
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
                            icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
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
        { timeout: 10000, enableHighAccuracy: true }
    );
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
        travelMode: google.maps.TravelMode.DRIVING
    }, (response, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            directionsRenderer.setDirections(response);

            const route = response.routes[0];
            if (!route || !route.legs || route.legs.length === 0) {
                document.getElementById('info-ruta').innerHTML = '<p class="error">No se encontraron detalles de la ruta en la respuesta.</p>';
                return;
            }
            const leg = route.legs[0];

            let instructionsHTML = '<h4>Indicaciones detalladas:</h4><ol style="padding-left: 20px; max-height: 200px; overflow-y: auto; border: 1px solid #eee; padding-top:10px; padding-bottom:10px; background-color: #fff; border-radius: 4px;">';
            leg.steps.forEach(step => {
                instructionsHTML += `<li style="margin-bottom: 8px; padding-left:5px;">${step.instructions} <span style="font-size:0.9em; color:#555;">(${step.distance.text}, ${step.duration.text})</span></li>`;
            });
            instructionsHTML += '</ol>';

            const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lng}&destination=${destino.lat},${destino.lng}&travelmode=driving`;
            const navigationLink = `<a href="${googleMapsUrl}" target="_blank" class="btn-navegar" style="display:inline-block; margin-top:15px; padding:10px 18px; background-color:#28a745; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">🗺️ Abrir en Google Maps</a>`;

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
        const errorCell = fila.querySelector('td:last-child');
        const originalText = errorCell.innerHTML;
        errorCell.innerHTML = '<span style="color:red;">Selecciona un resultado</span>';
        setTimeout(() => { errorCell.innerHTML = originalText; }, 3000);
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
        if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
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
            throw new Error(data.mensaje || `Error HTTP ${response.status}`);
        }

        massAssignMessage.className = 'success';
        massAssignMessage.textContent = `✅ ${data.mensaje || `${clientesToUpdate.length} clientes asignados masivamente.`}`;
        
        document.getElementById('selectAllClients').checked = false;
        toggleAllClients(document.getElementById('selectAllClients'));
        selectedUserElement.value = '';
        cargarTodosLosClientes();
    } catch (error) {
        console.error("Error al asignar clientes masivamente:", error);
        massAssignMessage.className = 'error';
        massAssignMessage.textContent = `❌ Error al asignar clientes: ${error.message}`;
    } finally {
        assignButton.disabled = false;
        assignButton.textContent = '🚀 Asignar Clientes Seleccionados';
        setTimeout(() => massAssignMessage.textContent = '', 5000);
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
            document.querySelector("#tablaUsuarios tbody").innerHTML = `<tr><td colspan="3" class="error">Error al cargar usuarios: ${error.message}</td></tr>`;
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
        if(!res.ok) return res.json().then(err => { throw new Error(err.mensaje || `Error HTTP ${res.status}`) });
        return res.json();
    })
    .then(data => {
        if (data.status === "ok") {
            const msgEl = obtenerMensajeAdmin("seccionAdmin", ".admin-message");
            msgEl.className = 'admin-message success';
            msgEl.textContent = `✅ Usuario "${data.usuario.nombre}" creado exitosamente.`;
            
            nombreInput.value = "";
            passwordInput.value = "";
            cargarUsuarios();
            cargarTodosLosClientes();
        } else {
            throw new Error(data.mensaje || "Error desconocido al crear usuario");
        }
    })
    .catch(error => {
        console.error("Error al crear usuario:", error);
        const msgEl = obtenerMensajeAdmin("seccionAdmin", ".admin-message");
        msgEl.className = 'admin-message error';
        msgEl.textContent = `❌ ${error.message}`;
    }).finally(() => {
        if(botonAgregar){
            botonAgregar.disabled = false;
            botonAgregar.textContent = '➕ Agregar Usuario';
        }
    });
}

function obtenerMensajeAdmin(seccionId, selectorMensaje) {
    const contenedor = document.getElementById(seccionId);
    let msgEl = contenedor.querySelector(selectorMensaje);
    if (!msgEl) {
        msgEl = document.createElement('p');
        msgEl.className = 'admin-message';
        const elementoReferencia = contenedor.querySelector('h3');
        if (elementoReferencia) {
            elementoReferencia.parentNode.insertBefore(msgEl, elementoReferencia.nextSibling);
        } else {
            contenedor.appendChild(msgEl);
        }
    }
    setTimeout(() => msgEl.textContent = '', 5000);
    return msgEl;
}


function eliminarUsuario(id) {
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
             const msgEl = obtenerMensajeAdmin("seccionAdmin", ".admin-message");
             msgEl.className = 'admin-message success';
             msgEl.textContent = "✅ Usuario eliminado correctamente.";
            cargarUsuarios();
            cargarTodosLosClientes();
        } else {
            throw new Error(data.mensaje || "Error desconocido al eliminar usuario");
        }
    })
    .catch(error => {
        console.error("Error al eliminar usuario:", error);
        const msgEl = obtenerMensajeAdmin("seccionAdmin", ".admin-message");
        msgEl.className = 'admin-message error';
        msgEl.textContent = `❌ ${error.message}`;
    });
}

function limpiarClientes() {
    if (!confirm("⚠️ ¿Está seguro que desea eliminar TODOS los clientes de la base de datos? Esta acción es irreversible.")) return;

    const botonLimpiar = document.querySelector('button[onclick="limpiarClientes()"]');
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
                const msgEl = document.getElementById("mensajeExcel");
                msgEl.className = 'success';
                msgEl.textContent = "✅ Todos los clientes han sido eliminados.";

                cargarTodosLosClientes();
                if (usuarioActual && !esAdmin) {
                    cargarClientes(usuarioActual.id);
                }
            } else {
                 throw new Error(data.mensaje || "Error desconocido al limpiar clientes");
            }
        })
        .catch(error => {
            console.error("Error al limpiar clientes:", error);
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
    const botonCargar = event.target;
    if(botonCargar) botonCargar.disabled = true;


    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

            if (rows.length === 0) {
                mensajeExcel.textContent = "❌ El archivo Excel está vacío o no tiene datos en la primera hoja.";
                mensajeExcel.className = "error";
                if(botonCargar) botonCargar.disabled = false;
                event.target.value = "";
                return;
            }
            
            function detectarColumna(rowSample, posiblesNombres) {
                const header = Object.keys(rowSample).map(key => key.toLowerCase().trim());
                for (let nombre of posiblesNombres) {
                    const nombreLower = nombre.toLowerCase();
                    const foundKey = Object.keys(rowSample).find(key => key.toLowerCase().trim() === nombreLower);
                    if (foundKey) return foundKey;
                }
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
                const toNumber = (val) => {
                    if (typeof val === 'string') val = val.replace(/[^0-9.-]+/g,"");
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
                    asignado_a: null
                };
            }).filter(cliente => cliente.nombre !== "Desconocido" && cliente.nombre !== "");

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
                    event.target.value = "";
                    cargarTodosLosClientes();
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
            tbody.innerHTML = "";
            if (datos.length === 0) { 
                tbody.innerHTML = `<tr><td colspan="9">No hay registros de llamadas para mostrar.</td></tr>`;
                const msgEl = document.querySelector('.report-message');
                if(msgEl) {
                    msgEl.className = 'report-message info';
                    msgEl.textContent = "No hay registros de llamadas para mostrar.";
                    setTimeout(()=>msgEl.textContent = '', 3000);
                }
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
            const msgEl = document.querySelector('.report-message');
            if(msgEl) msgEl.textContent = '';
        })
        .catch(error => {
            console.error("Error al cargar reporte:", error);
            document.querySelector("#tablaReporte tbody").innerHTML = `<tr><td colspan="9" class="error">Error al cargar el reporte: ${error.message}</td></tr>`;
            const msgEl = document.querySelector('.report-message');
            if(msgEl) {
                msgEl.className = 'report-message error';
                msgEl.textContent = `Error al cargar el reporte: ${error.message}`;
            }
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
            const datosMapeados = datos.map(d => ({
                "Usuario": d.usuario,
                "Cliente": d.cliente,
                "Resultado Llamada": d.resultado,
                "Monto Cobrado": parseFloat(d.monto_cobrado || 0),
                "Fecha": d.fecha ? new Date(d.fecha + 'T00:00:00').toLocaleDateString() : "",
                "Observaciones": d.observaciones,
                "Tarifa Cliente": d.tarifa,
                "Saldo Exigible Cliente": d.saldo_exigible,
                "Saldo Cliente": d.saldo
            }));
            
            const ws = XLSX.utils.json_to_sheet(datosMapeados);
            const colWidths = Object.keys(datosMapeados[0]).map(key => ({ wch: Math.max(20, key.length + 2) }));
            ws['!cols'] = colWidths;

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "ReporteLlamadas");
            XLSX.writeFile(wb, `Reporte_Llamadas_${new Date().toISOString().split('T')[0]}.xlsx`);
        })
        .catch(error => {
            console.error("Error al generar datos para exportar:", error);
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

function filtrarClientes() {
    const filtro = document.getElementById('filtroCliente').value.toLowerCase();
    const filas = document.querySelectorAll("#tablaAsignarClientes tbody tr");
    filas.forEach(fila => {
        if (fila.querySelector('td[colspan="8"]')) {
            fila.style.display = "";
            return;
        }
        const nombreCliente = fila.cells[1].textContent.toLowerCase();
        const telefonoCliente = fila.cells[2].textContent.toLowerCase();
        const direccionCliente = fila.cells[3].textContent.toLowerCase();
        if (nombreCliente.includes(filtro) || telefonoCliente.includes(filtro) || direccionCliente.includes(filtro)) {
            fila.style.display = "";
        } else {
            fila.style.display = "none";
        }
    });
}

// Función para obtener y enviar la ubicación del gestor
function solicitarYEnviarUbicacion() {
    if (!usuarioActual || esAdmin) {
        return;
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                console.log(`Ubicación del gestor ${usuarioActual.usuario}: ${lat}, ${lng}`);
                
                fetch('/actualizar-ubicacion-usuario', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: usuarioActual.id, lat, lng })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === "ok") {
                        console.log("Ubicación del gestor actualizada en el servidor.");
                    } else {
                        console.warn("Error al enviar ubicación del gestor:", data.mensaje);
                    }
                })
                .catch(error => {
                    console.error("Error de red al enviar ubicación del gestor:", error);
                });
            },
            (error) => {
                console.warn("No se pudo obtener la ubicación del gestor:", error.message);
            },
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    } else {
        console.warn("Geolocalización no soportada por este navegador para el gestor.");
    }
}

// Función para cargar y mostrar gestores en el mapa (solo para Admin)
async function cargarYMostrarGestoresEnMapa() {
    if (!esAdmin || !mapInstance) return;

    // Limpiar marcadores de gestores anteriores
    gestoresMarkers.forEach(marker => marker.setMap(null));
    gestoresMarkers = [];

    try {
        const response = await fetch('/ubicaciones-gestores');
        if (!response.ok) throw new Error('Error al obtener ubicaciones de gestores.');
        const gestores = await response.json();

        gestores.forEach(gestor => {
            if (gestor.lat && gestor.lng) {
                const marker = new google.maps.Marker({
                    position: { lat: parseFloat(gestor.lat), lng: parseFloat(gestor.lng) },
                    map: mapInstance,
                    title: `Gestor: ${gestor.nombre}\nÚltima ubicación: ${gestor.ultima_actualizacion ? new Date(gestor.ultima_actualizacion).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'N/A'}`,
                    icon: "http://maps.google.com/mapfiles/ms/icons/green-dot.png"
                });
                gestoresMarkers.push(marker);
            }
        });
        console.log(`Mostrando ${gestores.length} ubicaciones de gestores.`);

    } catch (error) {
        console.error("Error al cargar ubicaciones de gestores para admin:", error);
    }
}


window.login = login;
window.cerrarSesion = cerrarSesion;
window.procesarArchivo = procesarArchivo;
window.guardarAsignaciones = guardarAsignaciones;
window.cargarReporte = cargarReporte;
window.exportarReporte = exportarReporte;
window.agregarUsuario = agregarUsuario;
window.limpiarClientes = limpiarClientes;
window.eliminarUsuario = eliminarUsuario;
window.registrarLlamada = registrarLlamada;
window.inicializarMapa = inicializarMapa;
window.geocodificarCliente = geocodificarCliente;
window.mostrarClienteEnMapa = mostrarClienteEnMapa;
window.filtrarClientes = filtrarClientes;
window.enviarWhatsapp = enviarWhatsapp;
window.toggleAllClients = toggleAllClients;
window.asignarClientesMasivamente = asignarClientesMasivamente;
// Nuevas funciones globales para el rastreo de ubicación
window.solicitarYEnviarUbicacion = solicitarYEnviarUbicacion;
window.cargarYMostrarGestoresEnMapa = cargarYMostrarGestoresEnMapa;