/* Healthy Vitalss — Founding 250: offline shell. Signups never pass through here (POST, cross-origin);
   this only keeps the page itself available when the venue network drops. */
const CACHE = 'hv-f250-v1';
const SHELL = [
  '/', '/app.css', '/app.js', '/manifest.webmanifest',
  '/assets/grain.webp', '/assets/hv-wordmark.svg', '/assets/icon.svg', '/assets/icon-180.png',
  '/assets/fonts/libre-caslon-display-400.woff2', '/assets/fonts/libre-caslon-text-400.woff2',
  '/assets/fonts/libre-caslon-text-400-italic.woff2', '/assets/fonts/instrument-sans-400.woff2',
  '/assets/fonts/instrument-sans-500.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // the page: fresh when the network answers quickly, the cached copy when it doesn't
  if (req.mode === 'navigate') {
    e.respondWith(
      Promise.race([fetch(req), timeout(3500)])
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); } return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // everything else: serve the cached copy at once, refresh it behind the scenes
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
