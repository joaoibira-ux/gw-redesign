const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "3.15";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function ordemServico(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento"))                         return 0;
  if (n.includes("pasta"))                              return 1;
  if (n.includes("emassamento") || n.includes("massa")) return 2;
  if (n.includes("textura"))                            return 3;
  return 99;
}

function nomeAbrev(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento")) return "Tratamento";
  if (n.includes("pasta"))      return "Gesso";
  if (n.includes("emassamento") || n.includes("massa")) return "Massa";
  if (n.includes("textura"))    return "Textura";
  return (nome || "").substring(0, 10);
}

// Mescla um item de serviço do local com o nome configurado para o Mapa
// (campo "Nome no Mapa" cadastrado no app Serviços)
function servicoComNomeMapa(s) {
  const disp = servicosCache[s.id];
  return disp && disp.nomeMapa ? { ...s, nomeMapa: disp.nomeMapa } : s;
}

function parseId(id) {
  const m = id.match(/^([A-Z]+)(\d+)$/);
  return m ? { block: m[1], num: parseInt(m[2]) } : null;
}

// Agrupa locais por bloco e pavimento
function groupByBloco(data) {
  const blocos = {};
  data.forEach(local => {
    const parsed = parseId(local.identificacao);
    if (!parsed) return;
    const { block, num } = parsed;
    if (!blocos[block]) blocos[block] = { ground: {}, upper: {} };
    if (num >= 100) blocos[block].upper[num - 100] = local;
    else            blocos[block].ground[num]       = local;
  });
  return blocos;
}

// Monta colunas: par (ímpar=topo, par=base), do maior para o menor
function buildCols(wing) {
  const nums = Object.keys(wing).map(Number);
  if (!nums.length) return [];
  const maxNum    = Math.max(...nums);
  const highOdd   = maxNum % 2 === 0 ? maxNum - 1 : maxNum;
  const cols = [];
  for (let odd = highOdd; odd >= 1; odd -= 2) {
    cols.push({ odd, even: odd + 1, oddLocal: wing[odd], evenLocal: wing[odd + 1] });
  }
  return cols;
}

function renderAptCell(local) {
  if (!local) return `<div class="apt-vazio"></div>`;
  const numPart = local.identificacao.replace(/^[A-Z]+/, "");
  const servs   = [...(local.servicos || [])].map(servicoComNomeMapa).sort((a, b) => ordemServico(a.nome) - ordemServico(b.nome));
  return `
    <div class="apt-cell">
      <div class="apt-header">Apt: ${escHtml(numPart)}</div>
      ${servs.map(s =>
        `<div class="apt-serv ${s.status}"
              data-apt="${escHtml(local.identificacao)}"
              data-nome="${escHtml(s.nome)}"
              data-status="${s.status}"
              data-executor="${escHtml((s.executor && s.executor.nome) || '')}"
              data-funcionario="${escHtml((s.funcionario && s.funcionario.nome) || '')}"
              data-valor="${s.valorPago || ''}"
              data-data="${escHtml(s.dataPagamento || '')}"
              data-dataregistro="${escHtml(s.dataRegistro || '')}"
              onclick="verServico(event,this)">${s.nomeMapa ? escHtml(s.nomeMapa) : nomeAbrev(s.nome)}</div>`
      ).join("")}
    </div>`;
}

function verServico(e, el) {
  e.stopPropagation();
  const apt      = el.dataset.apt;
  const nome     = el.dataset.nome;
  const status   = el.dataset.status;
  const executor      = el.dataset.executor;
  const funcionario   = el.dataset.funcionario;
  const valor         = el.dataset.valor;
  const data          = el.dataset.data;
  const dataRegistro  = el.dataset.dataregistro;

  const fmtValor = v => v ? "R$ " + parseFloat(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "—";

  const statusLabel = { concluido: "Concluído ✓", em_pagamento: "⏳ Na folha", pendente: "Pendente" };
  let html = `
    <div class="pop-linha"><span class="pop-label">Apt</span><span>${escHtml(apt)}</span></div>
    <div class="pop-linha"><span class="pop-label">Serviço</span><span>${escHtml(nome)}</span></div>
    <div class="pop-linha"><span class="pop-label">Status</span><span class="info-status ${status}">${statusLabel[status] || status}</span></div>`;
  if (status === "concluido") {
    html += `
    <div class="pop-linha"><span class="pop-label">Executor</span><span>${escHtml(executor) || "—"}</span></div>
    <div class="pop-linha"><span class="pop-label">Data</span><span>${escHtml(data) || "—"}</span></div>
    <div class="pop-linha"><span class="pop-label">Valor pago</span><span>${fmtValor(valor)}</span></div>`;
  } else if (status === "em_pagamento") {
    html += `
    <div class="pop-linha"><span class="pop-label">Funcionário</span><span>${escHtml(funcionario) || "—"}</span></div>
    <div class="pop-linha"><span class="pop-label">Registro</span><span>${escHtml(dataRegistro) || "—"}</span></div>`;
  }

  const popup = document.getElementById("popup-det");
  popup.querySelector(".pop-body").innerHTML = html;

  const rect  = el.getBoundingClientRect();
  const vv    = window.visualViewport;
  const scale = vv ? vv.scale      : 1;
  const offL  = vv ? vv.offsetLeft : 0;
  const offT  = vv ? vv.offsetTop  : 0;

  // Posição inicial: abaixo e alinhado ao elemento clicado
  let left = offL + rect.left   / scale;
  let top  = offT + rect.bottom / scale + 4;

  popup.style.left    = left + "px";
  popup.style.top     = top  + "px";
  popup.style.display = "block";

  // Agora lê as coordenadas REAIS do popup no visual viewport e corrige
  const pr  = popup.getBoundingClientRect();
  const vvW = vv ? vv.width  : window.innerWidth;
  const vvH = vv ? vv.height : window.innerHeight;
  const pad = 6;

  if (pr.right  > vvW - pad) { left -= (pr.right  - vvW + pad) / scale; popup.style.left = left + "px"; }
  if (pr.left   < pad)       { left += (pad - pr.left)          / scale; popup.style.left = left + "px"; }
  if (pr.bottom > vvH - pad) {
    popup.style.top = (offT + rect.top / scale - popup.offsetHeight - 4) + "px";
  }
}

function fecharInfo() {
  document.getElementById("popup-det").style.display = "none";
}

const ORDEM_CATEGORIA = ["Tratamento", "Gesso", "Massa", "Textura"];

function mostrarTotaisConcluidos() {
  const fmtValor = v => "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  const porCategoria = {};
  let qtdGeral = 0, totalGeral = 0;

  locaisData.forEach(local => {
    (local.servicos || []).forEach(s => {
      if (s.status !== "concluido") return;
      const cat = nomeAbrev(s.nome);
      if (!porCategoria[cat]) porCategoria[cat] = { qtd: 0, valor: 0 };
      porCategoria[cat].qtd   += 1;
      porCategoria[cat].valor += (s.valorPago || 0);
      qtdGeral   += 1;
      totalGeral += (s.valorPago || 0);
    });
  });

  const categorias = Object.keys(porCategoria).sort((a, b) => {
    const ia = ORDEM_CATEGORIA.indexOf(a), ib = ORDEM_CATEGORIA.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const body = document.getElementById("totais-body");
  if (qtdGeral === 0) {
    body.innerHTML = '<p style="font-size:0.78rem;color:#aaa;padding:6px 0">Nenhum serviço concluído ainda.</p>';
  } else {
    body.innerHTML = categorias.map(cat => `
      <div class="pop-linha">
        <span class="pop-label">${escHtml(cat)} (${porCategoria[cat].qtd})</span>
        <span>${fmtValor(porCategoria[cat].valor)}</span>
      </div>`).join("") + `
      <div class="pop-linha total-linha">
        <span class="pop-label">Total (${qtdGeral})</span>
        <span>${fmtValor(totalGeral)}</span>
      </div>`;
  }

  document.getElementById("modal-totais").style.display = "flex";
}

function fecharTotais() {
  document.getElementById("modal-totais").style.display = "none";
}

// Fecha ao clicar fora do popup
document.addEventListener("click", function(e) {
  const popup = document.getElementById("popup-det");
  if (popup && popup.style.display !== "none" && !popup.contains(e.target)) {
    fecharInfo();
  }
});

function renderWing(cols) {
  const n = cols.length;
  return `
    <div class="wing" style="grid-template-columns:repeat(${n},30px)">
      ${cols.map(c => renderAptCell(c.oddLocal)).join("")}
      ${cols.map(c => renderAptCell(c.evenLocal)).join("")}
    </div>`;
}

function render(data) {
  const blocos = groupByBloco(data);
  const letras = Object.keys(blocos).sort();

  if (!letras.length) {
    document.getElementById("mapa").innerHTML =
      '<p class="empty">Nenhum local cadastrado.</p>';
    return;
  }

  document.getElementById("mapa").innerHTML = letras.map(letra => {
    const { ground, upper } = blocos[letra];
    const gCols = buildCols(ground);
    const uCols = buildCols(upper);
    return `
      <div class="bloco">
        <div class="bloco-label">BLOCO ${letra}</div>
        <div class="bloco-body">
          ${gCols.length ? renderWing(gCols) : ""}
          ${uCols.length ? `<div class="corredor"></div>${renderWing(uCols)}` : ""}
        </div>
      </div>`;
  }).join("");
}

let locaisData   = [];
let servicosCache = {};

function renderAtual() {
  render(locaisData);
}

// Snapshot automático do mapa antes do fechamento da folha/medição: a página é
// aberta em um iframe oculto com ?snapshot=1, captura a imagem assim que os
// dados carregarem e avisa a janela pai (postMessage) quando terminar.
const SNAPSHOT_MODE = new URLSearchParams(window.location.search).get("snapshot") === "1";
let _locaisProntos  = false;
let _servicosProntos = false;

function avisarPai(ok) {
  if (window._snapshotFeito) return;
  window._snapshotFeito = true;
  try { window.parent.postMessage({ mapaSnapshotDone: true, ok }, "*"); } catch (e) {}
}

async function capturarEEnviarSnapshotMapa() {
  // #mapa tem overflow-y: auto (rolagem interna) e cada .bloco-body tem
  // overflow-x: auto — sem isso, o html2canvas só capturava o que cabia na
  // "tela" visível, cortando os últimos blocos. Remove temporariamente os
  // overflows pra expor o conteúdo inteiro antes de capturar.
  const elementos = [document.getElementById("mapa"), ...document.querySelectorAll(".bloco-body")];
  const estados = elementos.map(el => ({ el, overflow: el.style.overflow, height: el.style.height }));
  elementos.forEach(el => { el.style.overflow = "visible"; });
  document.getElementById("mapa").style.height = "auto";

  try {
    const largura = document.body.scrollWidth;
    const altura  = document.body.scrollHeight;
    const canvas = await html2canvas(document.body, {
      scale: 1.6,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: largura,
      height: altura,
      windowWidth: largura,
      windowHeight: altura
    });
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.88));
    const formData = new FormData();
    formData.append("chat_id", "1672059919");
    formData.append("photo", blob, "mapa-gw.jpg");
    formData.append("caption", `🗺️ Mapa de Execução — antes do fechamento (${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })})`);
    const res = await fetch("https://api.telegram.org/bot7469790318:AAEFzcPeS_MG6vvmKrhiZjVWXv1m9J0PTk4/sendPhoto", {
      method: "POST", body: formData
    });
    return res.ok;
  } catch (e) {
    return false;
  } finally {
    estados.forEach(({ el, overflow, height }) => { el.style.overflow = overflow; el.style.height = height; });
  }
}

function tentarCapturarSnapshot() {
  if (!SNAPSHOT_MODE || !_locaisProntos || !_servicosProntos || window._snapshotFeito) return;
  setTimeout(async () => {
    const ok = await capturarEEnviarSnapshotMapa();
    avisarPai(ok);
  }, 500); // pequena espera para garantir que o DOM terminou de pintar
}

if (SNAPSHOT_MODE) {
  setTimeout(() => avisarPai(false), 15000); // rede de segurança local
}

db.collection("locais").orderBy("identificacao", "asc").onSnapshot(snap => {
  locaisData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAtual();
  _locaisProntos = true;
  tentarCapturarSnapshot();
}, err => {
  console.error(err);
  document.getElementById("mapa").innerHTML =
    '<p class="empty">Erro ao conectar.</p>';
  avisarPai(false);
});

db.collection("servicos").onSnapshot(snap => {
  servicosCache = {};
  snap.forEach(d => { servicosCache[d.id] = d.data(); });
  renderAtual();
  _servicosProntos = true;
  tentarCapturarSnapshot();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
