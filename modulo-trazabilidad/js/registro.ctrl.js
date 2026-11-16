// =====================================================================
// ARCHIVO: modulo-trazabilidad/js/registro.ctrl.js
// Controlador del Formulario de Registro Diario de Limpieza (CL-OP-0030)
// Incluye: CRÍTICA (15 RLU), SEMICRÍTICA (45 RLU), NO CRÍTICA (45 RLU), BAÑOS (45 RLU)
// Seguridad: Auxiliares/Supervisores SOLO por QR fijo; CONTROL libre para pruebas.
// Blindaje Offline-First: Caché de Catálogos + Cola de Sincronización Local
// =====================================================================
import { supabase } from "../../core/supabaseClient.js";
import {
  obtenerParametrosURL,
  obtenerSesionActiva,
  homologarRol,
  navegarAVista,
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

// CATÁLOGO EXACTO DE ÍTEMS POR MODELO (Incluye NO CRÍTICA idéntica a SEMICRÍTICA)
const CATALOGO_ITEMS = {
  CRITICA: [
    { id: "techos", label: "Techos" },
    { id: "paredes", label: "Paredes" },
    { id: "pisos", label: "Pisos" },
    { id: "lavamanos", label: "Lavamanos" },
    { id: "cielitica", label: "Lámpara Cielítica" },
    { id: "puertas", label: "Puertas" },
    { id: "vidrios", label: "Vidrios" },
    { id: "camillas", label: "Camillas" },
    { id: "mobiliario", label: "Mesas Mayo / Carros" },
    { id: "banos", label: "Batería Sanitaria" },
    { id: "dispensadores", label: "Dispensadores" },
    { id: "sillas", label: "Sillas" }
  ],
  BANOS: [
    { id: "inodoro", label: "Inodoro" },
    { id: "urinario", label: "Urinario" },
    { id: "lavamanos", label: "Lavamanos" },
    { id: "paredes_d_b", label: "Paredes Divisorias" },
    { id: "espejos", label: "Espejos" },
    { id: "pisos", label: "Pisos" },
    { id: "paredes", label: "Paredes" },
    { id: "techos", label: "Techos" },
    { id: "puertas", label: "Puertas" },
    { id: "ventanas", label: "Ventanas" },
    { id: "control_p", label: "Control de Papel Higiénico" },
    { id: "control_t", label: "Control de Papel Toalla" },
    { id: "dispensadores", label: "Control de Dispensadores" }
  ],
  SEMICRITICA: [
    { id: "techos", label: "Techos" },
    { id: "paredes", label: "Paredes" },
    { id: "pisos", label: "Pisos" },
    { id: "lavamanos", label: "Lavamanos" },
    { id: "ventanas", label: "Ventanas" },
    { id: "puertas", label: "Puertas" },
    { id: "vidrios", label: "Vidrios" },
    { id: "camillas", label: "Camillas" },
    { id: "mobiliario", label: "Mobiliario General" },
    { id: "banos", label: "Baño Anexo" },
    { id: "dispensadores", label: "Dispensadores" },
    { id: "sillas", label: "Sillas" }
  ],
  NOCRITICA: [
    { id: "techos", label: "Techos" },
    { id: "paredes", label: "Paredes" },
    { id: "pisos", label: "Pisos" },
    { id: "lavamanos", label: "Lavamanos" },
    { id: "ventanas", label: "Ventanas" },
    { id: "puertas", label: "Puertas" },
    { id: "vidrios", label: "Vidrios" },
    { id: "camillas", label: "Camillas" },
    { id: "mobiliario", label: "Mobiliario General" },
    { id: "banos", label: "Baño Anexo" },
    { id: "dispensadores", label: "Dispensadores" },
    { id: "sillas", label: "Sillas" }
  ]
};

let catalogoGlobal = {};
let auxiliarActual = "Personal Operativo";
let usuarioIdActual = null;
let rolActual = "AUXILIAR";
let contratoFijo = "";
let pisoActivoFijo = "";
let areaActivaFija = "";
let mapaContratos = {};
let vienePorQR = false;

document.addEventListener("DOMContentLoaded", async () => {
  // Activar monitor de conexión y cola de sincronización en segundo plano
  inicializarMonitorOffline();

  const urlParams = obtenerParametrosURL();
  const sesion = obtenerSesionActiva();

  rolActual = homologarRol(urlParams.rol || (sesion ? sesion.rol : "AUXILIAR"));
  auxiliarActual = urlParams.usuario || (sesion ? (sesion.nombre || sesion.nombre_completo) : "Personal Operativo");
  usuarioIdActual = sesion ? (sesion.id || sesion.usuario_id || null) : null;

  contratoFijo = (urlParams.contrato || (sesion ? sesion.qrContrato : "") || "").trim();
  pisoActivoFijo = (urlParams.piso || (sesion ? sesion.qrPiso : "") || "").trim();
  areaActivaFija = (urlParams.area || (sesion ? sesion.qrArea : "") || "").trim();

  // Detectamos si el ingreso proviene de un QR físico de puerta (tiene piso y área predefinidos)
  vienePorQR = Boolean(contratoFijo && pisoActivoFijo && areaActivaFija);

  document.getElementById("lblRolIndicador").innerText = "Perfil: " + rolActual;
  document.getElementById("lblAuxiliar").innerText = auxiliarActual;

  // Enlazar eventos
  document.getElementById("btnVolverMenu").addEventListener("click", () => {
    navegarAVista("panel.html", document.getElementById("selContrato").value);
  });
  document.getElementById("selContrato").addEventListener("change", () => {
    // Si CONTROL cambia manualmente de contrato, liberamos piso/área fijos para que pueda probar cualquier área
    if (rolActual === "CONTROL") {
      pisoActivoFijo = "";
      areaActivaFija = "";
    }
    alCambiarContrato();
  });
  document.getElementById("selPiso").addEventListener("change", alCambiarPiso);
  document.getElementById("selArea").addEventListener("change", alCambiarArea);
  document.getElementById("btnMarcarTodos").addEventListener("click", () => marcarTodos(true));
  document.getElementById("btnDesmarcarTodos").addEventListener("click", () => marcarTodos(false));
  document.getElementById("formRegistro").addEventListener("submit", guardarRegistro);
  document.getElementById("btnNuevoRegistro").addEventListener("click", volverARegistrarNuevo);

  // REGLA ESTRICTA: Si NO es CONTROL y NO entró escaneando el QR de un área, bloquear el formulario
  if (rolActual !== "CONTROL" && !vienePorQR) {
    bloquearAccesoSinQR();
    return;
  }

  await inicializarContratosYCatalogo();
});

function bloquearAccesoSinQR() {
  document.getElementById("selContrato").innerHTML = '<option value="">⛔ Requiere escaneo de QR de puerta</option>';
  document.getElementById("selContrato").disabled = true;
  document.getElementById("selPiso").disabled = true;
  document.getElementById("selArea").disabled = true;
  document.getElementById("btnGuardar").disabled = true;
  document.getElementById("contenedorChecklist").innerHTML = `
    <div class="col-12 text-center py-4 text-danger fw-bold bg-light rounded-3 border border-danger">
      ⛔ ACCESO RESTRINGIDO A ESCANEO QR<br>
      <small class="text-muted fw-normal">Para registrar una limpieza debe escanear con su celular el código QR físico ubicado en la puerta del área asignada.</small>
    </div>
  `;
}

async function inicializarContratosYCatalogo() {
  const selContrato = document.getElementById("selContrato");
  selContrato.innerHTML = '<option value="">Cargando contratos...</option>';

  let contratos = [];

  try {
    if (navigator.onLine) {
      // Consulta directa de todos los contratos activos en Supabase (evita bloqueos si CONTROL no tiene fila en tabla puente)
      const { data, error } = await supabase
        .from("trazabilidad_contratos")
        .select("id, codigo_contrato, nombre_cliente")
        .eq("activo", true)
        .order("nombre_cliente", { ascending: true });

      if (!error && data) {
        contratos = data;
        guardarCacheContratos(contratos);
      }
    }
  } catch (err) {
    console.warn("Sin conexión a Supabase, usando caché local de contratos:", err.message);
  }

  // Si no hubo internet, recuperamos la lista de contratos desde la memoria interna del teléfono
  if (contratos.length === 0) {
    contratos = obtenerCacheContratos();
  }

  // Respaldo de emergencia si el teléfono entra por primera vez sin señal escaneando un QR
  if (contratos.length === 0 && contratoFijo) {
    contratos = [{ id: null, codigo_contrato: contratoFijo, nombre_cliente: contratoFijo }];
  }

  selContrato.innerHTML = '<option value="">Seleccione contrato...</option>';
  contratos.forEach(c => {
    mapaContratos[c.codigo_contrato] = c;
    const opt = document.createElement("option");
    opt.value = c.codigo_contrato;
    opt.textContent = `${c.nombre_cliente} (${c.codigo_contrato})`;
    selContrato.appendChild(opt);
  });

  if (contratoFijo && mapaContratos[contratoFijo]) {
    selContrato.value = contratoFijo;
  } else if (contratos.length > 0) {
    selContrato.value = contratos[0].codigo_contrato;
  }

  await alCambiarContrato();
}

async function alCambiarContrato() {
  const codContrato = document.getElementById("selContrato").value;
  const infoContrato = mapaContratos[codContrato];
  document.getElementById("lblSubtituloContrato").innerText = infoContrato
    ? `Estándar CL-OP-0030 | ${infoContrato.nombre_cliente}`
    : "Estándar CL-OP-0030";

  catalogoGlobal = {};
  if (navigator.onLine) {
    try {
      catalogoGlobal = await obtenerMapaPisosAreasPorContrato(codContrato);
      guardarCacheCatalogoAreas(codContrato, catalogoGlobal);
    } catch (e) {
      catalogoGlobal = obtenerCacheCatalogoAreas(codContrato);
    }
  } else {
    catalogoGlobal = obtenerCacheCatalogoAreas(codContrato);
  }

  // Si el teléfono nunca había descargado el catálogo de este contrato y está en modo offline frente a una puerta QR
  if (Object.keys(catalogoGlobal).length === 0 && pisoActivoFijo && areaActivaFija) {
    catalogoGlobal[pisoActivoFijo] = [
      { id: null, area: areaActivaFija, tipo: "SEMICRITICA", umbral: 45 }
    ];
  }

  const selPiso = document.getElementById("selPiso");
  selPiso.innerHTML = '<option value="">Seleccione piso...</option>';

  const listaPisos = Object.keys(catalogoGlobal);
  listaPisos.forEach(piso => {
    const opt = document.createElement("option");
    opt.value = piso;
    opt.textContent = piso;
    selPiso.appendChild(opt);
  });

  // Si viene con piso fijo por QR (o precargado), lo selecciona; si es CONTROL en modo prueba, autoselecciona el primer piso para agilizar
  if (pisoActivoFijo && catalogoGlobal[pisoActivoFijo]) {
    selPiso.value = pisoActivoFijo;
    alCambiarPiso();
    if (areaActivaFija) {
      const selArea = document.getElementById("selArea");
      selArea.value = areaActivaFija;
      alCambiarArea();
    }
  } else if (rolActual === "CONTROL" && listaPisos.length > 0) {
    selPiso.value = listaPisos[0];
    alCambiarPiso();
  } else {
    alCambiarPiso();
  }

  aplicarSeguridadSelectores();
}

function aplicarSeguridadSelectores() {
  const selContrato = document.getElementById("selContrato");
  const selPiso = document.getElementById("selPiso");
  const selArea = document.getElementById("selArea");

  // ROL CONTROL: Libertad total para seleccionar Contrato, Piso y Área en pruebas
  if (rolActual === "CONTROL") {
    selContrato.disabled = false;
    selPiso.disabled = false;
    selContrato.classList.remove("campo-bloqueado");
    selPiso.classList.remove("campo-bloqueado");

    if (selPiso.value) {
      selArea.disabled = false;
      selArea.classList.remove("campo-bloqueado");
    } else {
      selArea.disabled = true;
    }
    return;
  }

  // AUXILIAR / SUPERVISOR: Candado estricto al QR escaneado (precargado e inmodificable)
  selContrato.disabled = true;
  selPiso.disabled = true;
  selArea.disabled = true;
  selContrato.classList.add("campo-bloqueado");
  selPiso.classList.add("campo-bloqueado");
  selArea.classList.add("campo-bloqueado");
}

function alCambiarPiso() {
  const piso = document.getElementById("selPiso").value;
  const selArea = document.getElementById("selArea");
  selArea.innerHTML = '<option value="">Seleccione el área...</option>';

  if (!piso || !catalogoGlobal[piso]) {
    selArea.disabled = true;
    document.getElementById("contenedorChecklist").innerHTML =
      '<div class="col-12 text-center py-4 text-muted small bg-light rounded-3 border">Seleccione un piso y un área para desplegar el checklist correspondiente.</div>';
    return;
  }

  catalogoGlobal[piso].forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.area;
    opt.textContent = item.area;
    opt.dataset.tipo = item.tipo;
    opt.dataset.areaId = item.id || "";
    selArea.appendChild(opt);
  });

  if (rolActual === "CONTROL") {
    selArea.disabled = false;
    selArea.classList.remove("campo-bloqueado");
    // Si no hay área fija por QR y hay áreas en el piso, autoselecciona la primera para mostrar el checklist de inmediato
    if (!areaActivaFija && catalogoGlobal[piso].length > 0) {
      selArea.value = catalogoGlobal[piso][0].area;
      alCambiarArea();
    }
  }
}

function detectarModeloNormalizado(rawTipo) {
  const t = (rawTipo || "SEMICRITICA").toUpperCase().trim();
  if (t.includes("BANO") || t.includes("BAÑO")) return "BANOS";
  if (t.includes("NO CRITICA") || t.includes("NO CRÍTICA") || t.includes("NOCRITICA") || t.includes("NO_CRITICA")) return "NOCRITICA";
  if (t.includes("SEMI")) return "SEMICRITICA";
  if (t.includes("CRITICA") || t.includes("CRÍTICA")) return "CRITICA";
  return "SEMICRITICA";
}

function alCambiarArea() {
  const selArea = document.getElementById("selArea");
  const opt = selArea.options[selArea.selectedIndex];
  if (!opt || !opt.value) return;

  const modeloClave = detectarModeloNormalizado(opt.dataset.tipo);
  const badge = document.getElementById("badgeModelo");

  if (modeloClave === "CRITICA") {
    badge.innerText = "MODELO: CRÍTICA (15 RLU)";
    badge.className = "badge bg-danger badge-modelo";
  } else if (modeloClave === "BANOS") {
    badge.innerText = "MODELO: BAÑOS (45 RLU)";
    badge.className = "badge bg-warning text-dark badge-modelo";
  } else if (modeloClave === "NOCRITICA") {
    badge.innerText = "MODELO: NO CRÍTICA (45 RLU)";
    badge.className = "badge bg-success badge-modelo";
  } else {
    badge.innerText = "MODELO: SEMICRÍTICA (45 RLU)";
    badge.className = "badge bg-primary badge-modelo";
  }

  renderizarChecklist(modeloClave);
}

function renderizarChecklist(modeloClave) {
  const items = CATALOGO_ITEMS[modeloClave] || CATALOGO_ITEMS["SEMICRITICA"];
  const contenedor = document.getElementById("contenedorChecklist");
  let html = "";

  items.forEach(it => {
    html += `
      <div class="col-12 col-md-6">
        <label class="check-item" for="chk_${it.id}">
          <span class="fw-semibold text-dark small">${it.label}</span>
          <input type="checkbox" id="chk_${it.id}" name="chk_${it.id}">
        </label>
      </div>
    `;
  });
  contenedor.innerHTML = html;
}

function marcarTodos(estado) {
  const checks = document.querySelectorAll("#contenedorChecklist input[type='checkbox']");
  checks.forEach(c => (c.checked = estado));
}

async function guardarRegistro(e) {
  e.preventDefault();
  const btn = document.getElementById("btnGuardar");
  const codContrato = document.getElementById("selContrato").value || contratoFijo;
  const infoContrato = mapaContratos[codContrato];
  const selPiso = document.getElementById("selPiso");
  const selArea = document.getElementById("selArea");
  const optArea = selArea.options[selArea.selectedIndex];

  const pisoVal = selPiso.value || pisoActivoFijo;
  const areaVal = selArea.value || areaActivaFija;

  if (!infoContrato || !pisoVal || !areaVal) {
    alert("Por favor asegúrese de tener seleccionado un Contrato, Piso y Área.");
    return;
  }

  const modeloClave = detectarModeloNormalizado(optArea ? optArea.dataset.tipo : "SEMICRITICA");
  const areaUUID = optArea && optArea.dataset.areaId ? optArea.dataset.areaId : null;

  const checks = document.querySelectorAll("#contenedorChecklist input[type='checkbox']");
  const checklistObj = {};
  let marcadosSi = 0;

  checks.forEach(chk => {
    const key = chk.id.replace("chk_", "");
    const valor = chk.checked ? "SI" : "NO";
    checklistObj[key] = valor;
    if (chk.checked) marcadosSi++;
  });

  const totalItems = checks.length || 1;
  const pctCumplimiento = Number(((marcadosSi / totalItems) * 100).toFixed(2));

  const ahora = new Date();
  const fechaISO = ahora.getFullYear() + "-" + String(ahora.getMonth() + 1).padStart(2, "0") + "-" + String(ahora.getDate()).padStart(2, "0");
  const horaStr = ahora.toTimeString().split(" ")[0];

  const payloadRegistro = {
    contrato_id: infoContrato.id,
    area_id: areaUUID,
    auxiliar_id: usuarioIdActual,
    auxiliar_nombre: auxiliarActual,
    piso: pisoVal,
    nombre_area: areaVal,
    modelo_area: modeloClave,
    tipo_limpieza: document.getElementById("selTipo").value,
    checklist: checklistObj,
    porcentaje_cumplimiento: pctCumplimiento,
    observaciones: document.getElementById("txtObservaciones").value.trim() || "Sin novedades",
    revisado_por_nombre: "PENDIENTE",
    fecha_registro: fechaISO,
    hora_registro: horaStr,
    _codigo_contrato_qr: codContrato // Respaldo para resolver UUID si se guardó 100% sin señal
  };

  btn.disabled = true;
  btn.innerText = "Guardando...";

  try {
    const resultado = await insertarConRespaldoOffline(
      "trazabilidad_registros_limpieza",
      payloadRegistro,
      `Limpieza ${areaVal} (${horaStr})`
    );

    btn.disabled = false;
    btn.innerText = "💾 Registrar Limpieza";

    document.getElementById("resContrato").innerText = infoContrato.nombre_cliente;
    document.getElementById("resFecha").innerText = ahora.toLocaleDateString("es-EC");
    document.getElementById("resHora").innerText = horaStr;
    document.getElementById("resAuxiliar").innerText = auxiliarActual;
    document.getElementById("resUbicacion").innerText = `${pisoVal} - ${areaVal}`;
    document.getElementById("resCumplimiento").innerText = `${pctCumplimiento}% (${marcadosSi}/${totalItems} ítems)`;
    document.getElementById("resHoja").innerText = resultado.modoOffline
      ? `📦 GUARDADO EN MEMORIA LOCAL (Se subirá al recuperar señal)`
      : `MODELO_${modeloClave}`;

    document.getElementById("moduloFormulario").style.display = "none";
    document.getElementById("moduloExito").style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });

  } catch (err) {
    btn.disabled = false;
    btn.innerText = "💾 Registrar Limpieza";
    alert("Error al guardar registro en Supabase: " + err.message);
  }
}

function volverARegistrarNuevo() {
  document.getElementById("moduloExito").style.display = "none";
  document.getElementById("moduloFormulario").style.display = "block";

  marcarTodos(false);
  document.getElementById("selTipo").value = "Concurrente";
  document.getElementById("txtObservaciones").value = "";

  if (rolActual !== "CONTROL" && pisoActivoFijo && areaActivaFija) {
    document.getElementById("selPiso").value = pisoActivoFijo;
    document.getElementById("selArea").value = areaActivaFija;
    aplicarSeguridadSelectores();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}