// Offline cache for LavaDodge 3D.
const CACHE = 'lavadodge3d-v4';
const FILES = [
  './', 'index.html', 'game3d.js', 'manifest.webmanifest',
  '../shared/core.js', '../shared/net.js', '../shared/ui.js', '../shared/peerjs.min.js',
  'lib/three.module.min.js', 'lib/loaders/GLTFLoader.js', 'lib/utils/BufferGeometryUtils.js',
  'assets/olaf.glb',
  'assets/img/olaf_burnt.png', 'assets/img/olaf_sweat.png', 'assets/img/ice.png', 'assets/img/tile.png', 'assets/img/lava.png', 'assets/img/crack.png', 'assets/img/bg.jpg',
  'assets/img/btn_up.png', 'assets/img/btn_down.png', 'assets/img/btn_left.png', 'assets/img/btn_right.png',
  'assets/img/icon-180.png', 'assets/img/icon-192.png', 'assets/img/icon-512.png',
  'assets/sfx/music.mp3', 'assets/sfx/move.mp3', 'assets/sfx/game-over.mp3'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  })));
});
