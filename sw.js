const CACHE = 'gas-app-v3';
const FILES = ['./', './index.html', './app.js', './logic.js', './sync.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// الشبكة أولاً لتصل التحديثات، وعند انقطاع الإنترنت يعمل من الذاكرة
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  // لا نتدخل في اتصالات Firestore/Auth، ونخزّن ملفات التطبيق ومكتبات Firebase فقط
  if (u.origin !== self.location.origin && !u.href.startsWith('https://www.gstatic.com/firebasejs/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
