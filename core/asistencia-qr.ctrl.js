// =====================================================================
// ARCHIVO: core/asistencia-qr.ctrl.js
// Cámara Timestamp en Vivo, Geocerca GPS y Validación Automática IN/OUT
// =====================================================================
import { supabase, subirFotoHisopadoStorage } from "./supabaseClient.js";

const TARIFA_HORA_ADICIONAL_PUNTO = 2.01;
const TARIFA_HORA_FIN_DE_OBRA = 2.34;
const TOPE_PAGO_FERIADO_8H = 22.00;
const TARIFA_HORA_FERIADO = 2.75; // $22.00 / 8 horas
const META_HORAS_MENSUAL_ESPECIALES = 160;

let contratoActivo = null;
let servicioActivo = null;
let mapaContratos = {};
let latUsuario = null;
let lngUsuario = null;
let distanciaActualMetros = 0;
let dentroDeGeocerca = true;
let imagenRespaldoCargada = null;

let usuarioValidado = null;
let marcacionPreviaHoy = null;
let turnoDiaHoy = null;

document.addEventListener("DOMContentLoaded", async () => {
  iniciarRelojVivo();
  await encenderCamaraFrontal();
  iniciarMonitoreoGPS();
  await detectarOrigenQR();

  document.getElementById("selPuntoOperativo").addEventListener("change", e => {
    contratoActivo = mapaContratos[e.target.value] || null;
    if (contratoActivo) {
      document.getElementById("lblUbicacionNombre").innerText = `📍 PUNTO: ${contratoActivo.nombre_cliente}`;
      evaluarGeocercaGPS();
    }
  });

  document.getElementById("btnValidarPin").addEventListener("click", validarEstadoAsistenciaAuxiliar);
  document.getElementById("formTerminalAsistencia").addEventListener("submit", registrarMarcacionTimestamp);
});

function iniciarRelojVivo() {
  const tick = () => {
    const ahora = new Date();
    document.getElementById("lblRelojTimestamp").innerText =
      `⏱️ ${ahora.toLocaleDateString("es-EC")} — ${ahora.toLocaleTimeString("es-EC")}`;
  };
  tick();
  setInterval(tick, 1000);
}

async function encenderCamaraFrontal() {
  const video = document.getElementById("videoTimestamp");
  const fallbackBox = document.getElementById("cajaCamaraNativaFallback");
  const fileInput = document.getElementById("fileFotoNativa");

  if (fileInput) {
    fileInput.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          imagenRespaldoCargada = img;
          document.getElementById("lblEstadoGeocerca").innerText = "✅ Fotografía cargada lista para estampar Timestamp.";
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Cámara en vivo requiere HTTPS");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    video.srcObject = stream;
  } catch (err) {
    if (fallbackBox) fallbackBox.style.display = "block";
    document.getElementById("lblEstadoGeocerca").innerText = "📱 Modo Prueba / Celular IP: Use el botón amarillo o timbre directo.";
  }
}

function iniciarMonitoreoGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    pos => {
      latUsuario = pos.coords.latitude;
      lngUsuario = pos.coords.longitude;
      evaluarGeocercaGPS();
    },
    () => {
      document.getElementById("lblEstadoGeocerca").innerText = "⚠️ Active la ubicación GPS de su celular.";
    },
    { enableHighAccuracy: true }
  );
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function evaluarGeocercaGPS() {
  if (!latUsuario || !lngUsuario) return;

  if (contratoActivo && contratoActivo.latitud && contratoActivo.longitud) {
    distanciaActualMetros = calcularDistanciaMetros(
      latUsuario,
      lngUsuario,
      Number(contratoActivo.latitud),
      Number(contratoActivo.longitud)
    );
    const radioPermitido = Number(contratoActivo.radio_metros || 150);
    dentroDeGeocerca = distanciaActualMetros <= radioPermitido;

    document.getElementById("lblEstadoGeocerca").innerText = dentroDeGeocerca
      ? `✅ DENTRO DE GEOCERCA (${distanciaActualMetros}m / Radio: ${radioPermitido}m)`
      : `⛔ FUERA DE RANGO (${distanciaActualMetros}m / Máx permitido: ${radioPermitido}m)`;
  } else {
    dentroDeGeocerca = true;
    document.getElementById("lblEstadoGeocerca").innerText =
      `📍 GPS: ${latUsuario.toFixed(5)}, ${lngUsuario.toFixed(5)}`;
  }
}

async function detectarOrigenQR() {
  const params = new URLSearchParams(window.location.search);
  const codContrato = (params.get("contrato") || "").trim().toUpperCase();
  const codServicio = (params.get("servicio") || "").trim().toUpperCase();

  if (codServicio) {
    const { data: srv } = await supabase
      .from("asistencia_servicios")
      .select("*")
      .eq("codigo_servicio", codServicio)
      .maybeSingle();

    if (srv) {
      servicioActivo = srv;
      document.getElementById("lblPuntoDetectado").innerText = `SERVICIO: ${srv.nombre_servicio}`;
      document.getElementById("lblUbicacionNombre").innerText = `🚀 OBRA: ${srv.nombre_servicio} [${srv.codigo_servicio}]`;
      return;
    }
  }

  const { data: contratos } = await supabase
    .from("trazabilidad_contratos")
    .select("*")
    .eq("activo", true)
    .order("nombre_cliente", { ascending: true });

  const lista = contratos || [];
  const sel = document.getElementById("selPuntoOperativo");
  sel.innerHTML = "";
  lista.forEach(c => {
    mapaContratos[c.codigo_contrato] = c;
    sel.appendChild(new Option(`${c.nombre_cliente} [${c.codigo_contrato}]`, c.codigo_contrato));
  });

  if (codContrato && mapaContratos[codContrato]) {
    contratoActivo = mapaContratos[codContrato];
    sel.value = codContrato;
    document.getElementById("lblPuntoDetectado").innerText = `${contratoActivo.nombre_cliente} [${codContrato}]`;
    document.getElementById("lblUbicacionNombre").innerText = `📍 PUNTO: ${contratoActivo.nombre_cliente}`;
  } else if (lista.length > 0) {
    contratoActivo = lista[0];
    document.getElementById("cajaSelectorManualContrato").style.display = "block";
    document.getElementById("lblUbicacionNombre").innerText = `📍 PUNTO: ${contratoActivo.nombre_cliente}`;
  }
  evaluarGeocercaGPS();
}

// NUEVA FUNCIÓN: Valida el PIN y habilita solo ENTRADA o SALIDA automáticamente
// NUEVA FUNCIÓN: Valida el PIN y habilita solo ENTRADA o SALIDA automáticamente
async function validarEstadoAsistenciaAuxiliar() {
  const pin = document.getElementById("txtPinAuxiliar").value.trim().toUpperCase();
  const btnValidar = document.getElementById("btnValidarPin");
  
  if (!pin) {
    alert("Ingrese su PIN primero.");
    return;
  }

  btnValidar.disabled = true;
  btnValidar.innerText = "🔍 Buscando...";

try {
    const { data: rpcUsers, error: errRpc } = await supabase.rpc("login_por_pin", {
      pin_entrada: pin
    });

    if (errRpc) throw errRpc;
    const user = Array.isArray(rpcUsers) && rpcUsers.length > 0 ? rpcUsers[0] : null;

    if (!user) {
      alert("⛔ PIN incorrecto o usuario inactivo.");
      resetFormularioTimbrado();
      return;
    }
    usuarioValidado = user;
    document.getElementById("lblNombreAuxValidado").innerText = user.nombre_completo;
    document.getElementById("cajaBotonesEvento").style.display = "block";

    const ahora = new Date();
    const hoyISO = ahora.getFullYear() + "-" + String(ahora.getMonth() + 1).padStart(2, '0') + "-" + String(ahora.getDate()).padStart(2, '0');
    const tipoUbicacion = servicioActivo ? "SERVICIO" : "PUNTO_FIJO";

    // Buscar turno de hoy primero para saber si es Banco de Horas (BH)
    const { data: turno } = await supabase
      .from("asistencia_turnos")
      .select("*")
      .eq("usuario_id", user.id)
      .eq("fecha", hoyISO)
      .maybeSingle();
      
    turnoDiaHoy = turno;

    // CORREGIDO 1: Usar el ID real del contrato (contratoActivo.id), NO el texto del select
    const contratoValidacion = servicioActivo
      ? (user.contrato_base_id || servicioActivo.contrato_origen_id)
      : (contratoActivo ? contratoActivo.id : user.contrato_base_id);
    
    // Traer todas las marcaciones de hoy en esta sede específica
    const { data: marcaciones } = await supabase
      .from("asistencia_marcaciones")
      .select("*")
      .eq("usuario_id", user.id)
      .eq("fecha", hoyISO)
      .eq("tipo_ubicacion", tipoUbicacion)
      .eq("contrato_id", contratoValidacion)
      .order("id", { ascending: false });
      
    // CORREGIDO 2: Buscar primero si tiene un turno ABIERTO (con entrada, pero sin hora_real_salida)
    const turnoAbierto = (marcaciones || []).find(m => m.hora_real_entrada && !m.hora_real_salida) || null;
    const ultimoCerrado = (marcaciones && marcaciones.length > 0) ? marcaciones[0] : null;

    // Verificar si es personal de Trabajos Especiales / Banco de Horas o rotativo
    const cBase = Object.values(mapaContratos).find(c => c.id === user.contrato_base_id);
    const esVolanteOBancoHoras = (turnoDiaHoy && turnoDiaHoy.codigo_turno === "BH") || (cBase && cBase.tiene_turno_especial);

    let marc = null;
    if (turnoAbierto) {
      // Tiene una entrada pendiente de salida en este punto -> Toca SALIDA
      marc = turnoAbierto;
    } else if (ultimoCerrado && !esVolanteOBancoHoras) {
      // Es trabajador de turno fijo normal y ya cerró su turno hoy
      marc = ultimoCerrado;
    } else {
      // No ha entrado hoy, o es Volante (BH) regresando por 2da/3ra vez al punto -> Toca nueva ENTRADA
      marc = null;
    }

    // CORREGIDO 3: Conectar con marcacionPreviaHoy para que el botón de SALIDA sepa qué ID actualizar
    marcacionPreviaHoy = marc;

    const btnIn = document.getElementById("cajaBtnEntrada");
    const btnOut = document.getElementById("cajaBtnSalida");
    const radIn = document.getElementById("evEntrada");
    const radOut = document.getElementById("evSalida");

    // Lógica Automática:
    if (!marc) {
      // No hay marcación abierta -> Habilita ENTRADA
      btnIn.style.display = "block";
      btnOut.style.display = "none";
      radIn.checked = true;
    } else if (marc.hora_real_entrada && !marc.hora_real_salida) {
      // Tiene entrada abierta, falta salida -> Habilita SALIDA
      btnIn.style.display = "none";
      btnOut.style.display = "block";
      radOut.checked = true;
    } else if (marc.hora_real_entrada && marc.hora_real_salida) {
      // Ya tiene ambas (solo aplica a trabajadores fijos que no son Banco de Horas)
      alert(`✅ Su jornada de hoy (${marc.hora_real_entrada.slice(0,5)} a ${marc.hora_real_salida.slice(0,5)}) ya está completada.`);
      resetFormularioTimbrado();
      return;
    }

  } catch (err) {
    alert("Error conectando con el servidor: " + err.message);
  } finally {
    btnValidar.disabled = false;
    btnValidar.innerText = "🔍 Validar PIN";
  }
}

function resetFormularioTimbrado() {
  document.getElementById("cajaBotonesEvento").style.display = "none";
  usuarioValidado = null;
  marcacionPreviaHoy = null;
  turnoDiaHoy = null;
}

function capturarFotoConMarcaDeAgua(nombreTrabajador, nombreLugar, evento) {
  const video = document.getElementById("videoTimestamp");
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");

  if (video && video.srcObject && video.videoWidth > 0) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } else if (imagenRespaldoCargada) {
    ctx.drawImage(imagenRespaldoCargada, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 22px Arial";
    ctx.fillText("REGISTRO BIOMÉTRICO EN MODO PRUEBA", 95, 200);
  }

  const hBanda = 96;
  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.fillRect(0, canvas.height - hBanda, canvas.width, hBanda);

  const ahora = new Date();
  const selloTiempo = `${ahora.toLocaleDateString("es-EC")} ${ahora.toLocaleTimeString("es-EC")}`;
  const coordsTxt = latUsuario
    ? `${latUsuario.toFixed(5)}, ${lngUsuario.toFixed(5)} (${distanciaActualMetros}m)`
    : "GPS Modo Prueba Local";

  ctx.fillStyle = evento === "ENTRADA" ? "#4ade80" : "#f87171";
  ctx.font = "bold 16px Arial";
  ctx.fillText(`⏱️ ${evento}: ${selloTiempo}`, 14, canvas.height - 66);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px Arial";
  ctx.fillText(`👤 ${nombreTrabajador}`, 14, canvas.height - 42);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "13px Arial";
  ctx.fillText(`📍 ${nombreLugar} | GPS: ${coordsTxt}`, 14, canvas.height - 18);

  return canvas.toDataURL("image/jpeg", 0.8);
}

function calcularDiferenciaHoras(hInicio, hFin) {
  const [h1, m1] = hInicio.slice(0, 5).split(":").map(Number);
  const [h2, m2] = hFin.slice(0, 5).split(":").map(Number);
  let diff = (h2 + m2 / 60) - (h1 + m1 / 60);
  if (diff < 0) diff += 24;
  return Number(diff.toFixed(2));
}

async function registrarMarcacionTimestamp(e) {
  e.preventDefault();
  const evento = document.querySelector("input[name='radEvento']:checked").value;
  const btn = document.getElementById("btnRegistrarTimestamp");

  if (!usuarioValidado) {
    alert("Valide su PIN primero.");
    return;
  }

  if (!servicioActivo && contratoActivo && !dentroDeGeocerca) {
    alert(`⛔ DENEGADO POR GEOCERCA GPS:\nUsted se encuentra a ${distanciaActualMetros} metros del punto y el radio permitido es de ${contratoActivo.radio_metros || 150} metros.`);
    return;
  }

  btn.disabled = true;
  btn.innerText = "📸 Estampando y procesando...";

  try {
    const ahora = new Date();
    const hoyISO = ahora.getFullYear() + "-" + String(ahora.getMonth() + 1).padStart(2, '0') + "-" + String(ahora.getDate()).padStart(2, '0');
    const horaActual = String(ahora.getHours()).padStart(2, '0') + ":" + String(ahora.getMinutes()).padStart(2, '0');
    
    const esServicio = Boolean(servicioActivo);
    const tipoUbicacion = esServicio ? "SERVICIO" : "PUNTO_FIJO";
    const contratoIdFinal = esServicio
      ? (usuarioValidado.contrato_base_id || servicioActivo.contrato_origen_id)
      : (contratoActivo ? contratoActivo.id : usuarioValidado.contrato_base_id);
    const nombreLugar = esServicio
      ? servicioActivo.nombre_servicio
      : (contratoActivo ? contratoActivo.nombre_cliente : "PUNTO OPERATIVO");

    const fotoBase64 = capturarFotoConMarcaDeAgua(usuarioValidado.nombre_completo, nombreLugar, evento);
    const urlFotoPublica = await subirFotoHisopadoStorage(
      fotoBase64,
      esServicio ? servicioActivo.codigo_servicio : (contratoActivo ? contratoActivo.codigo_contrato : "ASISTENCIA"),
      usuarioValidado.nombre_completo
    );

    const esBH = turnoDiaHoy && turnoDiaHoy.codigo_turno === "BH";
    const hProgEnt = turnoDiaHoy ? turnoDiaHoy.hora_entrada : "07:00";
    const hProgSal = turnoDiaHoy ? turnoDiaHoy.hora_salida : "13:00";
    const horasTurnoBase = esBH ? 99 : (turnoDiaHoy ? Number(turnoDiaHoy.horas_turno_base || 8) : 8);
    if (evento === "ENTRADA") {
      const { error: errEnt } = await supabase
        .from("asistencia_marcaciones")
        .insert([{
          contrato_id: contratoIdFinal,
          servicio_id: esServicio ? servicioActivo.id : null,
          usuario_id: usuarioValidado.id,
          usuario_nombre: usuarioValidado.nombre_completo,
          fecha: hoyISO,
          tipo_ubicacion: tipoUbicacion,
          hora_prog_entrada: hProgEnt,
          hora_prog_salida: hProgSal,
          hora_real_entrada: horaActual,
          dentro_geocerca: dentroDeGeocerca,
          distancia_metros: distanciaActualMetros,
          foto_timestamp_url: urlFotoPublica,
          estado_semaforo: "TIMBRADO_VERDE",
          observaciones: `Entrada Timestamp (${horaActual})`
        }]);

      if (errEnt) throw errEnt;
      document.getElementById("lblMensajeExito").innerText = `✓ ENTRADA REGISTRADA: ${usuarioValidado.nombre_completo} a las ${horaActual}.`;

 } else { // SALIDA
      const horaEntradaReal = marcacionPreviaHoy ? marcacionPreviaHoy.hora_real_entrada : hProgEnt;
      const horasReales = calcularDiferenciaHoras(horaEntradaReal, horaActual);

      // Identificar si es Feriado o si pertenece al Equipo de Trabajos Especiales (Banco de Horas 160h)
      const esFeriadoHoy = turnoDiaHoy && (turnoDiaHoy.codigo_turno === "FERIADO" || turnoDiaHoy.estado_calendario === "FERIADO");
      const cBaseUsu = Object.values(mapaContratos).find(c => c.id === usuarioValidado.contrato_base_id);
      const esEquipoEspeciales = (turnoDiaHoy && turnoDiaHoy.codigo_turno === "BH") ||
        (cBaseUsu && (cBaseUsu.tiene_turno_especial || (cBaseUsu.codigo_contrato || "").includes("ESPECIAL")));

      let obsSalida = `Jornada cumplida (${horasReales}h)`;
      let payloadAdicional = null;

      // =========================================================================
      // CASO 1: DÍA FERIADO ASIGNADO EN EL CRONOGRAMA (Máx $22 por 8h+, o proporcional)
      // =========================================================================
      if (esFeriadoHoy) {
        const horasReconocidasFeriado = Math.min(8, horasReales);
        const montoFeriado = horasReales >= 8
          ? TOPE_PAGO_FERIADO_8H
          : Number(((horasReales / 8) * TOPE_PAGO_FERIADO_8H).toFixed(2));

        obsSalida = `🎉 Feriado trabajado (${horasReales}h) -> Reconoce $${montoFeriado.toFixed(2)} en Nómina`;

        payloadAdicional = {
          contrato_id: contratoIdFinal,
          usuario_id: usuarioValidado.id,
          usuario_nombre: usuarioValidado.nombre_completo,
          fecha: hoyISO,
          tipo_registro: "FERIADO_TRABAJADO",
          origen: "AUTOMATICO_QR",
          horas_turno_base: 8,
          horas_reales_totales: horasReales,
          cantidad_horas_adicionales: Number(horasReconocidasFeriado.toFixed(2)),
          valor_unitario_usd: TARIFA_HORA_FERIADO,
          monto_total_usd: montoFeriado,
          motivo_detalle: `Jornada en Feriado (${horaEntradaReal.slice(0, 5)} a ${horaActual} — ${horasReales}h reales): ${horasReales >= 8 ? "Tope máximo 8h ($22.00)" : `Proporcional sobre 8h ($${montoFeriado.toFixed(2)})`}`,
          estado_aprobacion: "PENDIENTE"
        };

      // =========================================================================
      // CASO 2: EQUIPO TRABAJOS ESPECIALES (Acumula hasta 160h del 20 al 20; el exceso va a $2.34)
      // =========================================================================
      } else if (esEquipoEspeciales) {
        // 🔴 CORRECCIÓN: Definir el ciclo de corte del 20 al 20
        const hoyDate = new Date(hoyISO + "T00:00:00");
        const anioH = hoyDate.getFullYear();
        const mesH = hoyDate.getMonth(); // 0 a 11
        const diaH = hoyDate.getDate();
        
        let fechaInicioBH, fechaFinBH;
        if (diaH >= 20) {
          fechaInicioBH = `${anioH}-${String(mesH + 1).padStart(2, '0')}-20`;
          fechaFinBH = hoyISO;
        } else {
          const mesPasado = mesH === 0 ? 12 : mesH;
          const anioPasado = mesH === 0 ? anioH - 1 : anioH;
          fechaInicioBH = `${anioPasado}-${String(mesPasado).padStart(2, '0')}-20`;
          fechaFinBH = hoyISO;
        }

        const { data: marcMes } = await supabase
          .from("asistencia_marcaciones")
          .select("id, horas_trabajadas_reales")
          .eq("usuario_id", usuarioValidado.id)
          .gte("fecha", fechaInicioBH)
          .lte("fecha", fechaFinBH);

        // Sumar todas las horas que ya llevaba en el ciclo 20-20 ANTES de cerrar este turno
        const horasPreviasMes = (marcMes || [])
          .filter(m => m.id !== marcacionPreviaHoy.id)
          .reduce((acc, m) => acc + Number(m.horas_trabajadas_reales || 0), 0);

        const nuevoTotalMes = Number((horasPreviasMes + horasReales).toFixed(2));

        if (nuevoTotalMes > META_HORAS_MENSUAL_ESPECIALES) {
          // Si ya había pasado las 160h antes en este ciclo 20-20, TODO este turno es adicional
          const horasExtraEspeciales = horasPreviasMes >= META_HORAS_MENSUAL_ESPECIALES
            ? horasReales
            : Number((nuevoTotalMes - META_HORAS_MENSUAL_ESPECIALES).toFixed(2));

          const montoEspecial = Number((horasExtraEspeciales * TARIFA_HORA_FIN_DE_OBRA).toFixed(2));
          obsSalida = `Banco 160h superado (Ciclo 20-20 Acum: ${nuevoTotalMes}h) -> +${horasExtraEspeciales}h a Fin de Obra ($${montoEspecial.toFixed(2)})`;

          payloadAdicional = {
            contrato_id: contratoIdFinal,
            usuario_id: usuarioValidado.id,
            usuario_nombre: usuarioValidado.nombre_completo,
            fecha: hoyISO,
            tipo_registro: "HORA_FIN_DE_OBRA",
            origen: "AUTOMATICO_QR",
            horas_turno_base: META_HORAS_MENSUAL_ESPECIALES,
            horas_reales_totales: nuevoTotalMes,
            cantidad_horas_adicionales: horasExtraEspeciales,
            valor_unitario_usd: TARIFA_HORA_FIN_DE_OBRA,
            monto_total_usd: montoEspecial,
            motivo_detalle: `Excedente sobre 160h del ciclo 20-20 en ${nombreLugar} (${horaEntradaReal.slice(0, 5)} a ${horaActual} | Acumulado ciclo: ${nuevoTotalMes}h)`,
            estado_aprobacion: "PENDIENTE"
          };
        } else {
          const faltan = Number((META_HORAS_MENSUAL_ESPECIALES - nuevoTotalMes).toFixed(2));
          obsSalida = `Banco de Horas (20-20): ${nuevoTotalMes}h / 160h acumuladas (Faltan ${faltan}h para meta)`;
        }
      // =========================================================================
      // CASO 3: CONTRATO NORMAL EN PUNTO O SERVICIO EVENTUAL (Regla de +30 min)
      // =========================================================================
      } else {
        const horasExcedentes = Math.max(0, Number((horasReales - horasTurnoBase).toFixed(2)));
        const esHoraExtraValida = horasExcedentes > 0.5;

        obsSalida = esHoraExtraValida
          ? `Salida ${horaActual} (+${horasExcedentes}h enviadas a Nómina)`
          : (horasExcedentes > 0 ? `Salió tarde (+${horasExcedentes}h) - No supera 30min para extra` : `Jornada cumplida (${horasReales}h)`);

        if (esHoraExtraValida) {
          const tarifa = esServicio ? TARIFA_HORA_FIN_DE_OBRA : TARIFA_HORA_ADICIONAL_PUNTO;
          const tipoHora = esServicio ? "HORA_FIN_DE_OBRA" : "HORA_ADICIONAL_PUNTO";
          const montoTotal = Number((horasExcedentes * tarifa).toFixed(2));

          payloadAdicional = {
            contrato_id: contratoIdFinal,
            usuario_id: usuarioValidado.id,
            usuario_nombre: usuarioValidado.nombre_completo,
            fecha: hoyISO,
            tipo_registro: tipoHora,
            origen: "AUTOMATICO_QR",
            horas_turno_base: horasTurnoBase,
            horas_reales_totales: horasReales,
            cantidad_horas_adicionales: horasExcedentes,
            valor_unitario_usd: tarifa,
            monto_total_usd: montoTotal,
            motivo_detalle: `${esServicio ? `Servicio ${servicioActivo.nombre_servicio}` : "Extensión en punto"} (${horaEntradaReal.slice(0, 5)} a ${horaActual}): Reconoce ${horasExcedentes}h extra`,
            estado_aprobacion: "PENDIENTE"
          };
        }
      }

      // 1. Actualizar la salida en la sábana de marcaciones (Pestaña 3)
      const { error: errSal } = await supabase
        .from("asistencia_marcaciones")
        .update({
          hora_real_salida: horaActual,
          horas_trabajadas_reales: horasReales,
          foto_salida_url: urlFotoPublica,
          estado_semaforo: "TIMBRADO_VERDE",
          observaciones: obsSalida
        })
        .eq("id", marcacionPreviaHoy.id);

      if (errSal) throw errSal;

      // 2. Si generó pago adicional (Feriado, Exceso >160h o Extra >30min), enviarlo a Pestaña 4
      if (payloadAdicional) {
        await supabase
          .from("asistencia_horas_adicionales")
          .insert([payloadAdicional]);
      }

      document.getElementById("lblMensajeExito").innerText = `✓ SALIDA REGISTRADA: ${usuarioValidado.nombre_completo} (${horaActual}) — Total turno: ${horasReales}h.`;
    }

    document.getElementById("imgFotoEstampada").src = fotoBase64;
    document.getElementById("cajaComprobanteTimestamp").style.display = "block";
    
    // Limpiar para el siguiente
    document.getElementById("txtPinAuxiliar").value = "";
    resetFormularioTimbrado();

  } catch (err) {
    alert("Error al registrar asistencia: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "📸 CAPTURAR TIMESTAMP Y GUARDAR";
  }
}