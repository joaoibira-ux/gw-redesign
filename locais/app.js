const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "2.6";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db       = firebase.firestore();
const colLocal = db.collection("locais");
const colServ  = db.collection("servicos");
const colFunc  = db.collection("funcionarios");
const colConfig = db.collection("config");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtArea(v) {
  return (v || 0).toFixed(2).replace(".", ",") + " m²";
}

function parseDecimal(s) {
  const v = parseFloat(String(s).replace(/[^\d,]/g, "").replace(",", "."));
  return isNaN(v) ? 0 : v;
}

// ─── Ordenação de serviços ────────────────────────────────────────────────────
function ordemServico(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento"))                          return 0;
  if (n.includes("pasta"))                               return 1;
  if (n.includes("emassamento") || n.includes("massa"))  return 2;
  if (n.includes("textura"))                             return 3;
  return 99;
}

function itemValue(s) {
  const i = parseFloat(s.item);
  return isNaN(i) ? 1000 + ordemServico(s.nome) : i;
}

function sortServicos(docs) {
  return [...docs].sort((a, b) => itemValue(a) - itemValue(b));
}

// Mescla um item de serviço salvo no local com os dados atuais do app Serviços
// (nome/item podem ter mudado desde que o serviço foi atribuído ao apartamento)
function servicoAtual(s) {
  const disp = servicosDisponiveis.find(d => d.id === s.id);
  return disp ? { ...s, nome: disp.nome, item: disp.item } : s;
}

// Adiciona automaticamente novos serviços (cadastrados no app Serviços) a todos
// os apartamentos já existentes que ainda não os possuem, com status "pendente"
function sincronizarNovosServicos() {
  if (servicosDisponiveis.length === 0) return;
  Object.entries(locaisCache).forEach(([id, l]) => {
    const atuais = l.servicos || [];
    const existentes = new Set(atuais.map(s => s.id));
    const faltando = servicosDisponiveis.filter(s => !existentes.has(s.id));
    if (faltando.length === 0) return;
    const novos = faltando.map(s => ({
      id: s.id, nome: s.nome, status: "pendente",
      ...(s.item ? { item: s.item } : {})
    }));
    colLocal.doc(id).update({ servicos: [...atuais, ...novos] });
  });
}

// ─── Serviços disponíveis ─────────────────────────────────────────────────────
let servicosDisponiveis = [];

colServ.onSnapshot(snap => {
  const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  servicosDisponiveis = sortServicos(raw);
  renderCheckboxes(editandoServicos);
  sincronizarNovosServicos();
});

function renderCheckboxes(selecionados) {
  const wrap = document.getElementById("servicos-check");
  if (servicosDisponiveis.length === 0) {
    wrap.innerHTML = '<p class="check-vazio">Nenhum serviço cadastrado.</p>';
    return;
  }
  wrap.innerHTML = servicosDisponiveis.map(s => {
    const checked = selecionados.some(sel => sel.id === s.id) ? "checked" : "";
    return `
      <label class="check-item">
        <input type="checkbox" value="${s.id}" ${checked} />
        <span>${s.item ? `<span class="card-item-badge">${escHtml(s.item)}</span> ` : ""}${escHtml(s.nome)}</span>
      </label>`;
  }).join("");
}

// ─── Funcionários ─────────────────────────────────────────────────────────────
let funcionariosCache = [];

colFunc.orderBy("nome", "asc").onSnapshot(snap => {
  funcionariosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
});

// ─── Modal de seleção de funcionário ─────────────────────────────────────────
let modalLocalId   = null;
let modalServicoId = null;

function hoje() {
  const d = new Date();
  return [String(d.getDate()).padStart(2,"0"), String(d.getMonth()+1).padStart(2,"0"), d.getFullYear()].join("/");
}

function parseMoeda(s) {
  const v = parseFloat(String(s).replace(/[^\d,]/g, "").replace(",", "."));
  return isNaN(v) ? 0 : v;
}

function fmtMoeda(v) {
  return "R$ " + (v||0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function abrirModalFuncionarios(localId, servicoId) {
  modalLocalId   = localId;
  modalServicoId = servicoId;

  // Pré-preenche valor com mdo do serviço cadastrado
  const servDisp = servicosDisponiveis.find(s => s.id === servicoId);
  const mdoVal   = servDisp && servDisp.mdo > 0 ? servDisp.mdo.toFixed(2).replace(".", ",") : "";
  document.getElementById("modal-valor").value = mdoVal;
  document.getElementById("modal-data").value  = hoje();
  document.getElementById("modal-titulo-serv").textContent = servDisp ? servDisp.nome : "Quem executou?";

  const lista = document.getElementById("modal-lista-func");
  lista.innerHTML = funcionariosCache.length === 0
    ? '<p class="check-vazio">Nenhum funcionário cadastrado.</p>'
    : funcionariosCache.map(f => `
        <button class="func-item" onclick="confirmarExecucao('${f.id}','${escHtml(f.nome)}')">
          <span class="func-nome">${escHtml(f.nome)}</span>
          <span class="func-cargo">${escHtml(f.cargo)}</span>
        </button>`).join("");

  document.getElementById("modal-func").style.display = "flex";
}

function confirmarExecucao(funcId, funcNome) {
  const l = locaisCache[modalLocalId];
  if (!l) { fecharModal(); return; }
  const valorPago     = parseMoeda(document.getElementById("modal-valor").value);
  const dataPagamento = document.getElementById("modal-data").value.trim();
  const servicos = (l.servicos || []).map(s =>
    s.id === modalServicoId
      ? { id: s.id, nome: s.nome, status: "concluido",
          executor: { id: funcId, nome: funcNome },
          valorPago, dataPagamento }
      : s
  );
  colLocal.doc(modalLocalId).update({ servicos });
  fecharModal();
}

function fecharModal() {
  document.getElementById("modal-func").style.display = "none";
  modalLocalId   = null;
  modalServicoId = null;
}

// ─── Locais ───────────────────────────────────────────────────────────────────
let locaisCache      = {};
let editandoId       = null;
let editandoServicos = [];

function render(docs) {
  const lista = document.getElementById("lista");
  locaisCache = {};

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhum local cadastrado.</p>';
    return;
  }

  lista.innerHTML = docs.map(doc => {
    const l = doc.data();
    locaisCache[doc.id] = l;
    const servs      = [...(l.servicos || [])].map(servicoAtual).sort((a, b) => itemValue(a) - itemValue(b));
    const total      = servs.length;
    const concluidos = servs.filter(s => s.status === "concluido").length;
    const progresso  = total > 0
      ? `<div class="prog-bar"><div class="prog-fill" style="width:${Math.round(concluidos/total*100)}%"></div></div>`
      : "";

    const labelStatus = s => {
      if (s.status === "concluido")    return "concluído";
      if (s.status === "em_pagamento") return "na folha";
      return "pendente";
    };
    const iconeStatus = s => {
      if (s.status === "concluido")    return "✓";
      if (s.status === "em_pagamento") return "⏳";
      return "○";
    };

    const listaServs = servs.length === 0
      ? '<p class="check-vazio">Sem serviços atribuídos.</p>'
      : servs.map(s => {
          const executor = s.executor
            ? `<span class="serv-executor">${escHtml(s.executor.nome)}${s.dataPagamento ? ` · ${escHtml(s.dataPagamento)}` : ""}${s.valorPago > 0 ? ` · ${fmtMoeda(s.valorPago)}` : ""}</span>`
            : "";
          return `
            <button class="serv-item ${s.status}" onclick="toggleServico('${doc.id}','${s.id}')">
              <span class="serv-icone">${iconeStatus(s)}</span>
              <div class="serv-info">
                <span class="serv-nome">${s.item ? `<span class="card-item-badge">${escHtml(s.item)}</span> ` : ""}${escHtml(s.nome)}</span>
                ${executor}
              </div>
              <span class="serv-badge ${s.status}">${labelStatus(s)}</span>
            </button>`;
        }).join("");

    return `
      <div class="card">
        <div class="card-acoes">
          <button class="btn-edit" onclick="editarLocal('${doc.id}')" title="Editar">✏</button>
          <button class="btn-del"  onclick="excluir('${doc.id}')"     title="Excluir">✕</button>
        </div>
        <div class="card-top">
          <span class="badge">${escHtml(l.tipo)}</span>
          <span class="card-id">${escHtml(l.identificacao)}</span>
          <span class="card-area">${fmtArea(l.area)}</span>
        </div>
        ${total > 0 ? `<div class="card-prog">${concluidos}/${total} concluídos ${progresso}</div>` : ""}
        <div class="servicos-lista">${listaServs}</div>
      </div>`;
  }).join("");
}

colLocal.orderBy("identificacao", "asc").onSnapshot(snap => {
  render(snap.docs);
  sincronizarNovosServicos();
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

// ─── Toggle serviço ───────────────────────────────────────────────────────────
function toggleServico(localId, servicoId) {
  const l = locaisCache[localId];
  if (!l) return;
  const serv = (l.servicos || []).find(s => s.id === servicoId);
  if (!serv) return;

  if (serv.status === "concluido") {
    const info = serv.executor ? `Executor: ${serv.executor.nome}` : "";
    const senha = prompt(`DESMARCAR EXECUÇÃO?\n\n${serv.nome}\n${info}\n\nDigite a senha:`);
    if (senha === null) return;
    if (senha !== "4512") { alert("Senha incorreta."); return; }
    const servicos = (l.servicos || []).map(s =>
      s.id === servicoId ? { id: s.id, nome: s.nome, status: "pendente" } : s
    );
    colLocal.doc(localId).update({ servicos });

  } else if (serv.status === "em_pagamento") {
    const senha = prompt(`CANCELAR DA FOLHA?\n\n${serv.nome}\nEste item voltará para pendente no mapa.\n\nDigite a senha:`);
    if (senha === null) return;
    if (senha !== "4512") { alert("Senha incorreta."); return; }
    const servicos = (l.servicos || []).map(s =>
      s.id === servicoId ? { id: s.id, nome: s.nome, status: "pendente" } : s
    );
    colLocal.doc(localId).update({ servicos });

  } else {
    abrirModalFuncionarios(localId, servicoId);
  }
}

// ─── Formulário ───────────────────────────────────────────────────────────────
document.getElementById("form").addEventListener("submit", function(e) {
  e.preventDefault();
  const tipo          = document.getElementById("f-tipo").value;
  const identificacao = document.getElementById("f-id").value.trim().toUpperCase();
  const area          = parseDecimal(document.getElementById("f-area").value);

  if (!identificacao) {
    alert("Identificação é obrigatória.");
    return;
  }

  const checks  = document.querySelectorAll("#servicos-check input[type=checkbox]:checked");
  const novoIds = Array.from(checks).map(c => c.value);
  const servicosAntigos = editandoId ? (locaisCache[editandoId]?.servicos || []) : [];
  const servicos = novoIds.map(id => {
    const disp    = servicosDisponiveis.find(s => s.id === id);
    const existia = servicosAntigos.find(s => s.id === id);
    return existia
      ? { id, nome: disp ? disp.nome : id, status: existia.status, ...(existia.executor ? { executor: existia.executor } : {}) }
      : { id, nome: disp ? disp.nome : id, status: "pendente" };
  });

  if (editandoId) {
    colLocal.doc(editandoId).update({ tipo, identificacao, area, servicos });
    editandoId = null;
  } else {
    colLocal.add({ tipo, identificacao, area, servicos,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }

  this.reset();
  toggleForm();
});

document.getElementById("f-area").addEventListener("blur", function() {
  const v = parseDecimal(this.value);
  if (v > 0) this.value = v.toFixed(2).replace(".", ",");
});

// ─── Editar ───────────────────────────────────────────────────────────────────
function editarLocal(id) {
  const l = locaisCache[id];
  if (!l) return;
  editandoId       = id;
  editandoServicos = l.servicos || [];

  document.getElementById("form-titulo").textContent = "Editar Local";
  document.getElementById("btn-submit").textContent  = "✓ Salvar alterações";
  document.getElementById("f-tipo").value = l.tipo || "Apartamento";
  document.getElementById("f-id").value   = l.identificacao || "";
  document.getElementById("f-area").value = l.area > 0
    ? l.area.toFixed(2).replace(".", ",") : "";
  renderCheckboxes(editandoServicos);

  document.getElementById("form").style.display = "block";
  document.getElementById("fab").classList.add("open");
  document.getElementById("f-id").focus();
}

// ─── Excluir ──────────────────────────────────────────────────────────────────
function excluir(id) {
  const l = locaisCache[id];
  if (!l) return;
  const senha = prompt(`EXCLUIR LOCAL?\n\n${l.tipo} — ${l.identificacao}\n\nDigite a senha:`);
  if (senha === null) return;
  if (senha !== "4512") { alert("Senha incorreta."); return; }
  colLocal.doc(id).delete();
}

// ─── Abrir / fechar form ──────────────────────────────────────────────────────
function toggleForm() {
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  const open = form.style.display === "none" || form.style.display === "";
  form.style.display = open ? "block" : "none";
  fab.classList.toggle("open", open);
  if (open) {
    editandoServicos = [];
    renderCheckboxes([]);
    document.getElementById("f-id").focus();
  } else {
    editandoId       = null;
    editandoServicos = [];
    document.getElementById("form-titulo").textContent = "Novo Local";
    document.getElementById("btn-submit").textContent  = "+ Cadastrar";
    document.getElementById("form").reset();
    renderCheckboxes([]);
  }
}

// ─── Configuração do local do ponto ────────────────────────────────────────────
function abrirConfigPonto() {
  const senha = prompt("Configurar local do ponto\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "2248") { alert("Senha incorreta."); return; }

  colConfig.doc("ponto").get().then(snap => {
    const d = snap.exists ? snap.data() : {};
    document.getElementById("cp-lat").value  = d.latitude  != null ? d.latitude  : "";
    document.getElementById("cp-lng").value  = d.longitude != null ? d.longitude : "";
    document.getElementById("cp-raio").value = d.raio      != null ? d.raio      : "200";
    document.getElementById("modal-ponto").style.display = "flex";
  });
}

function fecharConfigPonto() {
  document.getElementById("modal-ponto").style.display = "none";
}

function usarLocalizacaoAtual() {
  if (!navigator.geolocation) { alert("Geolocalização não disponível neste dispositivo."); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById("cp-lat").value = pos.coords.latitude;
    document.getElementById("cp-lng").value = pos.coords.longitude;
  }, err => {
    alert("Erro ao obter localização: " + err.message);
  }, { timeout: 10000, maximumAge: 60000 });
}

function salvarConfigPonto() {
  const lat  = parseFloat(String(document.getElementById("cp-lat").value).replace(",", "."));
  const lng  = parseFloat(String(document.getElementById("cp-lng").value).replace(",", "."));
  const raio = parseFloat(String(document.getElementById("cp-raio").value).replace(",", "."));
  if (isNaN(lat) || isNaN(lng)) { alert("Latitude e longitude são obrigatórias."); return; }
  colConfig.doc("ponto").set({ latitude: lat, longitude: lng, raio: isNaN(raio) ? 200 : raio });
  fecharConfigPonto();
  alert("Local do ponto salvo!");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
