// Service worker caching strategy:
//   - install precaches the shell (every module app.js imports) bypassing the HTTP cache
//     (Request cache: 'reload') plus the pinned CDN libraries, so an offline visit can boot.
//   - same-origin requests (HTML, JS, CSS, JSON data): network-first, falling back to the cache
//     offline. Network-first keeps the weekly data fresh on the first visit after an update and
//     stops a new index.html from running against stale cached modules after a deploy. The
//     browser's HTTP cache still absorbs repeat requests, so this costs little when online.
//   - navigations are cached under one '/' key regardless of query string (?state=ca&range=5y
//     would otherwise store a copy of the page per shared link).
//   - CDN_ASSETS are version-pinned and immutable: cache-first.
//   - skipWaiting() + clients.claim() activate the new SW immediately; the app.js
//     controllerchange handler reloads any open tab once so it can't run mixed assets.
// Bump CACHE_VERSION on any breaking change so old caches are evicted on activate.

const CACHE_VERSION = 'v4';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const DATA_CACHE = `data-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/modules/constants.js',
  '/modules/deltas.js',
  '/modules/events.js',
  '/modules/format.js',
  '/modules/overlay.js',
  '/modules/quality.js',
  '/modules/range.js',
  '/modules/stateSearch.js',
  '/modules/urlState.js',
  '/modules/view.js',
  '/favicon.svg',
  '/manifest.webmanifest',
];

// Must match the <script> tags in index.html (test/js/sw.test.js checks both lists).
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // Settled independently: a CDN hiccup shouldn't throw away the local shell, or vice versa.
      Promise.allSettled([
        cache.addAll(SHELL_ASSETS.map(u => new Request(u, { cache: 'reload' }))),
        cache.addAll(CDN_ASSETS),
      ]),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch from the network and refresh the cache copy; serve the cached copy only when the
// network is unreachable. Error responses (404/500) and redirects are never cached.
const networkFirst = (event, cacheName, cacheKey) =>
  fetch(event.request)
    .then(resp => {
      if (resp.ok && !resp.redirected) {
        const copy = resp.clone();
        event.waitUntil(caches.open(cacheName).then(c => c.put(cacheKey, copy)));
      }
      return resp;
    })
    .catch(() =>
      caches.match(cacheKey).then(cached => cached || Response.error()),
    );

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // DevTools issues these; re-fetching them from a SW throws.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (!CDN_ASSETS.includes(url.href)) return;
    event.respondWith(
      caches.match(url.href).then(cached => {
        if (cached) return cached;
        return fetch(request).then(resp => {
          // The <script> tags are crossorigin="anonymous", so this is a CORS response with a
          // real status. Never cache a failure: it would be served cache-first until the next
          // CACHE_VERSION bump.
          if (resp.ok) {
            const copy = resp.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then(c => c.put(url.href, copy)));
          }
          return resp;
        });
      })
    );
    return;
  }

  // Only the app page itself shares the '/' key. Other navigations (someone opening
  // /weekly_case_shiller_output.json or /sitemap.xml in a tab) fall through to the per-path
  // branch - caching them under '/' would replace the offline app shell with a JSON/XML file.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(event, SHELL_CACHE, '/'));
    return;
  }

  const cacheName = url.pathname.endsWith('.json') ? DATA_CACHE : SHELL_CACHE;
  event.respondWith(networkFirst(event, cacheName, url.pathname));
});
