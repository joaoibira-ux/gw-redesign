const VERSION = "caixa-v110";
const ASSETS = [
  "./index.html",
  "./style.css?v=35",
  "./app.js?v=89",
  "./manifest.json",
  "./Logo-gw.png",
  "./Aviso iPhone.png",
  "./Aviso Adroide.png",
  "./instrucoes_sistema_gw.png"
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
  // Navegação (HTML) e app.js: rede primeiro, sem cache de resposta antiga —
  // esse é o caixa (lógica financeira), não pode rodar código desatualizado
  // por causa de cache de service worker. Mesmo padrão já usado em
  // funcionarios/folha/mapa (achado ao vivo: app.js cache-first fazia
  // mudanças recém-publicadas não aparecerem até o app ser fechado/reaberto
  // várias vezes).
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
  // CSS/imagens: cache primeiro, rede como fallback
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
