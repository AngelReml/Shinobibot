// Shinobi Service Worker — caché mínima para que el WebChat sea instalable
// como PWA y siga renderizando algo cuando no hay red. NO cachea el WebSocket
// (que es la ruta crítica con el orquestador) ni las llamadas a /api/* —
// esas siempre deben ir al server real.

const CACHE_NAME = 'shinobi-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles/tokens.css',
  '/styles/base.css',
  '/styles/layout.css',
  '/styles/chat.css',
  '/js/app.js',
  '/js/typewriter.js',
  '/js/theme.js',
  '/js/markdown.js',
  '/js/conversations.js',
  '/js/easter_eggs.js',
  '/assets/shinobi-mark.png',
  '/manifest.webmanifest',
];

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

  // Strategy: cache-first para el shell, network-first para todo lo demás.
  const isShell = SHELL_ASSETS.includes(url.pathname);
  if (isShell) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        // Refrescamos cache en background si el fetch va bien.
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      })),
    );
    return;
  }

  // Network-first con fallback a cache si la red está caída.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
