const VERSAO = "1.0";
document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp({
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
});
const db = firebase.firestore();

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoeda(v) {
  const sinal = v < 0 ? "- " : "";
  return sinal + "R$ " + Math.abs(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseData(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((s || "").trim());
  if (!m) return null;
  const [, d, mo, a] = m;
  const ano = a.length === 2 ? "20" + a : a;
  return new Date(Number(ano), Number(mo) - 1, Number(d));
}

// Remove acento e deixa maiúsculo, pra comparar palavra-chave sem depender
// de digitação exata (mesmo padrão usado em functions/index.js, normTexto).
function normTexto(s) {
  return String(s || "")
    .normalize("NFD")
    .split("")
    .filter(ch => { const code = ch.charCodeAt(0); return code < 0x0300 || code > 0x036f; })
    .join("")
    .toUpperCase();
}

// Categoriza um lançamento do Contas a Pagar pro DRE:
// - "financeira": tem "juros" na descrição — despesa financeira de verdade.
// - "excluido": é o principal de um empréstimo (sem "juros"), ou é
//   adiantamento de salário — nenhum dos dois é despesa: empréstimo é só
//   caixa entrando/saindo (dívida, não resultado), e adiantamento já está
//   contado dentro do total da Folha de Pagamento (contar os dois seria
//   contar a mesma mão de obra duas vezes).
// - "operacional": tudo o mais (aluguel, combustível, fornecedores...).
function categorizarContaPagar(descricao) {
  const t = normTexto(descricao);
  if (t.includes("JUROS")) return "financeira";
  if (t.includes("EMPRESTIMO")) return "excluido";
  if (t.startsWith("ADIANTAMENTO:")) return "excluido";
  return "operacional";
}

let mesAtual = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let _carregando = false;

function mesAnterior() {
  mesAtual = new Date(mesAtual.getFullYear(), mesAtual.getMonth() - 1, 1);
  carregar();
}

function mesSeguinte() {
  mesAtual = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + 1, 1);
  carregar();
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function estaNoMes(data, ano, mes) {
  return data && data.getFullYear() === ano && data.getMonth() === mes;
}

async function carregar() {
  if (_carregando) return;
  _carregando = true;

  const ano = mesAtual.getFullYear();
  const mes = mesAtual.getMonth();
  document.getElementById("mes-label").textContent = `${MESES[mes]} ${ano}`;
  document.getElementById("conteudo").innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const [receberSnap, pagarSnap, folhasSnap] = await Promise.all([
      db.collection("contasReceber").get(),
      db.collection("contasPagar").get(),
      db.collection("folhas").get(),
    ]);

    // ── Receita: contas a receber com vencimento dentro do mês ──
    const itensReceita = receberSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => estaNoMes(parseData(c.data), ano, mes));
    const totalReceita = itensReceita.reduce((s, c) => s + (Number(c.valor) || 0), 0);

    // ── Contas a Pagar do mês, já categorizadas ──
    const pagarDoMes = pagarSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => estaNoMes(parseData(c.data), ano, mes));

    const itensOperacional = pagarDoMes.filter(c => categorizarContaPagar(c.descricao) === "operacional");
    const itensFinanceira  = pagarDoMes.filter(c => categorizarContaPagar(c.descricao) === "financeira");
    const totalOperacional = itensOperacional.reduce((s, c) => s + (Number(c.valor) || 0), 0);
    const totalFinanceira  = itensFinanceira.reduce((s, c) => s + (Number(c.valor) || 0), 0);

    // ── Custo de Mão de Obra: folhas fechadas com data dentro do mês ──
    const itensFolha = folhasSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(f => estaNoMes(parseData(f.data), ano, mes));
    const totalFolha = itensFolha.reduce((s, f) => s + (Number(f.totalGeral) || 0), 0);

    const resultado = totalReceita - totalFolha - totalOperacional - totalFinanceira;

    renderizar({
      totalReceita, itensReceita,
      totalFolha, itensFolha,
      totalOperacional, itensOperacional,
      totalFinanceira, itensFinanceira,
      resultado
    });
  } catch (e) {
    console.error(e);
    document.getElementById("conteudo").innerHTML = '<p class="empty">Erro ao carregar. Tente novamente.</p>';
  }

  _carregando = false;
}

function linhaDetalheReceber(c) {
  return `<div class="detalhe-linha"><span>${escHtml(c.descricao)}</span><span>${fmtMoeda(c.valor)}</span></div>`;
}
function linhaDetalhePagar(c) {
  return `<div class="detalhe-linha"><span>${escHtml(c.descricao)}</span><span>${fmtMoeda(c.valor)}</span></div>`;
}
function linhaDetalheFolha(f) {
  return `<div class="detalhe-linha"><span>Folha de ${escHtml(f.data)}</span><span>${fmtMoeda(f.totalGeral)}</span></div>`;
}

function blocoLinha(id, label, valor, cor, itens, linhaFn, vazio) {
  const detalhe = itens.length
    ? itens.map(linhaFn).join("")
    : `<div class="detalhe-vazio">${vazio}</div>`;
  return `
    <div class="dre-linha" onclick="toggleDetalhe('${id}')">
      <span class="dre-label">${label}</span>
      <span class="dre-valor ${cor}">${fmtMoeda(valor)}</span>
    </div>
    <div class="dre-detalhe" id="detalhe-${id}" style="display:none">${detalhe}</div>`;
}

function toggleDetalhe(id) {
  const el = document.getElementById(`detalhe-${id}`);
  el.style.display = el.style.display === "none" ? "block" : "none";
}

function renderizar(d) {
  const cor = d.resultado >= 0 ? "positivo" : "negativo";
  document.getElementById("conteudo").innerHTML = `
    <div class="dre-card">
      ${blocoLinha("receita", "Receita", d.totalReceita, "positivo", d.itensReceita, linhaDetalheReceber, "Nenhuma conta a receber com vencimento nesse mês.")}
      <div class="dre-sep"></div>
      ${blocoLinha("folha", "(-) Custo de Mão de Obra", -d.totalFolha, "negativo", d.itensFolha, linhaDetalheFolha, "Nenhuma folha fechada nesse mês.")}
      ${blocoLinha("operacional", "(-) Despesas Operacionais", -d.totalOperacional, "negativo", d.itensOperacional, linhaDetalhePagar, "Nenhuma despesa operacional nesse mês.")}
      ${blocoLinha("financeira", "(-) Despesas Financeiras", -d.totalFinanceira, "negativo", d.itensFinanceira, linhaDetalhePagar, "Nenhuma despesa financeira nesse mês.")}
      <div class="dre-sep forte"></div>
      <div class="dre-linha dre-resultado">
        <span class="dre-label">Resultado do Mês</span>
        <span class="dre-valor ${cor}">${fmtMoeda(d.resultado)}</span>
      </div>
    </div>
    <p class="dre-nota">Toque numa linha pra ver os lançamentos que entraram na conta. Empréstimos (principal) e adiantamentos de salário ficam de fora — não são receita nem despesa do período.</p>
  `;
}

carregar();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(reg => reg.update()).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}
