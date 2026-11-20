// =====================================================================
// ARCHIVO: modulo-crm/js/crm.ctrl.js
// Controlador CRM: Clientes, Cotizaciones Multi-Ítem, Servicios Eventuales,
// Solicitudes de Viáticos (Operaciones -> CRM) y Control 360° en Vivo
// =====================================================================
import { supabase } from "../../core/supabaseClient.js";
import { obtenerSesionActiva } from "../../core/router.js";

let clientes = [];
let cotizaciones = [];
let servicios = [];
let viaticosSolicitados = [];
let gastosSupervision = [];
let movimientosBodega = [];
let chartEstados = null;
let chartComparativo = null;

document.addEventListener("DOMContentLoaded", async () => {
  const sesion = obtenerSesionActiva();
  if (!sesion || sesion.rol !== "CONTROL") {
    alert("⛔ Acceso exclusivo para el nivel CONTROL TOTAL.");
    window.location.href = "../../index.html";
    return;
  }

  document.getElementById("lblUsuarioActivoCRM").innerText = `👤 ${sesion.nombre} (${sesion.rol})`;

  // Eventos Pestaña 1: Clientes
  document.getElementById("formCrearCliente").addEventListener("submit", guardarOModificarCliente);
  document.getElementById("btnCancelarEdicionCliente").addEventListener("click", limpiarFormularioCliente);

  // Eventos Pestaña 2: Cotizaciones Multi-Ítem y Edición
  document.getElementById("btnIrACrearClienteRapido").addEventListener("click", () => {
    document.getElementById("btnIrTabClientes").click();
    document.getElementById("cliRuc").focus();
  });
  document.getElementById("cotSelectCliente").addEventListener("change", alSeleccionarClienteEnCotizacion);
  document.getElementById("btnAgregarItemCot").addEventListener("click", () => agregarFilaItemCotizacion("", ""));
  document.getElementById("btnCancelarEdicionCot").addEventListener("click", limpiarFormularioCotizacion);
  document.getElementById("formCrearCotizacion").addEventListener("submit", guardarOModificarCotizacion);

  reiniciarFilasItemsCotizacion();

  // Filtros Globales
  document.getElementById("txtFiltroGlobalCRM").addEventListener("input", renderizarTodo);
  document.getElementById("selMesGlobalCRM").addEventListener("change", renderizarTodo);
  document.getElementById("selEstadoGlobalCRM").addEventListener("change", renderizarTodo);

  document.querySelectorAll(".semaforo-card").forEach(card => {
    card.addEventListener("click", () => {
      document.getElementById("selEstadoGlobalCRM").value = card.getAttribute("data-sem-estado");
      renderizarTodo();
    });
  });

  await cargarBaseDatosCRM();
});

function mostrarAlertaCRM(msg) {
  const box = document.getElementById("msgFeedbackCRM");
  box.innerText = msg;
  box.style.display = "block";
  setTimeout(() => (box.style.display = "none"), 4500);
}

function badgeEstadoFlujo360(estado) {
  const mapa = {
    CREADO_CRM: { cls: "bg-warning text-dark", txt: "🟡 1. CREADO CRM (Sin Supervisor)" },
    SUPERVISOR_ASIGNADO: { cls: "bg-info text-dark", txt: "🔵 2. SUPERVISOR ASIGNADO (En Pedido)" },
    PEDIDO_APROBADO: { cls: "bg-primary", txt: "📦 3. PEDIDO APROBADO (En Bodega / Viáticos)" },
    EN_PROCESO: { cls: "bg-success", txt: "🚀 4. EN PROCESO (Ejecutando en Campo)" },
    CULMINADO_CAMPO: { cls: "bg-dark", txt: "🏁 5. CULMINADO CAMPO (Falta Retorno Bodega)" },
    TERMINADO_FACTURAR: { cls: "bg-primary border border-dark", txt: "✅ 6. SERVICIO TERMINADO — FACTURAR" }
  };
  const info = mapa[estado] || mapa.CREADO_CRM;
  return `<span class="badge ${info.cls} px-2 py-1">${info.txt}</span>`;
}

// =====================================================================
// GESTIÓN DE FILAS DINÁMICAS DE ÍTEMS EN LA COTIZACIÓN
// =====================================================================
function reiniciarFilasItemsCotizacion(listaItems = []) {
  const cont = document.getElementById("contenedorItemsCotizacion");
  cont.innerHTML = "";
  if (Array.isArray(listaItems) && listaItems.length > 0) {
    listaItems.forEach(it => agregarFilaItemCotizacion(it.descripcion, it.valor));
  } else {
    agregarFilaItemCotizacion("", "");
  }
  recalcularTotalesDesdeItems();
}

function agregarFilaItemCotizacion(descripcion = "", valor = "") {
  const cont = document.getElementById("contenedorItemsCotizacion");
  const fila = document.createElement("div");
  fila.className = "row g-2 align-items-center fila-item-cot";
  fila.innerHTML = `
    <div class="col-12 col-md-8">
      <input type="text" class="form-control form-control-sm txt-item-desc" placeholder="Ej: Servicio de decapado de pisos / Limpieza de mamparas de vidrio..." value="${descripcion}" required>
    </div>
    <div class="col-8 col-md-3">
      <div class="input-group input-group-sm">
        <span class="input-group-text fw-bold">$</span>
        <input type="number" step="0.01" class="form-control form-control-sm fw-bold txt-item-valor" placeholder="Valor sin IVA" value="${valor}" required>
      </div>
    </div>
    <div class="col-4 col-md-1 text-end">
      <button type="button" class="btn btn-sm btn-outline-danger w-100 py-0 fw-bold btn-quitar-item" title="Quitar rubro">✖</button>
    </div>
  `;

  fila.querySelector(".txt-item-valor").addEventListener("input", recalcularTotalesDesdeItems);
  fila.querySelector(".btn-quitar-item").addEventListener("click", () => {
    const todas = document.querySelectorAll(".fila-item-cot");
    if (todas.length <= 1) {
      fila.querySelector(".txt-item-desc").value = "";
      fila.querySelector(".txt-item-valor").value = "";
    } else {
      fila.remove();
    }
    recalcularTotalesDesdeItems();
  });

  cont.appendChild(fila);
}

function recalcularTotalesDesdeItems() {
  let subtotal = 0;
  document.querySelectorAll(".fila-item-cot").forEach(f => {
    const v = parseFloat(f.querySelector(".txt-item-valor").value) || 0;
    subtotal += v;
  });

  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);

  document.getElementById("cotSubtotal").value = subtotal.toFixed(2);
  document.getElementById("cotIva").value = iva.toFixed(2);
  document.getElementById("cotTotal").value = total.toFixed(2);
}

function obtenerItemsDelFormulario() {
  const items = [];
  document.querySelectorAll(".fila-item-cot").forEach(f => {
    const desc = f.querySelector(".txt-item-desc").value.trim().toUpperCase();
    const val = parseFloat(f.querySelector(".txt-item-valor").value) || 0;
    if (desc) {
      items.push({ descripcion: desc, valor: +val.toFixed(2) });
    }
  });
  return items;
}

// =====================================================================
// CARGA DE BASE DE DATOS Y CORRELATIVO COT-CLE-001
// =====================================================================
async function cargarBaseDatosCRM() {
  const [resCli, resCot, resSrv, resVia, resGas, resBod] = await Promise.all([
    supabase.from("crm_clientes").select("*").order("razon_social", { ascending: true }),
    supabase.from("crm_cotizaciones").select("*").order("creado_en", { ascending: false }),
    supabase.from("crm_servicios").select("*").order("creado_en", { ascending: false }),
    supabase.from("crm_servicios_viaticos").select("*").neq("estado_viatico", "BORRADOR").order("creado_en", { ascending: false }),
    supabase.from("crm_servicios_gastos").select("*"),
    supabase.from("crm_servicios_bodega").select("*")
  ]);

  clientes = resCli.data || [];
  cotizaciones = resCot.data || [];
  servicios = resSrv.data || [];
  viaticosSolicitados = resVia.data || [];
  gastosSupervision = resGas.data || [];
  movimientosBodega = resBod.data || [];

  if (!document.getElementById("editCotId").value) {
    generarCodigoCotizacionNuevo();
  }
  poblarSelectorClientesEnCotizacion();
  renderizarTodo();
}

function generarCodigoCotizacionNuevo() {
  if (!cotizaciones || cotizaciones.length === 0) {
    document.getElementById("cotCodigo").value = "COT-CLE-001";
    return;
  }

  let maxNumero = 0;
  cotizaciones.forEach(c => {
    const match = (c.codigo_cotizacion || "").match(/COT-CLE-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNumero) maxNumero = num;
    }
  });

  const siguiente = String(maxNumero + 1).padStart(3, "0");
  document.getElementById("cotCodigo").value = `COT-CLE-${siguiente}`;
}

function renderizarTodo() {
  renderizarTablaClientes();
  renderizarTablaCotizaciones();
  renderizarTablaServicios();
  renderizarTablaViaticosCRM();
  renderizarSemaforoYMatriz();
}

// =====================================================================
// PESTAÑA 1: CRUD DE CARTERA DE CLIENTES
// =====================================================================
async function guardarOModificarCliente(e) {
  e.preventDefault();
  const editId = document.getElementById("editClienteId").value;

  const payload = {
    ruc_cedula: document.getElementById("cliRuc").value.trim(),
    razon_social: document.getElementById("cliRazonSocial").value.trim().toUpperCase(),
    ciudad: document.getElementById("cliCiudad").value.trim(),
    direccion: document.getElementById("cliDireccion").value.trim(),
    contacto_nombre: document.getElementById("cliContacto").value.trim().toUpperCase(),
    contacto_cargo: document.getElementById("cliCargo").value.trim().toUpperCase(),
    contacto_correo: document.getElementById("cliCorreo").value.trim().toLowerCase(),
    contacto_telefono: document.getElementById("cliTelefono").value.trim(),
    activo: true
  };

  const res = editId
    ? await supabase.from("crm_clientes").update(payload).eq("id", editId)
    : await supabase.from("crm_clientes").insert([payload]);

  if (res.error) {
    alert("Error al guardar cliente: " + res.error.message);
    return;
  }

  mostrarAlertaCRM(`✓ Cliente ${payload.razon_social} guardado correctamente.`);
  limpiarFormularioCliente();
  await cargarBaseDatosCRM();
}

function prepararEdicionCliente(cli) {
  document.getElementById("editClienteId").value = cli.id;
  document.getElementById("cliRuc").value = cli.ruc_cedula;
  document.getElementById("cliRazonSocial").value = cli.razon_social;
  document.getElementById("cliCiudad").value = cli.ciudad || "Quito";
  document.getElementById("cliDireccion").value = cli.direccion || "";
  document.getElementById("cliContacto").value = cli.contacto_nombre || "";
  document.getElementById("cliCargo").value = cli.contacto_cargo || "";
  document.getElementById("cliCorreo").value = cli.contacto_correo || "";
  document.getElementById("cliTelefono").value = cli.contacto_telefono || "";

  document.getElementById("lblTituloFormCliente").innerText = `✏️ EDITANDO CLIENTE: ${cli.razon_social}`;
  document.getElementById("btnGuardarCliente").innerText = "💾 Actualizar Cliente";
  document.getElementById("btnGuardarCliente").className = "btn btn-sm btn-warning w-100 fw-bold py-2 text-dark";
  document.getElementById("btnCancelarEdicionCliente").style.display = "inline-block";
}

function limpiarFormularioCliente() {
  document.getElementById("formCrearCliente").reset();
  document.getElementById("editClienteId").value = "";
  document.getElementById("cliCiudad").value = "Quito";
  document.getElementById("lblTituloFormCliente").innerText = "➕ REGISTRAR NUEVO CLIENTE EN LA BASE DE DATOS COMERCIAL";
  document.getElementById("btnGuardarCliente").innerText = "💾 Guardar Cliente";
  document.getElementById("btnGuardarCliente").className = "btn btn-sm btn-primary w-100 fw-bold py-2";
  document.getElementById("btnCancelarEdicionCliente").style.display = "none";
}

function renderizarTablaClientes() {
  const texto = (document.getElementById("txtFiltroGlobalCRM").value || "").toUpperCase().trim();
  const tbody = document.getElementById("tbodyClientesCRM");
  tbody.innerHTML = "";

  const filtrados = clientes.filter(c =>
    `${c.ruc_cedula} ${c.razon_social} ${c.contacto_nombre} ${c.ciudad}`.toUpperCase().includes(texto)
  );

  document.getElementById("badgeTotalClientes").innerText = `${filtrados.length} clientes`;

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">No hay clientes registrados.</td></tr>';
    return;
  }

  filtrados.forEach((cli, idx) => {
    const cantCot = cotizaciones.filter(cot => cot.cliente_id === cli.id || cot.cliente_ruc === cli.ruc_cedula).length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold text-muted">${idx + 1}</td>
      <td class="fw-bold text-primary">${cli.ruc_cedula}</td>
      <td class="fw-bold">${cli.razon_social}</td>
      <td>${cli.ciudad} — <small class="text-muted">${cli.direccion || "-"}</small></td>
      <td><div class="fw-semibold">${cli.contacto_nombre}</div><small class="text-muted">${cli.contacto_cargo || ""}</small></td>
      <td>${cli.contacto_correo}</td>
      <td class="fw-bold">${cli.contacto_telefono}</td>
      <td><span class="badge bg-secondary">${cantCot} cot.</span></td>
      <td class="no-print">
        <button class="btn btn-sm btn-success py-0 px-2 fw-bold me-1" data-cotizar-cli="${cli.id}">📝 + Cotizar</button>
        <button class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold me-1" data-edit-cli="${cli.id}">✏️</button>
        <button class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold" data-del-cli="${cli.id}">🗑️</button>
      </td>
    `;

    tr.querySelector(`[data-cotizar-cli="${cli.id}"]`).addEventListener("click", () => {
      limpiarFormularioCotizacion();
      document.getElementById("btnIrTabCotizaciones").click();
      document.getElementById("cotSelectCliente").value = cli.id;
      alSeleccionarClienteEnCotizacion();
    });

    tr.querySelector(`[data-edit-cli="${cli.id}"]`).addEventListener("click", () => prepararEdicionCliente(cli));
    tr.querySelector(`[data-del-cli="${cli.id}"]`).addEventListener("click", async () => {
      if (!confirm(`¿Eliminar al cliente ${cli.razon_social}?`)) return;
      await supabase.from("crm_clientes").delete().eq("id", cli.id);
      await cargarBaseDatosCRM();
    });

    tbody.appendChild(tr);
  });
}

// =====================================================================
// PESTAÑA 2: CREAR Y EDITAR COTIZACIONES (CON MÚLTIPLES RUBROS)
// =====================================================================
function poblarSelectorClientesEnCotizacion() {
  const sel = document.getElementById("cotSelectCliente");
  const valorPrevio = sel.value;
  sel.innerHTML = '<option value="">-- Seleccione un cliente registrado --</option>';

  clientes.forEach(cli => {
    const opt = document.createElement("option");
    opt.value = cli.id;
    opt.textContent = `${cli.razon_social} (${cli.ruc_cedula}) — ${cli.ciudad}`;
    sel.appendChild(opt);
  });

  if (valorPrevio && clientes.some(c => c.id === valorPrevio)) {
    sel.value = valorPrevio;
    alSeleccionarClienteEnCotizacion();
  }
}

function alSeleccionarClienteEnCotizacion() {
  const cliId = document.getElementById("cotSelectCliente").value;
  const cli = clientes.find(c => c.id === cliId);

  if (!cli) {
    document.getElementById("cotRucAuto").value = "";
    document.getElementById("cotContactoAuto").value = "";
    return;
  }

  document.getElementById("cotRucAuto").value = cli.ruc_cedula;
  document.getElementById("cotContactoAuto").value = `${cli.contacto_nombre} (${cli.contacto_correo})`;
  if (!document.getElementById("editCotId").value) {
    document.getElementById("cotCiudad").value = cli.ciudad || "Quito";
    document.getElementById("cotDireccion").value = cli.direccion || "";
  }
}

function prepararEdicionCotizacion(cot) {
  document.getElementById("editCotId").value = cot.id;
  document.getElementById("editCotEstadoOriginal").value = cot.estado;
  document.getElementById("cotCodigo").value = cot.codigo_cotizacion;

  const cli = clientes.find(c => c.id === cot.cliente_id || c.ruc_cedula === cot.cliente_ruc);
  if (cli) {
    document.getElementById("cotSelectCliente").value = cli.id;
    alSeleccionarClienteEnCotizacion();
  }

  document.getElementById("cotTipo").value = cot.tipo_servicio || "POST_CONSTRUCCION";
  document.getElementById("cotCiudad").value = cot.ciudad || "Quito";
  document.getElementById("cotDireccion").value = cot.direccion_servicio || "";

  const itemsGuardados = Array.isArray(cot.items_cotizados) && cot.items_cotizados.length > 0
    ? cot.items_cotizados
    : [{ descripcion: cot.descripcion_servicio || "", valor: parseFloat(cot.subtotal) || 0 }];

  reiniciarFilasItemsCotizacion(itemsGuardados);

  const avisoReapertura = cot.estado === "NO_APROBADO"
    ? " (AL GUARDAR SE REACTIVARÁ COMO PENDIENTE)"
    : "";

  document.getElementById("lblTituloFormCotizacion").innerText =
    `✏️ EDITANDO COTIZACIÓN ${cot.codigo_cotizacion}${avisoReapertura}`;
  document.getElementById("btnSubmitCotizacion").innerText = "💾 Guardar Cambios en Cotización";
  document.getElementById("btnSubmitCotizacion").className = "btn btn-sm btn-warning w-100 fw-bold py-2 text-dark";
  document.getElementById("btnCancelarEdicionCot").style.display = "inline-block";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function limpiarFormularioCotizacion() {
  document.getElementById("formCrearCotizacion").reset();
  document.getElementById("editCotId").value = "";
  document.getElementById("editCotEstadoOriginal").value = "";
  document.getElementById("cotRucAuto").value = "";
  document.getElementById("cotContactoAuto").value = "";
  document.getElementById("cotCiudad").value = "Quito";
  reiniciarFilasItemsCotizacion();
  generarCodigoCotizacionNuevo();

  document.getElementById("lblTituloFormCotizacion").innerText =
    "➕ EMITIR NUEVA COTIZACIÓN (SELECCIONE UN CLIENTE Y AÑADA UNO O MÁS RUBROS)";
  document.getElementById("btnSubmitCotizacion").innerText = "💾 Generar Cotización";
  document.getElementById("btnSubmitCotizacion").className = "btn btn-sm btn-primary w-100 fw-bold py-2";
  document.getElementById("btnCancelarEdicionCot").style.display = "none";
}

async function guardarOModificarCotizacion(e) {
  e.preventDefault();
  const sesion = obtenerSesionActiva();
  const editId = document.getElementById("editCotId").value;
  const estadoOriginal = document.getElementById("editCotEstadoOriginal").value;
  const cliId = document.getElementById("cotSelectCliente").value;
  const cli = clientes.find(c => c.id === cliId);

  if (!cli) {
    alert("Seleccione primero un cliente registrado de la lista.");
    return;
  }

  const items = obtenerItemsDelFormulario();
  if (items.length === 0) {
    alert("Añada al menos un servicio o descripción con su valor.");
    return;
  }

  const resumenTexto = items.map((it, i) => `${i + 1}. ${it.descripcion} ($${it.valor.toFixed(2)})`).join(" | ");
  const subtotal = parseFloat(document.getElementById("cotSubtotal").value) || 0;
  const iva = parseFloat(document.getElementById("cotIva").value) || 0;
  const total = parseFloat(document.getElementById("cotTotal").value) || 0;

  let nuevoEstado = estadoOriginal || "PENDIENTE";
  if (editId && estadoOriginal === "NO_APROBADO") {
    nuevoEstado = "PENDIENTE";
  }

  const payload = {
    codigo_cotizacion: document.getElementById("cotCodigo").value.trim(),
    cliente_id: cli.id,
    cliente_ruc: cli.ruc_cedula,
    cliente_nombre: cli.razon_social,
    cliente_contacto: cli.contacto_nombre,
    cliente_correo: cli.contacto_correo,
    cliente_telefono: cli.contacto_telefono,
    tipo_servicio: document.getElementById("cotTipo").value,
    ciudad: document.getElementById("cotCiudad").value.trim(),
    direccion_servicio: document.getElementById("cotDireccion").value.trim(),
    descripcion_servicio: resumenTexto,
    items_cotizados: items,
    subtotal,
    iva,
    total_cotizado: total,
    estado: nuevoEstado,
    creado_por: sesion ? sesion.nombre : "COMERCIAL"
  };

  if (editId) {
    const { error } = await supabase.from("crm_cotizaciones").update(payload).eq("id", editId);
    if (error) {
      alert("Error al actualizar cotización: " + error.message);
      return;
    }

    await supabase
      .from("crm_servicios")
      .update({
        cliente_nombre: cli.razon_social,
        nombre_punto: payload.direccion_servicio || cli.razon_social,
        ciudad: payload.ciudad,
        presupuesto_cotizado: subtotal
      })
      .eq("cotizacion_id", editId);

    mostrarAlertaCRM(`✓ Cotización ${payload.codigo_cotizacion} actualizada correctamente.`);
  } else {
    const { error } = await supabase.from("crm_cotizaciones").insert([payload]);
    if (error) {
      alert("Error al guardar cotización: " + error.message);
      return;
    }
    mostrarAlertaCRM(`✓ Cotización ${payload.codigo_cotizacion} generada con ${items.length} rubro(s).`);
  }

  limpiarFormularioCotizacion();
  await cargarBaseDatosCRM();
}

function obtenerCotizacionesFiltradas() {
  const texto = (document.getElementById("txtFiltroGlobalCRM").value || "").toUpperCase().trim();
  const mes = document.getElementById("selMesGlobalCRM").value;
  const estado = document.getElementById("selEstadoGlobalCRM").value;

  return cotizaciones.filter(c => {
    const pasaEstado = estado === "TODOS" || c.estado === estado;
    const pasaMes = !mes || (c.creado_en && c.creado_en.startsWith(mes));
    const buscable = `${c.codigo_cotizacion} ${c.cliente_nombre} ${c.cliente_ruc || ""} ${c.descripcion_servicio}`.toUpperCase();
    return pasaEstado && pasaMes && buscable.includes(texto);
  });
}

function formatearListaItemsHTML(cot) {
  if (Array.isArray(cot.items_cotizados) && cot.items_cotizados.length > 0) {
    return cot.items_cotizados
      .map((it, idx) => `<div class="small"><strong>${idx + 1}.</strong> ${it.descripcion} <span class="text-primary fw-bold">($${parseFloat(it.valor).toFixed(2)})</span></div>`)
      .join("");
  }
  return `<div class="small">${cot.descripcion_servicio}</div>`;
}

function renderizarTablaCotizaciones() {
  const lista = obtenerCotizacionesFiltradas();
  const tbody = document.getElementById("tbodyCotizaciones");
  document.getElementById("badgeTotalCotizaciones").innerText = `${lista.length} cotizaciones`;
  tbody.innerHTML = "";

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">Sin cotizaciones registradas.</td></tr>';
    return;
  }

  lista.forEach(c => {
    const tr = document.createElement("tr");
    const etiquetaEstado = c.estado === "REALIZADO"
      ? "🔵 TERMINADO — FACTURAR"
      : (c.estado === "APROBADO" ? "🟢 APROBADO" : c.estado);

    let acciones = `
      <button class="btn btn-sm btn-outline-secondary py-0 px-2 fw-bold me-1" data-editar="${c.id}" title="Editar Cotización">✏️ Editar</button>
      <button class="btn btn-sm btn-outline-dark py-0 px-2 fw-bold me-1" data-pdf="${c.id}">📄 PDF</button>
      <button class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold me-1" data-mail="${c.id}">✉️ Correo</button>
    `;

    if (c.estado === "PENDIENTE" || c.estado === "NO_APROBADO") {
      acciones += `<button class="btn btn-sm btn-success py-0 px-2 fw-bold me-1" data-aprobar="${c.id}">✓ Aprobar y Enviar a Supervisión</button>`;
    }
    if (c.estado === "PENDIENTE") {
      acciones += `<button class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold" data-rechazar="${c.id}" title="Marcar No Aprobado">✖</button>`;
    }

    tr.innerHTML = `
      <td class="fw-bold text-primary">${c.codigo_cotizacion}</td>
      <td>${new Date(c.creado_en).toLocaleDateString("es-EC")}</td>
      <td><div class="fw-bold">${c.cliente_nombre}</div><small class="text-muted">${c.cliente_ruc || "-"}</small></td>
      <td><div>${c.cliente_contacto || "-"}</div><small class="text-primary">${c.cliente_correo || "-"} | ${c.cliente_telefono || ""}</small></td>
      <td class="text-start">
        <span class="badge bg-secondary mb-1">${c.tipo_servicio || "SERVICIO"}</span>
        <small class="text-muted">(${c.direccion_servicio || c.ciudad})</small>
        ${formatearListaItemsHTML(c)}
      </td>
      <td class="fw-bold">$${parseFloat(c.subtotal).toFixed(2)}</td>
      <td class="fw-bold text-success">$${parseFloat(c.total_cotizado).toFixed(2)}</td>
      <td><span class="badge badge-${c.estado} px-2 py-1">${etiquetaEstado}</span></td>
      <td class="no-print">${acciones}</td>
    `;

    tr.querySelector(`[data-editar="${c.id}"]`)?.addEventListener("click", () => prepararEdicionCotizacion(c));
    tr.querySelector(`[data-pdf="${c.id}"]`)?.addEventListener("click", () => imprimirCotizacionPDF(c));
    tr.querySelector(`[data-mail="${c.id}"]`)?.addEventListener("click", () => enviarCotizacionPorCorreo(c));
    tr.querySelector(`[data-aprobar="${c.id}"]`)?.addEventListener("click", () => aprobarYCrearServicio(c));
    tr.querySelector(`[data-rechazar="${c.id}"]`)?.addEventListener("click", async () => {
      await supabase.from("crm_cotizaciones").update({ estado: "NO_APROBADO" }).eq("id", c.id);
      await cargarBaseDatosCRM();
    });

    tbody.appendChild(tr);
  });
}

// =====================================================================
// PESTAÑA 3: APROBAR COTIZACIÓN -> ENVIAR SERVICIO A SUPERVISIÓN
// =====================================================================
async function aprobarYCrearServicio(cot) {
  if (!confirm(`¿Aprobar la cotización ${cot.codigo_cotizacion} de "${cot.cliente_nombre}" y enviar el Servicio a SUPERVISIÓN (Operaciones)?`)) return;

  const codigoServicio = cot.codigo_cotizacion.replace("COT-", "SRV-");

  const { error: errSrv } = await supabase.from("crm_servicios").upsert([{
    cotizacion_id: cot.id,
    codigo_servicio: codigoServicio,
    cliente_nombre: cot.cliente_nombre,
    nombre_punto: cot.direccion_servicio || cot.cliente_nombre,
    ciudad: cot.ciudad || "Quito",
    presupuesto_cotizado: cot.subtotal,
    estado_servicio: "APROBADO",
    estado_flujo: "CREADO_CRM"
  }], { onConflict: "codigo_servicio" });

  if (errSrv) {
    alert("Error al crear servicio en CRM: " + errSrv.message);
    return;
  }

  await supabase.from("crm_cotizaciones").update({
    estado: "APROBADO",
    fecha_aprobacion: new Date().toISOString()
  }).eq("id", cot.id);

  mostrarAlertaCRM(`🟢 Servicio ${codigoServicio} creado y enviado a SUPERVISIÓN para asignar responsable, personal, insumos y viáticos.`);
  await cargarBaseDatosCRM();
  document.getElementById("btnIrTabServicios").click();
}

function renderizarTablaServicios() {
  const tbody = document.getElementById("tbodyServiciosActivos");
  tbody.innerHTML = "";

  if (servicios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Aún no hay servicios aprobados.</td></tr>';
    return;
  }

  servicios.forEach(s => {
    const cot = cotizaciones.find(c => c.id === s.cotizacion_id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold text-primary">${s.codigo_servicio}</td>
      <td>${cot ? cot.codigo_cotizacion : "-"}</td>
      <td><div class="fw-bold">${s.cliente_nombre}</div><small class="text-muted">${s.ciudad} — ${s.nombre_punto}</small></td>
      <td class="fw-semibold">${s.supervisor_nombre ? `👷 ${s.supervisor_nombre}` : '<span class="text-danger">Pendiente en Supervisión</span>'}</td>
      <td>${new Date(s.creado_en).toLocaleDateString("es-EC")}</td>
      <td class="text-center">${badgeEstadoFlujo360(s.estado_flujo)}</td>
      <td class="text-center no-print">
        <button class="btn btn-sm btn-dark py-0 px-2 fw-bold" data-ver360="${s.id}">🔍 Ver 360°</button>
      </td>
    `;

    tr.querySelector(`[data-ver360="${s.id}"]`).addEventListener("click", () => abrirDetalle360Servicio(s));
    tbody.appendChild(tr);
  });
}

// =====================================================================
// PESTAÑA 4: SOLICITUDES DE VIÁTICOS / DINERO DESDE OPERACIONES
// =====================================================================
function renderizarTablaViaticosCRM() {
  const tbody = document.getElementById("tbodyViaticosCRM");
  const badgePend = document.getElementById("badgePendViaticosCRM");
  const badgeTotal = document.getElementById("badgeTotalViaticosCRM");

  const pendientes = viaticosSolicitados.filter(v => v.estado_viatico === "SOLICITADO_CRM").length;
  badgeTotal.innerText = `${viaticosSolicitados.length} solicitudes`;
  if (pendientes > 0) {
    badgePend.style.display = "inline-block";
    badgePend.innerText = pendientes;
  } else {
    badgePend.style.display = "none";
  }

  tbody.innerHTML = "";
  if (viaticosSolicitados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-3">Aún no hay solicitudes de viáticos aprobadas desde Operaciones.</td></tr>';
    return;
  }

  viaticosSolicitados.forEach(v => {
    const srv = servicios.find(s => s.id === v.servicio_id);
    const entregado = v.estado_viatico === "ENTREGADO";
    const badgeEst = entregado
      ? '<span class="badge bg-success">✅ DESEMBOLSADO</span>'
      : '<span class="badge bg-warning text-dark">⏳ PENDIENTE PAGO</span>';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold text-primary">${v.codigo_servicio}</td>
      <td>
        <div class="fw-bold">${srv ? srv.cliente_nombre : "-"}</div>
        <small class="text-muted">Sup: ${srv ? (srv.supervisor_nombre || "-") : "-"}</small>
      </td>
      <td class="text-end">$${Number(v.alimentacion || 0).toFixed(2)}</td>
      <td class="text-end">$${Number(v.combustible || 0).toFixed(2)}</td>
      <td class="text-end">$${Number(v.bebidas || 0).toFixed(2)}</td>
      <td class="text-end">$${Number(v.logistica || 0).toFixed(2)}</td>
      <td class="text-end">
        <div>$${Number(v.gastos_varios || 0).toFixed(2)}</div>
        ${v.detalle_gastos_varios ? `<small class="text-muted">${v.detalle_gastos_varios}</small>` : ""}
      </td>
      <td class="text-end fw-bold text-success fs-6">$${Number(v.total_solicitado || 0).toFixed(2)}</td>
      <td class="text-center">${badgeEst}</td>
      <td class="text-center no-print">
        ${entregado
          ? '<span class="text-muted small">Completado</span>'
          : `<button class="btn btn-sm btn-success py-0 px-2 fw-bold" data-pagar-via="${v.id}">💵 Marcar Entregado</button>`}
      </td>
    `;

    tr.querySelector(`[data-pagar-via="${v.id}"]`)?.addEventListener("click", async () => {
      if (!confirm(`¿Confirmar entrega de $${Number(v.total_solicitado || 0).toFixed(2)} en viáticos para ${v.codigo_servicio}?`)) return;
      const { error } = await supabase
        .from("crm_servicios_viaticos")
        .update({ estado_viatico: "ENTREGADO" })
        .eq("id", v.id);
      if (error) {
        alert("Error al actualizar viático: " + error.message);
        return;
      }
      mostrarAlertaCRM(`💵 Viáticos de ${v.codigo_servicio} marcados como ENTREGADOS.`);
      await cargarBaseDatosCRM();
    });

    tbody.appendChild(tr);
  });
}

// =====================================================================
// PESTAÑA 5: CONTROL 360°, GRÁFICAS Y MATRIZ COSTO VS GASTO REAL
// =====================================================================
function calcularDesgloseFinancieroServicio(servicioId) {
  const itemsBodega = movimientosBodega.filter(b => b.servicio_id === servicioId);
  const itemsGastos = gastosSupervision.filter(g => g.servicio_id === servicioId);

  let gastoInsumosNoDevueltos = 0;
  itemsBodega.forEach(b => {
    const noDev = Math.max(0, (parseFloat(b.cantidad_entregada) || 0) - (parseFloat(b.cantidad_devuelta) || 0));
    gastoInsumosNoDevueltos += noDev * (parseFloat(b.costo_unitario) || 0);
  });

  let gastoAlimentacion = 0;
  let gastoCombustible = 0;
  let gastoOtros = 0;

  itemsGastos.forEach(g => {
    const m = parseFloat(g.monto) || 0;
    if (g.categoria === "ALIMENTACION") gastoAlimentacion += m;
    else if (g.categoria === "COMBUSTIBLE") gastoCombustible += m;
    else gastoOtros += m;
  });

  const gastoTotalReal = +(gastoInsumosNoDevueltos + gastoAlimentacion + gastoCombustible + gastoOtros).toFixed(2);
  return {
    insumos: +gastoInsumosNoDevueltos.toFixed(2),
    alimentacion: +gastoAlimentacion.toFixed(2),
    combustible: +gastoCombustible.toFixed(2),
    otrosGastos: +gastoOtros.toFixed(2),
    totalReal: gastoTotalReal,
    itemsBodega,
    itemsGastos
  };
}

function renderizarSemaforoYMatriz() {
  const estados = [
    { key: "PENDIENTE", id: "semCantPendiente" },
    { key: "NO_APROBADO", id: "semCantNoAprobado" },
    { key: "APROBADO", id: "semCantAprobado" },
    { key: "REALIZADO", id: "semCantRealizado" }
  ];

  const conteos = [];
  estados.forEach(e => {
    const sub = cotizaciones.filter(c => c.estado === e.key);
    const monto = sub.reduce((acc, x) => acc + (parseFloat(x.subtotal) || 0), 0);
    document.getElementById(e.id).innerText = `${sub.length} ($${monto.toFixed(2)})`;
    conteos.push(sub.length);
  });

  const tbody = document.getElementById("tbodyMatrizRentabilidad");
  tbody.innerHTML = "";

  const labelsSrv = [];
  const dataCotizado = [];
  const dataReal = [];

  servicios.forEach(s => {
    const d = calcularDesgloseFinancieroServicio(s.id);
    const cotizado = parseFloat(s.presupuesto_cotizado) || 0;
    const utilidad = +(cotizado - d.totalReal).toFixed(2);

    labelsSrv.push(s.codigo_servicio);
    dataCotizado.push(cotizado);
    dataReal.push(d.totalReal);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold text-primary">${s.codigo_servicio}</td>
      <td><div class="fw-bold">${s.cliente_nombre}</div><small class="text-muted">Sup: ${s.supervisor_nombre || "Sin asignar"}</small></td>
      <td class="text-center">${badgeEstadoFlujo360(s.estado_flujo)}</td>
      <td class="fw-bold text-primary">$${cotizado.toFixed(2)}</td>
      <td class="text-danger fw-semibold">$${d.insumos.toFixed(2)}</td>
      <td class="text-danger">$${d.alimentacion.toFixed(2)}</td>
      <td class="text-danger">$${d.combustible.toFixed(2)}</td>
      <td class="text-danger">$${d.otrosGastos.toFixed(2)}</td>
      <td class="fw-bold bg-light text-danger">$${d.totalReal.toFixed(2)}</td>
      <td class="fw-bold ${utilidad >= 0 ? "text-success" : "text-danger"}">$${utilidad.toFixed(2)}</td>
      <td class="no-print">
        <button class="btn btn-sm btn-dark py-0 px-2 fw-bold" data-detalle="${s.id}">🔍 Abrir 360°</button>
      </td>
    `;
    tr.querySelector(`[data-detalle="${s.id}"]`).addEventListener("click", () => abrirDetalle360Servicio(s));
    tbody.appendChild(tr);
  });

  if (chartEstados) chartEstados.destroy();
  chartEstados = new window.Chart(document.getElementById("chartDistribucionCRM"), {
    type: "doughnut",
    data: {
      labels: ["Pendientes", "No Aprobados", "En Proceso Operativo", "Terminados (Facturar)"],
      datasets: [{ data: conteos, backgroundColor: ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6"] }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  if (chartComparativo) chartComparativo.destroy();
  chartComparativo = new window.Chart(document.getElementById("chartCostoVsGastoCRM"), {
    type: "bar",
    data: {
      labels: labelsSrv.slice(0, 10),
      datasets: [
        { label: "Valor Cotizado ($)", data: dataCotizado.slice(0, 10), backgroundColor: "#0284c7" },
        { label: "Gasto Real Total ($)", data: dataReal.slice(0, 10), backgroundColor: "#dc2626" }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function abrirDetalle360Servicio(s) {
  const d = calcularDesgloseFinancieroServicio(s.id);
  const via = viaticosSolicitados.find(v => v.servicio_id === s.id);
  const cotizado = parseFloat(s.presupuesto_cotizado) || 0;
  const utilidad = +(cotizado - d.totalReal).toFixed(2);

  document.getElementById("tituloModalDetalleCRM").innerText =
    `🔍 Expediente 360°: ${s.codigo_servicio} — ${s.cliente_nombre}`;

  const filasBodega = d.itemsBodega.map(b => {
    const noDev = Math.max(0, (parseFloat(b.cantidad_entregada) || 0) - (parseFloat(b.cantidad_devuelta) || 0));
    const costo = +(noDev * (parseFloat(b.costo_unitario) || 0)).toFixed(2);
    return `<tr>
      <td><span class="badge bg-secondary">${b.categoria || "INSUMO"}</span></td>
      <td>${b.insumo_nombre}</td>
      <td class="text-center">${b.cantidad_solicitada || 0}</td>
      <td class="text-center">${b.cantidad_entregada || 0}</td>
      <td class="text-center">${b.cantidad_devuelta || 0}</td>
      <td class="text-center fw-bold text-danger">${noDev}</td>
      <td class="text-end fw-bold text-danger">$${costo.toFixed(2)}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="7" class="text-center text-muted">Sin movimientos en Bodega de Inventarios.</td></tr>';

  const filasGastos = d.itemsGastos.map(g => `<tr>
    <td>${g.fecha_gasto || "-"}</td>
    <td><span class="badge bg-secondary">${g.categoria}</span></td>
    <td>${g.numero_factura || "-"}</td>
    <td>${g.descripcion}</td>
    <td class="text-end fw-bold text-danger">$${parseFloat(g.monto).toFixed(2)}</td>
    <td class="text-center">${g.foto_factura_url ? `<a href="${g.foto_factura_url}" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2">📷 Ver</a>` : "-"}</td>
  </tr>`).join("") || '<tr><td colspan="6" class="text-center text-muted">Sin facturas registradas en Supervisión.</td></tr>';

  document.getElementById("cuerpoModalDetalleCRM").innerHTML = `
    <div class="p-2 mb-3 border rounded bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div>
        <strong>Supervisor:</strong> ${s.supervisor_nombre || "Sin asignar"} |
        <strong>Bodega Entregada:</strong> ${s.bodega_entregado ? "✅ Sí" : "⏳ No"} |
        <strong>Campo Cerrado:</strong> ${s.campo_cerrado ? "✅ Sí" : "⏳ No"} |
        <strong>Bodega Cerrada:</strong> ${s.bodega_cerrado ? "✅ Sí" : "⏳ No"}
      </div>
      <div>${badgeEstadoFlujo360(s.estado_flujo)}</div>
    </div>

    <div class="row g-2 mb-3 text-center">
      <div class="col-md-3"><div class="p-2 border rounded bg-light"><div>VALOR COTIZADO</div><strong class="fs-6 text-primary">$${cotizado.toFixed(2)}</strong></div></div>
      <div class="col-md-3"><div class="p-2 border rounded bg-light"><div>VIÁTICOS SOLICITADOS</div><strong class="fs-6 text-dark">$${via ? Number(via.total_solicitado || 0).toFixed(2) : "0.00"}</strong></div></div>
      <div class="col-md-3"><div class="p-2 border rounded bg-light"><div>GASTO REAL TOTAL</div><strong class="fs-6 text-danger">$${d.totalReal.toFixed(2)}</strong></div></div>
      <div class="col-md-3"><div class="p-2 border rounded bg-light"><div>MARGEN / UTILIDAD</div><strong class="fs-6 ${utilidad >= 0 ? "text-success" : "text-danger"}">$${utilidad.toFixed(2)}</strong></div></div>
    </div>

    <h6 class="fw-bold text-dark">📦 1. Insumos y Maquinaria (Operaciones ➔ Inventarios)</h6>
    <div class="table-responsive mb-3">
      <table class="table table-sm table-bordered">
        <thead class="table-dark text-center"><tr><th>Cat.</th><th>Insumo / Equipo</th><th>Solic.</th><th>Entreg.</th><th>Devuelto</th><th>No Dev.</th><th>Gasto Real</th></tr></thead>
        <tbody>${filasBodega}</tbody>
      </table>
    </div>

    <h6 class="fw-bold text-dark">🧾 2. Gastos Reales y Facturas (Supervisión)</h6>
    <div class="table-responsive mb-3">
      <table class="table table-sm table-bordered">
        <thead class="table-dark text-center"><tr><th>Fecha</th><th>Categoría</th><th>Factura</th><th>Detalle</th><th>Monto</th><th>Foto</th></tr></thead>
        <tbody>${filasGastos}</tbody>
      </table>
    </div>

    <div class="p-3 border rounded bg-light">
      <h6 class="fw-bold text-primary mb-1">✅ 3. Recibí Conforme e Informe Final (Supervisión)</h6>
      <div><strong>Recibido Conforme por:</strong> ${s.recibi_conforme_nombre || "Pendiente de cierre en Supervisión"} (${s.recibi_conforme_cedula || "-"})</div>
      <div><strong>Observaciones Informe Final:</strong> ${s.informe_final_observaciones || "-"}</div>
      ${s.foto_recibi_conforme_url ? `<div class="mt-2"><a href="${s.foto_recibi_conforme_url}" target="_blank" class="btn btn-sm btn-success fw-bold">📷 Ver Foto de Recibí Conforme Físico ↗</a></div>` : ""}
    </div>
  `;

  new window.bootstrap.Modal(document.getElementById("modalDetalleServicioCRM")).show();
}

function enviarCotizacionPorCorreo(c) {
  const desglose = Array.isArray(c.items_cotizados) && c.items_cotizados.length > 0
    ? c.items_cotizados.map((it, i) => `  ${i + 1}. ${it.descripcion}: $${parseFloat(it.valor).toFixed(2)}`).join("\n")
    : `  • ${c.descripcion_servicio}: $${parseFloat(c.subtotal).toFixed(2)}`;

  const subject = encodeURIComponent(`Cotización ${c.codigo_cotizacion} - Cleanings Ecuador`);
  const body = encodeURIComponent(
    `Estimado/a ${c.cliente_contacto || c.cliente_nombre},\n\n` +
    `Remitimos para su revisión la Cotización N° ${c.codigo_cotizacion}:\n\n` +
    `DESGLOSE DE SERVICIOS:\n${desglose}\n\n` +
    `Subtotal: $${parseFloat(c.subtotal).toFixed(2)}\n` +
    `IVA (15%): $${parseFloat(c.iva).toFixed(2)}\n` +
    `Total: $${parseFloat(c.total_cotizado).toFixed(2)}\n\n` +
    `Atentamente,\nDepartamento Comercial`
  );
  window.open(`mailto:${c.cliente_correo}?subject=${subject}&body=${body}`, "_blank");
}

function imprimirCotizacionPDF(c) {
  const filasItems = Array.isArray(c.items_cotizados) && c.items_cotizados.length > 0
    ? c.items_cotizados.map((it, i) => `<tr><td>${i + 1}</td><td>${it.descripcion}</td><td style="text-align:right;">$${parseFloat(it.valor).toFixed(2)}</td></tr>`).join("")
    : `<tr><td>1</td><td>${c.descripcion_servicio}</td><td style="text-align:right;">$${parseFloat(c.subtotal).toFixed(2)}</td></tr>`;

  const v = window.open("", "_blank");
  v.document.write(`
    <html><head><title>Cotización ${c.codigo_cotizacion}</title>
    <style>
      body{font-family:Arial;padding:30px;color:#0f172a}
      .box{border:1px solid #cbd5e1;padding:15px;border-radius:8px;margin-top:15px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #cbd5e1;padding:8px;font-size:13px}
      th{background:#0f172a;color:#fff}
    </style></head>
    <body>
      <h2>PROPUESTA TÉCNICA Y ECONÓMICA — ${c.codigo_cotizacion}</h2>
      <div class="box">
        <p><strong>Cliente:</strong> ${c.cliente_nombre} | <strong>RUC:</strong> ${c.cliente_ruc || "-"}</p>
        <p><strong>Contacto:</strong> ${c.cliente_contacto || "-"} | <strong>Correo:</strong> ${c.cliente_correo || "-"}</p>
        <p><strong>Dirección / Punto:</strong> ${c.ciudad} - ${c.direccion_servicio || "-"}</p>
      </div>
      <div class="box">
        <h4>Desglose de Servicios Cotizados (${c.tipo_servicio})</h4>
        <table>
          <thead><tr><th style="width:40px;">#</th><th>Descripción del Servicio / Rubro</th><th style="width:130px;">Valor Sin IVA</th></tr></thead>
          <tbody>${filasItems}</tbody>
        </table>
        <div style="text-align:right; margin-top:12px;">
          <p><strong>Subtotal:</strong> $${parseFloat(c.subtotal).toFixed(2)}</p>
          <p><strong>IVA 15%:</strong> $${parseFloat(c.iva).toFixed(2)}</p>
          <h3>TOTAL COTIZADO: $${parseFloat(c.total_cotizado).toFixed(2)}</h3>
        </div>
      </div>
      <script>window.print();<\/script>
    </body></html>
  `);
  v.document.close();
}