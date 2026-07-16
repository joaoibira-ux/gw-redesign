const VERSION = "mapa-v34";
const ASSETS = [
  "./index.html",
  "./style.css?v=28",
  "./app.js?v=34",
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
  // Navegação e app.js: rede primeiro, sem cache de resposta antiga — o mapa
  // precisa refletir o status real dos serviços, e é usado em modo automático
  // (snapshot antes do fechamento), então não pode rodar código desatualizado.
  const critico = e.request.mode === "navigate" || e.request.url.includes("app.js");
  if (critico) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then(response => {
          if (response.ok) caches.open(VERSION).then(c => c.put(e.request, response.clone()));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
