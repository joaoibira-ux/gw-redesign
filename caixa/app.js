const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO_CAIXA = "3.58";
const HORACIO_BASE = -136306.23;
const JOAO_BASE = -32250;
document.getElementById("versao-caixa").textContent = "Versão: " + VERSAO_CAIXA;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("lancamentos");
const uploadComprovanteCaixaFn = firebase.functions().httpsCallable("uploadComprovanteCaixa");

function fileParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Upload via Cloud Function (Admin SDK no servidor) em vez de direto do
// navegador — o upload client-side (Storage SDK) falhava com "storage/unknown"
// no Safari iOS mesmo com Storage Rules e CORS do bucket corretos. Passando
// pelo servidor evita qualquer questão de CORS/protocolo resumable no
// navegador, mesmo padrão já usado (e estável) pros boletos do WhatsApp.
async function uploadComprovante(file) {
  const base64 = await fileParaBase64(file);
  const result = await uploadComprovanteCaixaFn({
    base64, nomeArquivo: file.name, contentType: file.type || "application/octet-stream"
  });
  return { url: result.data.url, nomeArquivo: file.name };
}

// Anexa um comprovante a um lançamento JÁ EXISTENTE (que ainda não tinha
// nenhum) — abre o seletor de arquivo e, ao escolher, sobe e grava direto
// no documento, sem precisar editar mais nada.
let _anexarComprovanteAlvoId = null;
function anexarComprovanteExistente(id) {
  _anexarComprovanteAlvoId = id;
  document.getElementById("f-comprovante-existente").click();
}

document.getElementById("f-comprovante-existente").addEventListener("change", async function() {
  const file = this.files[0];
  this.value = "";
  const id = _anexarComprovanteAlvoId;
  _anexarComprovanteAlvoId = null;
  if (!file || !id) return;

  try {
    const comprovante = await uploadComprovante(file);
    await col.doc(id).update({
      comprovanteUrl: comprovante.url,
      comprovanteNomeArquivo: comprovante.nomeArquivo
    });
  } catch (err) {
    console.error("Erro ao anexar comprovante:", err);
    alert("Erro ao anexar comprovante: " + (err.code || err.message || "falha desconhecida") + "\n\nTente novamente.");
  }
});

const excluirComprovanteFn = firebase.functions().httpsCallable("excluirComprovante");

async function removerComprovante(id) {
  const r = docsCache[id];
  if (!r || !r.comprovanteUrl) return;
  const senha = prompt("EXCLUIR COMPROVANTE ANEXADO?\n\n" + r.descricao + "\n\nDigite a senha:");
  if (senha === null) return;
  if (senha !== "6535" && senha !== "4512") { alert("Senha incorreta."); return; }

  try {
    await excluirComprovanteFn({ url: r.comprovanteUrl });
    await col.doc(id).update({
      comprovanteUrl: firebase.firestore.FieldValue.delete(),
      comprovanteNomeArquivo: firebase.firestore.FieldValue.delete()
    });
  } catch (err) {
    console.error("Erro ao excluir comprovante:", err);
    alert("Erro ao excluir comprovante: " + (err.code || err.message || "falha desconhecida"));
  }
}

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
      } else if (r.origem === "ANE->EMPRESTIMO") {
        cefE += r.entrada || 0;
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
      } else if (r.origem === "ANE->BAIXA CTAS A PAGAR") {
        cefS += r.saida || 0;
      } else if (r.origem === "ANE->BAIXA CTAS A RECEBER") {
        cefE += r.entrada || 0;
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
          ${r.comprovanteUrl
            ? `<a href="${escHtml(r.comprovanteUrl)}" target="_blank" rel="noopener" class="card-comprovante-clip" onclick="event.stopPropagation()" title="Ver comprovante anexado">📎</a>
               <button type="button" class="card-comprovante-del" onclick="event.stopPropagation();removerComprovante('${doc.id}')" title="Excluir comprovante">✕</button>`
            : `<button type="button" class="card-comprovante-add" onclick="event.stopPropagation();anexarComprovanteExistente('${doc.id}')" title="Anexar comprovante">📎 Anexar</button>`}
        </div>
      </div>`;
  }).join("");

  lista.lastElementChild.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function deletar(id) {
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
  if (senha !== "6535" && senha !== "4512") {
    alert("Senha incorreta. Nada foi excluído.");
    return;
  }

  const ehBaixaContaPagar = (r.origem === "JOAO->BAIXA CTAS A PAGAR" || r.origem === "ANE->BAIXA CTAS A PAGAR") && r.contaPagarId;

  // Se esse lançamento criou uma conta a pagar nova (empréstimo, "Contas a
  // Pagar" direto, crédito a repassar BBS), desfaz os dois juntos — só se
  // a conta ainda estiver em aberto. Se já foi paga, algo mudou por fora
  // do fluxo normal e é mais seguro não apagar um registro já quitado.
  let contaPagarCriadaParaExcluir = null;
  if (r.contaPagarCriadoId) {
    const snap = await db.collection("contasPagar").doc(r.contaPagarCriadoId).get();
    if (snap.exists && snap.data().status !== "baixado") {
      contaPagarCriadaParaExcluir = r.contaPagarCriadoId;
    } else if (snap.exists) {
      alert("Atenção: a conta a pagar gerada por este lançamento já foi paga e não será removida automaticamente.");
    }
  }

  const batch = db.batch();
  batch.set(db.collection("deletados").doc(), {
    ...r,
    idOriginal: id,
    deletadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.delete(col.doc(id));

  // Desfaz exatamente o efeito desta baixa no Contas a Pagar: volta o
  // valor e o status de antes, remove esse pagamento do extrato e, se
  // era o primeiro pagamento do documento, tira valorOriginal/pagamentos
  // por completo (documento fica idêntico a como estava antes de qualquer baixa).
  if (ehBaixaContaPagar) {
    const restaurar = {
      valor: r.valorContaPagarAntes,
      status: r.statusContaPagarAntes || "aberto"
    };
    if (r.statusContaPagarAntes !== "baixado") {
      restaurar.dataBaixa = firebase.firestore.FieldValue.delete();
      restaurar.numeroBaixa = firebase.firestore.FieldValue.delete();
    }
    if (r.eraPrimeiroPagamento) {
      restaurar.valorOriginal = firebase.firestore.FieldValue.delete();
      restaurar.pagamentos = firebase.firestore.FieldValue.delete();
    } else if (r.pagamentoRegistrado) {
      restaurar.pagamentos = firebase.firestore.FieldValue.arrayRemove(r.pagamentoRegistrado);
    }
    batch.update(db.collection("contasPagar").doc(r.contaPagarId), restaurar);
  }

  if (contaPagarCriadaParaExcluir) {
    batch.delete(db.collection("contasPagar").doc(contaPagarCriadaParaExcluir));
  }

  batch.commit().catch(() => alert("Erro ao excluir. Tente novamente."));
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

document.getElementById("form").addEventListener("submit", async function(e) {
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

  // Já aconteceu de uma entrada da BBS Fomento (empresa de empréstimo) ser
  // lançada como origem "ANE" comum em vez de "ANE->EMPRÉSTIMO", sem gerar
  // o registro correspondente no Contas a Pagar. Se a descrição menciona
  // "BBS" e a origem não é a de empréstimo, confirma com a Ane antes de
  // seguir — fácil de corrigir aqui, difícil de notar depois.
  if (origem.startsWith("ANE") && entrada > 0 && !origem.includes("EMPRESTIMO") && desc.toUpperCase().includes("BBS")) {
    const confirmar = await confirmarModal(
      'Essa entrada menciona "BBS" mas a origem não é "ENTRADA DE EMPRÉSTIMO".\n\nTem certeza que não é um EMPRÉSTIMO que deveria ter registro no Contas a Pagar?'
    );
    if (!confirmar) return;
  }

  const btnAdd = document.getElementById("btn-add");
  const arquivoComprovante = document.getElementById("f-comprovante").files[0];
  let comprovante = null;
  if (arquivoComprovante) {
    btnAdd.disabled = true;
    btnAdd.textContent = "Enviando comprovante...";
    try {
      comprovante = await uploadComprovante(arquivoComprovante);
    } catch (err) {
      console.error("Erro ao enviar comprovante:", err);
      alert("Erro ao enviar o comprovante: " + (err.code || err.message || "falha desconhecida") + "\n\nTente novamente.");
      btnAdd.disabled = false;
      btnAdd.textContent = "+ Adicionar";
      return;
    }
    btnAdd.disabled = false;
    btnAdd.textContent = "+ Adicionar";
  }

  if (origem === "JOAO->CTAS A RECEBER") {
    criarContaAReceber(data, desc, saida, comprovante);
  } else if (origem === "JOAO->BAIXA CTAS A RECEBER" || origem === "ANE->BAIXA CTAS A RECEBER") {
    if (!contaReceberSelecionada) { alert("Selecione uma conta a receber. Selecione a origem novamente."); return; }
    baixarContaAReceber(data, desc, entrada, origem, comprovante);
  } else if (origem === "JOAO->CTAS A PAGAR") {
    criarContaAPagar(data, desc, entrada, comprovante);
  } else if (origem === "ANE->EMPRESTIMO") {
    criarEntradaEmprestimo(data, desc, entrada, comprovante);
  } else if (origem === "JOAO->BAIXA CTAS A PAGAR" || origem === "ANE->BAIXA CTAS A PAGAR") {
    if (!contaPagarSelecionada) { alert("Selecione uma conta a pagar. Selecione a origem novamente."); return; }
    baixarContaAPagar(data, desc, saida, origem, comprovante);
  } else if (origem === "ANE->CREDITO A REPASSAR P BBS FOMENTO") {
    criarCreditoRepassarBBS(data, desc, entrada, comprovante);
  } else {
    col.add({
      data, origem, descricao: desc, entrada, saida,
      ...(comprovante ? { comprovanteUrl: comprovante.url, comprovanteNomeArquivo: comprovante.nomeArquivo } : {}),
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  document.getElementById("f-desc").value = "";
  document.getElementById("f-entrada").value = "";
  document.getElementById("f-saida").value = "";
  document.getElementById("f-saida").readOnly = false;
  document.getElementById("f-entrada").readOnly = false;
  document.getElementById("f-comprovante").value = "";
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
    { value: "ANE->EMPRESTIMO", label: "ENTRADA DE EMPRÉSTIMO (Gera Conta a Pagar)" },
    { value: "ANE->ADIANTAMENTO", label: "ADIANTAMENTO DE SALÁRIO (Debita da Folha)" },
    { value: "ANE->BAIXA CTAS A PAGAR", label: "ANE → BAIXA CTAS A PAGAR" },
    { value: "ANE->BAIXA CTAS A RECEBER", label: "ANE → BAIXA CTAS A RECEBER" }
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
  const autoDescs = ["Transferência Pix: CEF -> INTER", "Transferência Pix: CEF -> HORÁCIO", "Pró-labore JOAO: CEF -> JOAO", "Transferência Pix: INTER -> HORÁCIO", "Crédito Pró-labore: João Albérico", "Pró-labore JOAO: INTER -> JOAO"];

  // Sempre reseta os campos entrada/saída e prefixo ao trocar origem
  saida.readOnly = false;
  entrada.readOnly = false;
  descPrefix = null;
  contaReceberSelecionada = null;
  contaPagarSelecionada = null;

  if (this.value === "ANE->ADIANTAMENTO" || this.value === "JOAO->ADIANTAMENTO") {
    if (autoDescs.includes(desc.value)) desc.value = "";
    abrirPickerFuncionario();
    return;
  } else if (this.value === "JOAO->BAIXA CTAS A RECEBER" || this.value === "ANE->BAIXA CTAS A RECEBER") {
    if (autoDescs.includes(desc.value)) desc.value = "";
    abrirPickerContaReceber();
    return;
  } else if (this.value === "JOAO->BAIXA CTAS A PAGAR" || this.value === "ANE->BAIXA CTAS A PAGAR") {
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
  } else if (this.value === "JOAO->RETENCAO PARADIGMA 5%") {
    desc.value = "Retenção 5% Paradigma";
  } else if (this.value === "JOAO->CREDITO DE PROLABORE") {
    desc.value = "Crédito Pró-labore: João Albérico";
  } else if (this.value === "JOAO->JOAO") {
    desc.value = "Pró-labore JOAO: INTER -> JOAO";
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

// Converte "D/M/AAAA" ou "DD/MM/AAAA" (formato salvo em contasPagar.data)
// num Date pra dar pra ordenar cronologicamente — string pura ordenaria
// errado (ex: "1/12/2026" viria antes de "15/1/2026" alfabeticamente).
function parseDataBR(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || "").trim());
  if (!m) return new Date(0);
  const [, d, mes, ano] = m;
  return new Date(Number(ano.length === 2 ? "20" + ano : ano), Number(mes) - 1, Number(d));
}

function abrirPickerContaPagar() {
  const overlay = document.getElementById("picker-overlay");
  const lista   = document.getElementById("picker-lista");
  document.getElementById("picker-titulo").textContent = "Pagamento — Conta a Pagar";
  lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Carregando...</p>';
  overlay.classList.add("active");
  db.collection("contasPagar").get().then(snap => {
    contasPagarCache = {};
    const abertas = snap.docs
      .filter(d => d.data().status !== "baixado")
      .sort((a, b) => parseDataBR(a.data().data) - parseDataBR(b.data().data));
    if (!abertas.length) {
      lista.innerHTML = '<p style="color:#888;padding:12px;text-align:center">Nenhuma conta a pagar em aberto.</p>';
      return;
    }
    lista.innerHTML = abertas.map(d => {
      const c = d.data();
      contasPagarCache[d.id] = c;
      return `<div class="picker-item" data-id="${d.id}" onclick="selecionarContaPagar(this.dataset.id)">
        <span>${c.data ? `<span class="picker-data">${escHtml(c.data)}</span> — ` : ""}${c.numero ? `Nº ${escHtml(c.numero)} — ` : ""}${escHtml(c.descricao)}</span><span class="picker-cargo-badge">${fmtMoeda(c.valor)}</span>
      </div>`;
    }).join("");
  }).catch(() => {
    lista.innerHTML = '<p style="color:#c62828;padding:12px;text-align:center">Erro ao carregar contas a pagar.</p>';
  });
}

// Modal de confirmação com botões próprios (VOLTAR/CONTINUAR) — usado no
// lugar do confirm() nativo do navegador, cujos botões (OK/Cancelar) não
// dá pra renomear.
function confirmarModal(mensagem, titulo) {
  return new Promise(resolve => {
    const overlay = document.getElementById("confirm-overlay");
    document.getElementById("confirm-titulo").textContent = titulo || "Confirmar";
    document.getElementById("confirm-mensagem").textContent = mensagem;
    const btnVoltar     = document.getElementById("confirm-btn-voltar");
    const btnContinuar  = document.getElementById("confirm-btn-continuar");

    function limpar(resultado) {
      overlay.classList.remove("active");
      btnVoltar.removeEventListener("click", onVoltar);
      btnContinuar.removeEventListener("click", onContinuar);
      resolve(resultado);
    }
    function onVoltar()    { limpar(false); }
    function onContinuar() { limpar(true); }

    btnVoltar.addEventListener("click", onVoltar);
    btnContinuar.addEventListener("click", onContinuar);
    overlay.classList.add("active");
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
  saida.readOnly = false;
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


function criarContaAReceber(data, desc, saida, comprovante) {
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: "JOAO->CTAS A RECEBER", descricao: desc,
    entrada: 0, saida,
    ...(comprovante ? { comprovanteUrl: comprovante.url, comprovanteNomeArquivo: comprovante.nomeArquivo } : {}),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.set(db.collection("contasReceber").doc(), {
    numero, data, descricao: desc, valor: saida, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit().catch(() => alert("Erro ao criar conta a receber. Tente novamente."));
}

function baixarContaAReceber(data, desc, entrada, origem, comprovante) {
  const { id, conta } = contaReceberSelecionada;
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  batch.set(col.doc(), {
    data, origem: origem || "JOAO->BAIXA CTAS A RECEBER", descricao: desc,
    entrada, saida: 0,
    ...(comprovante ? { comprovanteUrl: comprovante.url, comprovanteNomeArquivo: comprovante.nomeArquivo } : {}),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.update(db.collection("contasReceber").doc(id), {
    status: "baixado", dataBaixa: data, numeroBaixa: numero
  });

  batch.commit().catch(() => alert("Erro ao baixar conta a receber. Tente novamente."));
}

function criarContaAPagar(data, desc, entrada, comprovante) {
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();
  const contaPagarRef = db.collection("contasPagar").doc();

  batch.set(col.doc(), {
    data, origem: "JOAO->CTAS A PAGAR", descricao: desc,
    entrada, saida: 0,
    contaPagarCriadoId: contaPagarRef.id,
    ...(comprovante ? { comprovanteUrl: comprovante.url, comprovanteNomeArquivo: comprovante.nomeArquivo } : {}),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.set(contaPagarRef, {
    numero, data, descricao: desc, valor: entrada, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit().catch(() => alert("Erro ao criar conta a pagar. Tente novamente."));
}

// Entrada de empréstimo: dinheiro entra no caixa CEF (ANE) e, ao mesmo
// tempo, vira uma dívida a pagar depois — mesmo padrão de criarContaAPagar,
// só muda o lado (CEF em vez de INTER/JOAO) e a origem do lançamento.
// O vencimento da conta a pagar é pedido à parte (não pode ser a data do
// lançamento, que é de quando o dinheiro entrou, não de quando vence).
function criarEntradaEmprestimo(data, desc, entrada, comprovante) {
  const vencimento = prompt("Data de vencimento do empréstimo (quando deve ser pago):", data);
  if (vencimento === null) return;
  if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(vencimento.trim())) {
    alert("Data de vencimento inválida. Use o formato DD/MM/AAAA.");
    return;
  }

  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();
  const contaPagarRef = db.collection("contasPagar").doc();

  batch.set(col.doc(), {
    data, origem: "ANE->EMPRESTIMO", descricao: desc,
    entrada, saida: 0,
    contaPagarCriadoId: contaPagarRef.id,
    ...(comprovante ? { comprovanteUrl: comprovante.url, comprovanteNomeArquivo: comprovante.nomeArquivo } : {}),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.set(contaPagarRef, {
    numero, data: vencimento.trim(), descricao: desc, valor: entrada, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit().catch(() => alert("Erro ao registrar entrada de empréstimo. Tente novamente."));
}

function criarCreditoRepassarBBS(data, desc, entrada, comprovante) {
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();
  const contaPagarRef = db.collection("contasPagar").doc();

  batch.set(col.doc(), {
    data, origem: "ANE->CREDITO A REPASSAR P BBS FOMENTO", descricao: desc,
    entrada, saida: 0,
    contaPagarCriadoId: contaPagarRef.id,
    ...(comprovante ? { comprovanteUrl: comprovante.url, comprovanteNomeArquivo: comprovante.nomeArquivo } : {}),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.set(contaPagarRef, {
    numero, data: hoje(), descricao: desc, valor: entrada, status: "aberto",
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  batch.commit().catch(() => alert("Erro ao criar conta a pagar. Tente novamente."));
}

function baixarContaAPagar(data, desc, saida, origem, comprovante) {
  const { id, conta } = contaPagarSelecionada;
  const numero = String(Object.keys(docsCache).length + 1).padStart(4, "0");
  const batch = db.batch();

  // Tolerância de arredondamento: valor digitado cobre (ou praticamente
  // cobre) o que resta -> baixa integral. Menor que isso -> pagamento
  // parcial, registra no extrato e diminui o valor restante da conta.
  const valorAtual = conta.valor || 0;
  const pagamentoIntegral = saida >= valorAtual - 0.005;
  const contaPagarRef = db.collection("contasPagar").doc(id);
  const pagamento = { data, valor: saida, criadoEm: new Date().toISOString() };
  // Guardados no lançamento pra permitir desfazer exatamente esta baixa
  // caso o lançamento seja excluído em seguida (ver deletar()).
  const eraPrimeiroPagamento = conta.valorOriginal === undefined;

  batch.set(col.doc(), {
    data, origem: origem || "JOAO->BAIXA CTAS A PAGAR", descricao: desc,
    entrada: 0, saida,
    contaPagarId: id,
    valorContaPagarAntes: valorAtual,
    statusContaPagarAntes: conta.status || "aberto",
    eraPrimeiroPagamento,
    pagamentoRegistrado: pagamento,
    ...(comprovante ? { comprovanteUrl: comprovante.url, comprovanteNomeArquivo: comprovante.nomeArquivo } : {}),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  if (pagamentoIntegral) {
    batch.update(contaPagarRef, {
      status: "baixado", dataBaixa: data, numeroBaixa: numero,
      valor: 0,
      valorOriginal: conta.valorOriginal !== undefined ? conta.valorOriginal : valorAtual,
      pagamentos: firebase.firestore.FieldValue.arrayUnion(pagamento)
    });
  } else {
    batch.update(contaPagarRef, {
      valor: valorAtual - saida,
      valorOriginal: conta.valorOriginal !== undefined ? conta.valorOriginal : valorAtual,
      pagamentos: firebase.firestore.FieldValue.arrayUnion(pagamento)
    });
  }

  batch.commit().catch(() => alert("Erro ao baixar conta a pagar. Tente novamente."));
}

function toggleForm() {
  const form = document.getElementById("form");
  const fab  = document.getElementById("fab");
  const open = form.style.display === "none" || form.style.display === "";
  form.style.display = open ? "block" : "none";
  fab.classList.toggle("open", open);
  if (open) {
    // Sugere a origem pelo PIN usado pra entrar no sistema (gw_auth, setado
    // pela tela de login em index.html): 4512 = Ane (parcial), 2248 = João
    // (completo). Só preenche se o campo ainda estiver vazio — nunca troca
    // uma escolha que o usuário já tenha feito, e ele pode mudar à vontade.
    const grupoSel = document.getElementById("f-origem-grupo");
    if (!grupoSel.value) {
      const MODO_PARA_GRUPO = { completo: "JOAO", parcial: "ANE" };
      const sugestao = MODO_PARA_GRUPO[sessionStorage.getItem("gw_auth")];
      if (sugestao) {
        grupoSel.value = sugestao;
        grupoSel.dispatchEvent(new Event("change"));
      }
    }
    document.getElementById("f-desc").focus();
  } else {
    descPrefix = null;
    // Sem isso, o seletor de Origem ficava travado na última opção escolhida
    // (ex: "Adiantamento de Salário") — na próxima vez que o formulário
    // abrisse, o evento "change" não disparava de novo (o valor não mudou),
    // então a tela de escolher funcionário/conta nunca reaparecia. Resetar
    // pra "Selecione..." e disparar o change força a re-seleção do zero.
    const grupo = document.getElementById("f-origem-grupo");
    grupo.value = "";
    grupo.dispatchEvent(new Event("change"));
  }
}


if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: 'none' });
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}
