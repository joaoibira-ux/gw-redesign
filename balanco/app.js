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

// Mesmos valores-base e mesma lógica de origem->saldo já usadas em
// caixa/relatorio.html (atualizaTotaisGlobais) — duplicado aqui de propósito
// (mesmo padrão do resto do sistema: cada módulo é um arquivo isolado, sem
// import compartilhado). Se a lógica de origem mudar lá, replicar aqui.
const HORACIO_BASE = -136306.23;
const JOAO_BASE     = -32250;

function calcularSaldosCaixa(lancamentos) {
  let cefE = 0, cefS = 0, interE = 0, interS = 0, horacioSaidas = 0, joaoE = 0;
  lancamentos.forEach(r => {
    if (r.origem === "ANE->GW-INTER") {
      cefS   += r.saida || 0;
      interE += r.saida || 0;
    } else if (r.origem === "JOAO->CREDITO DE PROLABORE") {
      joaoE -= r.saida || 0;
    } else if (r.origem === "ANE->JOAO") {
      cefS  += r.saida || 0;
      joaoE += r.saida || 0;
    } else if (r.origem === "JOAO->JOAO") {
      interS += r.saida || 0;
      joaoE  += r.saida || 0;
    } else if (r.origem === "JOAO->HORACIO") {
      interS        += r.saida || 0;
      horacioSaidas += r.saida || 0;
    } else if (r.origem === "ANE->RETENCAO PARADIGMA 5%" || r.origem === "JOAO->RETENCAO PARADIGMA 5%") {
      if (r.origem === "ANE->RETENCAO PARADIGMA 5%") cefS += r.saida || 0;
      else interS += r.saida || 0;
    } else if (r.origem === "ANE->HORACIO") {
      cefS          += r.saida || 0;
      horacioSaidas += r.saida || 0;
    } else if (r.origem === "ANE->FOLHA DE PAGAMENTO") {
      cefS += r.saida || 0;
    } else if (r.origem === "ANE->PASSAGENS") {
      cefS += r.saida || 0;
    } else if (r.origem === "ANE->ADIANTAMENTO" || r.origem === "ANE->ANTECIPACAO") {
      cefS += r.saida || 0;
    } else if (r.origem === "JOAO->ADIANTAMENTO" || r.origem === "JOAO->ANTECIPACAO") {
      interS += r.saida || 0;
    } else if (r.origem === "JOAO->CTAS A RECEBER") {
      interS += r.saida || 0;
    } else if (r.origem === "JOAO->BAIXA CTAS A RECEBER") {
      interE += r.entrada || 0;
    } else if (r.origem === "ANE->BAIXA CTAS A RECEBER") {
      cefE += r.entrada || 0;
    } else if (r.origem === "JOAO->CTAS A PAGAR") {
      interE += r.entrada || 0;
    } else if (r.origem === "JOAO->BAIXA CTAS A PAGAR") {
      interS += r.saida || 0;
    } else if (r.origem === "ANE->BAIXA CTAS A PAGAR") {
      cefS += r.saida || 0;
    } else if (r.origem === "ANE") {
      cefE += r.entrada || 0;
      cefS += r.saida   || 0;
    } else if (r.origem === "JOAO") {
      interE += r.entrada || 0;
      interS += r.saida   || 0;
    } else if (r.origem === "ANE->CREDITO A REPASSAR P BBS FOMENTO" || r.origem === "ANE->EMPRESTIMO") {
      cefE += r.entrada || 0;
    }
  });
  return {
    cef: cefE - cefS,
    inter: interE - interS,
    joao: JOAO_BASE + joaoE,
    horacio: HORACIO_BASE + horacioSaidas
  };
}

function blocoLinha(id, label, valor, cor, itens, linhaFn, vazio) {
  const detalhe = itens.length
    ? itens.map(linhaFn).join("")
    : `<div class="detalhe-vazio">${vazio}</div>`;
  return `
    <div class="bal-linha" onclick="toggleDetalhe('${id}')">
      <span class="bal-label">${label}</span>
      <span class="bal-valor ${cor}">${fmtMoeda(valor)}</span>
    </div>
    <div class="bal-detalhe" id="detalhe-${id}" style="display:none">${detalhe}</div>`;
}

function toggleDetalhe(id) {
  const el = document.getElementById(`detalhe-${id}`);
  el.style.display = el.style.display === "none" ? "block" : "none";
}

function linhaSimples(label, valor) {
  return `<div class="detalhe-linha"><span>${escHtml(label)}</span><span>${fmtMoeda(valor)}</span></div>`;
}

async function carregar() {
  document.getElementById("conteudo").innerHTML = '<div class="loading">Carregando...</div>';
  try {
    const [lancSnap, receberSnap, pagarSnap, almoxSnap] = await Promise.all([
      db.collection("lancamentos").get(),
      db.collection("contasReceber").get(),
      db.collection("contasPagar").get(),
      db.collection("almoxarifado").get(),
    ]);

    const lancamentos = lancSnap.docs.map(d => d.data());
    const saldos = calcularSaldosCaixa(lancamentos);

    // Contas a Receber em aberto
    const itensReceber = receberSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.status === "aberto");
    const totalReceber = itensReceber.reduce((s, c) => s + (Number(c.valor) || 0), 0);

    // Contas a Pagar em aberto
    const itensPagar = pagarSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.status === "aberto");
    const totalPagar = itensPagar.reduce((s, c) => s + (Number(c.valor) || 0), 0);

    // Almoxarifado: valor unitário x (quantidade total - já entregue) — só
    // esse tem preço por item cadastrado. Estoques (matéria-prima) não tem
    // valor unitário no cadastro, por isso fica de fora da conta em R$.
    const itensAlmox = almoxSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .map(a => {
        const entregue = (a.entregas || []).reduce((s, e) => s + (Number(e.quantidade) || 0), 0);
        const disponivel = Math.max(0, (Number(a.quantidadeTotal) || 0) - entregue);
        return { nome: a.nome, valorTotal: disponivel * (Number(a.valor) || 0), disponivel };
      })
      .filter(a => a.valorTotal > 0);
    const totalAlmox = itensAlmox.reduce((s, a) => s + a.valorTotal, 0);

    renderizar({ saldos, itensReceber, totalReceber, itensPagar, totalPagar, itensAlmox, totalAlmox });
  } catch (e) {
    console.error(e);
    document.getElementById("conteudo").innerHTML = '<p class="empty">Erro ao carregar. Tente novamente.</p>';
  }
}

function renderizar(d) {
  const { saldos } = d;

  const itensSociosReceber = [];
  if (saldos.joao > 0)    itensSociosReceber.push({ label: "João Albérico", valor: saldos.joao });
  if (saldos.horacio > 0) itensSociosReceber.push({ label: "Horácio Forte", valor: saldos.horacio });
  const totalSociosReceber = itensSociosReceber.reduce((s, i) => s + i.valor, 0);

  const itensSociosPagar = [];
  if (saldos.joao < 0)    itensSociosPagar.push({ label: "João Albérico", valor: -saldos.joao });
  if (saldos.horacio < 0) itensSociosPagar.push({ label: "Horácio Forte", valor: -saldos.horacio });
  const totalSociosPagar = itensSociosPagar.reduce((s, i) => s + i.valor, 0);

  const caixaBancos = saldos.cef + saldos.inter;
  const itensCaixa = [
    { label: "CEF (ANE)", valor: saldos.cef },
    { label: "INTER (JOAO)", valor: saldos.inter }
  ];

  const totalAtivo = caixaBancos + d.totalReceber + d.totalAlmox + totalSociosReceber;
  const totalPassivo = d.totalPagar + totalSociosPagar;
  const patrimonioLiquido = totalAtivo - totalPassivo;
  const cor = patrimonioLiquido >= 0 ? "positivo" : "negativo";

  document.getElementById("conteudo").innerHTML = `
    <div class="bal-secao-titulo">ATIVO</div>
    <div class="bal-card">
      ${blocoLinha("caixa", "Caixa e Bancos", caixaBancos, "positivo", itensCaixa, i => linhaSimples(i.label, i.valor), "—")}
      ${blocoLinha("receber", "Contas a Receber", d.totalReceber, "positivo", d.itensReceber, c => linhaSimples(c.descricao, c.valor), "Nenhuma conta a receber em aberto.")}
      ${blocoLinha("almox", "Almoxarifado", d.totalAlmox, "positivo", d.itensAlmox, a => linhaSimples(`${a.nome} (${a.disponivel})`, a.valorTotal), "Sem itens com valor cadastrado.")}
      ${blocoLinha("socios-receber", "A Receber de Sócios", totalSociosReceber, "positivo", itensSociosReceber, i => linhaSimples(i.label, i.valor), "Nenhum sócio com saldo positivo.")}
      <div class="bal-sep forte"></div>
      <div class="bal-linha bal-total">
        <span class="bal-label">Total do Ativo</span>
        <span class="bal-valor positivo">${fmtMoeda(totalAtivo)}</span>
      </div>
    </div>

    <div class="bal-secao-titulo">PASSIVO</div>
    <div class="bal-card">
      ${blocoLinha("pagar", "Contas a Pagar", d.totalPagar, "negativo", d.itensPagar, c => linhaSimples(c.descricao, c.valor), "Nenhuma conta a pagar em aberto.")}
      ${blocoLinha("socios-pagar", "A Pagar a Sócios", totalSociosPagar, "negativo", itensSociosPagar, i => linhaSimples(i.label, i.valor), "Nenhum sócio com saldo negativo.")}
      <div class="bal-sep forte"></div>
      <div class="bal-linha bal-total">
        <span class="bal-label">Total do Passivo</span>
        <span class="bal-valor negativo">${fmtMoeda(d.totalPagar + totalSociosPagar)}</span>
      </div>
    </div>

    <div class="bal-card bal-resultado-card">
      <div class="bal-linha bal-resultado">
        <span class="bal-label">Patrimônio Líquido</span>
        <span class="bal-valor ${cor}">${fmtMoeda(patrimonioLiquido)}</span>
      </div>
    </div>
    <p class="bal-nota">Toque numa linha pra ver o detalhamento. Estoque de matéria-prima (módulo Estoques) não entra no valor — não tem preço por item cadastrado, só o Almoxarifado (EPI/Ferramentas) tem.</p>
  `;
}

carregar();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(reg => reg.update()).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}
