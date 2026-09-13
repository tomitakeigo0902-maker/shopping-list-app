// Service Worker
// 方針:
//  - index.html（画面遷移）はネットワーク優先。更新を必ず受け取れるようにする。
//    オフライン時だけキャッシュを使う。
//  - ?v=N 付きのファイルはキャッシュ優先。更新時はURLが変わるので古いものは使われない。
const CACHE_NAME = 'shopping-list-v17';
const ASSET_VERSION = 'v=17';
const ASSETS = [
  './',
  './index.html',
  './css/style.css?' + ASSET_VERSION,
  './js/sync.js?' + ASSET_VERSION,
  './js/todo.js?' + ASSET_VERSION,
  './js/store.js?' + ASSET_VERSION,
  './js/app.js?' + ASSET_VERSION,
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 中継サーバーへの通信はキャッシュせず素通しする
  if (url.origin !== self.location.origin) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');

  if (isPage) {
    // ネットワーク優先（更新を確実に受け取る）。失敗したらキャッシュ。
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // それ以外はキャッシュ優先（URLにバージョンが付くので古いものは残らない）
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy));
      return res;
    }))
  );
});
