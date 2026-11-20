// =====================================================================
// ARCHIVO: core/offlineSync.js
// Motor Offline-First EXCLUSIVO para el Módulo de Registro Diario de Limpieza
// =====================================================================
import { supabase } from "./supabaseClient.js";

const KEY_COLA_OFFLINE = "erp_cleanings_cola_registro_v1";
const KEY_CACHE_CONTRATOS = "erp_cleanings_cache_contratos_v1";
const KEY_CACHE_CATALOGO_PREFIJO = "erp_cleanings_cache_areas_";

let sincronizandoActualmente = false;

// Purgar cualquier caché legado de PINs en texto plano del navegador
try {
  localStorage.removeItem("erp_cleanings_cache_pins_v1");
} catch (e) {}

/**
 * 1. CACHÉ LOCAL DE CATÁLOGOS (Para selectores de Registro sin señal)
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
 * 2. COLA DE REGISTROS DE LIMPIEZA PENDIENTES
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
    descripcion: descripcionResumen || "Registro de limpieza",
    creado_en: new Date().toISOString()
  };
  cola.push(nuevoItem);
  guardarColaOffline(cola);
  return nuevoItem;
}

/**
 * 3. ENVÍO EXCLUSIVO CON RESPALDO OFFLINE PARA REGISTRO DE LIMPIEZA
 */
export async function insertarConRespaldoOffline(tabla, payload, descripcionResumen) {
  if (tabla !== "trazabilidad_registros_limpieza") {
    const { error } = await supabase.from(tabla).insert([payload]);
    if (error) throw error;
    return { modoOffline: false, enviado: true };
  }

  if (!navigator.onLine) {
    encolarOperacionOffline(tabla, payload, descripcionResumen);
    return { modoOffline: true, enviado: false };
  }

  try {
    const payloadLimpio = { ...payload };
    delete payloadLimpio._codigo_contrato_qr;

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
 * 4. SINCRONIZACIÓN AUTOMÁTICA EN SEGUNDO PLANO (Solo Registros de Limpieza)
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
      delete datosInsertar._codigo_contrato_qr;

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

      const { error } = await supabase.from("trazabilidad_registros_limpieza").insert([datosInsertar]);
      if (error) {
        console.error("Error al sincronizar registro de limpieza:", error.message);
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
    mostrarToastSincronizacion(`✅ Se subieron ${subidosExito} registro(s) de limpieza a Supabase.`);
  }

  return { subidos: subidosExito, pendientes: restantes.length };
}

/**
 * 5. BARRA VISUAL DE CONEXIÓN Y COLA PENDIENTE
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
    barra.innerHTML = `🔄 Subiendo ${cola.length} registro(s) de limpieza a Supabase...`;
    return;
  }

  if (!online) {
    barra.style.display = "block";
    barra.style.backgroundColor = "#dc2626";
    barra.style.color = "#ffffff";
    barra.innerHTML = `📡 SIN SEÑAL — Modo Offline en Registro (${cola.length} en memoria). Se subirán al recuperar señal.`;
    return;
  }

  if (online && cola.length > 0) {
    barra.style.display = "block";
    barra.style.backgroundColor = "#f59e0b";
    barra.style.color = "#0f172a";
    barra.innerHTML = `
      ⚠️ Hay <strong>${cola.length} registro(s) de limpieza</strong> pendientes de subir.
      <button type="button" id="btnForzarSyncERP" style="margin-left:10px; padding:2px 10px; border:none; border-radius:4px; background:#0f172a; color:#fff; font-weight:800; cursor:pointer;">
        🔄 Subir Ahora
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