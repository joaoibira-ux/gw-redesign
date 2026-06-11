const VERSION = "gw-redesign-v51";
const ASSETS = ["./index.html", "./instalar.html", "./Logo-gw.png", "./manifest.json", "./instrucoes_sistema_gw.png", "./Aviso iPhone.png", "./Aviso Adroide.png", "./bg-pin.jpg", "./bg-instalar.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.mode === "navigate") { e.respondWith(fetch(e.request).catch(() => caches.match("./index.html"))); return; }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
