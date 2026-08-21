const VERSAO = "1.10";
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
const colRecorrentes = db.collection("despesasRecorrentes");
const colRecorrentesSemanais = db.collection("despesasRecorrentesSemanais");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Valores padrão caso o documento ainda não exista
const DEFAULTS = {
  pinCompleto:       "2248",
  pinParcial:        "4512",
  pinRestrito:       "3733",
  pinLimitado:       "0000",
  senhaExcluir:      "6535",
  senhaAlterarBanco: "6535",
  salarioEncarregado: 3000,
  salarioAjudante:    1850,
  valorCafe:          0,
  valorAlmoco:        0,
  limiteAdiantamentoSemanal: 0,
};

let cfg = { ...DEFAULTS };
let recorrentes = [];
let recorrentesSemanais = [];
let funcionariosCache = [];

// ── Carrega e renderiza ───────────────────────────────────────
docRef.onSnapshot(snap => {
  if (snap.exists) cfg = { ...DEFAULTS, ...snap.data() };
  else             cfg = { ...DEFAULTS };
  renderizar();
});

colRecorrentes.orderBy("diaMes").onSnapshot(snap => {
  recorrentes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderizar();
});

colRecorrentesSemanais.orderBy("criadoEm").onSnapshot(snap => {
  recorrentesSemanais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderizar();
});

// Só pra popular o seletor de funcionário da condição de presença — não afeta o resto da tela.
db.collection("funcionarios").orderBy("nome").onSnapshot(snap => {
  funcionariosCache = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(f => f.ativo !== false);
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

    <div class="secao-titulo">💵 Adiantamentos</div>
    ${item("Limite semanal por funcionário", fmtMoeda(cfg.limiteAdiantamentoSemanal), "limiteAdiantamentoSemanal", false)}

    <div class="secao-titulo">📅 Despesas Recorrentes (lançadas no Contas a Pagar todo dia 01)</div>
    ${recorrentes.length
      ? recorrentes.map(recorrenteItemHtml).join("")
      : '<div class="cfg-item" style="justify-content:center;color:#888">Nenhuma despesa recorrente cadastrada.</div>'}
    <button class="btn-nova-recorrente" onclick="abrirModalRecorrente(null)">+ Nova Despesa Recorrente</button>

    <div class="secao-titulo">🗓️ Despesas Recorrentes Semanais (lançadas no Contas a Pagar toda Segunda)</div>
    ${recorrentesSemanais.length
      ? recorrentesSemanais.map(recorrenteSemanalItemHtml).join("")
      : '<div class="cfg-item" style="justify-content:center;color:#888">Nenhuma despesa recorrente semanal cadastrada.</div>'}
    <button class="btn-nova-recorrente" onclick="abrirModalRecorrenteSemanal(null)">+ Nova Despesa Recorrente Semanal</button>

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

function prazoLabel(r) {
  if (!r.prazoMeses) return "Indeterminado";
  const feitos = r.lancamentosFeitos || 0;
  return feitos >= r.prazoMeses ? `Encerrado (${feitos}/${r.prazoMeses} meses)` : `${feitos}/${r.prazoMeses} meses`;
}

function recorrenteItemHtml(r) {
  return `
    <div class="cfg-item">
      <div>
        <div class="cfg-label">${escHtml(r.descricao)}</div>
        <div class="cfg-valor">${fmtMoeda(r.valor)} · todo dia ${r.diaMes} · ${prazoLabel(r)}</div>
      </div>
      <button class="btn-editar" onclick="abrirModalRecorrente('${r.id}')">Editar</button>
    </div>`;
}

function prazoSemanalLabel(r) {
  if (!r.prazoSemanas) return "Indeterminado";
  const feitos = r.lancamentosFeitos || 0;
  return feitos >= r.prazoSemanas ? `Encerrado (${feitos}/${r.prazoSemanas} semanas)` : `${feitos}/${r.prazoSemanas} semanas`;
}

function recorrenteSemanalItemHtml(r) {
  const condicao = r.condicaoFuncionarioId
    ? `<br>Se: ${escHtml(r.condicaoFuncionarioNome || "funcionário")} sem falta seg-sex na semana anterior + entrada até ${escHtml(r.condicaoHorarioLimite || "11:59")}`
    : "";
  return `
    <div class="cfg-item">
      <div>
        <div class="cfg-label">${escHtml(r.descricao)}</div>
        <div class="cfg-valor">${fmtMoeda(r.valor)} · toda Segunda · ${prazoSemanalLabel(r)}${condicao}</div>
      </div>
      <button class="btn-editar" onclick="abrirModalRecorrenteSemanal('${r.id}')">Editar</button>
    </div>`;
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
const CAMPOS_MOEDA   = ["salarioEncarregado", "salarioAjudante", "valorCafe", "valorAlmoco", "limiteAdiantamentoSemanal"];
const CAMPOS_SENHAS  = ["senhaExcluir", "senhaAlterarBanco", "pinCompleto", "pinParcial", "pinRestrito", "pinLimitado"];
const LABELS = {
  salarioEncarregado: "Salário Encarregado (R$)",
  salarioAjudante:    "Salário Ajudante (R$)",
  valorCafe:          "Valor do Café (R$)",
  valorAlmoco:        "Valor do Almoço (R$)",
  limiteAdiantamentoSemanal: "Limite semanal de adiantamento, por funcionário (R$)",
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

// ── Modal despesa recorrente ────────────────────────────────────
let _recorrenteEditandoId = null;

function abrirModalRecorrente(id) {
  _recorrenteEditandoId = id;
  const r = id ? recorrentes.find(x => x.id === id) : null;

  document.getElementById("modal-recorrente-titulo").textContent = id ? "Editar Despesa Recorrente" : "Nova Despesa Recorrente";
  document.getElementById("rec-descricao").value = r ? r.descricao : "";
  document.getElementById("rec-valor").value = r ? Number(r.valor || 0).toFixed(2).replace(".", ",") : "";
  document.getElementById("rec-dia").value = r ? r.diaMes : "";
  document.getElementById("rec-prazo").value = r && r.prazoMeses ? r.prazoMeses : "";
  document.getElementById("rec-senha").value = "";
  document.getElementById("rec-erro").textContent = "";
  document.getElementById("rec-excluir-btn").style.display = id ? "block" : "none";
  document.getElementById("modal-recorrente-overlay").style.display = "flex";
  setTimeout(() => document.getElementById("rec-descricao").focus(), 50);
}

function fecharModalRecorrente() {
  document.getElementById("modal-recorrente-overlay").style.display = "none";
  _recorrenteEditandoId = null;
}

function salvarRecorrente() {
  const erroEl = document.getElementById("rec-erro");
  const senha = document.getElementById("rec-senha").value.trim();
  if (senha !== cfg.pinCompleto) {
    erroEl.textContent = "Senha de autorização incorreta.";
    return;
  }

  const descricao = document.getElementById("rec-descricao").value.trim();
  const valor = parseFloat(document.getElementById("rec-valor").value.trim().replace(",", "."));
  const diaMes = parseInt(document.getElementById("rec-dia").value, 10);
  const prazoStr = document.getElementById("rec-prazo").value.trim();
  const prazoMeses = prazoStr ? parseInt(prazoStr, 10) : null;

  if (!descricao) { erroEl.textContent = "Informe a descrição."; return; }
  if (isNaN(valor) || valor <= 0) { erroEl.textContent = "Valor inválido."; return; }
  if (isNaN(diaMes) || diaMes < 1 || diaMes > 31) { erroEl.textContent = "Dia do mês deve ser entre 1 e 31."; return; }
  if (prazoStr && (isNaN(prazoMeses) || prazoMeses < 1)) { erroEl.textContent = "Prazo de validade deve ser em branco (indeterminado) ou um número de meses maior que zero."; return; }

  erroEl.textContent = "";
  const dados = { descricao, valor, diaMes, prazoMeses };

  // lancamentosFeitos só é zerado na criação — editar descrição/valor/dia/prazo
  // de uma recorrente existente não reinicia a contagem de meses já lançados.
  const salvar = _recorrenteEditandoId
    ? colRecorrentes.doc(_recorrenteEditandoId).update(dados)
    : colRecorrentes.add({ ...dados, lancamentosFeitos: 0, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });

  salvar.then(() => fecharModalRecorrente())
    .catch(() => { erroEl.textContent = "Erro ao salvar. Tente novamente."; });
}

function excluirRecorrente() {
  const erroEl = document.getElementById("rec-erro");
  const senha = document.getElementById("rec-senha").value.trim();
  if (senha !== cfg.pinCompleto) {
    erroEl.textContent = "Senha de autorização incorreta.";
    return;
  }
  if (!_recorrenteEditandoId) return;

  colRecorrentes.doc(_recorrenteEditandoId).delete()
    .then(() => fecharModalRecorrente())
    .catch(() => { erroEl.textContent = "Erro ao excluir. Tente novamente."; });
}

document.getElementById("rec-senha").addEventListener("keydown", e => { if (e.key === "Enter") salvarRecorrente(); });

// ── Modal despesa recorrente semanal ───────────────────────────
let _recorrenteSemanalEditandoId = null;

function popularSelectFuncionarioCondicao(selecionadoId) {
  const sel = document.getElementById("recs-condicao-funcionario");
  sel.innerHTML = funcionariosCache
    .map(f => `<option value="${f.id}">${escHtml(f.nome)}</option>`)
    .join("");
  if (selecionadoId) sel.value = selecionadoId;
}

function toggleCondicaoRecorrenteSemanal() {
  const ativa = document.getElementById("recs-condicao-ativa").checked;
  document.getElementById("recs-condicao-wrap").style.display = ativa ? "block" : "none";
  if (ativa) popularSelectFuncionarioCondicao();
}

function abrirModalRecorrenteSemanal(id) {
  _recorrenteSemanalEditandoId = id;
  const r = id ? recorrentesSemanais.find(x => x.id === id) : null;

  document.getElementById("modal-recorrente-semanal-titulo").textContent = id ? "Editar Despesa Recorrente Semanal" : "Nova Despesa Recorrente Semanal";
  document.getElementById("recs-descricao").value = r ? r.descricao : "";
  document.getElementById("recs-valor").value = r ? Number(r.valor || 0).toFixed(2).replace(".", ",") : "";
  document.getElementById("recs-prazo").value = r && r.prazoSemanas ? r.prazoSemanas : "";

  const temCondicao = !!(r && r.condicaoFuncionarioId);
  document.getElementById("recs-condicao-ativa").checked = temCondicao;
  document.getElementById("recs-condicao-wrap").style.display = temCondicao ? "block" : "none";
  popularSelectFuncionarioCondicao(r ? r.condicaoFuncionarioId : null);
  document.getElementById("recs-condicao-horario").value = (r && r.condicaoHorarioLimite) || "11:59";

  document.getElementById("recs-senha").value = "";
  document.getElementById("recs-erro").textContent = "";
  document.getElementById("recs-excluir-btn").style.display = id ? "block" : "none";
  document.getElementById("modal-recorrente-semanal-overlay").style.display = "flex";
  setTimeout(() => document.getElementById("recs-descricao").focus(), 50);
}

function fecharModalRecorrenteSemanal() {
  document.getElementById("modal-recorrente-semanal-overlay").style.display = "none";
  _recorrenteSemanalEditandoId = null;
}

function salvarRecorrenteSemanal() {
  const erroEl = document.getElementById("recs-erro");
  const senha = document.getElementById("recs-senha").value.trim();
  if (senha !== cfg.pinCompleto) {
    erroEl.textContent = "Senha de autorização incorreta.";
    return;
  }

  const descricao = document.getElementById("recs-descricao").value.trim();
  const valor = parseFloat(document.getElementById("recs-valor").value.trim().replace(",", "."));
  const prazoStr = document.getElementById("recs-prazo").value.trim();
  const prazoSemanas = prazoStr ? parseInt(prazoStr, 10) : null;
  const condicaoAtiva = document.getElementById("recs-condicao-ativa").checked;

  if (!descricao) { erroEl.textContent = "Informe a descrição."; return; }
  if (isNaN(valor) || valor <= 0) { erroEl.textContent = "Valor inválido."; return; }
  if (prazoStr && (isNaN(prazoSemanas) || prazoSemanas < 1)) { erroEl.textContent = "Prazo de validade deve ser em branco (indeterminado) ou um número de semanas maior que zero."; return; }
  if (condicaoAtiva && !document.getElementById("recs-condicao-funcionario").value) { erroEl.textContent = "Selecione o funcionário da condição de presença."; return; }

  erroEl.textContent = "";
  const dados = { descricao, valor, prazoSemanas };

  if (condicaoAtiva) {
    const funcId = document.getElementById("recs-condicao-funcionario").value;
    const func = funcionariosCache.find(f => f.id === funcId);
    dados.condicaoFuncionarioId = funcId;
    dados.condicaoFuncionarioNome = func ? func.nome : "";
    dados.condicaoHorarioLimite = document.getElementById("recs-condicao-horario").value || "11:59";
  } else if (_recorrenteSemanalEditandoId) {
    // FieldValue.delete() só é válido em update() de doc existente — numa
    // recorrente nova sem condição, simplesmente não inclui os campos.
    dados.condicaoFuncionarioId = firebase.firestore.FieldValue.delete();
    dados.condicaoFuncionarioNome = firebase.firestore.FieldValue.delete();
    dados.condicaoHorarioLimite = firebase.firestore.FieldValue.delete();
  }

  // lancamentosFeitos só é zerado na criação — editar descrição/valor/prazo
  // de uma recorrente existente não reinicia a contagem de semanas já lançadas.
  const salvar = _recorrenteSemanalEditandoId
    ? colRecorrentesSemanais.doc(_recorrenteSemanalEditandoId).update(dados)
    : colRecorrentesSemanais.add({ ...dados, lancamentosFeitos: 0, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });

  salvar.then(() => fecharModalRecorrenteSemanal())
    .catch(() => { erroEl.textContent = "Erro ao salvar. Tente novamente."; });
}

function excluirRecorrenteSemanal() {
  const erroEl = document.getElementById("recs-erro");
  const senha = document.getElementById("recs-senha").value.trim();
  if (senha !== cfg.pinCompleto) {
    erroEl.textContent = "Senha de autorização incorreta.";
    return;
  }
  if (!_recorrenteSemanalEditandoId) return;

  colRecorrentesSemanais.doc(_recorrenteSemanalEditandoId).delete()
    .then(() => fecharModalRecorrenteSemanal())
    .catch(() => { erroEl.textContent = "Erro ao excluir. Tente novamente."; });
}

document.getElementById("recs-senha").addEventListener("keydown", e => { if (e.key === "Enter") salvarRecorrenteSemanal(); });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(reg => reg.update()).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}
