// =====================================================================
// ARCHIVO: core/router.js
// Ruteador Central del ERP (Conecta index.html con todos los módulos)
// =====================================================================
import { supabase } from "./supabaseClient.js";

const STORAGE_KEY_SESION = "cleanings_trazabilidad_sesion";

export function homologarRol(rolRaw) {
  const r = (rolRaw || "AUXILIAR").toString().trim().toUpperCase();
  if (r === "ADMIN" || r === "CONTROL" || r === "COORDINADOR") return "CONTROL";
  if (r === "AUDITOR" || r === "SUPERVISOR" || r === "AUDITOR_CONTRATO") return "SUPERVISOR";
  return "AUXILIAR";
}

export function obtenerParametrosURL() {
  const params = new URLSearchParams(window.location.search);
  return {
    contrato: (params.get("contrato") || "").trim(),
    piso: (params.get("piso") || "").trim(),
    area: (params.get("area") || "").trim(),
    servicio: (params.get("servicio") || "").trim(),
    usuario: (params.get("usuario") || params.get("auditor") || "").trim(),
    rol: homologarRol(params.get("rol") || "AUXILIAR")
  };
}

export function guardarSesionActiva(datosUsuario, parametrosQR) {
  const sesion = {
    id: datosUsuario.id,
    nombre: datosUsuario.nombre_completo,
    rol: homologarRol(datosUsuario.rol),
    cargoEtiqueta: datosUsuario.cargo_etiqueta || datosUsuario.rol,
    qrContrato: parametrosQR.contrato || "",
    qrPiso: parametrosQR.piso || "",
    qrArea: parametrosQR.area || "",
    timestamp: Date.now()
  };
  sessionStorage.setItem(STORAGE_KEY_SESION, JSON.stringify(sesion));
  return sesion;
}

export function obtenerSesionActiva() {
  const raw = sessionStorage.getItem(STORAGE_KEY_SESION);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function cerrarSesionTrazabilidad() {
  sessionStorage.removeItem(STORAGE_KEY_SESION);
  sessionStorage.removeItem("erp_vista_activa");
  const qr = obtenerParametrosURL();
  const estoyEnSubvista =
    window.location.pathname.includes("/modulo-trazabilidad/views/") ||
    window.location.pathname.includes("/modulo-asistencia/views/");
  let destino = estoyEnSubvista ? "../../index.html" : "./index.html";

  if (qr.contrato && qr.piso && qr.area) {
    destino += `?contrato=${encodeURIComponent(qr.contrato)}&piso=${encodeURIComponent(qr.piso)}&area=${encodeURIComponent(qr.area)}`;
  }
  window.location.href = destino;
}

export function navegarAVista(nombreArchivoVista, contratoElegido = "") {
  const sesion = obtenerSesionActiva();
  const qr = obtenerParametrosURL();

  const contrato = contratoElegido || (sesion ? sesion.qrContrato : "") || qr.contrato;
  const piso = qr.piso || (sesion ? sesion.qrPiso : "");
  const area = qr.area || (sesion ? sesion.qrArea : "");
  const nombre = sesion ? sesion.nombre : qr.usuario;
  const rol = sesion ? sesion.rol : qr.rol;

  const query = new URLSearchParams({
    contrato: contrato,
    piso: piso,
    area: area,
    usuario: nombre,
    auditor: nombre,
    rol: rol
  });

  const estoyEnSubvista =
    window.location.pathname.includes("/modulo-trazabilidad/views/") ||
    window.location.pathname.includes("/modulo-asistencia/views/");
  let rutaDestino = "";

  if (nombreArchivoVista === "panel.html" || nombreArchivoVista === "index.html") {
    rutaDestino = estoyEnSubvista ? "../../index.html" : "./index.html";
  } else {
    rutaDestino = estoyEnSubvista
      ? `./${nombreArchivoVista}`
      : `./modulo-trazabilidad/views/${nombreArchivoVista}`;
  }

  window.location.href = `${rutaDestino}?${query.toString()}`;
}

export async function obtenerContratosAutorizados(usuarioId, rol) {
  const rolLimpio = homologarRol(rol);

  if (rolLimpio === "CONTROL") {
    const { data, error } = await supabase
      .from("trazabilidad_contratos")
      .select("*")
      .eq("activo", true)
      .order("nombre_cliente", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  const { data: asignaciones } = await supabase
    .from("trazabilidad_contrato_supervisores")
    .select("contrato_id")
    .eq("supervisor_id", usuarioId);

  const { data: contratoBaseId } = await supabase.rpc("obtener_contrato_base_usuario", {
    p_usuario_id: usuarioId
  });

  const idsPermitidos = new Set((asignaciones || []).map(a => a.contrato_id));
  if (contratoBaseId) {
    idsPermitidos.add(contratoBaseId);
  }

  const listaIds = Array.from(idsPermitidos);

  let query = supabase
    .from("trazabilidad_contratos")
    .select("*")
    .eq("activo", true);

  if (listaIds.length > 0) {
    query = query.or(`supervisor_id.eq.${usuarioId},id.in.(${listaIds.join(",")})`);
  } else {
    query = query.eq("supervisor_id", usuarioId);
  }

  const { data, error } = await query.order("nombre_cliente", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function obtenerMapaPisosAreasPorContrato(contratoIdOCodigo) {
  if (!contratoIdOCodigo) return {};

  const esUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contratoIdOCodigo);
  let contratoUUID = contratoIdOCodigo;

  if (!esUUID) {
    const { data: cData } = await supabase
      .from("trazabilidad_contratos")
      .select("id")
      .eq("codigo_contrato", contratoIdOCodigo.toUpperCase())
      .maybeSingle();
    if (!cData) return {};
    contratoUUID = cData.id;
  }

  const { data: areas, error } = await supabase
    .from("trazabilidad_areas")
    .select("id, piso, nombre_area, modelo_area, umbral_rlu, meta_terminales_mes")
    .eq("contrato_id", contratoUUID)
    .eq("activo", true)
    .order("piso", { ascending: true })
    .order("nombre_area", { ascending: true });

  if (error || !areas) return {};

  const mapaPisos = {};
  areas.forEach(item => {
    const p = (item.piso || "").trim();
    if (!mapaPisos[p]) mapaPisos[p] = [];
    mapaPisos[p].push({
      id: item.id,
      area: item.nombre_area,
      tipo: item.modelo_area,
      umbral: item.umbral_rlu,
      metaTerminales: item.meta_terminales_mes || 2
    });
  });

  return mapaPisos;
}