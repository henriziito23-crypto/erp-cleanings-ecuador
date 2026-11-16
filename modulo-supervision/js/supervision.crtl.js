// =====================================================================
// ARCHIVO: modulo-supervision/js/supervision.ctrl.js
// Controlador Operativo de Supervisión (Conectado con Calendario y Nómina)
// =====================================================================
import { supabase, subirFotoHisopadoStorage } from "../../core/supabaseClient.js";
import { obtenerSesionActiva } from "../../core/router.js";

let sesion = null;
let contratos = [];
let usuariosContrato = [];
let fotoEvidenciaBase64 = "";

document.addEventListener("DOMContentLoaded", async () => {
  iniciarSuscripcionEnVivio();
  document.getElementById("supFecha").value = new Date().toISOString().split("T")[0];

  document.getElementById("supContrato").addEventListener("change", cargarPanelSupervision);
  document.getElementById("supFecha").addEventListener("change", cargarPanelSupervision);
  document.getElementById("btnRefrescarSupervision").addEventListener("click", cargarPanelSupervision);

  document.getElementById("formSupCrearServicio").addEventListener("submit", crearServicioYReasignarPersonal);
  document.getElementById("supNovFoto").addEventListener("change", procesarFotoSup);
  document.getElementById("formSupNovedad").addEventListener("submit", registrarPermisoOCambioSupervision);

  await iniciarContratosSupervision();
  // =====================================================================
// RADAR EN VIVO: SUPERVISIÓN
// =====================================================================
function iniciarSuscripcionEnVivo() {
  supabase
    .channel('erp-supervision-vivo')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'asistencia_marcaciones' },
      (payload) => cargarPanelSupervision()
    )
    .subscribe();
}
});

function mostrarAviso(msg) {
  const b = document.getElementById("msgFeedbackSup");
  b.innerText = msg;
  b.style.display = "block";
  setTimeout(() => (b.style.display = "none"), 4500);
}

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

  const { data: users } = await supabase
    .from("trazabilidad_usuarios")
    .select("*")
    .eq("contrato_base_id", contratoId)
    .eq("activo", true)
    .order("nombre_completo", { ascending: true });

  usuariosContrato = users || [];

  // Poblar combos de auxiliares
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

  // Consultar turnos del día y marcaciones reales para el Semáforo en Vivo
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

  // 1. Crear el servicio eventual en BD
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

  // 2. Pintar en CELESTE ('EN_SERVICIO') en el Calendario al auxiliar que salió al servicio
  if (uSale) {
    await supabase
      .from("asistencia_turnos")
      .upsert([{
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

  // 3. Pintar en VERDE ('CUBRIENDO_TURNO') al compañero que se queda doblando turno
  if (uCubre) {
    await supabase
      .from("asistencia_turnos")
      .upsert([{
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

  // 4. Registrar notificación automática en Pestaña 6 de Nómina
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

  // Mostrar el QR del Servicio creado para que el auxiliar timbre su entrada y salida
  const urlTimbradoSrv = window.location.origin + window.location.pathname.replace("/modulo-supervision/views/supervision.html", "/asistencia-qr.html") + `?servicio=${encodeURIComponent(codigo)}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(urlTimbradoSrv)}`;

  document.getElementById("lblQRSupTitulo").innerText = `QR DE ASISTENCIA SERVICIO: ${nombre} [${codigo}]`;
  document.getElementById("imgQRSupServicio").src = qrImg;
  document.getElementById("linkAbrirQRSupServicio").href = urlTimbradoSrv;
  document.getElementById("cajaQRSupServicio").style.display = "block";

  mostrarAviso(`🚀 Servicio ${nombre} creado. Calendario de Nómina actualizado en CELESTE y VERDE.`);
  await cargarPanelSupervision();
}

function procesarFotoSup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = Math.round((img.height * 800) / img.width);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      fotoEvidenciaBase64 = canvas.toDataURL("image/jpeg", 0.75);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
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

  // Actualizar titular en el Calendario (Amarillo)
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

  // Actualizar reemplazo en el Calendario (Verde)
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