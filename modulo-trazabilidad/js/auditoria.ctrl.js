// =====================================================================
// ARCHIVO: modulo-trazabilidad/js/auditoria.ctrl.js
// Controlador de Sábana de Auditoría A4, Hisopados y Firmas Jerárquicas
// =====================================================================
import { supabase } from "../../core/supabaseClient.js";
import {
  obtenerParametrosURL,
  obtenerSesionActiva,
  homologarRol,
  navegarAVista,
  obtenerContratosAutorizados,
  obtenerMapaPisosAreasPorContrato
} from "../../core/router.js";
import { inicializarMonitorOffline, sincronizarColaPendiente } from "../../core/offlineSync.js";

// Esquema exacto de columnas según el modelo para exportar idéntico a Auditoría.docx
const COLUMNAS_MODELO = {
  BANOS: [
    { key: "inodoro", label: "INODORO" },
    { key: "urinario", label: "URINARIO" },
    { key: "lavamanos", label: "LAVAMANOS" },
    { key: "paredes_d_b", label: "PAREDES DIVISORIAS" },
    { key: "espejos", label: "ESPEJOS" },
    { key: "pisos", label: "PISOS" },
    { key: "paredes", label: "PAREDES" },
    { key: "techos", label: "TECHOS" },
    { key: "puertas", label: "PUERTAS" },
    { key: "ventanas", label: "VENTANAS" },
    { key: "control_p", label: "CONTROL PAPEL H" },
    { key: "control_t", label: "CONTROL PAPEL T" },
    { key: "dispensadores", label: "DISPENSADORES" }
  ],
  CRITICA: [
    { key: "techos", label: "TECHOS" },
    { key: "paredes", label: "PAREDES" },
    { key: "pisos", label: "PISOS" },
    { key: "lavamanos", label: "LAVAMANOS" },
    { key: "cielitica", label: "LÁMPARA CIELÍTICA" },
    { key: "puertas", label: "PUERTAS" },
    { key: "vidrios", label: "VIDRIOS" },
    { key: "camillas", label: "CAMILLAS" },
    { key: "mobiliario", label: "MESAS MAYO / CARROS" },
    { key: "banos", label: "BATERÍA SANITARIA" },
    { key: "dispensadores", label: "DISPENSADORES" },
    { key: "sillas", label: "SILLAS" }
  ],
  SEMICRITICA: [
    { key: "techos", label: "TECHOS" },
    { key: "paredes", label: "PAREDES" },
    { key: "pisos", label: "PISOS" },
    { key: "lavamanos", label: "LAVAMANOS" },
    { key: "ventanas", label: "VENTANAS" },
    { key: "puertas", label: "PUERTAS" },
    { key: "vidrios", label: "VIDRIOS" },
    { key: "camillas", label: "CAMILLAS" },
    { key: "mobiliario", label: "MOBILIARIO" },
    { key: "banos", label: "BAÑO ANEXO" },
    { key: "dispensadores", label: "DISPENSADORES" },
    { key: "sillas", label: "SILLAS" }
  ],
  NOCRITICA: [
    { key: "techos", label: "TECHOS" },
    { key: "paredes", label: "PAREDES" },
    { key: "pisos", label: "PISOS" },
    { key: "lavamanos", label: "LAVAMANOS" },
    { key: "ventanas", label: "VENTANAS" },
    { key: "puertas", label: "PUERTAS" },
    { key: "vidrios", label: "VIDRIOS" },
    { key: "mobiliario", label: "MOBILIARIO" },
    { key: "dispensadores", label: "DISPENSADORES" },
    { key: "sillas", label: "SILLAS" }
  ]
};

let catalogoGlobal = {};
let mapaContratos = {};
let modeloDetectado = "";
let rolActual = "SUPERVISOR";
let auditorActual = "SUPERVISOR";
let usuarioIdActual = null;
let contratoFijo = "";
let pisoFijo = "";
let areaFija = "";
let esSoloLectura = false;

document.addEventListener("DOMContentLoaded", async () => {
  inicializarMonitorOffline();
  if (navigator.onLine) {
    await sincronizarColaPendiente();
  }

  const urlParams = obtenerParametrosURL();
  const queryRaw = new URLSearchParams(window.location.search);
  const sesion = obtenerSesionActiva();

  esSoloLectura = queryRaw.get("modo") === "solo_lectura";

  if (esSoloLectura) {
    rolActual = "INVITADO";
    auditorActual = "INVITADO AUDITORÍA";
    usuarioIdActual = null;
    aplicarInterfazSoloLectura();
  } else {
    rolActual = homologarRol(urlParams.rol || (sesion ? sesion.rol : "SUPERVISOR"));
    auditorActual = urlParams.usuario || (sesion ? sesion.nombre : "SUPERVISOR");
    usuarioIdActual = sesion ? sesion.id : null;
  }

  // Captura segura de parámetros QR (decodificando espacios y tildes)
  contratoFijo = (queryRaw.get("contrato") || urlParams.contrato || (sesion ? sesion.qrContrato : "") || "").trim();
  pisoFijo = (queryRaw.get("piso") || urlParams.piso || (sesion ? sesion.qrPiso : "") || "").trim();
  areaFija = (queryRaw.get("area") || urlParams.area || (sesion ? sesion.qrArea : "") || "").trim();

  // Eventos
  document.getElementById("btnVolverMenu").addEventListener("click", () => {
    navegarAVista("panel.html", document.getElementById("filtroContrato").value);
  });
  document.getElementById("btnImprimirPDF").addEventListener("click", prepararEImprimir);
  document.getElementById("btnFirmarAuditoria").addEventListener("click", ejecutarFirmaAutomatica);
  document.getElementById("filtroContrato").addEventListener("change", alCambiarContrato);
  document.getElementById("filtroPiso").addEventListener("change", cargarAreasPorPiso);
  document.getElementById("filtroArea").addEventListener("change", alCambiarArea);
  document.getElementById("filtroDesde").addEventListener("change", () => {
    if (modeloDetectado !== "") consultarDatos();
  });
  document.getElementById("btnFiltrar").addEventListener("click", consultarDatos);
  document.getElementById("btnLimpiar").addEventListener("click", limpiarFiltros);

  verificarPermisoFirma();
  await iniciarCargaContratos();
});

function verificarPermisoFirma() {
  const btnFirma = document.getElementById("btnFirmarAuditoria");
  if (btnFirma && !esSoloLectura && (rolActual === "SUPERVISOR" || rolActual === "CONTROL")) {
    btnFirma.style.display = "inline-block";
  }
}

async function iniciarCargaContratos() {
  const selContrato = document.getElementById("filtroContrato");
  selContrato.innerHTML = '<option value="">Cargando contratos...</option>';

  try {
    let contratos = [];
    if (usuarioIdActual && !esSoloLectura) {
      contratos = await obtenerContratosAutorizados(usuarioIdActual, rolActual);
    } else {
      const { data } = await supabase
        .from("trazabilidad_contratos")
        .select("id, codigo_contrato, nombre_cliente")
        .eq("activo", true)
        .order("nombre_cliente", { ascending: true });
      contratos = data || [];
    }

    selContrato.innerHTML = "";
    contratos.forEach(c => {
      mapaContratos[c.codigo_contrato] = c;
      const opt = document.createElement("option");
      opt.value = c.codigo_contrato;
      opt.textContent = `${c.nombre_cliente} (${c.codigo_contrato})`;
      selContrato.appendChild(opt);
    });

    const codMatch = Object.keys(mapaContratos).find(
      k => k.trim().toUpperCase() === contratoFijo.toUpperCase()
    );

    if (codMatch) {
      selContrato.value = codMatch;
    } else if (contratos.length > 0) {
      selContrato.value = contratos[0].codigo_contrato;
    }

    await alCambiarContrato();
  } catch (err) {
    selContrato.innerHTML = '<option value="">Error al conectar</option>';
  }
}

async function alCambiarContrato() {
  const codContrato = document.getElementById("filtroContrato").value;
  const info = mapaContratos[codContrato];
  const nombreCliente = info ? info.nombre_cliente : "HOSPITAL DEL HOLDING";

  document.getElementById("lblSubtituloAuditoria").innerText =
    `Control de Calidad, Desinfección y Bioseguridad Hospitalaria — ${nombreCliente}`;
  document.getElementById("printContratoTitulo").innerText = `PROYECTO: ${nombreCliente.toUpperCase()}`;
  document.getElementById("printFirmaCliente").innerText = nombreCliente.toUpperCase();

  const selectPiso = document.getElementById("filtroPiso");
  selectPiso.innerHTML = '<option value="">Cargando pisos...</option>';

  catalogoGlobal = await obtenerMapaPisosAreasPorContrato(codContrato);
  const listaPisos = Object.keys(catalogoGlobal);

  if (listaPisos.length === 0) {
    selectPiso.innerHTML = '<option value="">Sin áreas registradas</option>';
    aplicarSeguridadRol();
    return;
  }

  selectPiso.innerHTML = '<option value="">Seleccione piso...</option>';
  listaPisos.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    selectPiso.appendChild(opt);
  });

  const pisoMatch = listaPisos.find(
    p => p.trim().toUpperCase() === pisoFijo.toUpperCase()
  );

  if (pisoMatch) {
    selectPiso.value = pisoMatch;
    cargarAreasPorPiso();
    if (areaFija) {
      const selectArea = document.getElementById("filtroArea");
      const optMatch = Array.from(selectArea.options).find(
        o => o.value.trim().toUpperCase() === areaFija.toUpperCase()
      );
      if (optMatch) {
        selectArea.value = optMatch.value;
        alCambiarArea();
      }
    }
  } else {
    cargarAreasPorPiso();
  }

  aplicarSeguridadRol();
}

function aplicarInterfazSoloLectura() {
  ["btnVolverMenu", "btnFirmarAuditoria", "btnFiltrar", "btnLimpiar"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const banner = document.createElement("div");
  banner.className = "alert alert-secondary text-center py-2 small fw-bold mb-3 no-print";
  banner.innerText = "👁️ MODO AUDITORÍA (SOLO LECTURA) — Visualización y exportación a PDF habilitadas";
  document.body.prepend(banner);
}

function aplicarSeguridadRol() {
  const selContrato = document.getElementById("filtroContrato");
  const selectPiso = document.getElementById("filtroPiso");
  const selectArea = document.getElementById("filtroArea");

  // MODO SOLO LECTURA: Bloquea Contrato, Piso y Área según el QR; deja libre el Mes y Exportar PDF
  if (esSoloLectura) {
    [selContrato, selectPiso, selectArea].forEach(el => {
      if (el) {
        el.disabled = true;
        el.classList.add("bg-light");
      }
    });
    return;
  }

  // Si el auditor solo tiene 1 contrato asignado, bloquea el contrato pero le deja libre todos los pisos y áreas de su sede
  if (rolActual !== "CONTROL" && selContrato.options.length <= 1) {
    selContrato.disabled = true;
    selContrato.classList.add("bg-light");
  } else {
    selContrato.disabled = false;
    selContrato.classList.remove("bg-light");
  }

  selectPiso.disabled = false;
  if (selectPiso.value) selectArea.disabled = false;
}

function cargarAreasPorPiso() {
  const piso = document.getElementById("filtroPiso").value || pisoFijo;
  const selectArea = document.getElementById("filtroArea");
  const btnFiltrar = document.getElementById("btnFiltrar");

  selectArea.innerHTML = '<option value="">Seleccione el área...</option>';
  modeloDetectado = "";
  document.getElementById("badgeModeloDetectado").style.display = "none";

  if (!piso || !catalogoGlobal[piso]) {
    selectArea.disabled = true;
    btnFiltrar.disabled = true;
    mostrarMensajeInicial("Selecciona un Piso y un Área para consultar.");
    return;
  }

  catalogoGlobal[piso].forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.area;
    opt.textContent = item.area;
    opt.dataset.modelo = item.tipo;
    selectArea.appendChild(opt);
  });

  if (!esSoloLectura && (rolActual === "CONTROL" || !areaFija)) {
    selectArea.disabled = false;
  }
  btnFiltrar.disabled = true;
  mostrarMensajeInicial("Ahora selecciona el Área correspondiente.");
}

function alCambiarArea() {
  const selectArea = document.getElementById("filtroArea");
  const opt = selectArea.options[selectArea.selectedIndex];
  const btnFiltrar = document.getElementById("btnFiltrar");

  if (!opt || !opt.value) {
    modeloDetectado = "";
    btnFiltrar.disabled = true;
    document.getElementById("badgeModeloDetectado").style.display = "none";
    mostrarMensajeInicial("Selecciona un Área para consultar.");
    return;
  }

  const rawMod = (opt.dataset.modelo || "SEMICRITICA").toUpperCase().trim();
  if (rawMod.includes("BANO") || rawMod.includes("BAÑO")) {
    modeloDetectado = "BANOS";
  } else if (rawMod.includes("NO CRITICA") || rawMod.includes("NO CRÍTICA") || rawMod.includes("NOCRITICA") || rawMod.includes("NO_CRITICA")) {
    modeloDetectado = "NOCRITICA";
  } else if (rawMod.includes("SEMI")) {
    modeloDetectado = "SEMICRITICA";
  } else if (rawMod.includes("CRITICA") || rawMod.includes("CRÍTICA")) {
    modeloDetectado = "CRITICA";
  } else {
    modeloDetectado = "SEMICRITICA";
  }

  btnFiltrar.disabled = false;
  const badge = document.getElementById("badgeModeloDetectado");
  badge.style.display = "inline-block";
  badge.innerText = "MODELO: " + (modeloDetectado === "NOCRITICA" ? "NO CRÍTICA" : modeloDetectado);
  badge.className = "badge-modelo-info text-white " +
    (modeloDetectado === "BANOS" ? "bg-primary" :
    (modeloDetectado === "CRITICA" ? "bg-danger" :
    (modeloDetectado === "NOCRITICA" ? "bg-success" : "bg-warning text-dark")));

  consultarDatos();
}

async function consultarDatos() {
  const codContrato = document.getElementById("filtroContrato").value || contratoFijo;
  const infoContrato = mapaContratos[codContrato];
  const piso = document.getElementById("filtroPiso").value || pisoFijo;
  const area = document.getElementById("filtroArea").value || areaFija;
  const mes = document.getElementById("filtroDesde").value;

  if (!infoContrato || !piso || !area || !modeloDetectado) return;

  const cuerpo = document.getElementById("tablaCuerpo");
  cuerpo.innerHTML = '<tr><td colspan="25" class="text-center py-4 text-muted">Consultando registros en Supabase...</td></tr>';

  const cuerpoATP = document.getElementById("tablaCuerpoLuminometria");
  cuerpoATP.innerHTML = '<tr><td colspan="11" class="text-center py-3 text-muted">Buscando hisopados ATP en el área...</td></tr>';

  try {
    const { data: limpiezas, error: errLimp } = await supabase
      .from("trazabilidad_registros_limpieza")
      .select("*")
      .eq("contrato_id", infoContrato.id)
      .eq("piso", piso)
      .eq("nombre_area", area)
      .order("fecha_registro", { ascending: false })
      .order("hora_registro", { ascending: false });

    if (errLimp) throw errLimp;

    const limpiezasFiltradas = (limpiezas || []).filter(f => {
      if (!mes) return true;
      const partes = (f.fecha_registro || "").split("-");
      return partes.length >= 2 && partes[1] === mes;
    });

    renderizarTablaLimpiezas(limpiezasFiltradas, area);

    const { data: hisopados, error: errATP } = await supabase
      .from("trazabilidad_registros_atp")
      .select("*")
      .eq("contrato_id", infoContrato.id)
      .eq("piso", piso)
      .eq("nombre_area", area)
      .order("fecha_registro", { ascending: false })
      .order("hora_registro", { ascending: false });

    if (errATP) throw errATP;

    const atpFiltrados = (hisopados || []).filter(h => {
      if (!mes) return true;
      const partes = (h.fecha_registro || "").split("-");
      return partes.length >= 2 && partes[1] === mes;
    });

    renderizarTablaLuminometria(atpFiltrados);

  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="25" class="text-center text-danger py-4">Error: ${err.message}</td></tr>`;
  }
}

function formatearFechaLatam(fechaISO) {
  if (!fechaISO) return "";
  const p = fechaISO.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : fechaISO;
}

function renderizarTablaLimpiezas(registros, areaActual) {
  const cabecera = document.getElementById("tablaCabecera");
  const cuerpo = document.getElementById("tablaCuerpo");
  const contador = document.getElementById("contadorRegistros");
  const titulo = document.getElementById("tituloTabla");

  cabecera.innerHTML = "";
  cuerpo.innerHTML = "";

  const nombreModelo = modeloDetectado === "BANOS" ? "BAÑOS"
    : (modeloDetectado === "CRITICA" ? "ÁREA CRÍTICA"
    : (modeloDetectado === "NOCRITICA" ? "ÁREA NO CRÍTICA" : "ÁREA SEMICRÍTICA"));
  titulo.innerText = `AUDITORÍA: ${areaActual} (${nombreModelo})`;
  contador.innerText = `${registros.length} registros encontrados`;

  const colsChecklist = COLUMNAS_MODELO[modeloDetectado] || COLUMNAS_MODELO.SEMICRITICA;

  if (registros.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="25" class="text-center py-4 text-muted">No existen registros guardados aún para esta área en el periodo seleccionado.</td></tr>';
    return;
  }

  const encabezados = [
    "FECHA", "HORA", "PISO", "ÁREA", "TIPO LIMPIEZA",
    ...colsChecklist.map(c => c.label),
    "AUXILIAR RESPONSABLE", "REVISADO POR", "OBSERVACIONES"
  ];

  const trHead = document.createElement("tr");
  encabezados.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    trHead.appendChild(th);
  });
  cabecera.appendChild(trHead);

  registros.forEach(reg => {
    const tr = document.createElement("tr");
    const chk = reg.checklist || {};

    tr.innerHTML = `
      <td class="text-center fw-bold">${formatearFechaLatam(reg.fecha_registro)}</td>
      <td class="text-center fw-bold">${(reg.hora_registro || "").slice(0, 8)}</td>
      <td class="text-center">${reg.piso || ""}</td>
      <td class="text-center">${reg.nombre_area || ""}</td>
    `;

    const tdTipo = document.createElement("td");
    tdTipo.className = "text-center";
    const tipoUpper = (reg.tipo_limpieza || "Concurrente").toUpperCase();
    if (tipoUpper.includes("TERMINAL")) {
      tdTipo.innerHTML = `<span style="background-color: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${reg.tipo_limpieza}</span>`;
    } else {
      tdTipo.innerHTML = `<span style="background-color: #fef08a; color: #854d0e; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${reg.tipo_limpieza}</span>`;
    }
    tr.appendChild(tdTipo);

    colsChecklist.forEach(col => {
      const tdChk = document.createElement("td");
      tdChk.className = "text-center";
      const val = (chk[col.key] || "NO").toUpperCase();
      if (val === "SI" || val === "TRUE") {
        tdChk.innerHTML = '<span class="badge-si">✓</span>';
      } else {
        tdChk.innerHTML = '<span class="badge-no">✗</span>';
      }
      tr.appendChild(tdChk);
    });

    const tdAux = document.createElement("td");
    tdAux.className = "text-center";
    tdAux.textContent = reg.auxiliar_nombre || "";
    tr.appendChild(tdAux);

    const tdRev = document.createElement("td");
    tdRev.className = "text-center";
    const revRaw = (reg.revisado_por_nombre || "PENDIENTE").trim();
    if (!revRaw || revRaw.toUpperCase() === "PENDIENTE" || revRaw.toUpperCase() === "SUPERVISOR") {
      tdRev.innerHTML = '<span class="badge bg-light text-secondary border">PENDIENTE</span>';
    } else {
      const partes = revRaw.split("\n");
      if (partes.length >= 2) {
        tdRev.innerHTML = `<span class="fw-bold text-dark d-block">${partes[0]}</span><small class="text-muted fst-italic" style="font-size: 0.65rem;">${partes[1]}</small>`;
      } else {
        tdRev.innerHTML = `<span class="fw-bold text-dark">${revRaw}</span>`;
      }
    }
    tr.appendChild(tdRev);

    const tdObs = document.createElement("td");
    tdObs.textContent = reg.observaciones || "Sin novedades";
    tr.appendChild(tdObs);

    cuerpo.appendChild(tr);
  });
}

function renderizarTablaLuminometria(datos) {
  const cuerpo = document.getElementById("tablaCuerpoLuminometria");
  const contador = document.getElementById("contadorLuminometria");
  cuerpo.innerHTML = "";

  if (!datos || datos.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="11" class="text-center py-3 text-muted small">No se registran hisopados ATP para esta área en el periodo seleccionado.</td></tr>';
    contador.innerText = "0 hisopados";
    return;
  }

  contador.innerText = `${datos.length} hisopados encontrados`;

  datos.forEach(fila => {
    const tr = document.createElement("tr");
    const estado = (fila.estado || "").toUpperCase();
    let badgeEstado = `<span class="badge bg-secondary">${estado}</span>`;
    if (estado === "APROBADO") {
      badgeEstado = '<span class="badge bg-success">✓ APROBADO (Superficie Segura)</span>';
    } else if (estado === "RECHAZADO") {
      badgeEstado = '<span class="badge bg-danger">✗ CONTAMINADO (Re-limpieza)</span>';
    }

    const fechaStr = formatearFechaLatam(fila.fecha_registro);
    const horaStr = (fila.hora_registro || "").slice(0, 8);

    tr.innerHTML = `
      <td class="text-center fw-bold">${fechaStr}</td>
      <td class="text-center">${horaStr}</td>
      <td class="fw-semibold">${fila.punto_muestreo || ""}</td>
      <td class="text-center fw-bold text-primary">${fila.rlu_medido ?? 0}</td>
      <td class="text-center text-muted">${fila.umbral_aplicado ?? 45}</td>
      <td class="text-center">${badgeEstado}</td>
      <td class="text-center">${fila.auditor_nombre || ""}</td>
      <td class="text-center fw-semibold text-dark">${fila.auxiliar_vinculado_nombre || "No vinculado"}</td>
      <td class="text-center fw-bold text-secondary">${fila.responsable_cliente || "No especificado"}</td>
      <td>${fila.observaciones_accion || "Sin novedades"}</td>
    `;

    const tdFoto = document.createElement("td");
    tdFoto.className = "text-center";
    if (fila.foto_url && fila.foto_url.startsWith("http")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline-primary py-0 px-2 fw-bold";
      btn.innerText = "📷 Ver Foto";
      btn.onclick = () => mostrarModalFoto(fila.foto_url, fila.punto_muestreo, `${fechaStr} ${horaStr}`);
      tdFoto.appendChild(btn);
    } else {
      tdFoto.innerHTML = '<span class="text-muted small">Sin foto</span>';
    }
    tr.appendChild(tdFoto);
    cuerpo.appendChild(tr);
  });
}

async function ejecutarFirmaAutomatica() {
  if (esSoloLectura) return;

  const codContrato = document.getElementById("filtroContrato").value || contratoFijo;
  const infoContrato = mapaContratos[codContrato];
  const piso = document.getElementById("filtroPiso").value || pisoFijo;
  const area = document.getElementById("filtroArea").value || areaFija;

  if (!infoContrato || !piso || !area) {
    alert("Por favor seleccione Contrato, Piso y Área antes de firmar.");
    return;
  }

  const nombreLimpio = (auditorActual || "SUPERVISOR")
    .replace(/^(ING\.|LIC\.|SR\.|SRA\.|DR\.|DRA\.)\s+/i, "")
    .trim()
    .toUpperCase();

  const ahora = new Date();
  const stampFechaHora = `${ahora.toLocaleDateString("es-EC")} ${ahora.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}`;
  const firmaEnHoja = `${nombreLimpio}\n${stampFechaHora}`;

  const btn = document.getElementById("btnFirmarAuditoria");
  btn.disabled = true;
  btn.innerText = "Firmando...";

  try {
    const { data: registros, error } = await supabase
      .from("trazabilidad_registros_limpieza")
      .select("id, revisado_por_nombre, revisado_por_rol")
      .eq("contrato_id", infoContrato.id)
      .eq("piso", piso)
      .eq("nombre_area", area);

    if (error) throw error;

    const idsParaActualizar = [];
    const hoyTexto = ahora.toLocaleDateString("es-EC");

    (registros || []).forEach(r => {
      const revActual = (r.revisado_por_nombre || "").toUpperCase().trim();
      const rolPrevio = (r.revisado_por_rol || "").toUpperCase().trim();
      const estaPendiente = revActual === "" || revActual === "PENDIENTE" || revActual.startsWith("SUPERVISOR");
      const firmadoHoy = revActual.includes(hoyTexto);

      if (rolActual === "CONTROL") {
        idsParaActualizar.push(r.id);
      } else if (rolActual === "SUPERVISOR") {
        if (rolPrevio === "CONTROL") return;
        if (estaPendiente || firmadoHoy) {
          idsParaActualizar.push(r.id);
        }
      }
    });

    if (idsParaActualizar.length === 0) {
      btn.disabled = false;
      btn.innerText = "🖋️ Firmar Auditoría";
      alert("No hay registros pendientes que admitan su nivel de rol (las firmas de CONTROL están protegidas).");
      return;
    }

    const { error: errUpd } = await supabase
      .from("trazabilidad_registros_limpieza")
      .update({
        revisado_por_id: usuarioIdActual,
        revisado_por_nombre: firmaEnHoja,
        revisado_por_rol: rolActual,
        fecha_hora_firma: ahora.toISOString()
      })
      .in("id", idsParaActualizar);

    if (errUpd) throw errUpd;

    btn.disabled = false;
    btn.innerText = "🖋️ Firmar Auditoría";
    await consultarDatos();

  } catch (err) {
    btn.disabled = false;
    btn.innerText = "🖋️ Firmar Auditoría";
    alert("Error al firmar registros: " + err.message);
  }
}

function mostrarMensajeInicial(texto) {
  document.getElementById("tablaCabecera").innerHTML = "";
  document.getElementById("tablaCuerpo").innerHTML = `<tr><td class="text-center py-5 text-muted"><strong>${texto}</strong></td></tr>`;
  document.getElementById("tituloTabla").innerText = "REGISTROS DE AUDITORÍA";
  document.getElementById("contadorRegistros").innerText = "0 registros";
}

function limpiarFiltros() {
  if (rolActual === "SUPERVISOR") {
    document.getElementById("filtroDesde").value = "";
    consultarDatos();
    return;
  }
  document.getElementById("filtroPiso").value = "";
  document.getElementById("filtroDesde").value = "";
  cargarAreasPorPiso();
}

function prepararEImprimir() {
  const piso = document.getElementById("filtroPiso").value || pisoFijo;
  const area = document.getElementById("filtroArea").value || areaFija;
  if (!piso || !area) {
    alert("Por favor selecciona un Piso y un Área antes de exportar.");
    return;
  }
  const selectMes = document.getElementById("filtroDesde");
  const mesTxt = (selectMes && selectMes.selectedIndex >= 0) ? selectMes.options[selectMes.selectedIndex].text : "Todos los meses";
  const ahora = new Date();
  const fechaTxt = ahora.toLocaleDateString("es-EC") + " " + ahora.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });

  document.getElementById("printPiso").innerText = piso;
  document.getElementById("printArea").innerText = area;
  document.getElementById("printMes").innerText = mesTxt;
  document.getElementById("printFechaActual").innerText = fechaTxt;

  setTimeout(() => window.print(), 250);
}

function mostrarModalFoto(imgSrc, punto, fechaHora) {
  document.getElementById("imgModalFoto").src = imgSrc;
  document.getElementById("modalFotoTitulo").innerText = "Punto: " + punto;
  document.getElementById("modalFotoSubtitulo").innerText = "Fecha/Hora de Muestreo: " + fechaHora;
  document.getElementById("linkFotoOriginal").href = imgSrc;
  const modal = new bootstrap.Modal(document.getElementById("modalVisorFoto"));
  modal.show();
}