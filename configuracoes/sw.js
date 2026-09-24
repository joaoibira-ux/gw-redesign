const VERSION = "cfg-v1.15";
const ASSETS = ["./index.html", "./style.css", "./app.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  // Navegação (HTML) e app.js: rede primeiro, sem cache de resposta antiga —
  // achado real, 2026-09-24/25: o João ficou travado em "Carregando..." com
  // app.js antigo (com bug já corrigido) preso no cache, mesmo fechando o
  // app e reiniciando o iPhone, porque app.js era servido cache-first aqui
  // (diferente de caixa/funcionarios, que já usavam esse padrão). Sem isso,
  // toda mudança de código fica horas/dias sem chegar no aparelho de quem já
  // tinha o app instalado.
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
