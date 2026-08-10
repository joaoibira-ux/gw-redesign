const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const VERSAO = "1.1";
document.getElementById("versao-app").textContent = "v" + VERSAO;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

const col = db.collection("estoques");

let itensCache   = [];
let filtroCateg  = "Matéria-Prima";
let filtroLocal  = "";
let itemAtual    = null;
let editandoId   = null;
let tipoMovAtual = "entrada";

// ── Utilitários ──────────────────────────────────────────────
function hoje() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

function parseDecimal(s) {
  return parseFloat(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

function fmtQtd(v) {
  const n = Number(v || 0);
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(".", ",");
}

function fmtMoeda(v) {
  return "R$ " + (v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function catCls(cat) {
  return { "Matéria-Prima": "badge-materia", "Produto": "badge-produto", "Aditivo": "badge-aditivo" }[cat] || "";
}

function localCls(local) {
  return local === "Fábrica" ? "badge-fabrica" : "badge-obra";
}

function calcularQuantidade(item) {
  return (item.movimentacoes || []).reduce((s, m) => s + (m.tipo === "entrada" ? m.quantidade : -m.quantidade), 0);
}

// ── Listener principal ────────────────────────────────────────
col.orderBy("criadoEm", "asc").onSnapshot(snap => {
  itensCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderLista();
  if (itemAtual) {
    const atualizado = itensCache.find(i => i.id === itemAtual.id);
    if (atualizado) { itemAtual = atualizado; renderDetalhe(); }
  }
}, err => {
  console.error(err);
  document.getElementById("lista-itens").innerHTML = '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

// ── Tabs de categoria ────────────────────────────────────────
document.querySelectorAll("#tabs-categoria .tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs-categoria .tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    filtroCateg = btn.dataset.cat;
    // O filtro de local só faz sentido pra Matéria-Prima — só ela existe
    // nos dois locais; Produto e Aditivo só existem na Obra.
    document.getElementById("tabs-local").style.display = filtroCateg === "Matéria-Prima" ? "flex" : "none";
    renderLista();
  });
});

document.querySelectorAll("#tabs-local .tab-local").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs-local .tab-local").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    filtroLocal = btn.dataset.local;
    renderLista();
  });
});

// ── Render lista ─────────────────────────────────────────────
function renderLista() {
  const lista = document.getElementById("lista-itens");
  let itens = itensCache.filter(i => i.categoria === filtroCateg);
  if (filtroCateg === "Matéria-Prima" && filtroLocal) {
    itens = itens.filter(i => i.local === filtroLocal);
  }

  if (!itens.length) {
    lista.innerHTML = '<p class="empty">Nenhum item cadastrado.<br>Toque em + para adicionar.</p>';
    return;
  }

  lista.innerHTML = itens.map(item => {
    const qtd = calcularQuantidade(item);
    return `
      <div class="item-card" data-id="${esc(item.id)}">
        <div class="item-top">
          <div class="item-nome">${esc(item.nome)}</div>
          <span class="badge ${localCls(item.local)}">${esc(item.local)}</span>
        </div>
        <div class="item-qtd-row">
          <span class="item-qtd${qtd < 0 ? ' neg' : ''}">${fmtQtd(qtd)}</span>
          <span class="item-unidade">${esc(item.unidade || "")}</span>
        </div>
      </div>`;
  }).join("");

  lista.querySelectorAll(".item-card").forEach(card => {
    card.addEventListener("click", () => abrirDetalhe(card.dataset.id));
  });
}

// ── Cadastro ─────────────────────────────────────────────────
document.getElementById("btn-novo").addEventListener("click", () => abrirCadastro(null));
document.getElementById("btn-cancelar-cadastro").addEventListener("click", fecharCadastro);
document.getElementById("btn-salvar-item").addEventListener("click", salvarItem);
document.getElementById("btn-excluir-item").addEventListener("click", excluirItem);
document.getElementById("f-categoria").addEventListener("change", atualizarVisibilidadeLocal);

function atualizarVisibilidadeLocal() {
  const cat = document.getElementById("f-categoria").value;
  const wrap = document.getElementById("f-local-wrap");
  if (cat === "Matéria-Prima") {
    wrap.style.display = "block";
  } else {
    // Produto e Aditivo só existem na Obra — trava o valor e esconde o campo.
    document.getElementById("f-local").value = "Obra";
    wrap.style.display = "none";
  }
}

function abrirCadastro(id) {
  editandoId = id;
  document.getElementById("cadastro-titulo").textContent = id ? "Editar Item" : "Novo Item";
  document.getElementById("btn-excluir-item").style.display = id ? "block" : "none";

  if (id) {
    const item = itensCache.find(i => i.id === id);
    if (!item) return;
    document.getElementById("f-nome").value     = item.nome || "";
    document.getElementById("f-categoria").value = item.categoria || "Matéria-Prima";
    document.getElementById("f-local").value    = item.local || "Obra";
    document.getElementById("f-unidade").value  = item.unidade || "";
  } else {
    document.getElementById("f-nome").value     = "";
    document.getElementById("f-categoria").value = filtroCateg;
    document.getElementById("f-local").value    = filtroLocal || "Obra";
    document.getElementById("f-unidade").value  = "";
  }
  atualizarVisibilidadeLocal();

  document.getElementById("overlay-cadastro").style.display = "flex";
}

function fecharCadastro() {
  document.getElementById("overlay-cadastro").style.display = "none";
  editandoId = null;
}

async function salvarItem() {
  const nome = document.getElementById("f-nome").value.trim();
  if (!nome) { alert("Nome é obrigatório."); return; }

  const dados = {
    nome,
    categoria: document.getElementById("f-categoria").value,
    local:     document.getElementById("f-local").value,
    unidade:   document.getElementById("f-unidade").value.trim(),
  };

  if (editandoId) {
    await col.doc(editandoId).update(dados);
  } else {
    await col.add({ ...dados, movimentacoes: [], criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }
  fecharCadastro();
}

async function excluirItem() {
  if (!editandoId) return;
  const senha = prompt("EXCLUIR este item permanentemente?\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "6535") { alert("Senha incorreta."); return; }
  await col.doc(editandoId).delete();
  fecharCadastro();
}

// ── Detalhe ──────────────────────────────────────────────────
document.getElementById("btn-fechar-detalhe").addEventListener("click", fecharDetalhe);
document.getElementById("btn-editar-item").addEventListener("click", () => {
  if (!itemAtual) return;
  const id = itemAtual.id; // capturar antes: fecharDetalhe() zera itemAtual
  fecharDetalhe();
  abrirCadastro(id);
});
document.getElementById("btn-abrir-movimentacao").addEventListener("click", abrirMovimentacao);

function abrirDetalhe(id) {
  itemAtual = itensCache.find(i => i.id === id) || null;
  if (!itemAtual) return;
  renderDetalhe();
  document.getElementById("overlay-detalhe").style.display = "flex";
}

function fecharDetalhe() {
  document.getElementById("overlay-detalhe").style.display = "none";
  itemAtual = null;
}

function renderDetalhe() {
  if (!itemAtual) return;
  const qtd = calcularQuantidade(itemAtual);

  document.getElementById("detalhe-header").innerHTML = `
    <div class="detalhe-nome">${esc(itemAtual.nome)}</div>
    <div class="detalhe-meta">
      <span class="badge ${catCls(itemAtual.categoria)}">${esc(itemAtual.categoria)}</span>
      <span class="badge ${localCls(itemAtual.local)}">${esc(itemAtual.local)}</span>
    </div>
    <div class="detalhe-qtd${qtd < 0 ? ' neg' : ''}">${fmtQtd(qtd)} <span class="detalhe-unidade">${esc(itemAtual.unidade || "")}</span></div>
    <hr class="divider" />`;

  const movs = [...(itemAtual.movimentacoes || [])].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  const movsEl = document.getElementById("detalhe-movimentacoes");

  if (!movs.length) {
    movsEl.innerHTML = '<p class="empty" style="padding:12px 0">Nenhuma movimentação registrada.</p>';
  } else {
    movsEl.innerHTML = movs.map((m, idx) => {
      const infoPartes = [m.data || "—"];
      if (m.fornecedor) infoPartes.push(m.fornecedor);
      if (m.valor) infoPartes.push(fmtMoeda(m.valor));
      return `
      <div class="mov-row">
        <div>
          <div class="mov-motivo">${esc(m.motivo || "(sem motivo)")}</div>
          <div class="mov-info">${esc(infoPartes.join(" · "))}</div>
        </div>
        <span class="mov-qtd ${m.tipo === 'entrada' ? 'pos' : 'neg'}">${m.tipo === 'entrada' ? '+' : '−'}${fmtQtd(m.quantidade)}</span>
      </div>`;
    }).join("");
  }
}

// ── Movimentação (entrada/saída) ───────────────────────────────
document.getElementById("btn-cancelar-movimentacao").addEventListener("click", fecharMovimentacao);
document.getElementById("btn-confirmar-movimentacao").addEventListener("click", confirmarMovimentacao);
document.getElementById("btn-tipo-entrada").addEventListener("click", () => selecionarTipoMov("entrada"));
document.getElementById("btn-tipo-saida").addEventListener("click", () => selecionarTipoMov("saida"));

function selecionarTipoMov(tipo) {
  tipoMovAtual = tipo;
  document.getElementById("btn-tipo-entrada").classList.toggle("active", tipo === "entrada");
  document.getElementById("btn-tipo-saida").classList.toggle("active", tipo === "saida");
  // Fornecedor/valor (e a conta a pagar gerada a partir deles) só fazem
  // sentido numa entrada — uma saída é uso/consumo, não uma compra.
  document.getElementById("mov-entrada-extra").style.display = tipo === "entrada" ? "block" : "none";
}

function abrirMovimentacao() {
  if (!itemAtual) return;
  selecionarTipoMov("entrada");
  document.getElementById("f-mov-qtd").value = "";
  document.getElementById("f-mov-data").value = hoje();
  document.getElementById("f-mov-motivo").value = "";
  document.getElementById("f-mov-fornecedor").value = "";
  document.getElementById("f-mov-valor").value = "";
  document.getElementById("mov-item-info").textContent = itemAtual.nome;
  document.getElementById("overlay-movimentacao").style.display = "flex";
}

function fecharMovimentacao() {
  document.getElementById("overlay-movimentacao").style.display = "none";
}

async function confirmarMovimentacao() {
  const qtd = parseDecimal(document.getElementById("f-mov-qtd").value);
  if (qtd <= 0) { alert("Quantidade inválida."); return; }

  if (tipoMovAtual === "saida") {
    const atual = calcularQuantidade(itemAtual);
    if (qtd > atual) {
      alert(`Estoque insuficiente. Disponível: ${fmtQtd(atual)} ${itemAtual.unidade || ""}`);
      return;
    }
  }

  const data = document.getElementById("f-mov-data").value.trim();
  const motivo = document.getElementById("f-mov-motivo").value.trim();
  const fornecedor = tipoMovAtual === "entrada" ? document.getElementById("f-mov-fornecedor").value.trim() : "";
  const valor = tipoMovAtual === "entrada" ? parseDecimal(document.getElementById("f-mov-valor").value) : 0;

  const novaMov = {
    tipo: tipoMovAtual,
    quantidade: qtd,
    motivo,
    data,
    criadoEm: new Date().toISOString()
  };
  if (fornecedor) novaMov.fornecedor = fornecedor;
  if (valor > 0) novaMov.valor = valor;

  const batch = db.batch();
  batch.update(col.doc(itemAtual.id), {
    movimentacoes: firebase.firestore.FieldValue.arrayUnion(novaMov)
  });

  // Entrada com valor preenchido = compra -> gera automaticamente o
  // lançamento em Contas a Pagar pro fornecedor informado.
  if (tipoMovAtual === "entrada" && valor > 0) {
    const descricaoCP = fornecedor
      ? `Estoque: ${itemAtual.nome} (${fornecedor})`
      : `Estoque: ${itemAtual.nome}`;
    batch.set(db.collection("contasPagar").doc(), {
      data,
      descricao: descricaoCP,
      valor,
      status: "aberto",
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  await batch.commit();
  fecharMovimentacao();
}
