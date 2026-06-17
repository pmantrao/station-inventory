// Jandu Petroleum Inventory — Service Worker
// Version: bump this string to force cache refresh when you update the app
const CACHE_VERSION = 'jandu-inv-v7';

// Files to cache on install (must all succeed or SW won't install)
const CORE_ASSETS = [
  './index.html',
  './manifest.json'
];

// External resources to cache on first fetch (CDN assets)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/fonts/tabler-icons.woff2',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

// ── INSTALL: cache core app files
self.addEventListener('install', function(event) {
  console.log('[SW] Installing cache:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      // Cache core files — fail silently on CDN assets at install time
      return cache.addAll(CORE_ASSETS).then(function() {
        // Try to pre-cache CDN assets but don't fail install if they're unavailable
        return Promise.allSettled(
          CDN_ASSETS.map(url => cache.add(url).catch(() => null))
        );
      });
    }).then(function() {
      // Activate immediately without waiting for old SW to finish
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: clean up old caches
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) { return key !== CACHE_VERSION; })
          .map(function(key) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH: serve from cache, fall back to network
// Strategy:
//   - index.html → network first (get latest), fall back to cache
//   - Everything else → cache first (fast), fall back to network, cache the result
self.addEventListener('fetch', function(event) {
  const url = event.request.url;

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!url.startsWith('http')) return;

  // index.html — always try network first so updates deploy immediately
  if (url.endsWith('index.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Cache the fresh copy
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, copy);
          });
          return response;
        })
        .catch(function() {
          // Offline — serve from cache
          return caches.match(event.request).then(function(cached) {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // JP logo / images — cache first
  if (url.includes('jandupetroleum.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, copy);
          });
          return response;
        }).catch(function() {
          return new Response('', { status: 404 });
        });
      })
    );
    return;
  }

  // CDN assets (icons, xlsx) — cache first, network fallback, then cache result
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function() {
        console.log('[SW] Fetch failed (offline?):', url);
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

// ── MESSAGE: allow app to trigger cache updates
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
