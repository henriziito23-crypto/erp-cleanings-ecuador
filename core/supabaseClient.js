// =====================================================================
// ARCHIVO: core/supabaseClient.js
// Conexión central a Supabase, Storage de Fotos ATP y Generador de QR
// =====================================================================

const SUPABASE_URL = "https://ezroogojwjitfzrimywy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6cm9vZ29qd2ppdGZ6cmlteXd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MzgyNzQsImV4cCI6MjEwOTQxNDI3NH0.RlE3mqDw6DGQdA0tr7O_PGuRZCcje2dxihYuqYWn8ts";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const BUCKET_FOTOS_ATP = "fotos_hisopados_atp";
export const LOGO_INSTITUCIONAL_URL = "https://drive.google.com/thumbnail?id=14SqUGvm7kp9-WbKZI85KwjSr-JCUUoXO&sz=w500";

/**
 * Sube la fotografía comprimida (Base64 a Blob) al Storage de Supabase
 */
export async function subirFotoHisopadoStorage(fotoBase64, codigoContrato, areaNombre) {
  if (!fotoBase64 || !fotoBase64.includes("data:image")) return "";

  try {
    const partes = fotoBase64.split(",");
    const base64Data = partes.length > 1 ? partes[1] : partes[0];
    const byteCharacters = atob(base64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      byteArrays.push(new Uint8Array(byteNumbers));
    }

    const blob = new Blob(byteArrays, { type: "image/jpeg" });
    const ahora = new Date();
    const fechaStr = ahora.toLocaleDateString("es-EC").replace(/\//g, "-");
    const horaStr = ahora.toTimeString().split(" ")[0].replace(/:/g, "");
    const areaLimpia = (areaNombre || "AREA").replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
    const contratoLimpio = (codigoContrato || "CONTRATO").replace(/[^a-zA-Z0-9-]/g, "_").toUpperCase();

    const rutaArchivo = `${contratoLimpio}/ATP_${areaLimpia}_${fechaStr}_${horaStr}.jpg`;

    const { error } = await supabase.storage
      .from(BUCKET_FOTOS_ATP)
      .upload(rutaArchivo, blob, {
        contentType: "image/jpeg",
        upsert: false
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_FOTOS_ATP)
      .getPublicUrl(rutaArchivo);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error("Error al subir evidencia ATP a Supabase Storage:", err);
    return "";
  }
}

/**
 * Genera la URL exacta del QR físico de puerta y la imagen QR lista para imprimir
 */
export function generarDatosQRPuerta(urlBaseRaizERP, codigoContrato, piso, area) {
  const urlFinal = `${urlBaseRaizERP}/index.html?contrato=${encodeURIComponent(codigoContrato)}&piso=${encodeURIComponent(piso)}&area=${encodeURIComponent(area)}`;
  const qrImagenApi = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=10&data=${encodeURIComponent(urlFinal)}`;
  return {
    urlDestino: urlFinal,
    qrImgUrl: qrImagenApi
  };
}