const VERSION = "locais-v24";
const ASSETS = [
  "./index.html",
  "./style.css?v=15",
  "./app.js?v=22",
  "./manifest.json",
  "./Logo-gw.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Navegação e app.js: rede primeiro, sem cache de resposta antiga — evita
  // rodar código desatualizado (ex.: opções de Tipo de local que já mudaram).
  const critico = e.request.mode === "navigate" || e.request.url.includes("app.js");
  if (critico) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then(response => {
          if (response.ok) caches.open(VERSION).then(c => c.put(e.request, response.clone()));
          return response;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
