// =====================================================================
// ARCHIVO: modulo-trazabilidad/js/luminometria.ctrl.js
// Controlador de Auditoría Microbiológica y Luminometría ATP (CL-OP-0031)
// Incluye: NO CRÍTICA (45 RLU), Vinculación exclusiva a última DT,
// Fecha local Ecuador y Respaldo Offline-First con Fotografías en Cola
// =====================================================================
import { supabase, subirFotoEvidenciaATP } from "../../core/supabaseClient.js";
import {
  obtenerParametrosURL,
  obtenerSesionActiva,
  homologarRol,
  navegarAVista,
  obtenerContratosAutorizados,
  obtenerMapaPisosAreasPorContrato
} from "../../core/router.js";
import {
  inicializarMonitorOffline,
  insertarConRespaldoOffline,
  guardarCacheContratos,
  obtenerCacheContratos,
  guardarCacheCatalogoAreas,
  obtenerCacheCatalogoAreas
} from "../../core/offlineSync.js";

const PUNTOS_SUGERIDOS = {
  CRITICA: [
    "MESA QUIRÚRGICA",
    "LÁMPARA CIELÍTICA",
    "MESA DE MAYO / RIÑÓN",
    "MÁQUINA DE ANESTESIA",
    "CARRO DE PARO",
    "BARANDAL DE CAMILLA",
    "MONITOR DE SIGNOS VITALES",
    "LAVAMANOS QUIRÚRGICO",
    "MANIJA DE PUERTA / PICAPORTE",
    "PARED / ÁNGULO CRÍTICO"
  ],
  BANOS: [
    "PALANCA / BOTÓN DE INODORO",
    "ASIENTO DE INODORO",
    "GRIFERÍA DE LAVAMANOS",
    "DISPENSADOR DE JABÓN / PAPEL",
    "MANIJA INTERIOR DE PUERTA",
    "PARED DIVISORIA"
  ],
  SEMICRITICA: [
    "PICAPORTE",
    "ÁNGULO DE PARED",
    "BARANDAL DE CAMA / CAMILLA",
    "MESA DE ALIMENTACIÓN / PUENTE",
    "INTERRUPTOR DE LUZ",
    "LLAVE DE AGUA / LAVAMANOS",
    "SILLA DE ESPERA / ESTACIÓN ENFERMERÍA",
    "DISPENSADOR DE ALCOHOL GEL",
    "TIMBRE DE LLAMADO"
  ],
  NOCRITICA: [
    "PICAPORTE",
    "ÁNGULO DE PARED",
    "BARANDAL DE CAMA / CAMILLA",
    "MESA DE ALIMENTACIÓN / PUENTE",
    "INTERRUPTOR DE LUZ",
    "LLAVE DE AGUA / LAVAMANOS",
    "SILLA DE ESPERA / ESTACIÓN ENFERMERÍA",
    "DISPENSADOR DE ALCOHOL GEL",
    "TIMBRE DE LLAMADO"
  ]
};

let catalogoATP = {};
let rolActual = "SUPERVISOR";
let auditorActual = "";
let auditorIdActual = null;
let qrContratoInit = "";
let qrPisoInit = "";
let qrAreaInit = "";
let umbralActivo = 45;
let archivoFotoComprimida = null;
let dataUrlFotoComprimida = null;
let mapaContratos = {};

document.addEventListener("DOMContentLoaded", async () => {
  // Activar detector de red y sincronizador automático en segundo plano
  inicializarMonitorOffline();

  const urlParams = obtenerParametrosURL();
  const sesion = obtenerSesionActiva();

  rolActual = homologarRol(urlParams.rol || (sesion ? sesion.rol : "AUXILIAR"));
  auditorActual =
    urlParams.auditor ||
    urlParams.usuario ||
    (sesion ? (sesion.nombre || sesion.nombre_completo) : "");
  auditorIdActual = sesion ? (sesion.id || sesion.usuario_id || null) : null;

  qrContratoInit = (urlParams.contrato || (sesion ? sesion.qrContrato : "") || "").trim();
  qrPisoInit = (urlParams.piso || (sesion ? sesion.qrPiso : "") || "").trim();
  qrAreaInit = (urlParams.area || (sesion ? sesion.qrArea : "") || "").trim();

  document.getElementById("lblRolATP").innerText = "Rol: " + rolActual;

  // Enlazar eventos
  document.getElementById("btnVolverMenu").addEventListener("click", () => {
    navegarAVista("panel.html", document.getElementById("atpContrato").value);
  });
  document.getElementById("atpContrato").addEventListener("change", () => {
    if (rolActual === "CONTROL") {
      qrPisoInit = "";
      qrAreaInit = "";
    }
    alCambiarContratoATP();
  });
  document.getElementById("atpPiso").addEventListener("change", cargarAreasATP);
  document.getElementById("atpArea").addEventListener("change", alCambiarAreaATP);
  document.getElementById("atpPuntoSelect").addEventListener("change", verificarOtroPunto);
  document.getElementById("atpValorRLU").addEventListener("input", evaluarRLUEnVivo);
  document.getElementById("atpFotoInput").addEventListener("change", previsualizarYComprimirFoto);
  document.getElementById("formATP").addEventListener("submit", enviarATP);
  document.getElementById("btnOtraMuestra").addEventListener("click", registrarOtraMuestraMismaArea);

  if (rolActual !== "CONTROL" && rolActual !== "SUPERVISOR") {
    document.getElementById("pantallaBloqueoRol").style.display = "block";
    return;
  }

  // REGLA ESTRICTA: Si es SUPERVISOR y no escaneó QR de puerta, bloquear registro manual
  if (rolActual === "SUPERVISOR" && (!qrPisoInit || !qrAreaInit)) {
    document.getElementById("pantallaBloqueoRol").style.display = "block";
    document.getElementById("pantallaBloqueoRol").innerHTML = `
      <h5 class="fw-bold text-danger">⛔ REQUIERE ESCANEO DE CÓDIGO QR DE PUERTA</h5>
      <p class="small text-muted mb-3">Para registrar hisopados ATP debe escanear físicamente el código QR del área auditada.</p>
      <button type="button" class="btn btn-dark btn-sm fw-bold" onclick="window.history.back()">← Volver</button>
    `;
    return;
  }

  document.getElementById("contenidoATP").style.display = "block";
  if (auditorActual) {
    document.getElementById("atpResponsable").value = auditorActual;
  }

  await inicializarContratosATP();
});

async function inicializarContratosATP() {
  const selContrato = document.getElementById("atpContrato");
  selContrato.innerHTML = '<option value="">Cargando contratos...</option>';

  let contratos = [];

  try {
    if (navigator.onLine) {
      if (rolActual === "CONTROL") {
        const { data, error } = await supabase
          .from("trazabilidad_contratos")
          .select("id, codigo_contrato, nombre_cliente")
          .eq("activo", true)
          .order("nombre_cliente", { ascending: true });
        if (!error && data) contratos = data;
      } else {
        contratos = await obtenerContratosAutorizados(auditorIdActual, rolActual);
      }
      if (contratos.length > 0) {
        guardarCacheContratos(contratos);
      }
    }
  } catch (e) {
    console.warn("Usando caché local de contratos en ATP:", e.message);
  }

  if (contratos.length === 0) {
    contratos = obtenerCacheContratos();
  }

  if (contratos.length === 0 && qrContratoInit) {
    contratos = [{ id: null, codigo_contrato: qrContratoInit, nombre_cliente: qrContratoInit }];
  }

  selContrato.innerHTML = '<option value="">Seleccione contrato...</option>';
  contratos.forEach(c => {
    mapaContratos[c.codigo_contrato] = c;
    const opt = document.createElement("option");
    opt.value = c.codigo_contrato;
    opt.textContent = `${c.nombre_cliente} (${c.codigo_contrato})`;
    selContrato.appendChild(opt);
  });

  if (qrContratoInit && mapaContratos[qrContratoInit]) {
    selContrato.value = qrContratoInit;
  } else if (contratos.length > 0) {
    selContrato.value = contratos[0].codigo_contrato;
  }

  if (rolActual !== "CONTROL") {
    selContrato.disabled = true;
    selContrato.classList.add("bg-light");
  }

  await alCambiarContratoATP();
}

async function alCambiarContratoATP() {
  const codContrato = document.getElementById("atpContrato").value;
  const info = mapaContratos[codContrato];
  document.getElementById("lblSubtituloContratoATP").innerText = info
    ? `Registro de Hisopados y Unidades Relativas de Luz (RLU) — ${info.nombre_cliente}`
    : "Registro de Hisopados y Unidades Relativas de Luz (RLU)";

  catalogoATP = {};
  if (navigator.onLine) {
    try {
      catalogoATP = await obtenerMapaPisosAreasPorContrato(codContrato);
      guardarCacheCatalogoAreas(codContrato, catalogoATP);
    } catch (e) {
      catalogoATP = obtenerCacheCatalogoAreas(codContrato);
    }
  } else {
    catalogoATP = obtenerCacheCatalogoAreas(codContrato);
  }

  if (Object.keys(catalogoATP).length === 0 && qrPisoInit && qrAreaInit) {
    catalogoATP[qrPisoInit] = [
      { id: null, area: qrAreaInit, tipo: "SEMICRITICA", umbral: 45 }
    ];
  }

  const selPiso = document.getElementById("atpPiso");
  selPiso.innerHTML = '<option value="">Seleccione piso...</option>';

  const listaPisos = Object.keys(catalogoATP);
  listaPisos.forEach(piso => {
    const opt = document.createElement("option");
    opt.value = piso;
    opt.textContent = piso;
    selPiso.appendChild(opt);
  });

  if (qrPisoInit && catalogoATP[qrPisoInit]) {
    selPiso.value = qrPisoInit;
    if (rolActual !== "CONTROL") {
      selPiso.disabled = true;
      selPiso.classList.add("bg-light");
    }
    cargarAreasATP();

    if (qrAreaInit) {
      const selArea = document.getElementById("atpArea");
      selArea.value = qrAreaInit;
      if (rolActual !== "CONTROL") {
        selArea.disabled = true;
        selArea.classList.add("bg-light");
      }
      alCambiarAreaATP();
    }
  } else if (rolActual === "CONTROL" && listaPisos.length > 0) {
    selPiso.disabled = false;
    selPiso.classList.remove("bg-light");
    selPiso.value = listaPisos[0];
    cargarAreasATP();
  } else {
    cargarAreasATP();
  }
}

function detectarModeloATP(rawTipo) {
  const t = (rawTipo || "SEMICRITICA").toUpperCase().trim();
  if (t.includes("BANO") || t.includes("BAÑO")) return "BANOS";
  if (t.includes("NO CRITICA") || t.includes("NO CRÍTICA") || t.includes("NOCRITICA") || t.includes("NO_CRITICA")) return "NOCRITICA";
  if (t.includes("SEMI")) return "SEMICRITICA";
  if (t.includes("CRITICA") || t.includes("CRÍTICA")) return "CRITICA";
  return "SEMICRITICA";
}

function cargarAreasATP() {
  const piso = document.getElementById("atpPiso").value;
  const selArea = document.getElementById("atpArea");
  selArea.innerHTML = '<option value="">Seleccione el área...</option>';

  if (!piso || !catalogoATP[piso]) {
    selArea.disabled = true;
    alCambiarAreaATP();
    return;
  }

  catalogoATP[piso].forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.area;
    opt.textContent = item.area;
    const modNorm = detectarModeloATP(item.tipo);
    opt.dataset.tipo = modNorm;
    opt.dataset.umbral = item.umbral || (modNorm === "CRITICA" ? 15 : 45);
    opt.dataset.areaId = item.id || "";
    selArea.appendChild(opt);
  });

  if (rolActual === "CONTROL" || !qrAreaInit) {
    selArea.disabled = false;
    selArea.classList.remove("bg-light");
    if (rolActual === "CONTROL" && !qrAreaInit && catalogoATP[piso].length > 0) {
      selArea.value = catalogoATP[piso][0].area;
    }
  }
  alCambiarAreaATP();
}

function alCambiarAreaATP() {
  const selArea = document.getElementById("atpArea");
  const opt = selArea.options[selArea.selectedIndex];
  const badge = document.getElementById("badgeClasificacionArea");
  const selPuntos = document.getElementById("atpPuntoSelect");

  if (!opt || !opt.value) {
    badge.className = "badge bg-secondary p-2";
    badge.innerText = "Esperando selección de área...";
    selPuntos.innerHTML = '<option value="">Seleccione primero el área...</option>';
    return;
  }

  const tipo = detectarModeloATP(opt.dataset.tipo);
  umbralActivo = parseInt(opt.dataset.umbral, 10) || (tipo === "CRITICA" ? 15 : 45);

  if (tipo === "CRITICA") {
    badge.className = "badge bg-danger p-2";
    badge.innerText = `ÁREA CRÍTICA — Límite estricto: ≤ ${umbralActivo} RLU`;
  } else if (tipo === "BANOS") {
    badge.className = "badge bg-primary p-2";
    badge.innerText = `BATERÍAS SANITARIAS — Límite: ≤ ${umbralActivo} RLU`;
  } else if (tipo === "NOCRITICA") {
    badge.className = "badge bg-success p-2";
    badge.innerText = `ÁREA NO CRÍTICA — Límite: ≤ ${umbralActivo} RLU`;
  } else {
    badge.className = "badge bg-warning text-dark p-2";
    badge.innerText = `ÁREA SEMICRÍTICA — Límite: ≤ ${umbralActivo} RLU`;
  }

  const listaPuntos = PUNTOS_SUGERIDOS[tipo] || PUNTOS_SUGERIDOS.SEMICRITICA;
  selPuntos.innerHTML = '<option value="">Seleccione superficie o punto...</option>';
  listaPuntos.forEach(p => {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = p;
    selPuntos.appendChild(o);
  });

  const optOtro = document.createElement("option");
  optOtro.value = "OTRO";
  optOtro.textContent = "➕ OTRO PUNTO ESPECÍFICO (Escribir manualmente...)";
  selPuntos.appendChild(optOtro);

  verificarOtroPunto();
  evaluarRLUEnVivo();
}

function verificarOtroPunto() {
  const val = document.getElementById("atpPuntoSelect").value;
  const inputOtro = document.getElementById("atpPuntoOtro");
  if (val === "OTRO") {
    inputOtro.style.display = "block";
    inputOtro.required = true;
    inputOtro.focus();
  } else {
    inputOtro.style.display = "none";
    inputOtro.required = false;
    inputOtro.value = "";
  }
}

function evaluarRLUEnVivo() {
  const valStr = document.getElementById("atpValorRLU").value;
  const box = document.getElementById("indicadorResultado");

  if (valStr === "" || isNaN(valStr)) {
    box.className = "estado-box bg-light text-muted border";
    box.innerText = "Ingrese el valor RLU para evaluar";
    return;
  }

  const rlu = parseInt(valStr, 10);
  if (rlu <= umbralActivo) {
    box.className = "estado-box estado-aprobado";
    box.innerText = `✓ APROBADO (${rlu} RLU ≤ ${umbralActivo} RLU) — Superficie Biosegura`;
  } else {
    box.className = "estado-box estado-rechazado";
    box.innerText = `✕ RECHAZADO (${rlu} RLU > ${umbralActivo} RLU) — Requiere Re-limpieza Inmediata`;
  }
}

function previsualizarYComprimirFoto(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement("canvas");
      const maxDim = 1000;
      let width = img.width;
      let height = img.height;

      if (width > height && width > maxDim) {
        height *= maxDim / width;
        width = maxDim;
      } else if (height > maxDim) {
        width *= maxDim / height;
        height = maxDim;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Sello de agua automático con fecha y hora de captura en la esquina inferior
      const sello = new Date().toLocaleString("es-EC");
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      ctx.fillRect(0, height - 28, width, 28);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px Arial";
      ctx.fillText(`CLEANINGS ATP | ${sello}`, 10, height - 9);

      // Guardamos el DataURL Base64 para la vista previa y como respaldo si no hay internet
      dataUrlFotoComprimida = canvas.toDataURL("image/jpeg", 0.72);
      document.getElementById("imgPreview").src = dataUrlFotoComprimida;
      document.getElementById("boxPreviewFoto").style.display = "block";

      canvas.toBlob(
        blob => {
          archivoFotoComprimida = blob;
        },
        "image/jpeg",
        0.72
      );
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Busca en Supabase quién fue el último auxiliar que realizó una Limpieza Terminal (DT)
 * en esta área (independientemente de la fecha) para vincularle el hisopado ATP.
 */
async function buscarUltimoAuxiliarDelArea(contratoUUID, piso, area) {
  if (!navigator.onLine || !contratoUUID) {
    return "PENDIENTE VINCULAR (OFFLINE)";
  }
  try {
    const { data, error } = await supabase
      .from("trazabilidad_registros_limpieza")
      .select("auxiliar_nombre, fecha_registro, hora_registro")
      .eq("contrato_id", contratoUUID)
      .eq("piso", piso)
      .eq("nombre_area", area)
      .ilike("tipo_limpieza", "%Terminal%")
      .order("fecha_registro", { ascending: false })
      .order("hora_registro", { ascending: false })
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0 && data[0].auxiliar_nombre) {
      return data[0].auxiliar_nombre;
    }
    return "SIN DT PREVIA EN EL ÁREA";
  } catch (e) {
    return "PENDIENTE VINCULAR (OFFLINE)";
  }
}

async function enviarATP(e) {
  e.preventDefault();
  const btn = document.getElementById("btnGuardarATP");
  const codContrato = document.getElementById("atpContrato").value || qrContratoInit;
  const infoContrato = mapaContratos[codContrato];

  const piso = document.getElementById("atpPiso").value || qrPisoInit;
  const selArea = document.getElementById("atpArea");
  const optArea = selArea.options[selArea.selectedIndex];
  const area = selArea.value || qrAreaInit;

  if (!infoContrato || !piso || !area) {
    alert("Seleccione Contrato, Piso y Área.");
    return;
  }

  if (!archivoFotoComprimida && !dataUrlFotoComprimida) {
    alert("Debe capturar la fotografía de evidencia del luminómetro.");
    return;
  }

  const puntoSel = document.getElementById("atpPuntoSelect").value;
  const puntoFinal = (puntoSel === "OTRO"
    ? document.getElementById("atpPuntoOtro").value
    : puntoSel
  ).trim().toUpperCase();

  const valorRLU = parseInt(document.getElementById("atpValorRLU").value, 10);
  const estado = valorRLU <= umbralActivo
    ? "APROBADO (Superficie Segura)"
    : "RECHAZADO (Requiere Re-limpieza)";

  // Fecha y hora local de Ecuador (sin desfase UTC después de las 19:00)
  const ahora = new Date();
  const fechaISO =
    ahora.getFullYear() + "-" +
    String(ahora.getMonth() + 1).padStart(2, "0") + "-" +
    String(ahora.getDate()).padStart(2, "0");
  const horaStr = ahora.toTimeString().split(" ")[0];

  btn.disabled = true;
  btn.innerText = "Procesando evidencia y guardando hisopado...";

  try {
    let urlFotoPublica = "PENDIENTE_OFFLINE";
    const pathSugerido = `${codContrato}/${fechaISO}/atp_${Date.now()}.jpg`;

    // 1. Si hay internet, intentamos subir la foto al Storage y buscar el auxiliar de la última DT
    if (navigator.onLine && archivoFotoComprimida) {
      try {
        urlFotoPublica = await subirFotoEvidenciaATP(archivoFotoComprimida, codContrato);
      } catch (errStorage) {
        console.warn("Fallo subida directa de foto, se encolará en Base64 para sincronización:", errStorage.message);
        urlFotoPublica = "PENDIENTE_OFFLINE";
      }
    }

    const ultimoAuxiliar = await buscarUltimoAuxiliarDelArea(infoContrato.id, piso, area);

    const payloadATP = {
      contrato_id: infoContrato.id,
      area_id: optArea && optArea.dataset.areaId ? optArea.dataset.areaId : null,
      auditor_id: auditorIdActual,
      auditor_nombre: document.getElementById("atpResponsable").value.trim().toUpperCase(),
      piso: piso,
      nombre_area: area,
      punto_muestreado: puntoFinal,
      lectura_rlu: valorRLU,
      umbral_aplicado: umbralActivo,
      estado_atp: estado,
      auxiliar_vinculado_nombre: ultimoAuxiliar,
      responsable_cliente: document.getElementById("atpResponsableArea").value.trim().toUpperCase(),
      observaciones: document.getElementById("atpObservaciones").value.trim() || "Conforme con estándar (Limpieza Óptima)",
      foto_evidencia_url: urlFotoPublica,
      fecha_registro: fechaISO,
      hora_registro: horaStr,
      _codigo_contrato_qr: codContrato,
      _foto_base64_offline: urlFotoPublica === "PENDIENTE_OFFLINE" ? dataUrlFotoComprimida : null,
      _foto_path_offline: pathSugerido
    };

    const resultado = await insertarConRespaldoOffline(
      "trazabilidad_registros_atp",
      payloadATP,
      `ATP ${area} - ${puntoFinal} (${valorRLU} RLU)`
    );

    btn.disabled = false;
    btn.innerText = "🔬 Guardar Muestra de Luminometría ATP";

    document.getElementById("resAtpUbicacion").innerText = `${infoContrato.nombre_cliente} | ${piso} - ${area}`;
    document.getElementById("resAtpPunto").innerText = puntoFinal;
    document.getElementById("resAtpLectura").innerText = `${valorRLU} RLU (Límite: ≤ ${umbralActivo} RLU)`;
    document.getElementById("resAtpEstado").innerText = resultado.modoOffline
      ? `${estado} — 📦 GUARDADO EN TELÉFONO (Pendiente de red)`
      : estado;
    document.getElementById("resAtpEstado").className =
      valorRLU <= umbralActivo ? "fw-bold text-success" : "fw-bold text-danger";
    document.getElementById("resAtpAuxiliar").innerText = ultimoAuxiliar;
    document.getElementById("resAtpRespArea").innerText =
      document.getElementById("atpResponsableArea").value.trim().toUpperCase();

    const linkFoto = document.getElementById("resAtpFotoLink");
    if (resultado.modoOffline || urlFotoPublica === "PENDIENTE_OFFLINE") {
      linkFoto.href = dataUrlFotoComprimida;
      linkFoto.innerText = "Ver Fotografía Capturada (En Memoria Local) ↗";
    } else {
      linkFoto.href = urlFotoPublica;
      linkFoto.innerText = "Ver Fotografía en la Nube ↗";
    }

    document.getElementById("boxFormularioATP").style.display = "none";
    document.getElementById("boxExitoATP").style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });

  } catch (err) {
    btn.disabled = false;
    btn.innerText = "🔬 Guardar Muestra de Luminometría ATP";
    alert("Error al guardar muestra ATP: " + err.message);
  }
}

function registrarOtraMuestraMismaArea() {
  document.getElementById("boxExitoATP").style.display = "none";
  document.getElementById("boxFormularioATP").style.display = "block";

  document.getElementById("atpPuntoSelect").value = "";
  document.getElementById("atpPuntoOtro").value = "";
  document.getElementById("atpPuntoOtro").style.display = "none";
  document.getElementById("atpValorRLU").value = "";
  document.getElementById("atpObservaciones").value = "";
  document.getElementById("atpFotoInput").value = "";
  document.getElementById("boxPreviewFoto").style.display = "none";
  archivoFotoComprimida = null;
  dataUrlFotoComprimida = null;

  evaluarRLUEnVivo();
  window.scrollTo({ top: 0, behavior: "smooth" });
}