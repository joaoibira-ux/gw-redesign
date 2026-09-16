const VERSAO = "1.5";
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
//   contar a mesma mão de obra duas vezes). BBS Fomento é tratado igual a
//   empréstimo (é um empréstimo/repasse, não despesa) mesmo sem a palavra
//   "EMPRESTIMO" na descrição — caixa/app.js registra o principal da BBS
//   como só "BBS FOMENTO Nº XXXX" de propósito (achado real em 2026-09-16:
//   sem esse caso, o principal da BBS caía em "operacional" como despesa).
// - "operacional": tudo o mais (aluguel, combustível, fornecedores...).
function categorizarContaPagar(descricao) {
  const t = normTexto(descricao);
  if (t.includes("JUROS")) return "financeira";
  if (t.includes("EMPRESTIMO")) return "excluido";
  if (t.includes("BBS")) return "excluido";
  // Aceita "ADIANTAMENTO: {nome}" e também "ADIANTAMENTO {nome}" (sem ":",
  // digitado à mão em lançamentos manuais) — mesma tolerância já usada em
  // extrairNomeAdiantamento nos outros módulos. Sem isso, adiantamentos sem
  // ":" na descrição caíam em "operacional" como despesa (achado real,
  // 2026-09-16: várias contas tipo "Adiantamento Paulo Ricardo" contavam
  // como despesa operacional em vez de serem excluídas).
  if (/^ADIANTAMENTO:?\s/.test(t)) return "excluido";
  // "Folha de Pagamento da Produção" é a conta a pagar criada ao fechar a
  // Folha em Caixa → Relatório — já é o mesmo custo de mão de obra contado
  // em totalFolha (via folhas.totalGeral, ver mais abaixo). Contar aqui
  // também duplicaria o Custo de Mão de Obra (achado real, 2026-09-16: só
  // ficou visível depois de corrigir o valorReal/valorOriginal — antes essa
  // conta baixada mostrava R$ 0 e o problema passava despercebido).
  if (t.includes("FOLHA DE PAGAMENTO")) return "excluido";
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
    const [medicoesSnap, pagarSnap, folhasSnap] = await Promise.all([
      db.collection("medicoes").get(),
      db.collection("contasPagar").get(),
      db.collection("folhas").get(),
    ]);

    // ── Receita: medições feitas dentro do mês, pelo Valor da Nota Fiscal ──
    // Pedido do João (2026-09-16): receita vem das medições (quando o
    // trabalho foi de fato medido/faturado), não do Contas a Receber. O
    // Contas a Receber tem vencimentos espalhados no tempo — uma mesma
    // medição gera uma conta "Medição X" (vencimento logo em seguida) E,
    // separada, uma conta "Retenção 5% Paradigma X" com vencimento na data
    // fixa da retenção (pode ser mais de um ano depois, ver
    // DATA_RETENCAO_PARADIGMA em medicoes/app.js) — usar o Contas a Receber
    // como fonte rasgava o valor de uma única medição em dois meses/anos
    // diferentes do DRE. valorNotaFiscal é o valor cheio da medição, antes
    // da retenção, então já representa o total faturado no mês certo.
    const itensReceita = medicoesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => estaNoMes(parseData(m.data), ano, mes));
    const totalReceita = itensReceita.reduce((s, m) => s + (Number(m.valorNotaFiscal) || 0), 0);

    // ── Contas a Pagar do mês, já categorizadas ──
    // Quando a conta é baixada (paga), o campo "valor" vira 0 e o valor real
    // fica preservado em "valorOriginal" (mesma convenção usada em
    // caixa/app.js e já tratada em vários outros lugares do sistema) — sem
    // esse ajuste, toda despesa operacional já paga aparecia como R$ 0 no
    // DRE (achado real do João, 2026-09-16: "a maioria está com valor
    // zero" — exatamente porque a maioria já tinha sido baixada).
    const pagarDoMes = pagarSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => estaNoMes(parseData(c.data), ano, mes))
      .map(c => ({ ...c, valorReal: c.status === "baixado" ? (c.valorOriginal !== undefined ? c.valorOriginal : c.valor) : c.valor }));

    const itensOperacional = pagarDoMes.filter(c => categorizarContaPagar(c.descricao) === "operacional");
    const itensFinanceira  = pagarDoMes.filter(c => categorizarContaPagar(c.descricao) === "financeira");
    const totalOperacional = itensOperacional.reduce((s, c) => s + (Number(c.valorReal) || 0), 0);
    const totalFinanceira  = itensFinanceira.reduce((s, c) => s + (Number(c.valorReal) || 0), 0);

    // ── Custo de Mão de Obra: folhas PAGAS com data dentro do mês ──
    // A coleção 'folhas' também guarda snapshot toda vez que alguém abre o
    // Relatório/Resumo na tela da Folha (status:'fechada') — é só uma
    // prévia, o dinheiro não saiu. Só status:'paga' (fechada de verdade em
    // Caixa → Relatório) é despesa real; sem esse filtro, rascunhos
    // abandonados entravam na conta e inflavam o custo do mês (achado real
    // em 2026-09-16: agosto tinha 2 rascunhos nunca pagos somando R$ 33 mil
    // a mais do que o custo real).
    const itensFolha = folhasSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(f => f.status === 'paga' && estaNoMes(parseData(f.data), ano, mes));
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

function linhaDetalheReceita(m) {
  return `<div class="detalhe-linha"><span>Medição ${escHtml(m.nome)}</span><span>${fmtMoeda(m.valorNotaFiscal)}</span></div>`;
}
function linhaDetalhePagar(c) {
  return `<div class="detalhe-linha"><span>${escHtml(c.descricao)}</span><span>${fmtMoeda(c.valorReal)}</span></div>`;
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
      ${blocoLinha("receita", "Receita", d.totalReceita, "positivo", d.itensReceita, linhaDetalheReceita, "Nenhuma medição feita nesse mês.")}
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
