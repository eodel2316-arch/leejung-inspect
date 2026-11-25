// 화면 파일을 휴대폰에 저장해 두고 저장본으로 바로 연다(인터넷을 기다리지 않음).
// 저장본을 보여 주는 동안 뒤에서 새 파일을 받아 두므로, 고친 화면은 다음에 열 때 나온다.
// 화면을 고쳐 올릴 때는 VERSION 을 바꾼다(바뀌면 옛 저장본을 지우고 새로 받음).
const VERSION = 'v3-261125';
const FILES = ['./', 'index.html', 'style.css', 'config.js', 'checklists.js', 'api.js', 'xlsx.js', 'app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png', 'icons/mark-l.png', 'icons/logo-h.png',
  'templates/mood.xlsx', 'templates/meat.xlsx'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
