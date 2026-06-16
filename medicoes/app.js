const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "2.2";
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
    return `
      <div class="card" onclick="abrirDetalhe('${doc.id}')">
        <div class="card-acoes">
          <button class="btn-del" onclick="event.stopPropagation(); excluirMedicao('${doc.id}')" title="Excluir">✕</button>
        </div>
        <div class="card-top">
          <div class="card-desc">${escHtml(m.nome || "(sem nome)")}</div>
          <div class="card-valor">${fmtMoeda(m.valorNotaFiscal)}</div>
        </div>
        <div class="card-meta">
          <span>${escHtml(m.data)}</span>
          <span>Medido: ${fmtMoeda(m.valor)}</span>
          ${m.descontos ? `<span class="card-valor negativo card-meta-desconto">- ${fmtMoeda(m.descontos)}</span>` : ""}
        </div>
      </div>`;
  }).join("");
}

function excluirMedicao(id) {
  const m = docsCache[id];
  if (!m) return;
  const senha = prompt("EXCLUIR MEDIÇÃO?\n\n" + (m.nome || "(sem nome)") + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "4512") { alert("Senha incorreta."); return; }
  col.doc(id).delete();
}

col.orderBy("criadoEm", "desc").onSnapshot(snap => {
  render(snap.docs);
}, err => {
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

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
    const dados = resp.data || {};
    if (!dados.itens || dados.itens.length === 0) {
      alert("Não foi possível identificar itens na imagem. Adicione manualmente na tela a seguir.");
    }
    abrirRevisao(dados);
  } catch (err) {
    console.error(err);
    alert("Erro ao processar imagem: " + (err.message || err));
  } finally {
    mostrarLoading(false);
  }
});

// ---------- Tela de revisão (nova medição) ----------

let itensRevisao = [];

function abrirRevisao(dados) {
  itensRevisao = (dados.itens && dados.itens.length > 0)
    ? dados.itens.map(it => ({ apartamento: it.apartamento || "", servico: it.servico || "", valor: it.valor || 0 }))
    : [{ apartamento: "", servico: "", valor: 0 }];

  document.getElementById("rv-nome").value = "";
  document.getElementById("rv-data").value = hoje();
  document.getElementById("rv-valor").value = (dados.total || 0).toFixed(2).replace(".", ",");
  document.getElementById("rv-descontos").value = (dados.descontos || 0).toFixed(2).replace(".", ",");
  document.getElementById("rv-notafiscal").value = (dados.aPagar || 0).toFixed(2).replace(".", ",");

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
          <label>Item</label>
          <input type="text" value="${escHtml(it.apartamento)}" oninput="itensRevisao[${i}].apartamento = this.value" />
        </div>
        <div>
          <label>Serviço</label>
          <input type="text" value="${escHtml(it.servico)}" oninput="itensRevisao[${i}].servico = this.value" />
        </div>
        <div>
          <label>Valor (R$)</label>
          <input type="text" inputmode="decimal" value="${(it.valor || 0).toFixed(2).replace(".", ",")}" oninput="itensRevisao[${i}].valor = parseMoeda(this.value)" />
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
  const nome = document.getElementById("rv-nome").value.trim();
  const data = document.getElementById("rv-data").value.trim();

  if (!nome) {
    alert("Informe o nome da medição.");
    return;
  }
  if (!data) {
    alert("Informe a data.");
    return;
  }

  const itens = itensRevisao
    .filter(it => it.servico.trim())
    .map(it => ({
      apartamento: it.apartamento.trim(),
      servico: it.servico.trim(),
      valor: it.valor
    }));

  col.add({
    nome,
    data,
    valor: parseMoeda(document.getElementById("rv-valor").value),
    descontos: parseMoeda(document.getElementById("rv-descontos").value),
    valorNotaFiscal: parseMoeda(document.getElementById("rv-notafiscal").value),
    itens,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  itensRevisao = [];
  document.getElementById("overlay-revisao").style.display = "none";
}

// ---------- Tela de detalhes ----------

let detalheAtualId = null;

function abrirDetalhe(id) {
  const m = docsCache[id];
  if (!m) return;
  detalheAtualId = id;

  document.getElementById("dt-nome").value = m.nome || "";
  document.getElementById("dt-data").value = m.data || "";
  document.getElementById("dt-valor").value = (m.valor || 0).toFixed(2).replace(".", ",");
  document.getElementById("dt-descontos").value = (m.descontos || 0).toFixed(2).replace(".", ",");
  document.getElementById("dt-notafiscal").value = (m.valorNotaFiscal || 0).toFixed(2).replace(".", ",");

  const itens = m.itens || [];
  const cont = document.getElementById("detalhe-itens");
  cont.innerHTML = itens.length > 0
    ? itens.map(it => {
        const negativo = (it.valor || 0) < 0;
        const badge = it.apartamento ? `<span class="card-item-badge">${escHtml(it.apartamento)}</span>` : "";
        return `
          <div class="detalhe-item">
            <span>${badge}${escHtml(it.servico)}</span>
            <span class="detalhe-item-valor${negativo ? " negativo" : ""}">${fmtMoeda(it.valor)}</span>
          </div>`;
      }).join("")
    : '<p class="revisao-sub">Nenhum item.</p>';

  document.getElementById("overlay-detalhe").style.display = "flex";
}

function fecharDetalhe() {
  detalheAtualId = null;
  document.getElementById("overlay-detalhe").style.display = "none";
}

function salvarDetalhe() {
  if (!detalheAtualId) return;

  const nome = document.getElementById("dt-nome").value.trim();
  const data = document.getElementById("dt-data").value.trim();

  if (!nome || !data) {
    alert("Informe nome e data.");
    return;
  }

  col.doc(detalheAtualId).update({
    nome,
    data,
    valor: parseMoeda(document.getElementById("dt-valor").value),
    descontos: parseMoeda(document.getElementById("dt-descontos").value),
    valorNotaFiscal: parseMoeda(document.getElementById("dt-notafiscal").value)
  });

  fecharDetalhe();
}

function excluirMedicaoAtual() {
  if (!detalheAtualId) return;
  const m = docsCache[detalheAtualId];
  const senha = prompt("EXCLUIR MEDIÇÃO?\n\n" + (m.nome || "(sem nome)") + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "4512") { alert("Senha incorreta."); return; }
  col.doc(detalheAtualId).delete();
  fecharDetalhe();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
