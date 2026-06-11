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

const VERSAO = "1.0";
document.getElementById("versao-app").textContent = "v" + VERSAO;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

const col = db.collection("almoxarifado");

let itensCache    = [];
let filtroCateg   = "";
let itemAtual     = null;
let editandoId    = null;
let funcSelecionado = null;

// ── Utilitários ──────────────────────────────────────────────
function hoje() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

function fmtMoeda(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMoeda(s) {
  return parseFloat(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function qtdsDeItem(item) {
  const entregas = item.entregas || [];
  const comFuncionarios = entregas.reduce((s, e) => s + (Number(e.quantidade) || 0), 0);
  const emEstoque = (item.quantidadeTotal || 0) - comFuncionarios;
  return { comFuncionarios, emEstoque };
}

// ── Listener principal ────────────────────────────────────────
col.orderBy("criadoEm", "asc").onSnapshot(snap => {
  itensCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderLista();
  // Atualiza detalhe aberto se existir
  if (itemAtual) {
    const atualizado = itensCache.find(i => i.id === itemAtual.id);
    if (atualizado) { itemAtual = atualizado; renderDetalhe(); }
  }
});

// ── Tabs ─────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    filtroCateg = btn.dataset.cat;
    renderLista();
  });
});

// ── Render lista ─────────────────────────────────────────────
function renderLista() {
  const lista = document.getElementById("lista-itens");
  const itens = filtroCateg
    ? itensCache.filter(i => i.categoria === filtroCateg)
    : itensCache;

  if (!itens.length) {
    lista.innerHTML = '<p class="empty">Nenhum item cadastrado.<br>Toque em + para adicionar.</p>';
    return;
  }

  lista.innerHTML = itens.map(item => {
    const { comFuncionarios, emEstoque } = qtdsDeItem(item);
    const catCls = item.categoria === "EPI" ? "badge-epi" : "badge-ferramenta";
    const estCls = { Novo: "estado-novo", Bom: "estado-bom", Desgastado: "estado-desgastado", Danificado: "estado-danificado" }[item.estado] || "";
    return `
      <div class="item-card" data-id="${esc(item.id)}">
        <div class="item-top">
          <div class="item-nome">${esc(item.nome)}</div>
          <span class="badge ${catCls}">${esc(item.categoria)}</span>
        </div>
        <div class="item-sub">
          <span class="item-id">${esc(item.identificacao || "—")}</span>
          <span class="badge ${estCls}">${esc(item.estado || "—")}</span>
        </div>
        <div class="item-qtds">
          <div class="qtd-box"><span class="qtd-num">${item.quantidadeTotal || 0}</span><span class="qtd-label">Total</span></div>
          <div class="qtd-box"><span class="qtd-num${emEstoque < 0 ? ' neg' : ''}">${emEstoque}</span><span class="qtd-label">Estoque</span></div>
          <div class="qtd-box"><span class="qtd-num">${comFuncionarios}</span><span class="qtd-label">c/ Func.</span></div>
        </div>
        ${item.valor ? `<div class="item-valor">${fmtMoeda(item.valor)}</div>` : ""}
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

function abrirCadastro(id) {
  editandoId = id;
  document.getElementById("cadastro-titulo").textContent = id ? "Editar Item" : "Novo Item";
  document.getElementById("btn-excluir-item").style.display = id ? "block" : "none";

  if (id) {
    const item = itensCache.find(i => i.id === id);
    if (!item) return;
    document.getElementById("f-nome").value        = item.nome || "";
    document.getElementById("f-categoria").value   = item.categoria || "EPI";
    document.getElementById("f-estado").value      = item.estado || "Bom";
    document.getElementById("f-identificacao").value = item.identificacao || "";
    document.getElementById("f-valor").value       = item.valor ? String(item.valor).replace(".", ",") : "";
    document.getElementById("f-quantidade").value  = item.quantidadeTotal || "";
  } else {
    document.getElementById("f-nome").value        = "";
    document.getElementById("f-categoria").value   = "EPI";
    document.getElementById("f-estado").value      = "Bom";
    document.getElementById("f-identificacao").value = "";
    document.getElementById("f-valor").value       = "";
    document.getElementById("f-quantidade").value  = "";
  }

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
    categoria:       document.getElementById("f-categoria").value,
    estado:          document.getElementById("f-estado").value,
    identificacao:   document.getElementById("f-identificacao").value.trim(),
    valor:           parseMoeda(document.getElementById("f-valor").value),
    quantidadeTotal: parseInt(document.getElementById("f-quantidade").value) || 0,
  };

  if (editandoId) {
    await col.doc(editandoId).update(dados);
  } else {
    await col.add({ ...dados, entregas: [], criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }
  fecharCadastro();
}

async function excluirItem() {
  if (!editandoId) return;
  const senha = prompt("EXCLUIR este item permanentemente?\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "4512") { alert("Senha incorreta."); return; }
  await col.doc(editandoId).delete();
  fecharCadastro();
}

// ── Detalhe ──────────────────────────────────────────────────
document.getElementById("btn-fechar-detalhe").addEventListener("click", fecharDetalhe);
document.getElementById("btn-editar-item").addEventListener("click", () => {
  if (!itemAtual) return;
  fecharDetalhe();
  abrirCadastro(itemAtual.id);
});
document.getElementById("btn-abrir-entrega").addEventListener("click", abrirEntrega);

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
  const { comFuncionarios, emEstoque } = qtdsDeItem(itemAtual);
  const catCls = itemAtual.categoria === "EPI" ? "badge-epi" : "badge-ferramenta";
  const estCls = { Novo: "estado-novo", Bom: "estado-bom", Desgastado: "estado-desgastado", Danificado: "estado-danificado" }[itemAtual.estado] || "";

  document.getElementById("detalhe-header").innerHTML = `
    <div class="detalhe-nome">${esc(itemAtual.nome)}</div>
    <div class="detalhe-meta">
      <span class="badge ${catCls}">${esc(itemAtual.categoria)}</span>
      <span class="badge ${estCls}">${esc(itemAtual.estado || "—")}</span>
      ${itemAtual.identificacao ? `<span class="detalhe-id">${esc(itemAtual.identificacao)}</span>` : ""}
    </div>
    <div class="detalhe-qtds">
      <div class="qtd-box"><span class="qtd-num">${itemAtual.quantidadeTotal || 0}</span><span class="qtd-label">Total</span></div>
      <div class="qtd-box"><span class="qtd-num${emEstoque < 0 ? ' neg' : ''}">${emEstoque}</span><span class="qtd-label">Estoque</span></div>
      <div class="qtd-box"><span class="qtd-num">${comFuncionarios}</span><span class="qtd-label">c/ Func.</span></div>
    </div>
    ${itemAtual.valor ? `<div class="detalhe-valor">${fmtMoeda(itemAtual.valor)}</div>` : ""}
    <hr class="divider" />`;

  const entregas = itemAtual.entregas || [];
  const entregasEl = document.getElementById("detalhe-entregas");

  if (!entregas.length) {
    entregasEl.innerHTML = '<p class="empty" style="padding:12px 0">Nenhuma entrega registrada.</p>';
  } else {
    entregasEl.innerHTML = entregas.map((e, idx) => `
      <div class="entrega-row">
        <div>
          <div class="entrega-func">${esc(e.funcionarioNome)}</div>
          <div class="entrega-info">${e.quantidade} un. · ${esc(e.data || "—")}</div>
        </div>
        <button class="btn-devolver" data-idx="${idx}">Devolver</button>
      </div>`).join("");

    entregasEl.querySelectorAll(".btn-devolver").forEach(btn => {
      btn.addEventListener("click", () => devolverItem(parseInt(btn.dataset.idx)));
    });
  }
}

// ── Entrega ──────────────────────────────────────────────────
document.getElementById("btn-cancelar-entrega").addEventListener("click", fecharEntrega);
document.getElementById("btn-confirmar-entrega").addEventListener("click", confirmarEntrega);
document.getElementById("func-selecionado").addEventListener("click", abrirPicker);

function abrirEntrega() {
  if (!itemAtual) return;
  const { emEstoque } = qtdsDeItem(itemAtual);
  if (emEstoque <= 0) {
    alert("Sem estoque disponível para entrega.");
    return;
  }
  funcSelecionado = null;
  const el = document.getElementById("func-selecionado");
  el.textContent = "Toque para selecionar →";
  el.classList.remove("selecionado");
  document.getElementById("f-entrega-qtd").value = "1";
  document.getElementById("f-entrega-data").value = hoje();
  document.getElementById("entrega-item-info").textContent = itemAtual.nome;
  document.getElementById("overlay-entrega").style.display = "flex";
}

function fecharEntrega() {
  document.getElementById("overlay-entrega").style.display = "none";
}

async function confirmarEntrega() {
  if (!funcSelecionado) { alert("Selecione um funcionário."); return; }
  const qtd = parseInt(document.getElementById("f-entrega-qtd").value) || 0;
  if (qtd <= 0) { alert("Quantidade inválida."); return; }

  const { emEstoque } = qtdsDeItem(itemAtual);
  if (qtd > emEstoque) { alert(`Estoque insuficiente. Disponível: ${emEstoque}`); return; }

  const data = document.getElementById("f-entrega-data").value.trim();
  const entregas = [...(itemAtual.entregas || [])];

  const idx = entregas.findIndex(e => e.funcionarioId === funcSelecionado.id);
  if (idx >= 0) {
    entregas[idx] = { ...entregas[idx], quantidade: entregas[idx].quantidade + qtd, data };
  } else {
    entregas.push({ funcionarioId: funcSelecionado.id, funcionarioNome: funcSelecionado.nome, quantidade: qtd, data });
  }

  await col.doc(itemAtual.id).update({ entregas });
  fecharEntrega();
}

async function devolverItem(idx) {
  const entregas = [...(itemAtual.entregas || [])];
  const e = entregas[idx];
  if (!e) return;

  const resp = prompt(`Devolver quantas unidades?\n${e.funcionarioNome} tem ${e.quantidade} un.\n(deixe em branco para devolver tudo)`);
  if (resp === null) return;
  const qtd = resp.trim() === "" ? e.quantidade : parseInt(resp) || 0;
  if (qtd <= 0) return;

  if (qtd >= e.quantidade) {
    entregas.splice(idx, 1);
  } else {
    entregas[idx] = { ...e, quantidade: e.quantidade - qtd };
  }

  await col.doc(itemAtual.id).update({ entregas });
}

// ── Picker de funcionário ────────────────────────────────────
document.getElementById("btn-fechar-picker").addEventListener("click", fecharPicker);

function abrirPicker() {
  const lista = document.getElementById("picker-lista");
  lista.innerHTML = '<p class="empty">Carregando...</p>';
  document.getElementById("overlay-picker").style.display = "flex";

  db.collection("funcionarios").orderBy("nome").get().then(snap => {
    const ativos = snap.docs.filter(d => d.data().ativo !== false);
    if (!ativos.length) {
      lista.innerHTML = '<p class="empty">Nenhum funcionário ativo.</p>';
      return;
    }
    lista.innerHTML = ativos.map(d => {
      const f = d.data();
      return `<div class="picker-item" data-id="${esc(d.id)}" data-nome="${esc(f.nome)}" data-cargo="${esc(f.cargo || '')}">
        ${esc(f.nome)}
        <span class="picker-cargo">${esc(f.cargo || "")}</span>
      </div>`;
    }).join("");

    lista.querySelectorAll(".picker-item").forEach(el => {
      el.addEventListener("click", () => {
        funcSelecionado = { id: el.dataset.id, nome: el.dataset.nome, cargo: el.dataset.cargo };
        const el2 = document.getElementById("func-selecionado");
        el2.textContent = funcSelecionado.nome;
        el2.classList.add("selecionado");
        fecharPicker();
      });
    });
  });
}

function fecharPicker() {
  document.getElementById("overlay-picker").style.display = "none";
}
