const CACHE_NAME = 'b2p-portal-cache-v1';
const urlsToCache = [
  '/billing/',
  '/billing/index.html',
  '/billing/logo_b2p.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
