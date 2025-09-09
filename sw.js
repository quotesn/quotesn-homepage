/* Quotesn Service Worker
   Strategy: cache-first for shell routes; network-first fallback for others.
   Scope: site root (register with { scope: "/" }).
*/
const VERSION = 'quotesn-v1';
const CORE_ROUTES = [
  '/', '/about/', '/blog/', '/quizzes/', '/contact/', '/404.html',
  '/images/favicon.ico',
  // Add your icon assets to ensure installability:
  '/images/app-icon-192.png',
  '/images/app-icon-512.png'
];

// Utility: safe request predicate
const isGET = req => req.method === 'GET';
const sameOrigin = url => new URL(url, self.location.href).origin === self.location.origin;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(CORE_ROUTES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch handler:
// - For navigation requests to same-origin, try cache first then network.
// - For other GET requests to same-origin, use stale-while-revalidate.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (!isGET(request) || !sameOrigin(request.url)) return;

  // Navigation (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then(cached => cached || caches.match('/404.html'))
        .then(resp => resp || fetch(request))
        .catch(() => caches.match('/404.html'))
    );
    return;
  }

  // Static/assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        const copy = response.clone();
        caches.open(VERSION).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Optional: Listen for skipWaiting message (useful when updating)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
