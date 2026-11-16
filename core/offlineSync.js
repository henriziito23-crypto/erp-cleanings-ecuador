// =====================================================================
// ARCHIVO: core/offlineSync.js
// Motor Offline-First: Cola de Sincronización Local, Subida Diferida de
// Fotografías ATP y Caché de Catálogos (Contratos / Pisos / Áreas)
// =====================================================================
import { supabase } from "./supabaseClient.js";

const KEY_COLA_OFFLINE = "erp_cleanings_cola_offline_v1";
const KEY_CACHE_CONTRATOS = "erp_cleanings_cache_contratos_v1";
const KEY_CACHE_CATALOGO_PREFIJO = "erp_cleanings_cache_areas_";

let sincronizandoActualmente = false;

/**
 * 1. GESTIÓN DE CACHÉ LOCAL (Para que los selectores funcionen sin señal)
 */
export function guardarCacheContratos(listaContratos) {
  try {
    if (Array.isArray(listaContratos) && listaContratos.length > 0) {
      localStorage.setItem(KEY_CACHE_CONTRATOS, JSON.stringify(listaContratos));
    }
  } catch (e) {
    console.warn("No se pudo guardar caché de contratos:", e);
  }
}

export function obtenerCacheContratos() {
  try {
    const raw = localStorage.getItem(KEY_CACHE_CONTRATOS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function guardarCacheCatalogoAreas(codContrato, mapaAreas) {
  try {
    if (codContrato && mapaAreas && Object.keys(mapaAreas).length > 0) {
      localStorage.setItem(KEY_CACHE_CATALOGO_PREFIJO + codContrato, JSON.stringify(mapaAreas));
    }
  } catch (e) {
    console.warn("No se pudo guardar caché de áreas:", e);
  }
}

export function obtenerCacheCatalogoAreas(codContrato) {
  try {
    const raw = localStorage.getItem(KEY_CACHE_CATALOGO_PREFIJO + codContrato);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/**
 * 2. GESTIÓN DE LA COLA DE REGISTROS PENDIENTES
 */
export function obtenerColaOffline() {
  try {
    const raw = localStorage.getItem(KEY_COLA_OFFLINE);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function guardarColaOffline(cola) {
  localStorage.setItem(KEY_COLA_OFFLINE, JSON.stringify(cola));
  actualizarBarraEstadoRed();
}

export function encolarOperacionOffline(tabla, payload, descripcionResumen) {
  const cola = obtenerColaOffline();
  const nuevoItem = {
    id_temporal: "OFF_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
    tabla,
    payload,
    descripcion: descripcionResumen || "Registro operativo",
    creado_en: new Date().toISOString()
  };
  cola.push(nuevoItem);
  guardarColaOffline(cola);
  return nuevoItem;
}

/**
 * Convierte un DataURL (Base64) en Blob para subirlo a Supabase Storage al reconectar
 */
function dataURLABlob(dataURL) {
  const partes = dataURL.split(",");
  const mime = partes[0].match(/:(.*?);/)[1];
  const binario = atob(partes[1]);
  let n = binario.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = binario.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * 3. ENVÍO INTELIGENTE (Intenta subir a Supabase; si falla la red, encola localmente)
 */
export async function insertarConRespaldoOffline(tabla, payload, descripcionResumen) {
  if (!navigator.onLine) {
    encolarOperacionOffline(tabla, payload, descripcionResumen);
    return { modoOffline: true, enviado: false };
  }

  try {
    const payloadLimpio = { ...payload };
    delete payloadLimpio._codigo_contrato_qr;
    delete payloadLimpio._foto_base64_offline;
    delete payloadLimpio._foto_path_offline;

    const { error } = await supabase.from(tabla).insert([payloadLimpio]);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      const esFalloRed =
        msg.includes("fetch") ||
        msg.includes("network") ||
        msg.includes("failed to") ||
        msg.includes("load failed") ||
        !navigator.onLine;

      if (esFalloRed) {
        encolarOperacionOffline(tabla, payload, descripcionResumen);
        return { modoOffline: true, enviado: false };
      }
      throw error;
    }

    return { modoOffline: false, enviado: true };
  } catch (err) {
    const msg = (err.message || "").toLowerCase();
    if (!navigator.onLine || msg.includes("fetch") || msg.includes("network") || msg.includes("failed")) {
      encolarOperacionOffline(tabla, payload, descripcionResumen);
      return { modoOffline: true, enviado: false };
    }
    throw err;
  }
}

/**
 * 4. SINCRONIZACIÓN AUTOMÁTICA EN SEGUNDO PLANO (Limpieza + Fotos y Registros ATP)
 */
export async function sincronizarColaPendiente() {
  if (sincronizandoActualmente || !navigator.onLine) {
    return { subidos: 0, pendientes: obtenerColaOffline().length };
  }

  const cola = obtenerColaOffline();
  if (cola.length === 0) {
    actualizarBarraEstadoRed();
    return { subidos: 0, pendientes: 0 };
  }

  sincronizandoActualmente = true;
  actualizarBarraEstadoRed(true);

  const restantes = [];
  let subidosExito = 0;

  for (const item of cola) {
    try {
      const datosInsertar = { ...item.payload };
      const codigoContratoAux = datosInsertar._codigo_contrato_qr;
      const fotoBase64Aux = datosInsertar._foto_base64_offline;
      const fotoPathAux = datosInsertar._foto_path_offline;

      delete datosInsertar._codigo_contrato_qr;
      delete datosInsertar._foto_base64_offline;
      delete datosInsertar._foto_path_offline;

      // A. Resolver UUID del contrato si se guardó 100% sin señal
      if (!datosInsertar.contrato_id && codigoContratoAux) {
        const { data: cData } = await supabase
          .from("trazabilidad_contratos")
          .select("id")
          .eq("codigo_contrato", codigoContratoAux)
          .maybeSingle();
        if (cData && cData.id) {
          datosInsertar.contrato_id = cData.id;
        }
      }

      // B. Resolver UUID del área si faltaba
      if (!datosInsertar.area_id && datosInsertar.contrato_id && datosInsertar.piso && datosInsertar.nombre_area) {
        const { data: aData } = await supabase
          .from("trazabilidad_areas")
          .select("id")
          .eq("contrato_id", datosInsertar.contrato_id)
          .eq("piso", datosInsertar.piso)
          .eq("nombre_area", datosInsertar.nombre_area)
          .maybeSingle();
        if (aData && aData.id) {
          datosInsertar.area_id = aData.id;
        }
      }

      // C. Si es un hisopado ATP que se guardó offline con foto Base64, subir la foto al bucket primero
      if (fotoBase64Aux && (!datosInsertar.foto_evidencia_url || datosInsertar.foto_evidencia_url === "PENDIENTE_OFFLINE")) {
        const blobFoto = dataURLABlob(fotoBase64Aux);
        const rutaArchivo = fotoPathAux || `atp_offline/${Date.now()}.jpg`;

        const { error: errUp } = await supabase.storage
          .from("evidencias-atp")
          .upload(rutaArchivo, blobFoto, { contentType: "image/jpeg", upsert: true });

        if (!errUp) {
          const { data: pubData } = supabase.storage.from("evidencias-atp").getPublicUrl(rutaArchivo);
          datosInsertar.foto_evidencia_url = pubData.publicUrl;
        } else {
          // Si no existía el bucket evidencias-atp o falló storage, conservamos el DataURL para no perder evidencia
          datosInsertar.foto_evidencia_url = fotoBase64Aux;
        }
      }

      // D. Si es un hisopado ATP guardado offline sin poder consultar quién hizo la última DT, lo vinculamos ahora
      if (
        item.tabla === "trazabilidad_registros_atp" &&
        (!datosInsertar.auxiliar_vinculado_nombre || datosInsertar.auxiliar_vinculado_nombre.includes("OFFLINE")) &&
        datosInsertar.contrato_id
      ) {
        const { data: ultDT } = await supabase
          .from("trazabilidad_registros_limpieza")
          .select("auxiliar_nombre")
          .eq("contrato_id", datosInsertar.contrato_id)
          .eq("piso", datosInsertar.piso)
          .eq("nombre_area", datosInsertar.nombre_area)
          .ilike("tipo_limpieza", "%Terminal%")
          .order("fecha_registro", { ascending: false })
          .order("hora_registro", { ascending: false })
          .limit(1);

        datosInsertar.auxiliar_vinculado_nombre =
          ultDT && ultDT.length > 0 && ultDT[0].auxiliar_nombre
            ? ultDT[0].auxiliar_nombre
            : "SIN DT PREVIA EN EL ÁREA";
      }

      const { error } = await supabase.from(item.tabla).insert([datosInsertar]);
      if (error) {
        console.error("Error al sincronizar ítem:", error.message);
        restantes.push(item);
      } else {
        subidosExito++;
      }
    } catch (e) {
      restantes.push(item);
    }
  }

  sincronizandoActualmente = false;
  guardarColaOffline(restantes);

  if (subidosExito > 0) {
    mostrarToastSincronizacion(`✅ Se sincronizaron ${subidosExito} registro(s) pendiente(s) con la nube.`);
  }

  return { subidos: subidosExito, pendientes: restantes.length };
}

/**
 * 5. BARRA VISUAL FLOTANTE DE ESTADO DE CONEXIÓN Y COLA PENDIENTE
 */
export function inicializarMonitorOffline() {
  iniciarEstilosYBarraDOM();
  actualizarBarraEstadoRed();

  window.addEventListener("online", () => {
    actualizarBarraEstadoRed();
    sincronizarColaPendiente();
  });

  window.addEventListener("offline", () => {
    actualizarBarraEstadoRed();
  });

  setInterval(() => {
    if (navigator.onLine && obtenerColaOffline().length > 0) {
      sincronizarColaPendiente();
    }
  }, 25000);

  if (navigator.onLine && obtenerColaOffline().length > 0) {
    sincronizarColaPendiente();
  }
}

function iniciarEstilosYBarraDOM() {
  if (document.getElementById("barraEstadoOfflineERP")) return;

  const div = document.createElement("div");
  div.id = "barraEstadoOfflineERP";
  div.className = "no-print";
  div.style.cssText =
    "display:none; position:sticky; top:0; z-index:9999; padding:8px 14px; font-size:12.5px; font-weight:700; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,0.15); transition:all 0.25s ease;";
  document.body.prepend(div);
}

export function actualizarBarraEstadoRed(estaSincronizando = false) {
  const barra = document.getElementById("barraEstadoOfflineERP");
  if (!barra) return;

  const cola = obtenerColaOffline();
  const online = navigator.onLine;

  if (estaSincronizando) {
    barra.style.display = "block";
    barra.style.backgroundColor = "#0284c7";
    barra.style.color = "#ffffff";
    barra.innerHTML = `🔄 Conectando con Supabase: Sincronizando ${cola.length} registro(s) guardado(s) en el teléfono...`;
    return;
  }

  if (!online) {
    barra.style.display = "block";
    barra.style.backgroundColor = "#dc2626";
    barra.style.color = "#ffffff";
    barra.innerHTML = `📡 SIN SEÑAL DE INTERNET — Modo Offline Activo (${cola.length} en memoria local). Puede registrar con normalidad; se subirán al recuperar señal.`;
    return;
  }

  if (online && cola.length > 0) {
    barra.style.display = "block";
    barra.style.backgroundColor = "#f59e0b";
    barra.style.color = "#0f172a";
    barra.innerHTML = `
      ⚠️ Hay <strong>${cola.length} registro(s)</strong> guardados en el teléfono pendientes de subir.
      <button type="button" id="btnForzarSyncERP" style="margin-left:10px; padding:2px 10px; border:none; border-radius:4px; background:#0f172a; color:#fff; font-weight:800; cursor:pointer;">
        🔄 Sincronizar Ahora
      </button>
    `;
    document.getElementById("btnForzarSyncERP")?.addEventListener("click", () => {
      sincronizarColaPendiente();
    });
    return;
  }

  barra.style.display = "none";
}

function mostrarToastSincronizacion(mensaje) {
  const toast = document.createElement("div");
  toast.className = "no-print";
  toast.style.cssText =
    "position:fixed; bottom:20px; right:20px; z-index:10000; background:#166534; color:#fff; padding:10px 16px; border-radius:8px; font-size:13px; font-weight:700; box-shadow:0 4px 12px rgba(0,0,0,0.25);";
  toast.innerText = mensaje;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// =====================================================================
// 6. CACHÉ DE CREDENCIALES PIN (Para ingreso QR en sótanos sin señal)
// =====================================================================
const KEY_CACHE_USUARIOS_PIN = "erp_cleanings_cache_pins_v1";

export async function sincronizarCacheUsuariosPin() {
  if (!navigator.onLine) return;
  try {
    const { data, error } = await supabase
      .from("trazabilidad_usuarios")
      .select("id, codigo_pin, nombre_completo, rol, cargo_etiqueta, activo")
      .eq("activo", true);

    if (!error && Array.isArray(data) && data.length > 0) {
      localStorage.setItem(KEY_CACHE_USUARIOS_PIN, JSON.stringify(data));
    }
  } catch (e) {
    console.warn("No se pudo actualizar caché de PINs:", e);
  }
}

export function buscarUsuarioPorPinOffline(pinBuscado) {
  try {
    const raw = localStorage.getItem(KEY_CACHE_USUARIOS_PIN);
    if (!raw) return null;
    const lista = JSON.parse(raw);
    const pinNorm = (pinBuscado || "").trim().toUpperCase();
    return lista.find(u => (u.codigo_pin || "").trim().toUpperCase() === pinNorm && u.activo) || null;
  } catch (e) {
    return null;
  }
}