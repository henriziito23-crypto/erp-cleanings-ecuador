// =====================================================================
// ARCHIVO: modulo-trazabilidad/js/luminometria.ctrl.js
// Controlador de Auditoría Luminometría ATP, Compresión Foto y Cruce Auxiliar
// =====================================================================
import { supabase, subirFotoHisopadoStorage } from "../../core/supabaseClient.js";
import {
  obtenerParametrosURL,
  obtenerSesionActiva,
  homologarRol,
  navegarAVista,
  obtenerContratosAutorizados,
  obtenerMapaPisosAreasPorContrato
} from "../../core/router.js";

let catalogoATP = {};
let mapaContratos = {};
let rolActual = "SUPERVISOR";
let auditorActual = "Supervisor";
let auditorIdActual = null;
let qrContratoInit = "";
let qrPisoInit = "";
let qrAreaInit = "";
let fotoBase64Data = "";

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = obtenerParametrosURL();
  const sesion = obtenerSesionActiva();

  rolActual = homologarRol(urlParams.rol || (sesion ? sesion.rol : "SUPERVISOR"));
  auditorActual = urlParams.usuario || (sesion ? sesion.nombre : "Auditor de Calidad");
  auditorIdActual = sesion ? sesion.id : null;

  qrContratoInit = urlParams.contrato || (sesion ? sesion.qrContrato : "");
  qrPisoInit = urlParams.piso || (sesion ? sesion.qrPiso : "");
  qrAreaInit = urlParams.area || (sesion ? sesion.qrArea : "");

  document.getElementById("atpAuditor").value = auditorActual;

  // Enlazar eventos
  document.getElementById("btnVolverMenu").addEventListener("click", () => {
    navegarAVista("panel.html", document.getElementById("atpContrato").value);
  });
  document.getElementById("atpContrato").addEventListener("change", alCambiarContratoATP);
  document.getElementById("atpPiso").addEventListener("change", cargarAreasATP);
  document.getElementById("atpArea").addEventListener("change", alCambiarAreaATP);
  document.getElementById("rluMedido").addEventListener("input", evaluarEstadoATP);
  document.getElementById("fotoHisopado").addEventListener("change", procesarFoto);
  document.getElementById("formATP").addEventListener("submit", enviarATP);
  document.getElementById("btnNuevoHisopado").addEventListener("click", volverAlFormulario);

  await inicializarContratosATP();
});

async function inicializarContratosATP() {
  const selContrato = document.getElementById("atpContrato");
  selContrato.innerHTML = '<option value="">Cargando contratos...</option>';

  try {
    let contratos = [];
    if (auditorIdActual) {
      contratos = await obtenerContratosAutorizados(auditorIdActual, rolActual);
    } else {
      const { data } = await supabase
        .from("trazabilidad_contratos")
        .select("id, codigo_contrato, nombre_cliente")
        .eq("activo", true)
        .order("nombre_cliente", { ascending: true });
      contratos = data || [];
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

    await alCambiarContratoATP();
  } catch (err) {
    selContrato.innerHTML = '<option value="">Error al conectar catálogo</option>';
  }
}

async function alCambiarContratoATP() {
  const codContrato = document.getElementById("atpContrato").value;
  const infoContrato = mapaContratos[codContrato];
  document.getElementById("lblSubtituloATP").innerText = infoContrato
    ? `${infoContrato.nombre_cliente} — CL-OP-0031`
    : "Control Microbiológico de Superficies — CL-OP-0031";

  const selPiso = document.getElementById("atpPiso");
  selPiso.innerHTML = '<option value="">Cargando pisos...</option>';

  catalogoATP = await obtenerMapaPisosAreasPorContrato(codContrato);
  selPiso.innerHTML = '<option value="">Seleccione piso...</option>';

  Object.keys(catalogoATP).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    selPiso.appendChild(opt);
  });

  if (qrPisoInit && catalogoATP[qrPisoInit]) {
    selPiso.value = qrPisoInit;
    cargarAreasATP();
    if (qrAreaInit) {
      const selArea = document.getElementById("atpArea");
      selArea.value = qrAreaInit;
      alCambiarAreaATP();
    }
  } else {
    cargarAreasATP();
  }

  aplicarSeguridadRolATP();
}

function aplicarSeguridadRolATP() {
  const selContrato = document.getElementById("atpContrato");
  const selPiso = document.getElementById("atpPiso");
  const selArea = document.getElementById("atpArea");

  if (rolActual === "CONTROL") {
    selContrato.disabled = false;
    selPiso.disabled = false;
    selContrato.classList.remove("bg-light");
    selPiso.classList.remove("bg-light");
    if (selPiso.value) {
      selArea.disabled = false;
      selArea.classList.remove("bg-light");
    }
  } else {
    // SUPERVISOR / AUDITOR: Bloqueado al QR escaneado
    if (qrContratoInit) {
      selContrato.disabled = true;
      selContrato.classList.add("bg-light");
    }
    if (qrPisoInit) {
      selPiso.disabled = true;
      selPiso.classList.add("bg-light");
    }
    if (qrAreaInit) {
      selArea.disabled = true;
      selArea.classList.add("bg-light");
    }
  }
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
    opt.dataset.tipo = (item.tipo || "GENERAL").toUpperCase();
    opt.dataset.umbral = item.umbral || (item.tipo === "CRITICA" ? 15 : 45);
    opt.dataset.areaId = item.id;
    selArea.appendChild(opt);
  });

  if (rolActual === "CONTROL" || !qrAreaInit) {
    selArea.disabled = false;
    selArea.classList.remove("bg-light");
  }
  alCambiarAreaATP();
}

function alCambiarAreaATP() {
  const selArea = document.getElementById("atpArea");
  const opt = selArea.options[selArea.selectedIndex];
  const inputUmbral = document.getElementById("umbralRLU");

  if (!opt || !opt.value) {
    inputUmbral.value = 45;
    inputUmbral.readOnly = true;
    evaluarEstadoATP();
    return;
  }

  const tipoArea = (opt.dataset.tipo || "GENERAL").toUpperCase().trim();

  // Solo si es exactamente CRITICA (sin SEMI y sin NO) el límite es 15 RLU.
  // Para SEMICRITICA, NOCRITICA y BANOS el límite es 45 RLU.
  if (tipoArea === "CRITICA" || tipoArea === "CRÍTICA") {
    inputUmbral.value = 15;
  } else {
    inputUmbral.value = 45;
  }

  inputUmbral.readOnly = true;
  evaluarEstadoATP();
}

function evaluarEstadoATP() {
  const rlu = parseFloat(document.getElementById("rluMedido").value);
  const umbral = parseFloat(document.getElementById("umbralRLU").value) || 45;
  const badge = document.getElementById("badgeEstadoATP");

  if (isNaN(rlu)) {
    badge.className = "badge bg-secondary";
    badge.innerText = "- Ingrese valor RLU -";
    return;
  }

  if (rlu <= umbral) {
    badge.className = "badge-aprobado";
    badge.innerText = "✓ CONFORME / APROBADO (Superficie Segura)";
  } else {
    badge.className = "badge-rechazado";
    badge.innerText = "✗ NO CONFORME / RECHAZADO (Requiere Re-limpieza)";
  }
}

function procesarFoto(event) {
  const archivo = event.target.files[0];
  if (!archivo) {
    limpiarFotoLocal();
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      const maxDim = 1200;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      fotoBase64Data = canvas.toDataURL("image/jpeg", 0.75);
      document.getElementById("imgPreview").src = fotoBase64Data;
      document.getElementById("contenedorPreview").style.display = "block";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(archivo);
}

function limpiarFotoLocal() {
  fotoBase64Data = "";
  document.getElementById("fotoHisopado").value = "";
  document.getElementById("imgPreview").src = "";
  document.getElementById("contenedorPreview").style.display = "none";
}

/**
 * Busca automáticamente en Supabase quién fue el último auxiliar que limpió esta área hoy
 * para vincularle el resultado del hisopado ATP (Cruce Espacio-Tiempo)
 */
async function buscarUltimoAuxiliarDelArea(contratoUUID, piso, area) {
  try {
    const hoyISO = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("trazabilidad_registros_limpieza")
      .select("auxiliar_nombre")
      .eq("contrato_id", contratoUUID)
      .eq("piso", piso)
      .eq("nombre_area", area)
      .eq("fecha_registro", hoyISO)
      .order("hora_registro", { ascending: false })
      .limit(1);

    if (data && data.length > 0 && data[0].auxiliar_nombre) {
      return data[0].auxiliar_nombre;
    }
    return "SIN REGISTRO PREVIO HOY";
  } catch (e) {
    return "NO VINCULADO";
  }
}

async function enviarATP(e) {
  e.preventDefault();

  const codContrato = document.getElementById("atpContrato").value || qrContratoInit;
  const infoContrato = mapaContratos[codContrato];
  const pisoVal = document.getElementById("atpPiso").value || qrPisoInit;
  const selArea = document.getElementById("atpArea");
  const areaVal = selArea.value || qrAreaInit;
  const optArea = selArea.options[selArea.selectedIndex];
  const areaUUID = optArea ? optArea.dataset.areaId : null;

  const puntoVal = document.getElementById("puntoMuestreo").value.trim();
  const respClienteVal = document.getElementById("atpResponsableCliente").value.trim();
  const rluInput = document.getElementById("rluMedido").value;

  if (!infoContrato || !pisoVal || !areaVal) {
    alert("Por favor selecciona Contrato, Piso y Área inspeccionada.");
    return;
  }
  if (!respClienteVal) {
    alert("Por favor ingresa el Responsable por parte del Cliente.");
    document.getElementById("atpResponsableCliente").focus();
    return;
  }
  if (!puntoVal) {
    alert("Por favor ingresa el Punto Crítico Muestreado.");
    document.getElementById("puntoMuestreo").focus();
    return;
  }
  if (rluInput === "" || isNaN(parseFloat(rluInput))) {
    alert("Por favor ingresa una lectura RLU válida.");
    document.getElementById("rluMedido").focus();
    return;
  }

  const btn = document.getElementById("btnGuardarATP");
  btn.disabled = true;
  btn.innerText = "Guardando auditoría y evidencia en Supabase...";

  const rlu = parseInt(rluInput, 10);
  const umbral = parseInt(document.getElementById("umbralRLU").value, 10) || 45;
  const estado = rlu <= umbral ? "APROBADO" : "RECHAZADO";

  const obsInput = document.getElementById("atpObservaciones").value.trim();
  const obsFinal = obsInput || (estado === "APROBADO"
    ? "Conforme con estándar (Limpieza Óptima)"
    : "Re-limpieza y desinfección mecánica inmediata");

  try {
    // 1. Subir foto comprimida al Bucket de Supabase Storage (si adjuntó foto)
    let urlFotoPublica = "";
    if (fotoBase64Data) {
      urlFotoPublica = await subirFotoHisopadoStorage(fotoBase64Data, codContrato, areaVal);
    }

    // 2. Vincular automáticamente con el último auxiliar que limpió esa área hoy
    const auxiliarVinculado = await buscarUltimoAuxiliarDelArea(infoContrato.id, pisoVal, areaVal);

    const ahora = new Date();
    const fechaISO = ahora.toISOString().split("T")[0];
    const horaStr = ahora.toTimeString().split(" ")[0];

    // 3. Insertar registro en trazabilidad_registros_atp
    const { error } = await supabase
      .from("trazabilidad_registros_atp")
      .insert([{
        contrato_id: infoContrato.id,
        area_id: areaUUID,
        auditor_id: auditorIdActual,
        auditor_nombre: auditorActual,
        auxiliar_vinculado_nombre: auxiliarVinculado,
        piso: pisoVal,
        nombre_area: areaVal,
        punto_muestreo: puntoVal,
        rlu_medido: rlu,
        umbral_aplicado: umbral,
        estado: estado,
        responsable_cliente: respClienteVal,
        observaciones_accion: obsFinal,
        foto_url: urlFotoPublica,
        fecha_registro: fechaISO,
        hora_registro: horaStr
      }]);

    if (error) throw error;

    btn.disabled = false;
    btn.innerText = "🧪 Registrar Auditoría ATP";

    // Poblar tarjeta de confirmación exitosa
    document.getElementById("lblConfContrato").innerText = infoContrato.nombre_cliente;
    document.getElementById("lblConfFecha").innerText = ahora.toLocaleDateString("es-EC");
    document.getElementById("lblConfHora").innerText = horaStr;
    document.getElementById("lblConfAuditor").innerText = auditorActual;
    document.getElementById("lblConfAuxiliarVinculado").innerText = auxiliarVinculado;
    document.getElementById("lblConfResponsableCliente").innerText = respClienteVal;
    document.getElementById("lblConfUbicacion").innerText = `${pisoVal} - ${areaVal}`;
    document.getElementById("lblConfPunto").innerText = puntoVal;

    const lblRes = document.getElementById("lblConfResultado");
    lblRes.innerText = `${rlu} RLU (${estado})`;
    lblRes.className = estado === "APROBADO" ? "fw-bold text-success" : "fw-bold text-danger";

    const rowFoto = document.getElementById("rowConfFoto");
    const linkFoto = document.getElementById("linkConfFoto");
    if (urlFotoPublica && urlFotoPublica.startsWith("http")) {
      linkFoto.href = urlFotoPublica;
      rowFoto.style.display = "flex";
    } else {
      rowFoto.style.display = "none";
    }

    document.getElementById("vistaFormulario").style.display = "none";
    document.getElementById("vistaExito").style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });

  } catch (err) {
    btn.disabled = false;
    btn.innerText = "🧪 Registrar Auditoría ATP";
    alert("Error al registrar hisopado en Supabase: " + err.message);
  }
}

function volverAlFormulario() {
  document.getElementById("puntoMuestreo").value = "";
  document.getElementById("rluMedido").value = "";
  document.getElementById("atpObservaciones").value = "";
  document.getElementById("atpResponsableCliente").value = "";
  limpiarFotoLocal();

  if (rolActual !== "CONTROL") {
    if (qrPisoInit) document.getElementById("atpPiso").value = qrPisoInit;
    if (qrAreaInit) document.getElementById("atpArea").value = qrAreaInit;
  }

  alCambiarAreaATP();
  document.getElementById("vistaExito").style.display = "none";
  document.getElementById("vistaFormulario").style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}