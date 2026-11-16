// =====================================================================
// ARCHIVO: modulo-trazabilidad/js/reportes.ctrl.js
// Controlador de KPIs, Informe Ejecutivo CL-OP-0032 y Rendimiento por Trabajador
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

let catalogoReporte = {};
let mapaContratos = {};
let listaRendimientoGlobal = [];
let rolActual = "CONTROL";
let usuarioIdActual = null;
let contratoFijo = "";
let pisoFijo = "";
let areaFija = "";

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = obtenerParametrosURL();
  const sesion = obtenerSesionActiva();

  rolActual = homologarRol(urlParams.rol || (sesion ? sesion.rol : "CONTROL"));
  usuarioIdActual = sesion ? sesion.id : null;
  contratoFijo = urlParams.contrato || (sesion ? sesion.qrContrato : "");
  pisoFijo = urlParams.piso || (sesion ? sesion.qrPiso : "");
  areaFija = urlParams.area || (sesion ? sesion.qrArea : "");

  // Seleccionar el mes actual por defecto
  const mesActual = String(new Date().getMonth() + 1).padStart(2, "0");
  document.getElementById("filtroMes").value = mesActual;

  // Eventos
  document.getElementById("btnVolverMenu").addEventListener("click", () => {
    navegarAVista("panel.html", document.getElementById("filtroContrato").value);
  });
  document.getElementById("btnExportarPDF").addEventListener("click", exportarInformeGerencialPDF);
  document.getElementById("filtroContrato").addEventListener("change", alCambiarContratoReporte);
  document.getElementById("filtroPiso").addEventListener("change", cargarAreasReporte);
  document.getElementById("btnActualizarKPIs").addEventListener("click", generarReporte);
  document.getElementById("btnResetFiltros").addEventListener("click", resetearFiltrosReporte);
  document.getElementById("filtroTrabajadorRendimiento").addEventListener("change", filtrarTablaRendimiento);

  // Eventos del visor de fotos
  document.getElementById("visorFotoNativo").addEventListener("click", cerrarVisorFoto);
  document.getElementById("cajaInternaVisor").addEventListener("click", e => e.stopPropagation());
  document.getElementById("btnCerrarVisorX").addEventListener("click", cerrarVisorFoto);
  document.getElementById("btnCerrarVisorBtn").addEventListener("click", cerrarVisorFoto);

  await iniciarContratosReporte();
});

async function iniciarContratosReporte() {
  const selContrato = document.getElementById("filtroContrato");
  selContrato.innerHTML = '<option value="">Cargando contratos...</option>';

  try {
    let contratos = [];
    if (usuarioIdActual) {
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

    if (contratoFijo && mapaContratos[contratoFijo]) {
      selContrato.value = contratoFijo;
    } else if (contratos.length > 0) {
      selContrato.value = contratos[0].codigo_contrato;
    }

    await alCambiarContratoReporte();
  } catch (err) {
    alert("Error al cargar contratos: " + err.message);
  }
}

async function alCambiarContratoReporte() {
  const codContrato = document.getElementById("filtroContrato").value;
  const info = mapaContratos[codContrato];
  const clienteNombre = info ? info.nombre_cliente : "SEDE SELECCIONADA";

  document.getElementById("lblSubtituloReporte").innerText =
    `Trazabilidad Microbiológica ATP y Limpieza Hospitalaria — ${clienteNombre}`;
  document.getElementById("pdfSubtituloProyecto").innerText = `PROYECTO: "${clienteNombre.toUpperCase()}"`;
  document.getElementById("pdfClienteSedeUnificado").innerText = clienteNombre.toUpperCase();
  document.getElementById("pdfNombreClienteTexto").innerText = clienteNombre.toUpperCase();

  catalogoReporte = await obtenerMapaPisosAreasPorContrato(codContrato);
  const selPiso = document.getElementById("filtroPiso");

  selPiso.innerHTML = '<option value="TODOS" selected>Consolidado Global (Todos los Pisos)</option>';
  Object.keys(catalogoReporte).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    selPiso.appendChild(opt);
  });

  const selContrato = document.getElementById("filtroContrato");
  selContrato.disabled = (rolActual !== "CONTROL" && selContrato.options.length <= 1);

  cargarAreasReporte();
  await generarReporte();
}

function aplicarSeguridadReporte() {
  const selContrato = document.getElementById("filtroContrato");
  const selPiso = document.getElementById("filtroPiso");
  const selArea = document.getElementById("filtroArea");

  if (rolActual === "SUPERVISOR") {
    if (contratoFijo) selContrato.disabled = true;
    selPiso.disabled = true;
    selArea.disabled = true;
    selPiso.classList.add("bg-light");
    selArea.classList.add("bg-light");
  } else {
    selContrato.disabled = false;
    selPiso.disabled = false;
    selPiso.classList.remove("bg-light");
    selArea.classList.remove("bg-light");
  }
}

function cargarAreasReporte() {
  const piso = document.getElementById("filtroPiso").value || pisoFijo;
  const selArea = document.getElementById("filtroArea");
  selArea.innerHTML = '<option value="TODAS">Todas las áreas del piso</option>';

  if (piso === "TODOS" || !piso || !catalogoReporte[piso]) {
    selArea.disabled = true;
    return;
  }

  catalogoReporte[piso].forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.area;
    opt.textContent = item.area;
    selArea.appendChild(opt);
  });

  if (rolActual === "CONTROL") {
    selArea.disabled = false;
  }
}

function resetearFiltrosReporte() {
  if (rolActual === "SUPERVISOR") {
    document.getElementById("filtroMes").value = "";
    generarReporte();
    return;
  }
  document.getElementById("filtroPiso").value = "TODOS";
  cargarAreasReporte();
  document.getElementById("filtroMes").value = "";
  generarReporte();
}

function formatearFechaLatam(fechaISO) {
  if (!fechaISO) return "";
  const p = fechaISO.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : fechaISO;
}

async function generarReporte() {
  const codContrato = document.getElementById("filtroContrato").value || contratoFijo;
  const infoContrato = mapaContratos[codContrato];
  if (!infoContrato) return;

  const pisoFiltro = document.getElementById("filtroPiso").value || pisoFijo;
  const areaFiltro = document.getElementById("filtroArea").value || areaFija;
  const mesFiltro = document.getElementById("filtroMes").value;

  document.getElementById("kpiTotalLimpiezas").innerText = "...";
  document.getElementById("kpiTerminalesReal").innerText = "...";
  document.getElementById("kpiTotalHisopados").innerText = "...";

  try {
    // 1. Calcular Meta de Terminales desde el catálogo del contrato (2 por área activa)
    let cantAreas = 0;
    Object.keys(catalogoReporte).forEach(pisoKey => {
      if (pisoFiltro && pisoFiltro !== "TODOS" && pisoKey !== pisoFiltro) return;
      catalogoReporte[pisoKey].forEach(aObj => {
        if (areaFiltro && areaFiltro !== "TODAS" && aObj.area !== areaFiltro) return;
        cantAreas++;
      });
    });
    const terminalesProgramadas = cantAreas > 0 ? cantAreas * 2 : 40;

    // 2. Consultar Limpiezas Operativas del Contrato
    let queryLimp = supabase
      .from("trazabilidad_registros_limpieza")
      .select("*")
      .eq("contrato_id", infoContrato.id);

    if (pisoFiltro && pisoFiltro !== "TODOS") queryLimp = queryLimp.eq("piso", pisoFiltro);
    if (areaFiltro && areaFiltro !== "TODAS") queryLimp = queryLimp.eq("nombre_area", areaFiltro);

    const { data: limpiezasRaw, error: errLimp } = await queryLimp;
    if (errLimp) throw errLimp;

    const limpiezas = (limpiezasRaw || []).filter(f => {
      if (!mesFiltro) return true;
      const partes = (f.fecha_registro || "").split("-");
      return partes.length >= 2 && partes[1] === mesFiltro;
    });

    // 3. Consultar Hisopados ATP del Contrato
    let queryATP = supabase
      .from("trazabilidad_registros_atp")
      .select("*")
      .eq("contrato_id", infoContrato.id)
      .order("fecha_registro", { ascending: false })
      .order("hora_registro", { ascending: false });

    if (pisoFiltro && pisoFiltro !== "TODOS") queryATP = queryATP.eq("piso", pisoFiltro);
    if (areaFiltro && areaFiltro !== "TODAS") queryATP = queryATP.eq("nombre_area", areaFiltro);

    const { data: atpRaw, error: errATP } = await queryATP;
    if (errATP) throw errATP;

    const hisopados = (atpRaw || []).filter(h => {
      if (!mesFiltro) return true;
      const partes = (h.fecha_registro || "").split("-");
      return partes.length >= 2 && partes[1] === mesFiltro;
    });

    // 4. Consolidar Métricas y Rendimiento por Trabajador (cruzando Limpiezas + Calidad ATP)
    let totalLimpiezas = 0;
    let concurrentes = 0;
    let terminales = 0;
    const mapaTrabajadores = {};

    limpiezas.forEach(fila => {
      totalLimpiezas++;
      const esTerminal = (fila.tipo_limpieza || "").toUpperCase().includes("TERMINAL");
      if (esTerminal) terminales++;
      else concurrentes++;

      const nombreAux = (fila.auxiliar_nombre || "PERSONAL ASIGNADO").trim().toUpperCase();
      if (!mapaTrabajadores[nombreAux]) {
        mapaTrabajadores[nombreAux] = {
          nombre: nombreAux,
          concurrentes: 0,
          terminales: 0,
          total: 0,
          sumaPctChecklist: 0,
          atpTotal: 0,
          atpAprobados: 0
        };
      }

      if (esTerminal) mapaTrabajadores[nombreAux].terminales++;
      else mapaTrabajadores[nombreAux].concurrentes++;

      mapaTrabajadores[nombreAux].total++;
      mapaTrabajadores[nombreAux].sumaPctChecklist += Number(fila.porcentaje_cumplimiento || 100);
    });

    // 5. Consolidar Hisopados y enlazar Calidad ATP al trabajador
    let totalATP = 0;
    let aprobadosATP = 0;
    let rechazadosATP = 0;
    const listaIncidencias = [];

    hisopados.forEach(h => {
      totalATP++;
      const esAprobado = (h.estado || "").toUpperCase() === "APROBADO";
      if (esAprobado) aprobadosATP++;
      else rechazadosATP++;

      // Acreditar el hisopado al auxiliar vinculado en ese turno/área
      const auxVinc = (h.auxiliar_vinculado_nombre || "").trim().toUpperCase();
      if (auxVinc && auxVinc !== "SIN REGISTRO PREVIO HOY" && auxVinc !== "NO VINCULADO") {
        if (!mapaTrabajadores[auxVinc]) {
          mapaTrabajadores[auxVinc] = {
            nombre: auxVinc,
            concurrentes: 0,
            terminales: 0,
            total: 0,
            sumaPctChecklist: 0,
            atpTotal: 0,
            atpAprobados: 0
          };
        }
        mapaTrabajadores[auxVinc].atpTotal++;
        if (esAprobado) mapaTrabajadores[auxVinc].atpAprobados++;
      }

      const fechaHoraStr = `${formatearFechaLatam(h.fecha_registro)} ${(h.hora_registro || "").slice(0, 5)}`;
      listaIncidencias.push({
        fecha: fechaHoraStr,
        piso: h.piso || "PISO GENERAL",
        area: h.nombre_area || "ÁREA GENERAL",
        punto: h.punto_muestreo || "Punto no especificado",
        rlu: h.rlu_medido ?? 0,
        umbral: h.umbral_aplicado ?? 45,
        estado: esAprobado ? "APROBADO" : "RECHAZADO",
        responsableCliente: h.responsable_cliente || "No especificado",
        accion: h.observaciones_accion || (esAprobado ? "Conforme con estándar (Limpieza Óptima)" : "Re-limpieza y desinfección mecánica inmediata"),
        urlFoto: h.foto_url || ""
      });
    });

    // Preparar arreglo ordenado de Rendimiento por Trabajador
    listaRendimientoGlobal = Object.values(mapaTrabajadores)
      .map(t => {
        const promChecklist = t.total > 0 ? (t.sumaPctChecklist / t.total).toFixed(1) : "100.0";
        const pctATP = t.atpTotal > 0 ? ((t.atpAprobados / t.atpTotal) * 100).toFixed(0) : null;
        return {
          ...t,
          promedioChecklist: promChecklist,
          pctCalidadATP: pctATP
        };
      })
      .sort((a, b) => b.total - a.total);

    const pctCumplimiento = terminalesProgramadas > 0
      ? ((terminales / terminalesProgramadas) * 100).toFixed(1)
      : "0.0";
    const tasaAprob = totalATP > 0 ? ((aprobadosATP / totalATP) * 100).toFixed(1) : "0.0";
    const tasaRech = totalATP > 0 ? ((rechazadosATP / totalATP) * 100).toFixed(1) : "0.0";

    renderizarResultadosReporte({
      totales: {
        totalLimpiezas,
        concurrentes,
        terminales,
        terminalesProgramadas,
        pctCumplimientoTerminales: pctCumplimiento,
        totalATP,
        aprobadosATP,
        rechazadosATP,
        tasaAprobacion: tasaAprob,
        tasaRechazo: tasaRech
      },
      incidencias: listaIncidencias
    });

    poblarSelectorYTablaRendimiento();

  } catch (err) {
    alert("Error al consolidar métricas desde Supabase: " + err.message);
  }
}

function renderizarResultadosReporte(res) {
  const t = res.totales;

  // KPIs en pantalla
  document.getElementById("kpiTotalLimpiezas").innerText = t.totalLimpiezas;
  document.getElementById("kpiConcurrentes").innerText = t.concurrentes;
  document.getElementById("kpiTerminales").innerText = t.terminales;
  document.getElementById("kpiTerminalesReal").innerText = t.terminales;
  document.getElementById("kpiTerminalesMeta").innerText = t.terminalesProgramadas;
  document.getElementById("badgePctTerminales").innerText = t.pctCumplimientoTerminales + "% Cumplido";
  document.getElementById("kpiTotalHisopados").innerText = t.totalATP;
  document.getElementById("kpiTasaAprobacion").innerText = t.tasaAprobacion + "%";
  document.getElementById("kpiCantAprobados").innerText = t.aprobadosATP;
  document.getElementById("kpiTasaRechazo").innerText = t.tasaRechazo + "%";
  document.getElementById("kpiCantRechazos").innerText = t.rechazadosATP;
  document.getElementById("txtProgresoATP").innerText = `${t.aprobadosATP} de ${t.totalATP} hisopados conformes con el estándar hospitalario`;

  // KPIs para el informe impreso
  document.getElementById("kpiTotalLimpiezasPrint").innerText = t.totalLimpiezas;
  document.getElementById("kpiConcPrint").innerText = t.concurrentes;
  document.getElementById("kpiTermPrint").innerText = t.terminales;
  document.getElementById("kpiTermRealPrint").innerText = t.terminales;
  document.getElementById("kpiTermMetaPrint").innerText = t.terminalesProgramadas;
  document.getElementById("badgePctTerminalesPrint").innerText = t.pctCumplimientoTerminales + "%";
  document.getElementById("kpiTotalHisopadosPrint").innerText = t.totalATP;
  document.getElementById("kpiTasaAprobacionPrint").innerText = t.tasaAprobacion + "%";
  document.getElementById("kpiCantAprobadosPrint").innerText = t.aprobadosATP;
  document.getElementById("kpiTasaRechazoPrint").innerText = t.tasaRechazo + "%";
  document.getElementById("kpiCantRechazosPrint").innerText = t.rechazadosATP;

  const bAprob = document.getElementById("barraAprobados");
  const bRech = document.getElementById("barraRechazados");
  if (t.totalATP === 0) {
    bAprob.style.width = "100%";
    bAprob.innerText = "Sin hisopados en el periodo";
    bRech.style.width = "0%";
    bRech.innerText = "";
  } else {
    bAprob.style.width = t.tasaAprobacion + "%";
    bAprob.innerText = parseFloat(t.tasaAprobacion) > 10 ? t.tasaAprobacion + "% APROBADO" : "";
    bRech.style.width = t.tasaRechazo + "%";
    bRech.innerText = parseFloat(t.tasaRechazo) > 10 ? t.tasaRechazo + "% RECHAZADO" : "";
  }

  // Poblar tablas de hisopados (Pantalla y PDF)
  const cuerpoPantalla = document.getElementById("cuerpoTablaIncidencias");
  const cuerpoPrint = document.getElementById("cuerpoTablaIncidenciasPrint");
  const contenedorFotos = document.getElementById("contenedorFotosPrint");

  cuerpoPantalla.innerHTML = "";
  cuerpoPrint.innerHTML = "";
  if (contenedorFotos) contenedorFotos.innerHTML = "";

  if (!res.incidencias || res.incidencias.length === 0) {
    cuerpoPantalla.innerHTML = '<tr><td colspan="9" class="text-center py-3 text-muted">No se registraron hisopados en el periodo seleccionado.</td></tr>';
    cuerpoPrint.innerHTML = '<tr><td colspan="8" class="text-center py-2 text-muted">No se registraron hisopados en el periodo seleccionado.</td></tr>';
    if (contenedorFotos) {
      contenedorFotos.innerHTML = '<div class="col-12 text-muted small p-2 text-center border rounded">Sin registros fotográficos en el periodo consultado.</div>';
    }
    return;
  }

  let fotosValidas = 0;
  const codContrato = document.getElementById("filtroContrato").value;
  const infoCliente = mapaContratos[codContrato] ? mapaContratos[codContrato].nombre_cliente : "Hospital del Holding";

  res.incidencias.forEach(item => {
    const esOk = item.estado === "APROBADO";
    const badgeEstado = esOk
      ? '<span class="badge bg-success">APROBADO</span>'
      : '<span class="badge bg-danger">RECHAZADO</span>';
    const colorRlu = esOk ? "text-success" : "text-danger";

    const tr1 = document.createElement("tr");
    tr1.innerHTML = `
      <td class="text-center fw-bold">${item.fecha}</td>
      <td class="text-center fw-bold text-dark">${item.piso}</td>
      <td class="fw-semibold text-primary">${item.area}</td>
      <td class="fw-semibold">${item.punto}</td>
      <td class="text-center fw-bold ${colorRlu}">${item.rlu}</td>
      <td class="text-center">${badgeEstado}</td>
      <td class="text-center fw-semibold text-secondary">${item.responsableCliente}</td>
      <td>${item.accion}</td>
    `;

    const tdFoto = document.createElement("td");
    tdFoto.className = "text-center";
    if (item.urlFoto && item.urlFoto.startsWith("http")) {
      const imgElem = document.createElement("img");
      imgElem.src = item.urlFoto;
      imgElem.className = "img-preview";
      imgElem.title = "Clic para ver evidencia";
      imgElem.onclick = () => verFotoModal(item.urlFoto, item.punto, item.fecha);
      tdFoto.appendChild(imgElem);

      // Agregar a la cuadrícula 2 columnas del PDF
      if (contenedorFotos) {
        fotosValidas++;
        const col = document.createElement("div");
        col.className = "col-6";
        col.style.pageBreakInside = "avoid";
        col.innerHTML = `
          <div class="border rounded p-2 text-center bg-white shadow-sm mb-3">
            <img src="${item.urlFoto}" style="height: 230px; width: 100%; object-fit: contain; background-color: #f8fafc;" class="rounded border mb-2">
            <div style="font-size: 0.72rem; text-align: left; line-height: 1.4;">
              <div><strong>📌 Sede:</strong> ${infoCliente}</div>
              <div><strong>🏢 Área:</strong> ${item.area} (${item.piso})</div>
              <div><strong>📍 Punto:</strong> ${item.punto}</div>
              <div><strong>📊 Lectura:</strong> <span class="fw-bold ${colorRlu}">${item.rlu} RLU (${item.estado})</span></div>
            </div>
          </div>
        `;
        contenedorFotos.appendChild(col);
      }
    } else {
      tdFoto.innerHTML = '<span class="text-muted small">Sin foto</span>';
    }
    tr1.appendChild(tdFoto);
    cuerpoPantalla.appendChild(tr1);

    // Fila para PDF
    const tr2 = document.createElement("tr");
    tr2.innerHTML = `
      <td class="text-center fw-bold">${item.fecha}</td>
      <td class="text-center">${item.piso}</td>
      <td>${item.area}</td>
      <td>${item.punto}</td>
      <td class="text-center fw-bold ${colorRlu}">${item.rlu}</td>
      <td class="text-center fw-bold ${colorRlu}">${item.estado}</td>
      <td class="text-center">${item.responsableCliente}</td>
      <td>${item.accion}</td>
    `;
    cuerpoPrint.appendChild(tr2);
  });

  if (contenedorFotos && fotosValidas === 0) {
    contenedorFotos.innerHTML = '<div class="col-12 text-muted small p-2 text-center border rounded">Sin registros fotográficos en el periodo consultado.</div>';
  }
}

function poblarSelectorYTablaRendimiento() {
  const select = document.getElementById("filtroTrabajadorRendimiento");
  const valorPrevio = select.value || "TODOS";
  select.innerHTML = '<option value="TODOS">Todos los trabajadores</option>';

  listaRendimientoGlobal.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.nombre;
    opt.textContent = t.nombre;
    select.appendChild(opt);
  });

  if ([...select.options].some(o => o.value === valorPrevio)) {
    select.value = valorPrevio;
  } else {
    select.value = "TODOS";
  }

  filtrarTablaRendimiento();
}

function filtrarTablaRendimiento() {
  const filtro = document.getElementById("filtroTrabajadorRendimiento").value;
  const cuerpo = document.getElementById("cuerpoTablaRendimiento");
  cuerpo.innerHTML = "";

  const datosFiltrados = filtro === "TODOS"
    ? listaRendimientoGlobal
    : listaRendimientoGlobal.filter(t => t.nombre === filtro);

  if (datosFiltrados.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-muted">No se registran limpiezas ejecutadas por auxiliares en el periodo seleccionado.</td></tr>';
    return;
  }

  datosFiltrados.forEach((item, idx) => {
    let badgeCalidadATP = '<span class="text-muted small">Sin hisopados</span>';
    if (item.pctCalidadATP !== null) {
      const pctNum = Number(item.pctCalidadATP);
      const colorBadge = pctNum >= 90 ? "bg-success" : (pctNum >= 70 ? "bg-warning text-dark" : "bg-danger");
      badgeCalidadATP = `<span class="badge ${colorBadge}">${item.pctCalidadATP}% (${item.atpAprobados}/${item.atpTotal} Conformes)</span>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center fw-bold text-muted">${idx + 1}</td>
      <td class="fw-bold text-dark text-start ps-3">${item.nombre}</td>
      <td class="text-center fw-bold text-success">${item.concurrentes}</td>
      <td class="text-center fw-bold text-info">${item.terminales}</td>
      <td class="text-center fw-bold text-primary">${item.total}</td>
      <td class="text-center fw-bold text-dark">${item.promedioChecklist}%</td>
      <td class="text-center">${badgeCalidadATP}</td>
    `;
    cuerpo.appendChild(tr);
  });
}

function exportarInformeGerencialPDF() {
  const selMes = document.getElementById("filtroMes");
  const textoMes = (selMes && selMes.value) ? selMes.options[selMes.selectedIndex].text : "Consolidado Anual";
  document.getElementById("pdfPeriodo").innerText = textoMes.toUpperCase();

  const ahora = new Date();
  document.getElementById("pdfFechaEmision").innerText =
    ahora.toLocaleDateString("es-EC") + " " + ahora.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });

  window.print();
}

function verFotoModal(url, punto, fecha) {
  const visor = document.getElementById("visorFotoNativo");
  if (!visor) return;
  document.getElementById("vImg").src = url;
  document.getElementById("vTitulo").innerText = punto || "Evidencia Fotográfica";
  document.getElementById("vSub").innerText = "Registro: " + (fecha || "-");
  visor.style.display = "flex";
}

function cerrarVisorFoto() {
  const visor = document.getElementById("visorFotoNativo");
  if (visor) {
    visor.style.display = "none";
    document.getElementById("vImg").src = "";
  }
}