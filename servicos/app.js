const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "1.7";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("servicos");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseMoeda(s) {
  const v = parseFloat(String(s).replace(/[^\d,]/g, "").replace(",", "."));
  return isNaN(v) ? 0 : v;
}

function fmtMoeda(v) {
  return "R$ " + (v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function fmtInput(el) {
  const v = parseMoeda(el.value);
  if (v > 0) el.value = v.toFixed(2).replace(".", ",");
}

let servicosCache = {};
let editandoId = null;

function render(docs) {
  const lista = document.getElementById("lista");
  servicosCache = {};

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhum serviço cadastrado.</p>';
    return;
  }

  lista.innerHTML = docs.map(doc => {
    const s = doc.data();
    servicosCache[doc.id] = s;
    return `
      <div class="card">
        <div class="card-acoes">
          <button class="btn-edit" onclick="editarServico('${doc.id}')" title="Editar">✏</button>
          <button class="btn-del"  onclick="excluir('${doc.id}')"       title="Excluir">✕</button>
        </div>
        <div class="card-nome">${s.item ? `<span class="card-item-badge">${escHtml(s.item)}</span> ` : ""}${escHtml(s.nome)}</div>
        ${s.nomeMapa ? `<div class="card-nome-mapa">Mapa: ${escHtml(s.nomeMapa)}</div>` : ""}
        <div class="card-valores">
          <div class="card-linha">
            <span class="val-label">M.d.o / Apt.</span>
            <span class="val-num">${fmtMoeda(s.mdo)}</span>
          </div>
          <div class="card-linha">
            <span class="val-label">Medição / Apt.</span>
            <span class="val-num">${fmtMoeda(s.medicao)}</span>
          </div>
          <div class="card-linha">
            <span class="val-label">Material / Apt.</span>
            <span class="val-num">${fmtMoeda(s.material)}</span>
          </div>
        </div>
        ${s.obs ? `<div class="card-obs">${escHtml(s.obs)}</div>` : ""}
      </div>`;
  }).join("");
}

function ordemServico(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento"))              return 0;
  if (n.includes("pasta"))                   return 1;
  if (n.includes("emassamento") || n.includes("massa")) return 2;
  if (n.includes("textura"))                 return 3;
  return 99;
}

function sortServicos(docs) {
  return [...docs].sort((a, b) => {
    const sa = a.data(), sb = b.data();
    const ia = parseFloat(sa.item);
    const ib = parseFloat(sb.item);
    const va = isNaN(ia) ? 1000 + ordemServico(sa.nome) : ia;
    const vb = isNaN(ib) ? 1000 + ordemServico(sb.nome) : ib;
    return va - vb;
  });
}

col.onSnapshot(snap => {
  render(sortServicos(snap.docs));
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

document.getElementById("form").addEventListener("submit", function(e) {
  e.preventDefault();
  const item     = document.getElementById("f-item").value.trim();
  const nome     = document.getElementById("f-nome").value.trim();
  const nomeMapa = document.getElementById("f-nomemapa").value.trim();
  const mdo      = parseMoeda(document.getElementById("f-mdo").value);
  const medicao  = parseMoeda(document.getElementById("f-medicao").value);
  const material = parseMoeda(document.getElementById("f-material").value);
  const obs      = document.getElementById("f-obs").value.trim();

  if (!nome) {
    alert("Nome do serviço é obrigatório.");
    return;
  }

  if (editandoId) {
    col.doc(editandoId).update({ item, nome, nomeMapa, mdo, medicao, material, obs });
    editandoId = null;
  } else {
    col.add({ item, nome, nomeMapa, mdo, medicao, material, obs,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }

  this.reset();
  toggleForm();
});

["f-mdo", "f-medicao", "f-material"].forEach(id => {
  document.getElementById(id).addEventListener("blur", function() { fmtInput(this); });
});

function editarServico(id) {
  const s = servicosCache[id];
  if (!s) return;
  editandoId = id;
  document.getElementById("form-titulo").textContent = "Editar Serviço";
  document.getElementById("btn-submit").textContent  = "✓ Salvar alterações";
  document.getElementById("f-item").value     = s.item || "";
  document.getElementById("f-nome").value     = s.nome || "";
  document.getElementById("f-nomemapa").value = s.nomeMapa || "";
  document.getElementById("f-mdo").value      = s.mdo      > 0 ? s.mdo.toFixed(2).replace(".", ",")      : "";
  document.getElementById("f-medicao").value  = s.medicao  > 0 ? s.medicao.toFixed(2).replace(".", ",")  : "";
  document.getElementById("f-material").value = s.material > 0 ? s.material.toFixed(2).replace(".", ",") : "";
  document.getElementById("f-obs").value      = s.obs || "";
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  form.style.display = "block";
  fab.classList.add("open");
  document.getElementById("f-nome").focus();
}

function excluir(id) {
  const s = servicosCache[id];
  if (!s) return;
  const senha = prompt("EXCLUIR SERVIÇO?\n\n" + s.nome + "\n\nDigite a senha:");
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
    document.getElementById("f-nome").focus();
  } else {
    editandoId = null;
    document.getElementById("form-titulo").textContent = "Novo Serviço";
    document.getElementById("btn-submit").textContent  = "+ Cadastrar";
    document.getElementById("form").reset();
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
