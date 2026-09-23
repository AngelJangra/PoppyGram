/* PoppyGram service worker: app-shell support only. Never cache API/session/Telegram data. */
const VERSION = 'poppygram-pwa-v1';
const STATIC_CACHE = VERSION + '-static';
const APP_SHELL = ['/','/manifest.webmanifest','/poppygram.png','/logo.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) return;

  // Next static chunks are immutable: cache them after first successful load.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok) caches.open(STATIC_CACHE).then(cache => cache.put(req, res.clone()));
      return res;
    })));
    return;
  }

  // Navigation: prefer the network so deployed updates are not hidden by stale HTML.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(STATIC_CACHE).then(cache => cache.put('/', res.clone()));
      return res;
    }).catch(() => caches.match('/')));
  }
});
