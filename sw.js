/* ==========================================================================
   Quotesn Service Worker
   Scope: /
   Strategy:
     • HTML navigations: Network-first → Cache → Offline fallback
     • Static assets (icons/images/JSON): Stale-while-revalidate
     • Third-party images (Unsplash/Picsum): Cache-first with cap
   Notes:
     • Bump VERSION to deploy updates (cache bust).
     • Keep CORE_ROUTES minimal; HTML has inline critical CSS already.
   ========================================================================== */

const VERSION = 'v1.0.0-2025-09-10';
const RUNTIME_CACHE = `quotesn-runtime-${VERSION}`;
const PRECACHE = `quotesn-precache-${VERSION}`;

// Core routes you want available offline (fast, small set).
// GitHub Pages serves directories as /path/ (index.html), so list both when helpful.
const CORE_ROUTES = [
  '/',                     // Home
  '/index.html',           // Safety for direct file load
  '/about/',               // Key sections
  '/blog/',
  '/quizzes/',
  '/contact/',
  '/contact-success.html',
  '/privacy/',
  '/terms/',
  '/manifest.webmanifest', // PWA
  '/images/favicon.ico',   // Favicon
  // App icons (ensure these exist with exact names)
  '/images/app-icon-192.png',
  '/images/app-icon-512.png',
  '/images/android-chrome-144x144.png',
  '/images/android-chrome-384x384.png'
];

// Offline HTML fallback (inline, no extra file required)
const OFFLINE_HTML = `
<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline | Quotesn</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial;
       color:#0b0d12;background:#ffffff;min-height:100vh;display:grid;place-items:center}
  .card{max-width:540px;margin:2rem;padding:1.25rem 1.25rem 1rem;border:1px solid #e7eaf2;
        border-radius:16px;background:#fff;box-shadow:0 18px 44px rgba(10,22,70,.10),inset 0 1px 0 rgba(255,255,255,.65)}
  h1{margin:.2rem 0 0;font-size:1.4rem}
  p{color:#4a556f;margin:.6rem 0 0;line-height:1.6}
  .row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem}
  .btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 14px;border-radius:10px;
       font-weight:700;line-height:1;text-decoration:none}
  .primary{background:linear-gradient(135deg,#FFD24A 0%,#FFB000 100%);color:#1a1206;box-shadow:0 8px 18px rgba(255,178,0,.18)}
  .outline{border:1px solid #d8def8;background:linear-gradient(180deg,rgba(49,87,255,.10),rgba(49,87,255,.05));color:#0b0d12}
</style>
<div class="card">
  <h1>You’re offline</h1>
  <p>It looks like your device is offline. You can still browse some cached pages. When you’re back online, reload for the latest content.</p>
  <div class="row">
    <a class="btn primary" href="/">Go to Homepage</a>
    <a class="btn outline" href="/quizzes/">Browse Quizzes</a>
  </div>
</div>
</html>`;

// Cap for third-party image cache entries (simple trim)
const IMAGE_CACHE_MAX_ITEMS = 60;

/* ---------- Utility: trim a cache to a maximum number of entries ---------- */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxItems) return;
  const deletions = keys.length - maxItems;
  for (let i = 0; i < deletions; i++) {
    await cache.delete(keys[i]);
  }
}

/* ------------------------------ Install ------------------------------ */
self.addEventListener('install', event => {
  // Warm the precache with small, stable assets only.
  event.waitUntil(
    caches.open(PRECACHE)
      .then(cache => cache.addAll(CORE_ROUTES))
      .catch(() => {}) // Don’t fail install on partial network issues.
  );
  // Activate immediately on next page load
  self.skipWaiting();
});

/* ------------------------------ Activate ----------------------------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Clean old caches
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name =>
          name.startsWith('quotesn-') &&
          name !== PRECACHE &&
          name !== RUNTIME_CACHE
        )
        .map(name => caches.delete(name))
    );
    // Take control without reload
    await self.clients.claim();
  })());
});

/* ------------------------------- Fetch ------------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== 'GET') return;

  // For navigation requests (HTML pages)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(handleHTMLNavigation(req));
    return;
  }

  // For same-origin static assets (JSON, icons, images)
  if (url.origin === self.location.origin) {
    // Stale-while-revalidate for local assets
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // For third-party images (Unsplash, Picsum): cache-first with cap
  if ((req.destination === 'image') || /\.(png|jpg|jpeg|webp|avif|gif)(\?.*)?$/i.test(url.pathname)) {
    event.respondWith(cacheFirstWithLimit(req, `${RUNTIME_CACHE}-img`, IMAGE_CACHE_MAX_ITEMS));
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith(networkFallingBackToCache(req, RUNTIME_CACHE));
});

/* ---------------------- Strategies Implementations ------------------- */

// Network-first for HTML (navigation)
async function handleHTMLNavigation(request) {
  try {
    const network = await fetch(request);
    // Optionally: put a copy into runtime cache for offline
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, network.clone());
    return network;
  } catch (err) {
    // Network failed → Try cache → Else inline offline page
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response(OFFLINE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200
    });
  }
}

// Stale-while-revalidate for local assets
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(response => {
      // Only cache successful, basic/opaque responses
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Return cached immediately if present; otherwise wait for network
  return cached || fetchPromise || new Response('', { status: 504 });
}

// Cache-first with a cap (for third-party images)
async function cacheFirstWithLimit(request, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request, { mode: 'no-cors' });
    // Cache opaque or ok responses
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
      // Trim cache asynchronously (don’t block response)
      trimCache(cacheName, maxItems);
    }
    return response;
  } catch {
    // Last resort: a tiny transparent PNG (1x1) to avoid broken images
    const fallbackImg =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAt8B3y8y0dQAAAAASUVORK5CYII=';
    return fetch(fallbackImg);
  }
}

// Default: network → cache
async function networkFallingBackToCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 504 });
  }
}

/* -------------------------- Message Handling ------------------------- */
// (Optional) Allow pages to request a skipWaiting/refresh on deploy.
self.addEventListener('message', event => {
  const { type } = event.data || {};
  if (type === 'SKIP_WAITING') self.skipWaiting();
});
