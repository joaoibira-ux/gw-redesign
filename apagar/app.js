const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "1.12";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("contasPagar");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoeda(v) {
  return "R$ " + (v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// O campo de data usa <input type="date"> (calendário nativo), que trabalha
// em ISO (AAAA-MM-DD) — mas o resto do sistema guarda e exibe DD/MM/AAAA,
// então converte nas duas pontas.
function brParaISO(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || "").trim());
  if (!m) return "";
  const [, d, mo, a] = m;
  const ano = a.length === 2 ? "20" + a : a;
  return `${ano}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function isoParaBR(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return "";
  const [, a, mo, d] = m;
  return `${d}/${mo}/${a}`;
}

function parseMoeda(s) {
  const v = parseFloat(String(s).replace(/[^\d,]/g, "").replace(",", "."));
  return isNaN(v) ? 0 : v;
}

function hoje() {
  const d = new Date();
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear()
  ].join("/");
}

// Converte "DD/MM/AAAA" num valor compará­vel para ordenação cronológica
function parseDataOrdenacao(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((s || "").trim());
  if (!m) return 0;
  const [, d, mo, a] = m;
  const ano = a.length === 2 ? "20" + a : a;
  return new Date(Number(ano), Number(mo) - 1, Number(d)).getTime();
}

let docsCache   = {};
let editandoId  = null;
let modoSoma       = false;
let selecionados   = new Set();
let detalheAbertoId = null;

function cardHtml(id, c, opts) {
  const baixado = c.status === "baixado";
  const sel = opts.selecionavel && selecionados.has(id);
  const onclick = opts.selecionavel ? `onCardClick('${id}')` : `abrirDetalhe('${id}')`;
  return `
    <div class="card ${baixado ? "baixado" : ""} ${sel ? "selecionado" : ""}" onclick="${onclick}">
      <div class="card-top">
        <div class="card-desc">${c.numero ? `<span class="card-item-badge">Nº ${escHtml(c.numero)}</span>` : ""}${escHtml(c.descricao)}</div>
        <div class="card-valor">${fmtMoeda(c.valor)}</div>
      </div>
      <div class="card-meta">
        <span>${escHtml(c.data)}</span>
        <span class="badge ${baixado ? "baixado" : "aberto"}">${baixado ? "Pago" : "Em aberto"}</span>
        ${baixado && c.dataBaixa ? `<span>Pagto: ${escHtml(c.dataBaixa)}</span>` : ""}
        ${c.boletoUrl ? `<a href="${escHtml(c.boletoUrl)}" target="_blank" rel="noopener" class="card-boleto-clip" onclick="event.stopPropagation()" title="Ver boleto anexado">📎</a>` : ""}
      </div>
    </div>`;
}

// A lista principal só mostra contas em aberto — as pagas ficam na tela
// separada (botão "Pagos" no cabeçalho), pra não poluir o que ainda
// precisa de atenção.
function render(docs) {
  const lista = document.getElementById("lista");
  docsCache = {};

  const docsOrdenados = [...docs].sort((a, b) =>
    parseDataOrdenacao(a.data().data) - parseDataOrdenacao(b.data().data)
  );

  let totalAberto = 0;
  docsOrdenados.forEach(doc => {
    const c = doc.data();
    docsCache[doc.id] = c;
    if (c.status !== "baixado") totalAberto += c.valor || 0;
  });
  if (!modoSoma) document.getElementById("tot-aberto").textContent = fmtMoeda(totalAberto);

  const abertos = docsOrdenados.filter(doc => doc.data().status !== "baixado");

  if (abertos.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhuma conta em aberto.</p>';
  } else {
    lista.innerHTML = abertos.map(doc => cardHtml(doc.id, doc.data(), { selecionavel: true })).join("");
  }

  renderPagos(docsOrdenados);
}

// ── Tela de Pagos ───────────────────────────────────────────
function renderPagos(docsOrdenados) {
  const lista = document.getElementById("lista-pagos");
  if (!lista) return;
  const pagos = docsOrdenados.filter(doc => doc.data().status === "baixado");
  if (pagos.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhuma conta paga ainda.</p>';
    return;
  }
  lista.innerHTML = pagos.map(doc => cardHtml(doc.id, doc.data(), { selecionavel: false })).join("");
}

function abrirPagos() {
  document.getElementById("pagos-overlay").style.display = "flex";
}

function fecharPagos() {
  document.getElementById("pagos-overlay").style.display = "none";
}

col.orderBy("criadoEm", "asc").onSnapshot(snap => {
  render(snap.docs);
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

// ── Modo Somar ──────────────────────────────────────────────
function toggleSoma() {
  modoSoma = !modoSoma;
  selecionados.clear();
  const btn = document.getElementById("btn-somar");
  btn.textContent = modoSoma ? "Concluir" : "Somar";
  btn.classList.toggle("ativo", modoSoma);
  atualizarResumoSoma();
  render(Object.entries(docsCache).map(([id, c]) => ({ id, data: () => c })));
}

function atualizarResumoSoma() {
  const label = document.getElementById("resumo-label");
  const valor = document.getElementById("tot-aberto");
  if (modoSoma) {
    const total = [...selecionados].reduce((acc, id) => acc + (docsCache[id]?.valor || 0), 0);
    label.textContent = `${selecionados.size} selecionado${selecionados.size !== 1 ? "s" : ""}`;
    valor.textContent = fmtMoeda(total);
  } else {
    label.textContent = "Total em aberto";
    let totalAberto = 0;
    Object.values(docsCache).forEach(c => { if (c.status !== "baixado") totalAberto += c.valor || 0; });
    valor.textContent = fmtMoeda(totalAberto);
  }
}

function onCardClick(id) {
  if (modoSoma) {
    if (selecionados.has(id)) selecionados.delete(id);
    else selecionados.add(id);
    atualizarResumoSoma();
    render(Object.entries(docsCache).map(([k, c]) => ({ id: k, data: () => c })));
  } else {
    abrirDetalhe(id);
  }
}

// ── Tela de detalhes ────────────────────────────────────────
function abrirDetalhe(id) {
  const c = docsCache[id];
  if (!c) return;
  detalheAbertoId = id;
  const baixado = c.status === "baixado";

  document.getElementById("det-badge").textContent = baixado ? "Pago" : "Em aberto";
  document.getElementById("det-badge").className = "detalhe-badge " + (baixado ? "baixado" : "aberto");
  document.getElementById("det-desc").textContent = (c.numero ? `Nº ${c.numero} · ` : "") + (c.descricao || "");
  document.getElementById("det-valor").textContent = fmtMoeda(c.valor);

  const linhas = [`<div class="detalhe-linha"><span>Data</span><span>${escHtml(c.data)}</span></div>`];
  if (baixado && c.dataBaixa) linhas.push(`<div class="detalhe-linha"><span>Pago em</span><span>${escHtml(c.dataBaixa)}</span></div>`);

  const temPagamentoParcial = c.valorOriginal && c.valorOriginal > (c.valor || 0);
  if (temPagamentoParcial) {
    linhas.push(`<div class="detalhe-linha"><span>Valor original</span><span>${fmtMoeda(c.valorOriginal)}</span></div>`);
    if (!baixado) linhas.push(`<div class="detalhe-linha"><span>Restante a pagar</span><span>${fmtMoeda(c.valor)}</span></div>`);
  }

  if (Array.isArray(c.pagamentos) && c.pagamentos.length) {
    linhas.push(`<div class="detalhe-extrato-titulo">Extrato de pagamentos</div>`);
    c.pagamentos
      .slice()
      .sort((a, b) => parseDataOrdenacao(a.data) - parseDataOrdenacao(b.data))
      .forEach(p => {
        linhas.push(`<div class="detalhe-linha"><span>${escHtml(p.data)}</span><span>${fmtMoeda(p.valor)}</span></div>`);
      });
  }

  document.getElementById("det-linhas").innerHTML = linhas.join("");

  document.getElementById("detalhe-overlay").style.display = "flex";
}

function fecharDetalhe() {
  document.getElementById("detalhe-overlay").style.display = "none";
  detalheAbertoId = null;
}

function cancelarDaTelaDetalhe() {
  if (!detalheAbertoId) return;
  const id = detalheAbertoId;
  fecharDetalhe();
  excluir(id);
}

function editarDaTelaDetalhe() {
  if (!detalheAbertoId) return;
  const id = detalheAbertoId;
  fecharDetalhe();
  editar(id);
}

document.getElementById("form").addEventListener("submit", function(e) {
  e.preventDefault();
  const data      = isoParaBR(document.getElementById("f-data").value);
  const descricao = document.getElementById("f-desc").value.trim();
  const valor     = parseMoeda(document.getElementById("f-valor").value);

  if (!data || !descricao) {
    alert("Data e Descrição são obrigatórios.");
    return;
  }
  if (valor <= 0) {
    alert("Informe um valor maior que zero.");
    return;
  }

  if (editandoId) {
    col.doc(editandoId).update({ data, descricao, valor });
  } else {
    col.add({
      data, descricao, valor, status: "aberto",
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  this.reset();
  toggleForm();
});

document.getElementById("f-valor").addEventListener("blur", function() {
  const v = parseMoeda(this.value);
  if (v > 0) this.value = v.toFixed(2).replace(".", ",");
});

document.getElementById("f-data").value = brParaISO(hoje());

function excluir(id) {
  const c = docsCache[id];
  if (!c) return;
  const senha = prompt("EXCLUIR CONTA A PAGAR?\n\n" + c.descricao + "\n" + fmtMoeda(c.valor) + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "6535") { alert("Senha incorreta."); return; }
  col.doc(id).delete();
}

function editar(id) {
  const c = docsCache[id];
  if (!c) return;
  editandoId = id;
  document.getElementById("f-data").value = brParaISO(c.data || "");
  document.getElementById("f-desc").value = c.descricao || "";
  document.getElementById("f-valor").value = c.valor ? c.valor.toFixed(2).replace(".", ",") : "";
  document.getElementById("form-titulo").textContent = "Editar Conta a Pagar";
  document.getElementById("btn-add").textContent = "Salvar";
  document.getElementById("form").style.display = "block";
  document.getElementById("fab").classList.add("open");
  document.getElementById("f-desc").focus();
}

function toggleForm() {
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  const open = form.style.display === "none" || form.style.display === "";
  form.style.display = open ? "block" : "none";
  fab.classList.toggle("open", open);
  if (open) {
    document.getElementById("f-data").value = brParaISO(hoje());
    document.getElementById("f-desc").focus();
  } else {
    document.getElementById("form").reset();
    editandoId = null;
    document.getElementById("form-titulo").textContent = "Nova Conta a Pagar";
    document.getElementById("btn-add").textContent = "+ Cadastrar";
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
