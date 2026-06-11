const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "1.1";
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

function hoje() {
  const d = new Date();
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear()
  ].join("/");
}

let docsCache = {};

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

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhuma conta a receber cadastrada.</p>';
    return;
  }

  lista.innerHTML = docs.map(doc => {
    const c = doc.data();
    const baixado = c.status === "baixado";
    return `
      <div class="card ${baixado ? "baixado" : ""}">
        <div class="card-acoes">
          <button class="btn-del" onclick="excluir('${doc.id}')" title="Excluir">✕</button>
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
  }).join("");
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
  if (senha !== "4512") { alert("Senha incorreta."); return; }
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
