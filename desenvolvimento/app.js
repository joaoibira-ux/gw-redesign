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
const col = db.collection("desenvolvimento");
const storage = firebase.storage();

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtData(ts) {
  if (!ts || !ts.toDate) return "";
  return ts.toDate().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

let docsCache  = {};
let editandoId = null;

// Anexos de cada pendência (pedido do João, 2026-10-28): array "anexos"
// [{id, nome, url, tipo, criadoEm}] no próprio documento, arquivos no
// Storage em desenvolvimento/{docId}/.
function anexosHtml(id, p) {
  const anexos = p.anexos || [];
  if (!anexos.length) return "";
  return `<div class="card-anexos">${anexos.map(a => `
    <span class="anexo-chip">
      <a href="${a.url}" target="_blank" rel="noopener">📎 ${escHtml(a.nome)}</a>
      <button type="button" class="anexo-del" onclick="removerAnexo('${id}', '${a.id}')" title="Remover anexo">✕</button>
    </span>`).join("")}</div>`;
}

function cardHtml(id, p) {
  const concluida = p.status === "concluido";
  if (concluida) {
    return `
      <div class="card concluida">
        <div class="card-texto">${escHtml(p.texto)}</div>
        <div class="card-meta">
          <span>Concluída em ${fmtData(p.concluidoEm)}</span>
        </div>
        ${p.notaConclusao ? `<div class="card-nota">${escHtml(p.notaConclusao)}</div>` : ""}
        ${anexosHtml(id, p)}
        <div class="card-acoes">
          <button class="btn-edit" onclick="anexarDireto('${id}')" title="Anexar arquivo">📎</button>
          <button class="btn-edit" onclick="reabrir('${id}')" title="Reabrir">↺</button>
          <button class="btn-del" onclick="excluir('${id}')" title="Excluir">✕</button>
        </div>
      </div>`;
  }
  return `
    <div class="card">
      <div class="card-texto">${escHtml(p.texto)}</div>
      <div class="card-meta">
        <span>Criada em ${fmtData(p.criadoEm)}</span>
      </div>
      ${anexosHtml(id, p)}
      <div class="card-acoes">
        <button class="btn-concluir" onclick="concluir('${id}')" title="Marcar como concluída">✓ Concluir</button>
        <button class="btn-edit" onclick="anexarDireto('${id}')" title="Anexar arquivo">📎</button>
        <button class="btn-edit" onclick="editar('${id}')" title="Editar">✏</button>
        <button class="btn-del" onclick="excluir('${id}')" title="Excluir">✕</button>
      </div>
    </div>`;
}

function render(docs) {
  const lista = document.getElementById("lista");
  docsCache = {};

  const abertas = [];
  const concluidas = [];
  docs.forEach(doc => {
    const p = doc.data();
    docsCache[doc.id] = p;
    if (p.status === "concluido") concluidas.push(doc);
    else abertas.push(doc);
  });

  lista.innerHTML = abertas.length
    ? abertas.map(doc => cardHtml(doc.id, doc.data())).join("")
    : '<p class="empty">Nenhuma pendência em aberto.</p>';

  const listaConcluidas = document.getElementById("lista-concluidas");
  if (listaConcluidas) {
    listaConcluidas.innerHTML = concluidas.length
      ? concluidas.map(doc => cardHtml(doc.id, doc.data())).join("")
      : '<p class="empty">Nenhuma pendência concluída ainda.</p>';
  }
}

col.orderBy("criadoEm", "asc").onSnapshot(snap => {
  render(snap.docs);
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

function abrirConcluidas() {
  document.getElementById("concluidas-overlay").style.display = "flex";
}

function fecharConcluidas() {
  document.getElementById("concluidas-overlay").style.display = "none";
}

let anexosPendentes = []; // File[] escolhidos no formulário, ainda não enviados

function renderAnexosPendentes() {
  document.getElementById("anexos-pendentes").innerHTML = anexosPendentes.map((f, i) =>
    `<span class="anexo-chip">📎 ${escHtml(f.name)}<button type="button" class="anexo-del" onclick="anexosPendentes.splice(${i},1);renderAnexosPendentes()">✕</button></span>`
  ).join("");
}

document.getElementById("f-anexos").addEventListener("change", function() {
  anexosPendentes.push(...Array.from(this.files || []));
  this.value = "";
  renderAnexosPendentes();
});

async function enviarAnexos(docId, arquivos) {
  const novos = [];
  for (const file of arquivos) {
    const ref = storage.ref(`desenvolvimento/${docId}/${Date.now()}_${file.name}`);
    await ref.put(file, { contentType: file.type || "application/octet-stream" });
    novos.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      nome: file.name,
      url: await ref.getDownloadURL(),
      tipo: file.type || "",
      criadoEm: new Date().toISOString()
    });
  }
  if (novos.length) {
    await col.doc(docId).update({ anexos: firebase.firestore.FieldValue.arrayUnion(...novos) });
  }
}

document.getElementById("form").addEventListener("submit", async function(e) {
  e.preventDefault();
  const texto = document.getElementById("f-texto").value.trim();
  if (!texto) { alert("Descreva a pendência."); return; }

  const btn = document.getElementById("btn-add");
  btn.disabled = true;
  try {
    let docId = editandoId;
    if (docId) {
      await col.doc(docId).update({ texto });
    } else {
      const ref = await col.add({
        texto, status: "aberto",
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
      docId = ref.id;
    }
    if (anexosPendentes.length) {
      btn.textContent = "Enviando anexos...";
      await enviarAnexos(docId, anexosPendentes);
    }
    this.reset();
    toggleForm();
  } catch (err) {
    console.error(err);
    alert("Erro ao salvar: " + (err.message || err));
  } finally {
    btn.disabled = false;
  }
});

let _anexoDiretoId = null;
function anexarDireto(id) {
  _anexoDiretoId = id;
  document.getElementById("anexo-direto").click();
}

document.getElementById("anexo-direto").addEventListener("change", async function() {
  const arquivos = Array.from(this.files || []);
  this.value = "";
  if (!arquivos.length || !_anexoDiretoId) return;
  try {
    await enviarAnexos(_anexoDiretoId, arquivos);
  } catch (err) {
    console.error(err);
    alert("Erro ao enviar anexo: " + (err.message || err));
  }
});

async function removerAnexo(docId, anexoId) {
  const p = docsCache[docId];
  if (!p) return;
  const senha = prompt("REMOVER ESTE ANEXO?\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "6535") { alert("Senha incorreta."); return; }
  await col.doc(docId).update({ anexos: (p.anexos || []).filter(a => a.id !== anexoId) });
}

function concluir(id) {
  const p = docsCache[id];
  if (!p) return;
  const nota = prompt("O que foi feito? (opcional)\n\n" + p.texto);
  if (nota === null) return;
  col.doc(id).update({
    status: "concluido",
    notaConclusao: nota.trim(),
    concluidoEm: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function reabrir(id) {
  col.doc(id).update({
    status: "aberto",
    notaConclusao: firebase.firestore.FieldValue.delete(),
    concluidoEm: firebase.firestore.FieldValue.delete()
  });
}

function excluir(id) {
  const p = docsCache[id];
  if (!p) return;
  const senha = prompt("EXCLUIR PENDÊNCIA?\n\n" + p.texto + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "6535") { alert("Senha incorreta."); return; }
  col.doc(id).delete();
}

function editar(id) {
  const p = docsCache[id];
  if (!p) return;
  editandoId = id;
  document.getElementById("f-texto").value = p.texto || "";
  document.getElementById("form-titulo").textContent = "Editar Pendência";
  document.getElementById("btn-add").textContent = "Salvar";
  document.getElementById("form").style.display = "block";
  document.getElementById("fab").classList.add("open");
  document.getElementById("f-texto").focus();
}

function toggleForm() {
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  const open = form.style.display === "none" || form.style.display === "";
  form.style.display = open ? "block" : "none";
  fab.classList.toggle("open", open);
  if (open) {
    document.getElementById("f-texto").focus();
  } else {
    document.getElementById("form").reset();
    editandoId = null;
    anexosPendentes = [];
    renderAnexosPendentes();
    document.getElementById("form-titulo").textContent = "Nova Pendência";
    document.getElementById("btn-add").textContent = "+ Adicionar";
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
