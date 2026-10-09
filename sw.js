// Offline support: the app shell is cached; everything else (radio API, streams) goes to the network.
const CACHE = 'melody-v14';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/db.js', 'js/icons.js', 'js/player.js', 'js/tags.js',
  'js/core.js', 'js/api.js', 'js/account.js', 'js/lyrics.js', 'js/foryou.js', 'js/studio.js',
  'js/catalog.js', 'js/share.js', 'js/demo-api.js', 'js/drive.js', 'js/party.js', 'js/fitness.js', 'js/recognize.js', 'js/fingerprint.js', 'js/bpm.js', 'js/podcasts.js',
  'js/search.js', 'js/recap.js', 'js/connect.js', 'js/kids.js', 'js/a11y.js', 'js/meta.js', 'js/audius.js',
  'catalog/fingerprints.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for our own files (so updates show up), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Account, payments, AI and lyrics always go to the server, never to the cache.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('.mp3')) return;
  if (req.headers.has('range')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
