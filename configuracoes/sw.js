const VERSION = "cfg-v1.1";
const ASSETS = ["./index.html", "./style.css", "./app.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.mode === "navigate") { e.respondWith(fetch(e.request, { cache: "no-store" }).catch(() => caches.match("./index.html"))); return; }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
