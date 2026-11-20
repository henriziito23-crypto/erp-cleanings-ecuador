// =====================================================================
// ARCHIVO: sw.js (En la raíz del proyecto)
// Service Worker exclusivo para que el Módulo de Registro cargue sin señal
// =====================================================================
const CACHE_NAME = 'cleanings-registro-offline-v1';

// Solo guardamos en caché lo estrictamente necesario para registro.html y el paso por index
const ASSETS_REGISTRO = [
  './',
  './index.html',
  './modulo-trazabilidad/views/registro.html',
  './modulo-trazabilidad/css/estilos-pantalla.css',
  './modulo-trazabilidad/js/registro.ctrl.js',
  './core/panel.ctrl.js',
  './core/router.js',
  './core/supabaseClient.js',
  './core/offlineSync.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// 1. Instalación: guarda en el teléfono los archivos de registro
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_REGISTRO);
    })
  );
  self.skipWaiting();
});

// 2. Activación: limpia cachés viejos si actualizas versión
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// 3. Estrategia Network-First: Siempre usa internet normal; SOLO si no hay señal, entrega registro desde caché
self.addEventListener('fetch', (event) => {
  // No tocar peticiones a la base de datos de Supabase (eso ya lo maneja tu offlineSync.js)
  if (event.request.url.includes('supabase.co') || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        return networkResponse;
      })
      .catch(() => {
        // Si no hay internet, busca el archivo en la caché local (ignorando ?contrato=... del QR)
        return caches.match(event.request, { ignoreSearch: true });
      })
  );
});