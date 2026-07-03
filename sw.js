// Basic offline cache so the PWA installs and opens without network.
// ponytail: cache-first for the app shell, network-first for Supabase REST
// (never cache live data). Bump CACHE to invalidate.
const CACHE = 'bleuspace-wallet-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './mock.js',
  './supa.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // never cache Supabase data — always go to network, don't fall back to stale
  if (url.includes('/rest/v1/') || url.includes('supabase')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      // runtime-cache same-origin shell assets
      const copy = res.clone();
      if (res.ok && new URL(url).origin === self.location.origin) {
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
