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

const VERSAO = "4.97";
const VALOR_HORA_PINTOR = 10.94;
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

// Se demorar demais, oferece um botão para recarregar (2ª carga costuma ser bem mais rápida)
let _loBtnTimer = setTimeout(() => {
  const btn = document.getElementById('lo-reload');
  if (btn) btn.style.display = 'inline-block';
}, 7000);

function esconderLoading() {
  clearInterval(_loTimer);
  clearTimeout(_loBtnTimer);
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
let _pendingClick        = null; // serviço clicado antes de ter funcionário

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

// Diária de sábado/domingo ganha um rótulo específico no relatório
// (sábado é a diária normal do dia; domingo é o repouso semanal remunerado).
function diaSemanaDoLocalId(localId) {
  const dataPart = (localId || '').replace(' ½', '').trim();
  const [dia, mes] = dataPart.split('/').map(Number);
  if (!dia || !mes) return null;
  return new Date(new Date().getFullYear(), mes - 1, dia).getDay(); // 0=domingo, 6=sábado
}

function labelDiaria(d) {
  if (d.horas) return `Diária (${d.horas}h)`;
  const diaSemana = diaSemanaDoLocalId(d.localId);
  if (diaSemana === 6) return 'Sábado';
  if (diaSemana === 0) return 'Repouso Remunerado';
  return 'Diária';
}

function sincronizarDiaristas() {
  entradas = entradas.filter(e => e.firestoreLocalId);
  _diariasCache.forEach(doc => {
    (doc.dias || []).forEach(d => {
      entradas.push({
        funcionario:      { id: doc.funcionarioId || '', nome: doc.funcionarioNome, cargo: doc.cargo || '' },
        firestoreLocalId: '',
        localId:          d.localId,
        servico:          labelDiaria(d),
        valor:            d.valor,
        horas:            d.horas || null
      });
    });
  });
  filtrarProducaoConflitanteComDiaria();
  filtrarDiariaConflitanteComProducaoPintor();
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
let diasSelecionados  = new Map(); // key → 'full' | 'half' (ajudante) ou número de horas (pintor)
let diasPreCarregados = new Set(); // dias já salvos na folha (exigem senha para remover)
let modoDiariaHoras   = false; // true quando o calendário está sendo usado por um pintor em modo Diária

function ehAjudante(cargo) {
  return (cargo || '').toLowerCase().includes('ajudante');
}

// Um funcionário com cargo Ajudante pode ser marcado no cadastro com dois
// campos independentes: porProducao (remunerado igual Pintor/Raspador) e
// porDiaria (remunerado por diária, o padrão). Um ajudante pode ter os
// dois marcados ao mesmo tempo — nesse caso ele deve poder escolher, ao
// ser selecionado na Folha, se o lançamento é de Diária ou de Produção
// (ver escolherTipoAjudanteAmbos). cargo continua "Ajudante" nos dois
// casos (é o cargo de verdade dele), só a forma de pagamento muda.
//
// Cadastro antigo (sem o campo porDiaria, de antes dele existir) precisa
// do MESMO default de sempre pra não regredir: antes, porDiaria não
// existia e a regra era simplesmente "ajudante sem porProducao = diária".
// Se porDiaria estiver ausente, replica essa regra antiga em vez de
// assumir true sempre — senão um ajudante já marcado como porProducao
// (ex: Leonardo Ferreira) passa a sincronizar diária do ponto sem nunca
// ter sido configurado assim, e a regra "diária prevalece no mesmo dia"
// zera a produção dele.
function porDiariaEfetivo(func) {
  if (!func) return true;
  if (func.porDiaria !== undefined) return func.porDiaria !== false;
  return !func.porProducao;
}
function ehAjudanteDiaria(func) {
  return ehAjudante(func && func.cargo) && porDiariaEfetivo(func);
}
function ehAjudanteProducao(func) {
  return ehAjudante(func && func.cargo) && !!(func && func.porProducao);
}

// Para ajudante, se no mesmo dia houver diária e produção, a diária prevalece:
// o valor da produção daquele dia é zerado (não soma no total), mas o serviço
// continua aparecendo na folha (com valor R$ 0,00) para efeito de registro.
function filtrarProducaoConflitanteComDiaria() {
  const diasComDiaria = new Set();
  entradas.forEach(e => {
    if (e.firestoreLocalId) return; // só diárias
    const diaMes = (e.localId || '').replace(' ½', '').trim();
    if (!diaMes) return;
    diasComDiaria.add(`${e.funcionario.id || e.funcionario.nome}|${diaMes}`);
  });
  entradas = entradas.map(e => {
    if (!e.firestoreLocalId) return e; // mantém diárias
    if (!ehAjudante(e.funcionario.cargo)) return e; // regra é só para ajudante
    if (!e.dataRegistro) return e;
    const diaMes = e.dataRegistro.split('/').slice(0, 2).join('/');
    if (!diasComDiaria.has(`${e.funcionario.id || e.funcionario.nome}|${diaMes}`)) return e;
    return { ...e, valor: 0 };
  });
}

function ehPintorOuRaspador(cargo) {
  const c = (cargo || '').toLowerCase();
  return c.includes('pintor') || c.includes('raspador');
}

// Para Pintor/Raspador é o oposto do ajudante: se no mesmo dia houver
// diária e produção, a PRODUÇÃO prevalece (é o valor medido/preciso do
// serviço) e a diária daquele dia é zerada — exceto sábado ou domingo em
// que ele já tem a semana inteira (segunda a sexta) de diária completa:
// nesse caso a diária de fim de semana é um bônus que ele já garantiu e
// mantém mesmo trabalhando produção nesse dia.
function filtrarDiariaConflitanteComProducaoPintor() {
  const diasComProducao = new Set();
  entradas.forEach(e => {
    if (!e.firestoreLocalId) return; // só produção
    if (!ehPintorOuRaspador(e.funcionario.cargo)) return;
    if (!e.dataRegistro) return;
    const diaMes = e.dataRegistro.split('/').slice(0, 2).join('/');
    diasComProducao.add(`${e.funcionario.id || e.funcionario.nome}|${diaMes}`);
  });

  const diasDiariaPorFunc = new Map();
  entradas.forEach(e => {
    if (e.firestoreLocalId) return;
    if (!ehPintorOuRaspador(e.funcionario.cargo)) return;
    const diaMes = (e.localId || '').replace(' ½', '').trim();
    if (!diaMes) return;
    const key = e.funcionario.id || e.funcionario.nome;
    if (!diasDiariaPorFunc.has(key)) diasDiariaPorFunc.set(key, new Set());
    diasDiariaPorFunc.get(key).add(diaMes);
  });

  function semanaSegASextaCompleta(key, dia, mes) {
    const ano = new Date().getFullYear();
    const data = new Date(ano, mes - 1, dia);
    const diaSemana = data.getDay(); // 0=domingo, 6=sábado
    const deltaSegunda = diaSemana === 0 ? -6 : -(diaSemana - 1);
    const dias = diasDiariaPorFunc.get(key) || new Set();
    for (let i = 0; i < 5; i++) {
      const d = new Date(data);
      d.setDate(d.getDate() + deltaSegunda + i);
      const dm = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!dias.has(dm)) return false;
    }
    return true;
  }

  entradas = entradas.map(e => {
    if (e.firestoreLocalId) return e; // mantém produção
    if (!ehPintorOuRaspador(e.funcionario.cargo)) return e; // regra é só para Pintor/Raspador
    const diaMes = (e.localId || '').replace(' ½', '').trim();
    if (!diaMes) return e;
    const key = e.funcionario.id || e.funcionario.nome;
    if (!diasComProducao.has(`${key}|${diaMes}`)) return e; // sem conflito nesse dia
    const [dia, mes] = diaMes.split('/').map(Number);
    if (!dia || !mes) return e;
    const diaSemana = new Date(new Date().getFullYear(), mes - 1, dia).getDay();
    if ((diaSemana === 0 || diaSemana === 6) && semanaSegASextaCompleta(key, dia, mes)) {
      return e; // bônus de fim de semana já garantido, mantém mesmo com produção
    }
    return { ...e, valor: 0 };
  });
}

// ── Sincroniza diárias de ajudantes a partir do ponto (quinzena atual) ──────
// Regras:
// - Conta como "diária trabalhada" qualquer dia da quinzena em que o ajudante
//   tenha ENTRADA e SAÍDA registradas no ponto (horários são ignorados).
// - Bônus semanal: numa segunda-feira, olhando a semana passada (seg a sáb):
//   • se trabalhou o sábado e teve >=5 diárias na semana → domingo = 2 diárias
//   • se NÃO trabalhou o sábado mas seg-sex está completo (5/5) → sábado e
//     domingo = 1 diária cada
// Roda toda vez que a página é aberta; só ADICIONA dias que ainda não existem
// na coleção 'diarias' (não mexe em dias já lançados manualmente).
async function sincronizarDiariasAjudantesPorPonto() {
  try {
    const hoje = new Date();
    const ano = hoje.getFullYear(), mes = hoje.getMonth();
    const quinzenaInicio = new Date(ano, mes, hoje.getDate() <= 15 ? 1 : 16);
    const quinzenaFim    = hoje.getDate() <= 15 ? new Date(ano, mes, 15) : new Date(ano, mes + 1, 0);

    // Se alguma folha PAGA cobre esta quinzena, ela já foi fechada — não
    // recria as diárias que o fechamento zerou de propósito. Checa TODAS as
    // folhas pagas (não só "a mais recente por criadoEm"): assim que uma
    // folha nova (ainda sem status paga) é criada — mesmo sem querer, só de
    // abrir a tela — ela passa a ser "a mais recente", e checar só essa
    // escondia o fechamento anterior, recriando dias já pagos (bug real,
    // já causou diária duplicada em 2026-08-15).
    const pagasSnap = await db.collection('folhas').where('status', '==', 'paga').get();
    const jaFechouEssaQuinzena = pagasSnap.docs.some(doc => {
      const p = doc.data();
      const dt = p.pagaEm || p.criadoEm;
      if (!dt) return false;
      const dtPagamento = dt.toDate();
      return dtPagamento >= quinzenaInicio && dtPagamento <= quinzenaFim;
    });
    if (jaFechouEssaQuinzena) return;

    // Margem generosa: mesmo que a quinzena comece no meio da semana (ex:
    // quarta), garante que segunda/terça daquela semana — que podem cair na
    // quinzena/mês anterior — sejam buscadas para decidir corretamente o
    // bônus de domingo (só corta o domingo com falta real seg-sex).
    const janelaInicio = new Date(quinzenaInicio);
    janelaInicio.setDate(janelaInicio.getDate() - 14);
    const janelaFimExclusiva = new Date(quinzenaFim);
    janelaFimExclusiva.setDate(janelaFimExclusiva.getDate() + 1);

    const [snapPontos, snapFunc] = await Promise.all([
      db.collection('pontos')
        .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(janelaInicio))
        .where('timestamp', '<',  firebase.firestore.Timestamp.fromDate(janelaFimExclusiva))
        .get(),
      db.collection('funcionarios').get()
    ]);

    const ajudantes = snapFunc.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(f => f.ativo !== false && ehAjudanteDiaria(f));
    if (!ajudantes.length) return;

    // funcionarioId -> Map(diaKey -> { entrada, saida })
    const registrosPorFunc = new Map();
    snapPontos.docs.forEach(doc => {
      const d = doc.data();
      if (!d.funcionarioId || !d.timestamp || !d.tipo) return;
      const dt = d.timestamp.toDate();
      const diaKey = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      if (!registrosPorFunc.has(d.funcionarioId)) registrosPorFunc.set(d.funcionarioId, new Map());
      const dias = registrosPorFunc.get(d.funcionarioId);
      if (!dias.has(diaKey)) dias.set(diaKey, { entrada: false, saida: false });
      const info = dias.get(diaKey);
      if (d.tipo === 'entrada') info.entrada = true;
      if (d.tipo === 'saida')   info.saida   = true;
    });

    function trabalhou(funcionarioId, date) {
      const dias = registrosPorFunc.get(funcionarioId);
      if (!dias) return false;
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const info = dias.get(key);
      return !!(info && info.entrada && info.saida);
    }

    function diasNoMes(a, m) { return new Date(a, m + 1, 0).getDate(); }
    function valorDiaria(func, date) { return (func.salario || 0) / diasNoMes(date.getFullYear(), date.getMonth()); }
    function fmtDiaMes(date) { return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`; }

    for (const func of ajudantes) {
      const novosDias = new Map(); // localId ('dd/mm') → valor

      // 1. Dias da quinzena com entrada+saída no ponto
      for (let d = new Date(quinzenaInicio); d <= quinzenaFim; d.setDate(d.getDate() + 1)) {
        if (trabalhou(func.id, d)) novosDias.set(fmtDiaMes(d), valorDiaria(func, d));
      }

      // 2. Bônus semanal — avaliado em cada segunda-feira dentro da quinzena
      for (let d = new Date(quinzenaInicio); d <= quinzenaFim; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 1) continue; // 1 = segunda-feira

        const segunda         = new Date(d);
        const domingo         = new Date(segunda); domingo.setDate(domingo.getDate() - 1); // dia anterior
        const sabado          = new Date(segunda); sabado.setDate(sabado.getDate() - 2);   // sábado da semana passada
        const segundaAnterior = new Date(segunda); segundaAnterior.setDate(segundaAnterior.getDate() - 7);

        let diasUteisTrabalhados = 0; // segunda a sexta (0..4) da semana passada
        let sabadoTrabalhado = false;
        for (let i = 0; i < 6; i++) { // 0=segunda ... 5=sábado, da semana passada
          const dia  = new Date(segundaAnterior); dia.setDate(dia.getDate() + i);
          const trab = trabalhou(func.id, dia);
          if (i <= 4 && trab) diasUteisTrabalhados++;
          if (i === 5) sabadoTrabalhado = trab;
        }

        // Sábado é garantido (pago mesmo sem trabalhar) enquanto houver no
        // máximo 2 faltas na semana (seg-sex); com mais faltas, só é pago se
        // ele realmente trabalhou nesse sábado.
        const faltasSemana    = 5 - diasUteisTrabalhados;
        const sabadoGarantido = faltasSemana <= 2;
        if (sabadoGarantido || sabadoTrabalhado) {
          novosDias.set(fmtDiaMes(sabado), valorDiaria(func, sabado));
        }

        // Domingo só entra com base na presença real (sábado garantido não conta):
        // seg-sex completo (5/5) → 1 diária; se além disso trabalhou o sábado
        // de verdade (compensando falta) → 2 diárias.
        const totalRealTrabalhado = diasUteisTrabalhados + (sabadoTrabalhado ? 1 : 0);
        if (totalRealTrabalhado >= 5) {
          novosDias.set(fmtDiaMes(domingo), (sabadoTrabalhado ? 2 : 1) * valorDiaria(func, domingo));
        }
      }

      if (novosDias.size === 0) continue;

      // 3. Upsert incremental — só adiciona dias que ainda não existem
      const docRef  = db.collection('diarias').doc(func.id || func.nome);
      const docSnap = await docRef.get();
      const diasAtuais   = docSnap.exists ? (docSnap.data().dias || []) : [];
      const chavesAtuais = new Set(diasAtuais.map(dd => (dd.localId || '').replace(' ½', '').trim()));

      const diasParaAdicionar = [];
      novosDias.forEach((valor, localId) => {
        if (!chavesAtuais.has(localId)) diasParaAdicionar.push({ localId, valor });
      });
      if (!diasParaAdicionar.length) continue;

      await docRef.set({
        funcionarioId:   func.id || '',
        funcionarioNome: func.nome,
        cargo:           func.cargo || '',
        diaria:          docSnap.exists ? (docSnap.data().diaria ?? valorDiaria(func, hoje)) : valorDiaria(func, hoje),
        dias:            [...diasAtuais, ...diasParaAdicionar]
      }, { merge: true });
    }
  } catch (e) {
    console.error('Erro ao sincronizar diárias por ponto:', e);
  }
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
    if (modoDiariaHoras) {
      const [dia, mes] = e.localId.trim().split('/');
      if (!dia || !mes) return;
      const key = `${anoAtual}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;
      diasSelecionados.set(key, e.horas || 0);
      diasPreCarregados.add(key);
      return;
    }
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
    const isHj  = (d === hoje.getDate() && calMesAtual === hoje.getMonth() && calAno === hoje.getFullYear()) ? ' hoje' : '';
    let cls, label;
    if (modoDiariaHoras) {
      cls   = state ? ' selecionado' : '';
      label = state ? `${d}<br><span style="font-size:0.5rem">${state}h</span>` : `${d}`;
    } else {
      cls   = state === 'full' ? ' selecionado' : state === 'half' ? ' meio-periodo' : '';
      label = `${d}`;
    }
    html += `<div class="cal-dia${cls}${isHj}" onclick="toggleDia('${key}')">${label}</div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
}

function toggleDia(key) {
  if (modoDiariaHoras) {
    const jaSelecionado = diasSelecionados.has(key);
    if (!jaSelecionado) {
      const horasStr = prompt('Quantas horas trabalhadas neste dia?');
      if (horasStr === null) return;
      const horas = parseFloat(horasStr.replace(',', '.'));
      if (isNaN(horas) || horas <= 0) { alert('Valor inválido.'); return; }
      diasSelecionados.set(key, horas);
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
    const n2  = diasSelecionados.size;
    const btn2 = document.getElementById('btn-ok-cal');
    btn2.disabled    = false;
    btn2.textContent = n2 > 0 ? `OK (${n2})` : 'OK';
    return;
  }
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
  const docId = funcionarioAtual.id || funcionarioAtual.nome;
  let dias, diaria;

  if (modoDiariaHoras) {
    diaria = 0;
    dias = [...diasSelecionados.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, horas]) => {
        const [, mes, dia] = key.split('-');
        const valor = Math.round(horas * VALOR_HORA_PINTOR * 100) / 100;
        return { localId: `${dia}/${mes}`, valor, horas };
      });
  } else {
    const totalDiasMes = new Date(calAno, calMesAtual + 1, 0).getDate();
    diaria = totalDiasMes > 0 ? (funcionarioAtual.salario || 0) / totalDiasMes : 0;
    dias = [...diasSelecionados.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, state]) => {
        const [, mes, dia] = key.split('-');
        const meio = state === 'half';
        return { localId: `${dia}/${mes}${meio ? ' ½' : ''}`, valor: meio ? diaria / 2 : diaria };
      });
  }

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
    // apenasProducao normalmente exclui ajudante — mas um ajudante marcado
    // como porProducao é remunerado igual a pintor/raspador, então entra
    // mesmo nesse modo restrito.
    .filter(f => f.porProducao || cargosValidos.some(c => (f.cargo || '').toLowerCase().includes(c)));

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

function _aplicarPendingClick() {
  if (!_pendingClick) return;
  const { key, local, servico, localid, svidx } = _pendingClick;
  _pendingClick = null;
  servicosSelecionados.set(key, { local, servico });
  const el = document.querySelector(`.apt-serv[data-localid="${localid}"][data-svidx="${svidx}"]`);
  if (el) el.classList.add('selecionado');
  atualizarBtnOk();
}

function selecionarFuncionario(func) {
  funcionarioAtual = func;
  aguardandoCalendarioAjudante = false;
  servicosSelecionados.clear();
  document.getElementById('func-atual').textContent = func.nome;
  atualizarBtnOk();
  const cargo = (func.cargo || '').toLowerCase();
  if (ehAjudanteDiaria(func) && ehAjudanteProducao(func)) {
    // Ajudante com os dois modos marcados no cadastro — pergunta qual tipo
    // de lançamento é essa entrada, antes de decidir entre diária ou mapa.
    document.getElementById('modal-tipo-nome-ajudante-ambos').textContent = func.nome;
    document.getElementById('modal-tipo-ajudante-ambos').classList.add('ativa');
  } else if (ehAjudanteDiaria(func)) {
    if (_pendingClick) {
      // Veio do mapa clicando direto num serviço de Tratamento — já sabemos o tipo, dá andamento
      aguardandoCalendarioAjudante = true;
      modoDiariaHoras = false;
      mostrarView('view-mapa');
      _aplicarPendingClick();
    } else {
      document.getElementById('modal-tipo-nome-ajudante').textContent = func.nome;
      document.getElementById('modal-tipo-ajudante').classList.add('ativa');
    }
  } else if (cargo.includes('pintor')) {
    document.getElementById('modal-tipo-nome').textContent = func.nome;
    document.getElementById('modal-tipo-pintor').classList.add('ativa');
  } else {
    modoDiariaHoras = false;
    mostrarView('view-mapa');
    _aplicarPendingClick();
  }
}

function fecharModalTipoPintor() {
  document.getElementById('modal-tipo-pintor').classList.remove('ativa');
}

function escolherTipoPintor(tipo) {
  fecharModalTipoPintor();
  if (tipo === 'diaria') {
    _pendingClick = null;
    modoDiariaHoras = true;
    abrirCalendario(funcionarioAtual);
  } else {
    modoDiariaHoras = false;
    mostrarView('view-mapa');
    _aplicarPendingClick();
  }
}

function fecharModalTipoAjudante() {
  document.getElementById('modal-tipo-ajudante').classList.remove('ativa');
}

// Ajudante fazendo Tratamento de Paredes e Tetos: marca o(s) apartamento(s) no
// mapa (como um pintor) e, em seguida, abre o calendário para marcar a diária.
let aguardandoCalendarioAjudante = false;

function escolherTipoAjudante(tipo) {
  fecharModalTipoAjudante();
  if (tipo === 'tratamento') {
    _pendingClick = null;
    aguardandoCalendarioAjudante = true;
    modoDiariaHoras = false;
    mostrarView('view-mapa');
    _aplicarPendingClick();
  } else {
    aguardandoCalendarioAjudante = false;
    modoDiariaHoras = false;
    abrirCalendario(funcionarioAtual);
  }
}

function fecharModalTipoAjudanteAmbos() {
  document.getElementById('modal-tipo-ajudante-ambos').classList.remove('ativa');
}

// Ajudante com Produção e Diária marcadas ao mesmo tempo no cadastro:
// pergunta primeiro qual dos dois modos é essa entrada. "Diária" segue pro
// mesmo submenu (Tratamento/Serviços Gerais) que o ajudante só-diária já
// usa; "Produção" vai direto pro mapa de serviços, igual pintor/raspador.
function escolherTipoAjudanteAmbos(tipo) {
  fecharModalTipoAjudanteAmbos();
  if (tipo === 'diaria') {
    if (_pendingClick) {
      aguardandoCalendarioAjudante = true;
      modoDiariaHoras = false;
      mostrarView('view-mapa');
      _aplicarPendingClick();
    } else {
      document.getElementById('modal-tipo-nome-ajudante').textContent = funcionarioAtual.nome;
      document.getElementById('modal-tipo-ajudante').classList.add('ativa');
    }
  } else {
    modoDiariaHoras = false;
    mostrarView('view-mapa');
    _aplicarPendingClick();
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
        filtrarProducaoConflitanteComDiaria();
        filtrarDiariaConflitanteComProducaoPintor();

        // Sempre re-renderiza aqui: além do refino por lookup, o filtro de
        // conflito diária×produção acima também pode ter alterado valores.
        renderizarFolha();
        atualizarHeader();
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
    if (!funcionarioAtual) {
      _pendingClick = { key, local, servico, localid: el.dataset.localid, svidx: el.dataset.svidx };
      // Tratamento também pode ser feito por ajudante; os demais serviços, só produção (pintor/raspador)
      apenasProducao = ordemServico(servico.nome) !== 0;
      mostrarView('view-funcionarios');
      return;
    }
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
  if (!servicosSelecionados.size) {
    if (aguardandoCalendarioAjudante) {
      aguardandoCalendarioAjudante = false;
      abrirCalendario(funcionarioAtual);
    } else {
      mostrarView('view-folha');
    }
    return;
  }

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
  filtrarProducaoConflitanteComDiaria();
  filtrarDiariaConflitanteComProducaoPintor();

  renderizarFolha();
  atualizarHeader();
  salvarFolha(true, false); // salva o progresso

  if (aguardandoCalendarioAjudante) {
    aguardandoCalendarioAjudante = false;
    abrirCalendario(funcionarioAtual);
  } else {
    mostrarView('view-folha');
  }
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

  // ── Grupos de produção ── (diária e produção ficam em tabelas com colunas
  // diferentes, mas agora dentro do MESMO card por funcionário, já que
  // um pintor/ajudante pode ter os dois tipos de lançamento na mesma folha)
  const grupos = new Map();
  entradas.forEach((e, idx) => {
    const ehDiaria = !e.firestoreLocalId;
    const key = e.funcionario.id || e.funcionario.nome;
    if (!grupos.has(key)) grupos.set(key, { funcionario: e.funcionario, itensDiaria: [], itensProd: [] });
    (ehDiaria ? grupos.get(key).itensDiaria : grupos.get(key).itensProd).push({ ...e, _idx: idx });
  });

  const totalProducao = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const totalGeral    = totalProducao + valorEncarregado;

  // Diárias chegam na ordem em que foram lançadas (sync do ponto dia a dia,
  // ou adição manual), não em ordem cronológica — ordena pelo dd/mm do
  // localId antes de exibir.
  function chaveDataLocalId(localId) {
    const dataPart = (localId || '').replace(' ½', '').trim();
    const [dia, mes] = dataPart.split('/').map(Number);
    return (mes || 0) * 100 + (dia || 0);
  }

  const gruposHtml = [...grupos.values()].map(g => {
    g.itensDiaria.sort((a, b) => chaveDataLocalId(a.localId) - chaveDataLocalId(b.localId));
    const subtotalDiaria = g.itensDiaria.reduce((acc, e) => acc + Number(e.valor), 0);
    const subtotalProd   = g.itensProd.reduce((acc, e) => acc + Number(e.valor), 0);
    const subtotalTotal  = subtotalDiaria + subtotalProd;
    const temAmbos = g.itensDiaria.length > 0 && g.itensProd.length > 0;

    const tabelaDiaria = g.itensDiaria.length ? `
        <table class="folha-tabela">
          <thead><tr><th>Data</th><th>Diária</th><th>Valor</th><th></th></tr></thead>
          <tbody>${g.itensDiaria.map(e => `
      <tr>
        <td>${escHtml(e.localId)}</td>
        <td>${escHtml(e.servico)}</td>
        <td class="td-valor">${fmtMoeda(e.valor)}</td>
        <td class="td-del"><button class="btn-del-dia" onclick="removerDiaria(${e._idx})">✕</button></td>
      </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3" class="td-sub-label">Subtotal</td><td class="td-sub-valor">${fmtMoeda(subtotalDiaria)}</td></tr></tfoot>
        </table>` : '';

    const tabelaProd = g.itensProd.length ? `
        <table class="folha-tabela">
          <thead><tr><th>Local</th><th>Serviço</th><th>Registro</th><th>Valor</th></tr></thead>
          <tbody>${g.itensProd.map(e => `
      <tr>
        <td>${escHtml(e.localId)}</td>
        <td>${escHtml(nomeExibicaoServico(e.servico))}</td>
        <td style="font-size:0.75rem;color:#888">${escHtml(e.dataRegistro || '—')}</td>
        <td class="td-valor">${fmtMoeda(e.valor)}</td>
      </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3" class="td-sub-label">Subtotal</td><td class="td-sub-valor">${fmtMoeda(subtotalProd)}</td></tr></tfoot>
        </table>` : '';

    return `
      <div class="grupo-func">
        <div class="grupo-header">
          <span class="grupo-nome">${escHtml(g.funcionario.nome)}</span>
          <span class="grupo-cargo ${(g.funcionario.cargo||'').toLowerCase()}">${escHtml(g.funcionario.cargo||'')}</span>
        </div>
        ${tabelaDiaria}
        ${tabelaProd}
        ${temAmbos ? `<div class="total-geral" style="font-size:0.9rem;padding:6px 4px"><span>Subtotal ${escHtml(g.funcionario.nome)}</span><span>${fmtMoeda(subtotalTotal)}</span></div>` : ''}
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
          const ehGrupoDiarista = (g.itens || []).length > 0 && (g.itens || []).every(it => !it.firestoreLocalId);
          if (g.isEncarregado || !ehGrupoDiarista) return;
          const key = g.funcionario.id || g.funcionario.nome;
          if (ajudantesJaCarregados.has(key)) return;
          (g.itens || []).forEach(item => {
            if (item.firestoreLocalId) return;
            entradas.push({ funcionario: g.funcionario, firestoreLocalId: '', localId: item.localId, servico: item.servico, valor: Number(item.valor) });
          });
        });
        filtrarProducaoConflitanteComDiaria();
        filtrarDiariaConflitanteComProducaoPintor();
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

// Soma os adiantamentos ainda em aberto de cada funcionário — tanto os
// lançados direto no caixa (origem 'Adiantamento', ainda não renomeado pra
// 'Antecipacao' quando uma folha desconta) quanto os solicitados em
// Funcionários e pagos via Contas a Pagar (baixados, ainda sem
// descontadoDaFolha). Mesmo critério usado em caixa/relatorio.html — sem a
// segunda parte, um adiantamento pago via Contas a Pagar nunca aparecia
// aqui, mesmo já tendo sido desembolsado pro funcionário.
async function buscarAdiantamentosMap() {
  const adiantamentosMap = new Map();
  try {
    const [lancSnap, cpSnap] = await Promise.all([
      db.collection('lancamentos').where('origem', 'in', ['ANE->ADIANTAMENTO', 'JOAO->ADIANTAMENTO']).get(),
      db.collection('contasPagar').get()
    ]);
    lancSnap.docs.forEach(d => {
      const r = d.data();
      const desc = r.descricao || '';
      if (!desc.startsWith('Adiantamento: ')) return;
      const nome = desc.slice('Adiantamento: '.length).split(/\s*[—–\-]/)[0].trim().normalize('NFC');
      if (!nome) return;
      adiantamentosMap.set(nome, (adiantamentosMap.get(nome) || 0) + (r.saida || 0));
    });
    cpSnap.docs.forEach(d => {
      const r = d.data();
      if (r.status !== 'baixado' || r.descontadoDaFolha) return;
      const desc = r.descricao || '';
      if (!desc.startsWith('Adiantamento: ')) return;
      const nome = desc.slice('Adiantamento: '.length).split(/\s*[—–\-]/)[0].trim().normalize('NFC');
      if (!nome) return;
      const valor = r.valorOriginal !== undefined ? r.valorOriginal : r.valor;
      adiantamentosMap.set(nome, (adiantamentosMap.get(nome) || 0) + (valor || 0));
    });
  } catch (e) {}
  return adiantamentosMap;
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

  const adiantamentosMap = await buscarAdiantamentosMap();

  entradas = [];
  atualizarHeader();
  mostrarComprovante(gruposData, encarregadoCache, valorEncarregado, nServMapa, totalGeral, pagamentos, adiantamentosMap);
}

// Converte "DD/MM/AAAA" num Date local (meia-noite) — mesma convenção usada
// em caixa/relatorio.html.
function parseDataBRparaDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((s || '').trim());
  if (!m) return null;
  const [, d, mo, a] = m;
  const ano = a.length === 2 ? '20' + a : a;
  return new Date(Number(ano), Number(mo) - 1, Number(d));
}

// INSS e Passagens fixos, calculados sobre o salário cadastrado (Salário
// Bruto ou Salário de Referência, conforme o cargo) — mesmo cálculo e mesma
// regra de caixa/relatorio.html: só na quinzena 16-fim do mês, proporcional
// aos dias efetivamente admitido dentro do período pra quem entrou no meio.
function calcularDescontosFixos(nome) {
  const CARGOS_POR_PRODUCAO_REL = ['PINTOR', 'RASPADOR'];
  const hoje = new Date();
  if (hoje.getDate() < 16) return { inss: 0, passagens: 0 };

  const f = (_todosFunc || []).find(x => (x.nome || '').normalize('NFC') === (nome || '').normalize('NFC'));
  if (!f) return { inss: 0, passagens: 0 };

  const periodoIni = new Date(hoje.getFullYear(), hoje.getMonth(), 16);
  const periodoFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const diasPeriodo = Math.round((periodoFim - periodoIni) / 86400000) + 1;
  const admissao = parseDataBRparaDate(f.admissao);
  let fator = 1;
  if (admissao && admissao > periodoFim) fator = 0;
  else if (admissao && admissao > periodoIni) {
    const diasTrabalhados = Math.round((periodoFim - admissao) / 86400000) + 1;
    fator = Math.max(0, Math.min(1, diasTrabalhados / diasPeriodo));
  }

  // Cargos que já são "por produção" por natureza (Pintor/Raspador) OU quem
  // tem o checkbox "Remunerar por produção" marcado (ex: Leonardo Ferreira,
  // Ajudante) usa o Salário de Referência como base — mesma regra de
  // caixa/relatorio.html.
  const porProd = CARGOS_POR_PRODUCAO_REL.includes((f.cargo || '').toUpperCase()) || f.porProducao === true;
  const base = porProd ? Number(f.salarioReferencia || 0) : Number(f.salario || 0);
  const pct  = Number(f.descontos || 0);
  return { inss: base * pct / 100 * fator, passagens: f.isentoPassagens ? 0 : base * 0.06 * fator };
}

function mostrarComprovante(gruposData, encData, valorEnc, nServ, totalGeral, pagamentos, adiantamentosMap = new Map()) {

  const hoje = new Date().toLocaleDateString('pt-BR');

  let totalDeducoes = 0;

  let encHtml = '';
  if (encData) {
    const quinzena  = (encData.salario || 0) / 2;
    const bonus     = 5 * nServ;
    const adiantEnc = adiantamentosMap.get((encData.nome || '').normalize('NFC')) || 0;
    const { inss: inssEnc, passagens: passagensEnc } = calcularDescontosFixos(encData.nome);
    const totalDeducEnc = adiantEnc + inssEnc + passagensEnc;
    const liquidoEnc = valorEnc - totalDeducEnc;
    totalDeducoes += totalDeducEnc;
    const linhaDeduc = (label, v) => v > 0 ? `
      <div class="cp-item" style="color:#c62828">
        <span>(-) ${label}</span>
        <span>- ${fmtMoeda(v)}</span>
      </div>` : '';
    encHtml = `
      <div class="cp-grupo cp-enc">
        <div class="cp-func">${escHtml(encData.nome)} <span class="cp-cargo">encarregado</span></div>
        <div class="cp-item"><span>Quinzena 50%</span><span>${fmtMoeda(quinzena)}</span></div>
        <div class="cp-item"><span>${nServ} serv × R$5</span><span>${fmtMoeda(bonus)}</span></div>
        ${linhaDeduc('INSS', inssEnc)}
        ${linhaDeduc('Passagens', passagensEnc)}
        ${linhaDeduc('Adiantamento', adiantEnc)}
        <div class="cp-sub"><span>Subtotal</span><span>${fmtMoeda(totalDeducEnc > 0 ? liquidoEnc : valorEnc)}</span></div>
      </div>`;
  }
  const gruposHtml = gruposData.map(g => {
    const sub    = g.itens.reduce((a, e) => a + Number(e.valor), 0);
    const adiant = adiantamentosMap.get((g.funcionario.nome || '').normalize('NFC')) || 0;
    const { inss, passagens } = calcularDescontosFixos(g.funcionario.nome);
    const totalDeduc = adiant + inss + passagens;
    const liquido = sub - totalDeduc;
    totalDeducoes += totalDeduc;
    const itens  = g.itens.map(e => {
      const isProd = !!e.firestoreLocalId;
      return `
      <div class="cp-item">
        <span>${escHtml(e.localId)} · ${escHtml(isProd ? nomeExibicaoServico(e.servico) : e.servico)}${isProd && e.dataRegistro ? `<span style="color:#4a8a5a;font-size:0.65rem;margin-left:4px">${escHtml(e.dataRegistro)}</span>` : ''}</span>
        <span>${fmtMoeda(e.valor)}</span>
      </div>`;
    }).join('');
    const linhaDeduc = (label, v) => v > 0 ? `
      <div class="cp-item" style="color:#c62828">
        <span>(-) ${label}</span>
        <span>- ${fmtMoeda(v)}</span>
      </div>` : '';
    return `
      <div class="cp-grupo">
        <div class="cp-func">${escHtml(g.funcionario.nome)} <span class="cp-cargo">${escHtml(g.funcionario.cargo||'')}</span></div>
        ${itens}
        ${linhaDeduc('INSS', inss)}
        ${linhaDeduc('Passagens', passagens)}
        ${linhaDeduc('Adiantamento', adiant)}
        <div class="cp-sub"><span>Subtotal</span><span>${fmtMoeda(totalDeduc > 0 ? liquido : sub)}</span></div>
      </div>`;
  }).join('');

  const totalLiquido = totalGeral - totalDeducoes;

  // Ajusta pagamentos para tela de sucesso (desconta adiantamento + INSS + passagens por funcionário)
  const pagamentosAjustados = pagamentos.map(p => {
    const { inss, passagens } = calcularDescontosFixos(p.nome);
    return {
      ...p,
      valor: p.valor - (adiantamentosMap.get((p.nome || '').normalize('NFC')) || 0) - inss - passagens
    };
  });

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
      .cp-body{flex:1;overflow-y:auto;padding:7px 10px;background:#ffffff}
      .cp-grupo{border:1px solid rgba(76,140,90,0.35);border-radius:5px;margin-bottom:6px;overflow:hidden}
      .cp-enc{border-color:rgba(76,140,90,0.6)}
      .cp-func{background:rgba(165,214,167,0.18);padding:4px 8px;font-weight:700;color:#1b5e20;font-size:0.68rem}
      .cp-cargo{font-size:0.56rem;font-weight:400;color:#4a8a5a;text-transform:capitalize;margin-left:5px}
      .cp-item{display:flex;justify-content:space-between;padding:3px 8px;border-top:1px solid rgba(76,140,90,0.12);color:#2e6b3e}
      .cp-sub{display:flex;justify-content:space-between;padding:4px 8px;border-top:1px solid rgba(76,140,90,0.25);font-weight:700;color:#1b5e20}
      .cp-footer{background:#0d1f14;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(165,214,167,0.2);flex-shrink:0}
      .cp-total-l{font-size:0.68rem;font-weight:700;letter-spacing:1px;color:#66bb6a}
      .cp-total-v{font-size:1rem;font-weight:900;color:#a5d6a7}
      .cp-print-btn{background:rgba(165,214,167,0.15);border:1px solid rgba(165,214,167,0.4);color:#a5d6a7;
        font-size:0.62rem;font-weight:700;letter-spacing:0.5px;padding:5px 10px;border-radius:6px;cursor:pointer}
      @media print {
        .cp-print-btn, .cp-meta span:last-child { display:none !important }
        body{overflow:visible !important;height:auto !important;background:#fff !important}
        .cp-wrap{transform:none !important;width:auto !important;height:auto !important;overflow:visible !important;background:#fff;color:#000}
        .cp-header{background:#fff !important;border-bottom:1px solid #ccc}
        .cp-title{color:#1b5e20 !important}
        .cp-meta{color:#555 !important}
        .cp-body{overflow:visible !important;background:#fff !important}
        .cp-footer{background:#fff !important;border-top:2px solid #1b5e20}
        .cp-grupo{break-inside:avoid;page-break-inside:avoid}
      }
    </style>
    <div class="cp-wrap" onclick="mostrarSucesso(window._sucPag,window._sucTotal)">
      <div class="cp-header">
        <div class="cp-title">FOLHA DE PAGAMENTO DA PRODUÇÃO</div>
        <div class="cp-meta">
          <span>Emitida em ${hoje} · v${VERSAO}</span>
          <span>toque para continuar →</span>
        </div>
        <button class="cp-print-btn" style="margin-top:6px" onclick="event.stopPropagation();window.print()">🖨 Imprimir</button>
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

  const adiantamentosMap = await buscarAdiantamentosMap();

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
          funcionario: func, firestoreLocalId: '', localId: d.localId,
          servico: labelDiaria(d), valor: d.valor
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
    // Sem folha aberta — lê o último documento salvo, descartando itens cujo serviço
    // já não está mais em_pagamento em 'locais' (removido da folha após o fechamento).
    // Se a última folha já foi paga, não há nada em aberto pra mostrar (mesmo
    // comportamento do relatório financeiro, que fica vazio nesse caso).
    try {
      const fSnap = await db.collection('folhas').orderBy('criadoEm', 'desc').limit(1).get();
      if (fSnap.empty || fSnap.docs[0].data().status === 'paga') return;
      const folha   = fSnap.docs[0].data();
      const gList   = folha.grupos || [];

      // Bônus do encarregado recalculado ao vivo (qtd. de serviços em_pagamento atuais)
      nServMapa = Object.values(locaisCache).reduce((acc, local) =>
        acc + (local.servicos || []).filter(s => s.status === 'em_pagamento').length, 0);
      valorEncarregado = encarregadoCache
        ? ((encarregadoCache.salario || 0) / 2) + (5 * nServMapa) : 0;

      gruposData = gList.filter(g => !g.isEncarregado).map(g => {
        const itensVivos = (g.itens || []).filter(item => {
          if (!item.firestoreLocalId) return true; // diárias de ajudantes (sem local)
          const local = locaisCache[item.firestoreLocalId];
          if (!local) return false;
          return (local.servicos || []).some(s =>
            s.nome === item.servico && s.status === 'em_pagamento' &&
            s.funcionario && (s.funcionario.id || s.funcionario.nome) === (g.funcionario.id || g.funcionario.nome));
        });
        return { funcionario: g.funcionario, itens: itensVivos };
      }).filter(g => g.itens.length > 0 || adiantamentosMap.has((g.funcionario.nome || '').normalize('NFC')));

      const totalProd = gruposData.reduce((acc, g) => acc + g.itens.reduce((s, e) => s + Number(e.valor), 0), 0);
      totalGeral = totalProd + valorEncarregado;
    } catch(e) { alert('Erro ao carregar relatório.'); return; }
  }

  const pagamentos = [];
  if (encarregadoCache) pagamentos.push({ nome: encarregadoCache.nome, cargo: encarregadoCache.cargo || 'encarregado', valor: valorEncarregado });
  gruposData.forEach(g => {
    const sub = g.itens.reduce((a, e) => a + Number(e.valor), 0);
    pagamentos.push({ nome: g.funcionario.nome, cargo: g.funcionario.cargo || '', valor: sub });
  });

  mostrarComprovante(gruposData, encarregadoCache, valorEncarregado, nServMapa, totalGeral, pagamentos, adiantamentosMap);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  // Recarrega uma vez quando novo SW assume o controle (nova versão instalada)
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

sincronizarDiariasAjudantesPorPonto();
