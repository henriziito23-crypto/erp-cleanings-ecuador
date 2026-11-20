// =====================================================================
// ARCHIVO: modulo-asistencia/js/asistencia.ctrl.js
// Controlador de Nómina y Asistencia (6 Pestañas Conectadas con QR y Supervisión)
// =====================================================================
import { supabase } from "../../core/supabaseClient.js";
import { obtenerSesionActiva, homologarRol } from "../../core/router.js";

const TARIFA_HORA_ADICIONAL_PUNTO = 2.01;
const TARIFA_HORA_FIN_DE_OBRA = 2.34;

let sesionActual = null;
let rolActual = "CONTROL";
let listaContratos = [];
let mapaContratosPorId = {};
let listaUsuarios = [];
let listaServicios = [];
let modalCeldaBootstrap = null;

document.addEventListener("DOMContentLoaded", async () => {
  sesionActual = obtenerSesionActiva();
  if (sesionActual) {
    rolActual = homologarRol(sesionActual.rol);
    const lblUsu = document.getElementById("lblUsuarioActivoAsistencia");
    if (lblUsu) lblUsu.innerText = `${sesionActual.nombre} (${sesionActual.cargoEtiqueta || rolActual})`;
  }

 const ahora = new Date();
  const hoyISO = ahora.getFullYear() + "-" + String(ahora.getMonth() + 1).padStart(2, '0') + "-" + String(ahora.getDate()).padStart(2, '0');
  const elMes = document.getElementById("selMesGlobal");
  if (elMes) elMes.value = hoyISO.slice(0, 7);

  const modalEl = document.getElementById("modalCeldaCalendario");
  if (modalEl && window.bootstrap) modalCeldaBootstrap = new bootstrap.Modal(modalEl);

  // Botón Volver al Menú Principal
  document.getElementById("btnVolverHubERP")?.addEventListener("click", () => {
    sessionStorage.setItem("erp_vista_activa", "HUB_PRINCIPAL");
    window.location.href = "../../index.html";
  });

  // Filtros Globales: Contrato, Mes y Auxiliar
  document.getElementById("selContratoGlobal")?.addEventListener("change", () => {
    const cId = document.getElementById("selContratoGlobal").value;
    const selUsu = document.getElementById("usuContratoAsignado");
    if (cId !== "TODOS" && selUsu) {
      selUsu.value = cId;
    }
    recargarTodoElModulo();
  });
  document.getElementById("selMesGlobal")?.addEventListener("change", recargarTodoElModulo);
  document.getElementById("selPersonaGlobal")?.addEventListener("change", recargarVistasFiltradasPorPersona);

  // Pestaña 1: Creación y Edición de Usuarios
  document.getElementById("formCrearUsuario")?.addEventListener("submit", guardarUsuarioERP);
  document.getElementById("btnCancelarEdicionUsuario")?.addEventListener("click", limpiarFormularioUsuario);

  // Pestaña 2: Calendario Interactivo (Clic en celda + Precarga mes anterior)
  document.getElementById("formModalCeldaTurno")?.addEventListener("submit", guardarTurnoDesdeModalCelda);
  document.getElementById("btnBorrarTurnoDia")?.addEventListener("click", borrarTurnoDelDiaModal);
  document.getElementById("btnPrecargarMesAnterior")?.addEventListener("click", precargarTurnosDelMesAnterior);

  // Pestaña 4: Bonos Mensuales / Ajustes y Aprobación del Día 19
  document.getElementById("hadTipo")?.addEventListener("change", e => {
    const esBono = e.target.value === "BONO_MENSUAL";
    document.getElementById("lblCantHorasOBono").innerText = esBono ? "Monto Bono ($)" : "Cant. Horas";
    document.getElementById("hadCantidad").value = esBono ? "20.00" : "2.00";
  });
  document.getElementById("formHoraAdicionalManual")?.addEventListener("submit", guardarBonoOAjusteMensual);
  document.getElementById("btnAprobarTodoControl")?.addEventListener("click", aprobarTodasLasHorasControl19);

  // Pestaña 5: Filtro por Servicio Eventual
  document.getElementById("srvFiltroServicio")?.addEventListener("change", cargarMarcacionesDeServicios);

  await inicializarDatosBase();
  // Encender radar en tiempo real
  iniciarSuscripcionEnVivo();
});

function mostrarMensaje(texto) {
  const box = document.getElementById("msgFeedbackAsistencia");
  box.innerText = texto;
  box.style.display = "block";
  setTimeout(() => (box.style.display = "none"), 4500);
}

function calcularHorasEntre(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return 0;
  const [h1, m1] = horaInicio.slice(0, 5).split(":").map(Number);
  const [h2, m2] = horaFin.slice(0, 5).split(":").map(Number);
  let diff = (h2 + m2 / 60) - (h1 + m1 / 60);
  if (diff < 0) diff += 24;
  return Number(diff.toFixed(2));
}

function extraerRangoHorarioTexto(rangoStr) {
  const partes = (rangoStr || "07:00 - 15:30").split("-");
  const entrada = (partes[0] || "07:00").trim().slice(0, 5);
  const salida = (partes[1] || "15:30").trim().slice(0, 5);
  let horas = calcularHorasEntre(entrada, salida);
  if (horas > 8 && horas <= 9) horas = 8;
  return { entrada, salida, horas };
}

async function inicializarDatosBase() {
  const { data: contratos, error } = await supabase
    .from("trazabilidad_contratos")
    .select("*")
    .eq("activo", true)
    .order("nombre_cliente", { ascending: true });

  if (error) {
    alert("Error al cargar contratos: " + error.message);
    return;
  }

  listaContratos = contratos || [];
  mapaContratosPorId = {};

  const selGlobal = document.getElementById("selContratoGlobal");
  const selUsuContrato = document.getElementById("usuContratoAsignado");
  const selUsuSecundario = document.getElementById("usuContratoSecundario"); // 🔴 NUEVO

  selGlobal.innerHTML = "";
  selUsuContrato.innerHTML = "";
  if (selUsuSecundario) selUsuSecundario.innerHTML = '<option value="">-- Ninguno --</option>'; // 🔴 NUEVO

  listaContratos.forEach(c => {
    mapaContratosPorId[c.id] = c;
    const texto = `${c.nombre_cliente} [${c.codigo_contrato}]`;
    selGlobal.appendChild(new Option(texto, c.id));
    selUsuContrato.appendChild(new Option(texto, c.id));
    if (selUsuSecundario) selUsuSecundario.appendChild(new Option(texto, c.id)); // 🔴 NUEVO
  });
  selGlobal.appendChild(new Option("TODOS LOS CONTRATOS (CONSOLIDADO)", "TODOS"));

  if (listaContratos.length > 0) {
    selGlobal.value = listaContratos[0].id;
    selUsuContrato.value = listaContratos[0].id;
  }

  await recargarTodoElModulo();
}

async function recargarTodoElModulo() {
  actualizarTurnosDelContratoActivo();
  await cargarUsuariosDelFiltro();
  await cargarCatalogoServiciosDelMes();
  await recargarVistasFiltradasPorPersona();
}

async function recargarVistasFiltradasPorPersona() {
  await renderizarCalendarioMensual();
  await cargarAsistenciaDePuntos();
  await cargarHorasAdicionalesYBonos();
  await cargarMarcacionesDeServicios();
  await cargarHistorialNovedades();
}

function obtenerOpcionesTurnosContrato(contratoId) {
  const c = mapaContratosPorId[contratoId] || listaContratos[0];
  if (!c) return [];

  const opciones = [];
  if (c.turno_1_horario) opciones.push({ codigo: "T1", rango: c.turno_1_horario, label: `T1 (${c.turno_1_horario})` });
  if (c.turno_2_horario) opciones.push({ codigo: "T2", rango: c.turno_2_horario, label: `T2 (${c.turno_2_horario})` });
  if (c.turno_3_horario) opciones.push({ codigo: "T3", rango: c.turno_3_horario, label: `T3 (${c.turno_3_horario})` });
  if (c.turno_4_horario) opciones.push({ codigo: "T4", rango: c.turno_4_horario, label: `T4 (${c.turno_4_horario})` });
  if (c.tiene_turno_especial) {
    opciones.push({ codigo: "BH", rango: "00:00 - 00:00", label: `TURNO ESPECIAL (Banco de Horas 160h)` });
  }
  // 🔴 NUEVO: Opción de Feriado (Base 8h = $22.00 máx)
  const horarioBaseFeriado = c.turno_1_horario || "07:00 - 15:30";
  opciones.push({ codigo: "FERIADO", rango: horarioBaseFeriado, label: `🎉 FERIADO (${horarioBaseFeriado} — Máx $22 / 8h)` });
  opciones.push({ codigo: "LIBRE", rango: "00:00 - 00:00", label: `LIBRE / DESCANSO` });
  return opciones;
}

function actualizarTurnosDelContratoActivo() {
  const cId = document.getElementById("selContratoGlobal").value;
  const c = mapaContratosPorId[cId] || listaContratos[0];
  if (!c) return;

  const ops = obtenerOpcionesTurnosContrato(c.id);
  document.getElementById("lblSubtituloTurnosContrato").innerText =
    `Turnos configurados en ${c.nombre_cliente}: ` + ops.map(o => o.label).join(" | ");

  // Actualizar link directo de cámara Timestamp con el contrato activo
  const linkCam = document.getElementById("linkAbrirCamaraTimestamp");
  if (linkCam) {
    linkCam.href = `./timbrado-qr.html?contrato=${encodeURIComponent(c.codigo_contrato)}`;
  }
}

// =====================================================================
// PESTAÑA 1: CREACIÓN DE USUARIOS (CONECTADO A RPC SEGURO)
// =====================================================================
async function cargarUsuariosDelFiltro() {
  const filtroContratoId = document.getElementById("selContratoGlobal").value;
  const personaPrev = document.getElementById("selPersonaGlobal").value;

  const { data, error } = await supabase.rpc("listar_usuarios_asistencia", {
    p_contrato_id: filtroContratoId === "TODOS" ? null : filtroContratoId
  });

  if (error) {
    console.error("Error listando usuarios:", error.message);
    return;
  }

  listaUsuarios = data || [];
  document.getElementById("badgeTotalUsuarios").innerText = `${listaUsuarios.length} trabajadores`;

  const selPersonaGlobal = document.getElementById("selPersonaGlobal");
  const selHadUsuario = document.getElementById("hadUsuario");
  selPersonaGlobal.innerHTML = '<option value="TODOS">TODOS LOS AUXILIARES DEL CONTRATO</option>';
  selHadUsuario.innerHTML = "";

  listaUsuarios.forEach(u => {
    selPersonaGlobal.appendChild(new Option(u.nombre_completo, u.id));
    selHadUsuario.appendChild(new Option(u.nombre_completo, u.id));
  });

  if (personaPrev && [...selPersonaGlobal.options].some(o => o.value === personaPrev)) {
    selPersonaGlobal.value = personaPrev;
  }

  const tbody = document.getElementById("tbodyUsuarios");
  tbody.innerHTML = "";

  if (listaUsuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-3">Sin trabajadores registrados en este contrato.</td></tr>';
    return;
  }

  listaUsuarios.forEach((u, idx) => {
    const cInfo = mapaContratosPorId[u.contrato_base_id];
    const nombreContrato = cInfo ? `${cInfo.nombre_cliente} (${cInfo.codigo_contrato})` : "SIN CONTRATO";
    const badgeRol = u.rol === "CONTROL" ? "bg-danger" : (u.rol === "SUPERVISOR" ? "bg-dark" : "bg-secondary");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center fw-bold text-muted">${idx + 1}</td>
      <td class="text-center">${u.cedula || "-"}</td>
      <td class="text-center fw-bold text-muted">••••</td>
      <td class="fw-bold text-dark">${u.nombre_completo}</td>
      <td class="fw-semibold text-primary">${nombreContrato}</td>
      <td>${u.cargo_etiqueta || "-"}</td>
      <td class="text-center"><span class="badge ${badgeRol}">${u.rol}</span></td>
      <td class="text-center">${u.telefono || "-"}</td>
      <td class="text-end fw-bold">$${Number(u.sueldo_base || 460).toFixed(2)}</td>
      <td class="text-center no-print">
        <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 me-1" data-edit="${u.id}">✏️</button>
        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-del="${u.id}">🗑️</button>
      </td>
    `;
    tr.querySelector(`[data-edit="${u.id}"]`).addEventListener("click", () => prepararEdicionUsuario(u));
    tr.querySelector(`[data-del="${u.id}"]`).addEventListener("click", () => desactivarUsuario(u));
    tbody.appendChild(tr);
  });
}

function prepararEdicionUsuario(u) {
  document.getElementById("editUsuarioId").value = u.id;
  document.getElementById("usuCedula").value = u.cedula || "";
  document.getElementById("usuPin").value = "";
  document.getElementById("usuPin").required = false;
  document.getElementById("usuPin").placeholder = "Dejar vacío para mantener PIN actual";
  document.getElementById("usuNombre").value = u.nombre_completo || "";
  document.getElementById("usuContratoAsignado").value = u.contrato_base_id || "";
  if (document.getElementById("usuContratoSecundario")) {
    document.getElementById("usuContratoSecundario").value = u.contrato_secundario_id || "";
  }
  document.getElementById("usuRol").value = homologarRol(u.rol);
  document.getElementById("usuEtiqueta").value = u.cargo_etiqueta || "";
  document.getElementById("usuTelefono").value = u.telefono || "";
  document.getElementById("usuSueldo").value = u.sueldo_base || 460.00;

  document.getElementById("lblTituloFormUsuario").innerText = `✏️ EDITANDO USUARIO: ${u.nombre_completo}`;
  document.getElementById("btnGuardarUsuario").innerText = "💾 Actualizar Usuario";
  document.getElementById("btnCancelarEdicionUsuario").style.display = "inline-block";
}

function limpiarFormularioUsuario() {
  const contratoActual = document.getElementById("selContratoGlobal").value;
  document.getElementById("formCrearUsuario").reset();
  document.getElementById("editUsuarioId").value = "";
  document.getElementById("usuPin").required = true;
  document.getElementById("usuPin").placeholder = "Ej: 4821";
  document.getElementById("usuSueldo").value = "460.00";
  document.getElementById("usuEtiqueta").value = "AUXILIAR DE LIMPIEZA";
  if (contratoActual && contratoActual !== "TODOS") {
    document.getElementById("usuContratoAsignado").value = contratoActual;
  }
  if (document.getElementById("usuContratoSecundario")) {
    document.getElementById("usuContratoSecundario").value = "";
  }
  document.getElementById("lblTituloFormUsuario").innerText = "➕ REGISTRAR NUEVO USUARIO Y ASIGNAR A CONTRATO";
  document.getElementById("btnGuardarUsuario").innerText = "💾 Guardar Usuario y Vincular al Contrato";
  document.getElementById("btnCancelarEdicionUsuario").style.display = "none";
}

async function guardarUsuarioERP(e) {
  e.preventDefault();
  const editId = document.getElementById("editUsuarioId").value || null;
  const contratoElegido = document.getElementById("usuContratoAsignado").value;
  const nombreCompleto = document.getElementById("usuNombre").value.trim().toUpperCase();
  const rolElegido = document.getElementById("usuRol").value;

  const { data: userId, error } = await supabase.rpc("guardar_usuario_erp", {
    p_id: editId,
    p_cedula: document.getElementById("usuCedula").value.trim(),
    p_pin: document.getElementById("usuPin").value.trim().toUpperCase(),
    p_nombre: nombreCompleto,
    p_contrato_base_id: contratoElegido,
    p_contrato_secundario_id: document.getElementById("usuContratoSecundario")?.value || null,
    p_rol: rolElegido,
    p_cargo_etiqueta: document.getElementById("usuEtiqueta").value.trim().toUpperCase(),
    p_telefono: document.getElementById("usuTelefono").value.trim(),
    p_sueldo_base: parseFloat(document.getElementById("usuSueldo").value) || 460.00
  });

  if (error) {
    alert("Error al guardar usuario: " + error.message);
    return;
  }

  if (rolElegido === "SUPERVISOR" && contratoElegido && userId) {
    await supabase
      .from("trazabilidad_contrato_supervisores")
      .upsert([{ contrato_id: contratoElegido, supervisor_id: userId }], { onConflict: "contrato_id,supervisor_id" });
  }

  document.getElementById("selContratoGlobal").value = contratoElegido;
  limpiarFormularioUsuario();
  mostrarMensaje(`✓ Usuario ${nombreCompleto} guardado con PIN cifrado y visible en la tabla.`);
  await recargarTodoElModulo();
}

async function desactivarUsuario(u) {
  if (!confirm(`¿Dar de baja a ${u.nombre_completo}?`)) return;
  const { error } = await supabase.rpc("desactivar_usuario_erp", { p_id: u.id });
  if (error) {
    alert("Error al dar de baja: " + error.message);
    return;
  }
  await recargarTodoElModulo();
}
// =====================================================================
// PESTAÑA 2: CALENDARIO MENSUAL INTERACTIVO (CLIC EN CELDA -> DÍA O SEMANA)
// =====================================================================
async function renderizarCalendarioMensual() {
  const mesGlobal = document.getElementById("selMesGlobal").value;
  const filtroContratoId = document.getElementById("selContratoGlobal").value;
  const filtroPersonaId = document.getElementById("selPersonaGlobal").value;

  if (!mesGlobal) return;
  const [anio, mes] = mesGlobal.split("-").map(Number);
  const diasMes = new Date(anio, mes, 0).getDate();

  document.getElementById("badgeMesCalendario").innerText = `MES: ${mesGlobal}`;
  const cInfo = mapaContratosPorId[filtroContratoId];
  document.getElementById("lblTituloCalendarioPDF").innerText =
    `CRONOGRAMA MENSUAL DE TURNOS — ${cInfo ? cInfo.nombre_cliente : "CONSOLIDADO"} (${mesGlobal})`;

  let query = supabase
    .from("asistencia_turnos")
    .select("*")
    .gte("fecha", `${mesGlobal}-01`)
    .lte("fecha", `${mesGlobal}-${String(diasMes).padStart(2, "0")}`);

  if (filtroContratoId !== "TODOS") query = query.eq("contrato_id", filtroContratoId);
  if (filtroPersonaId !== "TODOS") query = query.eq("usuario_id", filtroPersonaId);

  const { data: turnosMes } = await query;
  const mapaTurnos = {};
  (turnosMes || []).forEach(t => {
    mapaTurnos[`${t.usuario_id}_${t.fecha}`] = t;
  });

  const letrasDia = ["D", "L", "M", "X", "J", "V", "S"];
  const thead = document.getElementById("theadCalendario");
  let htmlHead = `<tr><th style="min-width:175px; text-align:left;">AUXILIAR (CLIC EN DÍA)</th>`;
  for (let d = 1; d <= diasMes; d++) {
    const fObj = new Date(anio, mes - 1, d);
    const letra = letrasDia[fObj.getDay()];
    htmlHead += `<th>${letra}<br>${d}</th>`;
  }
  htmlHead += `</tr>`;
  thead.innerHTML = htmlHead;

  const tbody = document.getElementById("tbodyCalendario");
  tbody.innerHTML = "";

  const usuariosMostrar = filtroPersonaId === "TODOS"
    ? listaUsuarios
    : listaUsuarios.filter(u => u.id === filtroPersonaId);

  if (usuariosMostrar.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${diasMes + 1}" class="text-center text-muted py-3">No hay trabajadores registrados para este filtro.</td></tr>`;
    return;
  }

  usuariosMostrar.forEach(u => {
    const tr = document.createElement("tr");
    const tdNombre = document.createElement("td");
    tdNombre.className = "fw-bold text-dark text-start";
    tdNombre.textContent = u.nombre_completo;
    tr.appendChild(tdNombre);

    for (let d = 1; d <= diasMes; d++) {
      const fISO = `${mesGlobal}-${String(d).padStart(2, "0")}`;
      const t = mapaTurnos[`${u.id}_${fISO}`];
      const td = document.createElement("td");
      td.style.cursor = "pointer";

      if (!t) {
        td.className = "celda-cal text-muted";
        td.innerHTML = `+`;
      } else {
        let claseColor = "cal-normal";
        let etiqueta = `${t.codigo_turno}<br><small>${t.hora_entrada.slice(0, 5)}-${t.hora_salida.slice(0, 5)}</small>`;

        if (t.codigo_turno === "BH") {
          etiqueta = `B. HORAS<br><small>Meta 160h</small>`;
        } else if (t.codigo_turno === "FERIADO" || t.estado_calendario === "FERIADO") {
          claseColor = "cal-cubriendo"; // Resalta la celda en el cronograma
          etiqueta = `🎉 FERIADO<br><small>${t.hora_entrada.slice(0, 5)}-${t.hora_salida.slice(0, 5)}</small>`;
        } else if (t.estado_calendario === "EN_SERVICIO") {
          claseColor = "cal-servicio";
          etiqueta = `SERVICIO<br><small>${t.observacion || "Obra"}</small>`;
        } else if (t.estado_calendario === "CUBRIENDO_TURNO") {
          claseColor = "cal-cubriendo";
          etiqueta = `CUBRE/DOBLA<br><small>${t.hora_entrada.slice(0, 5)}-${t.hora_salida.slice(0, 5)}</small>`;
        } else if (t.estado_calendario === "PERMISO_MEDICO" || t.estado_calendario === "CALAMIDAD") {
          claseColor = "cal-permiso";
          etiqueta = `PERMISO<br><small>${t.estado_calendario.slice(0, 7)}</small>`;
        } else if (t.estado_calendario === "DESCANSO" || t.codigo_turno === "LIBRE") {
          claseColor = "cal-descanso";
          etiqueta = `LIBRE`;
        }

        td.className = `celda-cal ${claseColor}`;
        td.title = t.observacion || "Clic para cambiar turno o aplicar a la semana";
        td.innerHTML = etiqueta;
      }

      td.addEventListener("click", () => abrirModalAsignarTurnoCelda(u, fISO, t));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
}

function abrirModalAsignarTurnoCelda(usuario, fechaISO, turnoActual) {
  const contratoId = usuario.contrato_base_id || document.getElementById("selContratoGlobal").value;
  document.getElementById("modCalUsuarioId").value = usuario.id;
  document.getElementById("modCalContratoId").value = contratoId;
  document.getElementById("modCalFechaISO").value = fechaISO;
  document.getElementById("modCalNombreAuxiliar").innerText = usuario.nombre_completo;
  document.getElementById("modCalFechaTexto").innerText = fechaISO;

  const selTurno = document.getElementById("modCalSelectTurno");
  selTurno.innerHTML = "";
  const opciones = obtenerOpcionesTurnosContrato(contratoId);
  opciones.forEach(op => {
    selTurno.appendChild(new Option(op.label, `${op.codigo}|${op.rango}`));
  });

  if (turnoActual) {
    const match = [...selTurno.options].find(o => o.value.startsWith(turnoActual.codigo_turno + "|"));
    if (match) selTurno.value = match.value;
  }

  document.getElementById("radSoloDia").checked = true;
  modalCeldaBootstrap.show();
}

async function guardarTurnoDesdeModalCelda(e) {
  e.preventDefault();
  const usuarioId = document.getElementById("modCalUsuarioId").value;
  const contratoId = document.getElementById("modCalContratoId").value;
  const fechaISO = document.getElementById("modCalFechaISO").value;
  const valorTurno = document.getElementById("modCalSelectTurno").value;
  const alcance = document.querySelector("input[name='modCalAlcance']:checked").value;

  // 🔴 NUEVO: Capturamos el check de la hora de almuerzo
  const descuentaAlmuerzo = document.getElementById("chkDescuentaAlmuerzo").checked;

  const [codigoTurno, rangoTexto] = valorTurno.split("|");
  const { entrada, salida, horas } = extraerRangoHorarioTexto(rangoTexto);
  const estadoCal = codigoTurno === "LIBRE" ? "DESCANSO" : (codigoTurno === "FERIADO" ? "FERIADO" : "NORMAL");

  // 🔴 NUEVA REGLA: Si descuenta almuerzo y el turno tiene horas, restamos 1 hora
  let horasBaseRemuneradas = horas;
  if (descuentaAlmuerzo && horasBaseRemuneradas > 0 && codigoTurno !== "LIBRE" && codigoTurno !== "BH") {
    horasBaseRemuneradas = Math.max(0, horasBaseRemuneradas - 1);
  }

  const registros = [];
  const fSeleccionada = new Date(fechaISO + "T00:00:00");

  if (alcance === "UN_DIA") {
    registros.push({
      contrato_id: contratoId,
      usuario_id: usuarioId,
      fecha: fechaISO,
      codigo_turno: codigoTurno,
      hora_entrada: entrada,
      hora_salida: salida,
      horas_turno_base: codigoTurno === "LIBRE" || codigoTurno === "BH" ? 0 : horasBaseRemuneradas,
      estado_calendario: estadoCal
    });
  } else if (alcance === "SEMANA_LUN_VIE") {
    // Calcular el Lunes de esa misma semana y cargar de Lunes a Viernes (5 días)
    const diaSemana = fSeleccionada.getDay(); // 0 Dom, 1 Lun ...
    const diffLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
    const lunes = new Date(fSeleccionada);
    lunes.setDate(fSeleccionada.getDate() + diffLunes);

    for (let i = 0; i < 5; i++) {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      registros.push({
        contrato_id: contratoId,
        usuario_id: usuarioId,
        fecha: d.toISOString().split("T")[0],
        codigo_turno: codigoTurno,
        hora_entrada: entrada,
        hora_salida: salida,
        horas_turno_base: codigoTurno === "LIBRE" || codigoTurno === "BH" ? 0 : horasBaseRemuneradas,
        estado_calendario: estadoCal
      });
    }
  } else if (alcance === "QUINCENA") {
    for (let i = 0; i < 15; i++) {
      const d = new Date(fSeleccionada);
      d.setDate(fSeleccionada.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      registros.push({
        contrato_id: contratoId,
        usuario_id: usuarioId,
        fecha: d.toISOString().split("T")[0],
        codigo_turno: codigoTurno,
        hora_entrada: entrada,
        hora_salida: salida,
        horas_turno_base: codigoTurno === "LIBRE" || codigoTurno === "BH" ? 0 : horasBaseRemuneradas,
        estado_calendario: estadoCal
      });
    }
  }

  const { error } = await supabase
    .from("asistencia_turnos")
    .upsert(registros, { onConflict: "usuario_id,fecha" });

  if (error) {
    alert("Error al guardar turno: " + error.message);
    return;
  }

  modalCeldaBootstrap.hide();
  mostrarMensaje(`📅 Se actualizó el turno (${codigoTurno}) en ${registros.length} día(s) del calendario.`);
  await renderizarCalendarioMensual();
  await cargarAsistenciaDePuntos();
}

async function borrarTurnoDelDiaModal() {
  const usuarioId = document.getElementById("modCalUsuarioId").value;
  const fechaISO = document.getElementById("modCalFechaISO").value;
  await supabase.from("asistencia_turnos").delete().eq("usuario_id", usuarioId).eq("fecha", fechaISO);
  modalCeldaBootstrap.hide();
  await renderizarCalendarioMensual();
}

async function precargarTurnosDelMesAnterior() {
  const mesSeleccionado = document.getElementById("selMesGlobal").value;
  if (!mesSeleccionado) return;

  const [anio, mes] = mesSeleccionado.split("-").map(Number);
  const fechaMesAnt = new Date(anio, mes - 2, 1);
  const anioAnt = fechaMesAnt.getFullYear();
  const mesAnt = String(fechaMesAnt.getMonth() + 1).padStart(2, "0");

  const { data: turnosAnt } = await supabase
    .from("asistencia_turnos")
    .select("*")
    .gte("fecha", `${anioAnt}-${mesAnt}-01`)
    .lte("fecha", `${anioAnt}-${mesAnt}-31`);

  if (!turnosAnt || turnosAnt.length === 0) {
    alert(`No hay turnos en el mes anterior (${anioAnt}-${mesAnt}) para copiar.`);
    return;
  }

  const diasEnMesActual = new Date(anio, mes, 0).getDate();
  const nuevos = [];
  turnosAnt.forEach(t => {
    const dNum = parseInt(t.fecha.split("-")[2], 10);
    if (dNum <= diasEnMesActual) {
      nuevos.push({
        contrato_id: t.contrato_id,
        usuario_id: t.usuario_id,
        fecha: `${mesSeleccionado}-${String(dNum).padStart(2, "0")}`,
        codigo_turno: t.codigo_turno,
        hora_entrada: t.hora_entrada,
        hora_salida: t.hora_salida,
        horas_turno_base: t.horas_turno_base,
        estado_calendario: "NORMAL"
      });
    }
  });

  await supabase.from("asistencia_turnos").upsert(nuevos, { onConflict: "usuario_id,fecha" });
  mostrarMensaje(`🔄 Se copiaron ${nuevos.length} turnos del mes anterior.`);
  await renderizarCalendarioMensual();
}

// =====================================================================
// PESTAÑA 3: RECEPCIÓN DE ASISTENCIA POR QR CON CÁMARA TIMESTAMP
// =====================================================================
function mostrarQRAsistenciaContrato() {
  const cId = document.getElementById("selContratoGlobal").value;
  const c = mapaContratosPorId[cId] || listaContratos[0];
  if (!c) return;

  const box = document.getElementById("cajaQRAsistenciaContrato");
  if (box.style.display === "block") {
    box.style.display = "none";
    return;
  }

  const urlTimbrado = window.location.origin + window.location.pathname.replace("asistencia.html", "timbrado-qr.html") + `?contrato=${encodeURIComponent(c.codigo_contrato)}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(urlTimbrado)}`;

  document.getElementById("lblTituloQRContratoAsistencia").innerText = `QR DE ASISTENCIA CÁMARA TIMESTAMP — ${c.nombre_cliente} [${c.codigo_contrato}]`;
  document.getElementById("imgQRContratoAsistencia").src = qrImg;
  document.getElementById("lblUrlQRContratoAsistencia").innerText = urlTimbrado;
  box.style.display = "block";
}

async function cargarAsistenciaDePuntos() {
  const mesGlobal = document.getElementById("selMesGlobal").value;
  const filtroContratoId = document.getElementById("selContratoGlobal").value;
  const filtroPersonaId = document.getElementById("selPersonaGlobal").value;

  if (!mesGlobal) return;
  const [anio, mes] = mesGlobal.split("-").map(Number);
  const diasMes = new Date(anio, mes, 0).getDate();
  const fechaInicioMes = `${mesGlobal}-01`;
  const fechaFinMes = `${mesGlobal}-${String(diasMes).padStart(2, "0")}`;

  // 1. Traemos todos los turnos y marcaciones del mes SIN filtrar aún por contrato en Supabase
  // Esto permite que un turno en ESPECIALES001 vea las marcaciones hechas en CASA HENRY o cualquier sede
  let qTurnos = supabase
    .from("asistencia_turnos")
    .select("*")
    .gte("fecha", fechaInicioMes)
    .lte("fecha", fechaFinMes)
    .order("fecha", { ascending: false });

  let qMarc = supabase
    .from("asistencia_marcaciones")
    .select("*")
    .eq("tipo_ubicacion", "PUNTO_FIJO")
    .gte("fecha", fechaInicioMes)
    .lte("fecha", fechaFinMes)
    .order("fecha", { ascending: false });

  if (filtroPersonaId !== "TODOS") {
    qTurnos = qTurnos.eq("usuario_id", filtroPersonaId);
    qMarc = qMarc.eq("usuario_id", filtroPersonaId);
  }

  try {
    const [{ data: todosTurnos, error: errT }, { data: todasMarcaciones, error: errM }] = await Promise.all([qTurnos, qMarc]);
    if (errT) throw errT;
    if (errM) throw errM;

    // Lista de IDs de los trabajadores que pertenecen al contrato seleccionado arriba (ej. los de ESPECIALES001)
    const idsUsuariosDelContrato = new Set(listaUsuarios.map(u => u.id));

    // Mapa global de turnos por Usuario y Fecha (para encontrar el turno BH de Darío sin importar en qué sede esté)
    const mapaTurnosGlobal = {};
    (todosTurnos || []).forEach(t => {
      mapaTurnosGlobal[`${t.usuario_id}_${t.fecha}`] = t;
    });

    // Filtramos las marcaciones que deben verse en esta pantalla:
    // Se ven si timbraron en esta sede O si el trabajador pertenece a este contrato (ej. cuando filtras por ESPECIALES001)
    const marcacionesFiltradas = (todasMarcaciones || []).filter(m => {
      if (filtroContratoId === "TODOS") return true;
      return m.contrato_id === filtroContratoId || idsUsuariosDelContrato.has(m.usuario_id);
    });

    // Filtramos los turnos que pertenecen a este contrato
    const turnosFiltrados = (todosTurnos || []).filter(t => {
      if (filtroContratoId === "TODOS") return true;
      return t.contrato_id === filtroContratoId || idsUsuariosDelContrato.has(t.usuario_id);
    });

    const filasTabla = [];
    const turnosQueYaTimbraron = new Set();

    // 1) Por cada marcación real, creamos su fila y la vinculamos con su turno (así sea de otro contrato)
    marcacionesFiltradas.forEach(m => {
      const claveUF = `${m.usuario_id}_${m.fecha}`;
      const turnoDelDia = mapaTurnosGlobal[claveUF] || null;
      if (turnoDelDia) {
        turnosQueYaTimbraron.add(claveUF);
      }
      filasTabla.push({ t: turnoDelDia, m: m });
    });

    // 2) Solo agregamos como "PENDIENTE INGRESO" los turnos que NO tuvieron ningún timbrado en ninguna sede ese día
    turnosFiltrados.forEach(t => {
      const claveUF = `${t.usuario_id}_${t.fecha}`;
      // También verificamos si timbró en cualquier otra sede del holding ese día
      const timbroEnOtraSede = (todasMarcaciones || []).some(m => m.usuario_id === t.usuario_id && m.fecha === t.fecha);
      if (!turnosQueYaTimbraron.has(claveUF) && !timbroEnOtraSede) {
        filasTabla.push({ t: t, m: null });
      }
    });

    const tbody = document.getElementById("tbodyAsistenciaPuntos");
    tbody.innerHTML = "";

    if (filasTabla.length === 0) {
      tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-3">Sin turnos programados ni marcaciones para el Contrato, Mes y Auxiliar seleccionados.</td></tr>';
      return;
    }

    // Ordenar por fecha descendente y por hora de entrada más reciente
    filasTabla.sort((a, b) => {
      const fechaA = a.m ? a.m.fecha : a.t.fecha;
      const fechaB = b.m ? b.m.fecha : b.t.fecha;
      if (fechaA !== fechaB) return fechaB.localeCompare(fechaA);
      const horaA = a.m ? (a.m.hora_real_entrada || a.m.hora_entrada || "") : "";
      const horaB = b.m ? (b.m.hora_real_entrada || b.m.hora_entrada || "") : "";
      return horaB.localeCompare(horaA);
    });

    filasTabla.forEach(({ t, m }) => {
      const fechaFila = m ? m.fecha : t.fecha;
      const contratoIdFila = m ? m.contrato_id : t.contrato_id;
      const cInfo = mapaContratosPorId[contratoIdFila];

      const uObj = listaUsuarios.find(u => u.id === (m ? m.usuario_id : t.usuario_id));
      const nombreAux = m ? m.usuario_nombre : (uObj ? uObj.nombre_completo : "-");

      const estadoCronograma = t ? t.estado_calendario : "SIN TURNO PREVIO";

      let hProgEnt = "07:00";
      let hProgSal = "15:30";
      let horarioStr = "Sin Turno (QR Directo)";

      if (t) {
        if (t.codigo_turno === "BH") {
          horarioStr = "BANCO DE HORAS";
        } else {
          hProgEnt = (t.hora_entrada || "07:00").slice(0, 5);
          hProgSal = (t.hora_salida || "15:30").slice(0, 5);
          horarioStr = `${hProgEnt} a ${hProgSal} (${t.horas_turno_base || 8}h)`;
        }
      } else if (m && m.hora_prog_entrada) {
        hProgEnt = m.hora_prog_entrada.slice(0, 5);
        hProgSal = (m.hora_prog_salida || "15:30").slice(0, 5);
        horarioStr = `${hProgEnt} a ${hProgSal}`;
      }

      const entradaReal = m ? (m.hora_real_entrada || m.hora_entrada || "-") : "-";
      const salidaReal = m ? (m.hora_real_salida || m.hora_salida || "-") : "-";
      const toleranciaMin = cInfo && cInfo.tolerancia_minutos ? Number(cInfo.tolerancia_minutos) : 10;

      let badgeIngreso = '<span class="semaforo-badge semaforo-rojo">🔴 PENDIENTE INGRESO</span>';

      if (t && t.estado_calendario === "EN_SERVICIO") {
        badgeIngreso = '<span class="semaforo-badge bg-info text-dark border-info">🚀 EN SERVICIO</span>';
      } else if (t && (t.estado_calendario === "PERMISO_MEDICO" || t.estado_calendario === "CALAMIDAD" || t.estado_calendario === "DESCANSO")) {
        badgeIngreso = `<span class="semaforo-badge bg-secondary text-white border-secondary">${t.estado_calendario.replace("_", " ")}</span>`;
      } else if (entradaReal !== "-") {
        if ((t && t.codigo_turno === "BH") || !t) {
          badgeIngreso = '<span class="semaforo-badge semaforo-verde">🟢 INGRESO QR (BH)</span>';
        } else {
          const [pHe, pMe] = hProgEnt.split(":").map(Number);
          const [rHe, rMe] = entradaReal.slice(0, 5).split(":").map(Number);
          if ((rHe * 60 + rMe) <= (pHe * 60 + pMe + toleranciaMin)) {
            badgeIngreso = '<span class="semaforo-badge semaforo-verde">🟢 INGRESO A TIEMPO</span>';
          } else {
            badgeIngreso = '<span class="semaforo-badge semaforo-naranja">🟠 INGRESO ATRASADO</span>';
          }
        }
      }

      let badgeSalida = '<span class="semaforo-badge semaforo-rojo">🔴 PENDIENTE SALIDA</span>';

      if (entradaReal === "-" && badgeIngreso.includes("PENDIENTE INGRESO")) {
        badgeSalida = '<span class="text-muted small fw-bold">- ESPERANDO -</span>';
      } else if (t && (t.estado_calendario === "EN_SERVICIO" || t.estado_calendario === "PERMISO_MEDICO" || t.estado_calendario === "CALAMIDAD" || t.estado_calendario === "DESCANSO")) {
        badgeSalida = `<span class="badge bg-secondary">N/A</span>`;
      } else if (salidaReal !== "-") {
        if ((t && t.codigo_turno === "BH") || !t) {
          badgeSalida = '<span class="semaforo-badge semaforo-verde">🟢 SALIDA QR (BH)</span>';
        } else {
          const [pHs, pMs] = hProgSal.split(":").map(Number);
          const [rHs, rMs] = salidaReal.slice(0, 5).split(":").map(Number);
          if ((rHs * 60 + rMs) < (pHs * 60 + pMs)) {
            badgeSalida = '<span class="semaforo-badge semaforo-amarillo">🟡 SALIÓ ANTES</span>';
          } else {
            badgeSalida = '<span class="semaforo-badge semaforo-verde">🟢 SALIÓ A TIEMPO</span>';
          }
        }
      }

      const urlFotoEntrada = m ? (m.foto_timestamp_url || m.foto_entrada_url || "") : "";
      const urlFotoSalida = m ? (m.foto_salida_url || "") : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center fw-bold">${fechaFila}</td>
        <td class="text-center fw-semibold text-primary">${cInfo ? cInfo.codigo_contrato : "-"}</td>
        <td class="fw-bold text-dark">${nombreAux}</td>
        <td class="text-center"><span class="badge bg-dark">${estadoCronograma}</span></td>
        <td class="text-center fw-bold">${horarioStr}</td>
        <td class="text-center">${badgeIngreso}</td>
        <td class="text-center">${badgeSalida}</td>
        <td class="text-center fw-bold text-success">${entradaReal !== "-" ? entradaReal.slice(0, 5) : "-"}</td>
        <td class="text-center fw-bold text-danger">${salidaReal !== "-" ? salidaReal.slice(0, 5) : "-"}</td>
        <td class="text-center fw-bold">${m ? Number(m.horas_trabajadas_reales || 0).toFixed(2) + " h" : "0.00 h"}</td>
        <td class="text-center">
          ${urlFotoEntrada ? `<a href="${urlFotoEntrada}" target="_blank" class="btn btn-sm btn-outline-success py-0 px-2 fw-bold">📷 IN</a>` : "-"}
        </td>
        <td class="text-center">
          ${urlFotoSalida ? `<a href="${urlFotoSalida}" target="_blank" class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold">📷 OUT</a>` : "-"}
        </td>
        <td>${m ? (m.observaciones || "Registrado por QR") : (t ? (t.observacion || "-") : "-")}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error al cargar la tabla de asistencia:", err);
    alert("Ocurrió un error al cruzar los turnos con la asistencia: " + err.message);
  }
}
// =====================================================================
// PESTAÑA 4: HORAS ADICIONALES ($2.01 / $2.34) Y BONOS POR MES/CONTRATO/AUXILIAR
// =====================================================================
async function guardarBonoOAjusteMensual(e) {
  e.preventDefault();
  const usuarioId = document.getElementById("hadUsuario").value;
  const uObj = listaUsuarios.find(u => u.id === usuarioId);
  if (!uObj) return;

  const mesGlobal = document.getElementById("selMesGlobal").value;
  const fechaCierreMes = `${mesGlobal}-19`; // Asociado al corte del 19 del mes seleccionado
  const contratoId = uObj.contrato_base_id || document.getElementById("selContratoGlobal").value;
  const tipo = document.getElementById("hadTipo").value;
  const cantidad = parseFloat(document.getElementById("hadCantidad").value) || 0;
  const motivo = document.getElementById("hadMotivo").value.trim();

  let valorUnitario = TARIFA_HORA_ADICIONAL_PUNTO;
  let montoTotal = 0;

  if (tipo === "HORA_ADICIONAL_PUNTO") {
    valorUnitario = TARIFA_HORA_ADICIONAL_PUNTO;
    montoTotal = Number((cantidad * TARIFA_HORA_ADICIONAL_PUNTO).toFixed(2));
  } else if (tipo === "HORA_FIN_DE_OBRA") {
    valorUnitario = TARIFA_HORA_FIN_DE_OBRA;
    montoTotal = Number((cantidad * TARIFA_HORA_FIN_DE_OBRA).toFixed(2));
  } else {
    valorUnitario = cantidad;
    montoTotal = Number(cantidad.toFixed(2));
  }

  const { error } = await supabase
    .from("asistencia_horas_adicionales")
    .insert([{
      contrato_id: contratoId,
      usuario_id: usuarioId,
      usuario_nombre: uObj.nombre_completo,
      fecha: fechaCierreMes,
      tipo_registro: tipo,
      origen: "MANUAL",
      horas_turno_base: 0,
      horas_reales_totales: tipo === "BONO_MENSUAL" ? 0 : cantidad,
      cantidad_horas_adicionales: tipo === "BONO_MENSUAL" ? 1 : cantidad,
      valor_unitario_usd: valorUnitario,
      monto_total_usd: montoTotal,
      motivo_detalle: motivo,
      estado_aprobacion: "PENDIENTE"
    }]);

  if (error) {
    alert("Error al guardar: " + error.message);
    return;
  }

  document.getElementById("hadMotivo").value = "";
  mostrarMensaje(`💲 Cargado al mes ${mesGlobal} para ${uObj.nombre_completo} ($${montoTotal.toFixed(2)}).`);
  await cargarHorasAdicionalesYBonos();
}

async function cargarHorasAdicionalesYBonos() {
  const mesGlobal = document.getElementById("selMesGlobal").value; // Ej: "2026-11"
  const filtroContratoId = document.getElementById("selContratoGlobal").value;
  const filtroPersonaId = document.getElementById("selPersonaGlobal").value;

  if (!mesGlobal) return;
  
  // 🔴 NUEVO: Definir el ciclo de corte del 20 al 20
  const [anio, mes] = mesGlobal.split("-").map(Number);
  
  // Mes anterior para la fecha de inicio (20 del mes pasado)
  const fechaInicioCorte = new Date(anio, mes - 2, 20).toISOString().split("T")[0];
  // Mes actual para la fecha final (20 del mes seleccionado)
  const fechaFinCorte = `${mesGlobal}-20`;

  let query = supabase
    .from("asistencia_horas_adicionales")
    .select("*")
    .gte("fecha", fechaInicioCorte)
    .lte("fecha", fechaFinCorte)
    .order("fecha", { ascending: false });

  if (filtroContratoId !== "TODOS") query = query.eq("contrato_id", filtroContratoId);
  if (filtroPersonaId !== "TODOS") query = query.eq("usuario_id", filtroPersonaId);
  
  // Resto de la función continúa igual...
  const { data } = await query;
  const filas = data || [];

  let sumHPunto = 0, sumMontoPunto = 0;
  let sumHObra = 0, sumMontoObra = 0;
  let montoPendienteRojo = 0, montoAprobadoVerde = 0;

  const tbody = document.getElementById("tbodyHorasAdicionales");
  tbody.innerHTML = "";

  if (filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-3">Sin horas adicionales ni bonos para el Contrato, Mes y Auxiliar seleccionados.</td></tr>';
  }

  filas.forEach(r => {
    const hAdic = Number(r.cantidad_horas_adicionales || 0);
    const monto = Number(r.monto_total_usd || 0);

if (r.tipo_registro === "HORA_ADICIONAL_PUNTO" || r.tipo_registro === "FERIADO_TRABAJADO") {
      sumHPunto += hAdic;
      sumMontoPunto += monto;
    } else if (r.tipo_registro === "HORA_FIN_DE_OBRA") {
      sumHObra += hAdic;
      sumMontoObra += monto;
    }

    if (r.estado_aprobacion === "APROBADO") montoAprobadoVerde += monto;
    else montoPendienteRojo += monto;

    const cInfo = mapaContratosPorId[r.contrato_id];
    const esAprobado = r.estado_aprobacion === "APROBADO";
    const badgeEstado = esAprobado
      ? `<span class="semaforo-verde">🟢 APROBADO PAGO</span>`
      : `<span class="semaforo-rojo">🔴 PENDIENTE (DÍA 19)</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center fw-bold">${r.fecha}</td>
      <td class="text-center fw-semibold text-primary">${cInfo ? cInfo.codigo_contrato : "-"}</td>
      <td class="fw-bold text-dark">${r.usuario_nombre}</td>
      <td class="text-center"><span class="badge bg-dark">${r.tipo_registro}</span></td>
      <td class="text-center">${r.origen}</td>
      <td class="text-center">${Number(r.horas_turno_base).toFixed(2)} h</td>
      <td class="text-center">${Number(r.horas_reales_totales).toFixed(2)} h</td>
      <td class="text-center fw-bold text-primary">${r.tipo_registro === "BONO_MENSUAL" ? "BONO" : hAdic.toFixed(2) + " h"}</td>
      <td class="text-end">$${Number(r.valor_unitario_usd).toFixed(2)}</td>
      <td class="text-end fw-bold text-dark">$${monto.toFixed(2)}</td>
      <td>${r.motivo_detalle || "-"}</td>
      <td class="text-center">${badgeEstado}</td>
      <td class="text-center no-print">
        <button type="button" class="btn btn-sm ${esAprobado ? "btn-outline-secondary" : "btn-success"} py-0 px-2 fw-bold" data-aprobar="${r.id}">
          ${esAprobado ? "Revertir" : "✓ Aprobar"}
        </button>
      </td>
    `;
    tr.querySelector(`[data-aprobar="${r.id}"]`).addEventListener("click", () => cambiarEstadoAprobacionHora(r));
    tbody.appendChild(tr);
  });

  document.getElementById("kpiHorasPunto").innerText = `${sumHPunto.toFixed(2)} h ($${sumMontoPunto.toFixed(2)})`;
  document.getElementById("kpiHorasFinObra").innerText = `${sumHObra.toFixed(2)} h ($${sumMontoObra.toFixed(2)})`;
  document.getElementById("kpiMontoPendiente").innerText = `$${montoPendienteRojo.toFixed(2)}`;
  document.getElementById("kpiMontoAprobado").innerText = `$${montoAprobadoVerde.toFixed(2)}`;
}

async function cambiarEstadoAprobacionHora(registro) {
  if (rolActual !== "CONTROL") {
    alert("⛔ Solo el rol CONTROL GENERAL puede aprobar horas adicionales para pago.");
    return;
  }
  const nuevoEstado = registro.estado_aprobacion === "APROBADO" ? "PENDIENTE" : "APROBADO";
  await supabase
    .from("asistencia_horas_adicionales")
    .update({
      estado_aprobacion: nuevoEstado,
      aprobado_por: sesionActual ? sesionActual.nombre : "CONTROL GENERAL",
      fecha_aprobacion: new Date().toISOString()
    })
    .eq("id", registro.id);

  await cargarHorasAdicionalesYBonos();
}

async function aprobarTodasLasHorasControl19() {
  if (rolActual !== "CONTROL") {
    alert("⛔ Solo el rol CONTROL GENERAL está autorizado para aprobar el corte del día 19.");
    return;
  }
  const mesGlobal = document.getElementById("selMesGlobal").value;
  const [anio, mes] = mesGlobal.split("-").map(Number);
  const diasMes = new Date(anio, mes, 0).getDate();

  await supabase
    .from("asistencia_horas_adicionales")
    .update({
      estado_aprobacion: "APROBADO",
      aprobado_por: sesionActual ? sesionActual.nombre : "CONTROL GENERAL",
      fecha_aprobacion: new Date().toISOString()
    })
    .eq("estado_aprobacion", "PENDIENTE")
    .gte("fecha", `${mesGlobal}-01`)
    .lte("fecha", `${mesGlobal}-${String(diasMes).padStart(2, "0")}`);

  mostrarMensaje("✅ Todas las horas adicionales y bonos del mes han pasado a VERDE (APROBADO PARA PAGO).");
  await cargarHorasAdicionalesYBonos();
}

// =====================================================================
// PESTAÑA 5: RECEPCIÓN DE SERVICIOS EVENTUALES (CREADOS EN SUPERVISIÓN)
// =====================================================================
async function cargarCatalogoServiciosDelMes() {
  const { data } = await supabase
    .from("asistencia_servicios")
    .select("*")
    .order("fecha_servicio", { ascending: false });

  listaServicios = data || [];
  const sel = document.getElementById("srvFiltroServicio");
  sel.innerHTML = '<option value="TODOS">TODOS LOS SERVICIOS DEL MES</option>';
  listaServicios.forEach(s => {
    sel.appendChild(new Option(`${s.nombre_servicio} [${s.codigo_servicio}] (${s.fecha_servicio})`, s.id));
  });
}

async function cargarMarcacionesDeServicios() {
  const mesGlobal = document.getElementById("selMesGlobal").value;
  const filtroPersonaId = document.getElementById("selPersonaGlobal").value;
  const filtroSrvId = document.getElementById("srvFiltroServicio").value;

  if (!mesGlobal) return;
  const [anio, mes] = mesGlobal.split("-").map(Number);
  const diasMes = new Date(anio, mes, 0).getDate();

  let query = supabase
    .from("asistencia_marcaciones")
    .select("*")
    .eq("tipo_ubicacion", "SERVICIO")
    .gte("fecha", `${mesGlobal}-01`)
    .lte("fecha", `${mesGlobal}-${String(diasMes).padStart(2, "0")}`)
    .order("fecha", { ascending: false });

  if (filtroPersonaId !== "TODOS") query = query.eq("usuario_id", filtroPersonaId);
  if (filtroSrvId !== "TODOS") query = query.eq("servicio_id", filtroSrvId);

  const { data } = await query;
  const tbody = document.getElementById("tbodyServiciosMarcaciones");
  tbody.innerHTML = "";

  const filas = data || [];
  if (filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-3">Sin registros de servicios eventuales para este filtro.</td></tr>';
    return;
  }

  filas.forEach(m => {
    const srv = listaServicios.find(s => s.id === m.servicio_id);
    const cInfo = mapaContratosPorId[m.contrato_id];
    const totalH = Number(m.horas_trabajadas_reales || 0);
    const baseDescontada = 6;
    const adicObra = Math.max(0, Number((totalH - baseDescontada).toFixed(2)));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center fw-bold">${m.fecha}</td>
      <td class="fw-bold text-primary">${srv ? `${srv.nombre_servicio} [${srv.codigo_servicio}]` : "SERVICIO EVENTUAL"}</td>
      <td class="fw-bold text-dark">${m.usuario_nombre}</td>
      <td class="text-center">${cInfo ? cInfo.codigo_contrato : "-"}</td>
      <td class="text-center fw-bold text-success">${(m.hora_real_entrada || "-").slice(0, 5)}</td>
      <td class="text-center fw-bold text-danger">${(m.hora_real_salida || "-").slice(0, 5)}</td>
      <td class="text-center fw-bold">${totalH.toFixed(2)} h</td>
      <td class="text-center text-muted">${baseDescontada.toFixed(2)} h</td>
      <td class="text-center fw-bold text-info">${adicObra.toFixed(2)} h ($${(adicObra * TARIFA_HORA_FIN_DE_OBRA).toFixed(2)})</td>
      <td class="text-center">
        ${m.foto_timestamp_url ? `<a href="${m.foto_timestamp_url}" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2">📷 Ver Foto</a>` : "-"}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function cargarHistorialNovedades() {
  const mesGlobal = document.getElementById("selMesGlobal").value;
  const filtroContratoId = document.getElementById("selContratoGlobal").value;
  const filtroPersonaId = document.getElementById("selPersonaGlobal").value;

  if (!mesGlobal) return;
  const [anio, mes] = mesGlobal.split("-").map(Number);
  const diasMes = new Date(anio, mes, 0).getDate();

  let query = supabase
    .from("asistencia_novedades")
    .select("*")
    .gte("fecha_novedad", `${mesGlobal}-01`)
    .lte("fecha_novedad", `${mesGlobal}-${String(diasMes).padStart(2, "0")}`)
    .order("fecha_novedad", { ascending: false });

  if (filtroContratoId !== "TODOS") query = query.eq("contrato_id", filtroContratoId);
  if (filtroPersonaId !== "TODOS") {
    query = query.or(`usuario_titular_id.eq.${filtroPersonaId},usuario_reemplazo_id.eq.${filtroPersonaId}`);
  }

  const [{ data }, { data: nombresData }] = await Promise.all([
    query,
    supabase.rpc("obtener_mapa_nombres_usuarios")
  ]);

  const mapaNombres = {};
  (nombresData || []).forEach(u => { mapaNombres[u.id] = u.nombre_completo; });

  const tbody = document.getElementById("tbodyNovedades");
  tbody.innerHTML = "";

  const filas = data || [];
  if (filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Sin notificaciones de permisos ni cambios en este mes.</td></tr>';
    return;
  }

  filas.forEach(n => {
    const cInfo = mapaContratosPorId[n.contrato_id];
    const nomTitular = n.usuario_titular_id ? (mapaNombres[n.usuario_titular_id] || "-") : "-";
    const nomReemplazo = n.usuario_reemplazo_id ? (mapaNombres[n.usuario_reemplazo_id] || "SIN REEMPLAZO") : "SIN REEMPLAZO";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center fw-bold">${n.fecha_novedad}</td>
      <td class="text-center fw-semibold text-primary">${cInfo ? cInfo.codigo_contrato : "-"}</td>
      <td class="text-center"><span class="badge bg-dark">${n.tipo_novedad}</span></td>
      <td class="fw-bold text-danger">${nomTitular}</td>
      <td class="fw-bold text-success">${nomReemplazo}</td>
      <td>${n.descripcion || "-"}</td>
      <td class="text-center">${n.registrado_por || "SUPERVISIÓN"}</td>
      <td class="text-center">
        ${n.foto_documento_url ? `<a href="${n.foto_documento_url}" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2">📷 Ver Evidencia</a>` : "-"}
      </td>
    `;
    tbody.appendChild(tr);
  });
}
// =====================================================================
// RADAR EN TIEMPO REAL (WEBSOCKETS DE SUPABASE)
// =====================================================================
function iniciarSuscripcionEnVivo() {
  supabase
    .channel('erp-asistencia-vivo')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'asistencia_marcaciones' },
      (payload) => {
        // Cuando alguien timbra en el QR, recarga estas tablas sin parpadear
        console.log("Timbrado detectado en vivo:", payload);
        cargarAsistenciaDePuntos();
        cargarHorasAdicionalesYBonos();
        cargarMarcacionesDeServicios();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'asistencia_turnos' },
      (payload) => {
        // Si el supervisor asigna o mueve un turno, refresca el calendario
        renderizarCalendarioMensual();
        cargarAsistenciaDePuntos();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log("📡 Conectado a Supabase en Tiempo Real.");
      }
    });
}