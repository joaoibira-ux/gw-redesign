// fullscreen-guard.js
// Cada tela do sistema é uma página separada — o navegador sai da tela
// cheia sozinho a cada navegação (trava de segurança do próprio browser,
// não tem como desligar via código, nem simular o gesto do usuário via
// script — só um clique/toque real reautoriza a API). Esse script escuta
// o primeiro clique/toque na tela nova e só então tenta reentrar em tela
// cheia, uma única vez — nada é tentado sem gesto (evita uma chamada que
// sempre falha e não ajuda em nada). Só entra em ação se o usuário já
// tinha pedido modo tela cheia (PIN do sistema GW, ver index.html),
// marcado em localStorage — não força tela cheia em quem nunca pediu.
(function () {
  function querTelaCheia() {
    try { return localStorage.getItem('gw_modo_tela_cheia') === '1'; }
    catch (e) { return false; }
  }
  function estaEmTelaCheia() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  if (!querTelaCheia() || estaEmTelaCheia()) return;

  function tentarEntrar() {
    if (estaEmTelaCheia()) { pararDeEscutar(); return; }
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) el.requestFullscreen().then(pararDeEscutar).catch(() => {});
      else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); pararDeEscutar(); }
    } catch (e) {}
  }
  function pararDeEscutar() {
    document.removeEventListener('click', tentarEntrar);
    document.removeEventListener('touchstart', tentarEntrar);
  }

  document.addEventListener('click', tentarEntrar, { passive: true });
  document.addEventListener('touchstart', tentarEntrar, { passive: true });
})();
