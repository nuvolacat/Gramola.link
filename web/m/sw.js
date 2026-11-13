// Service worker de la web del micro (PWA). Red primero; si no hay red, lo último guardado.
// Así la app abre al instante desde la pantalla de inicio y muestra «Reconectando…» sin red.
const CACHE = 'gramola-micro-1.26.1113.1750';
// (las rutas son las que pide la página: /m/m.js y /m/m.css, con o sin ?v=)
const SHELL = [
  '/', '/m/m.css', '/m/m.js', '/despierto.mp4', '/js/net.js', '/js/pitch.js', '/js/wake.js', '/vendor/jsQR.js',
  '/assets/logo/horizontal-claro.png', '/assets/nuvola/tinta.png',
  '/assets/micro/j1.webp', '/assets/micro/j2.webp', '/assets/micro/j3.webp', '/assets/micro/j4.webp',
  '/assets/micro/j5.webp', '/assets/micro/j6.webp', '/assets/micro/j7.webp', '/assets/micro/j8.webp',
];
// Página, scripts y estilos: si la red no contesta en 4 s (portal cautivo, 3G malo), se sirve lo guardado
const TOPE_MS = 4000;
const conTope = (req, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('sin respuesta')), ms);
  fetch(req).then(r => { clearTimeout(t); res(r); }, e => { clearTimeout(t); rej(e); });
});

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/ws') || url.pathname.startsWith('/api/')) return;
  const critico = e.request.mode === 'navigate' || ['document', 'script', 'style'].includes(e.request.destination);
  e.respondWith(
    (critico ? conTope(e.request, TOPE_MS) : fetch(e.request)).then(r => {
      if (r.ok && r.status === 200) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || Response.error()))
  );
});
