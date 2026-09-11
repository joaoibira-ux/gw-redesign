const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "1.5";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("contasReceber");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoeda(v) {
  return "R$ " + (v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseMoeda(s) {
  const v = parseFloat(String(s).replace(/[^\d,]/g, "").replace(",", "."));
  return isNaN(v) ? 0 : v;
}

// "data" é salva como string DD/MM/AAAA — ordenar direto essa string não
// bate com ordem cronológica (ex: "05/01/2027" viria antes de "31/12/2026"),
// por isso converte pra Date antes de comparar.
function parseDataBR(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || "");
  if (!m) return new Date(0);
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function hoje() {
  const d = new Date();
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear()
  ].join("/");
}

let docsCache = {};

function cardHtml(id, c, baixado) {
  return `
    <div class="card ${baixado ? "baixado" : ""}">
      <div class="card-acoes">
        <button class="btn-del" onclick="excluir('${id}')" title="Excluir">✕</button>
      </div>
      <div class="card-top">
        <div class="card-desc">${c.numero ? `<span class="card-item-badge">Nº ${escHtml(c.numero)}</span>` : ""}${escHtml(c.descricao)}</div>
        <div class="card-valor">${fmtMoeda(c.valor)}</div>
      </div>
      <div class="card-meta">
        <span>${escHtml(c.data)}</span>
        <span class="badge ${baixado ? "baixado" : "aberto"}">${baixado ? "Baixado" : "Em aberto"}</span>
        ${baixado && c.dataBaixa ? `<span>Baixa: ${escHtml(c.dataBaixa)}</span>` : ""}
      </div>
    </div>`;
}

// Ordena por data e, no empate (ex: várias retenções todas vencendo
// 31/12/2027), por descrição em ordem alfabética — assim registros como
// "Retenção 5% Paradigma Bm02..Bm12" ficam na ordem certa entre si em vez
// de na ordem em que foram criados.
function compararContas(a, b) {
  const diffData = parseDataBR(a.data().data) - parseDataBR(b.data().data);
  if (diffData !== 0) return diffData;
  return (a.data().descricao || "").localeCompare(b.data().descricao || "", "pt-BR");
}

// A lista principal só mostra contas em aberto — as baixadas ficam na tela
// separada (botão "Recebidos" no cabeçalho), mesmo processo já usado em
// Contas a Pagar (tela "Pagos"), pra não poluir o que ainda precisa de atenção.
function render(docs) {
  const lista = document.getElementById("lista");
  docsCache = {};

  let totalAberto = 0;
  docs.forEach(doc => {
    const c = doc.data();
    docsCache[doc.id] = c;
    if (c.status !== "baixado") totalAberto += c.valor || 0;
  });
  document.getElementById("tot-aberto").textContent = fmtMoeda(totalAberto);

  const abertos = docs.filter(doc => doc.data().status !== "baixado").sort(compararContas);
  lista.innerHTML = abertos.length === 0
    ? '<p class="empty">Nenhuma conta em aberto.</p>'
    : abertos.map(doc => cardHtml(doc.id, doc.data(), false)).join("");

  renderRecebidos(docs);
}

function renderRecebidos(docs) {
  const lista = document.getElementById("lista-recebidos");
  if (!lista) return;
  const recebidos = docs.filter(doc => doc.data().status === "baixado").sort(compararContas);
  lista.innerHTML = recebidos.length === 0
    ? '<p class="empty">Nenhuma conta recebida ainda.</p>'
    : recebidos.map(doc => cardHtml(doc.id, doc.data(), true)).join("");
}

function abrirRecebidos() {
  document.getElementById("recebidos-overlay").style.display = "flex";
}

function fecharRecebidos() {
  document.getElementById("recebidos-overlay").style.display = "none";
}

col.orderBy("criadoEm", "asc").onSnapshot(snap => {
  render(snap.docs);
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

document.getElementById("form").addEventListener("submit", function(e) {
  e.preventDefault();
  const data      = document.getElementById("f-data").value.trim();
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

  col.add({
    data, descricao, valor, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  this.reset();
  toggleForm();
});

document.getElementById("f-valor").addEventListener("blur", function() {
  const v = parseMoeda(this.value);
  if (v > 0) this.value = v.toFixed(2).replace(".", ",");
});

document.getElementById("f-data").value = hoje();

function excluir(id) {
  const c = docsCache[id];
  if (!c) return;
  const senha = prompt("EXCLUIR CONTA A RECEBER?\n\n" + c.descricao + "\n" + fmtMoeda(c.valor) + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "6535") { alert("Senha incorreta."); return; }
  col.doc(id).delete();
}

function toggleForm() {
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  const open = form.style.display === "none" || form.style.display === "";
  form.style.display = open ? "block" : "none";
  fab.classList.toggle("open", open);
  if (open) {
    document.getElementById("f-data").value = hoje();
    document.getElementById("f-desc").focus();
  } else {
    document.getElementById("form").reset();
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
