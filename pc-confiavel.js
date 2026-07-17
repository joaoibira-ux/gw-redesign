// Mantém a tela em tela cheia neste computador quando ele foi marcado como
// confiável na tela do PIN (ver index.html). Sem esse flag, este script não
// faz nada — não afeta outros dispositivos/usuários.
(function () {
  if (localStorage.getItem("gw_pc_confiavel") !== "1") return;

  function estaFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function entrarFullscreen() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) {}
  }

  function tentar() {
    if (!estaFullscreen()) entrarFullscreen();
  }

  document.addEventListener("DOMContentLoaded", () => {
    ["click", "touchstart", "keydown"].forEach(ev =>
      document.addEventListener(ev, tentar, { passive: true })
    );
  });
})();
