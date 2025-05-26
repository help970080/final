let usuarioActual = null;
let esAdmin = false;

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
        alert("Debes iniciar sesión primero.");
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
            alert("Error al cargar clientes asignados");
        });
}

async function geocodificarCliente(clienteId, boton) {
    const fila = boton.closest('tr');
    const celdas = fila.querySelectorAll('td');
    let direccion = celdas[2].textContent.split('🌍')[0].trim();
    const statusElement = document.getElementById(`geo-status-${clienteId}`);
    const botonGeo = fila.querySelector('.btn-geo');

    if (!direccion || direccion === "-") {
        statusElement.textContent = "Sin dirección";
        statusElement.className = "geo-error";
        return;
    }

    direccion = direccion
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/,+/g, ',')
        .trim();

    statusElement.textContent = "Buscando coordenadas...";
    statusElement.className = "geo-loading";
    botonGeo.disabled = true;
    botonGeo.innerHTML = '⌛ Procesando';

    try {
        const response = await fetch('/actualizar-coordenadas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                clienteId, 
                direccion: direccion 
            })
        });

        const data = await response.json();

        if (data.status === "ok") {
            statusElement.textContent = `✓ Ubicada (${data.direccion_formateada || 'Coords: ' + data.lat + ', ' + data.lng})`;
            statusElement.className = "geo-success";
            
            botonGeo.innerHTML = '🌍 Ubicada';
            botonGeo.style.backgroundColor = '#4CAF50';
            
            // Mostrar este cliente específico en el mapa
            if (document.getElementById('mapa') && window.mostrarClienteEnMapa) {
                const nombreCliente = fila.querySelector('td:first-child').textContent;
                mostrarClienteEnMapa(data.lat, data.lng, direccion, nombreCliente);
            }
        } else {
            let mensajeError = data.mensaje || "Error en geocodificación";
            if (data.detalle) mensajeError += ` (${data.detalle})`;
            if (data.sugerencia) mensajeError += `. ${data.sugerencia}`;
            
            statusElement.textContent = mensajeError;
            statusElement.className = "geo-error";
            
            botonGeo.innerHTML = '🌍 Reintentar';
            console.error("Error en geocodificación:", data);
        }
    } catch (error) {
        statusElement.textContent = "Error de conexión con el servidor";
        statusElement.className = "geo-error";
        console.error("Error:", error);
    } finally {
        setTimeout(() => {
            botonGeo.disabled = false;
            if (!statusElement.textContent.includes('✓ Ubicada')) {
                botonGeo.innerHTML = '🌍 Geolocalizar';
                botonGeo.style.backgroundColor = '';
            }
        }, 2000);
    }
}

function mostrarClienteEnMapa(lat, lng, direccion, nombreCliente) {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps no está disponible");
        return;
    }

    const mapaElement = document.getElementById('mapa');
    if (!mapaElement) return;

    const mapa = new google.maps.Map(mapaElement, {
        zoom: 15,
        center: { lat: parseFloat(lat), lng: parseFloat(lng) },
        mapTypeControl: true,
        streetViewControl: true
    });

    // Marcador del cliente
    new google.maps.Marker({
        position: { lat: parseFloat(lat), lng: parseFloat(lng) },
        map: mapa,
        title: nombreCliente,
        icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
    });

    // Mostrar info en el panel lateral
    document.getElementById('info-ruta').innerHTML = `
        <h3>Cliente geolocalizado</h3>
        <p><strong>Nombre:</strong> ${nombreCliente}</p>
        <p><strong>Dirección:</strong> ${direccion}</p>
        <p><strong>Coordenadas:</strong> ${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}</p>
    `;

    // Opcional: Mostrar también la ubicación del usuario y ruta
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const userPos = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                };

                new google.maps.Marker({
                    position: userPos,
                    map: mapa,
                    title: "Tú estás aquí",
                    icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
                });

                // Mostrar ruta desde tu ubicación al cliente
                const directionsService = new google.maps.DirectionsService();
                const directionsRenderer = new google.maps.DirectionsRenderer();
                directionsRenderer.setMap(mapa);

                directionsService.route({
                    origin: userPos,
                    destination: { lat: parseFloat(lat), lng: parseFloat(lng) },
                    travelMode: 'DRIVING'
                }, (response, status) => {
                    if (status === 'OK') {
                        directionsRenderer.setDirections(response);
                    }
                });
            },
            (error) => {
                console.log("Error obteniendo ubicación:", error);
            }
        );
    }
}

function cargarTodosLosClientes() {
    fetch("/clientes")
        .then(res => {
            if (!res.ok) throw new Error('Error al cargar clientes');
            return res.json();
        })
        .then(clientes => {
            const tbody = document.querySelector("#tablaAsignarClientes tbody");
            tbody.innerHTML = clientes.length === 0 ? 
                `<tr><td colspan="7">No hay clientes</td></tr>` : "";

            fetch("/usuarios")
                .then(res => res.json())
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
                });
        })
        .catch(error => {
            console.error("Error:", error);
            alert("Error al cargar clientes");
        });
}

function inicializarMapa() {
    if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        console.error("Google Maps no se cargó correctamente");
        setTimeout(inicializarMapa, 1000);
        return;
    }

    const mapaElement = document.getElementById('mapa');
    if (!mapaElement) {
        console.error("Elemento del mapa no encontrado");
        return;
    }

    const mapa = new google.maps.Map(mapaElement, {
        zoom: 12,
        center: { lat: 19.4326, lng: -99.1332 },
        mapTypeControl: true,
        streetViewControl: true
    });

    if (!navigator.geolocation) {
        alert("Tu navegador no soporta geolocalización");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const userPos = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            };

            new google.maps.Marker({
                position: userPos,
                map: mapa,
                title: "Tú estás aquí",
                icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
            });

            try {
                const response = await fetch(`/clientes/${usuarioActual.id}`);
                const clientes = await response.json();
                const clientesConCoords = clientes.filter(c => c.lat && c.lng);
                
                if (clientesConCoords.length === 0) {
                    document.getElementById('info-ruta').innerHTML = `
                        <h3>Clientes sin ubicación</h3>
                        <p>No hay clientes con coordenadas válidas.</p>
                        <p>Usa el botón 🌍 junto a cada dirección para geolocalizar</p>
                    `;
                    return;
                }

                clientesConCoords.forEach(cliente => {
                    const marker = new google.maps.Marker({
                        position: { lat: cliente.lat, lng: cliente.lng },
                        map: mapa,
                        title: cliente.nombre,
                        icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
                    });

                    marker.addListener('click', () => {
                        mostrarRuta(mapa, userPos, cliente);
                    });
                });

                const clienteCercano = encontrarClienteMasCercano(userPos, clientesConCoords);
                if (clienteCercano) {
                    mostrarRuta(mapa, userPos, clienteCercano);
                }
                
            } catch (error) {
                console.error("Error al cargar clientes:", error);
                document.getElementById('info-ruta').innerHTML = `
                    <p class="error">Error al cargar clientes: ${error.message}</p>
                `;
            }
        },
        (error) => {
            alert("Error al obtener ubicación: " + error.message);
        },
        { timeout: 10000 }
    );
}

function encontrarClienteMasCercano(posicionActual, clientes) {
    if (!posicionActual || !clientes || clientes.length === 0) return null;
    
    const clientesConDistancia = clientes.map(cliente => {
        const distancia = calcularDistancia(
            posicionActual.lat, posicionActual.lng,
            cliente.lat, cliente.lng
        );
        return { ...cliente, distancia };
    });
    
    return clientesConDistancia.sort((a, b) => a.distancia - b.distancia)[0];
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function mostrarRuta(mapa, origen, cliente) {
    const destino = { lat: cliente.lat, lng: cliente.lng };
    
    new google.maps.Marker({
        position: destino,
        map: mapa,
        title: cliente.nombre,
        icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
    });

    const directionsService = new google.maps.DirectionsService();
    const directionsRenderer = new google.maps.DirectionsRenderer();
    directionsRenderer.setMap(mapa);

    directionsService.route(
        {
            origin: origen,
            destination: destino,
            travelMode: 'DRIVING'
        },
        (response, status) => {
            if (status === 'OK') {
                directionsRenderer.setDirections(response);
                document.getElementById('info-ruta').innerHTML = `
                    <h3>Ruta a ${cliente.nombre}</h3>
                    <p><strong>Dirección:</strong> ${cliente.direccion || 'No disponible'}</p>
                    <p><strong>Teléfono:</strong> ${cliente.telefono || 'No disponible'}</p>
                `;
            } else {
                alert('Error al trazar ruta: ' + status);
            }
        }
    );
}

function registrarLlamada(btn, clienteId) {
    const fila = btn.closest("tr");
    const monto = fila.querySelector(".monto").value;
    const resultado = fila.querySelector(".resultado").value;
    const observaciones = fila.querySelector(".observaciones").value;

    if (!resultado) {
        alert("Seleccione un resultado para la llamada");
        return;
    }

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
    .then(res => res.json())
    .then(data => {
        if (data.status === "ok") {
            fila.remove();
            if (document.querySelectorAll("#tablaClientes tbody tr").length === 0) {
                document.querySelector("#tablaClientes tbody").innerHTML = `<tr><td colspan="10">¡Todos los clientes procesados!</td></tr>`;
            }
        } else {
            alert(data.mensaje || "Error al registrar llamada");
        }
    })
    .catch(error => {
        console.error("Error:", error);
        alert("Error al registrar la llamada");
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

    fetch("/actualizar-clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientes: actualizaciones })
    })
    .then(res => res.json())
    .then(data => {
        alert("✅ Asignaciones guardadas");
        cargarTodosLosClientes();
        if (!esAdmin) cargarClientes(usuarioActual.id);
    })
    .catch(error => {
        console.error("Error:", error);
        alert("❌ Error al guardar");
    });
}

function seleccionarTodo() {
    if (!usuarioActual || !esAdmin) return;
    
    document.querySelectorAll("#tablaAsignarClientes .usuarioSelect").forEach(select => {
        select.value = usuarioActual.id;
    });
    
    alert("Todos seleccionados. Recuerda guardar.");
}

function cargarUsuarios() {
    fetch("/usuarios")
        .then(res => res.json())
        .then(usuarios => {
            const tbody = document.querySelector("#tablaUsuarios tbody");
            tbody.innerHTML = usuarios.length === 0 ? 
                `<tr><td colspan="3">No hay usuarios</td></tr>` : "";
                
            usuarios.forEach(usuario => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${usuario.id}</td>
                    <td>${usuario.nombre}</td>
                    <td><button onclick="eliminarUsuario(${usuario.id})">🗑️ Eliminar</button></td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(error => {
            console.error("Error al cargar usuarios:", error);
            alert("Error al cargar usuarios");
        });
}

function agregarUsuario() {
    const nombre = document.getElementById("nuevoUsuarioNombre").value.trim();
    const password = document.getElementById("nuevoUsuarioPassword").value.trim();

    if (!nombre || !password) {
        alert("❌ Nombre y contraseña son obligatorios");
        return;
    }

    fetch("/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "ok") {
            alert(`✅ Usuario "${data.usuario.nombre}" creado`);
            document.getElementById("nuevoUsuarioNombre").value = "";
            document.getElementById("nuevoUsuarioPassword").value = "";
            cargarUsuarios();
        } else {
            throw new Error(data.mensaje || "Error al crear usuario");
        }
    })
    .catch(error => {
        console.error("Error al crear usuario:", error);
        alert(`❌ ${error.message}`);
    });
}

function eliminarUsuario(id) {
    if (!confirm(`¿Está seguro que desea eliminar este usuario?`)) return;

    fetch("/usuarios/eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "ok") {
            alert("✅ Usuario eliminado");
            cargarUsuarios();
        } else {
            alert(data.mensaje || "Error al eliminar");
        }
    })
    .catch(error => {
        console.error("Error al eliminar usuario:", error);
        alert("Error al eliminar usuario");
    });
}

function limpiarClientes() {
    if (!confirm("⚠️ ¿Está seguro que desea eliminar TODOS los clientes?")) return;

    fetch("/limpiar-clientes", { method: "POST" })
        .then(res => res.json())
        .then(data => {
            if (data.status === "ok") {
                alert("✅ Todos los clientes eliminados");
                cargarTodosLosClientes();
                if (!esAdmin) cargarClientes(usuarioActual.id);
            }
        })
        .catch(error => {
            console.error("Error al limpiar clientes:", error);
            alert("❌ Error al eliminar clientes");
        });
}

function procesarArchivo(event) {
    const file = event.target.files[0];
    if (!file) {
        document.getElementById("mensajeExcel").textContent = "❌ No se seleccionó archivo";
        return;
    }

    const mensajeExcel = document.getElementById("mensajeExcel");
    mensajeExcel.textContent = "Procesando...";
    mensajeExcel.style.color = "blue";

    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet);

            function detectarColumna(rows, posiblesNombres) {
                const keys = Object.keys(rows[0]);
                for (let key of keys) {
                    const k = key.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                    if (posiblesNombres.some(n => n.toLowerCase().includes(k))) return key;
                }
                return null;
            }

            const clienteCol = detectarColumna(rows, ["nombre", "cliente"]);
            if (!clienteCol) {
                mensajeExcel.textContent = "❌ No se encontró columna de nombres";
                mensajeExcel.style.color = "red";
                return;
            }

            const direccionCol = detectarColumna(rows, ["direccion", "dir", "dirección"]);
            if (!direccionCol) {
                mensajeExcel.textContent = "⚠️ Advertencia: No se encontró columna de dirección";
                mensajeExcel.style.color = "orange";
            }

            const clientesExcel = rows.map(row => ({
                nombre: row[clienteCol] || "Desconocido",
                telefono: detectarColumna(rows, ["telefono", "tel"]) ? row[detectarColumna(rows, ["telefono", "tel"])] : "",
                direccion: direccionCol ? row[direccionCol] : "",
                tarifa: detectarColumna(rows, ["tarifa", "monto"]) ? (isNaN(row[detectarColumna(rows, ["tarifa", "monto"])]) ? 0 : Number(row[detectarColumna(rows, ["tarifa", "monto"])])) : 0,
                saldo_exigible: detectarColumna(rows, ["saldo exigible"]) ? (isNaN(row[detectarColumna(rows, ["saldo exigible"])]) ? 0 : Number(row[detectarColumna(rows, ["saldo exigible"])])) : 0,
                saldo: detectarColumna(rows, ["saldo"]) ? (isNaN(row[detectarColumna(rows, ["saldo"])]) ? 0 : Number(row[detectarColumna(rows, ["saldo"])])) : 0,
                asignado_a: null
            }));

            fetch("/cargar-clientes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientes: clientesExcel })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === "ok") {
                    let msg = `✅ ${data.mensaje}`;
                    if (data.clientesConCoordenadas > 0) {
                        msg += ` (${data.clientesConCoordenadas} con coordenadas geográficas)`;
                    } else if (direccionCol) {
                        msg += `. Nota: ${data.clientesConCoordenadas} direcciones pudieron ser geocodificadas`;
                    }
                    mensajeExcel.textContent = msg;
                    mensajeExcel.style.color = "green";
                    event.target.value = "";
                    cargarTodosLosClientes();
                } else {
                    throw new Error(data.mensaje || "Error desconocido");
                }
            })
            .catch(error => {
                mensajeExcel.textContent = `❌ ${error.message}`;
                mensajeExcel.style.color = "red";
            });
        } catch (error) {
            mensajeExcel.textContent = "❌ Error al procesar archivo";
            mensajeExcel.style.color = "red";
            console.error("Error:", error);
        }
    };
    reader.readAsArrayBuffer(file);
}

function cargarReporte() {
    fetch("/reporte")
        .then(res => res.json())
        .then(datos => {
            const tbody = document.querySelector("#tablaReporte tbody");
            tbody.innerHTML = datos.length === 0 ? 
                `<tr><td colspan="9">No hay registros</td></tr>` : "";
                
            datos.forEach(row => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${row.usuario}</td>
                    <td>${row.cliente}</td>
                    <td>${row.resultado}</td>
                    <td>$${parseFloat(row.monto_cobrado).toFixed(2)}</td>
                    <td>${row.fecha}</td>
                    <td>${row.observaciones || "-"}</td>
                    <td>${row.tarifa}</td>
                    <td>${row.saldo_exigible}</td>
                    <td>${row.saldo}</td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(error => {
            console.error("Error al cargar reporte:", error);
            alert("Error al cargar reporte");
        });
}

function exportarReporte() {
    fetch("/reporte")
        .then(res => res.json())
        .then(datos => {
            if (datos.length === 0) {
                alert("No hay datos para exportar");
                return;
            }
            
            const ws = XLSX.utils.json_to_sheet(datos);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Reporte");
            XLSX.writeFile(wb, `reporte_${new Date().toISOString().split('T')[0]}.xlsx`);
        })
        .catch(error => {
            console.error("Error al exportar:", error);
            alert("Error al exportar");
        });
}

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
window.inicializarMapa = inicializarMapa;
window.geocodificarCliente = geocodificarCliente;
window.mostrarClienteEnMapa = mostrarClienteEnMapa;