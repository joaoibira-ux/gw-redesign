const VERSION = "folha-v4.65";
const ASSETS = [
  "./index.html",
  "./style.css?v=4.20",
  "./app.js?v=4.65",
  "./Logo-gw.png",
  "./Aviso iPhone.png",
  "./Aviso Adroide.png",
  "./instrucoes_sistema_gw.png"
];
const FIREBASE_ASSETS = [
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ASSETS))
      .then(() => {
        // Cacheia Firebase em segundo plano (não bloqueia install se CDN falhar)
        caches.open(VERSION).then(c =>
          FIREBASE_ASSETS.forEach(url => c.add(url).catch(() => {}))
        );
      })
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
  // Tudo: cache primeiro, rede como fallback (abre instantâneo)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(response => {
        if (response.ok) {
          caches.open(VERSION).then(c => c.put(e.request, response.clone()));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
