/* Service worker de "Mis Finanzas".
 * - Guarda en caché la app (HTML, manifest, íconos) y Chart.js para abrirla sin conexión.
 * - Las llamadas al script de Google y a las APIs de cotizaciones NO se cachean acá:
 *   la app guarda sus propios datos y los últimos valores en el dispositivo.
 * Cambiá VERSION cuando publiques una versión nueva para forzar la actualización.
 */
const VERSION = 'finanzas-v1';
const CHART_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // Chart.js es opcional: si falla la descarga, la app funciona igual sin gráficos.
    try { await cache.add(new Request(CHART_URL, { mode: 'cors' })); } catch (e) { /* se reintenta al usarse */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App propia: primero la red (para tener siempre la última versión), si no hay red, la caché.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        return Response.error();
      }
    })());
    return;
  }

  // Chart.js (versión fija, no cambia): primero la caché.
  if (req.url === CHART_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
  // Todo lo demás (script de Google, dolarapi, CoinGecko) va directo a la red.
});
