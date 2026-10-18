const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "1.0";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("solicitacoesCompra");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDataHora(ts) {
  if (!ts || !ts.toDate) return "";
  return ts.toDate().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

let itensCache = {};
let editandoId = null;
let filtroAtual = "pendente";

function filtrar(f) {
  filtroAtual = f;
  ["pendente", "comprado", "todas"].forEach(x =>
    document.getElementById(`f-${x}`).classList.toggle("ativo", x === f));
  renderAtual();
}

let _ultimoDocs = [];

function render(docs) {
  itensCache = {};
  docs.forEach(doc => { itensCache[doc.id] = doc.data(); });
  _ultimoDocs = docs;
  renderAtual();
}

function renderAtual() {
  const lista = document.getElementById("lista");
  let docs = _ultimoDocs;
  if (filtroAtual !== "todas") docs = docs.filter(doc => (doc.data().status || "pendente") === filtroAtual);

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhuma solicitação aqui.</p>';
    return;
  }

  lista.innerHTML = docs.map(doc => {
    const s = doc.data();
    const comprado = s.status === "comprado";
    return `
      <div class="card ${comprado ? 'card-comprado' : ''}">
        <div class="card-acoes">
          <button class="btn-edit" onclick="editarItem('${doc.id}')" title="Editar">✏</button>
          <button class="btn-del"  onclick="excluir('${doc.id}')"    title="Excluir">✕</button>
        </div>
        <div class="card-nome">${escHtml(s.item)}</div>
        <div class="card-linha"><span class="val-label">Quantidade</span><span class="val-num">${escHtml(s.quantidade || "—")}</span></div>
        ${s.local ? `<div class="card-linha"><span class="val-label">Local</span><span class="val-num">${escHtml(s.local)}</span></div>` : ""}
        ${s.solicitante ? `<div class="card-linha"><span class="val-label">Solicitante</span><span class="val-num">${escHtml(s.solicitante)}</span></div>` : ""}
        ${s.obs ? `<div class="card-obs">${escHtml(s.obs)}</div>` : ""}
        <div class="card-rodape">
          <span class="card-data">${fmtDataHora(s.criadoEm)}</span>
          <button class="btn-status ${comprado ? 'comprado' : 'pendente'}" onclick="toggleStatus('${doc.id}')">
            ${comprado ? "✓ Comprado" : "Marcar como comprado"}
          </button>
        </div>
      </div>`;
  }).join("");
}

col.orderBy("criadoEm", "desc").onSnapshot(snap => {
  render(snap.docs);
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

function toggleStatus(id) {
  const s = itensCache[id];
  if (!s) return;
  const novoStatus = s.status === "comprado" ? "pendente" : "comprado";
  const campos = { status: novoStatus };
  if (novoStatus === "comprado") campos.compradoEm = firebase.firestore.FieldValue.serverTimestamp();
  col.doc(id).update(campos);
}

document.getElementById("form").addEventListener("submit", function(e) {
  e.preventDefault();
  const item        = document.getElementById("f-item").value.trim();
  const quantidade  = document.getElementById("f-quantidade").value.trim();
  const local       = document.getElementById("f-local").value.trim();
  const solicitante = document.getElementById("f-solicitante").value.trim();
  const obs         = document.getElementById("f-obs").value.trim();

  if (!item) {
    alert("Item é obrigatório.");
    return;
  }

  if (editandoId) {
    col.doc(editandoId).update({ item, quantidade, local, solicitante, obs });
    editandoId = null;
  } else {
    col.add({ item, quantidade, local, solicitante, obs, status: "pendente",
      criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }

  this.reset();
  toggleForm();
});

function editarItem(id) {
  const s = itensCache[id];
  if (!s) return;
  editandoId = id;
  document.getElementById("form-titulo").textContent = "Editar Solicitação";
  document.getElementById("btn-submit").textContent  = "✓ Salvar alterações";
  document.getElementById("f-item").value        = s.item || "";
  document.getElementById("f-quantidade").value  = s.quantidade || "";
  document.getElementById("f-local").value       = s.local || "";
  document.getElementById("f-solicitante").value = s.solicitante || "";
  document.getElementById("f-obs").value         = s.obs || "";
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  form.style.display = "block";
  fab.classList.add("open");
  document.getElementById("f-item").focus();
}

function excluir(id) {
  const s = itensCache[id];
  if (!s) return;
  const senha = prompt("EXCLUIR SOLICITAÇÃO?\n\n" + s.item + "\n\nDigite a senha:");
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
    document.getElementById("f-item").focus();
  } else {
    editandoId = null;
    document.getElementById("form-titulo").textContent = "Nova Solicitação";
    document.getElementById("btn-submit").textContent  = "+ Solicitar";
    document.getElementById("form").reset();
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(reg => reg.update()).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}
