const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const VERSAO = "4.65";
document.querySelector("header span").textContent = `Folha de Pagamento da Produção v${VERSAO}`;

// ── Loading overlay ───────────────────────────────────────────
const _loMsgs = [
  'Buscando dados atualizados...',
  'Verificando serviços em andamento...',
  'Sincronizando funcionários...',
  'Conectando ao servidor...',
  'Pode demorar em redes lentas...',
  'Ainda carregando, aguarde...'
];
let _loIdx = 0, _loTimer = setInterval(() => {
  _loIdx = (_loIdx + 1) % _loMsgs.length;
  const el = document.getElementById('lo-msg');
  if (!el) { clearInterval(_loTimer); return; }
  el.style.opacity = '0';
  setTimeout(() => { if (el) { el.textContent = _loMsgs[_loIdx]; el.style.opacity = '1'; } }, 300);
}, 3000);

function esconderLoading() {
  clearInterval(_loTimer);
  const lo = document.getElementById('lo');
  if (!lo) return;
  lo.style.opacity = '0';
  setTimeout(() => { if (lo.parentNode) lo.parentNode.removeChild(lo); }, 420);
}

// ── Estado ─────────────────────────────────────────────────
let entradas             = [];
let funcionarioAtual     = null;
let servicosSelecionados = new Map();
let locaisCache          = {};
let servicosCache        = [];
let locaisData           = [];
let folhaAbertaId        = null;
let encarregadoCache     = null;

// Flags para o link #relatorio — aguarda as 3 fontes de dados
const _isRelatorioLink    = window.location.hash === '#relatorio';
let _locaisCarregado      = false;
let _diariasCarregado     = false;
let _funcionariosCarregado = false;
let _relatorioMostrado    = false;

function _tentarRelatorio() {
  if (!_isRelatorioLink || _relatorioMostrado) return;
  if (!_locaisCarregado || !_diariasCarregado || !_funcionariosCarregado) return;
  _relatorioMostrado = true;
  verRelatorio();
}

// ── Navegação ──────────────────────────────────────────────
function mostrarView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('ativa'));
  document.getElementById(id).classList.add('ativa');
  if (id === 'view-funcionarios') renderFuncionarios();
}

// ── Utilitários ────────────────────────────────────────────
function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function ordemServico(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento"))                          return 0;
  if (n.includes("pasta"))                               return 1;
  if (n.includes("emassamento") || n.includes("massa"))  return 2;
  if (n.includes("textura"))                             return 3;
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

// Nome a exibir nos quadrados do Mapa: usa "Nome no Mapa" cadastrado em
// Serviços (quando definido), senão cai na abreviação automática
function nomeMapaServico(s) {
  const disp = servicosCache.find(d => d.id === s.id);
  return disp && disp.nomeMapa ? disp.nomeMapa : nomeAbrev(s.nome);
}

// Mesmo critério do Mapa, mas a partir do nome completo do serviço (usado na
// folha/comprovante, onde só o nome — não o id — fica salvo nas entradas)
function nomeExibicaoServico(nomeCompleto) {
  const disp = servicosCache.find(d => d.nome === nomeCompleto);
  return disp && disp.nomeMapa ? disp.nomeMapa : nomeAbrev(nomeCompleto);
}

function parseId(id) {
  const m = id.match(/^([A-Z]+)(\d+)$/);
  return m ? { block: m[1], num: parseInt(m[2]) } : null;
}

function getMdo(nomeServico) {
  const exato = servicosCache.find(s => s.nome === nomeServico);
  if (exato) return exato.mdo || 0;
  const ordem = ordemServico(nomeServico);
  const match = servicosCache.find(s => ordemServico(s.nome) === ordem);
  return match ? (match.mdo || 0) : 0;
}

function calcValor(nomeServico, cargo) {
  const base        = getMdo(nomeServico);
  const tratamento  = (nomeServico || '').toLowerCase().includes('tratamento');
  const pintor      = (cargo || '').toLowerCase().includes('pintor');
  return tratamento && pintor ? base + 10 : base;
}

// ── Coleção servicos ───────────────────────────────────────
db.collection('servicos').onSnapshot(snap => {
  servicosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render(locaisData);
});

// ── Encarregado ────────────────────────────────────────────
db.collection('funcionarios').onSnapshot(snap => {
  encarregadoCache = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(f => f.ativo !== false && (f.cargo || '').toLowerCase().includes('encarregado')) || null;
  _funcionariosCarregado = true;
  _tentarRelatorio();
});

// ── Diaristas — mesma fonte que produção (onSnapshot em tempo real) ──────
let _diariasCache = [];

function sincronizarDiaristas() {
  entradas = entradas.filter(e => e.firestoreLocalId);
  _diariasCache.forEach(doc => {
    (doc.dias || []).forEach(d => {
      entradas.push({
        funcionario:      { id: doc.funcionarioId || '', nome: doc.funcionarioNome, cargo: doc.cargo || '' },
        firestoreLocalId: '',
        localId:          d.localId,
        servico:          'Diária',
        valor:            d.valor
      });
    });
  });
}

db.collection('diarias').onSnapshot(snap => {
  _diariasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _diariasCarregado = true;
  if (folhaCarregada) {
    sincronizarDiaristas();
    renderizarFolha();
    atualizarHeader();
  }
  _tentarRelatorio();
});

let folhaCarregada      = false;
let folhaCriadoEm       = null;
let apenasProducao      = false; // true quando vindo do mapa (sem ajudantes)
let _saveTimer          = null;

function agendarSave() {
  clearTimeout(_saveTimer);
  if (!entradas.length) return;
  _saveTimer = setTimeout(() => salvarFolha(true, false), 1500);
}
let calAno           = new Date().getFullYear();
let calMesAtual      = new Date().getMonth();
let diasSelecionados  = new Map(); // key → 'full' | 'half'
let diasPreCarregados = new Set(); // dias já salvos na folha (exigem senha para remover)

function ehAjudante(cargo) {
  return (cargo || '').toLowerCase().includes('ajudante');
}

const MESES_CAL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW_CAL   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function abrirCalendario(func) {
  diasSelecionados  = new Map();
  diasPreCarregados = new Set();

  // Pré-carrega dias já na folha para este ajudante
  const funcKey = func.id || func.nome;
  const anoAtual = new Date().getFullYear();
  entradas.forEach(e => {
    if ((e.funcionario.id || e.funcionario.nome) !== funcKey) return;
    if (e.firestoreLocalId !== '') return;
    const meio     = e.localId.includes('½');
    const dataPart = e.localId.replace(' ½', '').trim();
    const [dia, mes] = dataPart.split('/');
    if (!dia || !mes) return;
    const key = `${anoAtual}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;
    diasSelecionados.set(key, meio ? 'half' : 'full');
    diasPreCarregados.add(key);
  });

  // Navega para o mês da primeira entrada existente, ou mês atual
  calAno      = anoAtual;
  calMesAtual = new Date().getMonth();
  if (diasSelecionados.size > 0) {
    const first = [...diasSelecionados.keys()].sort()[0];
    calMesAtual = parseInt(first.split('-')[1]) - 1;
  }

  document.getElementById('cal-func-nome').textContent = func.nome;
  renderCalendario();
  const n   = diasSelecionados.size;
  const btn = document.getElementById('btn-ok-cal');
  btn.disabled    = false;
  btn.textContent = n > 0 ? `OK (${n})` : 'OK';
  mostrarView('view-calendario');
}

function calMes(delta) {
  calMesAtual += delta;
  if (calMesAtual < 0)  { calMesAtual = 11; calAno--; }
  if (calMesAtual > 11) { calMesAtual = 0;  calAno++; }
  renderCalendario();
}

function renderCalendario() {
  document.getElementById('cal-titulo').textContent = `${MESES_CAL[calMesAtual]} ${calAno}`;
  const primeiroDia = new Date(calAno, calMesAtual, 1).getDay();
  const totalDias   = new Date(calAno, calMesAtual + 1, 0).getDate();
  const hoje        = new Date();

  let html = DOW_CAL.map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < primeiroDia; i++) html += `<div class="cal-dia vazio"></div>`;
  for (let d = 1; d <= totalDias; d++) {
    const key   = `${calAno}-${String(calMesAtual + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const state = diasSelecionados.get(key);
    const cls   = state === 'full' ? ' selecionado' : state === 'half' ? ' meio-periodo' : '';
    const isHj  = (d === hoje.getDate() && calMesAtual === hoje.getMonth() && calAno === hoje.getFullYear()) ? ' hoje' : '';
    html += `<div class="cal-dia${cls}${isHj}" onclick="toggleDia('${key}')">${d}</div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
}

function toggleDia(key) {
  const state = diasSelecionados.get(key);
  if (!state) {
    diasSelecionados.set(key, 'full');
  } else if (state === 'full') {
    diasSelecionados.set(key, 'half');
  } else {
    if (diasPreCarregados.has(key)) {
      const senha = prompt('Remover este dia da folha?\n\nDigite a senha:');
      if (senha === null) return;
      if (senha !== '3733') { alert('Senha incorreta.'); return; }
      diasPreCarregados.delete(key);
    }
    diasSelecionados.delete(key);
  }
  renderCalendario();
  const n   = diasSelecionados.size;
  const btn = document.getElementById('btn-ok-cal');
  btn.disabled    = false;
  btn.textContent = n > 0 ? `OK (${n})` : 'OK';
}

async function confirmarDias() {
  const diaria  = funcionarioAtual.salario || 0;
  const docId   = funcionarioAtual.id || funcionarioAtual.nome;
  const dias = [...diasSelecionados.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, state]) => {
      const [, mes, dia] = key.split('-');
      const meio = state === 'half';
      return { localId: `${dia}/${mes}${meio ? ' ½' : ''}`, valor: meio ? diaria / 2 : diaria };
    });

  const docRef = db.collection('diarias').doc(docId);
  if (dias.length === 0) {
    await docRef.delete().catch(() => {});
  } else {
    await docRef.set({
      funcionarioId:   funcionarioAtual.id   || '',
      funcionarioNome: funcionarioAtual.nome,
      cargo:           funcionarioAtual.cargo || '',
      diaria,
      dias
    });
  }
  mostrarView('view-folha');
}

// ── View Funcionários ──────────────────────────────────────
let _todosFunc = [];

function renderFuncionarios() {
  const lista = document.getElementById('lista-funcionarios');
  const cargosValidos = apenasProducao ? ['pintor', 'raspador'] : ['pintor', 'raspador', 'ajudante'];
  const docs = _todosFunc
    .filter(f => f.ativo !== false)
    .filter(f => cargosValidos.some(c => (f.cargo || '').toLowerCase().includes(c)));

  if (!docs.length) {
    lista.innerHTML = '<p class="vazio">Nenhum funcionário cadastrado.</p>';
    return;
  }
  lista.innerHTML = '';
  docs.forEach(func => {
    const btn = document.createElement('button');
    btn.className = 'btn-funcionario';
    btn.innerHTML = `
      <span class="func-nome">${escHtml(func.nome)}</span>
      <span class="func-cargo ${(func.cargo||'').toLowerCase()}">${escHtml(func.cargo || '')}</span>
    `;
    btn.onclick = () => selecionarFuncionario(func);
    lista.appendChild(btn);
  });
}

db.collection('funcionarios').orderBy('nome').onSnapshot(snap => {
  _todosFunc = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderFuncionarios();
});

function selecionarFuncionario(func) {
  funcionarioAtual = func;
  servicosSelecionados.clear();
  document.getElementById('func-atual').textContent = func.nome;
  atualizarBtnOk();
  if (ehAjudante(func.cargo)) {
    abrirCalendario(func);
  } else {
    mostrarView('view-mapa');
  }
}

// ── View Mapa ──────────────────────────────────────────────
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

function buildCols(wing) {
  const nums = Object.keys(wing).map(Number);
  if (!nums.length) return [];
  const maxNum  = Math.max(...nums);
  const highOdd = maxNum % 2 === 0 ? maxNum - 1 : maxNum;
  const cols = [];
  for (let odd = highOdd; odd >= 1; odd -= 2) {
    cols.push({ odd, even: odd + 1, oddLocal: wing[odd], evenLocal: wing[odd + 1] });
  }
  return cols;
}

function renderAptCell(local) {
  if (!local) return `<div class="apt-vazio"></div>`;
  locaisCache[local.id] = local;
  const numPart = local.identificacao.replace(/^[A-Z]+/, "");
  const servs   = [...(local.servicos || [])].sort((a, b) => ordemServico(a.nome) - ordemServico(b.nome));
  return `
    <div class="apt-cell">
      <div class="apt-header">Apt: ${escHtml(numPart)}</div>
      ${servs.map((s, i) => {
        const key = `${local.id}::${i}`;
        const sel = servicosSelecionados.has(key) ? ' selecionado' : '';
        const cursor = (s.status === 'concluido' || s.status === 'em_pagamento') ? ' nao-clicavel' : '';
        return `<div class="apt-serv ${s.status}${sel}${cursor}"
                     data-localid="${escHtml(local.id)}"
                     data-svidx="${i}"
                     onclick="onServicoClick(this)">${escHtml(nomeMapaServico(s))}</div>`;
      }).join("")}
    </div>`;
}

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
    document.getElementById("mapa").innerHTML = '<p class="empty">Nenhum local cadastrado.</p>';
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

db.collection("locais").orderBy("identificacao", "asc").onSnapshot(snap => {
  locaisData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render(locaisData);

  esconderLoading();
  _locaisCarregado = true;

  // ── Detecção de folha existente — roda na 1ª snapshot ──
  if (!folhaCarregada) {
    folhaCarregada = true;
    const amarelos = [];
    snap.docs.forEach(doc => {
      const local = doc.data();
      (local.servicos || []).forEach(s => {
        if (s.status === 'em_pagamento') {
          amarelos.push({
            firestoreLocalId: doc.id,
            localId:          local.identificacao,
            servico:          s.nome,
            funcionario:      s.funcionario || null,
            dataRegistro:     s.dataRegistro || null
          });
        }
      });
    });

    if (amarelos.length) {
      // 1. Monta produção
      entradas = amarelos.map(s => ({
        funcionario:      s.funcionario || { nome: '(desconhecido)', cargo: '' },
        firestoreLocalId: s.firestoreLocalId,
        localId:          s.localId,
        servico:          s.servico,
        valor:            calcValor(s.servico, (s.funcionario || {}).cargo),
        dataRegistro:     s.dataRegistro || null
      }));
      // 2. Adiciona diaristas por cima (depois da produção, para não ser sobrescrito)
      sincronizarDiaristas();
      renderizarFolha();
      atualizarHeader();
      mostrarView('view-folha');

      // Listener permanente — sincroniza em tempo real entre dispositivos
      db.collection('folhas').orderBy('criadoEm', 'desc').limit(1).onSnapshot(fSnap => {
        if (fSnap.empty) return;
        folhaAbertaId = fSnap.docs[0].id;

        const lookup = new Map();
        (fSnap.docs[0].data().grupos || []).forEach(g => {
          if (g.isEncarregado) return;
          (g.itens || []).forEach(item => {
            const entry = { fn: g.funcionario, valor: Number(item.valor), dataRegistro: item.dataRegistro || null };
            lookup.set(`${item.firestoreLocalId}:${item.servico}`,            entry);
            lookup.set(`${item.firestoreLocalId}:${nomeAbrev(item.servico)}`, entry);
          });
        });

        // Refina apenas entradas de produção (funcionário, valor, dataRegistro)
        let refinado = false;
        entradas = entradas.map(e => {
          if (!e.firestoreLocalId) return e;
          const found = lookup.get(`${e.firestoreLocalId}:${e.servico}`)
                     || lookup.get(`${e.firestoreLocalId}:${nomeAbrev(e.servico)}`);
          if (!found) return e;
          const novoFn    = found.fn ? { ...e.funcionario, cargo: found.fn.cargo || e.funcionario.cargo || '' } : e.funcionario;
          const novoValor = found.valor !== undefined ? found.valor : e.valor;
          if (novoFn !== e.funcionario || novoValor !== e.valor) refinado = true;
          return { ...e, funcionario: novoFn, valor: novoValor, dataRegistro: found.dataRegistro || e.dataRegistro || null };
        });

        if (refinado) { renderizarFolha(); atualizarHeader(); }
      });
    }
  }

  // ── Atualiza folha em tempo real se estiver visível ──
  if (entradas.length && document.getElementById('view-folha').classList.contains('ativa')) {
    const emPagamentoSet = new Set();
    snap.docs.forEach(doc => {
      (doc.data().servicos || []).forEach(s => {
        if (s.status === 'em_pagamento') {
          emPagamentoSet.add(`${doc.id}:${s.nome}`);
          emPagamentoSet.add(`${doc.id}:${nomeAbrev(s.nome)}`);
        }
      });
    });
    const antes = entradas.length;
    entradas = entradas.filter(e =>
      !e.firestoreLocalId  // preserva diárias de ajudantes (sem locais)
      || emPagamentoSet.has(`${e.firestoreLocalId}:${e.servico}`)
    );
    if (entradas.length !== antes) {
      renderizarFolha();
      atualizarHeader();
    }
  }

  _tentarRelatorio(); // chamado após entradas estar completamente populado
}, () => {
  document.getElementById("mapa").innerHTML = '<p class="empty">Erro ao conectar.</p>';
});

function onServicoClick(el) {
  const local    = locaisCache[el.dataset.localid];
  const servicos = [...(local.servicos || [])].sort((a, b) => ordemServico(a.nome) - ordemServico(b.nome));
  const servico  = servicos[parseInt(el.dataset.svidx)];
  if (servico.status === 'concluido') return;

  if (servico.status === 'em_pagamento') {
    const senha = prompt(`Remover "${nomeAbrev(servico.nome)}" do local ${local.identificacao} da folha?\n\nDigite a senha:`);
    if (senha === null) return;
    if (senha !== '3733') { alert('Senha incorreta.'); return; }
    const novosServicos = (local.servicos || []).map(s =>
      s === servico ? { ...s, status: 'pendente', funcionario: null } : s
    );
    db.collection('locais').doc(local.id).update({ servicos: novosServicos });
    entradas = entradas.filter(e =>
      !(e.firestoreLocalId === local.id && nomeAbrev(e.servico) === nomeAbrev(servico.nome))
    );
    renderizarFolha();
    atualizarHeader();
    return;
  }

  const key = `${el.dataset.localid}::${el.dataset.svidx}`;
  if (!servicosSelecionados.has(key)) {
    if (!funcionarioAtual) { apenasProducao = true; mostrarView('view-funcionarios'); return; }
    servicosSelecionados.set(key, { local, servico });
  } else {
    servicosSelecionados.delete(key);
  }

  // atualiza visual sem re-renderizar tudo
  el.classList.toggle('selecionado', servicosSelecionados.has(key));
  atualizarBtnOk();
}

function atualizarBtnOk() {
  const btn = document.getElementById('btn-ok');
  const n = servicosSelecionados.size;
  btn.textContent = n > 0 ? `OK (${n})` : 'OK';
  btn.disabled = false;
}

// ── Confirmar seleção → adiciona na folha ──────────────────
function confirmarSelecao() {
  if (!servicosSelecionados.size) { mostrarView('view-folha'); return; }

  servicosSelecionados.forEach(({ local, servico }) => {
    entradas.push({
      funcionario:      funcionarioAtual,
      firestoreLocalId: local.id,
      localId:          local.identificacao,
      servico:          servico.nome,
      valor:            calcValor(servico.nome, funcionarioAtual.cargo),
      dataRegistro:     new Date().toLocaleDateString('pt-BR')
    });
  });

  renderizarFolha();
  atualizarHeader();
  mostrarView('view-folha');
  salvarFolha(true, false); // salva ao voltar para a tela da folha
}

async function removerDiaria(idx) {
  const e = entradas[idx];
  if (!e) return;

  if (!e.firestoreLocalId) {
    // Diarista: atualiza a coleção 'diarias' (onSnapshot sincroniza entradas)
    const docId  = e.funcionario.id || e.funcionario.nome;
    const docRef = db.collection('diarias').doc(docId);
    const doc    = await docRef.get().catch(() => null);
    if (doc && doc.exists) {
      const newDias = (doc.data().dias || []).filter(d => d.localId !== e.localId);
      if (newDias.length === 0) await docRef.delete().catch(() => {});
      else await docRef.update({ dias: newDias }).catch(() => {});
    }
    return; // onSnapshot cuida de sincronizar entradas
  }

  // Produção: remove local e salva imediatamente
  entradas.splice(idx, 1);
  renderizarFolha();
  atualizarHeader();
  if (entradas.length) salvarFolha(true, false);
}

function fmtMoeda(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
}

// ── View Folha ─────────────────────────────────────────────
function renderizarFolha() {
  const hoje  = new Date().toLocaleDateString('pt-BR');
  const nServ = entradas.filter(e => e.firestoreLocalId).length; // só serviços do mapa

  // ── Bloco do encarregado (topo) ──
  let encarregadoHtml  = '';
  let valorEncarregado = 0;
  if (encarregadoCache) {
    const quinzena = (encarregadoCache.salario || 0) / 2;
    const bonus    = 5 * nServ;
    valorEncarregado = quinzena + bonus;
    encarregadoHtml = `
      <div class="grupo-func grupo-encarregado">
        <div class="grupo-header">
          <span class="grupo-nome">${escHtml(encarregadoCache.nome)}</span>
          <span class="grupo-cargo encarregado">${escHtml(encarregadoCache.cargo)}</span>
        </div>
        <table class="folha-tabela">
          <thead><tr><th colspan="2">Descrição</th><th>Valor</th></tr></thead>
          <tbody>
            <tr><td colspan="2">Quinzena (50% do salário)</td><td class="td-valor">${fmtMoeda(quinzena)}</td></tr>
            <tr><td colspan="2">${nServ} serviço${nServ !== 1 ? 's' : ''} × R$ 5,00</td><td class="td-valor">${fmtMoeda(bonus)}</td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="td-sub-label">Subtotal</td>
              <td class="td-sub-valor">${fmtMoeda(valorEncarregado)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  // ── Grupos de produção ──
  const grupos = new Map();
  entradas.forEach((e, idx) => {
    const key = e.funcionario.id || e.funcionario.nome;
    if (!grupos.has(key)) grupos.set(key, { funcionario: e.funcionario, itens: [] });
    grupos.get(key).itens.push({ ...e, _idx: idx });
  });

  const totalProducao = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const totalGeral    = totalProducao + valorEncarregado;

  const gruposHtml = [...grupos.values()].map(g => {
    const isAjud   = ehAjudante(g.funcionario.cargo);
    const subtotal = g.itens.reduce((acc, e) => acc + Number(e.valor), 0);
    const linhas   = g.itens.map(e => isAjud ? `
      <tr>
        <td>${escHtml(e.localId)}</td>
        <td>${escHtml(e.servico)}</td>
        <td class="td-valor">${fmtMoeda(e.valor)}</td>
        <td class="td-del"><button class="btn-del-dia" onclick="removerDiaria(${e._idx})">✕</button></td>
      </tr>` : `
      <tr>
        <td>${escHtml(e.localId)}</td>
        <td>${escHtml(nomeExibicaoServico(e.servico))}</td>
        <td style="font-size:0.75rem;color:#888">${escHtml(e.dataRegistro || '—')}</td>
        <td class="td-valor">${fmtMoeda(e.valor)}</td>
      </tr>`).join('');

    const thead = isAjud
      ? `<tr><th>Data</th><th>Diária</th><th>Valor</th><th></th></tr>`
      : `<tr><th>Local</th><th>Serviço</th><th>Registro</th><th>Valor</th></tr>`;
    const tfoot = isAjud
      ? `<tr><td colspan="3" class="td-sub-label">Subtotal</td><td class="td-sub-valor">${fmtMoeda(subtotal)}</td></tr>`
      : `<tr><td colspan="3" class="td-sub-label">Subtotal</td><td class="td-sub-valor">${fmtMoeda(subtotal)}</td></tr>`;

    return `
      <div class="grupo-func">
        <div class="grupo-header">
          <span class="grupo-nome">${escHtml(g.funcionario.nome)}</span>
          <span class="grupo-cargo ${(g.funcionario.cargo||'').toLowerCase()}">${escHtml(g.funcionario.cargo||'')}</span>
        </div>
        <table class="folha-tabela">
          <thead>${thead}</thead>
          <tbody>${linhas}</tbody>
          <tfoot>${tfoot}</tfoot>
        </table>
      </div>`;
  }).join('');

  document.getElementById('folha-documento').innerHTML = `
    <div class="folha-paper">
      <div class="folha-titulo">FOLHA DE PAGAMENTO DA PRODUÇÃO</div>
      <div class="folha-data">Emitida em ${hoje}</div>
      ${encarregadoHtml}
      ${gruposHtml}
      <div class="total-geral">
        <span>TOTAL GERAL</span>
        <span>${fmtMoeda(totalGeral)}</span>
      </div>
    </div>
  `;
}

function atualizarHeader() {
  const barra = document.getElementById('barra-funcionarios');
  if (barra) barra.style.display = entradas.length ? 'flex' : 'none';
  const el = document.getElementById('total-header');
  if (!entradas.length) { el.textContent = ''; return; }
  const totalProd = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const nServHeader = entradas.filter(e => e.firestoreLocalId).length;
  const totalEnc  = encarregadoCache
    ? ((encarregadoCache.salario || 0) / 2) + (5 * nServHeader)
    : 0;
  const total = totalProd + totalEnc;
  el.textContent = `${entradas.length} item${entradas.length > 1 ? 's' : ''} · R$ ${total.toFixed(2)}`;
}

function imprimirFolha() {
  if (!entradas.length) { alert('Adicione pelo menos um item antes de imprimir.'); return; }
  renderizarFolha();
  mostrarView('view-folha');
  setTimeout(() => window.print(), 200);
}

// ── Salva folha no Firestore (chamado no OK do mapa/calendário e no botão) ──
async function salvarFolha(silencioso = false, completarAjudantes = true) {
  if (!entradas.length && completarAjudantes) return null;

  const btnFechar = document.querySelector('.btn-fechar-folha');
  if (!silencioso && btnFechar) { btnFechar.disabled = true; btnFechar.textContent = 'Salvando...'; }

  // Completa diárias de ajudantes que ainda não foram carregadas pelo fetch em background
  // (não rodar quando chamado de confirmarDias/confirmarSelecao, pois entradas já estão corretas)
  if (completarAjudantes && folhaAbertaId) {
    try {
      const fDoc = await db.collection('folhas').doc(folhaAbertaId).get();
      if (fDoc.exists) {
        if (fDoc.data().criadoEm && !folhaCriadoEm) folhaCriadoEm = fDoc.data().criadoEm;
        const ajudantesJaCarregados = new Set(
          entradas.filter(e => !e.firestoreLocalId).map(e => e.funcionario.id || e.funcionario.nome)
        );
        (fDoc.data().grupos || []).forEach(g => {
          if (g.isEncarregado || !ehAjudante(g.funcionario.cargo)) return;
          const key = g.funcionario.id || g.funcionario.nome;
          if (ajudantesJaCarregados.has(key)) return;
          (g.itens || []).forEach(item => {
            if (item.firestoreLocalId) return;
            entradas.push({ funcionario: g.funcionario, firestoreLocalId: '', localId: item.localId, servico: item.servico, valor: Number(item.valor) });
          });
        });
      }
    } catch(e) {}
  }

  const grupos = new Map();
  entradas.forEach(e => {
    const key = e.funcionario.id || e.funcionario.nome;
    if (!grupos.has(key)) grupos.set(key, { funcionario: e.funcionario, itens: [] });
    grupos.get(key).itens.push(e);
  });

  const nServMapa        = entradas.filter(e => e.firestoreLocalId).length;
  const totalProducao    = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const valorEncarregado = encarregadoCache
    ? ((encarregadoCache.salario || 0) / 2) + (5 * nServMapa) : 0;
  const totalGeral = totalProducao + valorEncarregado;

  const gruposProducao = [...grupos.values()].map(g => ({
    funcionario: { id: g.funcionario.id || '', nome: g.funcionario.nome, cargo: g.funcionario.cargo || '' },
    subtotal:    g.itens.reduce((acc, e) => acc + Number(e.valor), 0),
    itens:       g.itens.map(e => ({ firestoreLocalId: e.firestoreLocalId || '', localId: e.localId, servico: e.servico, valor: Number(e.valor), dataRegistro: e.dataRegistro || null }))
  }));

  const grupoEncarregado = encarregadoCache ? [{
    isEncarregado: true,
    funcionario: { id: encarregadoCache.id, nome: encarregadoCache.nome, cargo: encarregadoCache.cargo || '' },
    subtotal: valorEncarregado,
    itens: [
      { firestoreLocalId: '', localId: '—', servico: 'Quinzena 50%',            valor: (encarregadoCache.salario || 0) / 2 },
      { firestoreLocalId: '', localId: '—', servico: `${nServMapa} serv × R$5`, valor: 5 * nServMapa }
    ]
  }] : [];

  const folhaDoc = {
    data: new Date().toLocaleDateString('pt-BR'),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    status: 'fechada', totalGeral,
    grupos: [...grupoEncarregado, ...gruposProducao]
  };

  const locaisParaAtualizar = new Map();
  entradas.forEach(e => {
    if (!locaisParaAtualizar.has(e.firestoreLocalId)) locaisParaAtualizar.set(e.firestoreLocalId, new Map());
    locaisParaAtualizar.get(e.firestoreLocalId).set(e.servico, { funcionario: e.funcionario, dataRegistro: e.dataRegistro });
  });

  const batch = db.batch();
  const folhaRef = folhaAbertaId ? db.collection('folhas').doc(folhaAbertaId) : db.collection('folhas').doc();
  batch.set(folhaRef, folhaDoc);

  locaisParaAtualizar.forEach((servicoFuncMap, firestoreId) => {
    const local = locaisCache[firestoreId];
    if (!local) return;
    const novosServicos = (local.servicos || []).map(s => {
      if (!servicoFuncMap.has(s.nome)) return s;
      const entry = servicoFuncMap.get(s.nome);
      const func  = entry.funcionario;
      return { ...s, status: 'em_pagamento',
        funcionario:  { id: func.id || '', nome: func.nome, cargo: func.cargo || '' },
        dataRegistro: entry.dataRegistro || s.dataRegistro || new Date().toLocaleDateString('pt-BR')
      };
    });
    batch.update(db.collection('locais').doc(firestoreId), { servicos: novosServicos });
  });

  try {
    await batch.commit();
    folhaAbertaId = folhaRef.id;
    if (!silencioso && btnFechar) { btnFechar.disabled = false; btnFechar.textContent = 'Relatório/Resumo'; }
    return { grupos, nServMapa, totalGeral, valorEncarregado };
  } catch(e) {
    if (!silencioso && btnFechar) { btnFechar.disabled = false; btnFechar.textContent = 'Relatório/Resumo'; }
    if (!silencioso) alert('Erro ao salvar. Tente novamente.');
    return null;
  }
}

// ── Botão Relatório/Resumo → salva + mostra comprovante ───────────────────
async function fecharFolha() {
  if (!entradas.length) return;

  const resultado = await salvarFolha(false);
  if (!resultado) return;

  const { grupos, nServMapa, totalGeral, valorEncarregado } = resultado;

  const pagamentos = [];
  const gruposData = [];
  if (encarregadoCache) {
    pagamentos.push({ nome: encarregadoCache.nome, cargo: encarregadoCache.cargo || 'encarregado', valor: valorEncarregado });
  }
  [...grupos.values()].forEach(g => {
    const subtotal = g.itens.reduce((a, e) => a + Number(e.valor), 0);
    pagamentos.push({ nome: g.funcionario.nome, cargo: g.funcionario.cargo || '', valor: subtotal });
    gruposData.push({ funcionario: g.funcionario, itens: g.itens });
  });

  const adiantamentosMap = new Map();
  try {
    const adSnap = await db.collection('lancamentos').get();
    adSnap.docs.forEach(d => {
      const r = d.data();
      if ((r.origem || '') !== 'ANE->ADIANTAMENTO') return;
      const desc = r.descricao || '';
      if (!desc.startsWith('Adiantamento: ')) return;
      const nome = desc.slice('Adiantamento: '.length).split(/\s*[—–\-]/)[0].trim().normalize('NFC');
      if (!nome) return;
      adiantamentosMap.set(nome, (adiantamentosMap.get(nome) || 0) + (r.saida || 0));
    });
  } catch(e) {}

  entradas = [];
  // Limpa diaristas do Firestore junto com o fechamento da folha
  db.collection('diarias').get().then(snap => {
    snap.docs.forEach(d => d.ref.delete());
  }).catch(() => {});
  atualizarHeader();
  mostrarComprovante(gruposData, encarregadoCache, valorEncarregado, nServMapa, totalGeral, pagamentos, adiantamentosMap);
}

function mostrarComprovante(gruposData, encData, valorEnc, nServ, totalGeral, pagamentos, adiantamentosMap = new Map()) {

  const hoje = new Date().toLocaleDateString('pt-BR');

  let totalDeducoes = 0;

  let encHtml = '';
  if (encData) {
    const quinzena  = (encData.salario || 0) / 2;
    const bonus     = 5 * nServ;
    const adiantEnc = adiantamentosMap.get((encData.nome || '').normalize('NFC')) || 0;
    const liquidoEnc = valorEnc - adiantEnc;
    if (adiantEnc > 0) totalDeducoes += adiantEnc;
    const adiantEncHtml = adiantEnc > 0 ? `
      <div class="cp-item" style="color:#ef9a9a">
        <span>(-) Adiantamento</span>
        <span>- ${fmtMoeda(adiantEnc)}</span>
      </div>` : '';
    encHtml = `
      <div class="cp-grupo cp-enc">
        <div class="cp-func">${escHtml(encData.nome)} <span class="cp-cargo">encarregado</span></div>
        <div class="cp-item"><span>Quinzena 50%</span><span>${fmtMoeda(quinzena)}</span></div>
        <div class="cp-item"><span>${nServ} serv × R$5</span><span>${fmtMoeda(bonus)}</span></div>
        ${adiantEncHtml}
        <div class="cp-sub"><span>Subtotal</span><span>${fmtMoeda(adiantEnc > 0 ? liquidoEnc : valorEnc)}</span></div>
      </div>`;
  }
  const gruposHtml = gruposData.map(g => {
    const sub    = g.itens.reduce((a, e) => a + Number(e.valor), 0);
    const adiant = adiantamentosMap.get((g.funcionario.nome || '').normalize('NFC')) || 0;
    const liquido = sub - adiant;
    if (adiant > 0) totalDeducoes += adiant;
    const isAjud = ehAjudante(g.funcionario.cargo);
    const itens  = g.itens.map(e => `
      <div class="cp-item">
        <span>${escHtml(e.localId)} · ${escHtml(isAjud ? e.servico : nomeExibicaoServico(e.servico))}${!isAjud && e.dataRegistro ? `<span style="color:#4a8a5a;font-size:0.65rem;margin-left:4px">${escHtml(e.dataRegistro)}</span>` : ''}</span>
        <span>${fmtMoeda(e.valor)}</span>
      </div>`).join('');
    const adiantHtml = adiant > 0 ? `
      <div class="cp-item" style="color:#ef9a9a">
        <span>(-) Adiantamento</span>
        <span>- ${fmtMoeda(adiant)}</span>
      </div>` : '';
    return `
      <div class="cp-grupo">
        <div class="cp-func">${escHtml(g.funcionario.nome)} <span class="cp-cargo">${escHtml(g.funcionario.cargo||'')}</span></div>
        ${itens}
        ${adiantHtml}
        <div class="cp-sub"><span>Subtotal</span><span>${fmtMoeda(adiant > 0 ? liquido : sub)}</span></div>
      </div>`;
  }).join('');

  const totalLiquido = totalGeral - totalDeducoes;

  // Ajusta pagamentos para tela de sucesso (desconta adiantamentos por funcionário)
  const pagamentosAjustados = pagamentos.map(p => ({
    ...p,
    valor: p.valor - (adiantamentosMap.get((p.nome || '').normalize('NFC')) || 0)
  }));

  window._sucPag   = pagamentosAjustados;
  window._sucTotal = totalLiquido;

  document.body.innerHTML = `
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{height:100%;height:100dvh}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      .cp-wrap{display:flex;flex-direction:column;height:100dvh;background:#0d1f14;color:#c8e6c9;font-size:0.66rem;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}
      .cp-header{background:linear-gradient(160deg,#1e4d2e 0%,#1a3322 100%);padding:10px 12px 8px;flex-shrink:0;border-bottom:1px solid rgba(165,214,167,0.15)}
      .cp-title{font-size:0.75rem;font-weight:900;letter-spacing:1.5px;color:#a5d6a7}
      .cp-meta{font-size:0.58rem;color:#4a8a5a;margin-top:2px;display:flex;justify-content:space-between}
      .cp-body{flex:1;overflow-y:auto;padding:7px 10px}
      .cp-grupo{border:1px solid rgba(165,214,167,0.12);border-radius:5px;margin-bottom:6px;overflow:hidden}
      .cp-enc{border-color:rgba(165,214,167,0.28)}
      .cp-func{background:rgba(165,214,167,0.08);padding:4px 8px;font-weight:700;color:#a5d6a7;font-size:0.68rem}
      .cp-cargo{font-size:0.56rem;font-weight:400;color:#4a8a5a;text-transform:capitalize;margin-left:5px}
      .cp-item{display:flex;justify-content:space-between;padding:3px 8px;border-top:1px solid rgba(165,214,167,0.06);color:#66bb6a}
      .cp-sub{display:flex;justify-content:space-between;padding:4px 8px;border-top:1px solid rgba(165,214,167,0.18);font-weight:700;color:#a5d6a7}
      .cp-footer{background:#0d1f14;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(165,214,167,0.2);flex-shrink:0}
      .cp-total-l{font-size:0.68rem;font-weight:700;letter-spacing:1px;color:#66bb6a}
      .cp-total-v{font-size:1rem;font-weight:900;color:#a5d6a7}
    </style>
    <div class="cp-wrap" onclick="mostrarSucesso(window._sucPag,window._sucTotal)">
      <div class="cp-header">
        <div class="cp-title">FOLHA DE PAGAMENTO DA PRODUÇÃO</div>
        <div class="cp-meta">
          <span>Emitida em ${hoje} · v${VERSAO}</span>
          <span>toque para continuar →</span>
        </div>
      </div>
      <div class="cp-body">
        ${encHtml}
        ${gruposHtml}
      </div>
      <div class="cp-footer">
        <span class="cp-total-l">TOTAL GERAL</span>
        <span class="cp-total-v">${fmtMoeda(totalLiquido)}</span>
      </div>
    </div>`;

  // Auto-escala para caber tudo em uma tela (iOS não permite zoom out manual)
  setTimeout(() => {
    const wrap   = document.querySelector('.cp-wrap');
    const cpBody = document.querySelector('.cp-body');
    if (!wrap) return;
    if (cpBody) { cpBody.style.overflow = 'visible'; cpBody.style.flex = 'none'; }
    wrap.style.height   = 'auto';
    wrap.style.overflow = 'visible';
    const totalH = wrap.scrollHeight;
    const viewH  = window.innerHeight;
    const viewW  = window.innerWidth;
    if (totalH > viewH * 0.98) {
      const scale = viewH / totalH;
      wrap.style.transform       = `scale(${scale.toFixed(4)})`;
      wrap.style.transformOrigin = 'top left';
      wrap.style.width           = `${Math.ceil(viewW / scale)}px`;
      wrap.style.height          = `${totalH}px`;
    }
    document.body.style.overflow = 'hidden';
    document.body.style.height   = `${viewH}px`;
  }, 150);
}

function mostrarSucesso(pagamentos, totalGeral) {
  const linhas = pagamentos.map(p => `
    <div style="display:flex;align-items:center;padding:7px 14px;border-bottom:1px solid rgba(165,214,167,0.1);">
      <div style="flex:1;min-width:0;">
        <span style="font-weight:700;font-size:0.78rem;color:#e8f5e9;">${escHtml(p.nome)}</span>
        <span style="font-size:0.62rem;color:#4a8a5a;margin-left:6px;text-transform:capitalize;">${escHtml(p.cargo)}</span>
      </div>
      <span style="font-size:0.82rem;font-weight:800;color:#a5d6a7;white-space:nowrap;">${fmtMoeda(p.valor)}</span>
    </div>`).join('');

  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100dvh;background:#0d1f14;color:#e8f5e9;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;">

      <div style="display:flex;align-items:center;gap:12px;padding:calc(env(safe-area-inset-top, 0px) + 14px) 16px 14px;
                  background:linear-gradient(160deg,#1e4d2e 0%,#1a3322 100%);flex-shrink:0;">
        <a href="https://sistema.gwrevestimentos.com.br/index.html" style="line-height:0;flex-shrink:0;">
          <img src="./Logo-gw.png" style="width:54px;height:54px;object-fit:contain;" />
        </a>
        <span style="font-size:0.95rem;font-weight:800;color:#c8e6c9;letter-spacing:0.5px;">Previsão da Folha de Pagamento</span>
      </div>

      <div style="padding:5px 0 0;background:#1a3322;flex-shrink:0;">
        <div style="padding:4px 14px;font-size:0.57rem;letter-spacing:1.5px;color:#4a8a5a;font-weight:700;">
          RESUMO DE PAGAMENTOS
        </div>
      </div>

      <div style="flex:1;overflow-y:auto;background:#1a3322;">
        ${linhas}
      </div>

      <div style="background:#0d1f14;padding:13px 16px;display:flex;justify-content:space-between;
                  align-items:center;border-top:1px solid rgba(165,214,167,0.2);flex-shrink:0;">
        <span style="font-size:0.72rem;font-weight:700;letter-spacing:1.5px;color:#66bb6a;">TOTAL GERAL</span>
        <span style="font-size:1.15rem;font-weight:900;color:#a5d6a7;">${fmtMoeda(totalGeral)}</span>
      </div>
    </div>`;
  setTimeout(() => window.close(), 6000);
}

// ── Ver relatório (link direto #relatorio) ────────────────────────────────
// Usa dados ao vivo de entradas (locais + diarias). Se não há folha aberta,
// cai para o último documento salvo em 'folhas'.
async function verRelatorio() {
  let gruposData, nServMapa, totalGeral, valorEncarregado;

  const temProducao  = entradas.some(e => e.firestoreLocalId);
  const temDiaristas = _diariasCache.length > 0;

  if (temProducao || temDiaristas) {
    // Folha aberta — lê produção de entradas e diaristas de _diariasCache diretamente
    const grupos = new Map();

    // Produção (entradas com firestoreLocalId)
    entradas.filter(e => e.firestoreLocalId).forEach(e => {
      const key = e.funcionario.id || e.funcionario.nome;
      if (!grupos.has(key)) grupos.set(key, { funcionario: e.funcionario, itens: [] });
      grupos.get(key).itens.push(e);
    });

    // Diaristas (diretamente de _diariasCache — sem depender do timing de sincronizarDiaristas)
    _diariasCache.forEach(doc => {
      const func = { id: doc.funcionarioId || '', nome: doc.funcionarioNome, cargo: doc.cargo || '' };
      const key  = doc.funcionarioId || doc.funcionarioNome;
      if (!grupos.has(key)) grupos.set(key, { funcionario: func, itens: [] });
      (doc.dias || []).forEach(d => {
        grupos.get(key).itens.push({
          funcionario: func, firestoreLocalId: '', localId: d.localId, servico: 'Diária', valor: d.valor
        });
      });
    });

    nServMapa        = entradas.filter(e => e.firestoreLocalId).length;
    const totalProd  = [...grupos.values()].reduce((acc, g) => acc + g.itens.reduce((s, e) => s + Number(e.valor), 0), 0);
    valorEncarregado = encarregadoCache
      ? ((encarregadoCache.salario || 0) / 2) + (5 * nServMapa) : 0;
    totalGeral       = totalProd + valorEncarregado;
    gruposData       = [...grupos.values()].map(g => ({ funcionario: g.funcionario, itens: g.itens }));
  } else {
    // Sem folha aberta — lê o último documento salvo
    try {
      const fSnap = await db.collection('folhas').orderBy('criadoEm', 'desc').limit(1).get();
      if (fSnap.empty) { alert('Nenhuma folha encontrada.'); return; }
      const folha   = fSnap.docs[0].data();
      const gList   = folha.grupos || [];
      const grupoEnc = gList.find(g => g.isEncarregado);
      valorEncarregado = grupoEnc ? (grupoEnc.subtotal || 0) : 0;
      nServMapa = grupoEnc
        ? Math.round(((grupoEnc.itens || []).find(i => (i.servico || '').includes('serv')) || {}).valor / 5 || 0) : 0;
      totalGeral = folha.totalGeral || 0;
      gruposData = gList.filter(g => !g.isEncarregado).map(g => ({ funcionario: g.funcionario, itens: g.itens || [] }));
    } catch(e) { alert('Erro ao carregar relatório.'); return; }
  }

  const pagamentos = [];
  if (encarregadoCache) pagamentos.push({ nome: encarregadoCache.nome, cargo: encarregadoCache.cargo || 'encarregado', valor: valorEncarregado });
  gruposData.forEach(g => {
    const sub = g.itens.reduce((a, e) => a + Number(e.valor), 0);
    pagamentos.push({ nome: g.funcionario.nome, cargo: g.funcionario.cargo || '', valor: sub });
  });

  const adiantamentosMap = new Map();
  try {
    const adSnap = await db.collection('lancamentos').get();
    adSnap.docs.forEach(d => {
      const r = d.data();
      if ((r.origem || '') !== 'ANE->ADIANTAMENTO') return;
      const desc = r.descricao || '';
      if (!desc.startsWith('Adiantamento: ')) return;
      const nome = desc.slice('Adiantamento: '.length).split(/\s*[—–\-]/)[0].trim().normalize('NFC');
      if (!nome) return;
      adiantamentosMap.set(nome, (adiantamentosMap.get(nome) || 0) + (r.saida || 0));
    });
  } catch(e) {}

  mostrarComprovante(gruposData, encarregadoCache, valorEncarregado, nServMapa, totalGeral, pagamentos, adiantamentosMap);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  // Recarrega uma vez quando novo SW assume o controle (nova versão instalada)
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}
