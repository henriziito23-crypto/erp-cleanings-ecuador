// =====================================================================
// ARCHIVO: modulo-supervision/js/supervision.ctrl.js
// Controlador Operativo de Supervisión:
// 1) Servicios Eventuales (CRM -> Personal/QR -> Insumos -> Viáticos -> Gastos -> Cierre -> Informe PDF)
// 2) Contratos Fijos (Semáforo en Vivo, Coberturas y Novedades)
// =====================================================================
import { supabase, subirFotoHisopadoStorage } from "../../core/supabaseClient.js";
import { obtenerSesionActiva } from "../../core/router.js";

let sesion = null;

// --- Estado Servicios Eventuales ---
let listaServiciosCRM = [];
let listaTodosUsuarios = [];
let listaCatalogoInv = [];
let listaPersonalSrv = [];
let listaInsumosSrv = [];
let viaticoActualSrv = null;
let listaGastosSrv = [];
let fotosInformeActual = []; // Array de URLs (máx 6)

let fotoGastoBase64 = "";
let fotoRecibiBase64 = "";

// --- Estado Contratos Fijos ---
let contratos = [];
let usuariosContrato = [];
let fotoEvidenciaBase64 = "";

document.addEventListener("DOMContentLoaded", async () => {
  sesion = obtenerSesionActiva();
  if (sesion) {
    const lbl = document.getElementById("lblUsuarioActivoSup");
    if (lbl) lbl.innerText = `👤 ${sesion.nombre} (${sesion.rol})`;
  }

  const hoyISO = new Date().toISOString().split("T")[0];
  document.getElementById("supFecha").value = hoyISO;
  document.getElementById("gasFecha").value = hoyISO;

  // --- Eventos Servicios Eventuales ---
  document.getElementById("selServicioEventualSup").addEventListener("change", cargarDetallesServicioEventual);
  document.getElementById("btnRefrescarEventuales").addEventListener("click", cargarModuloEventuales);

  document.getElementById("formAsignarPersonalSrv").addEventListener("submit", agregarPersonalAlServicio);
  document.getElementById("selCatalogoInvSup").addEventListener("change", alElegirCatalogoInvSup);
  document.getElementById("formPedirInsumoEv").addEventListener("submit", agregarInsumoAlPedido);

  document.querySelectorAll(".inp-viatico").forEach(inp => {
    inp.addEventListener("input", recalcularTotalViaticos);
  });
  document.getElementById("formViaticosEv").addEventListener("submit", guardarBorradorViaticos);
  document.getElementById("btnPdfConsolidadoEv").addEventListener("click", imprimirPdfConsolidadoPedido);
  document.getElementById("btnCorreoConsolidadoEv").addEventListener("click", enviarCorreoConsolidadoPedido);
  document.getElementById("btnAprobarPedidoEv").addEventListener("click", aprobarPedidoCompleto);

  document.getElementById("gasFotoInput").addEventListener("change", e => comprimirImagenInput(e, b64 => (fotoGastoBase64 = b64)));
  document.getElementById("formGastoRealEv").addEventListener("submit", registrarGastoRealServicio);

  document.getElementById("cieFotoRecibi").addEventListener("change", e => comprimirImagenInput(e, b64 => (fotoRecibiBase64 = b64)));
  document.getElementById("formCierreCampoEv").addEventListener("submit", culminarServicioEnCampo);

  document.getElementById("infInputFotos").addEventListener("change", procesarFotosInformeFinal);
  document.getElementById("btnGuardarInformeEv").addEventListener("click", guardarInformeFinalServicio);
  document.getElementById("btnGenerarPdfInformeEv").addEventListener("click", generarPdfInformeFinal);

  // --- Eventos Contratos Fijos ---
  document.getElementById("supContrato").addEventListener("change", cargarPanelSupervision);
  document.getElementById("supFecha").addEventListener("change", cargarPanelSupervision);
  document.getElementById("btnRefrescarSupervision").addEventListener("click", cargarPanelSupervision);
  document.getElementById("formSupCrearServicio").addEventListener("submit", crearServicioYReasignarPersonal);
  document.getElementById("supNovFoto").addEventListener("change", e => comprimirImagenInput(e, b64 => (fotoEvidenciaBase64 = b64)));
  document.getElementById("formSupNovedad").addEventListener("submit", registrarPermisoOCambioSupervision);

  // Carga inicial paralela
  await Promise.all([
    cargarModuloEventuales(),
    iniciarContratosSupervision()
  ]);

  iniciarSuscripcionEnVivo();
});

function mostrarAviso(msg) {
  const b = document.getElementById("msgFeedbackSup");
  b.innerText = msg;
  b.style.display = "block";
  setTimeout(() => (b.style.display = "none"), 4500);
}

function comprimirImagenInput(e, callback) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxW = 900;
      const escala = img.width > maxW ? maxW / img.width : 1;
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL("image/jpeg", 0.78));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function obtenerUrlRaizERP() {
  return window.location.origin + window.location.pathname.replace(/\/modulo-supervision\/views\/supervision\.html$/i, "");
}

// =====================================================================
// MÓDULO 1: SERVICIOS EVENTUALES (CARGA MAESTRA Y CANDADOS)
// =====================================================================
async function cargarModuloEventuales(mantenerId = "") {
  const prevId = mantenerId || document.getElementById("selServicioEventualSup").value;

  const [resSrv, resUsu, resCat] = await Promise.all([
    supabase.from("crm_servicios").select("*").order("creado_en", { ascending: false }),
    supabase.rpc("listar_usuarios_asistencia", { p_contrato_id: null }),
    supabase.from("inventarios_catalogo").select("*").eq("activo", true).order("nombre_insumo", { ascending: true })
  ]);

  listaServiciosCRM = resSrv.data || [];
  listaTodosUsuarios = resUsu.data || [];
  listaCatalogoInv = resCat.data || [];

  // Poblar selector global de Servicios Eventuales
  const selSrv = document.getElementById("selServicioEventualSup");
  selSrv.innerHTML = "";
  if (listaServiciosCRM.length === 0) {
    selSrv.innerHTML = '<option value="">-- No hay servicios creados desde el CRM todavía --</option>';
  } else {
    listaServiciosCRM.forEach(s => {
      const supTxt = s.supervisor_nombre ? `Sup: ${s.supervisor_nombre}` : "SIN SUPERVISOR";
      selSrv.appendChild(new Option(`${s.codigo_servicio} — ${s.cliente_nombre} [${supTxt}]`, s.id));
    });
    if (prevId && listaServiciosCRM.some(x => x.id === prevId)) {
      selSrv.value = prevId;
    } else {
      selSrv.value = listaServiciosCRM[0].id;
    }
  }

  // Poblar selector de personal de Nómina (Subpestaña 2)
  const selPers = document.getElementById("selPersonalNominaSrv");
  selPers.innerHTML = '<option value="">-- Seleccione trabajador de Nómina --</option>';
  listaTodosUsuarios.forEach(u => {
    selPers.appendChild(new Option(`${u.nombre_completo} (${u.cargo_etiqueta || u.rol})`, u.id));
  });

  // Poblar selector de catálogo de Inventarios (Subpestaña 3)
  const selCat = document.getElementById("selCatalogoInvSup");
  selCat.innerHTML = '<option value="">-- Seleccione insumo, herramienta o maquinaria --</option>';
  listaCatalogoInv.forEach(c => {
    selCat.appendChild(new Option(`[${c.categoria}] ${c.nombre_insumo} — Stock: ${c.stock_actual} ${c.unidad}`, c.id));
  });

  renderizarTablaServiciosCRM();
  await cargarDetallesServicioEventual();
}

function obtenerServicioActivo() {
  const id = document.getElementById("selServicioEventualSup").value;
  return listaServiciosCRM.find(s => s.id === id) || null;
}

function badgeEstadoFlujo(estado) {
  const mapa = {
    CREADO_CRM: { cls: "bg-warning text-dark", txt: "🟡 CREADO EN CRM (Sin Supervisor)" },
    SUPERVISOR_ASIGNADO: { cls: "bg-info text-dark", txt: "🔵 SUPERVISOR ASIGNADO (En Pedido)" },
    PEDIDO_APROBADO: { cls: "bg-primary", txt: "📦 PEDIDO APROBADO (En Bodega / CRM)" },
    EN_PROCESO: { cls: "bg-success", txt: "🚀 EN PROCESO (Insumos Entregados)" },
    CULMINADO_CAMPO: { cls: "bg-dark", txt: "🏁 CULMINADO CAMPO (Falta Retorno Bodega)" },
    TERMINADO_FACTURAR: { cls: "bg-success border border-dark", txt: "✅ SERVICIO TERMINADO — FACTURAR" }
  };
  const info = mapa[estado] || mapa.CREADO_CRM;
  return `<span class="badge ${info.cls} badge-flujo">${info.txt}</span>`;
}

// =====================================================================
// SUBPESTAÑA 1: SERVICIOS DE LIMPIEZA Y ASIGNACIÓN DE SUPERVISOR
// =====================================================================
function renderizarTablaServiciosCRM() {
  const tbody = document.getElementById("tbodyServiciosCRM");
  tbody.innerHTML = "";

  if (listaServiciosCRM.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Aún no hay servicios aprobados desde el CRM.</td></tr>';
    return;
  }

  const soloSupervisores = listaTodosUsuarios.filter(
    u => (u.rol || "").toUpperCase() === "SUPERVISOR"
  );

  const opcionesSup = soloSupervisores
    .map(u => `<option value="${u.id}">${u.nombre_completo}</option>`)
    .join("");

  listaServiciosCRM.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold text-primary">${s.codigo_servicio}</td>
      <td><div class="fw-bold">${s.cliente_nombre}</div><small class="text-muted">${s.nombre_punto || ""}</small></td>
      <td>${s.ciudad || "Quito"}</td>
      <td class="text-center">${badgeEstadoFlujo(s.estado_flujo)}</td>
      <td>
        <select class="form-select form-select-sm fw-bold" id="selSup_${s.id}">
          <option value="">-- Designar Supervisor --</option>
          ${opcionesSup}
        </select>
      </td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-primary fw-bold py-1 px-2" data-asignar-sup="${s.id}">
          💾 Asignar
        </button>
      </td>
    `;

    const sel = tr.querySelector(`#selSup_${s.id}`);
    if (s.supervisor_id) sel.value = s.supervisor_id;

    tr.querySelector(`[data-asignar-sup="${s.id}"]`).addEventListener("click", async () => {
      const supId = sel.value;
      if (!supId) {
        alert("Seleccione un supervisor de la lista de Nómina.");
        return;
      }
      const uSup = listaTodosUsuarios.find(u => u.id === supId);
      const nuevoEstado = (!s.estado_flujo || s.estado_flujo === "CREADO_CRM") ? "SUPERVISOR_ASIGNADO" : s.estado_flujo;

      const { error } = await supabase
        .from("crm_servicios")
        .update({
          supervisor_id: uSup.id,
          supervisor_nombre: uSup.nombre_completo,
          estado_flujo: nuevoEstado
        })
        .eq("id", s.id);

      if (error) {
        alert("Error al asignar supervisor: " + error.message);
        return;
      }

      mostrarAviso(`✅ Supervisor ${uSup.nombre_completo} asignado a ${s.codigo_servicio}. Subpestañas habilitadas.`);
      await cargarModuloEventuales(s.id);
    });

    tbody.appendChild(tr);
  });
}

// =====================================================================
// CARGA DE DETALLES DEL SERVICIO ACTIVO Y CONTROL DE CANDADOS
// =====================================================================
async function cargarDetallesServicioEventual() {
  const srv = obtenerServicioActivo();
  const subBotones = ["btnSubEv2", "btnSubEv3", "btnSubEv4", "btnSubEv5", "btnSubEv6", "btnSubEv7"];

  if (!srv || !srv.supervisor_id) {
    subBotones.forEach(id => document.getElementById(id).classList.add("disabled"));
    document.getElementById("lblInfoServicioActivoSup").innerHTML = srv
      ? `<span class="text-danger">⚠️ Asigne un supervisor en la Subpestaña 1 para desbloquear</span>`
      : "Seleccione un servicio";
    return;
  }

  // Desbloquear subpestañas 2 a 7
  subBotones.forEach(id => document.getElementById(id).classList.remove("disabled"));
  document.getElementById("lblInfoServicioActivoSup").innerHTML =
    `👷 ${srv.supervisor_nombre} &nbsp;|&nbsp; ${badgeEstadoFlujo(srv.estado_flujo)}`;

  const [resPers, resIns, resVia, resGas] = await Promise.all([
    supabase.from("crm_servicios_personal").select("*").eq("servicio_id", srv.id).order("usuario_nombre"),
    supabase.from("crm_servicios_bodega").select("*").eq("servicio_id", srv.id).order("fecha_movimiento"),
    supabase.from("crm_servicios_viaticos").select("*").eq("servicio_id", srv.id).maybeSingle(),
    supabase.from("crm_servicios_gastos").select("*").eq("servicio_id", srv.id).order("fecha_gasto", { ascending: false })
  ]);

  listaPersonalSrv = resPers.data || [];
  listaInsumosSrv = resIns.data || [];
  viaticoActualSrv = resVia.data || null;
  listaGastosSrv = resGas.data || [];

  renderizarSub2PersonalYQR(srv);
  renderizarSub3Insumos(srv);
  renderizarSub4Viaticos(srv);
  renderizarSub5Gastos();
  renderizarSub6Cierre(srv);
  renderizarSub7Informe(srv);
}

// =====================================================================
// SUBPESTAÑA 2: PERSONAL Y QR DE ASISTENCIA
// =====================================================================
function renderizarSub2PersonalYQR(srv) {
  const tbody = document.getElementById("tbodyPersonalAsignadoSrv");
  tbody.innerHTML = "";

  if (listaPersonalSrv.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Sin personal asignado todavía.</td></tr>';
  } else {
    listaPersonalSrv.forEach((p, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center fw-bold text-muted">${idx + 1}</td>
        <td class="fw-bold">${p.usuario_nombre}</td>
        <td>${p.cargo || "AUXILIAR"}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-del-pers="${p.id}">🗑️</button>
        </td>
      `;
      tr.querySelector(`[data-del-pers="${p.id}"]`).addEventListener("click", async () => {
        await supabase.from("crm_servicios_personal").delete().eq("id", p.id);
        await cargarDetallesServicioEventual();
      });
      tbody.appendChild(tr);
    });
  }

  const urlQR = `${obtenerUrlRaizERP()}/asistencia-qr.html?servicio=${encodeURIComponent(srv.codigo_servicio)}`;
  const imgQR = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=${encodeURIComponent(urlQR)}`;
  document.getElementById("lblQrEvCodigo").innerText = `${srv.codigo_servicio} — ${srv.cliente_nombre}`;
  document.getElementById("imgQrEvServicio").src = imgQR;
  document.getElementById("linkAbrirQrEv").href = urlQR;
  document.getElementById("linkImprimirQrEv").href = imgQR;
}

async function agregarPersonalAlServicio(e) {
  e.preventDefault();
  const srv = obtenerServicioActivo();
  const userId = document.getElementById("selPersonalNominaSrv").value;
  if (!srv || !userId) return;

  const u = listaTodosUsuarios.find(x => x.id === userId);
  if (!u) return;

  const { error } = await supabase.from("crm_servicios_personal").upsert([{
    servicio_id: srv.id,
    usuario_id: u.id,
    usuario_nombre: u.nombre_completo,
    cargo: u.cargo_etiqueta || u.rol
  }], { onConflict: "servicio_id,usuario_id" });

  if (error) {
    alert("Error al asignar personal: " + error.message);
    return;
  }

  mostrarAviso(`👥 ${u.nombre_completo} asignado al equipo de ${srv.codigo_servicio}.`);
  await cargarDetallesServicioEventual();
}

// =====================================================================
// SUBPESTAÑA 3: INSUMOS, HERRAMIENTAS Y MAQUINARIA
// =====================================================================
function alElegirCatalogoInvSup() {
  const catId = document.getElementById("selCatalogoInvSup").value;
  const item = listaCatalogoInv.find(c => c.id === catId);
  document.getElementById("txtCatInsumoSup").value = item ? item.categoria : "";
}

async function agregarInsumoAlPedido(e) {
  e.preventDefault();
  const srv = obtenerServicioActivo();
  const catId = document.getElementById("selCatalogoInvSup").value;
  const cant = parseFloat(document.getElementById("txtCantInsumoSup").value) || 0;
  if (!srv || !catId || cant <= 0) return;

  const item = listaCatalogoInv.find(c => c.id === catId);
  if (!item) return;

  const { error } = await supabase.from("crm_servicios_bodega").insert([{
    servicio_id: srv.id,
    codigo_servicio: srv.codigo_servicio,
    insumo_catalogo_id: item.id,
    insumo_nombre: item.nombre_insumo,
    categoria: item.categoria || "IMPLEMENTOS",
    unidad: item.unidad || "UND",
    cantidad_solicitada: cant,
    cantidad_entregada: 0,
    cantidad_devuelta: 0,
    costo_unitario: parseFloat(item.costo_unitario) || 0,
    estado_despacho: "SOLICITADO",
    responsable_retiro: srv.supervisor_nombre || ""
  }]);

  if (error) {
    alert("Error al añadir al pedido: " + error.message);
    return;
  }

  document.getElementById("txtCantInsumoSup").value = "1";
  mostrarAviso(`📦 Añadido al pedido: ${cant} ${item.unidad} de ${item.nombre_insumo}.`);
  await cargarDetallesServicioEventual();
}

function renderizarSub3Insumos(srv) {
  const tbody = document.getElementById("tbodyInsumosPedidosEv");
  tbody.innerHTML = "";

  if (listaInsumosSrv.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Aún no ha solicitado insumos ni maquinaria para este servicio.</td></tr>';
    return;
  }

  listaInsumosSrv.forEach((m, idx) => {
    const esMaq = (m.categoria || "").toUpperCase() === "MAQUINARIA";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center fw-bold text-muted">${idx + 1}</td>
      <td class="text-center"><span class="badge ${esMaq ? "bg-warning text-dark" : "bg-secondary"}">${m.categoria || "INSUMO"}</span></td>
      <td class="fw-bold">${m.insumo_nombre}</td>
      <td class="text-center">${m.unidad || "UND"}</td>
      <td class="text-center fw-bold text-primary">${m.cantidad_solicitada || m.cantidad_entregada}</td>
      <td class="text-center"><span class="badge bg-info text-dark">${m.estado_despacho || "SOLICITADO"}</span></td>
      <td class="text-center">
        ${m.estado_despacho === "ENTREGADO"
          ? '<span class="text-muted small">Entregado</span>'
          : `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-del-ins="${m.id}">🗑️</button>`}
      </td>
    `;
    tr.querySelector(`[data-del-ins="${m.id}"]`)?.addEventListener("click", async () => {
      await supabase.from("crm_servicios_bodega").delete().eq("id", m.id);
      await cargarDetallesServicioEventual();
    });
    tbody.appendChild(tr);
  });
}

// =====================================================================
// SUBPESTAÑA 4: VIÁTICOS, PDF CONSOLIDADO, CORREO Y APROBACIÓN
// =====================================================================
function recalcularTotalViaticos() {
  const alim = parseFloat(document.getElementById("viaAlimentacion").value) || 0;
  const comb = parseFloat(document.getElementById("viaCombustible").value) || 0;
  const bebi = parseFloat(document.getElementById("viaBebidas").value) || 0;
  const logi = parseFloat(document.getElementById("viaLogistica").value) || 0;
  const vari = parseFloat(document.getElementById("viaVarios").value) || 0;
  document.getElementById("viaTotal").value = (alim + comb + bebi + logi + vari).toFixed(2);
}

function renderizarSub4Viaticos(srv) {
  const v = viaticoActualSrv;
  document.getElementById("viaAlimentacion").value = v ? Number(v.alimentacion || 0).toFixed(2) : "0.00";
  document.getElementById("viaCombustible").value = v ? Number(v.combustible || 0).toFixed(2) : "0.00";
  document.getElementById("viaBebidas").value = v ? Number(v.bebidas || 0).toFixed(2) : "0.00";
  document.getElementById("viaLogistica").value = v ? Number(v.logistica || 0).toFixed(2) : "0.00";
  document.getElementById("viaVarios").value = v ? Number(v.gastos_varios || 0).toFixed(2) : "0.00";
  document.getElementById("viaDetalleVarios").value = v ? (v.detalle_gastos_varios || "") : "";
  recalcularTotalViaticos();

  const badge = document.getElementById("badgeEstadoPedidoEv");
  if (srv.pedido_aprobado) {
    badge.className = "badge bg-success";
    badge.innerText = `✅ APROBADO (${srv.pedido_aprobado_por || "SUPERVISIÓN"})`;
  } else {
    badge.className = "badge bg-warning text-dark";
    badge.innerText = "📝 BORRADOR (Pendiente de Aprobar)";
  }
}

async function guardarViaticosBD(estadoViatico = "BORRADOR") {
  const srv = obtenerServicioActivo();
  if (!srv) return false;

  const payload = {
    servicio_id: srv.id,
    codigo_servicio: srv.codigo_servicio,
    alimentacion: parseFloat(document.getElementById("viaAlimentacion").value) || 0,
    combustible: parseFloat(document.getElementById("viaCombustible").value) || 0,
    bebidas: parseFloat(document.getElementById("viaBebidas").value) || 0,
    logistica: parseFloat(document.getElementById("viaLogistica").value) || 0,
    gastos_varios: parseFloat(document.getElementById("viaVarios").value) || 0,
    detalle_gastos_varios: document.getElementById("viaDetalleVarios").value.trim(),
    total_solicitado: parseFloat(document.getElementById("viaTotal").value) || 0,
    estado_viatico: estadoViatico,
    solicitado_por: sesion ? sesion.nombre : srv.supervisor_nombre,
    aprobado_por: estadoViatico === "SOLICITADO_CRM" ? (sesion ? sesion.nombre : srv.supervisor_nombre) : null
  };

  const res = viaticoActualSrv
    ? await supabase.from("crm_servicios_viaticos").update(payload).eq("id", viaticoActualSrv.id)
    : await supabase.from("crm_servicios_viaticos").insert([payload]);

  if (res.error) {
    alert("Error al guardar viáticos: " + res.error.message);
    return false;
  }
  return true;
}

async function guardarBorradorViaticos(e) {
  e.preventDefault();
  const ok = await guardarViaticosBD(viaticoActualSrv?.estado_viatico || "BORRADOR");
  if (ok) {
    mostrarAviso("💾 Borrador de viáticos guardado correctamente.");
    await cargarDetallesServicioEventual();
  }
}

async function aprobarPedidoCompleto() {
  const srv = obtenerServicioActivo();
  if (!srv) return;

  if (!confirm(`¿Aprobar el pedido de ${srv.codigo_servicio}?\nEsto enviará los insumos/maquinaria a INVENTARIOS y la solicitud de viáticos al CRM.`)) return;

  const okVia = await guardarViaticosBD("SOLICITADO_CRM");
  if (!okVia) return;

  const nuevoFlujo = (srv.estado_flujo === "CREADO_CRM" || srv.estado_flujo === "SUPERVISOR_ASIGNADO")
    ? "PEDIDO_APROBADO"
    : srv.estado_flujo;

  const { error } = await supabase
    .from("crm_servicios")
    .update({
      pedido_aprobado: true,
      pedido_aprobado_por: sesion ? sesion.nombre : srv.supervisor_nombre,
      fecha_aprobacion_pedido: new Date().toISOString(),
      estado_flujo: nuevoFlujo
    })
    .eq("id", srv.id);

  if (error) {
    alert("Error al aprobar pedido: " + error.message);
    return;
  }

  mostrarAviso("✅ Pedido APROBADO. Insumos liberados a Bodega (Inventarios) y Viáticos enviados al CRM.");
  await cargarModuloEventuales(srv.id);
}

function imprimirPdfConsolidadoPedido() {
  const srv = obtenerServicioActivo();
  if (!srv) return;

  const filasIns = listaInsumosSrv.map((m, i) => `
    <tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${m.categoria || "INSUMO"}</td>
      <td><strong>${m.insumo_nombre}</strong></td>
      <td style="text-align:center;">${m.unidad || "UND"}</td>
      <td style="text-align:center; font-weight:bold;">${m.cantidad_solicitada || m.cantidad_entregada}</td>
    </tr>
  `).join("") || '<tr><td colspan="5" style="text-align:center;">Sin insumos solicitados</td></tr>';

  const v = {
    alim: parseFloat(document.getElementById("viaAlimentacion").value) || 0,
    comb: parseFloat(document.getElementById("viaCombustible").value) || 0,
    bebi: parseFloat(document.getElementById("viaBebidas").value) || 0,
    logi: parseFloat(document.getElementById("viaLogistica").value) || 0,
    vari: parseFloat(document.getElementById("viaVarios").value) || 0,
    det: document.getElementById("viaDetalleVarios").value || "-",
    tot: parseFloat(document.getElementById("viaTotal").value) || 0
  };

  const win = window.open("", "_blank");
  win.document.write(`
    <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Pedido Consolidado ${srv.codigo_servicio}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;font-size:12px}
      h2{margin:0 0 4px 0} .box{border:1px solid #cbd5e1;padding:12px;border-radius:6px;margin-bottom:14px;background:#f8fafc}
      table{width:100%;border-collapse:collapse;margin-bottom:14px}
      th,td{border:1px solid #94a3b8;padding:6px 8px} th{background:#0f172a;color:#fff;font-size:11px}
    </style></head><body>
      <h2>SOLICITUD OPERATIVA DE INSUMOS Y VIÁTICOS — ${srv.codigo_servicio}</h2>
      <div class="box">
        <strong>Cliente:</strong> ${srv.cliente_nombre} | <strong>Punto:</strong> ${srv.nombre_punto} (${srv.ciudad})<br>
        <strong>Supervisor Asignado:</strong> ${srv.supervisor_nombre} | <strong>Fecha:</strong> ${new Date().toLocaleDateString("es-EC")}
      </div>
      <h4>1. INSUMOS, HERRAMIENTAS Y MAQUINARIA REQUERIDOS (BODEGA)</h4>
      <table><thead><tr><th>#</th><th>Categoría</th><th>Descripción</th><th>Und</th><th>Cant.</th></tr></thead><tbody>${filasIns}</tbody></table>
      <h4>2. DESGLOSE DE VIÁTICOS SOLICITADOS (FINANZAS / CRM)</h4>
      <table>
        <thead><tr><th>Alimentación</th><th>Combustible</th><th>Bebidas</th><th>Logística</th><th>Gastos Varios</th><th>TOTAL ($)</th></tr></thead>
        <tbody><tr style="text-align:center;font-weight:bold;">
          <td>$${v.alim.toFixed(2)}</td><td>$${v.comb.toFixed(2)}</td><td>$${v.bebi.toFixed(2)}</td>
          <td>$${v.logi.toFixed(2)}</td><td>$${v.vari.toFixed(2)}</td><td style="color:#15803d;font-size:14px;">$${v.tot.toFixed(2)}</td>
        </tr></tbody>
      </table>
      <div class="box"><strong>Detalle Gastos Varios:</strong> ${v.det}</div>
      <script>window.print();<\/script>
    </body></html>
  `);
  win.document.close();
}

function enviarCorreoConsolidadoPedido() {
  const srv = obtenerServicioActivo();
  if (!srv) return;

  const listaTxt = listaInsumosSrv.map((m, i) => `  ${i + 1}. [${m.categoria}] ${m.insumo_nombre} — ${m.cantidad_solicitada} ${m.unidad}`).join("\n") || "  (Sin insumos)";
  const tot = document.getElementById("viaTotal").value;

  const subject = encodeURIComponent(`Pedido Insumos y Viáticos - ${srv.codigo_servicio} (${srv.cliente_nombre})`);
  const body = encodeURIComponent(
    `Estimados,\n\nSe remite la solicitud operativa para el servicio ${srv.codigo_servicio} — ${srv.cliente_nombre} (${srv.nombre_punto}).\n` +
    `Supervisor asignado: ${srv.supervisor_nombre}\n\n` +
    `INSUMOS Y MAQUINARIA:\n${listaTxt}\n\n` +
    `VIÁTICOS SOLICITADOS: $${tot}\n` +
    `- Alimentación: $${document.getElementById("viaAlimentacion").value}\n` +
    `- Combustible: $${document.getElementById("viaCombustible").value}\n` +
    `- Bebidas: $${document.getElementById("viaBebidas").value}\n` +
    `- Logística: $${document.getElementById("viaLogistica").value}\n` +
    `- Gastos Varios: $${document.getElementById("viaVarios").value} (${document.getElementById("viaDetalleVarios").value || "-"})\n\n` +
    `Saludos,\nOperaciones`
  );
  window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
}

// =====================================================================
// SUBPESTAÑA 5: REGISTRO DE GASTOS REALES Y FOTOS DE FACTURAS
// =====================================================================
async function registrarGastoRealServicio(e) {
  e.preventDefault();
  const srv = obtenerServicioActivo();
  if (!srv) return;

  const btn = document.getElementById("btnGuardarGastoEv");
  btn.disabled = true;
  btn.innerText = "Subiendo...";

  try {
    let urlFoto = "";
    if (fotoGastoBase64) {
      urlFoto = await subirFotoHisopadoStorage(fotoGastoBase64, `GASTOS_${srv.codigo_servicio}`, "FACTURA");
    }

    const { error } = await supabase.from("crm_servicios_gastos").insert([{
      servicio_id: srv.id,
      codigo_servicio: srv.codigo_servicio,
      fecha_gasto: document.getElementById("gasFecha").value,
      categoria: document.getElementById("gasCategoria").value,
      numero_factura: document.getElementById("gasFactura").value.trim(),
      descripcion: document.getElementById("gasDetalle").value.trim(),
      monto: parseFloat(document.getElementById("gasMonto").value) || 0,
      responsable: sesion ? sesion.nombre : srv.supervisor_nombre,
      foto_factura_url: urlFoto
    }]);

    if (error) throw error;

    fotoGastoBase64 = "";
    document.getElementById("gasFactura").value = "";
    document.getElementById("gasMonto").value = "";
    document.getElementById("gasDetalle").value = "";
    document.getElementById("gasFotoInput").value = "";
    mostrarAviso("🧾 Gasto real registrado y enviado al Control 360° del CRM.");
    await cargarDetallesServicioEventual();
  } catch (err) {
    alert("Error al registrar gasto: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "💾 Registrar Gasto y Subir Foto";
  }
}

function renderizarSub5Gastos() {
  const tbody = document.getElementById("tbodyGastosEv");
  tbody.innerHTML = "";

  if (listaGastosSrv.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Sin gastos reales registrados en este servicio.</td></tr>';
    return;
  }

  listaGastosSrv.forEach(g => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center">${g.fecha_gasto || "-"}</td>
      <td class="text-center"><span class="badge bg-secondary">${g.categoria}</span></td>
      <td>${g.numero_factura || "-"}</td>
      <td>${g.descripcion}</td>
      <td class="text-end fw-bold text-danger">$${Number(g.monto || 0).toFixed(2)}</td>
      <td class="text-center">
        ${g.foto_factura_url ? `<a href="${g.foto_factura_url}" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2">📷 Ver</a>` : "-"}
      </td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-del-gas="${g.id}">🗑️</button>
      </td>
    `;
    tr.querySelector(`[data-del-gas="${g.id}"]`).addEventListener("click", async () => {
      await supabase.from("crm_servicios_gastos").delete().eq("id", g.id);
      await cargarDetallesServicioEventual();
    });
    tbody.appendChild(tr);
  });
}

// =====================================================================
// SUBPESTAÑA 6: EN PROCESO Y CIERRE DE CAMPO (RECIBÍ CONFORME)
// =====================================================================
function renderizarSub6Cierre(srv) {
  const alerta = document.getElementById("alertaEsperaBodega");
  const btn = document.getElementById("btnCulminarCampoEv");

  alerta.style.display = srv.bodega_entregado ? "none" : "block";
  btn.disabled = !srv.bodega_entregado;

  document.getElementById("cieNombreRecibe").value = srv.recibi_conforme_nombre || "";
  document.getElementById("cieCedulaRecibe").value = srv.recibi_conforme_cedula || "";

  const prev = document.getElementById("previewRecibiConforme");
  if (srv.foto_recibi_conforme_url) {
    document.getElementById("imgRecibiConformeGuardado").src = srv.foto_recibi_conforme_url;
    prev.style.display = "block";
  } else {
    prev.style.display = "none";
  }
}

async function culminarServicioEnCampo(e) {
  e.preventDefault();
  const srv = obtenerServicioActivo();
  if (!srv) return;

  if (!fotoRecibiBase64 && !srv.foto_recibi_conforme_url) {
    alert("Debe subir la foto del documento físico 'Recibí Conforme' firmado.");
    return;
  }

  const btn = document.getElementById("btnCulminarCampoEv");
  btn.disabled = true;
  btn.innerText = "Cerrando servicio en campo...";

  try {
    let urlRecibi = srv.foto_recibi_conforme_url || "";
    if (fotoRecibiBase64) {
      urlRecibi = await subirFotoHisopadoStorage(fotoRecibiBase64, `CIERRE_${srv.codigo_servicio}`, "RECIBI_CONFORME");
    }

    const ambosCerrados = Boolean(srv.bodega_cerrado);
    const nuevoFlujo = ambosCerrados ? "TERMINADO_FACTURAR" : "CULMINADO_CAMPO";

    const updatePayload = {
      recibi_conforme_nombre: document.getElementById("cieNombreRecibe").value.trim().toUpperCase(),
      recibi_conforme_cedula: document.getElementById("cieCedulaRecibe").value.trim().toUpperCase(),
      foto_recibi_conforme_url: urlRecibi,
      campo_cerrado: true,
      estado_flujo: nuevoFlujo
    };
    if (ambosCerrados) updatePayload.estado_servicio = "REALIZADO";

    const { error } = await supabase.from("crm_servicios").update(updatePayload).eq("id", srv.id);
    if (error) throw error;

    if (ambosCerrados && srv.cotizacion_id) {
      await supabase.from("crm_cotizaciones").update({ estado: "REALIZADO" }).eq("id", srv.cotizacion_id);
    }

    fotoRecibiBase64 = "";
    document.getElementById("cieFotoRecibi").value = "";
    mostrarAviso("🏁 Servicio culminado en campo. Trazabilidad de Supervisión finalizada.");
    await cargarModuloEventuales(srv.id);
  } catch (err) {
    alert("Error al cerrar servicio: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "🏁 DAR POR CULMINADO EL SERVICIO EN CAMPO";
  }
}

// =====================================================================
// SUBPESTAÑA 7: INFORME FINAL DEL SERVICIO (MÁX. 6 FOTOS + PDF)
// =====================================================================
function renderizarSub7Informe(srv) {
  document.getElementById("infObservaciones").value = srv.informe_final_observaciones || "";
  fotosInformeActual = Array.isArray(srv.fotos_informe_final) ? [...srv.fotos_informe_final] : [];
  dibujarGaleriaInforme();
}

function dibujarGaleriaInforme() {
  const cont = document.getElementById("galeriaFotosInforme");
  document.getElementById("lblContadorFotosInf").innerText = `${fotosInformeActual.length} / 6 fotos cargadas`;
  cont.innerHTML = "";

  fotosInformeActual.forEach((url, idx) => {
    const col = document.createElement("div");
    col.className = "col-6 col-md-2 text-center";
    col.innerHTML = `
      <img src="${url}" class="foto-thumb-inf mb-1">
      <button type="button" class="btn btn-sm btn-outline-danger py-0 w-100" data-quitar-foto="${idx}">Quitar</button>
    `;
    col.querySelector(`[data-quitar-foto="${idx}"]`).addEventListener("click", () => {
      fotosInformeActual.splice(idx, 1);
      dibujarGaleriaInforme();
    });
    cont.appendChild(col);
  });
}

async function procesarFotosInformeFinal(e) {
  const srv = obtenerServicioActivo();
  if (!srv) return;
  const archivos = Array.from(e.target.files || []);
  const disponibles = 6 - fotosInformeActual.length;

  if (disponibles <= 0) {
    alert("Ya alcanzó el máximo de 6 fotos para el informe final.");
    e.target.value = "";
    return;
  }

  const seleccion = archivos.slice(0, disponibles);
  for (const file of seleccion) {
    const b64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const escala = img.width > 900 ? 900 / img.width : 1;
          canvas.width = Math.round(img.width * escala);
          canvas.height = Math.round(img.height * escala);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    const urlSubida = await subirFotoHisopadoStorage(b64, `INFORME_${srv.codigo_servicio}`, `FOTO_${Date.now()}`);
    if (urlSubida) fotosInformeActual.push(urlSubida);
  }

  e.target.value = "";
  dibujarGaleriaInforme();
}

async function guardarInformeFinalServicio() {
  const srv = obtenerServicioActivo();
  if (!srv) return;

  const { error } = await supabase
    .from("crm_servicios")
    .update({
      informe_final_observaciones: document.getElementById("infObservaciones").value.trim(),
      fotos_informe_final: fotosInformeActual
    })
    .eq("id", srv.id);

  if (error) {
    alert("Error al guardar informe: " + error.message);
    return;
  }
  mostrarAviso("💾 Informe final y fotografías guardados correctamente.");
  await cargarModuloEventuales(srv.id);
}

function generarPdfInformeFinal() {
  const srv = obtenerServicioActivo();
  if (!srv) return;

  const obs = document.getElementById("infObservaciones").value.trim() || "Servicio ejecutado conforme a los protocolos establecidos.";
  const fotosHTML = fotosInformeActual.map((u, i) => `
    <div style="border:1px solid #cbd5e1;padding:6px;border-radius:6px;text-align:center;">
      <img src="${u}" style="width:100%;height:190px;object-fit:cover;border-radius:4px;">
      <div style="font-size:10px;margin-top:4px;font-weight:bold;">Evidencia Fotográfica #${i + 1}</div>
    </div>
  `).join("");

  const win = window.open("", "_blank");
  win.document.write(`
    <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Informe Final - ${srv.codigo_servicio}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;font-size:12px}
      .box{border:1px solid #cbd5e1;padding:12px;border-radius:6px;margin-bottom:14px;background:#f8fafc}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:10px}
    </style></head><body>
      <h2 style="margin:0 0 6px 0;">INFORME FINAL DE SERVICIO — ${srv.codigo_servicio}</h2>
      <div class="box">
        <strong>Cliente:</strong> ${srv.cliente_nombre} | <strong>Punto:</strong> ${srv.nombre_punto} (${srv.ciudad})<br>
        <strong>Supervisor Responsable:</strong> ${srv.supervisor_nombre || "-"} | <strong>Recibido por:</strong> ${srv.recibi_conforme_nombre || "-"}
      </div>
      <div class="box"><strong>Resumen Técnico / Observaciones:</strong><br>${obs}</div>
      <h4>REGISTRO FOTOGRÁFICO DE EJECUCIÓN</h4>
      <div class="grid">${fotosHTML || "<div>Sin fotografías adjuntas.</div>"}</div>
      <script>window.print();<\/script>
    </body></html>
  `);
  win.document.close();
}

// =====================================================================
// MÓDULO 2: CONTRATOS FIJOS (SEMÁFORO EN VIVO Y NOVEDADES - RPC SEGURO)
// =====================================================================
async function iniciarContratosSupervision() {
  const { data } = await supabase
    .from("trazabilidad_contratos")
    .select("*")
    .eq("activo", true)
    .order("nombre_cliente", { ascending: true });

  contratos = data || [];
  const sel = document.getElementById("supContrato");
  sel.innerHTML = "";
  contratos.forEach(c => {
    sel.appendChild(new Option(`${c.nombre_cliente} [${c.codigo_contrato}]`, c.id));
  });

  await cargarPanelSupervision();
}

async function cargarPanelSupervision() {
  const contratoId = document.getElementById("supContrato").value;
  const fecha = document.getElementById("supFecha").value;
  if (!contratoId || !fecha) return;

  const { data: users } = await supabase.rpc("listar_usuarios_asistencia", {
    p_contrato_id: contratoId
  });

  usuariosContrato = users || [];

  ["supSrvAuxiliarSale", "supNovTitular"].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = "";
    usuariosContrato.forEach(u => el.appendChild(new Option(u.nombre_completo, u.id)));
  });

  ["supSrvAuxiliarCubre", "supNovReemplazo"].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="">-- Sin reemplazo --</option>';
    usuariosContrato.forEach(u => el.appendChild(new Option(u.nombre_completo, u.id)));
  });

  const [{ data: turnos }, { data: marcaciones }] = await Promise.all([
    supabase.from("asistencia_turnos").select("*").eq("contrato_id", contratoId).eq("fecha", fecha),
    supabase.from("asistencia_marcaciones").select("*").eq("contrato_id", contratoId).eq("fecha", fecha)
  ]);

  const mapaTurnos = {};
  (turnos || []).forEach(t => (mapaTurnos[t.usuario_id] = t));
  const mapaMarc = {};
  (marcaciones || []).forEach(m => (mapaMarc[m.usuario_id] = m));

  const tbody = document.getElementById("tbodySemaforoSupervision");
  tbody.innerHTML = "";

  if (usuariosContrato.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No hay auxiliares registrados en este contrato.</td></tr>';
    return;
  }

  usuariosContrato.forEach(u => {
    const t = mapaTurnos[u.id];
    const m = mapaMarc[u.id];

    let semaforoHTML = '<span class="semaforo-rojo">🔴 AÚN NO TIMBRA</span>';
    if (m && m.hora_real_entrada) {
      semaforoHTML = '<span class="semaforo-verde">🟢 TIMBRÓ ASISTENCIA</span>';
    } else if (t && (t.estado_calendario === "PERMISO_MEDICO" || t.estado_calendario === "CALAMIDAD" || t.estado_calendario === "DESCANSO")) {
      semaforoHTML = `<span class="badge cal-permiso">${t.estado_calendario}</span>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold text-dark">${u.nombre_completo}</td>
      <td class="text-center"><span class="badge bg-dark">${t ? t.estado_calendario : "SIN TURNO"}</span></td>
      <td class="text-center fw-bold">${t ? `${t.hora_entrada.slice(0, 5)} - ${t.hora_salida.slice(0, 5)}` : "-"}</td>
      <td class="text-center">${semaforoHTML}</td>
      <td class="text-center fw-bold text-success">${m && m.hora_real_entrada ? m.hora_real_entrada.slice(0, 5) : "-"}</td>
      <td class="text-center fw-bold text-danger">${m && m.hora_real_salida ? m.hora_real_salida.slice(0, 5) : "-"}</td>
      <td class="text-center">
        ${m && m.foto_timestamp_url ? `<a href="${m.foto_timestamp_url}" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2">📷 Ver Foto</a>` : "-"}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function crearServicioYReasignarPersonal(e) {
  e.preventDefault();
  const contratoId = document.getElementById("supContrato").value;
  const fecha = document.getElementById("supFecha").value;
  const codigo = document.getElementById("supSrvCodigo").value.trim().toUpperCase();
  const nombre = document.getElementById("supSrvNombre").value.trim().toUpperCase();
  const auxSaleId = document.getElementById("supSrvAuxiliarSale").value;
  const auxCubreId = document.getElementById("supSrvAuxiliarCubre").value || null;

  const uSale = usuariosContrato.find(u => u.id === auxSaleId);
  const uCubre = usuariosContrato.find(u => u.id === auxCubreId);

  const { data: srvCreado, error } = await supabase
    .from("asistencia_servicios")
    .upsert([{
      codigo_servicio: codigo,
      nombre_servicio: nombre,
      contrato_origen_id: contratoId,
      fecha_servicio: fecha,
      creado_por: sesion ? sesion.nombre : "SUPERVISOR"
    }], { onConflict: "codigo_servicio" })
    .select()
    .single();

  if (error) {
    alert("Error al crear servicio: " + error.message);
    return;
  }

  if (uSale) {
    await supabase.from("asistencia_turnos").upsert([{
      contrato_id: contratoId,
      usuario_id: uSale.id,
      fecha,
      codigo_turno: "SRV",
      hora_entrada: "07:00",
      hora_salida: "13:00",
      horas_turno_base: 6,
      estado_calendario: "EN_SERVICIO",
      servicio_id: srvCreado.id,
      observacion: `Salió a servicio: ${nombre}`
    }], { onConflict: "usuario_id,fecha" });
  }

  if (uCubre) {
    await supabase.from("asistencia_turnos").upsert([{
      contrato_id: contratoId,
      usuario_id: uCubre.id,
      fecha,
      codigo_turno: "CUBRE",
      hora_entrada: "07:00",
      hora_salida: "19:00",
      horas_turno_base: 6,
      estado_calendario: "CUBRIENDO_TURNO",
      reemplaza_a_usuario_id: uSale ? uSale.id : null,
      observacion: `Dobla turno por salida de ${uSale ? uSale.nombre_completo : ""} a ${nombre}`
    }], { onConflict: "usuario_id,fecha" });
  }

  await supabase.from("asistencia_novedades").insert([{
    contrato_id: contratoId,
    fecha_novedad: fecha,
    tipo_novedad: "SALIDA_A_SERVICIO",
    usuario_titular_id: auxSaleId,
    usuario_reemplazo_id: auxCubreId,
    servicio_id: srvCreado.id,
    descripcion: `Servicio ${nombre} (${codigo}): Sale ${uSale ? uSale.nombre_completo : ""}${uCubre ? `, cubre/dobla ${uCubre.nombre_completo}` : ""}`,
    registrado_por: sesion ? sesion.nombre : "SUPERVISOR"
  }]);

  const urlTimbradoSrv = `${obtenerUrlRaizERP()}/asistencia-qr.html?servicio=${encodeURIComponent(codigo)}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(urlTimbradoSrv)}`;

  document.getElementById("lblQRSupTitulo").innerText = `QR DE ASISTENCIA SERVICIO: ${nombre} [${codigo}]`;
  document.getElementById("imgQRSupServicio").src = qrImg;
  document.getElementById("linkAbrirQRSupServicio").href = urlTimbradoSrv;
  document.getElementById("cajaQRSupServicio").style.display = "block";

  mostrarAviso(`🚀 Servicio ${nombre} creado. Calendario de Nómina actualizado.`);
  await cargarPanelSupervision();
}

async function registrarPermisoOCambioSupervision(e) {
  e.preventDefault();
  const contratoId = document.getElementById("supContrato").value;
  const fecha = document.getElementById("supFecha").value;
  const tipo = document.getElementById("supNovTipo").value;
  const titularId = document.getElementById("supNovTitular").value;
  const reemplazoId = document.getElementById("supNovReemplazo").value || null;
  const desc = document.getElementById("supNovDesc").value.trim();

  const uTit = usuariosContrato.find(u => u.id === titularId);
  const uRee = usuariosContrato.find(u => u.id === reemplazoId);

  let urlFoto = "";
  if (fotoEvidenciaBase64 && uTit) {
    urlFoto = await subirFotoHisopadoStorage(fotoEvidenciaBase64, "SUPERVISION_EVIDENCIAS", uTit.nombre_completo);
  }

  await supabase.from("asistencia_novedades").insert([{
    contrato_id: contratoId,
    fecha_novedad: fecha,
    tipo_novedad: tipo,
    usuario_titular_id: titularId,
    usuario_reemplazo_id: reemplazoId,
    descripcion: desc,
    foto_documento_url: urlFoto,
    registrado_por: sesion ? sesion.nombre : "SUPERVISOR"
  }]);

  await supabase.from("asistencia_turnos").upsert([{
    contrato_id: contratoId,
    usuario_id: titularId,
    fecha,
    codigo_turno: "PERM",
    hora_entrada: "07:00",
    hora_salida: "13:00",
    horas_turno_base: 6,
    estado_calendario: tipo === "PERMISO_MEDICO" ? "PERMISO_MEDICO" : "CALAMIDAD",
    observacion: desc
  }], { onConflict: "usuario_id,fecha" });

  if (uRee) {
    await supabase.from("asistencia_turnos").upsert([{
      contrato_id: contratoId,
      usuario_id: uRee.id,
      fecha,
      codigo_turno: "CUBRE",
      hora_entrada: "07:00",
      hora_salida: "19:00",
      horas_turno_base: 6,
      estado_calendario: "CUBRIENDO_TURNO",
      reemplaza_a_usuario_id: titularId,
      observacion: `Cubre a ${uTit ? uTit.nombre_completo : ""}: ${desc}`
    }], { onConflict: "usuario_id,fecha" });
  }

  fotoEvidenciaBase64 = "";
  document.getElementById("supNovFoto").value = "";
  document.getElementById("supNovDesc").value = "";
  mostrarAviso("🔔 Notificación enviada a la Pestaña 6 de Nómina y Calendario actualizado.");
  await cargarPanelSupervision();
}

function iniciarSuscripcionEnVivo() {
  supabase
    .channel("erp-supervision-vivo")
    .on("postgres_changes", { event: "*", schema: "public", table: "asistencia_marcaciones" }, () => cargarPanelSupervision())
    .subscribe();
}