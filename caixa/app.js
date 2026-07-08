const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO_CAIXA = "3.39";
const HORACIO_BASE = -136306.23;
const JOAO_BASE = -32250;
document.getElementById("versao-caixa").textContent = "Versão: " + VERSAO_CAIXA;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("lancamentos");

function fmtMoeda(v) {
  return "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function fmtVal(v) {
  return v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseMoeda(s) {
  const v = parseFloat(s.replace(/[^\d,]/g, "").replace(",", "."));
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

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let docsCache      = {};
let ultimoDocId    = null;
let folhaParaPagar = null;
let passagensParaPagar = null;
let descPrefix     = null;
let contasReceberCache    = {};
let contaReceberSelecionada = null;
let contasPagarCache    = {};
let contaPagarSelecionada = null;

function nomeAbrev(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento")) return "Tratamento";
  if (n.includes("pasta"))      return "Gesso";
  if (n.includes("emassamento") || n.includes("massa")) return "Massa";
  if (n.includes("textura"))    return "Textura";
  return (nome || "").substring(0, 10);
}

function ordemServico(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento"))                          return 0;
  if (n.includes("pasta"))                               return 1;
  if (n.includes("emassamento") || n.includes("massa"))  return 2;
  if (n.includes("textura"))                             return 3;
  return 99;
}

function normNome(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "").replace(/\d+/g, n => String(parseInt(n))).normalize("NFC");
}

function render(docs) {
  const lista = document.getElementById("lista");
  let totalE = 0, totalS = 0, cefE = 0, cefS = 0, interE = 0, interS = 0, horacioSaidas = 0, joaoE = 0;
  docsCache = {};
  ultimoDocId = docs.length > 0 ? docs[docs.length - 1].id : null;

  docs.forEach(doc => {
    docsCache[doc.id] = doc.data();
    const r = doc.data();
    if (r.origem === "ANE->GW-INTER") {
      cefS   += r.saida || 0;
      interE += r.saida || 0;
    } else if (r.origem === "JOAO->CREDITO DE PROLABORE") {
      joaoE -= r.saida || 0;
    } else {
      totalE += r.entrada || 0;
      totalS += r.saida || 0;
      if (r.origem === "ANE" || r.origem === "ANE->HORACIO") {
        cefE += r.entrada || 0;
        cefS += r.saida || 0;
        if (r.origem === "ANE->HORACIO") horacioSaidas += r.saida || 0;
      } else if (r.origem === "ANE->FOLHA DE PAGAMENTO") {
        cefS += r.saida || 0;
      } else if (r.origem === "ANE->PASSAGENS") {
        cefS += r.saida || 0;
      } else if (r.origem === "JOAO") {
        interE += r.entrada || 0;
        interS += r.saida || 0;
      } else if (r.origem === "ANE->JOAO") {
        cefS  += r.saida || 0;
        joaoE += r.saida || 0;
      } else if (r.origem === "JOAO->JOAO") {
        interS += r.saida || 0;
        joaoE  += r.saida || 0;
      } else if (r.origem === "JOAO->HORACIO") {
        interS        += r.saida || 0;
        horacioSaidas += r.saida || 0;
      } else if (r.origem === "ANE->RETENCAO PARADIGMA 5%") {
        cefS += r.saida || 0;
      } else if (r.origem === "JOAO->RETENCAO PARADIGMA 5%") {
        interS += r.saida || 0;
      } else if (r.origem === "ANE->ADIANTAMENTO" || r.origem === "ANE->ANTECIPACAO") {
        cefS += r.saida || 0;
      } else if (r.origem === "JOAO->ADIANTAMENTO" || r.origem === "JOAO->ANTECIPACAO") {
        interS += r.saida || 0;
      } else if (r.origem === "JOAO->CTAS A RECEBER") {
        interS += r.saida || 0;
      } else if (r.origem === "JOAO->BAIXA CTAS A RECEBER") {
        interE += r.entrada || 0;
      } else if (r.origem === "JOAO->CTAS A PAGAR") {
        interE += r.entrada || 0;
      } else if (r.origem === "JOAO->BAIXA CTAS A PAGAR") {
        interS += r.saida || 0;
      } else if (r.origem === "ANE->CREDITO A REPASSAR P BBS FOMENTO") {
        cefE += r.entrada || 0;
      }
    }
  });

  const saldo = totalE - totalS;
  document.getElementById("tot-entrada").textContent = fmtMoeda(totalE);
  document.getElementById("tot-saida").textContent = fmtMoeda(totalS);
  const saldoEl = document.getElementById("tot-saldo");
  saldoEl.textContent = fmtMoeda(saldo);
  saldoEl.className = "value " + (saldo >= 0 ? "saldo-pos" : "saldo-neg");

  const cef = cefE - cefS;
  const cefEl = document.getElementById("tot-cef");
  cefEl.textContent = fmtVal(cef);
  cefEl.className = "value " + (cef >= 0 ? "saldo-pos" : "saldo-neg");

  const inter = interE - interS;
  const interEl = document.getElementById("tot-inter");
  interEl.textContent = fmtVal(inter);
  interEl.className = "value " + (inter >= 0 ? "saldo-pos" : "saldo-neg");

  const joao = JOAO_BASE + joaoE;
  const joaoEl = document.getElementById("tot-joao");
  joaoEl.textContent = fmtVal(joao);
  joaoEl.className = "value " + (joao >= 0 ? "saldo-pos" : "saldo-neg");

  const horacio = HORACIO_BASE + horacioSaidas;
  const horacioEl = document.getElementById("tot-horacio");
  horacioEl.textContent = fmtVal(horacio);
  horacioEl.className = "value " + (horacio >= 0 ? "saldo-pos" : "saldo-neg");

  if (docs.length === 0) {
    lista.innerHTML = '<p class="empty">Nenhum lançamento ainda.</p>';
    return;
  }

  lista.innerHTML = docs.map((doc, i) => {
    const r = doc.data();
    const numero = String(i + 1).padStart(4, "0");
    const isTransfInter   = r.origem === "ANE->GW-INTER";
    const isTransfHoracio = r.origem === "ANE->HORACIO" || r.origem === "JOAO->HORACIO";
    const isCredito       = r.origem === "JOAO->CREDITO DE PROLABORE";
    const tipo   = (isTransfInter || isTransfHoracio) ? "transferencia" : isCredito ? "credito" : (r.entrada > 0 ? "entrada" : "saida");
    const valor  = (isTransfInter || isTransfHoracio) ? r.saida : (r.entrada > 0 ? r.entrada : r.saida);
    const prefix = isTransfInter ? "⇄" : (tipo === "saida" || tipo === "credito" ? "−" : "+");
    const btnDel = doc.id === ultimoDocId
      ? `<button class="btn-del" onclick="deletar('${doc.id}')" title="Excluir">✕</button>`
      : "";
    return `
      <div class="card ${tipo}">
        ${btnDel}
        <div class="card-top">
          <div class="card-desc">${escHtml(r.descricao)}</div>
          <div class="card-valor ${tipo}">${prefix} ${fmtMoeda(valor)}</div>
        </div>
        <div class="card-meta">
          <span class="numero">Nº ${numero}</span>
          <span>${escHtml(r.data)}</span>
          <span class="badge${isCredito ? ' credito-prolabore' : ''}">${escHtml(r.origem)}</span>
        </div>
      </div>`;
  }).join("");

  lista.lastElementChild.scrollIntoView({ behavior: "smooth", block: "end" });
}

function deletar(id) {
  if (id !== ultimoDocId) {
    alert("Só é possível excluir o lançamento mais recente.");
    return;
  }
  const r = docsCache[id];
  if (!r) return;

  const isTransf = r.origem === "ANE->GW-INTER";
  const valor = isTransf ? r.saida : (r.entrada > 0 ? r.entrada : r.saida);
  const tipo  = isTransf ? "Transferência" : (r.entrada > 0 ? "Entrada" : "Saída");

  const info = `Data: ${r.data}\nOrigem: ${r.origem}\nDescrição: ${r.descricao}\n${tipo}: ${fmtMoeda(valor)}`;
  const senha = prompt("EXCLUIR LANÇAMENTO?\n\n" + info + "\n\nDigite a senha:");

  if (senha === null) return; // cancelou
  if (senha !== "4512") {
    alert("Senha incorreta. Nada foi excluído.");
    return;
  }

  db.collection("deletados").add({
    ...r,
    idOriginal: id,
    deletadoEm: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => col.doc(id).delete());
}

// Escuta em tempo real — atualiza os dois iPhones automaticamente
const _reloadTimer = sessionStorage.getItem("caixa_reloaded")
  ? null
  : setTimeout(() => { sessionStorage.setItem("caixa_reloaded", "1"); location.reload(); }, 5000);

col.orderBy("criadoEm", "asc").onSnapshot(snapshot => {
  clearTimeout(_reloadTimer);
  sessionStorage.removeItem("caixa_reloaded");
  render(snapshot.docs);
}, err => {
  clearTimeout(_reloadTimer);
  console.error(err);
  document.getElementById("lista").innerHTML =
    '<p class="empty">Erro ao conectar. Verifique sua internet.</p>';
});

document.getElementById("form").addEventListener("submit", function(e) {
  e.preventDefault();
  const data   = document.getElementById("f-data").value.trim();
  const origem = document.getElementById("f-origem").value.trim().toUpperCase();
  const desc   = document.getElementById("f-desc").value.trim();
  const entrada = parseMoeda(document.getElementById("f-entrada").value);
  const saida   = parseMoeda(document.getElementById("f-saida").value);

  if (!data || !origem || !desc) {
    alert("Data, Origem e Descrição são obrigatórios.");
    return;
  }
  if (entrada === 0 && saida === 0) {
    alert("Informe ao menos um valor de Entrada ou Saída.");
    return;
  }

  if (origem === "ANE->FOLHA DE PAGAMENTO") {
    if (!folhaParaPagar) { alert("Folha não carregada. Selecione a origem novamente."); return; }
    pagarFolha(data, desc, saida);
  } else if (origem === "ANE->PASSAGENS") {
    if (!passagensParaPagar) { alert("Passagens não carregadas. Selecione a origem novamente."); return; }
    pagarPassagens(data, desc, saida);
  } else if (origem === "JOAO->CTAS A RECEBER") {
    criarContaAReceber(data, desc, saida);
  } else if (origem === "JOAO->BAIXA CTAS A RECEBER") {
    if (!contaReceberSelecionada) { alert("Selecione uma conta a receber. Selecione a origem novamente."); return; }
    baixarContaAReceber(data, desc, entrada);
  } else if (origem === "JOAO->CTAS A PAGAR") {
    criarContaAPagar(data, desc, entrada);
  } else if (origem === "JOAO->BAIXA CTAS A PAGAR") {
    if (!contaPagarSelecionada) { alert("Selecione uma conta a pagar. Selecione a origem novamente."); return; }
    baixarContaAPagar(data, desc, saida);
  } else if (origem === "ANE->CREDITO A REPASSAR P BBS FOMENTO") {
    criarCreditoRepassarBBS(data, desc, entrada);
  } else {
    col.add({ data, origem, descricao: desc, entrada, saida, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }

  document.getElementById("f-desc").value = "";
  document.getElementById("f-entrada").value = "";
  document.getElementById("f-saida").value = "";
  document.getElementById("f-saida").readOnly = false;
  document.getElementById("f-entrada").readOnly = false;
  folhaParaPagar = null;
  passagensParaPagar = null;
  descPrefix = null;
  contaReceberSelecionada = null;
  contaPagarSelecionada = null;
  toggleForm();
});

["f-entrada", "f-saida"].forEach(id => {
  document.getElementById(id).addEventListener("blur", function() {
    const v = parseMoeda(this.value);
    if (v > 0) this.value = v.toFixed(2).replace(".", ",");
  });
});


document.getElementById("f-data").value = hoje();

// Origem em 2 níveis: escolhe ANE/JOAO primeiro, depois as origens específicas de cada um
const ORIGEM_GRUPOS = {
  "ANE": [
    { value: "ANE", label: "DESPESA" },
    { value: "ANE->GW-INTER", label: "TRANSFERÊNCIA CEF → INTER" },
    { value: "ANE->HORACIO", label: "HORACIO-Pagamento de Empréstimo (Baixa do Crédito Horácio)" },
    { value: "ANE->JOAO", label: "JOÃO ALBÉRICO - Pagamento de Prólabore (Baixa do Crédito João)" },
    { value: "ANE->RETENCAO PARADIGMA 5%", label: "RETENÇÃO PARADIGMA 5% (A Receber)" },
    { value: "ANE->FOLHA DE PAGAMENTO", label: "PAGAMENTO DA FOLHA (Reseta a Folha de Pag)" },
    { value: "ANE->PASSAGENS", label: "PAGAMENTO DAS PASSAGENS (Reseta Passagens)" },
    { value: "ANE->ADIANTAMENTO", label: "ADIANTAMENTO DE SALÁRIO (Debita da Folha)" }
  ],
  "JOAO": [
    { value: "JOAO", label: "JOAO (Geral)" },
    { value: "JOAO->HORACIO", label: "JOÃO → HORÁCIO" },
    { value: "JOAO->RETENCAO PARADIGMA 5%", label: "JOAO → RETENÇÃO PARADIGMA 5%" },
    { value: "JOAO->CREDITO DE PROLABORE", label: "JOAO → CRÉDITO DE PRÓ-LABORE" },
    { value: "JOAO->JOAO", label: "JOÃO → JOÃO" },
    { value: "JOAO->CTAS A RECEBER", label: "JOÃO → CTAS A RECEBER" },
    { value: "JOAO->BAIXA CTAS A RECEBER", label: "JOÃO → BAIXA CTAS A RECEBER" },
    { value: "JOAO->CTAS A PAGAR", label: "JOÃO → CTAS A PAGAR" },
    { value: "JOAO->BAIXA CTAS A PAGAR", label: "JOÃO → BAIXA CTAS A PAGAR" },
    { value: "JOAO->ADIANTAMENTO", label: "ADIANTAMENTO DE SALÁRIO (Debita do Inter)" }
  ]
};

document.getElementById("f-origem-grupo").addEventListener("change", function() {
  const grupo = this.value;
  const wrap  = document.getElementById("f-origem-detalhe-wrap");
  const sel   = document.getElementById("f-origem");

  if (!grupo) {
    wrap.style.display = "none";
    sel.innerHTML = "";
    sel.dispatchEvent(new Event("change"));
    return;
  }

  sel.innerHTML = ORIGEM_GRUPOS[grupo].map(o => `<option value="${o.value}">${o.label}</option>`).join("");
  wrap.style.display = "";
  sel.value = grupo;
  sel.dispatchEvent(new Event("change"));
});

document.getElementById("f-origem").addEventListener("change", function() {
  const desc    = document.getElementById("f-desc");
  const saida   = document.getElementById("f-saida");
  const entrada = document.getElementById("f-entrada");
  const autoDescs = ["Transferência Pix: CEF -> INTER", "Transferência Pix: CEF -> HORÁCIO", "Pró-labore JOAO: CEF -> JOAO", "Transferência Pix: INTER -> HORÁCIO", "Folha de Pagamento da Produção", "Crédito Pró-labore: João Albérico", "Pró-labore JOAO: INTER -> JOAO", "Pagamento das Passagens da Próxima Quinzena"];

  // Sempre reseta os campos entrada/saída e prefixo ao trocar origem
  saida.readOnly = false;
  entrada.readOnly = false;
  folhaParaPagar = null;
  passagensParaPagar = null;
  descPrefix = null;
  contaReceberSelecionada = null;
  contaPagarSelecionada = null;

  if (this.value === "ANE->ADIANTAMENTO" || this.value === "JOAO->ADIANTAMENTO") {
    if (autoDescs.includes(desc.value)) desc.value = "";
    abrirPickerFuncionario();
    return;
  } else if (this.value === "JOAO->BAIXA CTAS A RECEBER") {
    if (autoDescs.includes(desc.value)) desc.value = "";
    abrirPickerContaReceber();
    return;
  } else if (this.value === "JOAO->BAIXA CTAS A PAGAR") {
    if (autoDescs.includes(desc.value)) desc.value = "";
    abrirPickerContaPagar();
    return;
  } else if (this.value === "ANE->CREDITO A REPASSAR P BBS FOMENTO") {
    if (autoDescs.includes(desc.value)) desc.value = "";
    saida.value = "";
    saida.readOnly = true;
  } else if (this.value === "ANE->GW-INTER") {
    desc.value = "Transferência Pix: CEF -> INTER";
  } else if (this.value === "ANE->HORACIO") {
    desc.value = "Transferência Pix: CEF -> HORÁCIO";
  } else if (this.value === "ANE->JOAO") {
    desc.value = "Pró-labore JOAO: CEF -> JOAO";
  } else if (this.value === "JOAO->HORACIO") {
    desc.value = "Transferência Pix: INTER -> HORÁCIO";
  } else if (this.value === "ANE->RETENCAO PARADIGMA 5%") {
    desc.value = "Retenção 5% Paradigma";
  } else if (this.value === "JOAO->RETENCAO PARADIGMA 5%") {
    desc.value = "Retenção 5% Paradigma";
  } else if (this.value === "JOAO->CREDITO DE PROLABORE") {
    desc.value = "Crédito Pró-labore: João Albérico";
  } else if (this.value === "JOAO->JOAO") {
    desc.value = "Pró-labore JOAO: INTER -> JOAO";
  } else if (this.value === "ANE->FOLHA DE PAGAMENTO") {
    desc.value = "Folha de Pagamento da Produção";
    saida.value = "carregando...";
    saida.readOnly = true;
    Promise.all([
      db.collection("folhas").orderBy("criadoEm", "desc").limit(1).get(),
      db.collection("lancamentos").where("origem", "in", ["ANE->ADIANTAMENTO", "JOAO->ADIANTAMENTO"]).get(),
      db.collection("locais").get(),
      db.collection("servicos").get(),
      db.collection("diarias").get()
    ]).then(([snap, adSnap, locaisSnap, servicosSnap, diariasSnap]) => {
      if (snap.empty) { alert("Nenhuma folha encontrada."); saida.value = ""; return; }
      const fdoc  = snap.docs[0];
      const folha = fdoc.data();
      if (folha.status === "paga") { alert("A última folha já foi paga."); saida.value = ""; return; }
      folhaParaPagar = { id: fdoc.id, folha };

      // Bruto real (atual) por funcionário de produção + total de serviços em pagamento
      // (mesmo cálculo de _porFuncProducao/_nServTotal no relatorio.html)
      const servByName = {};
      const catFallback = {};
      servicosSnap.docs.forEach(d => {
        const s = d.data();
        servByName[s.nome] = { medicao: s.medicao || 0, mdo: s.mdo || 0 };
        const cat = ordemServico(s.nome);
        if (cat < 99 && !(cat in catFallback)) catFallback[cat] = { medicao: s.medicao || 0, mdo: s.mdo || 0 };
      });

      const porFuncProducao = new Map();
      let nServTotal = 0;
      locaisSnap.docs.forEach(d => {
        (d.data().servicos || []).forEach(s => {
          if (s.status !== "em_pagamento") return;
          nServTotal++;
          const cat = ordemServico(s.nome);
          const valores = servByName[s.nome] || catFallback[cat] || { medicao: 0, mdo: 0 };
          let custoApto = valores.mdo;
          if (cat === 0 && s.funcionario && (s.funcionario.cargo || "").toLowerCase().includes("pintor")) {
            custoApto += 10;
          }
          const func = s.funcionario;
          if (func && !(func.cargo || "").toLowerCase().includes("ajudante")) {
            const key = func.id || func.nome;
            porFuncProducao.set(key, (porFuncProducao.get(key) || 0) + custoApto);
          }
        });
      });

      // Grupos da folha (sem ajudantes) + diaristas vindos de 'diarias'
      // (mesmo cálculo de renderPrevisaoFolha no relatorio.html)
      let grupos = (folha.grupos || []).filter(g =>
        g.isEncarregado || !(g.funcionario?.cargo || "").toLowerCase().includes("ajudante")
      );

      // Soma das diárias por funcionário (pintores também registram diária, além dos serviços de produção)
      const diariaPorFunc = new Map();
      diariasSnap.docs.forEach(d => {
        const doc = d.data();
        const subtotal = (doc.dias || []).reduce((s, dia) => s + Number(dia.valor || 0), 0);
        if (subtotal <= 0) return;
        const key = normNome(doc.funcionarioNome);
        const atual = diariaPorFunc.get(key) || { total: 0, nome: doc.funcionarioNome, cargo: doc.cargo || "Ajudante" };
        atual.total += subtotal;
        diariaPorFunc.set(key, atual);
      });

      // Só cria linha nova para quem ainda não tem linha (ajudante puro); quem já tem linha soma a diária nela
      const nomesExistentes = new Set(grupos.map(g => normNome(g.funcionario?.nome)));
      diariaPorFunc.forEach((info, key) => {
        if (!nomesExistentes.has(key)) grupos = [...grupos, {
          isEncarregado: false,
          funcionario: { nome: info.nome, cargo: info.cargo },
          subtotal: 0
        }];
      });

      const adiantMap = new Map();
      adSnap.docs.forEach(d => {
        const r = d.data();
        const ddesc = r.descricao || "";
        if (!ddesc.startsWith("Adiantamento: ")) return;
        const nome = ddesc.slice("Adiantamento: ".length).split(/\s*[—–\-]/)[0].trim().normalize("NFC");
        if (!nome) return;
        adiantMap.set(normNome(nome), (adiantMap.get(normNome(nome)) || 0) + (r.saida || 0));
      });

      let totalBruto = 0, totalAdiant = 0;
      grupos.forEach(g => {
        let bruto = g.subtotal || 0;
        if (g.isEncarregado) {
          const quinzena = (g.itens || []).find(i => i.servico === "Quinzena 50%");
          if (quinzena) bruto = Number(quinzena.valor || 0) + 5 * nServTotal;
        } else {
          const key = g.funcionario.id || g.funcionario.nome;
          if (porFuncProducao.has(key)) bruto = porFuncProducao.get(key);
        }
        const diaria = diariaPorFunc.get(normNome(g.funcionario.nome));
        if (diaria) bruto += diaria.total;
        totalBruto  += bruto;
        totalAdiant += adiantMap.get(normNome(g.funcionario.nome)) || 0;
      });

      const totalLiquido = totalBruto - totalAdiant;
      saida.value = totalLiquido.toFixed(2).replace(".", ",");
    });
  } else if (this.value === "ANE->PASSAGENS") {
    desc.value = "Pagamento das Passagens da Próxima Quinzena";
    saida.value = "carregando...";
    saida.readOnly = true;
    db.collection("funcionarios").get().then(snap => {
      let total = 0;
      const ids = [];
      snap.docs.forEach(d => {
        const f = d.data();
        if (f.ativo === false) return;
        const valor = Number(f.passagens || 0);
        if (valor > 0) { total += valor; ids.push(d.id); }
      });
      if (!ids.length) { alert("Nenhuma passagem a pagar."); saida.value = ""; return; }
      passagensParaPagar = { ids };
      saida.value = total.toFixed(2).replace(".", ",");
    });
  } else if (autoDescs.includes(desc.value)) {
    desc.value = "";
  }
});

function abrirPickerFuncionario() {
  const overlay = document.getElementById("picker-overlay");
  const lista   = document.getElementById("picker-lista");
  document.getElementById("picker-titulo").textContent = "Adiantamento — Funcionário";
  lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Carregando...</p>';
  overlay.classList.add("active");
  db.collection("funcionarios").orderBy("nome").get().then(snap => {
    const ativos = snap.docs.filter(d => d.data().ativo !== false);
    if (!ativos.length) {
      lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Nenhum funcionário ativo encontrado.</p>';
      return;
    }
    lista.innerHTML = ativos.map(d => {
      const f = d.data();
      return `<div class="picker-item" data-nome="${escHtml(f.nome)}" onclick="selecionarFuncionario(this.dataset.nome)">
        ${escHtml(f.nome)}<span class="picker-cargo-badge">${escHtml(f.cargo || "")}</span>
      </div>`;
    }).join("");
  }).catch(() => {
    lista.innerHTML = '<p style="color:#c62828;padding:12px;text-align:center">Erro ao carregar funcionários.</p>';
  });
}

function abrirPickerContaReceber() {
  const overlay = document.getElementById("picker-overlay");
  const lista   = document.getElementById("picker-lista");
  document.getElementById("picker-titulo").textContent = "Baixa — Conta a Receber";
  lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Carregando...</p>';
  overlay.classList.add("active");
  db.collection("contasReceber").get().then(snap => {
    contasReceberCache = {};
    const abertas = snap.docs.filter(d => d.data().status !== "baixado");
    if (!abertas.length) {
      lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Nenhuma conta a receber em aberto.</p>';
      return;
    }
    lista.innerHTML = abertas.map(d => {
      const c = d.data();
      contasReceberCache[d.id] = c;
      return `<div class="picker-item" data-id="${d.id}" onclick="selecionarContaReceber(this.dataset.id)">
        ${c.numero ? `Nº ${escHtml(c.numero)} — ` : ""}${escHtml(c.descricao)}<span class="picker-cargo-badge">${fmtMoeda(c.valor)}</span>
      </div>`;
    }).join("");
  }).catch(() => {
    lista.innerHTML = '<p style="color:#c62828;padding:12px;text-align:center">Erro ao carregar contas a receber.</p>';
  });
}

function abrirPickerContaPagar() {
  const overlay = document.getElementById("picker-overlay");
  const lista   = document.getElementById("picker-lista");
  document.getElementById("picker-titulo").textContent = "Pagamento — Conta a Pagar";
  lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Carregando...</p>';
  overlay.classList.add("active");
  db.collection("contasPagar").get().then(snap => {
    contasPagarCache = {};
    const abertas = snap.docs.filter(d => d.data().status !== "baixado");
    if (!abertas.length) {
      lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Nenhuma conta a pagar em aberto.</p>';
      return;
    }
    lista.innerHTML = abertas.map(d => {
      const c = d.data();
      contasPagarCache[d.id] = c;
      return `<div class="picker-item" data-id="${d.id}" onclick="selecionarContaPagar(this.dataset.id)">
        ${c.numero ? `Nº ${escHtml(c.numero)} — ` : ""}${escHtml(c.descricao)}<span class="picker-cargo-badge">${fmtMoeda(c.valor)}</span>
      </div>`;
    }).join("");
  }).catch(() => {
    lista.innerHTML = '<p style="color:#c62828;padding:12px;text-align:center">Erro ao carregar contas a pagar.</p>';
  });
}

function fecharPicker() {
  document.getElementById("picker-overlay").classList.remove("active");
  if (!descPrefix && !contaReceberSelecionada && !contaPagarSelecionada) {
    document.getElementById("f-origem").value = "";
  }
}

function selecionarFuncionario(nome) {
  document.getElementById("picker-overlay").classList.remove("active");
  const desc = document.getElementById("f-desc");
  descPrefix = "Adiantamento: " + nome + " — ";
  desc.value = descPrefix;
  desc.focus();
  desc.setSelectionRange(descPrefix.length, descPrefix.length);
}

function selecionarContaReceber(id) {
  document.getElementById("picker-overlay").classList.remove("active");
  const c = contasReceberCache[id];
  contaReceberSelecionada = { id, conta: c };
  const desc    = document.getElementById("f-desc");
  const entrada = document.getElementById("f-entrada");
  desc.value = `Baixa Cta a Receber${c.numero ? " Nº " + c.numero : ""}: ${c.descricao}`;
  entrada.value = (c.valor || 0).toFixed(2).replace(".", ",");
  entrada.readOnly = true;
}

function selecionarContaPagar(id) {
  document.getElementById("picker-overlay").classList.remove("active");
  const c = contasPagarCache[id];
  contaPagarSelecionada = { id, conta: c };
  const desc  = document.getElementById("f-desc");
  const saida = document.getElementById("f-saida");
  desc.value = `Pagamento Cta a Pagar${c.numero ? " Nº " + c.numero : ""}: ${c.descricao}`;
  saida.value = (c.valor || 0).toFixed(2).replace(".", ",");
  saida.readOnly = true;
}

document.getElementById("f-desc").addEventListener("keydown", function(e) {
  if (!descPrefix) return;
  const pos = this.selectionStart;
  if (e.key === "Backspace" && pos <= descPrefix.length) { e.preventDefault(); return; }
  if (e.key === "Delete"    && pos < descPrefix.length)  { e.preventDefault(); return; }
  if ((e.key === "ArrowLeft" || e.key === "Home") && pos <= descPrefix.length) {
    e.preventDefault();
    this.setSelectionRange(descPrefix.length, descPrefix.length);
  }
});

document.getElementById("f-desc").addEventListener("input", function() {
  if (!descPrefix) return;
  if (!this.value.startsWith(descPrefix)) {
    this.value = descPrefix;
    this.setSelectionRange(descPrefix.length, descPrefix.length);
  }
});

function pagarFolha(data, desc, saida) {
  const { id: folhaId, folha } = folhaParaPagar;

  // Lookup: "firestoreId:servico" → {funcionario, valor}
  const lookup = new Map();
  (folha.grupos || []).forEach(g => {
    if (g.isEncarregado) return;
    (g.itens || []).forEach(item => {
      const entry = { funcionario: g.funcionario, valor: item.valor };
      lookup.set(`${item.firestoreLocalId}:${item.servico}`,            entry);
      lookup.set(`${item.firestoreLocalId}:${nomeAbrev(item.servico)}`, entry);
    });
  });

  Promise.all([
    db.collection("locais").get(),
    db.collection("diarias").get(),
    db.collection("lancamentos").where("origem", "in", ["ANE->ADIANTAMENTO", "JOAO->ADIANTAMENTO"]).get()
  ]).then(([locaisSnap, diariasSnap, adiantSnap]) => {
    const batch = db.batch();

    // Lançamento no caixa
    batch.set(col.doc(), {
      data, origem: "ANE->FOLHA DE PAGAMENTO", descricao: desc,
      entrada: 0, saida,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Marca folha como paga
    batch.update(db.collection("folhas").doc(folhaId), {
      status:  "paga",
      pagaEm:  firebase.firestore.FieldValue.serverTimestamp()
    });

    // Marca cada serviço amarelo como concluido
    locaisSnap.docs.forEach(doc => {
      const servicos  = doc.data().servicos || [];
      const temAmarelo = servicos.some(s => s.status === "em_pagamento");
      if (!temAmarelo) return;

      const novos = servicos.map(s => {
        if (s.status !== "em_pagamento") return s;
        const found    = lookup.get(`${doc.id}:${s.nome}`) || lookup.get(`${doc.id}:${nomeAbrev(s.nome)}`) || {};
        const executor = s.funcionario || found.funcionario || null;
        return {
          id:            s.id,
          nome:          s.nome,
          status:        "concluido",
          executor:      executor ? { nome: executor.nome, id: executor.id || "" } : null,
          valorPago:     found.valor || 0,
          dataPagamento: data
        };
      });

      batch.update(db.collection("locais").doc(doc.id), { servicos: novos });
    });

    // Zera o crédito dos diaristas no calendário da folha (pago junto com esta folha)
    diariasSnap.docs.forEach(doc => batch.delete(doc.ref));

    // Adiantamentos já descontados nesta folha não entram na próxima (preserva a origem ANE/JOAO)
    adiantSnap.docs.forEach(doc => {
      const novaOrigem = doc.data().origem === "JOAO->ADIANTAMENTO" ? "JOAO->ANTECIPACAO" : "ANE->ANTECIPACAO";
      batch.update(doc.ref, { origem: novaOrigem });
    });

    batch.commit().catch(() => alert("Erro ao registrar pagamento. Tente novamente."));
  });
}

function pagarPassagens(data, desc, saida) {
  const { ids } = passagensParaPagar;
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: "ANE->PASSAGENS", descricao: desc,
    entrada: 0, saida,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  // Zera as passagens pagas — não entram no próximo relatório da quinzena
  ids.forEach(id => batch.update(db.collection("funcionarios").doc(id), { passagens: 0 }));

  batch.commit().catch(() => alert("Erro ao registrar pagamento. Tente novamente."));
}

function criarContaAReceber(data, desc, saida) {
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: "JOAO->CTAS A RECEBER", descricao: desc,
    entrada: 0, saida,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.set(db.collection("contasReceber").doc(), {
    numero, data, descricao: desc, valor: saida, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit().catch(() => alert("Erro ao criar conta a receber. Tente novamente."));
}

function baixarContaAReceber(data, desc, entrada) {
  const { id, conta } = contaReceberSelecionada;
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: "JOAO->BAIXA CTAS A RECEBER", descricao: desc,
    entrada, saida: 0,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.update(db.collection("contasReceber").doc(id), {
    status: "baixado", dataBaixa: data, numeroBaixa: numero
  });

  batch.commit().catch(() => alert("Erro ao baixar conta a receber. Tente novamente."));
}

function criarContaAPagar(data, desc, entrada) {
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: "JOAO->CTAS A PAGAR", descricao: desc,
    entrada, saida: 0,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.set(db.collection("contasPagar").doc(), {
    numero, data, descricao: desc, valor: entrada, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit().catch(() => alert("Erro ao criar conta a pagar. Tente novamente."));
}

function criarCreditoRepassarBBS(data, desc, entrada) {
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: "ANE->CREDITO A REPASSAR P BBS FOMENTO", descricao: desc,
    entrada, saida: 0,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.set(db.collection("contasPagar").doc(), {
    numero, data: hoje(), descricao: desc, valor: entrada, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit().catch(() => alert("Erro ao criar conta a pagar. Tente novamente."));
}

function baixarContaAPagar(data, desc, saida) {
  const { id, conta } = contaPagarSelecionada;
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: "JOAO->BAIXA CTAS A PAGAR", descricao: desc,
    entrada: 0, saida,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.update(db.collection("contasPagar").doc(id), {
    status: "baixado", dataBaixa: data, numeroBaixa: numero
  });

  batch.commit().catch(() => alert("Erro ao baixar conta a pagar. Tente novamente."));
}

function toggleForm() {
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  const open = form.style.display === "none" || form.style.display === "";
  form.style.display = open ? "block" : "none";
  fab.classList.toggle("open", open);
  if (open) {
    document.getElementById("f-desc").focus();
  } else {
    descPrefix = null;
  }
}


if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: 'none' });
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}
