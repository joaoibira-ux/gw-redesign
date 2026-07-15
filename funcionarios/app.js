const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

const VERSAO = "3.11";
const CARGOS_POR_PRODUCAO = ["PINTOR", "RASPADOR"];
const MODELS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';

document.getElementById("versao-app").textContent = "v" + VERSAO;

firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();
const col = db.collection("funcionarios");

function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function parseMoeda(s) {
  const v = parseFloat(String(s).replace(/[^\d,]/g,"").replace(",","."));
  return isNaN(v) ? 0 : v;
}

function fmtMoeda(v) {
  return "R$ " + (v||0).toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");
}

function hoje() {
  const d = new Date();
  return [String(d.getDate()).padStart(2,"0"), String(d.getMonth()+1).padStart(2,"0"), d.getFullYear()].join("/");
}

function ehServente(cargo) { return (cargo||"").toLowerCase().includes("ajudante"); }
function ehPorProducao(cargo) { return CARGOS_POR_PRODUCAO.includes((cargo||"").toUpperCase()); }

function diasDoMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function calcLiquido(salario, descontos) {
  return (salario || 0) * (1 - (descontos || 0) / 100);
}
function calcDiaria(salario) {
  const dias = diasDoMes();
  return dias > 0 ? (salario || 0) / dias : 0;
}
function calcDescontoPassagens(salario) {
  return (salario || 0) * 0.06;
}

let funcionariosCache = {};
let editandoId = null;
let modelsLoaded = false;
let faceStream = null;
let pendingFaceDescriptor = null;
let pendingFotoThumb = null;

// ── Lista ─────────────────────────────────────────────────
function render(docs) {
  const lista = document.getElementById("lista");
  funcionariosCache = {};
  if (!docs.length) { lista.innerHTML = '<p class="empty">Nenhum funcionário cadastrado.</p>'; return; }

  // Ativos primeiro (ordem alfabética), inativos no fim (também alfabética)
  const docsOrdenados = [...docs].sort((a, b) => {
    const fa = a.data(), fb = b.data();
    const ativoA = fa.ativo !== false, ativoB = fb.ativo !== false;
    if (ativoA !== ativoB) return ativoA ? -1 : 1;
    return (fa.nome || "").localeCompare(fb.nome || "", "pt-BR");
  });

  lista.innerHTML = docsOrdenados.map(doc => {
    const f = doc.data();
    funcionariosCache[doc.id] = f;
    const porProd = ehPorProducao(f.cargo);
    const ativo   = f.ativo !== false;
    return `
      <div class="card ${ativo ? '' : 'inativo'}">
        <div class="card-acoes">
          <button class="btn-consultar" onclick="consultarFuncionario('${doc.id}')">Consultar</button>
          <button class="btn-del" onclick="excluir('${doc.id}')" title="Excluir">✕</button>
        </div>
        <div class="card-nome">${escHtml(f.nome)}</div>
        <div class="card-info">
          <span class="badge">${escHtml(f.cargo)}</span>
          <span class="card-salario ${porProd ? 'por-producao' : ''}">
            ${porProd ? 'Por produção' : (() => {
              const liq = calcLiquido(f.salario, f.descontos);
              const dia = calcDiaria(f.salario);
              const descPass = calcDescontoPassagens(f.salario);
              return `${fmtMoeda(f.salario)}${f.descontos ? ` · Desc: ${f.descontos}%` : ''} · Desc. Passagens: ${fmtMoeda(descPass)} · Líq: ${fmtMoeda(liq)} · Diária: ${fmtMoeda(dia)}`;
            })()}
          </span>
          <button class="btn-ativo ${ativo ? 'ativo' : 'inativo'}" onclick="toggleAtivo('${doc.id}')">
            ${ativo ? '● Ativo' : '○ Inativo'}
          </button>
        </div>
        <div class="card-meta">
          <span>Admissão: ${escHtml(f.admissao||'')}</span>
          ${f.telefone ? `<span>📞 ${escHtml(f.telefone)}</span>` : ""}
          ${f.cpf ? `<span>CPF: ${escHtml(f.cpf)}</span>` : ""}
          ${f.passagens > 0 ? `<span>🚌 Passagens (15dd): ${fmtMoeda(f.passagens)}</span>` : ''}
        </div>
        ${f.obs ? `<div class="card-obs">${escHtml(f.obs)}</div>` : ""}
      </div>`;
  }).join("");
}

col.orderBy("criadoEm","asc").onSnapshot(snap => render(snap.docs), err => {
  document.getElementById("lista").innerHTML = '<p class="empty">Erro ao conectar.</p>';
});

// ── Formulário ─────────────────────────────────────────────
function abrirFormulario() {
  editandoId = null;
  document.getElementById("form").reset();
  document.getElementById("f-admissao").value = hoje();
  document.getElementById("wrap-salario").style.display = "";
  document.getElementById("wrap-descontos").style.display = "";
  document.getElementById("wrap-salario-ref").style.display = "none";
  document.getElementById("form-overlay").style.display = "flex";
  document.getElementById("fab").classList.add("open");
  document.getElementById("f-nome").focus();
  pendingFaceDescriptor = null;
  pendingFotoThumb = null;
  atualizarStatusFace();
}

function fecharFormulario() {
  document.getElementById("form-overlay").style.display = "none";
  document.getElementById("assin-overlay").style.display = "none";
  document.getElementById("fab").classList.remove("open");
  editandoId = null;
}

// Cargo
const SALARIO_REFERENCIA_PADRAO = 2407.00;

document.getElementById("f-cargo").addEventListener("change", function() {
  const porProd = ehPorProducao(this.value);
  document.getElementById("wrap-salario").style.display = porProd ? "none" : "";
  document.getElementById("wrap-descontos").style.display = porProd ? "none" : "";
  document.getElementById("wrap-salario-ref").style.display = porProd ? "" : "none";
  const salarioRef = document.getElementById("f-salario-ref");
  if (porProd && !salarioRef.value) salarioRef.value = SALARIO_REFERENCIA_PADRAO.toFixed(2).replace(".",",");
});

document.getElementById("f-salario").addEventListener("blur", function() {
  const v = parseMoeda(this.value);
  if (v > 0) this.value = v.toFixed(2).replace(".",",");
});

document.getElementById("f-descontos").addEventListener("blur", function() {
  const v = parseFloat(this.value.replace(",","."));
  if (!isNaN(v) && v > 0) this.value = v.toFixed(2).replace(".",",");
});

document.getElementById("f-salario-ref").addEventListener("blur", function() {
  const v = parseMoeda(this.value);
  if (v > 0) this.value = v.toFixed(2).replace(".",",");
});

document.getElementById("f-passagens").addEventListener("blur", function() {
  const v = parseMoeda(this.value);
  if (v > 0) this.value = v.toFixed(2).replace(".",",");
});

// ── Auto-formato datas ─────────────────────────────────────
const IDS_DATA = ["f-admissao","f-nascimento","f-emissaorg","f-emissaoctps"];
function formatarData(val) {
  const n = val.replace(/\D/g,"");
  if (n.length >= 8) return n.slice(0,2)+"/"+n.slice(2,4)+"/"+n.slice(4,8);
  if (n.length >= 4) return n.slice(0,2)+"/"+n.slice(2,4)+"/"+(n.slice(4)||"");
  if (n.length >= 2) return n.slice(0,2)+"/"+(n.slice(2)||"");
  return n;
}
function validarData(val) {
  if (!val) return false;
  const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const d=+m[1],mo=+m[2],y=+m[3];
  return mo>=1&&mo<=12&&d>=1&&d<=31&&y>=1900&&y<=2100;
}
IDS_DATA.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", function() { this.value = formatarData(this.value); });
  el.addEventListener("blur",  function() { if(this.value&&!validarData(this.value)) this.classList.add("campo-erro"); else this.classList.remove("campo-erro"); });
});

// ── CPF ────────────────────────────────────────────────────
function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g,"");
  if (cpf.length!==11||/^(\d)\1{10}$/.test(cpf)) return false;
  let s=0; for(let i=0;i<9;i++) s+=+cpf[i]*(10-i);
  let r=11-s%11; if(r>9)r=0; if(r!==+cpf[9]) return false;
  s=0; for(let i=0;i<10;i++) s+=+cpf[i]*(11-i);
  r=11-s%11; if(r>9)r=0; return r===+cpf[10];
}
const elCpf = document.getElementById("f-cpf");
if (elCpf) {
  elCpf.addEventListener("input", function() {
    const n=this.value.replace(/\D/g,"").slice(0,11);
    this.value=n.replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})\.(\d{3})(\d)/,"$1.$2.$3").replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/,"$1.$2.$3-$4");
  });
  elCpf.addEventListener("blur", function() {
    this.classList.toggle("campo-erro", !validarCPF(this.value));
  });
}

// ── CEP auto-fill ──────────────────────────────────────────
const elCep = document.getElementById("f-cep");
if (elCep) {
  elCep.addEventListener("input", function() {
    const n=this.value.replace(/\D/g,"").slice(0,8);
    this.value=n.length>5?n.slice(0,5)+"-"+n.slice(5):n;
  });
  elCep.addEventListener("blur", async function() {
    const cep=this.value.replace(/\D/g,"");
    if(cep.length!==8) return;
    try {
      const res=await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d=await res.json();
      if(!d.erro){
        if(d.logradouro && !document.getElementById("f-endereco").value)
          document.getElementById("f-endereco").value=d.logradouro+(d.complemento?" "+d.complemento:"");
        document.getElementById("f-cidade").value=d.localidade||"";
        document.getElementById("f-uf").value=d.uf||"";
      }
    } catch(e){}
  });
}

// ── Validação completa ─────────────────────────────────────
function validarFormulario() {
  const v  = id => ((document.getElementById(id)||{}).value||"").trim();
  const rb = n  => !!document.querySelector(`input[name="${n}"]:checked`);
  const editando = !!editandoId;
  // Em edição, campos vazios são permitidos; se preenchidos, ainda precisam ser válidos.
  const data = (val, msg, erros) => { if ((!editando || val) && !validarData(val)) erros.push(msg); };
  const erros = [];
  if (!v("f-nome"))           erros.push("Nome");
  if (!v("f-cargo"))          erros.push("Cargo");
  data(v("f-admissao"), "Admissão (DD/MM/AAAA)", erros);
  if (!editando && !ehPorProducao(v("f-cargo")) && !parseMoeda(v("f-salario"))) erros.push("Salário / Diária");
  if (!editando && !v("f-telefone"))       erros.push("Telefone");
  if (!editando && !v("f-nacionalidade"))  erros.push("Nacionalidade");
  if (!editando && !v("f-estadocivil"))    erros.push("Estado Civil");
  data(v("f-nascimento"), "Data de Nascimento (DD/MM/AAAA)", erros);
  if (!editando && !v("f-localnasc"))      erros.push("Local de Nascimento");
  if (!editando && !v("f-ufnasc"))         erros.push("UF Nascimento");
  if (!editando && !v("f-nomemae"))        erros.push("Nome da Mãe");
  if (!editando && !rb("instrucao"))       erros.push("Grau de Instrução");
  if (!editando && !rb("instrucao_status"))erros.push("Grau de Instrução (Completo/Incompleto/Cursando)");
  const cpf = v("f-cpf");
  if ((!editando || cpf) && !validarCPF(cpf)) erros.push("CPF inválido");
  if (!editando && !v("f-rg"))             erros.push("Identidade (RG)");
  if (!editando && !v("f-orgaoemissor"))   erros.push("Órgão Emissor");
  if (!editando && !v("f-ufrg"))           erros.push("UF Identidade");
  data(v("f-emissaorg"), "Data Emissão RG (DD/MM/AAAA)", erros);
  if (!editando && !v("f-ctps"))           erros.push("CTPS");
  if (!editando && !v("f-seriectps"))      erros.push("Série CTPS");
  if (!editando && !v("f-ufctps"))         erros.push("UF CTPS");
  data(v("f-emissaoctps"), "Data Emissão CTPS (DD/MM/AAAA)", erros);
  if (!editando && !v("f-cep"))            erros.push("CEP");
  if (!editando && !v("f-endereco"))       erros.push("Endereço");
  if (!editando && !v("f-cidade"))         erros.push("Cidade");
  if (!editando && !v("f-uf"))             erros.push("UF");
  return erros;
}

// ── Salvar ────────────────────────────────────────────────
function lerCampos() {
  const v = id => (document.getElementById(id)||{}).value || "";
  const radios = name => { const r = document.querySelector(`input[name="${name}"]:checked`); return r ? r.value : ""; };
  return {
    nome:         v("f-nome").trim(),
    cargo:        v("f-cargo"),
    admissao:     v("f-admissao").trim(),
    salario:      ehPorProducao(v("f-cargo")) ? 0 : parseMoeda(v("f-salario")),
    descontos:    ehPorProducao(v("f-cargo")) ? 0 : (parseFloat((v("f-descontos")||"0").replace(",",".")) || 0),
    salarioReferencia: ehPorProducao(v("f-cargo")) ? parseMoeda(v("f-salario-ref")) : 0,
    passagens:    parseMoeda(v("f-passagens")),
    telefone:     v("f-telefone").trim(),
    obs:          v("f-obs").trim(),
    // Pessoais
    nacionalidade: v("f-nacionalidade").trim(),
    estadocivil:   v("f-estadocivil"),
    nascimento:    v("f-nascimento").trim(),
    conjuge:       v("f-conjuge").trim(),
    localnasc:     v("f-localnasc").trim(),
    ufnasc:        v("f-ufnasc").trim().toUpperCase(),
    nomemae:       v("f-nomemae").trim(),
    instrucao:     radios("instrucao"),
    instrucaoStatus: radios("instrucao_status"),
    // Documentos
    cpf:           v("f-cpf").trim(),
    rg:            v("f-rg").trim(),
    orgaoemissor:  v("f-orgaoemissor").trim(),
    ufrg:          v("f-ufrg").trim().toUpperCase(),
    emissaorg:     v("f-emissaorg").trim(),
    ctps:          v("f-ctps").trim(),
    seriectps:     v("f-seriectps").trim(),
    ufctps:        v("f-ufctps").trim().toUpperCase(),
    emissaoctps:   v("f-emissaoctps").trim(),
    // Endereço
    endereco:      v("f-endereco").trim(),
    cep:           v("f-cep").trim(),
    cidade:        v("f-cidade").trim(),
    uf:            v("f-uf").trim().toUpperCase(),
  };
}

// Form submit desativado — salvo via assinarESalvar()
document.getElementById("form").addEventListener("submit", e => e.preventDefault());

function editarFuncionario(id) {
  const f = funcionariosCache[id];
  if (!f) return;
  editandoId = id;

  const set = (fid, val) => { const el = document.getElementById(fid); if (el) el.value = val || ""; };
  set("f-nome", f.nome); set("f-cargo", f.cargo); set("f-admissao", f.admissao);
  set("f-salario", f.salario > 0 ? f.salario.toFixed(2).replace(".",",") : "");
  set("f-descontos", f.descontos > 0 ? f.descontos.toFixed(2).replace(".",",") : "");
  set("f-passagens", f.passagens > 0 ? f.passagens.toFixed(2).replace(".",",") : "");
  set("f-salario-ref", f.salarioReferencia > 0 ? f.salarioReferencia.toFixed(2).replace(".",",") : "");
  set("f-telefone", f.telefone); set("f-obs", f.obs);
  set("f-nacionalidade", f.nacionalidade); set("f-estadocivil", f.estadocivil);
  set("f-nascimento", f.nascimento); set("f-conjuge", f.conjuge);
  set("f-localnasc", f.localnasc); set("f-ufnasc", f.ufnasc);
  set("f-nomemae", f.nomemae);
  set("f-cpf", f.cpf); set("f-rg", f.rg); set("f-orgaoemissor", f.orgaoemissor);
  set("f-ufrg", f.ufrg); set("f-emissaorg", f.emissaorg);
  set("f-ctps", f.ctps); set("f-seriectps", f.seriectps);
  set("f-ufctps", f.ufctps); set("f-emissaoctps", f.emissaoctps);
  set("f-endereco", f.endereco); set("f-cep", f.cep);
  set("f-cidade", f.cidade); set("f-uf", f.uf);

  if (f.instrucao) { const r = document.querySelector(`input[name="instrucao"][value="${f.instrucao}"]`); if (r) r.checked = true; }
  if (f.instrucaoStatus) { const r = document.querySelector(`input[name="instrucao_status"][value="${f.instrucaoStatus}"]`); if (r) r.checked = true; }

  const porProd = ehPorProducao(f.cargo);
  document.getElementById("wrap-salario").style.display = porProd ? "none" : "";
  document.getElementById("wrap-descontos").style.display = porProd ? "none" : "";
  document.getElementById("wrap-salario-ref").style.display = porProd ? "" : "none";
  document.getElementById("form-overlay").style.display = "flex";
  document.getElementById("fab").classList.add("open");

  pendingFaceDescriptor = null;
  pendingFotoThumb = null;
  atualizarStatusFace();
}

// ── Cadastro de Face ────────────────────────────────────────
function atualizarStatusFace() {
  const preview = document.getElementById("face-preview");
  const label   = document.getElementById("face-label");
  const btn     = document.getElementById("btn-face");
  const atual   = editandoId ? funcionariosCache[editandoId] : null;
  const thumb   = pendingFotoThumb || (atual && atual.fotoThumb) || null;
  const cadastrado = !!pendingFaceDescriptor || !!(atual && atual.faceDescriptor);

  preview.innerHTML = thumb ? `<img src="${thumb}" alt="face">` : "👤";
  label.textContent = cadastrado ? "✓ Face cadastrada" : "Face não cadastrada";
  btn.textContent   = cadastrado ? "🔄 Atualizar Face" : "📷 Cadastrar Face";
}

async function abrirCameraFace() {
  document.getElementById("face-hint").textContent = "Carregando...";
  document.getElementById("btn-capture-face").disabled = true;
  document.getElementById("face-overlay").style.display = "block";

  if (!modelsLoaded) {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
      ]);
      modelsLoaded = true;
    } catch (e) {
      alert("Erro ao carregar reconhecimento facial. Verifique a conexão.");
      cancelarCapturaFace();
      return;
    }
  }

  const video = document.getElementById("video-face");
  try {
    faceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  } catch (e) {
    alert("Não foi possível acessar a câmera. Verifique as permissões.");
    cancelarCapturaFace();
    return;
  }
  video.srcObject = faceStream;
  await new Promise(r => { video.onloadedmetadata = r; });
  await video.play();

  document.getElementById("face-hint").textContent = "Posicione o rosto no oval e capture";
  document.getElementById("btn-capture-face").disabled = false;
}

function cancelarCapturaFace() {
  pararFaceStream();
  document.getElementById("face-overlay").style.display = "none";
}

function pararFaceStream() {
  if (faceStream) { faceStream.getTracks().forEach(t => t.stop()); faceStream = null; }
}

async function capturarFotoFace() {
  const video = document.getElementById("video-face");
  document.getElementById("face-hint").textContent = "Processando...";
  document.getElementById("btn-capture-face").disabled = true;

  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.5 });
  const det  = await faceapi.detectSingleFace(video, opts).withFaceLandmarks(true).withFaceDescriptor();

  if (!det) {
    document.getElementById("face-hint").textContent = "Nenhum rosto detectado. Tente novamente.";
    document.getElementById("btn-capture-face").disabled = false;
    return;
  }

  pendingFotoThumb = capturarThumbFace(video, det.detection.box);
  pendingFaceDescriptor = Array.from(det.descriptor);

  pararFaceStream();
  document.getElementById("face-overlay").style.display = "none";
  atualizarStatusFace();
}

function capturarThumbFace(video, box) {
  const canvas = document.createElement("canvas");
  const size = 120;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const vw = video.videoWidth;
  const sx = vw - box.x - box.width; // mirror X
  ctx.drawImage(video, sx, box.y, box.width, box.height, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function toggleAtivo(id) {
  const f = funcionariosCache[id];
  if (!f) return;
  const acao = f.ativo === false ? 'ATIVAR' : 'DESATIVAR';
  const senha = prompt(`${acao} funcionário?\n${f.nome}\n\nDigite a senha:`);
  if (senha === null) return;
  if (senha !== '4512') { alert('Senha incorreta.'); return; }
  col.doc(id).update({ ativo: f.ativo === false });
}

function excluir(id) {
  const f = funcionariosCache[id];
  if (!f) return;
  const senha = prompt(`EXCLUIR FUNCIONÁRIO?\n\n${f.nome} — ${f.cargo}\n\nDigite a senha:`);
  if (senha === null) return;
  if (senha !== "4512") { alert("Senha incorreta."); return; }
  col.doc(id).delete();
}

// ── Consultar ──────────────────────────────────────────────
let consultandoId = null;

function consultarFuncionario(id) {
  const f = funcionariosCache[id];
  if (!f) return;
  consultandoId = id;
  const c = (label, val) => val ? `<div class="cons-campo"><span class="cons-label">${escHtml(label)}</span><span class="cons-valor">${escHtml(val)}</span></div>` : '';
  const sec = title => `<div class="form-section-title">${title}</div><div class="cons-grid">`;
  const instrucao = [f.instrucao, f.instrucaoStatus].filter(Boolean).join(' — ');
  document.getElementById('consultar-body').innerHTML = `
    ${sec('Identificação')}
      ${c('Nome', f.nome)}${c('Cargo', f.cargo)}${c('Admissão', f.admissao)}
      ${ehPorProducao(f.cargo) ? `
        ${c('Remuneração', 'Por produção')}
        ${c('Salário de Referência', fmtMoeda(f.salarioReferencia))}
        ${c('Desconto Passagens (6%)', fmtMoeda(calcDescontoPassagens(f.salarioReferencia)))}
      ` : `
        ${c('Salário Bruto', fmtMoeda(f.salario))}
        ${f.descontos > 0 ? c('Descontos', f.descontos.toFixed(2).replace('.',',') + '%') : ''}
        ${c('Desconto Passagens (6%)', fmtMoeda(calcDescontoPassagens(f.salario)))}
        ${c('Valor Líquido', fmtMoeda(calcLiquido(f.salario, f.descontos)))}
        ${c('Diária ('+diasDoMes()+' dias)', fmtMoeda(calcDiaria(f.salario)))}
      `}
      ${c('Telefone', f.telefone)}${c('Observações', f.obs)}
      ${c('Passagens (15dd)', f.passagens > 0 ? fmtMoeda(f.passagens) : '')}
    </div>
    ${sec('Dados Pessoais')}
      ${c('Nacionalidade', f.nacionalidade)}${c('Estado Civil', f.estadocivil)}
      ${c('Nascimento', f.nascimento)}${c('Cônjuge', f.conjuge)}
      ${c('Local de Nascimento', f.localnasc)}${c('UF Nasc.', f.ufnasc)}
      ${c('Nome da Mãe', f.nomemae)}${c('Grau de Instrução', instrucao)}
    </div>
    ${sec('Documentos')}
      ${c('CPF', f.cpf)}${c('Identidade (RG)', f.rg)}
      ${c('Órgão Emissor', f.orgaoemissor)}${c('UF Identidade', f.ufrg)}
      ${c('Data Emissão RG', f.emissaorg)}${c('CTPS', f.ctps)}
      ${c('Série CTPS', f.seriectps)}${c('UF CTPS', f.ufctps)}
      ${c('Data Emissão CTPS', f.emissaoctps)}
    </div>
    ${sec('Endereço')}
      ${c('Endereço', f.endereco)}${c('CEP', f.cep)}
      ${c('Cidade', f.cidade)}${c('UF', f.uf)}
    </div>`;
  document.getElementById('consultar-overlay').style.display = 'flex';
}

function fecharConsultar() {
  document.getElementById('consultar-overlay').style.display = 'none';
  consultandoId = null;
}

function editarDoConsultar() {
  const id = consultandoId; // salva antes de fecharConsultar() zerá-lo
  fecharConsultar();
  editarFuncionario(id);
}

function irParaAssinaturaParaSalvar() {
  const erros = validarFormulario();
  if (erros.length) { alert('Campos obrigatórios incompletos ou inválidos:\n\n• ' + erros.join('\n• ')); return; }

  // Se editando e já tem assinatura salva, salva direto sem pedir nova assinatura
  if (editandoId && funcionariosCache[editandoId] && funcionariosCache[editandoId].assinatura) {
    const dados = lerCampos();
    if (pendingFaceDescriptor) { dados.faceDescriptor = pendingFaceDescriptor; dados.fotoThumb = pendingFotoThumb; }
    col.doc(editandoId).update(dados);
    editandoId = null;
    pendingFaceDescriptor = null;
    pendingFotoThumb = null;
    fecharFormulario();
    alert('Dados atualizados com sucesso!');
    return;
  }

  assinaturaOrigem = 'salvar';
  document.getElementById('btn-assin-acao').textContent = '✅ Assinar e Salvar';
  document.getElementById('form-overlay').style.display = 'none';
  document.getElementById('assin-overlay').style.display = 'flex';
  if (!_canvasInited) { initCanvas(); _canvasInited = true; }
  limparAssinatura();
}

function irParaAssinaturaDoConsultar() {
  const f = consultandoId ? funcionariosCache[consultandoId] : null;
  // Se já tem assinatura salva, gera o PDF diretamente sem mostrar tela de assinatura
  if (f && f.assinatura) {
    document.getElementById('consultar-overlay').style.display = 'none';
    gerarPDFComAssinatura(f, f.assinatura);
    document.getElementById('consultar-overlay').style.display = 'flex';
    return;
  }
  assinaturaOrigem = 'pdf';
  document.getElementById('btn-assin-acao').textContent = '✅ Assinar e Gerar Ficha';
  document.getElementById('consultar-overlay').style.display = 'none';
  document.getElementById('assin-overlay').style.display = 'flex';
  if (!_canvasInited) { initCanvas(); _canvasInited = true; }
  limparAssinatura();
}

function acaoAssinatura() {
  if (assinaturaOrigem === 'salvar') assinarESalvar();
  else assinarEGerarPDF();
}

function assinarESalvar() {
  if (canvasVazio()) { alert('Por favor, assine antes de salvar.'); return; }
  const dados = lerCampos();
  if (!dados.nome || !dados.cargo) { alert('Nome e Cargo são obrigatórios.'); return; }
  if (pendingFaceDescriptor) { dados.faceDescriptor = pendingFaceDescriptor; dados.fotoThumb = pendingFotoThumb; }
  const canvas = document.getElementById('assin-canvas');
  const assinatura = canvas.toDataURL('image/png');
  if (editandoId) {
    col.doc(editandoId).update({ ...dados, assinatura });
    editandoId = null;
  } else {
    col.add({ ...dados, assinatura, ativo: true, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
  }
  pendingFaceDescriptor = null;
  pendingFotoThumb = null;
  document.getElementById('assin-overlay').style.display = 'none';
  document.getElementById('fab').classList.remove('open');
  consultandoId = null;
  alert('Funcionário salvo com sucesso!');
}

function voltarDaAssinatura() {
  document.getElementById('assin-overlay').style.display = 'none';
  if (consultandoId) {
    document.getElementById('consultar-overlay').style.display = 'flex';
  } else {
    document.getElementById('form-overlay').style.display = 'flex';
  }
}

// ── Assinatura ────────────────────────────────────────────
let _canvasInited  = false;
let assinaturaOrigem = 'salvar'; // 'salvar' | 'pdf'

function initCanvas() {
  const canvas = document.getElementById("assin-canvas");
  const ctx    = canvas.getContext("2d");

  function resize() {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) return;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width  = w * window.devicePixelRatio;
    canvas.height = h * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = "#1a3322";
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
  }
  resize();

  let drawing = false;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  canvas.addEventListener("mousedown",  e => { drawing = true; ctx.beginPath(); const p = pos(e); ctx.moveTo(p.x, p.y); e.preventDefault(); });
  canvas.addEventListener("mousemove",  e => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); });
  canvas.addEventListener("mouseup",    () => drawing = false);
  canvas.addEventListener("mouseleave", () => drawing = false);
  canvas.addEventListener("touchstart", e => { drawing = true; ctx.beginPath(); const p = pos(e); ctx.moveTo(p.x, p.y); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove",  e => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend",   () => drawing = false);
}

function limparAssinatura() {
  const canvas = document.getElementById("assin-canvas");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function canvasVazio() {
  const canvas = document.getElementById('assin-canvas');
  return !canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some(v=>v!==0);
}

function assinarEGerarPDF() {
  if (canvasVazio()) { alert('Por favor, assine antes de gerar o PDF.'); return; }
  gerarPDF();
}

// ── PDF ───────────────────────────────────────────────────
function assinarEGerarPDF() {
  if (canvasVazio()) { alert('Por favor, assine antes de gerar a ficha.'); return; }
  const canvas  = document.getElementById('assin-canvas');
  const assinB64 = canvas.toDataURL('image/png');
  if (consultandoId) col.doc(consultandoId).update({ assinatura: assinB64 });
  document.getElementById('assin-overlay').style.display = 'none';
  const f = consultandoId ? { ...funcionariosCache[consultandoId], assinatura: assinB64 } : { ...lerCampos(), assinatura: assinB64 };
  gerarPDFComAssinatura(f);
}

function gerarPDFComAssinatura(dadosArg) {
  if (typeof window.jspdf === "undefined") { alert("Biblioteca PDF não carregada. Verifique sua conexão."); return; }
  const { jsPDF } = window.jspdf;
  const doc   = new jsPDF({ unit: "mm", format: "a4" });
  const dados = dadosArg || (consultandoId ? funcionariosCache[consultandoId] : lerCampos());
  if (!dados) return;
  const W    = 210;
  const mg   = 14;
  let y      = mg;

  // Cabeçalho
  doc.setFillColor(26, 51, 34);
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(165, 214, 167);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("GREEN WALL — CONSTRUÇÃO E ACABAMENTO", W / 2, 10, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("FICHA DE REGISTRO DE EMPREGADO", W / 2, 17, { align: "center" });

  y = 28;
  doc.setTextColor(0);

  function titulo(txt) {
    doc.setFillColor(232, 245, 233);
    doc.rect(mg, y, W - mg * 2, 6, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(26, 51, 34);
    doc.text(txt.toUpperCase(), mg + 2, y + 4.2);
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    y += 8;
  }

  function campo(label, valor, x, largura) {
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(120);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    doc.setFontSize(8.5);
    doc.text(valor || "—", x, y + 4.5);
    doc.setDrawColor(200);
    doc.line(x, y + 5.5, x + largura - 2, y + 5.5);
    doc.setDrawColor(0);
  }

  function linha2(l1, v1, l2, v2) {
    const half = (W - mg * 2 - 4) / 2;
    campo(l1, v1, mg, half);
    campo(l2, v2, mg + half + 4, half);
    y += 12;
  }

  function linha1(label, valor) {
    campo(label, valor, mg, W - mg * 2);
    y += 12;
  }

  titulo("Identificação");
  linha1("Nome Completo", dados.nome);
  linha2("Cargo", dados.cargo, "Admissão", dados.admissao);
  linha2("Salário / Diária", dados.salario > 0 ? fmtMoeda(dados.salario) : "Por produção", "Telefone", dados.telefone);

  titulo("Dados Pessoais");
  linha2("Nacionalidade", dados.nacionalidade, "Estado Civil", dados.estadocivil);
  linha2("Data de Nascimento", dados.nascimento, "Cônjuge", dados.conjuge);
  linha2("Local de Nascimento", dados.localnasc, "UF Nasc.", dados.ufnasc);
  linha1("Nome da Mãe", dados.nomemae);
  const instrucaoTxt = [dados.instrucao, dados.instrucaoStatus].filter(Boolean).join(" — ");
  linha2("Grau de Instrução", instrucaoTxt, "Obs", dados.obs);

  titulo("Documentos");
  linha2("CPF", dados.cpf, "Identidade (RG)", dados.rg);
  linha2("Órgão Emissor", dados.orgaoemissor, "UF / Data Emissão RG", `${dados.ufrg} — ${dados.emissaorg}`);
  linha2("CTPS", dados.ctps, "Série / UF / Emissão CTPS", `${dados.seriectps} / ${dados.ufctps} — ${dados.emissaoctps}`);

  titulo("Endereço");
  linha1("Endereço", dados.endereco);
  linha2("CEP", dados.cep, "Cidade / UF", `${dados.cidade} — ${dados.uf}`);

  // Assinatura
  y += 4;
  if (y > 240) { doc.addPage(); y = 20; }

  titulo("Assinatura");
  if (dados.assinatura) {
    doc.addImage(dados.assinatura, "PNG", mg, y, 80, 30);
  }

  doc.setDrawColor(100);
  doc.line(mg, y + 33, mg + 80, y + 33);
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(dados.nome || "Assinatura do Funcionário", mg + 40, y + 37, { align: "center" });

  // Data no rodapé
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(`Emitido em ${new Date().toLocaleDateString("pt-BR")}`, W - mg, 290, { align: "right" });

  const nomeArq = (dados.nome || "funcionario").replace(/\s+/g, "_").toLowerCase();
  doc.save(`ficha_${nomeArq}.pdf`);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}
