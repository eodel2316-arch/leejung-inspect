// 화면 파일을 휴대폰에 저장해 두어 빨리 열리게 한다. 새 버전을 올리면 VERSION 을 바꾼다.
const VERSION = 'v2-261125';
const FILES = ['./', 'index.html', 'style.css', 'config.js', 'checklists.js', 'api.js', 'xlsx.js', 'app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png', 'templates/mood.xlsx', 'templates/meat.xlsx'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 같은 주소의 화면 파일: 인터넷 먼저, 안 되면 저장본. 저장소(구글) 호출은 건드리지 않음.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
