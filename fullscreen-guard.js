// fullscreen-guard.js
// Cada tela do sistema é uma página separada — o navegador sai da tela
// cheia sozinho a cada navegação (trava de segurança do próprio browser,
// não tem como desligar via código). Esse script tenta reentrar em tela
// cheia assim que a página carrega e, principalmente, no primeiro toque/
// clique na tela nova (gesto do usuário sempre reautoriza a API) — na
// prática, o "vazamento" da tela cheia fica só o instante entre trocar de
// tela e o primeiro toque. Só entra em ação se o usuário já tinha pedido
// modo tela cheia (PIN do sistema GW, ver index.html), marcado em
// localStorage — não força tela cheia em quem nunca pediu.
(function () {
  function querTelaCheia() {
    try { return localStorage.getItem('gw_modo_tela_cheia') === '1'; }
    catch (e) { return false; }
  }
  function estaEmTelaCheia() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function tentarEntrar() {
    if (!querTelaCheia() || estaEmTelaCheia()) return;
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) {}
  }

  tentarEntrar();
  document.addEventListener('DOMContentLoaded', tentarEntrar);
  document.addEventListener('click', tentarEntrar, { passive: true });
  document.addEventListener('touchstart', tentarEntrar, { passive: true });
})();
