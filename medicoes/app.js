const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "1.2";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("medicoes");
const extrairMedicoesFn = firebase.functions().httpsCallable("extrairMedicoes");

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoeda(v) {
  v = v || 0;
  const sinal = v < 0 ? "- " : "";
  return sinal + "R$ " + Math.abs(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseMoeda(s) {
  const v = parseFloat(String(s).replace(/[^\d,.-]/g, "").replace(",", "."));
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

  let totalMedido = 0;
  docs.forEach(doc => {
    const m = doc.data();
    docsCache[doc.id] = m;
    totalMedido += m.valor || 0;
  });
  document.getElementById("tot-medido").textContent = fmtMoeda(totalMedido);

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhuma medição cadastrada.</p>';
    return;
  }

  lista.innerHTML = docs.map(doc => {
    const m = doc.data();
    const negativo = (m.valor || 0) < 0;
    const badge = m.apartamento ? `<span class="card-item-badge">${escHtml(m.apartamento)}</span>` : "";
    return `
      <div class="card${negativo ? " negativo" : ""}">
        <div class="card-acoes">
          <button class="btn-del" onclick="excluir('${doc.id}')" title="Excluir">✕</button>
        </div>
        <div class="card-top">
          <div class="card-desc">${badge}${escHtml(m.servico)}</div>
          <div class="card-valor${negativo ? " negativo" : ""}">${fmtMoeda(m.valor)}</div>
        </div>
        <div class="card-meta">
          <span>${escHtml(m.data)}</span>
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
  const m = docsCache[id];
  if (!m) return;
  const titulo = m.apartamento ? (m.apartamento + " - " + m.servico) : m.servico;
  const senha = prompt("EXCLUIR MEDIÇÃO?\n\n" + titulo + "\n" + fmtMoeda(m.valor) + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "4512") { alert("Senha incorreta."); return; }
  col.doc(id).delete();
}

// ---------- Importação por foto ----------

function abrirSeletorFoto() {
  document.getElementById("input-foto").click();
}

function lerImagemComoBase64(file) {
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
        resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function mostrarLoading(mostrar) {
  document.getElementById("overlay-loading").style.display = mostrar ? "flex" : "none";
}

document.getElementById("input-foto").addEventListener("change", async function() {
  const file = this.files[0];
  this.value = "";
  if (!file) return;

  mostrarLoading(true);
  try {
    const imageBase64 = await lerImagemComoBase64(file);
    const resp = await extrairMedicoesFn({ imageBase64, mimeType: "image/jpeg" });
    const itens = (resp.data && resp.data.itens) || [];
    if (itens.length === 0) {
      alert("Não foi possível identificar itens na imagem. Adicione manualmente na tela a seguir.");
    }
    abrirRevisao(itens);
  } catch (err) {
    console.error(err);
    alert("Erro ao processar imagem: " + (err.message || err));
  } finally {
    mostrarLoading(false);
  }
});

// ---------- Tela de revisão ----------

let itensRevisao = [];

function abrirRevisao(itens) {
  itensRevisao = itens.length > 0
    ? itens.map(it => ({ apartamento: it.apartamento || "", servico: it.servico || "", valor: it.valor || 0 }))
    : [{ apartamento: "", servico: "", valor: 0 }];
  document.getElementById("rv-data").value = hoje();
  renderRevisao();
  document.getElementById("overlay-revisao").style.display = "flex";
}

function renderRevisao() {
  const cont = document.getElementById("revisao-lista");
  cont.innerHTML = itensRevisao.map((it, i) => `
    <div class="revisao-linha">
      <button type="button" class="btn-del-linha" onclick="removerLinhaRevisao(${i})" title="Remover">✕</button>
      <div class="revisao-campos">
        <div>
          <label>Apartamento</label>
          <input type="text" value="${escHtml(it.apartamento)}" oninput="itensRevisao[${i}].apartamento = this.value" />
        </div>
        <div>
          <label>Serviço</label>
          <input type="text" value="${escHtml(it.servico)}" oninput="itensRevisao[${i}].servico = this.value" />
        </div>
        <div>
          <label>Valor (R$)</label>
          <input type="text" inputmode="decimal" value="${String(it.valor).replace(".", ",")}" oninput="itensRevisao[${i}].valor = parseMoeda(this.value)" />
        </div>
      </div>
    </div>`).join("");
}

function adicionarLinhaRevisao() {
  itensRevisao.push({ apartamento: "", servico: "", valor: 0 });
  renderRevisao();
}

function removerLinhaRevisao(i) {
  itensRevisao.splice(i, 1);
  if (itensRevisao.length === 0) itensRevisao.push({ apartamento: "", servico: "", valor: 0 });
  renderRevisao();
}

function cancelarRevisao() {
  itensRevisao = [];
  document.getElementById("overlay-revisao").style.display = "none";
}

function salvarRevisao() {
  const data = document.getElementById("rv-data").value.trim();
  if (!data) {
    alert("Informe a data.");
    return;
  }

  const validos = itensRevisao.filter(it =>
    it.servico.trim() && it.valor !== 0
  );

  if (validos.length === 0) {
    alert("Preencha serviço e valor (diferente de zero) de ao menos um item.");
    return;
  }

  const batch = db.batch();
  validos.forEach(it => {
    batch.set(col.doc(), {
      apartamento: it.apartamento.trim(),
      servico: it.servico.trim(),
      valor: it.valor,
      data,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
  batch.commit();

  itensRevisao = [];
  document.getElementById("overlay-revisao").style.display = "none";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
