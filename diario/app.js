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
const col = db.collection("diarioObra");
const storage = firebase.storage();

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hojeISO() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function isoParaBr(iso) {
  const [a, m, d] = (iso || "").split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
}

function fmtDataHora(ts) {
  if (!ts || !ts.toDate) return "";
  return ts.toDate().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Redimensiona a foto antes do upload — evita mandar fotos de câmera
// (facilmente 5-8MB) pela rede móvel, mesmo padrão já usado em medicoes/app.js.
function redimensionarImagem(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error("Não foi possível processar a imagem.")); return; }
          resolve(blob);
        }, "image/jpeg", 0.85);
      };
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

async function uploadFotoDiario(blob) {
  const ref = storage.ref(`diarioObra/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  await ref.put(blob, { contentType: "image/jpeg" });
  return await ref.getDownloadURL();
}

function mostrarLoading(mostrar) {
  document.getElementById("overlay-loading").style.display = mostrar ? "flex" : "none";
}

let itensCache = {};
let fotosPendentes = []; // { blob, previewUrl }
let filtroAtual = "todos";

function filtrar(f) {
  filtroAtual = f;
  ["todos", "KEL1", "KEL2"].forEach(x =>
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

function miniaturasCard(id, fotos) {
  if (!fotos || fotos.length === 0) return "";
  return `<div class="card-fotos">${fotos.map((url, i) =>
    `<img src="${url}" class="card-foto-mini" onclick="event.stopPropagation(); abrirFotoView('${id}', ${i})" />`
  ).join("")}</div>`;
}

function renderAtual() {
  const lista = document.getElementById("lista");
  let docs = _ultimoDocs;
  if (filtroAtual !== "todos") docs = docs.filter(doc => doc.data().obra === filtroAtual);

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhum registro aqui.</p>';
    return;
  }

  lista.innerHTML = docs.map(doc => {
    const r = doc.data();
    return `
      <div class="card" onclick="abrirDetalhe('${doc.id}')">
        <div class="card-acoes">
          <button class="btn-del" onclick="event.stopPropagation(); excluir('${doc.id}')" title="Excluir">✕</button>
        </div>
        <div class="card-top">
          <span class="badge-obra badge-${escHtml(r.obra)}">${escHtml(r.obra)}</span>
          <span class="card-data-obra">${escHtml(r.data)}</span>
        </div>
        <div class="card-atividades">${escHtml(r.atividades)}</div>
        ${miniaturasCard(doc.id, r.fotos)}
        <div class="card-rodape">
          <span class="card-data">${fmtDataHora(r.criadoEm)}</span>
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

function excluir(id) {
  const r = itensCache[id];
  if (!r) return;
  const senha = prompt("EXCLUIR REGISTRO?\n\n" + r.obra + " — " + r.data + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "6535") { alert("Senha incorreta."); return; }
  col.doc(id).delete();
  fecharDetalhe();
}

// ---------- Visualização de fotos ----------

function abrirFotoView(id, indice) {
  const r = itensCache[id];
  if (!r || !r.fotos || !r.fotos[indice]) return;
  document.getElementById("foto-view-img").src = r.fotos[indice];
  document.getElementById("overlay-foto-view").style.display = "flex";
}

function fecharFotoView() {
  document.getElementById("overlay-foto-view").style.display = "none";
}

// ---------- Detalhe ----------

function abrirDetalhe(id) {
  const r = itensCache[id];
  if (!r) return;
  document.getElementById("dt-obra").textContent = r.obra;
  document.getElementById("dt-obra").className = "badge-obra badge-" + r.obra;
  document.getElementById("dt-data").textContent = r.data;
  document.getElementById("dt-atividades").textContent = r.atividades;
  const fotosWrap = document.getElementById("dt-fotos");
  fotosWrap.innerHTML = (r.fotos || []).map((url, i) =>
    `<img src="${url}" class="dt-foto" onclick="abrirFotoView('${id}', ${i})" />`
  ).join("");
  document.getElementById("btn-del-detalhe").setAttribute("onclick", `excluir('${id}')`);
  document.getElementById("overlay-detalhe").style.display = "flex";
}

function fecharDetalhe() {
  document.getElementById("overlay-detalhe").style.display = "none";
}

// ---------- Formulário ----------

function renderPreviewFotos() {
  const wrap = document.getElementById("fotos-preview");
  wrap.innerHTML = fotosPendentes.map((f, i) =>
    `<div class="foto-preview-item">
      <img src="${f.previewUrl}" />
      <button type="button" class="foto-preview-del" onclick="removerFotoPendente(${i})">✕</button>
    </div>`
  ).join("");
}

function removerFotoPendente(i) {
  fotosPendentes.splice(i, 1);
  renderPreviewFotos();
}

function abrirSeletorFoto() {
  document.getElementById("input-fotos").click();
}

document.getElementById("input-fotos").addEventListener("change", async function() {
  const files = Array.from(this.files || []);
  this.value = "";
  if (files.length === 0) return;
  for (const file of files) {
    try {
      const blob = await redimensionarImagem(file);
      fotosPendentes.push({ blob, previewUrl: URL.createObjectURL(blob) });
    } catch (err) {
      console.error(err);
      alert("Erro ao processar uma das fotos: " + (err.message || err));
    }
  }
  renderPreviewFotos();
});

document.getElementById("form").addEventListener("submit", async function(e) {
  e.preventDefault();
  const obra       = document.getElementById("f-obra").value;
  const dataISO    = document.getElementById("f-data").value;
  const atividades = document.getElementById("f-atividades").value.trim();

  if (!atividades) {
    alert("Descreva as atividades do dia.");
    return;
  }
  if (!dataISO) {
    alert("Informe a data.");
    return;
  }

  mostrarLoading(true);
  try {
    const fotos = await Promise.all(fotosPendentes.map(f => uploadFotoDiario(f.blob)));
    await col.add({
      obra,
      data: isoParaBr(dataISO),
      dataISO,
      atividades,
      fotos,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    this.reset();
    fotosPendentes = [];
    renderPreviewFotos();
    toggleForm();
  } catch (err) {
    console.error(err);
    alert("Erro ao salvar: " + (err.message || err));
  } finally {
    mostrarLoading(false);
  }
});

function toggleForm() {
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  const open = form.style.display === "none" || form.style.display === "";
  form.style.display = open ? "block" : "none";
  fab.classList.toggle("open", open);
  if (open) {
    document.getElementById("f-data").value = hojeISO();
    document.getElementById("f-atividades").focus();
  } else {
    fotosPendentes = [];
    renderPreviewFotos();
    document.getElementById("form").reset();
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(reg => reg.update()).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}
