// Shinobi Service Worker — caché mínima para que el WebChat sea instalable
// como PWA y siga renderizando algo cuando no hay red. NO cachea el WebSocket
// (que es la ruta crítica con el orquestador) ni las llamadas a /api/* —
// esas siempre deben ir al server real.

const CACHE_NAME = 'shinobi-shell-v4'; // v4: Bloque 8.6 — settings, modelo, búsqueda, diálogos
// Assets que cambian con cada deploy: siempre network-first.
const NETWORK_FIRST_ASSETS = new Set([
  '/',
  '/index.html',
  '/js/app.js',
  '/js/typewriter.js',
  '/js/theme.js',
  '/js/markdown.js',
  '/js/conversations.js',
  '/js/easter_eggs.js',
  '/js/dialog.js',
  '/js/settings.js',
  '/js/search.js',
]);

// Assets verdaderamente estáticos: cache-first está bien.
const CACHE_FIRST_ASSETS = new Set([
  '/styles/tokens.css',
  '/styles/base.css',
  '/styles/layout.css',
  '/styles/chat.css',
  '/styles/settings.css',
  '/assets/shinobi-mark.png',
  '/manifest.webmanifest',
]);

const SHELL_ASSETS = [...NETWORK_FIRST_ASSETS, ...CACHE_FIRST_ASSETS];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {
      // Si algún asset falta (build temprano), no rompemos el install.
    })),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No tocamos /api/* ni el WebSocket — el orquestador necesita respuestas
  // frescas, y un response cacheado romperia el flujo de tools.
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  // GET-only para no romper formularios.
  if (event.request.method !== 'GET') return;

  // Network-first: intenta siempre el servidor; caché solo como fallback offline.
  const networkFirst = () => fetch(event.request)
    .then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(event.request));

  // Cache-first: sirve desde caché; refresca en background si hay red.
  const cacheFirst = () => caches.match(event.request).then((hit) => {
    if (hit) {
      fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
      }).catch(() => {});
      return hit;
    }
    return fetch(event.request).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
      }
      return res;
    });
  });

  if (NETWORK_FIRST_ASSETS.has(url.pathname)) {
    event.respondWith(networkFirst());
    return;
  }

  if (CACHE_FIRST_ASSETS.has(url.pathname)) {
    event.respondWith(cacheFirst());
    return;
  }

  // Todo lo demás fuera del shell: network-first con fallback.
  event.respondWith(networkFirst());
});
