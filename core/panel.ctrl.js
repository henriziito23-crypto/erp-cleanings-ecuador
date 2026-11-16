// =====================================================================
// ARCHIVO: core/panel.ctrl.js
// Controlador Central del ERP (Diseño Expandido + CRUD Contratos/Áreas/PINs)
// =====================================================================
import { supabase, generarDatosQRPuerta } from "./supabaseClient.js";
import {
  obtenerParametrosURL,
  homologarRol,
  guardarSesionActiva,
  obtenerSesionActiva,
  cerrarSesionTrazabilidad,
  navegarAVista,
  obtenerContratosAutorizados,
  obtenerMapaPisosAreasPorContrato
} from "./router.js";
import {
  inicializarMonitorOffline,
  sincronizarCacheUsuariosPin,
  buscarUsuarioPorPinOffline,
  guardarCacheContratos,
  obtenerCacheContratos,
  guardarCacheCatalogoAreas,
  obtenerCacheCatalogoAreas
} from "./offlineSync.js";

let parametrosQR = {};
let listaContratosUsuario = [];
let mapaCatalogoContratoActual = {};
let cacheUsuariosContratoActual = [];

document.addEventListener("DOMContentLoaded", async () => {
  inicializarMonitorOffline();
  sincronizarCacheUsuariosPin();
  parametrosQR = obtenerParametrosURL();

  if (parametrosQR.piso && parametrosQR.area) {
    const textoContrato = parametrosQR.contrato ? `[${parametrosQR.contrato}] ` : "";
    document.getElementById("lblAreaQR").innerText = `${textoContrato}${parametrosQR.area} (${parametrosQR.piso})`;
    document.getElementById("cajaQrDetectado").style.display = "block";
  }

  document.getElementById("formAcceso").addEventListener("submit", validarIngresoPIN);
  document.getElementById("btnSalir").addEventListener("click", cerrarSesionTrazabilidad);
  document.getElementById("selContratoActivo").addEventListener("change", alCambiarContratoActivo);
  document.getElementById("txtBuscarContrato").addEventListener("input", filtrarComboContratos);

  // Botones de navegación entre el Hub Central, Control de Contratos y Trazabilidad
  document.getElementById("btnAbrirModuloContratos").addEventListener("click", async () => {
    const sesion = obtenerSesionActiva();
    if (sesion) await abrirModuloControlContratos(sesion);
  });

  document.getElementById("btnVolverDesdeContratos").addEventListener("click", () => {
    mostrarHubPrincipalERP();
  });

  document.getElementById("btnAbrirModuloTrazabilidad").addEventListener("click", async () => {
    const sesion = obtenerSesionActiva();
    if (sesion) await abrirSubventanaTrazabilidad(sesion);
  });

  document.getElementById("btnVolverAlHubERP").addEventListener("click", () => {
    mostrarHubPrincipalERP();
  });

  // Otros módulos del ERP
  document.querySelectorAll(".module-card[data-modulo-erp]").forEach(card => {
    card.addEventListener("click", () => {
      const mod = card.getAttribute("data-modulo-erp");
      if (mod === "asistencia") {
        window.location.href = "./modulo-asistencia/views/asistencia.html";
        return;
      }
      if (mod === "supervision") {
        window.location.href = "./modulo-supervision/views/supervision.html";
        return;
      }
      const nombres = {
        logistica: "CONTROL DE LOGÍSTICA",
        inventarios: "CONTROL DE INVENTARIOS"
      };
      alert(`Módulo seleccionado: ${nombres[mod]}.\nListo para enlazar su carpeta modular.`);
    });
  });

  // Navegación interna hacia las vistas de Trazabilidad
  document.querySelectorAll(".module-card[data-destino]").forEach(card => {
    card.addEventListener("click", () => {
      const destino = card.getAttribute("data-destino");
      const contratoElegido = document.getElementById("selContratoActivo").value || parametrosQR.contrato;
      if (!contratoElegido) {
        alert("Seleccione primero un Contrato / Cliente activo.");
        return;
      }
      sessionStorage.setItem("erp_vista_activa", "TRAZABILIDAD");
      navegarAVista(destino, contratoElegido);
    });
  });

  // Eventos del Módulo CONTROL DE CONTRATOS (CRUD Contratos, Áreas y Rol/PIN de Usuarios)
  document.getElementById("admSelContratoMaestro").addEventListener("change", cargarDetallesContratoAdmin);
  document.getElementById("formNuevoContrato").addEventListener("submit", guardarOModificarContrato);
  document.getElementById("btnCapturarMiGPSContrato")?.addEventListener("click", capturarGPSParaContrato);
  document.getElementById("btnCancelarEdicionContrato").addEventListener("click", limpiarFormularioContrato);

  document.getElementById("formNuevaArea").addEventListener("submit", guardarOModificarArea);
  document.getElementById("btnCancelarEdicionArea").addEventListener("click", limpiarFormularioArea);

  document.getElementById("admSelUsuarioRegistrado").addEventListener("change", alSeleccionarUsuarioDelContrato);
  document.getElementById("formAsignarRolPin").addEventListener("submit", guardarRolYPinDeUsuario);

  // Eventos de QRs
  document.getElementById("qrSelPiso").addEventListener("change", poblarAreasModalQR);
  document.getElementById("btnGenerarImagenQR").addEventListener("click", mostrarQRGenerado);
  document.getElementById("btnExportarExcelQRs").addEventListener("click", exportarTodosLosQRsAExcel);
  document.getElementById("btnImprimirCatalogoQRs").addEventListener("click", imprimirPlanchaEtiquetasQR);

  const sesionPrevia = obtenerSesionActiva();
  if (sesionPrevia && sesionPrevia.rol !== "AUXILIAR") {
    await enrutarSegunRol(sesionPrevia, true);
  }
});

async function validarIngresoPIN(e) {
  e.preventDefault();
  const input = document.getElementById("txtCodigo");
  const pin = (input.value || "").trim().toUpperCase();
  const btn = document.getElementById("btnIngresar");
  const err = document.getElementById("msgError");

  if (!pin) return;

  btn.disabled = true;
  btn.innerText = "Verificando credenciales en el ERP...";
  err.style.display = "none";

  let usuario = null;
  let validadoOffline = false;

  try {
    if (navigator.onLine) {
      const { data, error } = await supabase
        .from("trazabilidad_usuarios")
        .select("id, codigo_pin, nombre_completo, rol, cargo_etiqueta, activo")
        .eq("codigo_pin", pin)
        .eq("activo", true)
        .maybeSingle();

      if (error) throw error;
      usuario = data;
      sincronizarCacheUsuariosPin();
    } else {
      usuario = buscarUsuarioPorPinOffline(pin);
      validadoOffline = true;
    }
  } catch (errConexion) {
    usuario = buscarUsuarioPorPinOffline(pin);
    validadoOffline = true;

    if (!usuario) {
      btn.disabled = false;
      btn.innerText = "🔐 Validar Acceso al ERP";
      err.innerText = "📡 Sin conexión a internet y este dispositivo aún no tiene descargado el padrón de PINs. Conéctese una vez a la red para habilitar el modo offline.";
      err.style.display = "block";
      return;
    }
  }

  if (!usuario) {
    btn.disabled = false;
    btn.innerText = "🔐 Validar Acceso al ERP";
    err.innerText = "Código PIN no registrado o usuario inactivo.";
    err.style.display = "block";
    input.value = "";
    input.focus();
    return;
  }

  const rol = homologarRol(usuario.rol);
  const tieneQR = (parametrosQR.piso !== "" && parametrosQR.area !== "");

  if (rol === "AUXILIAR") {
    if (!tieneQR) {
      btn.disabled = false;
      btn.innerText = "🔐 Validar Acceso al ERP";
      err.innerText = "⛔ ACCESO RESTRINGIDO:\nDebe escanear el código QR físico de la puerta del área para registrar la limpieza.";
      err.style.display = "block";
      input.value = "";
      return;
    }
    guardarSesionActiva(usuario, parametrosQR);
    navegarAVista("registro.html", parametrosQR.contrato);
    return;
  }

  if (rol === "SUPERVISOR") {
    if (!tieneQR) {
      btn.disabled = false;
      btn.innerText = "🔐 Validar Acceso al ERP";
      err.innerText = "⛔ ACCESO RESTRINGIDO:\nDebe ingresar escaneando el código QR físico del área para auditar o consultar métricas.";
      err.style.display = "block";
      input.value = "";
      return;
    }

    if (!validadoOffline && navigator.onLine) {
      const contratosAsignados = await obtenerContratosAutorizados(usuario.id, rol);
      const codigosPermitidos = contratosAsignados.map(c => c.codigo_contrato.toUpperCase());

      if (codigosPermitidos.length === 0) {
        btn.disabled = false;
        btn.innerText = "🔐 Validar Acceso al ERP";
        err.innerText = "⛔ Su usuario no tiene ningún contrato asignado en el ERP.";
        err.style.display = "block";
        return;
      }

      if (parametrosQR.contrato && !codigosPermitidos.includes(parametrosQR.contrato.toUpperCase())) {
        btn.disabled = false;
        btn.innerText = "🔐 Validar Acceso al ERP";
        err.innerText = `⛔ ACCESO DENEGADO AL CONTRATO [${parametrosQR.contrato}]:\nSu rol (${usuario.cargo_etiqueta || "AUDITOR"}) solo tiene autorización sobre: ${codigosPermitidos.join(", ")}.`;
        err.style.display = "block";
        input.value = "";
        return;
      }
    }
  }

  sessionStorage.removeItem("erp_vista_activa");
  const sesion = guardarSesionActiva(usuario, parametrosQR);
  btn.disabled = false;
  btn.innerText = "🔐 Validar Acceso al ERP";
  await enrutarSegunRol(sesion, false);
}

async function enrutarSegunRol(sesion, esRetornoDeSubvista) {
  document.getElementById("contenedorTarjetaERP").classList.add("erp-expanded");

  document.getElementById("seccionLogin").style.display = "none";
  document.getElementById("barraSesionActiva").style.display = "block";
  document.getElementById("lblUsuario").innerText = sesion.nombre;
  document.getElementById("lblRol").innerText = sesion.cargoEtiqueta || sesion.rol;

  if (sesion.rol === "CONTROL") {
    document.getElementById("cajaHerramientasRoot").style.display = "block";
    const vistaPrevia = sessionStorage.getItem("erp_vista_activa");
    if (esRetornoDeSubvista && vistaPrevia === "TRAZABILIDAD") {
      await abrirSubventanaTrazabilidad(sesion);
    } else if (esRetornoDeSubvista && vistaPrevia === "CONTRATOS") {
      await abrirModuloControlContratos(sesion);
    } else {
      mostrarHubPrincipalERP();
    }
  } else {
    await abrirSubventanaTrazabilidad(sesion);
  }
}

function mostrarHubPrincipalERP() {
  sessionStorage.setItem("erp_vista_activa", "HUB_PRINCIPAL");
  document.getElementById("lblTituloCabecera").innerText = "ERP DE CONTROL OPERATIVO";
  document.getElementById("lblContratoCabecera").innerText =
    "Gestión Integral de Operaciones, Calidad, Logística y SST";

  document.getElementById("seccionModulos").style.display = "none";
  document.getElementById("seccionControlContratos").style.display = "none";
  document.getElementById("seccionHubERP").style.display = "block";
}

// =====================================================================
// MÓDULO: CONTROL DE CONTRATOS (VER/EDITAR CONTRATOS, ÁREAS Y USUARIOS)
// =====================================================================
async function abrirModuloControlContratos(sesion) {
  sessionStorage.setItem("erp_vista_activa", "CONTRATOS");
  document.getElementById("lblTituloCabecera").innerText = "CONTROL DE CONTRATOS";
  document.getElementById("lblContratoCabecera").innerText =
    "Gestión de Contratos Creados, Pisos/Áreas y Asignación de PIN/Rol por Contrato";

  document.getElementById("seccionHubERP").style.display = "none";
  document.getElementById("seccionModulos").style.display = "none";
  document.getElementById("seccionControlContratos").style.display = "block";

  await recargarDatosModuloContratos();
}

async function recargarDatosModuloContratos(codigoSeleccionar = "") {
  const sel = document.getElementById("admSelContratoMaestro");
  const valorPrevio = codigoSeleccionar || sel.value;

  const { data: contratos, error } = await supabase
    .from("trazabilidad_contratos")
    .select("*")
    .order("nombre_cliente", { ascending: true });

  if (error) {
    alert("Error al consultar contratos: " + error.message);
    return;
  }

  listaContratosUsuario = contratos || [];
  guardarCacheContratos(listaContratosUsuario);

  document.getElementById("badgeTotalContratosAdmin").innerText =
    `${listaContratosUsuario.length} Contratos Registrados`;

  sel.innerHTML = "";
  listaContratosUsuario.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.codigo_contrato;
    opt.textContent = `${c.nombre_cliente} [${c.codigo_contrato}] — ${c.ciudad || "Quito"}`;
    opt.dataset.contratoId = c.id;
    opt.dataset.nombreCliente = c.nombre_cliente;
    sel.appendChild(opt);
  });

  if (valorPrevio && listaContratosUsuario.some(c => c.codigo_contrato === valorPrevio)) {
    sel.value = valorPrevio;
  }

  renderizarTablaContratosCreados(listaContratosUsuario);
  await cargarDetallesContratoAdmin();
}

function capturarGPSParaContrato() {
  if (!navigator.geolocation) {
    alert("Su navegador no soporta geolocalización.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById("admLatitudContrato").value = pos.coords.latitude.toFixed(7);
      document.getElementById("admLongitudContrato").value = pos.coords.longitude.toFixed(7);
      const precision = Math.round(pos.coords.accuracy);
      mostrarFeedbackAdmin(`📡 Coordenadas GPS capturadas (Margen: ±${precision}m).`);
    },
    err => alert("No se pudo obtener el GPS: " + err.message),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function renderizarTablaContratosCreados(contratos) {
  const tbody = document.getElementById("tablaListaContratosAdm");
  tbody.innerHTML = "";

  if (contratos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No hay contratos registrados.</td></tr>';
    return;
  }

  const urlRaiz = obtenerUrlRaizERP();

  contratos.forEach((c, idx) => {
    const urlTimbradoPunto = `${urlRaiz}/asistencia-qr.html?contrato=${encodeURIComponent(c.codigo_contrato)}`;
    const qrImgPunto = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=8&data=${encodeURIComponent(urlTimbradoPunto)}`;

    const turnosTxt = [
      c.turno_1_horario ? `<div><strong>T1:</strong> ${c.turno_1_horario}</div>` : "",
      c.turno_2_horario ? `<div><strong>T2:</strong> ${c.turno_2_horario}</div>` : "",
      c.turno_3_horario ? `<div><strong>T3:</strong> ${c.turno_3_horario}</div>` : "",
      c.turno_4_horario ? `<div><strong>T4:</strong> ${c.turno_4_horario}</div>` : "",
      c.tiene_turno_especial ? `<span class="badge bg-info text-dark mt-1">✓ Banco de Horas</span>` : ""
    ].join("");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center fw-bold text-muted">${idx + 1}</td>
      <td>
        <div class="fw-bold text-primary">${c.codigo_contrato}</div>
        <div class="fw-bold text-dark">${c.nombre_cliente}</div>
        <small class="text-muted">${c.ciudad || "Quito"}</small>
      </td>
      <td>
        <div class="fw-bold">${c.representante_nombre || "-"}</div>
        <small class="text-muted d-block">${c.representante_cargo || "-"}</small>
        <small class="text-primary">${c.representante_correo || "-"} | 📞 ${c.representante_telefono || "-"}</small>
      </td>
      <td class="small">${turnosTxt}</td>
      <td class="text-center small">
        <div>${c.latitud ?? "-"}, ${c.longitud ?? "-"}</div>
        <span class="badge bg-success">${c.radio_metros ?? 150} m</span>
      </td>
      <td class="text-center">
        <a href="${urlTimbradoPunto}" target="_blank" class="btn btn-sm btn-outline-dark py-0 px-2 fw-bold mb-1 d-block">📷 Abrir Reloj QR</a>
        <a href="${qrImgPunto}" target="_blank" class="small text-primary fw-bold text-decoration-none">Ver Imagen QR ↗</a>
      </td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold me-1" data-edit-contrato="${c.id}">✏️</button>
        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold" data-del-contrato="${c.id}">🗑️</button>
      </td>
    `;

    tr.querySelector(`[data-edit-contrato="${c.id}"]`).addEventListener("click", () => prepararEdicionContrato(c));
    tr.querySelector(`[data-del-contrato="${c.id}"]`).addEventListener("click", () => eliminarContrato(c));
    tbody.appendChild(tr);
  });
}

function prepararEdicionContrato(contrato) {
  document.getElementById("editContratoId").value = contrato.id;
  document.getElementById("admCodContrato").value = contrato.codigo_contrato;
  document.getElementById("admNomContrato").value = contrato.nombre_cliente;
  document.getElementById("admCiudadContrato").value = contrato.ciudad || "Quito";
  document.getElementById("admLatitudContrato").value = contrato.latitud ?? -0.1806530;
  document.getElementById("admLongitudContrato").value = contrato.longitud ?? -78.4678340;
  document.getElementById("admRadioContrato").value = contrato.radio_metros ?? 150;

  document.getElementById("admRepNombre").value = contrato.representante_nombre || "";
  document.getElementById("admRepCargo").value = contrato.representante_cargo || "";
  document.getElementById("admRepCorreo").value = contrato.representante_correo || "";
  document.getElementById("admRepTelefono").value = contrato.representante_telefono || "";

  document.getElementById("admTurno1").value = contrato.turno_1_horario || "07:00 - 15:30";
  document.getElementById("admTurno2").value = contrato.turno_2_horario || "";
  document.getElementById("admTurno3").value = contrato.turno_3_horario || "";
  document.getElementById("admTurno4").value = contrato.turno_4_horario || "";
  document.getElementById("admCheckTurnoEspecial").checked = Boolean(contrato.tiene_turno_especial);

  document.getElementById("lblTituloFormContrato").innerText = `✏️ MODIFICANDO CONTRATO: ${contrato.nombre_cliente}`;
  document.getElementById("btnGuardarContrato").innerText = "💾 Actualizar Contrato";
  document.getElementById("btnGuardarContrato").className = "btn btn-sm btn-warning w-100 fw-bold text-dark py-2";
  document.getElementById("btnCancelarEdicionContrato").style.display = "inline-block";
}

function limpiarFormularioContrato() {
  document.getElementById("formNuevoContrato").reset();
  document.getElementById("editContratoId").value = "";
  document.getElementById("admCiudadContrato").value = "Quito";
  document.getElementById("admLatitudContrato").value = "-0.1806530";
  document.getElementById("admLongitudContrato").value = "-78.4678340";
  document.getElementById("admRadioContrato").value = "150";
  document.getElementById("admTurno1").value = "07:00 - 15:30";
  document.getElementById("admTurno2").value = "13:00 - 21:00";
  document.getElementById("admTurno3").value = "21:00 - 07:00";
  document.getElementById("admTurno4").value = "";
  document.getElementById("admCheckTurnoEspecial").checked = false;

  document.getElementById("lblTituloFormContrato").innerText =
    "➕ REGISTRAR / CONFIGURAR CONTRATO (GEOCERCA GPS, REPRESENTANTE Y TURNOS T1-T4)";
  document.getElementById("btnGuardarContrato").innerText = "💾 Guardar Contrato con Geocerca, Representante y Turnos";
  document.getElementById("btnGuardarContrato").className = "btn btn-sm btn-primary w-100 fw-bold py-2";
  document.getElementById("btnCancelarEdicionContrato").style.display = "none";
}

async function guardarOModificarContrato(e) {
  e.preventDefault();
  const editId = document.getElementById("editContratoId").value;
  const codigo = document.getElementById("admCodContrato").value.trim().toUpperCase();
  const nombre = document.getElementById("admNomContrato").value.trim().toUpperCase();

  const payload = {
    codigo_contrato: codigo,
    nombre_cliente: nombre,
    ciudad: document.getElementById("admCiudadContrato").value.trim(),
    latitud: parseFloat(document.getElementById("admLatitudContrato").value),
    longitud: parseFloat(document.getElementById("admLongitudContrato").value),
    radio_metros: parseInt(document.getElementById("admRadioContrato").value, 10) || 150,
    representante_nombre: document.getElementById("admRepNombre").value.trim().toUpperCase(),
    representante_cargo: document.getElementById("admRepCargo").value.trim().toUpperCase(),
    representante_correo: document.getElementById("admRepCorreo").value.trim().toLowerCase(),
    representante_telefono: document.getElementById("admRepTelefono").value.trim(),
    turno_1_horario: document.getElementById("admTurno1").value.trim(),
    turno_2_horario: document.getElementById("admTurno2").value.trim(),
    turno_3_horario: document.getElementById("admTurno3").value.trim(),
    turno_4_horario: document.getElementById("admTurno4").value.trim(),
    tiene_turno_especial: document.getElementById("admCheckTurnoEspecial").checked,
    activo: true
  };

  const res = editId
    ? await supabase.from("trazabilidad_contratos").update(payload).eq("id", editId)
    : await supabase.from("trazabilidad_contratos").insert([payload]);

  if (res.error) {
    alert("Error al guardar contrato: " + res.error.message);
    return;
  }

  mostrarFeedbackAdmin(`✓ Contrato ${nombre} (${codigo}) guardado correctamente.`);
  limpiarFormularioContrato();
  await recargarDatosModuloContratos(codigo);
}

async function eliminarContrato(contrato) {
  const confirmar = confirm(`¿Está seguro de eliminar el contrato "${contrato.nombre_cliente}" (${contrato.codigo_contrato}) y sus áreas asociadas?`);
  if (!confirmar) return;

  const { error } = await supabase
    .from("trazabilidad_contratos")
    .delete()
    .eq("id", contrato.id);

  if (error) {
    alert("Error al eliminar contrato: " + error.message);
    return;
  }

  mostrarFeedbackAdmin(`🗑️ Contrato ${contrato.nombre_cliente} eliminado.`);
  await recargarDatosModuloContratos();
}

// =====================================================================
// PESTAÑA 2: PISOS Y ÁREAS (VER, CREAR, MODIFICAR Y ELIMINAR)
// =====================================================================
async function cargarDetallesContratoAdmin() {
  const sel = document.getElementById("admSelContratoMaestro");
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.dataset.contratoId) return;

  const contratoId = opt.dataset.contratoId;
  const nombreCliente = opt.dataset.nombreCliente;

  const { data: areas, error: errAreas } = await supabase
    .from("trazabilidad_areas")
    .select("*")
    .eq("contrato_id", contratoId)
    .order("piso", { ascending: true })
    .order("nombre_area", { ascending: true });

  const tbodyAreas = document.getElementById("tablaResumenAreasAdm");
  tbodyAreas.innerHTML = "";
  const listaAreas = areas || [];

  document.getElementById("lblResumenAreasContrato").innerText =
    `PISOS Y ÁREAS DE ${nombreCliente} (${listaAreas.length} registradas):`;

  if (errAreas || listaAreas.length === 0) {
    tbodyAreas.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Sin áreas registradas en este contrato.</td></tr>';
  } else {
    listaAreas.forEach((a, idx) => {
      const tr = document.createElement("tr");
      const badgeColor = a.modelo_area === "CRITICA"
        ? "bg-danger"
        : (a.modelo_area === "BANOS"
          ? "bg-primary"
          : (a.modelo_area === "NOCRITICA" ? "bg-success" : "bg-warning text-dark"));
      tr.innerHTML = `
        <td class="text-center fw-bold text-muted">${idx + 1}</td>
        <td class="fw-bold text-dark">${a.piso}</td>
        <td class="fw-semibold">${a.nombre_area}</td>
        <td class="text-center"><span class="badge ${badgeColor}">${a.modelo_area}</span></td>
        <td class="text-center fw-bold">${a.umbral_rlu} RLU</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold me-1" data-edit-area="${a.id}">
            ✏️ Editar
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold" data-del-area="${a.id}">
            🗑️
          </button>
        </td>
      `;

      tr.querySelector(`[data-edit-area="${a.id}"]`).addEventListener("click", () => {
        prepararEdicionArea(a);
      });
      tr.querySelector(`[data-del-area="${a.id}"]`).addEventListener("click", () => {
        eliminarAreaContrato(a);
      });

      tbodyAreas.appendChild(tr);
    });
  }

  await cargarUsuariosRegistradosEnContrato(contratoId, nombreCliente);
}

function prepararEdicionArea(area) {
  document.getElementById("editAreaId").value = area.id;
  document.getElementById("admPisoArea").value = area.piso;
  document.getElementById("admNombreArea").value = area.nombre_area;
  document.getElementById("admModeloArea").value = area.modelo_area;

  document.getElementById("lblTituloFormArea").innerText = `✏️ MODIFICANDO ÁREA: ${area.nombre_area} (${area.piso})`;
  document.getElementById("btnGuardarArea").innerText = "💾 Actualizar";
  document.getElementById("btnGuardarArea").className = "btn btn-sm btn-warning w-100 fw-bold text-dark";
  document.getElementById("btnCancelarEdicionArea").style.display = "inline-block";
}

function limpiarFormularioArea() {
  document.getElementById("editAreaId").value = "";
  document.getElementById("admPisoArea").value = "";
  document.getElementById("admNombreArea").value = "";
  document.getElementById("admModeloArea").value = "SEMICRITICA";
  document.getElementById("lblTituloFormArea").innerText = "➕ AGREGAR PISO / ÁREA AL CONTRATO SELECCIONADO";
  document.getElementById("btnGuardarArea").innerText = "+ Guardar Área";
  document.getElementById("btnGuardarArea").className = "btn btn-sm btn-success w-100 fw-bold";
  document.getElementById("btnCancelarEdicionArea").style.display = "none";
}

async function guardarOModificarArea(e) {
  e.preventDefault();
  const sel = document.getElementById("admSelContratoMaestro");
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.dataset.contratoId) {
    alert("Seleccione primero un contrato arriba.");
    return;
  }

  const contratoId = opt.dataset.contratoId;
  const editAreaId = document.getElementById("editAreaId").value;
  const piso = document.getElementById("admPisoArea").value.trim().toUpperCase();
  const nombreArea = document.getElementById("admNombreArea").value.trim().toUpperCase();
  const modelo = document.getElementById("admModeloArea").value;
  const umbral = modelo === "CRITICA" ? 15 : 45;

  if (editAreaId) {
    const { error } = await supabase
      .from("trazabilidad_areas")
      .update({ piso, nombre_area: nombreArea, modelo_area: modelo, umbral_rlu: umbral })
      .eq("id", editAreaId);

    if (error) {
      alert("Error al modificar área: " + error.message);
      return;
    }
    mostrarFeedbackAdmin(`✓ Área ${nombreArea} (${piso}) modificada correctamente.`);
  } else {
    const { error } = await supabase
      .from("trazabilidad_areas")
      .insert([{
        contrato_id: contratoId,
        piso,
        nombre_area: nombreArea,
        modelo_area: modelo,
        umbral_rlu: umbral,
        activo: true
      }]);

    if (error) {
      alert("Error al registrar área: " + error.message);
      return;
    }
    mostrarFeedbackAdmin(`✓ Área ${nombreArea} (${piso}) agregada a ${opt.dataset.nombreCliente}.`);
  }

  limpiarFormularioArea();
  await cargarDetallesContratoAdmin();
}

async function eliminarAreaContrato(area) {
  const confirmar = confirm(`¿Desea eliminar el área "${area.nombre_area}" del ${area.piso}?`);
  if (!confirmar) return;

  const { error } = await supabase
    .from("trazabilidad_areas")
    .delete()
    .eq("id", area.id);

  if (error) {
    alert("Error al eliminar área: " + error.message);
    return;
  }

  mostrarFeedbackAdmin(`🗑️ Área ${area.nombre_area} eliminada.`);
  await cargarDetallesContratoAdmin();
}

// =====================================================================
// PESTAÑA 3: ENCARGADOS Y USUARIOS REGISTRADOS EN EL CONTRATO
// =====================================================================
async function cargarUsuariosRegistradosEnContrato(contratoId, nombreCliente) {
  document.getElementById("lblTituloTablaUsuariosContrato").innerText =
    `USUARIOS Y ENCARGADOS REGISTRADOS EN: ${nombreCliente}`;

  const { data: puente } = await supabase
    .from("trazabilidad_contrato_supervisores")
    .select("supervisor_id")
    .eq("contrato_id", contratoId);

  const idsPuente = (puente || []).map(p => p.supervisor_id);

  let query = supabase
    .from("trazabilidad_usuarios")
    .select("*")
    .eq("activo", true);

  if (idsPuente.length > 0) {
    query = query.or(`contrato_base_id.eq.${contratoId},id.in.(${idsPuente.join(",")})`);
  } else {
    query = query.eq("contrato_base_id", contratoId);
  }

  const { data: usuariosContrato, error } = await query.order("nombre_completo", { ascending: true });
  cacheUsuariosContratoActual = usuariosContrato || [];

  const selUser = document.getElementById("admSelUsuarioRegistrado");
  selUser.innerHTML = "";

  if (error || cacheUsuariosContratoActual.length === 0) {
    selUser.innerHTML = '<option value="">Sin usuarios registrados en este contrato (Créelos en el Módulo de Usuarios)</option>';
  } else {
    selUser.innerHTML = '<option value="">-- Seleccione un trabajador de este contrato --</option>';
    cacheUsuariosContratoActual.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = `${u.nombre_completo} (PIN actual: ${u.codigo_pin || "S/N"} | Rol: ${u.rol})`;
      selUser.appendChild(opt);
    });
  }

  const tbodyUsers = document.getElementById("tablaResumenUsuariosAdm");
  tbodyUsers.innerHTML = "";

  if (cacheUsuariosContratoActual.length === 0) {
    tbodyUsers.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted py-3">
          No hay usuarios asignados a <strong>${nombreCliente}</strong> todavía.<br>
          <small>Cuando registre personal y lo asigne a este contrato en el Módulo de Creación de Usuarios, aparecerán automáticamente aquí para configurar su PIN y Rol.</small>
        </td>
      </tr>
    `;
    return;
  }

  cacheUsuariosContratoActual.forEach((u, idx) => {
    const tr = document.createElement("tr");
    const colorRol = u.rol === "CONTROL" ? "bg-danger" : (u.rol === "SUPERVISOR" ? "bg-dark" : "bg-secondary");

    tr.innerHTML = `
      <td class="text-center fw-bold text-muted">${idx + 1}</td>
      <td class="fw-bold text-dark">${u.nombre_completo}</td>
      <td>${u.cargo_etiqueta || "-"}</td>
      <td class="text-center"><span class="badge ${colorRol}">${u.rol}</span></td>
      <td class="text-center fw-bold text-primary">${u.codigo_pin || "-"}</td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold me-1" data-edit-user="${u.id}">
          ✏️ PIN / Rol
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold" data-del-user="${u.id}">
          🗑️ Quitar
        </button>
      </td>
    `;

    tr.querySelector(`[data-edit-user="${u.id}"]`).addEventListener("click", () => {
      selUser.value = u.id;
      alSeleccionarUsuarioDelContrato();
      selUser.focus();
    });

    tr.querySelector(`[data-del-user="${u.id}"]`).addEventListener("click", () => {
      desvincularUsuarioDelContrato(u, contratoId);
    });

    tbodyUsers.appendChild(tr);
  });
}

function alSeleccionarUsuarioDelContrato() {
  const userId = document.getElementById("admSelUsuarioRegistrado").value;
  const usuario = cacheUsuariosContratoActual.find(u => u.id === userId);

  if (!usuario) {
    document.getElementById("admPinUsuario").value = "";
    document.getElementById("admEtiquetaUsuario").value = "";
    return;
  }

  document.getElementById("admPinUsuario").value = usuario.codigo_pin || "";
  document.getElementById("admRolPermiso").value = homologarRol(usuario.rol);
  document.getElementById("admEtiquetaUsuario").value = usuario.cargo_etiqueta || usuario.rol;
}

async function guardarRolYPinDeUsuario(e) {
  e.preventDefault();
  const selContrato = document.getElementById("admSelContratoMaestro");
  const optContrato = selContrato.options[selContrato.selectedIndex];
  const userId = document.getElementById("admSelUsuarioRegistrado").value;

  if (!optContrato || !optContrato.dataset.contratoId || !userId) {
    alert("Seleccione primero un trabajador de la lista del contrato.");
    return;
  }

  const contratoId = optContrato.dataset.contratoId;
  const pin = document.getElementById("admPinUsuario").value.trim().toUpperCase();
  const rol = document.getElementById("admRolPermiso").value;
  const etiqueta = document.getElementById("admEtiquetaUsuario").value.trim().toUpperCase();

  const { error } = await supabase
    .from("trazabilidad_usuarios")
    .update({
      codigo_pin: pin,
      rol: rol,
      cargo_etiqueta: etiqueta,
      contrato_base_id: contratoId
    })
    .eq("id", userId);

  if (error) {
    alert("Error al actualizar PIN/Rol del usuario: " + error.message);
    return;
  }

  if (rol === "SUPERVISOR") {
    await supabase
      .from("trazabilidad_contrato_supervisores")
      .upsert([{ contrato_id: contratoId, supervisor_id: userId }], { onConflict: "contrato_id,supervisor_id" });
  }

  sincronizarCacheUsuariosPin();
  mostrarFeedbackAdmin(`✓ PIN (${pin}) y Rol (${rol}) actualizados correctamente.`);
  await cargarUsuariosRegistradosEnContrato(contratoId, optContrato.dataset.nombreCliente);
}

async function desvincularUsuarioDelContrato(usuario, contratoId) {
  const confirmar = confirm(`¿Desea quitar a "${usuario.nombre_completo}" de este contrato?`);
  if (!confirmar) return;

  await supabase
    .from("trazabilidad_contrato_supervisores")
    .delete()
    .eq("contrato_id", contratoId)
    .eq("supervisor_id", usuario.id);

  await supabase
    .from("trazabilidad_usuarios")
    .update({ contrato_base_id: null })
    .eq("id", usuario.id)
    .eq("contrato_base_id", contratoId);

  mostrarFeedbackAdmin(`🗑️ Usuario ${usuario.nombre_completo} desvinculado del contrato.`);
  const sel = document.getElementById("admSelContratoMaestro");
  const opt = sel.options[sel.selectedIndex];
  await cargarUsuariosRegistradosEnContrato(contratoId, opt ? opt.dataset.nombreCliente : "");
}

function mostrarFeedbackAdmin(msg) {
  const box = document.getElementById("admMensajeFeedback");
  box.innerText = msg;
  box.style.display = "block";
  setTimeout(() => (box.style.display = "none"), 4000);
}

// =====================================================================
// SUB-VENTANA: MÓDULO DE REGISTRO Y TRAZABILIDAD DE LIMPIEZA
// =====================================================================
async function abrirSubventanaTrazabilidad(sesion) {
  sessionStorage.setItem("erp_vista_activa", "TRAZABILIDAD");
  document.getElementById("lblTituloCabecera").innerText =
    "CONTROL DE REGISTRO Y TRAZABILIDAD DE LIMPIEZA";

  document.getElementById("seccionHubERP").style.display = "none";
  document.getElementById("seccionControlContratos").style.display = "none";
  document.getElementById("seccionModulos").style.display = "block";

  const colRegistro = document.getElementById("colModRegistro");
  const colAuditoria = document.getElementById("colModAuditoria");
  const colLuminometria = document.getElementById("colModLuminometria");
  const colReportes = document.getElementById("colModReportes");
  const adminBox = document.getElementById("seccionAdminControl");
  const buscadorContratos = document.getElementById("txtBuscarContrato");
  const cajaBtnVolverERP = document.getElementById("cajaBtnVolverERP");

  if (sesion.rol === "CONTROL") {
    colRegistro.style.display = "block";
    colAuditoria.style.display = "block";
    colLuminometria.style.display = "block";
    colReportes.style.display = "block";
    adminBox.style.display = "block";
    buscadorContratos.style.display = "block";
    cajaBtnVolverERP.style.display = "block";
  } else {
    colRegistro.style.display = "none";
    colLuminometria.style.display = "none";
    colAuditoria.style.display = "block";
    colReportes.style.display = "block";
    adminBox.style.display = "none";
    buscadorContratos.style.display = "none";
    cajaBtnVolverERP.style.display = "none";
  }

  await recargarListaContratos(sesion);
}

async function recargarListaContratos(sesion) {
  const selContrato = document.getElementById("selContratoActivo");
  selContrato.innerHTML = '<option value="">Cargando contratos...</option>';

  try {
    if (navigator.onLine) {
      listaContratosUsuario = await obtenerContratosAutorizados(sesion.id, sesion.rol);
      guardarCacheContratos(listaContratosUsuario);
    } else {
      listaContratosUsuario = obtenerCacheContratos();
    }
    renderizarOpcionesContrato(listaContratosUsuario, sesion);
  } catch (e) {
    listaContratosUsuario = obtenerCacheContratos();
    renderizarOpcionesContrato(listaContratosUsuario, sesion);
  }
}

function renderizarOpcionesContrato(contratos, sesion) {
  const selContrato = document.getElementById("selContratoActivo");
  const badgeCant = document.getElementById("badgeCantContratos");
  selContrato.innerHTML = "";

  badgeCant.innerText = `${contratos.length} contrato(s)`;

  if (contratos.length === 0) {
    selContrato.innerHTML = '<option value="">Sin contratos asignados</option>';
    return;
  }

  contratos.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.codigo_contrato;
    opt.textContent = `${c.nombre_cliente} [${c.codigo_contrato}]`;
    opt.dataset.nombreCliente = c.nombre_cliente;
    opt.dataset.contratoId = c.id;
    selContrato.appendChild(opt);
  });

  if (parametrosQR.contrato && contratos.some(x => x.codigo_contrato === parametrosQR.contrato)) {
    selContrato.value = parametrosQR.contrato;
  } else if (sesion && sesion.qrContrato && contratos.some(x => x.codigo_contrato === sesion.qrContrato)) {
    selContrato.value = sesion.qrContrato;
  }

  if (sesion.rol !== "CONTROL") {
    selContrato.disabled = true;
    const optSel = selContrato.options[selContrato.selectedIndex];
    document.getElementById("lblSupervisorAsignado").innerText =
      `🔒 Contrato bloqueado por rol: ${optSel ? optSel.dataset.nombreCliente : ""}`;
  } else {
    selContrato.disabled = false;
    document.getElementById("lblSupervisorAsignado").innerText =
      "🔓 Control Total ERP: Seleccione cualquiera de los contratos activos";
  }

  alCambiarContratoActivo();
}

function filtrarComboContratos(e) {
  const texto = (e.target.value || "").toUpperCase().trim();
  const sesion = obtenerSesionActiva();
  const filtrados = listaContratosUsuario.filter(c =>
    c.nombre_cliente.toUpperCase().includes(texto) ||
    c.codigo_contrato.toUpperCase().includes(texto)
  );
  renderizarOpcionesContrato(filtrados, sesion);
}

async function alCambiarContratoActivo() {
  const sel = document.getElementById("selContratoActivo");
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;

  const clienteNombre = opt.dataset.nombreCliente || opt.value;
  document.getElementById("lblContratoCabecera").innerText = `${clienteNombre} — CL-OP-0030`;

  const sesion = obtenerSesionActiva();
  if (sesion) {
    sesion.qrContrato = opt.value;
    sessionStorage.setItem("cleanings_trazabilidad_sesion", JSON.stringify(sesion));
  }

  if (navigator.onLine) {
    try {
      mapaCatalogoContratoActual = await obtenerMapaPisosAreasPorContrato(opt.value);
      guardarCacheCatalogoAreas(opt.value, mapaCatalogoContratoActual);
    } catch (e) {
      mapaCatalogoContratoActual = obtenerCacheCatalogoAreas(opt.value);
    }
  } else {
    mapaCatalogoContratoActual = obtenerCacheCatalogoAreas(opt.value);
  }

  const qrSelPiso = document.getElementById("qrSelPiso");
  qrSelPiso.innerHTML = '<option value="">Seleccione piso...</option>';
  Object.keys(mapaCatalogoContratoActual).forEach(piso => {
    const o = document.createElement("option");
    o.value = piso;
    o.textContent = piso;
    qrSelPiso.appendChild(o);
  });
  poblarAreasModalQR();
}

function poblarAreasModalQR() {
  const piso = document.getElementById("qrSelPiso").value;
  const qrSelArea = document.getElementById("qrSelArea");
  qrSelArea.innerHTML = '<option value="">Seleccione área...</option>';

  if (!piso || !mapaCatalogoContratoActual[piso]) return;

  mapaCatalogoContratoActual[piso].forEach(item => {
    const o = document.createElement("option");
    o.value = item.area;
    o.textContent = `${item.area} (${item.tipo})`;
    qrSelArea.appendChild(o);
  });
}

function obtenerUrlRaizERP() {
  return window.location.origin + window.location.pathname.replace(/\/index\.html$/i, "").replace(/\/$/, "");
}

function mostrarQRGenerado() {
  const contrato = document.getElementById("selContratoActivo").value;
  const piso = document.getElementById("qrSelPiso").value;
  const area = document.getElementById("qrSelArea").value;

  if (!contrato || !piso || !area) {
    alert("Seleccione Contrato, Piso y Área para visualizar el código QR.");
    return;
  }

  const urlBaseRaiz = obtenerUrlRaizERP();
  const datosQR = generarDatosQRPuerta(urlBaseRaiz, contrato, piso, area);

  document.getElementById("qrTituloCliente").innerText = contrato;
  document.getElementById("qrSubtituloArea").innerText = `${piso} — ${area}`;
  document.getElementById("imgCodigoQR").src = datosQR.qrImgUrl;
  document.getElementById("txtUrlQR").value = datosQR.urlDestino;
  document.getElementById("cajaResultadoQR").style.display = "block";
}

function exportarTodosLosQRsAExcel() {
  const sel = document.getElementById("selContratoActivo");
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) {
    alert("Seleccione primero un contrato activo.");
    return;
  }

  const codContrato = opt.value;
  const nombreCliente = opt.dataset.nombreCliente || codContrato;
  const pisos = Object.keys(mapaCatalogoContratoActual);

  if (pisos.length === 0) {
    alert("Este contrato aún no tiene áreas cargadas en la base de datos.");
    return;
  }

  const urlBaseRaiz = obtenerUrlRaizERP();
  const filasExcel = [];
  let contador = 1;

  pisos.forEach(piso => {
    (mapaCatalogoContratoActual[piso] || []).forEach(item => {
      const datosQR = generarDatosQRPuerta(urlBaseRaiz, codContrato, piso, item.area);
      filasExcel.push({
        "N°": contador++,
        "CÓDIGO CONTRATO": codContrato,
        "CLIENTE / SEDE": nombreCliente,
        "PISO / SECTOR": piso,
        "ÁREA FÍSICA": item.area,
        "MODELO CHECKLIST": item.tipo,
        "UMBRAL ATP (RLU)": item.umbral,
        "LINK DIRECTO DEL QR (INMUTABLE)": datosQR.urlDestino,
        "URL IMAGEN QR (350x350)": datosQR.qrImgUrl,
        "FÓRMULA EXCEL / SHEETS PARA VER QR": `=IMAGE("${datosQR.qrImgUrl}")`
      });
    });
  });

  const ws = window.XLSX.utils.json_to_sheet(filasExcel);
  ws["!cols"] = [
    { wch: 5 },
    { wch: 16 },
    { wch: 28 },
    { wch: 16 },
    { wch: 26 },
    { wch: 18 },
    { wch: 16 },
    { wch: 65 },
    { wch: 55 },
    { wch: 45 }
  ];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Catalogo_QRs_" + codContrato.slice(0, 12));

  const fechaHoy = new Date().toISOString().split("T")[0];
  window.XLSX.writeFile(wb, `QRs_${codContrato}_${fechaHoy}.xlsx`);
}

function imprimirPlanchaEtiquetasQR() {
  const sel = document.getElementById("selContratoActivo");
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;

  const codContrato = opt.value;
  const nombreCliente = opt.dataset.nombreCliente || codContrato;
  const pisos = Object.keys(mapaCatalogoContratoActual);

  if (pisos.length === 0) {
    alert("Este contrato aún no tiene áreas registradas.");
    return;
  }

  const urlBaseRaiz = obtenerUrlRaizERP();
  let tarjetasHTML = "";

  pisos.forEach(piso => {
    (mapaCatalogoContratoActual[piso] || []).forEach(item => {
      const datosQR = generarDatosQRPuerta(urlBaseRaiz, codContrato, piso, item.area);
      tarjetasHTML += `
        <div class="card-qr">
          <div class="cliente">${nombreCliente}</div>
          <div class="piso">${piso}</div>
          <div class="area">${item.area}</div>
          <img src="${datosQR.qrImgUrl}" alt="QR">
          <div class="pie">CONTROL DE LIMPIEZA Y BIOSEGURIDAD — CLEANINGS ECUADOR</div>
        </div>
      `;
    });
  });

  const ventana = window.open("", "_blank");
  ventana.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Etiquetas QR - ${nombreCliente}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 15px; background: #fff; }
        .no-print { margin-bottom: 15px; text-align: right; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .card-qr { border: 2px solid #0f172a; border-radius: 10px; padding: 12px; text-align: center; page-break-inside: avoid; }
        .cliente { font-size: 11px; font-weight: bold; color: #0284c7; text-transform: uppercase; }
        .piso { font-size: 12px; font-weight: bold; color: #475569; margin-top: 2px; }
        .area { font-size: 14px; font-weight: 900; color: #0f172a; margin: 4px 0 8px 0; }
        .card-qr img { width: 165px; height: 165px; object-fit: contain; }
        .pie { font-size: 8.5px; font-weight: bold; color: #64748b; margin-top: 6px; letter-spacing: 0.4px; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="no-print">
        <button onclick="window.print()" style="padding:8px 16px; font-weight:bold; cursor:pointer;">🖨️ Imprimir / Guardar PDF de Etiquetas</button>
      </div>
      <div class="grid">${tarjetasHTML}</div>
    </body>
    </html>
  `);
  ventana.document.close();
}

// =====================================================================
// HERRAMIENTA ROOT: LIMPIEZA MAESTRA DE BASES DE DATOS
// =====================================================================
document.querySelectorAll(".btnLimpiarBD").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    const target = e.target.getAttribute("data-target");

    const confirmacion = prompt(`⚠️ ESTÁ A PUNTO DE BORRAR DATOS EN PRODUCCIÓN.\nEscriba la palabra "CONFIRMAR" en mayúsculas para proceder con la limpieza del módulo: ${target.toUpperCase()}`);
    if (confirmacion !== "CONFIRMAR") {
      alert("Operación cancelada de forma segura.");
      return;
    }

    const dummyUUID = "00000000-0000-0000-0000-000000000000";
    e.target.disabled = true;
    e.target.innerText = "Borrando BD...";

    try {
      if (target === "asistencia" || target === "todo") {
        await supabase.from("asistencia_marcaciones").delete().neq("id", dummyUUID);
      }
      if (target === "nomina" || target === "todo") {
        await supabase.from("asistencia_horas_adicionales").delete().neq("id", dummyUUID);
        await supabase.from("asistencia_novedades").delete().neq("id", dummyUUID);
        await supabase.from("asistencia_servicios").delete().neq("id", dummyUUID);
      }
      if (target === "calendario" || target === "todo") {
        await supabase.from("asistencia_turnos").delete().neq("id", dummyUUID);
      }
      if (target === "trazabilidad" || target === "todo") {
        await supabase.from("trazabilidad_registros_limpieza").delete().neq("id", dummyUUID);
        await supabase.from("trazabilidad_registros_atp").delete().neq("id", dummyUUID);
      }
      if (target === "usuarios" || target === "todo") {
        await supabase.from("trazabilidad_contrato_supervisores").delete().neq("contrato_id", dummyUUID);
        const sesion = obtenerSesionActiva();
        await supabase.from("trazabilidad_usuarios").delete().neq("id", sesion.id);
      }
      if (target === "todo") {
        await supabase.from("trazabilidad_areas").delete().neq("id", dummyUUID);
        await supabase.from("trazabilidad_contratos").delete().neq("id", dummyUUID);
      }

      alert("✅ Limpieza de Base de Datos ejecutada con éxito.");
      window.location.reload();

    } catch (err) {
      alert("Error al borrar datos: " + err.message);
      e.target.disabled = false;
      e.target.innerText = "Reintentar";
    }
  });
});