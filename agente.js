// Agente GW — chat com IA (v1.0)
(function () {
  const CSS = `
    #agente-btn {
      position: relative;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: inherit;
      opacity: 0.85;
      font-size: 1.3rem;
      line-height: 1;
      flex-shrink: 0;
    }
    #agente-btn:active { opacity: 0.6; }

    #agente-overlay {
      position: fixed;
      inset: 0;
      z-index: 9000;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(2px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .25s;
    }
    #agente-overlay.aberto {
      opacity: 1;
      pointer-events: all;
    }

    #agente-panel {
      background: #fff;
      border-radius: 20px 20px 0 0;
      display: flex;
      flex-direction: column;
      max-height: 70dvh;
      box-shadow: 0 -4px 24px rgba(0,0,0,0.25);
      transform: translateY(100%);
      transition: transform .28s cubic-bezier(.4,0,.2,1);
    }
    #agente-overlay.aberto #agente-panel {
      transform: translateY(0);
    }

    #agente-cabecalho {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #eee;
      flex-shrink: 0;
    }
    #agente-cabecalho span {
      flex: 1;
      font-weight: 700;
      font-size: 0.95rem;
      color: #1a3322;
    }
    #agente-fechar {
      background: none;
      border: none;
      font-size: 1.3rem;
      cursor: pointer;
      color: #999;
      padding: 2px 6px;
      line-height: 1;
    }

    #agente-msgs {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ag-msg {
      max-width: 88%;
      padding: 9px 13px;
      border-radius: 14px;
      font-size: 0.88rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .ag-msg.usuario {
      background: #1a6635;
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .ag-msg.agente {
      background: #f0f4f0;
      color: #1a1a2e;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .ag-msg.pensando {
      background: #f0f4f0;
      color: #999;
      align-self: flex-start;
      font-style: italic;
    }

    #agente-input-area {
      display: flex;
      gap: 8px;
      padding: 10px 12px max(12px, env(safe-area-inset-bottom));
      border-top: 1px solid #eee;
      flex-shrink: 0;
    }
    #agente-input {
      flex: 1;
      border: 1.5px solid #ddd;
      border-radius: 22px;
      padding: 9px 14px;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      resize: none;
      max-height: 100px;
      line-height: 1.4;
    }
    #agente-input:focus { border-color: #1a6635; }
    #agente-enviar {
      background: #1a6635;
      color: #fff;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      font-size: 1.1rem;
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      align-self: flex-end;
    }
    #agente-enviar:disabled { background: #ccc; cursor: default; }
  `;

  function injetarCSS() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function criarHTML() {
    const overlay = document.createElement("div");
    overlay.id = "agente-overlay";
    overlay.innerHTML = `
      <div id="agente-panel">
        <div id="agente-cabecalho">
          <span>🤖 Assistente GW</span>
          <button id="agente-fechar" aria-label="Fechar">✕</button>
        </div>
        <div id="agente-msgs"></div>
        <div id="agente-input-area">
          <textarea id="agente-input" placeholder="Digite sua solicitação..." rows="1"></textarea>
          <button id="agente-enviar" aria-label="Enviar">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", e => {
      if (e.target === overlay) fechar();
    });
    document.getElementById("agente-fechar").addEventListener("click", fechar);

    const input = document.getElementById("agente-input");
    const btnEnviar = document.getElementById("agente-enviar");

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 100) + "px";
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
    });

    btnEnviar.addEventListener("click", enviar);
  }

  function adicionarBotaoNoHeader() {
    const header = document.querySelector("header");
    if (!header) return;
    const btn = document.createElement("button");
    btn.id = "agente-btn";
    btn.title = "Assistente IA";
    btn.innerHTML = "🤖";
    btn.addEventListener("click", abrir);
    header.appendChild(btn);
  }

  let historico = [];
  let enviando = false;

  function abrir() {
    document.getElementById("agente-overlay").classList.add("aberto");
    setTimeout(() => document.getElementById("agente-input").focus(), 300);
  }

  function fechar() {
    document.getElementById("agente-overlay").classList.remove("aberto");
  }

  function addMensagem(texto, tipo) {
    const msgs = document.getElementById("agente-msgs");
    const div = document.createElement("div");
    div.className = "ag-msg " + tipo;
    div.textContent = texto;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  async function enviar() {
    if (enviando) return;
    const input = document.getElementById("agente-input");
    const texto = input.value.trim();
    if (!texto) return;

    enviando = true;
    input.value = "";
    input.style.height = "auto";
    document.getElementById("agente-enviar").disabled = true;

    addMensagem(texto, "usuario");
    const pensando = addMensagem("Pensando...", "pensando");

    try {
      const fn = firebase.functions().httpsCallable("agenteGW");
      const result = await fn({ mensagem: texto, historico });
      pensando.remove();
      addMensagem(result.data.resposta, "agente");
      historico = result.data.historico || [];
    } catch (err) {
      pensando.remove();
      addMensagem("Erro: " + (err.message || "falha na comunicação"), "agente");
    }

    enviando = false;
    document.getElementById("agente-enviar").disabled = false;
    input.focus();
  }

  function verificarRelatorioPontoDiario() {
    const agora = new Date();
    const hojeBR = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const horaBR = agora.toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    if (horaBR < "09:30") return;

    const chave = "gw_relatorio_ponto_" + hojeBR;
    if (localStorage.getItem(chave)) return;
    localStorage.setItem(chave, "1");

    if (typeof firebase === "undefined" || !firebase.functions) return;
    firebase.functions().httpsCallable("relatorioPontoWhatsApp")().catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", () => {
    injetarCSS();
    criarHTML();
    adicionarBotaoNoHeader();
    verificarRelatorioPontoDiario();
  });
})();
