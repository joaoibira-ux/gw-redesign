// Corrige bug do Safari iOS: ao voltar para uma página restaurada do cache
// de navegação (bfcache) — ex: trocar de app e voltar — imagens e fundos
// às vezes não são repintados e ficam em branco. Força um reload nesse caso.
window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
