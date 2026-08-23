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
const col = db.collection("contatos");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let contatosCache = {};
let editandoId = null;

function render(docs) {
  const lista = document.getElementById("lista");
  contatosCache = {};

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhum contato cadastrado.</p>';
    return;
  }

  lista.innerHTML = docs.map(doc => {
    const c = doc.data();
    contatosCache[doc.id] = c;
    return `
      <div class="card">
        <div class="card-acoes">
          <button class="btn-edit" onclick="editarContato('${doc.id}')" title="Editar">✏</button>
          <button class="btn-del"  onclick="excluir('${doc.id}')"       title="Excluir">✕</button>
        </div>
        <div class="card-nome">${escHtml(c.nome)}</div>
        <div class="card-telefone">📞 ${escHtml(c.telefone)}</div>
        ${c.obs ? `<div class="card-obs">${escHtml(c.obs)}</div>` : ""}
      </div>`;
  }).join("");
}

col.orderBy("nome").onSnapshot(snap => {
  render(snap.docs);
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

document.getElementById("form").addEventListener("submit", function(e) {
  e.preventDefault();
  const nome     = document.getElementById("f-nome").value.trim();
  const telefone = document.getElementById("f-telefone").value.trim();
  const obs      = document.getElementById("f-obs").value.trim();

  if (!nome || !telefone) {
    alert("Nome e telefone são obrigatórios.");
    return;
  }

  if (editandoId) {
    col.doc(editandoId).update({ nome, telefone, obs });
    editandoId = null;
  } else {
    col.add({ nome, telefone, obs,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }

  this.reset();
  toggleForm();
});

function editarContato(id) {
  const c = contatosCache[id];
  if (!c) return;
  editandoId = id;
  document.getElementById("form-titulo").textContent = "Editar Contato";
  document.getElementById("btn-submit").textContent  = "✓ Salvar alterações";
  document.getElementById("f-nome").value     = c.nome || "";
  document.getElementById("f-telefone").value = c.telefone || "";
  document.getElementById("f-obs").value      = c.obs || "";
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  form.style.display = "block";
  fab.classList.add("open");
  document.getElementById("f-nome").focus();
}

function excluir(id) {
  const c = contatosCache[id];
  if (!c) return;
  const senha = prompt("EXCLUIR CONTATO?\n\n" + c.nome + "\n\nDigite a senha:");
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
    document.getElementById("f-nome").focus();
  } else {
    editandoId = null;
    document.getElementById("form-titulo").textContent = "Novo Contato";
    document.getElementById("btn-submit").textContent  = "+ Cadastrar";
    document.getElementById("form").reset();
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
