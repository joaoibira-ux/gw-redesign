const VERSAO = "1.1";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp({
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
});
const db = firebase.firestore();
const docRef = db.collection("configuracoes").doc("geral");

// Valores padrão caso o documento ainda não exista
const DEFAULTS = {
  pinCompleto:       "2248",
  pinParcial:        "4512",
  pinRestrito:       "3733",
  pinLimitado:       "0000",
  senhaExcluir:      "4512",
  senhaAlterarBanco: "6535",
  salarioEncarregado: 3000,
  salarioAjudante:    1850,
  valorCafe:          0,
  valorAlmoco:        0,
};

let cfg = { ...DEFAULTS };

// ── Carrega e renderiza ───────────────────────────────────────
docRef.onSnapshot(snap => {
  if (snap.exists) cfg = { ...DEFAULTS, ...snap.data() };
  else             cfg = { ...DEFAULTS };
  renderizar();
});

function fmtMoeda(v) {
  return "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function renderizar() {
  const el = document.getElementById("conteudo");
  el.innerHTML = `
    <div class="secao-titulo">💰 Salários de Referência</div>
    ${item("Encarregado (salário bruto)", fmtMoeda(cfg.salarioEncarregado), "salarioEncarregado", false)}
    ${item("Ajudante (salário bruto)", fmtMoeda(cfg.salarioAjudante), "salarioAjudante", false)}

    <div class="secao-titulo">☕ Benefícios</div>
    ${item("Valor do Café", fmtMoeda(cfg.valorCafe), "valorCafe", false)}
    ${item("Valor do Almoço", fmtMoeda(cfg.valorAlmoco), "valorAlmoco", false)}

    <div class="secao-titulo">🔑 Senhas de Autorização</div>
    ${item("Excluir / Ativar / Desativar", cfg.senhaExcluir, "senhaExcluir", true)}
    ${item("Alterar Banco de Dados", cfg.senhaAlterarBanco, "senhaAlterarBanco", true)}

    <div class="secao-titulo">🔐 PINs de Acesso</div>
    ${item("PIN Completo (acesso total)", cfg.pinCompleto, "pinCompleto", true)}
    ${item("PIN Parcial (acesso limitado)", cfg.pinParcial, "pinParcial", true)}
    ${item("PIN Restrito (acesso mínimo)", cfg.pinRestrito, "pinRestrito", true)}
    ${item("PIN Limitado (ponto, folha, funcionários, mapa)", cfg.pinLimitado, "pinLimitado", true)}
  `;
}

function item(label, valor, campo, oculto) {
  return `
    <div class="cfg-item">
      <div>
        <div class="cfg-label">${label}</div>
        <div class="cfg-valor ${oculto ? 'oculto' : ''}">${oculto ? '••••' : valor}</div>
      </div>
      <button class="btn-editar" onclick="abrirModal('${campo}')">Editar</button>
    </div>`;
}

// ── Modal ─────────────────────────────────────────────────────
const CAMPOS_MOEDA   = ["salarioEncarregado", "salarioAjudante", "valorCafe", "valorAlmoco"];
const CAMPOS_SENHAS  = ["senhaExcluir", "senhaAlterarBanco", "pinCompleto", "pinParcial", "pinRestrito", "pinLimitado"];
const LABELS = {
  salarioEncarregado: "Salário Encarregado (R$)",
  salarioAjudante:    "Salário Ajudante (R$)",
  valorCafe:          "Valor do Café (R$)",
  valorAlmoco:        "Valor do Almoço (R$)",
  senhaExcluir:       "Nova senha — Excluir / Ativar",
  senhaAlterarBanco:  "Nova senha — Alterar Banco",
  pinCompleto:        "Novo PIN Completo (4 dígitos)",
  pinParcial:         "Novo PIN Parcial (4 dígitos)",
  pinRestrito:        "Novo PIN Restrito (4 dígitos)",
  pinLimitado:        "Novo PIN Limitado (4 dígitos)",
};

let _campoAtual = null;

function abrirModal(campo) {
  _campoAtual = campo;
  const ehSenha = CAMPOS_SENHAS.includes(campo);
  const ehMoeda = CAMPOS_MOEDA.includes(campo);

  document.getElementById("modal-titulo").textContent = LABELS[campo] || campo;
  const inp = document.getElementById("modal-input");
  inp.type = ehSenha ? "password" : "text";
  inp.inputMode = ehMoeda ? "decimal" : "text";
  inp.placeholder = ehMoeda ? "0,00" : "";
  inp.value = ehMoeda ? Number(cfg[campo] || 0).toFixed(2).replace(".", ",") : "";

  document.getElementById("modal-senha").value = "";
  document.getElementById("modal-erro").textContent = "";
  document.getElementById("modal-overlay").style.display = "flex";
  setTimeout(() => inp.focus(), 50);
}

function fecharModal() {
  document.getElementById("modal-overlay").style.display = "none";
  _campoAtual = null;
}

function salvarModal() {
  const campo = _campoAtual;
  if (!campo) return;

  const inp       = document.getElementById("modal-input");
  const senhaInp  = document.getElementById("modal-senha");
  const erroEl    = document.getElementById("modal-erro");

  const senhaDigitada = senhaInp.value.trim();
  if (senhaDigitada !== cfg.pinCompleto) {
    erroEl.textContent = "Senha de autorização incorreta.";
    senhaInp.focus();
    return;
  }

  const rawVal = inp.value.trim();
  if (!rawVal) { erroEl.textContent = "Informe o novo valor."; return; }

  let valor;
  if (CAMPOS_MOEDA.includes(campo)) {
    valor = parseFloat(rawVal.replace(",", "."));
    if (isNaN(valor) || valor < 0) { erroEl.textContent = "Valor inválido."; return; }
  } else {
    valor = rawVal;
    if (valor.length < 4) { erroEl.textContent = "Mínimo de 4 caracteres."; return; }
  }

  erroEl.textContent = "";
  docRef.set({ [campo]: valor }, { merge: true })
    .then(() => fecharModal())
    .catch(() => { erroEl.textContent = "Erro ao salvar. Tente novamente."; });
}

// Enter no campo fecha modal salvando
document.getElementById("modal-input").addEventListener("keydown", e => { if (e.key === "Enter") salvarModal(); });
document.getElementById("modal-senha").addEventListener("keydown", e => { if (e.key === "Enter") salvarModal(); });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(reg => reg.update()).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}
