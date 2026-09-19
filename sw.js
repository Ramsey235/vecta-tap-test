// sw.js — keeps the whole app on the phone so the terminal opens and works offline.
// Change VERSION whenever you upload changed files, so phones pick them up.
const VERSION = 'vecta-tap-v1.0.0';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/admin.js', './js/terminal.js', './js/pay.js', './js/nfc.js', './js/ui.js', './js/store.js', './js/sun.js',
  './fonts/poppins-400.woff', './fonts/poppins-500.woff', './fonts/poppins-700.woff',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  './icons/favicon.svg', './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function refresh(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (res.ok) await (await caches.open(VERSION)).put(path, res);
  } catch {
    // offline: keep the cached copy
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Card links arrive as /?picc_data=…&cmac=… or /?t=…: always answer from the cached
    // app so a tap opens fast, even with no network.
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)));
    event.waitUntil(refresh('./index.html'));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((cache) => cache.put(req, copy));
    }
    return res;
  })));
});
