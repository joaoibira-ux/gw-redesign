const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const whatsappToken = defineSecret("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_ID = "1090526494154821";
const WHATSAPP_DESTINO = "5581992114764";
const SENHA_ALTERACAO_BANCO = "6535";

const PROMPT = `Esta imagem é um boletim/planilha de medição de obra (construção civil).

ESTRUTURA DA TABELA (colunas da esquerda para a direita):
ITEM | DESCRIÇÃO | UND | [bloco QUANTIDADES: Prevista no Contrato, Acumulado Anterior, Executado no Período, Acumulado] | PREÇOS UNITÁRIOS | [bloco PREÇOS: Contratado, Acumulado Anterior, Executado no Período, Acumulado] | % EXECUTADO

Abaixo da tabela de itens normalmente existem linhas de resumo, nesta ordem: "TOTAL", "VALORES A DESCONTAR" (geralmente destacada em vermelho) e "A PAGAR".

Extraia um objeto JSON com 4 campos:

1. "itens": para cada linha de item (ex: 1.1, 1.2, 1.12), extraia:
   - "apartamento": o número do item, exatamente como aparece na coluna ITEM (ex: "1.1", "1.12").
   - "servico": o texto da coluna DESCRIÇÃO.
   - "quantidade": o valor da coluna "Executado no Período" DENTRO DO BLOCO QUANTIDADES (m², unidades etc.) — é a 3ª das 4 colunas do bloco QUANTIDADES. Use ponto como separador decimal. Se não houver valor, use 0.
   - "valor": o valor em reais da coluna "Executado no Período" DENTRO DO BLOCO PREÇOS — é a 3ª das 4 colunas do bloco PREÇOS, vem logo depois de "Preços Unitários" e antes da última coluna "Acumulado" do bloco PREÇOS.

   ATENÇÃO: existem DUAS colunas chamadas "Executado no Período" — uma no bloco QUANTIDADES (números pequenos, m²/unidades) e outra no bloco PREÇOS (valores em R$). "quantidade" vem do bloco QUANTIDADES, "valor" vem do bloco PREÇOS. Não confunda com "Acumulado" (última coluna de cada bloco) nem com "Contratado".

   Regras para "itens":
   - "valor" e "quantidade": números decimais (use ponto como separador decimal, sem símbolos e sem separador de milhar).
   - Ignore linhas de cabeçalho e a linha de totais do "ITEM" pai (em negrito, sem descrição própria).
   - Ignore itens cujo "Executado no Período" (no bloco PREÇOS) seja "-", vazio ou igual a 0.

2. "total": o valor da linha "TOTAL", na coluna "Executado no Período" do bloco PREÇOS (geralmente é a soma dos valores de "itens").

3. "descontos": o valor da linha "VALORES A DESCONTAR" (geralmente destacada em vermelho). Se essa linha não existir, use 0.

4. "aPagar": o valor da linha "A PAGAR" (fica logo abaixo de "VALORES A DESCONTAR").

Todos os valores numéricos devem ser números decimais positivos (ponto como separador decimal, sem R$ e sem separador de milhar).

5. "descricaoBoletim": o valor do campo DESCRIÇÃO do cabeçalho do boletim (aparece no topo da folha junto com CNO, EMAIL, MÊS DA MEDIÇÃO). Ex: "Tratamento de superfície". Se não houver, use "".

Retorne APENAS um objeto JSON (sem texto antes ou depois, sem markdown) no seguinte formato:
{"descricaoBoletim":"Tratamento de superfície","itens":[{"apartamento":"1.1","servico":"Revestimento de gesso em pasta (Sala, área e quartos)","quantidade":80.00,"valor":14400.00}], "total":24959.70, "descontos":3352.00, "aPagar":21607.70}

Se não conseguir identificar a tabela, retorne {"descricaoBoletim":"","itens":[],"total":0,"descontos":0,"aPagar":0}.`;

// ── AGENTE GW ──────────────────────────────────────────────────────────────

const TOOLS_GW = [
  {
    name: "listar_funcionarios",
    description: "Lista todos os funcionários cadastrados no sistema GW",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "registrar_ponto",
    description: "Registra entrada ou saída de um funcionário no ponto eletrônico. ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        funcionarioId:   { type: "string", description: "ID do funcionário" },
        funcionarioNome: { type: "string", description: "Nome completo do funcionário" },
        tipo:            { type: "string", enum: ["entrada", "saida"] },
        data:            { type: "string", description: "Data YYYY-MM-DD (horário de Brasília). Se omitida, usa a data de hoje." },
        horario:         { type: "string", description: "Horário HH:MM (horário de Brasília). Se omitido, usa a hora atual." },
        senha:           { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["funcionarioId", "funcionarioNome", "tipo", "senha"]
    }
  },
  {
    name: "consultar_ponto",
    description: "Consulta registros de ponto em uma data. Se funcionarioId for omitido, retorna os registros de TODOS os funcionários naquela data (use para perguntas como 'quem bateu ponto hoje' ou 'ponto de todos').",
    input_schema: {
      type: "object",
      properties: {
        funcionarioId: { type: "string", description: "ID do funcionário. Omita para consultar todos os funcionários." },
        data: { type: "string", description: "Data YYYY-MM-DD (padrão: hoje)" }
      }
    }
  },
  {
    name: "cancelar_ponto",
    description: "Cancela (exclui) um registro de ponto já existente. Use consultar_ponto antes para obter o id do registro correto. ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        id:    { type: "string", description: "ID do registro de ponto (obtido via consultar_ponto)" },
        senha: { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["id", "senha"]
    }
  },
  {
    name: "editar_ponto",
    description: "Edita um registro de ponto já existente (tipo, data e/ou horário). Use consultar_ponto antes para obter o id do registro correto e confirme com o usuário o que vai mudar antes de aplicar. Internamente substitui o registro antigo por um novo e mantém um histórico da alteração. ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        id:      { type: "string", description: "ID do registro de ponto a editar (obtido via consultar_ponto)" },
        tipo:    { type: "string", enum: ["entrada", "saida"], description: "Novo tipo (omita para manter o atual)" },
        data:    { type: "string", description: "Nova data YYYY-MM-DD (omita para manter a atual)" },
        horario: { type: "string", description: "Novo horário HH:MM (omita para manter o atual)" },
        senha:   { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["id", "senha"]
    }
  },
  {
    name: "listar_servicos",
    description: "Lista todos os serviços cadastrados no sistema GW com seus preços (M.d.o, Medição, Material). Use antes de editar_servico para obter o id do serviço correto.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "editar_servico",
    description: "Edita os preços (mdo, medicao, material) ou observação de um serviço cadastrado. Use listar_servicos antes para obter o id correto. Atualiza também os valores da folha de pagamento aberta, se houver. ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        id:       { type: "string", description: "ID do serviço (obtido via listar_servicos)" },
        mdo:      { type: "number", description: "Novo valor de M.d.o / Apt. em reais (omita para não alterar)" },
        medicao:  { type: "number", description: "Novo valor de Medição / Apt. em reais (omita para não alterar)" },
        material: { type: "number", description: "Novo valor de Material / Apt. em reais (omita para não alterar)" },
        obs:      { type: "string", description: "Nova observação (omita para não alterar)" },
        senha:    { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["id", "senha"]
    }
  },
  {
    name: "consultar_caixa",
    description: "Consulta lançamentos do caixa (entradas e saídas) com filtros opcionais por período, origem ou palavra-chave na descrição. Também calcula saldo.",
    input_schema: {
      type: "object",
      properties: {
        data_inicio: { type: "string", description: "Data inicial DD/MM/YYYY (opcional)" },
        data_fim:    { type: "string", description: "Data final DD/MM/YYYY (opcional)" },
        origem:      { type: "string", description: "Filtrar por origem (ex: JOAO, CEF, ANE) — opcional" },
        busca:       { type: "string", description: "Palavra-chave para buscar na descrição — opcional" },
        resumo:      { type: "boolean", description: "Se true, retorna apenas totais (entradas, saídas, saldo) sem listar cada lançamento" }
      }
    }
  },
  {
    name: "criar_lancamento_caixa",
    description: "Cria um novo lançamento no caixa (entrada ou saída). ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        data:      { type: "string", description: "Data do lançamento no formato DD/MM/YYYY" },
        origem:    { type: "string", description: "Origem do lançamento (ex: JOAO, ANE, CEF)" },
        descricao: { type: "string", description: "Descrição do lançamento" },
        entrada:   { type: "number", description: "Valor de entrada (0 se for uma saída)" },
        saida:     { type: "number", description: "Valor de saída (0 se for uma entrada)" },
        senha:     { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["data", "origem", "descricao", "senha"]
    }
  },
  {
    name: "editar_lancamento_caixa",
    description: "Edita um lançamento do caixa já existente. Use consultar_caixa antes para obter o id do lançamento correto. ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        id:        { type: "string", description: "ID do lançamento (obtido via consultar_caixa)" },
        data:      { type: "string", description: "Nova data DD/MM/YYYY (opcional, mantém se omitido)" },
        origem:    { type: "string", description: "Nova origem (opcional)" },
        descricao: { type: "string", description: "Nova descrição (opcional)" },
        entrada:   { type: "number", description: "Novo valor de entrada (opcional)" },
        saida:     { type: "number", description: "Novo valor de saída (opcional)" },
        senha:     { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["id", "senha"]
    }
  },
  {
    name: "excluir_lancamento_caixa",
    description: "Exclui um lançamento do caixa já existente. Use consultar_caixa antes para obter o id do lançamento correto. ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        id:    { type: "string", description: "ID do lançamento (obtido via consultar_caixa)" },
        senha: { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["id", "senha"]
    }
  },
  {
    name: "consultar_servicos_funcionario",
    description: "Consulta os serviços executados por um funcionário no Mapa de Obra. Também pode filtrar por local/apartamento.",
    input_schema: {
      type: "object",
      properties: {
        funcionarioNome: { type: "string", description: "Nome (parcial ou completo) do funcionário. Opcional se local for informado." },
        local: { type: "string", description: "Identificação do local/apartamento (ex: BM 06, BM06, BM006 — todas as variações funcionam)" },
        status: { type: "string", enum: ["concluido", "em_pagamento", "todos"], description: "Filtro de status (padrão: concluido)" }
      }
    }
  }
];

function normCodigo(s) {
  // normaliza "BM 06", "BM06", "BM006", "Bm 06" → "bm6"
  return String(s).toLowerCase()
    .replace(/\s+/g, "")                      // remove espaços
    .replace(/([a-z]+)0*(\d+)/g, "$1$2");     // remove zeros à esquerda do número
}

async function executarFerramenta(nome, input) {
  if (nome === "listar_funcionarios") {
    const snap = await db.collection("funcionarios").orderBy("nome").get();
    return snap.docs.map(d => ({ id: d.id, nome: d.data().nome }));
  }

  if (nome === "registrar_ponto") {
    const { funcionarioId, funcionarioNome, tipo, data, horario, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const dataBase = data
      ? new Date(data + "T00:00:00-03:00")
      : new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) + "T00:00:00-03:00");

    let timestamp;
    if (horario) {
      const [h, m] = horario.split(":").map(Number);
      timestamp = new Date(dataBase.getTime() + h * 3600000 + m * 60000);
    } else if (data) {
      const agora = new Date();
      timestamp = new Date(dataBase.getTime() + (agora.getUTCHours() * 3600000 + agora.getUTCMinutes() * 60000 + agora.getUTCSeconds() * 1000));
    } else {
      timestamp = new Date();
    }

    const diaInicio = dataBase;
    const diaFim = new Date(dataBase.getTime() + 24 * 3600000 - 1);
    const existente = await db.collection("pontos")
      .where("funcionarioId", "==", funcionarioId)
      .where("tipo", "==", tipo)
      .where("timestamp", ">=", diaInicio)
      .where("timestamp", "<=", diaFim)
      .limit(1).get();

    if (!existente.empty) {
      const docId = existente.docs[0].id;
      await db.collection("pontos").doc(docId).update({ timestamp });
      return { sucesso: true, id: docId, funcionarioNome, tipo, horario: horario || "hora atual", acao: "atualizado" };
    }

    const ref = await db.collection("pontos").add({ funcionarioId, funcionarioNome, tipo, timestamp, localizacao: null });
    return { sucesso: true, id: ref.id, funcionarioNome, tipo, horario: horario || "hora atual", acao: "criado" };
  }

  if (nome === "consultar_ponto") {
    const { funcionarioId, data } = input;
    const dataRef = data ? new Date(data + "T00:00:00-03:00") : new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00-03:00");
    const dataFim = new Date(dataRef); dataFim.setHours(23, 59, 59, 999);

    if (!funcionarioId) {
      const snapTodos = await db.collection("pontos")
        .where("timestamp", ">=", dataRef)
        .where("timestamp", "<=", dataFim)
        .orderBy("timestamp").get();
      if (snapTodos.empty) return { registros: [], mensagem: "Nenhum registro de ponto nessa data." };
      return snapTodos.docs.map(d => {
        const dd = d.data();
        const ts = dd.timestamp.toDate();
        const hora = ts.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
        return { id: d.id, funcionarioId: dd.funcionarioId, funcionarioNome: dd.funcionarioNome, tipo: dd.tipo, hora };
      });
    }

    const snap = await db.collection("pontos")
      .where("funcionarioId", "==", funcionarioId)
      .where("timestamp", ">=", dataRef)
      .where("timestamp", "<=", dataFim)
      .orderBy("timestamp").get();
    return snap.docs.map(d => {
      const dd = d.data();
      const ts = dd.timestamp.toDate();
      const hora = ts.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      return { id: d.id, tipo: dd.tipo, hora };
    });
  }

  if (nome === "cancelar_ponto") {
    const { id, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = db.collection("pontos").doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { sucesso: false, erro: "nao_encontrado", mensagem: "Registro de ponto não encontrado." };

    await ref.delete();
    return { sucesso: true, id };
  }

  if (nome === "editar_ponto") {
    const { id, tipo, data, horario, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = db.collection("pontos").doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { sucesso: false, erro: "nao_encontrado", mensagem: "Registro de ponto não encontrado." };
    const antigo = doc.data();

    const dataBase = data
      ? new Date(data + "T00:00:00-03:00")
      : new Date(antigo.timestamp.toDate().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) + "T00:00:00-03:00");

    let horaRef = horario;
    if (!horaRef) {
      horaRef = antigo.timestamp.toDate().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    }
    const [h, m] = horaRef.split(":").map(Number);
    const novoTimestamp = new Date(dataBase.getTime() + h * 3600000 + m * 60000);
    const novoTipo = tipo || antigo.tipo;

    await db.collection("pontosHistorico").add({
      acao: "editado",
      funcionarioId: antigo.funcionarioId,
      funcionarioNome: antigo.funcionarioNome,
      registroAnterior: { tipo: antigo.tipo, timestamp: antigo.timestamp },
      registroNovo: { tipo: novoTipo, timestamp: novoTimestamp },
      realizadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    await ref.delete();
    const novoRef = await db.collection("pontos").add({
      funcionarioId: antigo.funcionarioId,
      funcionarioNome: antigo.funcionarioNome,
      tipo: novoTipo,
      timestamp: novoTimestamp,
      localizacao: antigo.localizacao || null
    });

    const novaHora = novoTimestamp.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    const novaData = novoTimestamp.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return { sucesso: true, idAntigo: id, idNovo: novoRef.id, funcionarioNome: antigo.funcionarioNome, tipo: novoTipo, data: novaData, horario: novaHora };
  }

  if (nome === "listar_servicos") {
    const snap = await db.collection("servicos").get();
    return snap.docs
      .map(d => {
        const s = d.data();
        return { id: d.id, item: s.item || "", nome: s.nome || "", mdo: s.mdo || 0, medicao: s.medicao || 0, material: s.material || 0, obs: s.obs || "" };
      })
      .sort((a, b) => (parseFloat(a.item) || 999) - (parseFloat(b.item) || 999));
  }

  if (nome === "editar_servico") {
    const { id, mdo, medicao, material, obs, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = db.collection("servicos").doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { sucesso: false, erro: "nao_encontrado", mensagem: "Serviço não encontrado com esse id." };

    const atual = doc.data();
    const updates = {};
    if (mdo      !== undefined) updates.mdo      = mdo;
    if (medicao  !== undefined) updates.medicao  = medicao;
    if (material !== undefined) updates.material = material;
    if (obs      !== undefined) updates.obs      = obs;
    if (!Object.keys(updates).length) {
      return { sucesso: false, erro: "nada_alterado", mensagem: "Nenhum campo para atualizar foi fornecido." };
    }

    await ref.update(updates);

    // Se o mdo mudou, atualiza entradas correspondentes na folha aberta mais recente
    let folhaAtualizada = false;
    if (mdo !== undefined && mdo !== atual.mdo) {
      const nomeServico = atual.nome || "";
      const fSnap = await db.collection("folhas").orderBy("criadoEm", "desc").limit(1).get();
      if (!fSnap.empty) {
        const fDoc = fSnap.docs[0];
        const grupos = (fDoc.data().grupos || []).map(g => {
          const novosItens = (g.itens || []).map(item => {
            if (!item.firestoreLocalId) return item;
            if (item.servico !== nomeServico) return item;
            folhaAtualizada = true;
            return { ...item, valor: mdo };
          });
          const novoSubtotal = novosItens.reduce((s, it) => s + Number(it.valor || 0), 0);
          return { ...g, itens: novosItens, subtotal: novoSubtotal };
        });
        if (folhaAtualizada) {
          const totalGeral = grupos.reduce((s, g) => s + (g.subtotal || 0), 0);
          await fDoc.ref.update({ grupos, totalGeral });
        }
      }
    }

    return {
      sucesso: true,
      id,
      nome: atual.nome,
      alteracoes: updates,
      folhaAtualizada,
      mensagem: folhaAtualizada
        ? `"${atual.nome}" atualizado. A folha aberta também foi ajustada com o novo valor.`
        : `"${atual.nome}" atualizado com sucesso.`
    };
  }

  if (nome === "consultar_caixa") {
    const { data_inicio, data_fim, origem, busca, resumo } = input;

    const parseDMY = (s) => {
      if (!s) return null;
      const [d, m, y] = s.split("/").map(Number);
      return new Date(y, m - 1, d);
    };

    const snap = await db.collection("lancamentos").orderBy("criadoEm", "desc").get();
    let itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (data_inicio || data_fim) {
      const di = parseDMY(data_inicio);
      const df = data_fim ? new Date(parseDMY(data_fim).setHours(23,59,59,999)) : null;
      itens = itens.filter(l => {
        const [dd, mm, yy] = (l.data || "").split("/").map(Number);
        const ld = new Date(yy, mm - 1, dd);
        if (di && ld < di) return false;
        if (df && ld > df) return false;
        return true;
      });
    }

    if (origem) {
      itens = itens.filter(l => (l.origem || "").toLowerCase().includes(origem.toLowerCase()));
    }

    if (busca) {
      const buscaNorm = normCodigo(busca);
      itens = itens.filter(l => {
        const desc = l.descricao || "";
        if (desc.toLowerCase().includes(busca.toLowerCase())) return true;
        if (normCodigo(desc).includes(buscaNorm)) return true;
        return false;
      });
    }

    const totalEntradas = itens.reduce((s, l) => s + (Number(l.entrada) || 0), 0);
    const totalSaidas   = itens.reduce((s, l) => s + (Number(l.saida)   || 0), 0);
    const saldo = totalEntradas - totalSaidas;

    if (resumo) {
      return { totalEntradas, totalSaidas, saldo, quantidade: itens.length };
    }

    return {
      lancamentos: itens.slice(0, 50).map(l => ({
        id: l.id,
        data: l.data,
        descricao: l.descricao,
        entrada: Number(l.entrada) || 0,
        saida:   Number(l.saida)   || 0,
        origem:  l.origem || ""
      })),
      totalEntradas,
      totalSaidas,
      saldo,
      quantidade: itens.length
    };
  }

  if (nome === "criar_lancamento_caixa") {
    const { data, origem, descricao, entrada, saida, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = await db.collection("lancamentos").add({
      data,
      origem: (origem || "").toUpperCase(),
      descricao: descricao || "",
      entrada: Number(entrada) || 0,
      saida: Number(saida) || 0,
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    return { sucesso: true, id: ref.id };
  }

  if (nome === "editar_lancamento_caixa") {
    const { id, data, origem, descricao, entrada, saida, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = db.collection("lancamentos").doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { sucesso: false, erro: "nao_encontrado", mensagem: "Lançamento não encontrado." };

    const updates = {};
    if (data !== undefined) updates.data = data;
    if (origem !== undefined) updates.origem = origem.toUpperCase();
    if (descricao !== undefined) updates.descricao = descricao;
    if (entrada !== undefined) updates.entrada = Number(entrada) || 0;
    if (saida !== undefined) updates.saida = Number(saida) || 0;

    await ref.update(updates);
    return { sucesso: true, id };
  }

  if (nome === "excluir_lancamento_caixa") {
    const { id, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = db.collection("lancamentos").doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { sucesso: false, erro: "nao_encontrado", mensagem: "Lançamento não encontrado." };

    await ref.delete();
    return { sucesso: true, id };
  }

  if (nome === "consultar_servicos_funcionario") {
    const { funcionarioNome, local, status = "concluido" } = input;
    const localNorm = local ? normCodigo(local) : null;
    const snap = await db.collection("locais").get();
    const resultados = [];
    snap.docs.forEach(doc => {
      const ident = doc.data().identificacao || doc.id;
      if (localNorm && normCodigo(ident) !== localNorm) return;
      const servicos = doc.data().servicos || [];
      servicos.forEach(s => {
        const execNome = s.executor && s.executor.nome ? s.executor.nome : (s.funcionario && s.funcionario.nome ? s.funcionario.nome : "");
        if (funcionarioNome && !execNome.toLowerCase().includes(funcionarioNome.toLowerCase())) return;
        if (status !== "todos" && s.status !== status) return;
        resultados.push({ local: ident, servico: s.nome, status: s.status, dataPagamento: s.dataPagamento || "", valorPago: s.valorPago || 0 });
      });
    });
    return resultados;
  }

  return { erro: "ferramenta desconhecida" };
}

exports.agenteGW = onCall(
  { secrets: [anthropicApiKey], timeoutSeconds: 120, memory: "512MiB", cors: true, invoker: "public" },
  async (request) => {
    const { mensagem, historico = [] } = request.data || {};
    if (!mensagem) throw new HttpsError("invalid-argument", "mensagem é obrigatória.");

    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const hojeISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

    const systemPrompt = `Você é o assistente do Sistema GW Revestimentos, empresa de gesso e revestimento.
Hoje é ${hoje} (${hojeISO}).
Responda sempre em português brasileiro, de forma direta e confirmando o que foi feito.
Quando o usuário mencionar um nome incompleto de funcionário, use listar_funcionarios primeiro para encontrar o ID correto.
CRÍTICO: funcionarioId é sempre o ID real gerado pelo Firestore (retornado por listar_funcionarios), nunca um valor inventado a partir do nome (ex: "lucas.cristiano" ou "3" NÃO são funcionarioId válidos). Antes de chamar registrar_ponto ou editar_ponto, sempre confirme o funcionarioId real chamando listar_funcionarios — a menos que esse ID já tenha sido retornado por listar_funcionarios nesta mesma conversa. Nunca presuma ou monte um ID.
Códigos de locais/apartamentos (ex: BM 06, BM06, BM006, BM 006, Bm 06) são equivalentes — passe o código exatamente como o usuário digitou, o sistema normaliza automaticamente.
IMPORTANTE: qualquer ferramenta que altere o banco de dados (ex: registrar_ponto, editar_ponto, cancelar_ponto, criar_lancamento_caixa, editar_lancamento_caixa, excluir_lancamento_caixa) exige uma senha de autorização. Antes de chamar essa ferramenta, sempre pergunte ao usuário "Qual a senha de autorização para alterar o banco de dados?" e só prossiga depois que ele informar a senha. Nunca invente, sugira ou revele a senha.
Para editar ou excluir um lançamento do caixa, use consultar_caixa primeiro para encontrar o id correto e confirme com o usuário qual lançamento é (data, descrição e valor) antes de aplicar a alteração.
Para cancelar um registro de ponto, use consultar_ponto primeiro para encontrar o id correto e confirme com o usuário qual registro é (funcionário, tipo e horário) antes de cancelar.
Para corrigir um registro de ponto já existente (mudar data, horário ou tipo), use editar_ponto com o id obtido via consultar_ponto — NÃO cancele e registre de novo manualmente em duas chamadas separadas; editar_ponto já faz isso internamente (substitui o registro e guarda um histórico da alteração).
Quando o usuário pedir para registrar ponto em uma data diferente de hoje (ex: "registre a saída de fulano dia 27/06"), SEMPRE preencha o campo "data" de registrar_ponto com essa data — nunca deixe em branco, senão o registro cai na data de hoje por engano.
Quando o usuário pedir o ponto de "todos", "todos os funcionários" ou não especificar um funcionário, chame consultar_ponto UMA ÚNICA VEZ sem o campo funcionarioId — essa ferramenta já retorna os registros de todos de uma vez. NUNCA chame consultar_ponto repetidamente por funcionário para montar essa lista.`;

    const messages = [
      ...historico.slice(-8),
      { role: "user", content: mensagem }
    ];

    const chamarClaude = (msgs) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey.value(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, system: systemPrompt, tools: TOOLS_GW, messages: msgs })
    }).then(r => r.json());

    let msgs = [...messages];
    let resposta = "";

    for (let rodada = 0; rodada < 5; rodada++) {
      const data = await chamarClaude(msgs);

      if (data.stop_reason === "end_turn") {
        resposta = (data.content.find(b => b.type === "text") || {}).text || "Feito.";
        break;
      }

      if (data.stop_reason === "tool_use") {
        const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
        msgs.push({ role: "assistant", content: data.content });

        const toolResults = await Promise.all(toolUseBlocks.map(async b => {
          const resultado = await executarFerramenta(b.name, b.input);
          return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(resultado) };
        }));

        msgs.push({ role: "user", content: toolResults });
        continue;
      }

      resposta = (data.content && data.content.find(b => b.type === "text") || {}).text || "Não entendi.";
      break;
    }

    const novoHistorico = [...messages, { role: "assistant", content: resposta }];
    return { resposta, historico: novoHistorico };
  }
);

exports.extrairMedicoes = onCall(
  { secrets: [anthropicApiKey], timeoutSeconds: 60, memory: "512MiB", cors: true, invoker: "public" },
  async (request) => {
    const { imageBase64, mimeType } = request.data || {};

    if (!imageBase64 || typeof imageBase64 !== "string") {
      throw new HttpsError("invalid-argument", "imageBase64 é obrigatório.");
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey.value(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType || "image/jpeg",
                data: imageBase64
              }
            },
            { type: "text", text: PROMPT }
          ]
        }]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Erro na API Anthropic:", resp.status, errText);
      throw new HttpsError("internal", "Erro ao consultar a IA (status " + resp.status + ").");
    }

    const data = await resp.json();
    const texto = (data.content && data.content[0] && data.content[0].text) || "";

    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("Resposta sem JSON:", texto);
      throw new HttpsError("internal", "Não foi possível interpretar a resposta da IA.");
    }

    let resultado;
    try {
      resultado = JSON.parse(match[0]);
    } catch (e) {
      console.error("JSON inválido:", match[0]);
      throw new HttpsError("internal", "A IA retornou um formato inválido.");
    }

    const ehTratamento = String(resultado.descricaoBoletim || "")
      .toLowerCase().includes("tratamento de superf");

    const itens = (resultado.itens || [])
      .map(it => {
        let ap = String(it.apartamento || "").trim();
        if (ehTratamento && ap === "1.1") ap = "1.0";
        return {
          apartamento: ap,
          servico: String(it.servico || "").trim(),
          quantidade: Number(it.quantidade) || 0,
          valor: Number(it.valor) || 0
        };
      })
      .filter(it => it.apartamento && it.servico && it.valor !== 0);

    return {
      itens,
      total: Number(resultado.total) || 0,
      descontos: Number(resultado.descontos) || 0,
      aPagar: Number(resultado.aPagar) || 0
    };
  }
);

exports.relatorioPontoWhatsApp = onCall(
  { secrets: [whatsappToken], cors: true, invoker: "public" },
  async () => {
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const statusRef = db.collection("relatoriosPonto").doc(hoje);
    const statusDoc = await statusRef.get();
    if (statusDoc.exists && statusDoc.data().enviado) {
      return { enviado: false, motivo: "ja_enviado" };
    }

    const dataInicio = new Date(hoje + "T00:00:00-03:00");
    const dataFim = new Date(hoje + "T23:59:59-03:00");
    const snap = await db.collection("pontos")
      .where("tipo", "==", "entrada")
      .where("timestamp", ">=", dataInicio)
      .where("timestamp", "<=", dataFim)
      .orderBy("timestamp")
      .get();

    if (snap.empty) {
      return { enviado: false, motivo: "sem_entradas" };
    }

    const texto = snap.docs.map(d => {
      const x = d.data();
      const hora = x.timestamp.toDate().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      return `${x.funcionarioNome} - Entrada ${hora}`;
    }).join(" "); // WhatsApp rejeita quebra de linha literal em parametros de template

    const resp = await fetch(`https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${whatsappToken.value()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: WHATSAPP_DESTINO,
        type: "template",
        template: {
          name: "relatorio_ponto_diario",
          language: { code: "pt_BR" },
          components: [{ type: "body", parameters: [{ type: "text", parameter_name: "relatorio", text: texto }] }]
        }
      })
    });

    const respText = await resp.text();
    let result;
    try { result = JSON.parse(respText); } catch { result = null; }
    if (!resp.ok || !result) {
      console.error("Erro ao enviar WhatsApp:", resp.status, respText.slice(0, 500));
      throw new HttpsError("internal", "Falha ao enviar WhatsApp: " + (result?.error?.message || `status ${resp.status}`));
    }

    await statusRef.set({ enviado: true, enviadoEm: admin.firestore.FieldValue.serverTimestamp(), totalEntradas: snap.size });
    return { enviado: true, total: snap.size };
  }
);
