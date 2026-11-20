// =====================================================================
// ARCHIVO: modulo-inventarios/js/inventarios.ctrl.js
// Controlador del Módulo de Inventarios:
// 1) Servicios Eventuales (Despacho editable, Checklist Maquinaria, Devoluciones y Cierre)
// 2) Contratos Fijos (Espacio separado)
// 3) Catálogo Maestro y Stock de Bodega Central
// =====================================================================
import { supabase } from "../../core/supabaseClient.js";
import { obtenerSesionActiva } from "../../core/router.js";

let sesionActual = null;
let listaServiciosCRM = [];
let listaCatalogo = [];
let listaBodegaServicios = [];

document.addEventListener("DOMContentLoaded", async () => {
  sesionActual = obtenerSesionActiva();
  if (!sesionActual || sesionActual.rol !== "CONTROL") {
    alert("⛔ Acceso exclusivo para nivel de autorización CONTROL TOTAL.");
    window.location.href = "../../index.html";
    return;
  }

  document.getElementById("lblUsuarioActivoInv").innerText = `👤 ${sesionActual.nombre} (${sesionActual.rol})`;

  // Eventos Globales
  document.getElementById("selServicioBodegaGlobal").addEventListener("change", renderizarVistasServicioActual);
  document.getElementById("txtBuscarGlobalInv").addEventListener("input", () => {
    renderizarVistasServicioActual();
    renderizarTablaCatalogo();
  });

  // Eventos Botones de Flujo (Entregar y Cerrar Bodega)
  document.getElementById("btnMarcarEntregadoBodega").addEventListener("click", marcarPedidoEntregadoBodega);
  document.getElementById("btnCerrarServicioBodega").addEventListener("click", cerrarServicioEnBodega);

  // Eventos PDF
  document.getElementById("btnImprimirActaBodegaPDF").addEventListener("click", () => exportarActaBodegaPDF("COMPLETA"));
  document.getElementById("btnExportarPDFSolicitud").addEventListener("click", () => exportarActaBodegaPDF("SOLICITUD"));
  document.getElementById("btnExportarPDFLiquidacion").addEventListener("click", () => exportarActaBodegaPDF("LIQUIDACION"));
  document.getElementById("btnPdfActaMaquinaria").addEventListener("click", exportarActaMaquinariaPDF);

  // Eventos Pestaña 3: Catálogo Central
  document.getElementById("formCatalogoCentral").addEventListener("submit", guardarOModificarCatalogo);
  document.getElementById("btnCancelarEdicionCat").addEventListener("click", limpiarFormularioCatalogo);

  await recargarTodoInventarios();
});

function mostrarMensajeInv(msg) {
  const b = document.getElementById("msgFeedbackInv");
  b.innerText = msg;
  b.style.display = "block";
  setTimeout(() => (b.style.display = "none"), 4500);
}

// =====================================================================
// CARGA DE BASE DE DATOS (SERVICIOS CRM, CATÁLOGO Y BODEGA)
// =====================================================================
async function recargarTodoInventarios(mantenerServicioId = "") {
  const srvPrevio = mantenerServicioId || document.getElementById("selServicioBodegaGlobal").value;

  const [resSrv, resCat, resBod] = await Promise.all([
    supabase.from("crm_servicios").select("*").order("creado_en", { ascending: false }),
    supabase.from("inventarios_catalogo").select("*").order("nombre_insumo", { ascending: true }),
    supabase.from("crm_servicios_bodega").select("*").order("fecha_movimiento", { ascending: true })
  ]);

  listaServiciosCRM = resSrv.data || [];
  listaCatalogo = resCat.data || [];
  listaBodegaServicios = resBod.data || [];

  generarCodigoItemCatalogo();
  poblarSelectorServiciosCRM(srvPrevio);
  renderizarVistasServicioActual();
  renderizarTablaCatalogo();
}

function poblarSelectorServiciosCRM(seleccionarId = "") {
  const sel = document.getElementById("selServicioBodegaGlobal");
  sel.innerHTML = "";

  if (listaServiciosCRM.length === 0) {
    sel.innerHTML = '<option value="">-- No hay servicios aprobados en el CRM todavía --</option>';
    return;
  }

  listaServiciosCRM.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    let estadoTxt = "🔒 PENDIENTE OPERACIONES";
    if (s.bodega_cerrado) estadoTxt = "✅ BODEGA CERRADA";
    else if (s.bodega_entregado) estadoTxt = "🚀 ENTREGADO / EN PROCESO";
    else if (s.pedido_aprobado) estadoTxt = "📦 LISTO PARA DESPACHO";
    opt.textContent = `${s.codigo_servicio} — ${s.cliente_nombre} (${s.nombre_punto || ""}) [${estadoTxt}]`;
    sel.appendChild(opt);
  });

  if (seleccionarId && listaServiciosCRM.some(x => x.id === seleccionarId)) {
    sel.value = seleccionarId;
  } else {
    sel.value = listaServiciosCRM[0].id;
  }
}

function obtenerServicioActivoObj() {
  const id = document.getElementById("selServicioBodegaGlobal").value;
  return listaServiciosCRM.find(s => s.id === id) || null;
}

// =====================================================================
// RENDERIZADO DE LAS 3 SUBPESTAÑAS DE SERVICIOS EVENTUALES
// =====================================================================
function renderizarVistasServicioActual() {
  const srv = obtenerServicioActivoObj();
  const buscador = (document.getElementById("txtBuscarGlobalInv").value || "").toUpperCase().trim();

  const tbodyDespachos = document.getElementById("tbodyDespachosServicio");
  const tbodyMaquinaria = document.getElementById("tbodyMaquinariaServicio");
  const tbodyDevoluciones = document.getElementById("tbodyDevolucionesServicio");
  const alertaCandado = document.getElementById("alertaCandadoOperaciones");
  const infoEstado = document.getElementById("infoEstadoBodegaSrv");
  const btnEntregar = document.getElementById("btnMarcarEntregadoBodega");
  const btnCerrar = document.getElementById("btnCerrarServicioBodega");

  tbodyDespachos.innerHTML = "";
  tbodyMaquinaria.innerHTML = "";
  tbodyDevoluciones.innerHTML = "";

  if (!srv) {
    alertaCandado.style.display = "none";
    infoEstado.style.display = "none";
    btnEntregar.disabled = true;
    btnCerrar.disabled = true;
    tbodyDespachos.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">Seleccione un servicio activo.</td></tr>';
    tbodyMaquinaria.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Seleccione un servicio activo.</td></tr>';
    tbodyDevoluciones.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Seleccione un servicio activo.</td></tr>';
    return;
  }

  // Verificar candado: solo opera si Operaciones asignó supervisor Y aprobó el pedido
  const puedeOperar = Boolean(srv.supervisor_id && srv.pedido_aprobado);
  alertaCandado.style.display = puedeOperar ? "none" : "block";
  infoEstado.style.display = "block";
  infoEstado.innerHTML = `
    👷 <strong>Supervisor:</strong> ${srv.supervisor_nombre || "Sin asignar"} &nbsp;|&nbsp;
    📍 <strong>Punto:</strong> ${srv.nombre_punto || "-"} (${srv.ciudad || "Quito"}) &nbsp;|&nbsp;
    📊 <strong>Estado Flujo:</strong> <span class="badge bg-dark">${srv.estado_flujo || "CREADO_CRM"}</span>
    ${srv.bodega_entregado ? ' &nbsp;<span class="badge bg-success">✓ ENTREGADO</span>' : ""}
    ${srv.bodega_cerrado ? ' &nbsp;<span class="badge bg-primary">🏁 BODEGA CERRADA</span>' : ""}
  `;

  btnEntregar.disabled = !puedeOperar || Boolean(srv.bodega_cerrado);
  btnEntregar.innerText = srv.bodega_entregado
    ? "✅ PEDIDO YA ENTREGADO (Actualizar Estado)"
    : "✅ MARCAR PEDIDO ENTREGADO (Pasar a En Proceso)";

  btnCerrar.disabled = !puedeOperar || !srv.bodega_entregado || Boolean(srv.bodega_cerrado);
  btnCerrar.innerText = srv.bodega_cerrado
    ? "🏁 SERVICIO CERRADO EN BODEGA"
    : "🏁 CERRAR SERVICIO EN BODEGA";

  document.getElementById("lblTituloTablaDespacho").innerText =
    `PEDIDO DE INSUMOS Y HERRAMIENTAS — [${srv.codigo_servicio}] ${srv.cliente_nombre}`;

  const movimientosSrv = listaBodegaServicios.filter(b => {
    const delServicio = b.servicio_id === srv.id;
    const texto = `${b.insumo_nombre} ${b.categoria || ""} ${b.responsable_retiro || ""}`.toUpperCase();
    return delServicio && texto.includes(buscador);
  });

  const insumosNormales = movimientosSrv.filter(m => (m.categoria || "").toUpperCase() !== "MAQUINARIA");
  const maquinarias = movimientosSrv.filter(m => (m.categoria || "").toUpperCase() === "MAQUINARIA");

  // -------------------------------------------------------------------
  // SUBPESTAÑA 1: INSUMOS Y HERRAMIENTAS (NO MAQUINARIA)
  // -------------------------------------------------------------------
  if (insumosNormales.length === 0) {
    tbodyDespachos.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">No hay insumos ni herramientas solicitados por Operaciones para este servicio.</td></tr>';
  } else {
    insumosNormales.forEach((m, idx) => {
      const solicitada = parseFloat(m.cantidad_solicitada) || parseFloat(m.cantidad_entregada) || 0;
      const entregada = parseFloat(m.cantidad_entregada) || 0;
      const valorInput = entregada > 0 ? entregada : solicitada;
      const costoUnit = parseFloat(m.costo_unitario) || 0;

      const badgeEst = m.estado_despacho === "ENTREGADO"
        ? "bg-success"
        : (m.estado_despacho === "PARCIAL" ? "bg-warning text-dark" : "bg-secondary");

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center fw-bold text-muted">${idx + 1}</td>
        <td class="text-center"><span class="badge bg-secondary">${m.categoria || "INSUMO"}</span></td>
        <td class="fw-bold text-start">${m.insumo_nombre}</td>
        <td class="text-center">${m.unidad || "UND"}</td>
        <td class="text-center fw-bold text-primary fs-6">${solicitada}</td>
        <td class="text-center">
          <input type="number" step="0.01" min="0" class="form-control form-control-sm mx-auto input-devolucion" id="inpEnt_${m.id}" value="${valorInput}" ${!puedeOperar || srv.bodega_cerrado ? "disabled" : ""}>
        </td>
        <td class="text-end">$${costoUnit.toFixed(2)}</td>
        <td class="text-center"><span class="badge ${badgeEst}">${m.estado_despacho || "SOLICITADO"}</span></td>
        <td class="text-center no-print">
          <button type="button" class="btn btn-sm btn-primary py-0 px-2 fw-bold" data-save-ent="${m.id}" ${!puedeOperar || srv.bodega_cerrado ? "disabled" : ""}>💾 Guardar</button>
        </td>
      `;

      tr.querySelector(`[data-save-ent="${m.id}"]`).addEventListener("click", () => guardarEntregaInsumo(m, solicitada));
      tbodyDespachos.appendChild(tr);
    });
  }

  // -------------------------------------------------------------------
  // SUBPESTAÑA 2: MAQUINARIA CON CHECKLIST DE ESTADO A LA ENTREGA
  // -------------------------------------------------------------------
  if (maquinarias.length === 0) {
    tbodyMaquinaria.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Operaciones no ha solicitado maquinaria para este servicio.</td></tr>';
  } else {
    maquinarias.forEach((m, idx) => {
      const solicitada = parseFloat(m.cantidad_solicitada) || parseFloat(m.cantidad_entregada) || 1;
      const entregada = parseFloat(m.cantidad_entregada) || 0;
      const valorInput = entregada > 0 ? entregada : solicitada;
      const chk = m.check_maquinaria_entrega || {};
      const dis = (!puedeOperar || srv.bodega_cerrado) ? "disabled" : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center fw-bold text-muted">${idx + 1}</td>
        <td class="fw-bold text-start text-dark">⚙️ ${m.insumo_nombre}</td>
        <td class="text-center fw-bold text-primary">${solicitada}</td>
        <td class="text-center">
          <input type="number" step="1" min="0" class="form-control form-control-sm mx-auto input-devolucion" id="inpEntMaq_${m.id}" value="${valorInput}" ${dis}>
        </td>
        <td class="text-start">
          <div class="d-flex flex-wrap gap-2">
            <label class="check-maq-label"><input type="checkbox" id="chkMotor_${m.id}" ${chk.motor_ok ? "checked" : ""} ${dis}> Motor/Encendido OK</label>
            <label class="check-maq-label"><input type="checkbox" id="chkCable_${m.id}" ${chk.cable_ok ? "checked" : ""} ${dis}> Cable/Enchufe OK</label>
            <label class="check-maq-label"><input type="checkbox" id="chkAcc_${m.id}" ${chk.accesorios_ok ? "checked" : ""} ${dis}> Accesorios OK</label>
            <label class="check-maq-label"><input type="checkbox" id="chkCarc_${m.id}" ${chk.carcasa_ok ? "checked" : ""} ${dis}> Carcasa OK</label>
          </div>
        </td>
        <td>
          <input type="text" class="form-control form-control-sm" id="txtObsMaq_${m.id}" placeholder="Ej: Incluye 2 discos y cepillo" value="${chk.observacion || ""}" ${dis}>
        </td>
        <td class="text-center no-print">
          <button type="button" class="btn btn-sm btn-primary py-0 px-2 fw-bold" data-save-maq="${m.id}" ${dis}>💾 Guardar</button>
        </td>
      `;

      tr.querySelector(`[data-save-maq="${m.id}"]`).addEventListener("click", () => guardarEntregaMaquinaria(m, solicitada));
      tbodyMaquinaria.appendChild(tr);
    });
  }

  // -------------------------------------------------------------------
  // SUBPESTAÑA 3: DEVOLUCIONES Y CÁLCULO DE GASTO REAL (NO DEVUELTO)
  // -------------------------------------------------------------------
  let sumaTotalEnviado = 0;
  let sumaTotalDevuelto = 0;
  let sumaGastoNoDevuelto = 0;
  let itemsConConsumo = 0;

  if (movimientosSrv.length === 0) {
    tbodyDevoluciones.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Sin ítems despachados en este servicio.</td></tr>';
  } else {
    movimientosSrv.forEach(m => {
      const esMaq = (m.categoria || "").toUpperCase() === "MAQUINARIA";
      const entregada = parseFloat(m.cantidad_entregada) || 0;
      const devuelta = parseFloat(m.cantidad_devuelta) || 0;
      const noDevuelta = Math.max(0, +(entregada - devuelta).toFixed(2));
      const costoUnit = parseFloat(m.costo_unitario) || 0;

      const valorEnviado = +(entregada * costoUnit).toFixed(2);
      const valorDevuelto = +(devuelta * costoUnit).toFixed(2);
      const valorNoDevuelto = +(noDevuelta * costoUnit).toFixed(2);

      sumaTotalEnviado += valorEnviado;
      sumaTotalDevuelto += valorDevuelto;
      sumaGastoNoDevuelto += valorNoDevuelto;
      if (noDevuelta > 0) itemsConConsumo++;

      const retMaq = m.check_maquinaria_retorno || {};
      const dis = (!puedeOperar || !srv.bodega_entregado || srv.bodega_cerrado) ? "disabled" : "";

      const tr2 = document.createElement("tr");
      tr2.innerHTML = `
        <td class="text-center"><span class="badge ${esMaq ? "bg-warning text-dark" : "bg-secondary"}">${m.categoria || "INSUMO"}</span></td>
        <td class="fw-bold text-start">${m.insumo_nombre}</td>
        <td class="text-center fw-bold text-primary">${entregada}</td>
        <td class="text-center">
          <input type="number" step="0.01" min="0" max="${entregada}" class="form-control form-control-sm mx-auto input-devolucion" id="inpDev_${m.id}" value="${devuelta}" ${dis}>
        </td>
        <td class="text-center fw-bold ${noDevuelta > 0 ? "text-danger" : "text-success"} fs-6" id="lblNoDev_${m.id}">${noDevuelta}</td>
        <td class="text-end fw-bold bg-light text-danger" id="lblGastoReal_${m.id}">$${valorNoDevuelto.toFixed(2)}</td>
        <td>
          ${esMaq ? `
            <select class="form-select form-select-sm mb-1 fw-bold" id="selRetMaq_${m.id}" ${dis}>
              <option value="BUEN_ESTADO" ${retMaq.estado === "BUEN_ESTADO" ? "selected" : ""}>✅ Vuelve en Buen Estado</option>
              <option value="CON_FALLA" ${retMaq.estado === "CON_FALLA" ? "selected" : ""}>⚠️ Vuelve con Daño / Falla</option>
              <option value="FALTAN_ACCESORIOS" ${retMaq.estado === "FALTAN_ACCESORIOS" ? "selected" : ""}>❌ Faltan Accesorios</option>
            </select>
          ` : ""}
          <input type="text" class="form-control form-control-sm text-uppercase" id="inpRespDev_${m.id}" placeholder="QUIÉN DEVUELVE / RECIBE" value="${m.responsable_devolucion || srv.supervisor_nombre || ""}" ${dis}>
        </td>
        <td class="text-center no-print">
          <button type="button" class="btn btn-sm btn-success py-1 px-2 fw-bold" data-save-dev="${m.id}" ${dis}>💾 Guardar</button>
        </td>
      `;

      const inputCantDev = tr2.querySelector(`#inpDev_${m.id}`);
      inputCantDev.addEventListener("input", () => {
        const cantD = Math.min(entregada, Math.max(0, parseFloat(inputCantDev.value) || 0));
        const dif = +(entregada - cantD).toFixed(2);
        const costoDif = +(dif * costoUnit).toFixed(2);
        tr2.querySelector(`#lblNoDev_${m.id}`).innerText = dif;
        tr2.querySelector(`#lblGastoReal_${m.id}`).innerText = `$${costoDif.toFixed(2)}`;
      });

      tr2.querySelector(`[data-save-dev="${m.id}"]`).addEventListener("click", () => guardarDevolucionInsumo(m, esMaq));
      tbodyDevoluciones.appendChild(tr2);
    });
  }

  // Actualizar KPIs
  document.getElementById("kpiGastoNoDevueltoSrv").innerText = `$${sumaGastoNoDevuelto.toFixed(2)}`;
  document.getElementById("kpiValorTotalEnviado").innerText = `$${sumaTotalEnviado.toFixed(2)}`;
  document.getElementById("kpiValorTotalDevuelto").innerText = `$${sumaTotalDevuelto.toFixed(2)}`;
  document.getElementById("kpiValorGastoRealInsumos").innerText = `$${sumaGastoNoDevuelto.toFixed(2)}`;
  document.getElementById("kpiItemsConsumidos").innerText = `${itemsConConsumo} ítem(s)`;
}

// =====================================================================
// ACCIONES DE DESPACHO (INSUMOS, MAQUINARIA Y MARCAR ENTREGADO)
// =====================================================================
async function ajustarStockCentral(catalogoId, deltaStock) {
  if (!catalogoId || deltaStock === 0) return;
  const prod = listaCatalogo.find(c => c.id === catalogoId);
  if (!prod) return;
  const nuevoStock = Math.max(0, +(parseFloat(prod.stock_actual) + deltaStock).toFixed(2));
  await supabase.from("inventarios_catalogo").update({ stock_actual: nuevoStock }).eq("id", prod.id);
}

async function guardarEntregaInsumo(mov, solicitada) {
  const nuevaEntregada = Math.max(0, parseFloat(document.getElementById(`inpEnt_${mov.id}`).value) || 0);
  const entregadaPrevia = parseFloat(mov.cantidad_entregada) || 0;
  const diferencia = +(nuevaEntregada - entregadaPrevia).toFixed(2);

  // Descontar (o reintegrar si bajó) del stock central
  await ajustarStockCentral(mov.insumo_catalogo_id, -diferencia);

  const estado = nuevaEntregada === 0
    ? "PENDIENTE"
    : (nuevaEntregada < solicitada ? "PARCIAL" : "ENTREGADO");

  const { error } = await supabase
    .from("crm_servicios_bodega")
    .update({
      cantidad_entregada: nuevaEntregada,
      estado_despacho: estado
    })
    .eq("id", mov.id);

  if (error) {
    alert("Error al guardar despacho: " + error.message);
    return;
  }

  mostrarMensajeInv(`🚚 ${mov.insumo_nombre}: cantidad entregada guardada (${nuevaEntregada} ${mov.unidad} — ${estado}).`);
  await recargarTodoInventarios(mov.servicio_id);
}

async function guardarEntregaMaquinaria(mov, solicitada) {
  const nuevaEntregada = Math.max(0, parseFloat(document.getElementById(`inpEntMaq_${mov.id}`).value) || 0);
  const entregadaPrevia = parseFloat(mov.cantidad_entregada) || 0;
  const diferencia = +(nuevaEntregada - entregadaPrevia).toFixed(2);

  await ajustarStockCentral(mov.insumo_catalogo_id, -diferencia);

  const checkPayload = {
    motor_ok: document.getElementById(`chkMotor_${mov.id}`).checked,
    cable_ok: document.getElementById(`chkCable_${mov.id}`).checked,
    accesorios_ok: document.getElementById(`chkAcc_${mov.id}`).checked,
    carcasa_ok: document.getElementById(`chkCarc_${mov.id}`).checked,
    observacion: document.getElementById(`txtObsMaq_${mov.id}`).value.trim()
  };

  const estado = nuevaEntregada === 0
    ? "PENDIENTE"
    : (nuevaEntregada < solicitada ? "PARCIAL" : "ENTREGADO");

  const { error } = await supabase
    .from("crm_servicios_bodega")
    .update({
      cantidad_entregada: nuevaEntregada,
      estado_despacho: estado,
      check_maquinaria_entrega: checkPayload
    })
    .eq("id", mov.id);

  if (error) {
    alert("Error al guardar maquinaria: " + error.message);
    return;
  }

  mostrarMensajeInv(`⚙️ Checklist y entrega guardados para ${mov.insumo_nombre}.`);
  await recargarTodoInventarios(mov.servicio_id);
}

async function marcarPedidoEntregadoBodega() {
  const srv = obtenerServicioActivoObj();
  if (!srv) return;

  if (!confirm(`¿Confirmar que el pedido de ${srv.codigo_servicio} fue ENTREGADO?\nEl servicio pasará al estado EN PROCESO en Supervisión y en el Control 360° del CRM.`)) return;

  const nuevoFlujo = (srv.estado_flujo === "PEDIDO_APROBADO" || srv.estado_flujo === "SUPERVISOR_ASIGNADO" || srv.estado_flujo === "CREADO_CRM")
    ? "EN_PROCESO"
    : srv.estado_flujo;

  const { error } = await supabase
    .from("crm_servicios")
    .update({
      bodega_entregado: true,
      estado_flujo: nuevoFlujo
    })
    .eq("id", srv.id);

  if (error) {
    alert("Error al marcar entregado: " + error.message);
    return;
  }

  mostrarMensajeInv(`✅ Pedido de ${srv.codigo_servicio} marcado como ENTREGADO. Supervisión ya puede ejecutar y cerrar en campo.`);
  await recargarTodoInventarios(srv.id);
}

// =====================================================================
// ACCIONES DE DEVOLUCIÓN Y CIERRE DEFINITIVO DE BODEGA
// =====================================================================
async function guardarDevolucionInsumo(mov, esMaq) {
  const entregada = parseFloat(mov.cantidad_entregada) || 0;
  const devueltaPrevia = parseFloat(mov.cantidad_devuelta) || 0;
  const nuevaDevuelta = parseFloat(document.getElementById(`inpDev_${mov.id}`).value) || 0;

  if (nuevaDevuelta < 0 || nuevaDevuelta > entregada) {
    alert(`La cantidad devuelta debe estar entre 0 y ${entregada}.`);
    return;
  }

  const respDev = document.getElementById(`inpRespDev_${mov.id}`).value.trim().toUpperCase();
  const ajusteStock = +(nuevaDevuelta - devueltaPrevia).toFixed(2);
  await ajustarStockCentral(mov.insumo_catalogo_id, ajusteStock);

  const updatePayload = {
    cantidad_devuelta: nuevaDevuelta,
    responsable_devolucion: respDev
  };

  if (esMaq) {
    const selRet = document.getElementById(`selRetMaq_${mov.id}`);
    updatePayload.check_maquinaria_retorno = {
      estado: selRet ? selRet.value : "BUEN_ESTADO",
      fecha: new Date().toISOString()
    };
  }

  const { error } = await supabase.from("crm_servicios_bodega").update(updatePayload).eq("id", mov.id);
  if (error) {
    alert("Error al registrar devolución: " + error.message);
    return;
  }

  mostrarMensajeInv(`✓ Retorno actualizado en ${mov.insumo_nombre}. Stock reintegrado y gasto real recalculado.`);
  await recargarTodoInventarios(mov.servicio_id);
}

async function cerrarServicioEnBodega() {
  const srv = obtenerServicioActivoObj();
  if (!srv) return;

  if (!confirm(`¿Confirmar el CIERRE DEFINITIVO DE BODEGA para ${srv.codigo_servicio}?\nAsegúrese de haber guardado todas las devoluciones de insumos y maquinaria.`)) return;

  const ambosCerrados = Boolean(srv.campo_cerrado);
  const nuevoFlujo = ambosCerrados ? "TERMINADO_FACTURAR" : srv.estado_flujo;

  const updatePayload = {
    bodega_cerrado: true,
    estado_flujo: nuevoFlujo
  };
  if (ambosCerrados) updatePayload.estado_servicio = "REALIZADO";

  const { error } = await supabase.from("crm_servicios").update(updatePayload).eq("id", srv.id);
  if (error) {
    alert("Error al cerrar servicio en bodega: " + error.message);
    return;
  }

  if (ambosCerrados && srv.cotizacion_id) {
    await supabase.from("crm_cotizaciones").update({ estado: "REALIZADO" }).eq("id", srv.cotizacion_id);
  }

  mostrarMensajeInv(
    ambosCerrados
      ? `🎉 Bodega y Campo cerrados. ${srv.codigo_servicio} pasó a SERVICIO TERMINADO — FACTURAR en el CRM.`
      : `🏁 Bodega cerrada para ${srv.codigo_servicio}. Pendiente únicamente cierre de campo en Supervisión.`
  );
  await recargarTodoInventarios(srv.id);
}

// =====================================================================
// PESTAÑA 3: CRUD CATÁLOGO MAESTRO DE BODEGA CENTRAL
// =====================================================================
function generarCodigoItemCatalogo() {
  if (!listaCatalogo || listaCatalogo.length === 0) {
    document.getElementById("catCodigo").value = "INS-001";
    return;
  }
  let max = 0;
  listaCatalogo.forEach(i => {
    const m = (i.codigo_item || "").match(/INS-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  document.getElementById("catCodigo").value = `INS-${String(max + 1).padStart(3, "0")}`;
}

async function guardarOModificarCatalogo(e) {
  e.preventDefault();
  const editId = document.getElementById("editCatalogoId").value;

  const payload = {
    codigo_item: document.getElementById("catCodigo").value.trim().toUpperCase(),
    categoria: document.getElementById("catCategoria").value,
    nombre_insumo: document.getElementById("catNombre").value.trim().toUpperCase(),
    unidad: document.getElementById("catUnidad").value.trim().toUpperCase(),
    stock_actual: parseFloat(document.getElementById("catStock").value) || 0,
    costo_unitario: parseFloat(document.getElementById("catCosto").value) || 0,
    activo: true
  };

  const res = editId
    ? await supabase.from("inventarios_catalogo").update(payload).eq("id", editId)
    : await supabase.from("inventarios_catalogo").insert([payload]);

  if (res.error) {
    alert("Error al guardar en catálogo central: " + res.error.message);
    return;
  }

  mostrarMensajeInv(`📦 Producto ${payload.nombre_insumo} guardado en Bodega Central.`);
  limpiarFormularioCatalogo();
  await recargarTodoInventarios();
}

function prepararEdicionCatalogo(item) {
  document.getElementById("editCatalogoId").value = item.id;
  document.getElementById("catCodigo").value = item.codigo_item;
  document.getElementById("catCategoria").value = item.categoria || "QUIMICOS";
  document.getElementById("catNombre").value = item.nombre_insumo;
  document.getElementById("catUnidad").value = item.unidad || "UND";
  document.getElementById("catStock").value = item.stock_actual;
  document.getElementById("catCosto").value = parseFloat(item.costo_unitario).toFixed(2);

  document.getElementById("lblTituloFormCatalogo").innerText = `✏️ EDITANDO PRODUCTO: ${item.nombre_insumo}`;
  document.getElementById("btnGuardarCatalogo").innerText = "💾 Actualizar Stock";
  document.getElementById("btnGuardarCatalogo").className = "btn btn-sm btn-warning w-100 fw-bold py-2 text-dark";
  document.getElementById("btnCancelarEdicionCat").style.display = "inline-block";
}

function limpiarFormularioCatalogo() {
  document.getElementById("formCatalogoCentral").reset();
  document.getElementById("editCatalogoId").value = "";
  generarCodigoItemCatalogo();
  document.getElementById("lblTituloFormCatalogo").innerText = "➕ REGISTRAR NUEVO INSUMO, QUÍMICO, IMPLEMENTO O MAQUINARIA EN BODEGA CENTRAL";
  document.getElementById("btnGuardarCatalogo").innerText = "💾 Guardar en Stock";
  document.getElementById("btnGuardarCatalogo").className = "btn btn-sm btn-primary w-100 fw-bold py-2";
  document.getElementById("btnCancelarEdicionCat").style.display = "none";
}

function renderizarTablaCatalogo() {
  const tbody = document.getElementById("tbodyCatalogoCentral");
  const buscador = (document.getElementById("txtBuscarGlobalInv").value || "").toUpperCase().trim();
  tbody.innerHTML = "";

  const filtrados = listaCatalogo.filter(i =>
    `${i.codigo_item} ${i.nombre_insumo} ${i.categoria}`.toUpperCase().includes(buscador)
  );

  document.getElementById("badgeTotalCatalogo").innerText = `${filtrados.length} productos`;

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Sin insumos registrados en el catálogo central.</td></tr>';
    return;
  }

  filtrados.forEach(item => {
    const stock = parseFloat(item.stock_actual) || 0;
    const costo = parseFloat(item.costo_unitario) || 0;
    const valorizado = +(stock * costo).toFixed(2);
    const badgeStock = stock <= (item.stock_minimo || 5) ? "badge-stock-bajo" : "badge-stock-ok";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold text-primary">${item.codigo_item}</td>
      <td><span class="badge ${item.categoria === "MAQUINARIA" ? "bg-warning text-dark" : "bg-secondary"}">${item.categoria}</span></td>
      <td class="fw-bold text-start">${item.nombre_insumo}</td>
      <td>${item.unidad}</td>
      <td><span class="badge ${badgeStock} px-2 py-1 fs-6">${stock}</span></td>
      <td class="fw-bold">$${costo.toFixed(2)}</td>
      <td class="fw-bold text-success">$${valorizado.toFixed(2)}</td>
      <td class="no-print">
        <button class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold me-1" data-edit-cat="${item.id}">✏️</button>
        <button class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold" data-del-cat="${item.id}">🗑️</button>
      </td>
    `;

    tr.querySelector(`[data-edit-cat="${item.id}"]`).addEventListener("click", () => prepararEdicionCatalogo(item));
    tr.querySelector(`[data-del-cat="${item.id}"]`).addEventListener("click", async () => {
      if (!confirm(`¿Eliminar ${item.nombre_insumo} del catálogo central?`)) return;
      await supabase.from("inventarios_catalogo").delete().eq("id", item.id);
      await recargarTodoInventarios();
    });

    tbody.appendChild(tr);
  });
}

// =====================================================================
// EXPORTACIÓN PDF: ACTA DE ENTREGA / LIQUIDACIÓN Y ACTA DE MAQUINARIA
// =====================================================================
function exportarActaBodegaPDF(modo = "COMPLETA") {
  const srv = obtenerServicioActivoObj();
  if (!srv) return;

  const movs = listaBodegaServicios.filter(b => b.servicio_id === srv.id);
  if (movs.length === 0) {
    alert("Este servicio aún no tiene ítems en bodega.");
    return;
  }

  let totalDespachado = 0;
  let totalNoDevuelto = 0;
  const responsable = srv.supervisor_nombre || "SUPERVISOR OPERATIVO";

  const filasHTML = movs.map((m, i) => {
    const sol = parseFloat(m.cantidad_solicitada) || 0;
    const ent = parseFloat(m.cantidad_entregada) || 0;
    const dev = parseFloat(m.cantidad_devuelta) || 0;
    const noDev = Math.max(0, +(ent - dev).toFixed(2));
    const cu = parseFloat(m.costo_unitario) || 0;
    totalDespachado += +(ent * cu).toFixed(2);
    totalNoDevuelto += +(noDev * cu).toFixed(2);

    return `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td>${m.categoria || "INSUMO"}</td>
        <td><strong>${m.insumo_nombre}</strong></td>
        <td style="text-align:center;">${m.unidad || "UND"}</td>
        <td style="text-align:center;">${sol}</td>
        <td style="text-align:center; font-weight:bold;">${ent}</td>
        <td style="text-align:center;">${modo === "SOLICITUD" ? "_____" : dev}</td>
        <td style="text-align:center; font-weight:bold; color:#b91c1c;">${modo === "SOLICITUD" ? "_____" : noDev}</td>
        <td style="text-align:right;">$${(modo === "SOLICITUD" ? ent * cu : noDev * cu).toFixed(2)}</td>
      </tr>
    `;
  }).join("");

  const tituloDoc = modo === "SOLICITUD"
    ? "ACTA DE ENTREGA DE BODEGA POR SERVICIO"
    : "ACTA DE LIQUIDACIÓN Y DEVOLUCIÓN DE BODEGA";

  const v = window.open("", "_blank");
  v.document.write(`
    <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>${tituloDoc} - ${srv.codigo_servicio}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;font-size:12px}
      .cabecera{border-bottom:3px solid #0f172a;padding-bottom:10px;margin-bottom:15px;display:flex;justify-content:space-between}
      .box{border:1px solid #cbd5e1;border-radius:6px;padding:10px;background:#f8fafc;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th,td{border:1px solid #94a3b8;padding:6px 8px} th{background:#0f172a;color:#fff;font-size:11px}
      .firmas{display:flex;justify-content:space-between;margin-top:50px;text-align:center}
      .firma-box{width:42%;border-top:1px solid #0f172a;padding-top:6px;font-weight:bold}
    </style></head><body>
      <div class="cabecera">
        <div><h2 style="margin:0;">BRILLA LIMPIEZA ECUADOR — INVENTARIOS</h2><div style="font-weight:bold;color:#0284c7;">${tituloDoc}</div></div>
        <div style="text-align:right;"><div style="font-size:15px;font-weight:900;">${srv.codigo_servicio}</div><div>${new Date().toLocaleDateString("es-EC")}</div></div>
      </div>
      <div class="box">
        <strong>Cliente:</strong> ${srv.cliente_nombre} | <strong>Punto:</strong> ${srv.nombre_punto} (${srv.ciudad})<br>
        <strong>Supervisor Responsable:</strong> ${responsable} | <strong>Estado Flujo:</strong> ${srv.estado_flujo}
      </div>
      <table>
        <thead><tr><th>#</th><th>Cat.</th><th>Insumo / Equipo</th><th>Und</th><th>Solic.</th><th>Entreg.</th><th>Devuelto</th><th>No Dev.</th><th>Valor ($)</th></tr></thead>
        <tbody>${filasHTML}</tbody>
      </table>
      <div class="box" style="text-align:right;font-size:13px;">
        <div><strong>Valor Total Despachado:</strong> $${totalDespachado.toFixed(2)}</div>
        ${modo !== "SOLICITUD" ? `<div style="color:#b91c1c;font-size:14px;"><strong>GASTO REAL NO DEVUELTO: $${totalNoDevuelto.toFixed(2)}</strong></div>` : ""}
      </div>
      <div class="firmas">
        <div class="firma-box">ENTREGADO CONFORME (BODEGA)</div>
        <div class="firma-box">RECIBIDO CONFORME (${responsable})</div>
      </div>
      <script>window.print();<\/script>
    </body></html>
  `);
  v.document.close();
}

function exportarActaMaquinariaPDF() {
  const srv = obtenerServicioActivoObj();
  if (!srv) return;
  const maqs = listaBodegaServicios.filter(b => b.servicio_id === srv.id && (b.categoria || "").toUpperCase() === "MAQUINARIA");
  if (maqs.length === 0) {
    alert("No hay maquinaria registrada para este servicio.");
    return;
  }

  const filas = maqs.map((m, i) => {
    const c = m.check_maquinaria_entrega || {};
    return `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td><strong>${m.insumo_nombre}</strong></td>
        <td style="text-align:center;">${m.cantidad_entregada || 0}</td>
        <td style="text-align:center;">${c.motor_ok ? "✅" : "❌"}</td>
        <td style="text-align:center;">${c.cable_ok ? "✅" : "❌"}</td>
        <td style="text-align:center;">${c.accesorios_ok ? "✅" : "❌"}</td>
        <td style="text-align:center;">${c.carcasa_ok ? "✅" : "❌"}</td>
        <td>${c.observacion || "-"}</td>
      </tr>
    `;
  }).join("");

  const v = window.open("", "_blank");
  v.document.write(`
    <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Acta de Maquinaria - ${srv.codigo_servicio}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:14px}
      th,td{border:1px solid #94a3b8;padding:6px 8px} th{background:#0f172a;color:#fff;font-size:11px}
      .firmas{display:flex;justify-content:space-between;margin-top:55px;text-align:center}
      .firma-box{width:42%;border-top:1px solid #0f172a;padding-top:6px;font-weight:bold}
    </style></head><body>
      <h2 style="margin:0;">ACTA DE ENTREGA Y CHECKLIST DE MAQUINARIA — ${srv.codigo_servicio}</h2>
      <p><strong>Cliente:</strong> ${srv.cliente_nombre} | <strong>Supervisor:</strong> ${srv.supervisor_nombre || "-"} | <strong>Fecha:</strong> ${new Date().toLocaleDateString("es-EC")}</p>
      <table>
        <thead><tr><th>#</th><th>Maquinaria / Equipo</th><th>Cant.</th><th>Motor</th><th>Cable</th><th>Accesorios</th><th>Carcasa</th><th>Observaciones</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="firmas">
        <div class="firma-box">ENTREGADO CONFORME (BODEGA)</div>
        <div class="firma-box">RECIBIDO CONFORME (${srv.supervisor_nombre || "SUPERVISOR"})</div>
      </div>
      <script>window.print();<\/script>
    </body></html>
  `);
  v.document.close();
}