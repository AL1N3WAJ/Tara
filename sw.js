/**
 * sw.js — Service Worker for Akash Star Chart
 *
 * Strategy:
 *   - App shell & bright stars: Cache-first (precached on install)
 *   - Faint stars & other data: Cache-first, network fallback
 *   - Navigation: serve index.html from cache
 *
 * CACHE_VERSION is injected by the CI workflow with the commit SHA so users
 * always get updates after a deployment.
 */

// ─── Cache name — CI injects the actual SHA ───────────────────────────────────
const CACHE_VERSION = '__CACHE_VERSION__';   // replaced by deploy.yml
const CACHE_NAME    = `akash-${CACHE_VERSION}`;

// ─── App shell to precache ─────────────────────────────────────────────────────
const PRECACHE = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/main.js',
  './js/astro.js',
  './js/projection.js',
  './js/render.js',
  './js/visibility.js',
  './js/names.js',
  './js/urlstate.js',
  './js/ui.js',
  './js/export.js',
  './js/theme.js',
  './js/i18n/en.json',
  './js/i18n/bn.json',
  './data/stars_bright.json',
  './data/constellations.json',
  './data/locations.json',
  './data/names_bn.json',
  './data/messier.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/astronomy-engine/astronomy.browser.js',
  './vendor/jszip/jszip.min.js',
  './vendor/filesaver/FileSaver.min.js',
  './vendor/fonts/NotoSansBengali-Regular.woff2',
  './vendor/fonts/NotoSansBengali-Bold.woff2',
  './vendor/fonts/Inter-Regular.woff2',
  './vendor/fonts/Inter-Bold.woff2',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Add all, but don't fail if individual requests fail
      return Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Failed to precache: ${url}`, err)
          )
        )
      );
    })
  );
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('akash-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navigation: serve index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(r => r || fetch(request))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Cache successful responses for data/fonts
        if (response.ok && (
          url.pathname.includes('/data/') ||
          url.pathname.includes('/vendor/') ||
          url.pathname.includes('/js/') ||
          url.pathname.includes('/css/')
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
