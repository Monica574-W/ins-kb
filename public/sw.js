/* Service Worker — 修改任何前端資源後，必須把 CACHE 版本號加一 */
const CACHE = 'ikb-shell-v4';
const FILES = 'ikb-files-v1'; // 已開啟過的原檔、cmaps（跨版本保留）
const API_CACHE = 'ikb-api-v1';

const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/css/app.css',
  '/js/app.js', '/js/util.js', '/js/search.js', '/js/data.js', '/js/reader.js',
  '/js/views/home.js', '/js/views/ask.js', '/js/views/commission.js', '/js/views/plan.js',
  '/js/views/library.js', '/js/views/settings.js', '/js/views/manual.js', '/js/views/me.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
  '/vendor/pdfjs/pdf.min.js', '/vendor/pdfjs/pdf.worker.min.js',
];
const OFFLINE_API = ['/api/library', '/api/rates', '/api/config', '/api/stats'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => ![CACHE, FILES, API_CACHE].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const okToCache = r => r && r.status === 200 && r.type === 'basic';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // POST（AI 問答）一律直連
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API：只快取少數可離線讀取的；網絡優先
  if (url.pathname.startsWith('/api/')) {
    if (!OFFLINE_API.includes(url.pathname)) return;
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(API_CACHE).then(c => c.put(url.pathname, cp)); }
      return r;
    }).catch(() => caches.match(url.pathname, { cacheName: API_CACHE }).then(r => r || new Response(JSON.stringify({ error: '離線中' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }

  // 頁面導航：網絡優先，離線回 index.html
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // 原檔及 pdf.js 字型/cmaps：快取優先，開啟過即可離線
  if (url.pathname.startsWith('/files/') || url.pathname.startsWith('/vendor/pdfjs/cmaps/') || url.pathname.startsWith('/vendor/pdfjs/standard_fonts/')) {
    e.respondWith(caches.open(FILES).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) {
        // 原檔可能被更新：背景重新抓
        if (url.pathname.startsWith('/files/')) fetch(req).then(r => okToCache(r) && c.put(req, r)).catch(() => {});
        return hit;
      }
      const r = await fetch(req);
      if (okToCache(r)) c.put(req, r.clone());
      return r;
    }));
    return;
  }

  // 其他靜態資源：先回快取，背景更新（stale-while-revalidate）
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (okToCache(r)) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
