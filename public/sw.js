// Fırtına Gıda Service Worker
const CACHE_NAME = 'sudagitim-cache-v4';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32.png',
  '/logo-header.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Yalnızca aynı kaynaklı GET istekleri ele alınır
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Backend/API, kimlik doğrulama ve geliştirme kaynak modülleri ASLA önbelleğe alınmaz.
  // (Aksi halde eski istemci kodu servis edilir ve 401 hataları oluşur.)
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.tsx')
  ) {
    return;
  }

  // HTML gezinmeleri: önce ağ, çevrimdışıysa önbellek
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // Yalnızca üretim (hashed) varlıkları ve önceden tanımlı kabuk dosyaları önbelleğe alınır
  const isBuildAsset = url.pathname.startsWith('/assets/');
  const isPrecached = PRECACHE_ASSETS.includes(url.pathname);

  if (isBuildAsset || isPrecached) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);
        return cachedResponse || fetchPromise;
      })
    );
  }

  // Diğer tüm istekler: ağ üzerinden, önbelleğe alınmaz
});
