/* OmniChat service worker — app-shell caching for installable PWA.
 * Strategy:
 *   - /api/** and /ws and /webhooks  → never cached (always live network)
 *   - navigations (HTML)             → network-first, fall back to cached shell
 *   - static assets (css/js/icons)   → stale-while-revalidate
 */
const VERSION = 'v1';
const SHELL = `omnichat-shell-${VERSION}`;
const ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Live data must never be served from cache.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/webhooks')) {
    return; // default network handling
  }

  // HTML navigations: network-first with offline fallback to the cached shell.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Static assets: serve from cache, refresh in the background.
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res && res.status === 200 && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
