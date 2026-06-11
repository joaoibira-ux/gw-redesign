const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO_CAIXA = "3.27";
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
      } else if (r.origem === "ANE->ADIANTAMENTO") {
        cefS += r.saida || 0;
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
col.orderBy("criadoEm", "asc").onSnapshot(snapshot => {
  render(snapshot.docs);
}, err => {
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

document.getElementById("f-origem").addEventListener("change", function() {
  const desc    = document.getElementById("f-desc");
  const saida   = document.getElementById("f-saida");
  const entrada = document.getElementById("f-entrada");
  const autoDescs = ["Transferência Pix: CEF -> INTER", "Transferência Pix: CEF -> HORÁCIO", "Pró-labore JOAO: CEF -> JOAO", "Transferência Pix: INTER -> HORÁCIO", "Folha de Pagamento da Produção", "Crédito Pró-labore: João Albérico", "Pró-labore JOAO: INTER -> JOAO"];

  // Sempre reseta os campos entrada/saída e prefixo ao trocar origem
  saida.readOnly = false;
  entrada.readOnly = false;
  folhaParaPagar = null;
  descPrefix = null;
  contaReceberSelecionada = null;
  contaPagarSelecionada = null;

  if (this.value === "ANE->ADIANTAMENTO") {
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
    db.collection("folhas").orderBy("criadoEm", "desc").limit(1).get().then(snap => {
      if (snap.empty) { alert("Nenhuma folha encontrada."); saida.value = ""; return; }
      const fdoc  = snap.docs[0];
      const folha = fdoc.data();
      if (folha.status === "paga") { alert("A última folha já foi paga."); saida.value = ""; return; }
      folhaParaPagar = { id: fdoc.id, folha };
      saida.value = (folha.totalGeral || 0).toFixed(2).replace(".", ",");
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

  db.collection("locais").get().then(snap => {
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
    snap.docs.forEach(doc => {
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

    batch.commit().catch(() => alert("Erro ao registrar pagamento. Tente novamente."));
  });
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
