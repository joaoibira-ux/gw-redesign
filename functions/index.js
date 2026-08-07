const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const whatsappToken = defineSecret("WHATSAPP_TOKEN");
const evolutionApiKey = defineSecret("EVOLUTION_API_KEY");
const WHATSAPP_PHONE_ID = "1090526494154821";
const WHATSAPP_DESTINO = "5581992114764";
const EVOLUTION_API_URL = "http://136.114.108.31:8080";
const EVOLUTION_INSTANCE = "gw";
const EVOLUTION_DESTINATARIOS = ["5581992114764", "5581988310203"];
const EVOLUTION_DESTINATARIOS_ADIANTAMENTO = ["5581992114764", "5581993697990"];
const EVOLUTION_DESTINATARIOS_REFEICOES = ["5581992114764", "5581991725267"];
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
    name: "consultar_ponto_periodo",
    description: "Consulta registros de ponto em um intervalo de datas (ex: 'essa semana', 'de 21 a 24 de julho', 'semana passada'). Retorna os registros agrupados por dia, incluindo os dias sem nenhum registro. Use esta ferramenta — em vez de chamar consultar_ponto várias vezes ou responder de memória — sempre que o usuário pedir ponto de mais de um dia.",
    input_schema: {
      type: "object",
      properties: {
        funcionarioId: { type: "string", description: "ID do funcionário. Omita para consultar todos os funcionários no período." },
        data_inicio: { type: "string", description: "Data inicial do período, formato YYYY-MM-DD" },
        data_fim: { type: "string", description: "Data final do período, formato YYYY-MM-DD" }
      },
      required: ["data_inicio", "data_fim"]
    }
  },
  {
    name: "ultimo_registro_ponto",
    description: "Busca o último registro de ponto (entrada ou saída, o mais recente independente da data) de um funcionário específico, incluindo data, horário e localização GPS de onde foi registrado (se disponível). Use listar_funcionarios antes para obter o funcionarioId correto. Use para perguntas como 'quando fulano bateu ponto pela última vez' ou 'qual a localização do último ponto de fulano'.",
    input_schema: {
      type: "object",
      properties: {
        funcionarioId: { type: "string", description: "ID do funcionário (obtido via listar_funcionarios)" }
      },
      required: ["funcionarioId"]
    }
  },
  {
    name: "extrato_refeicoes",
    description: "Gera o extrato de refeições (café da manhã e almoço) de um período, baseado nos registros de ponto. Para cada dia do período, conta quantos funcionários registraram a entrada antes das 7h (café da manhã) e quantos registraram antes das 10:30 (almoço — inclui quem já tomou café). Café custa R$10 e almoço R$15 por funcionário. Use quando o usuário pedir 'extrato das refeições', 'gasto com café e almoço' ou similar, em formato de texto/números.",
    input_schema: {
      type: "object",
      properties: {
        data_inicio: { type: "string", description: "Data inicial do período, formato YYYY-MM-DD" },
        data_fim:    { type: "string", description: "Data final do período, formato YYYY-MM-DD" }
      },
      required: ["data_inicio", "data_fim"]
    }
  },
  {
    name: "extrato_refeicoes_imagem",
    description: "Gera o extrato de refeições (mesmo cálculo de extrato_refeicoes) como uma imagem PNG estilizada com a logo da GW e envia pelo Telegram, pronta para encaminhar. Use quando o usuário pedir a imagem/arte do extrato, ou para 'enviar pelo Telegram', em vez da versão em texto. Depois de enviar com sucesso, SEMPRE pergunte ao usuário se ele quer registrar esse valor total no Contas a Pagar (ver registrar_pagamento_refeicoes) — a menos que o resultado já traga 'periodosJaPagos' preenchido, caso em que avise antes que esse período (ou parte dele) já foi pago.",
    input_schema: {
      type: "object",
      properties: {
        data_inicio: { type: "string", description: "Data inicial do período, formato YYYY-MM-DD" },
        data_fim:    { type: "string", description: "Data final do período, formato YYYY-MM-DD" }
      },
      required: ["data_inicio", "data_fim"]
    }
  },
  {
    name: "extrato_ponto_individual_imagem",
    description: "Gera o extrato de ponto (entrada, saída e horas trabalhadas por dia) de UM funcionário específico num período, como imagem PNG estilizada com a logo da GW (mesmo estilo visual do extrato_refeicoes_imagem) e envia pelo Telegram. Marca automaticamente como FALTA qualquer dia em que outros funcionários bateram ponto e esse não (dias sem ninguém trabalhando, como fim de semana, não contam falta). Saídas fechadas automaticamente pelo sistema às 14h (funcionário esqueceu de bater saída) aparecem marcadas com *, não como horário real. Use listar_funcionarios antes para obter o funcionarioId correto — NUNCA invente um id. Use quando o usuário pedir o relatório/espelho de ponto de uma pessoa específica num período, em imagem ou pelo Telegram.",
    input_schema: {
      type: "object",
      properties: {
        funcionarioId: { type: "string", description: "ID do funcionário (obtido via listar_funcionarios)" },
        data_inicio:   { type: "string", description: "Data inicial do período, formato YYYY-MM-DD" },
        data_fim:      { type: "string", description: "Data final do período, formato YYYY-MM-DD" }
      },
      required: ["funcionarioId", "data_inicio", "data_fim"]
    }
  },
  {
    name: "registrar_pagamento_refeicoes",
    description: "Cria um lançamento no Contas a Pagar com o valor total do extrato de refeições de um período, e marca esse período como pago (fica registrado pra qualquer consulta futura que envolva esse período, ou parte dele, avisar que já foi pago — evita pagar em dobro). Recalcula o extrato do zero a partir do período informado, não confia em números ditos antes na conversa. ALTERA O BANCO DE DADOS: exige senha de autorização, peça ao usuário antes de chamar. Só chame depois que o usuário confirmar explicitamente que quer registrar (normalmente depois de extrato_refeicoes_imagem).",
    input_schema: {
      type: "object",
      properties: {
        data_inicio: { type: "string", description: "Data inicial do período, formato YYYY-MM-DD" },
        data_fim:    { type: "string", description: "Data final do período, formato YYYY-MM-DD" },
        senha:       { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["data_inicio", "data_fim", "senha"]
    }
  },
  {
    name: "consultar_contas_pagar",
    description: "Consulta lançamentos do Contas a Pagar, com filtros opcionais por status ou palavra-chave na descrição. Use antes de editar_conta_pagar pra encontrar o id correto.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filtrar por status: 'aberto' ou 'baixado' (opcional — sem isso, traz os dois)" },
        busca:  { type: "string", description: "Palavra-chave para buscar na descrição (opcional)" }
      }
    }
  },
  {
    name: "editar_conta_pagar",
    description: "Edita a descrição e/ou o valor (ou data/status) de um lançamento já existente no Contas a Pagar. Use consultar_contas_pagar antes para obter o id correto (NUNCA invente um id como '1', '2', '3' — só o id exato retornado por consultar_contas_pagar é válido) e confirme com o usuário qual lançamento é (descrição e valor atuais) antes de aplicar a alteração. Pra marcar como pago/quitado, prefira dar_baixa_conta_pagar (mais direto). ALTERA O BANCO DE DADOS: exige senha de autorização, peça ao usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        id:        { type: "string", description: "ID do lançamento (obtido via consultar_contas_pagar)" },
        descricao: { type: "string", description: "Nova descrição (opcional, mantém a atual se omitido)" },
        valor:     { type: "number", description: "Novo valor (opcional, mantém o atual se omitido)" },
        data:      { type: "string", description: "Nova data DD/MM/YYYY (opcional, mantém a atual se omitido)" },
        status:    { type: "string", description: "Novo status: 'aberto' ou 'baixado' (opcional, mantém o atual se omitido)" },
        senha:     { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["id", "senha"]
    }
  },
  {
    name: "dar_baixa_conta_pagar",
    description: "Marca UM lançamento do Contas a Pagar como pago (status 'baixado'). Use quando o usuário pedir pra 'dar baixa', 'marcar como pago' ou 'quitar' um lançamento. Use consultar_contas_pagar ANTES pra obter o id real (NUNCA invente um id como '1', '2', '3' — só o id exato retornado por consultar_contas_pagar é válido) e confirme com o usuário qual lançamento é (descrição e valor) antes de aplicar. Se o usuário pedir baixa em MAIS DE UM lançamento, chame esta ferramenta UMA VEZ PARA CADA um deles, com o id real de cada — nunca responda como se tivesse dado baixa em algo sem ter chamado a ferramenta pra aquele item específico. ALTERA O BANCO DE DADOS: exige senha de autorização, peça ao usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        id:    { type: "string", description: "ID do lançamento (obtido via consultar_contas_pagar — nunca invente)" },
        senha: { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["id", "senha"]
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
    name: "gerar_planilha_medicoes",
    description: "Gera uma planilha Excel (.xlsx) com o resumo e os itens dos boletins de medição BM01 até BM09 (ignora boletins de Tratamento de Superfície / BMT) e envia o arquivo pelo Telegram.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "gerar_planilha_mapa",
    description: "Gera uma planilha Excel (.xlsx) com os serviços concluídos do Mapa de Obra (bloco, apartamento, serviço, executor, data e valor pago) e envia o arquivo pelo Telegram.",
    input_schema: { type: "object", properties: {} }
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
  },
  {
    name: "criar_local",
    description: "Cadastra um ou mais locais (apartamentos) novos no Mapa de Obra, todos seguindo o mesmo padrão dos locais já existentes: cada um recebe automaticamente TODOS os serviços atualmente cadastrados no sistema (ver listar_servicos), com status inicial 'pendente'. NUNCA atribua só um subconjunto de serviços — o padrão de todo local existente é a lista completa. Identificações que já existem são ignoradas (não duplicam) e informadas separadamente no resultado. CRÍTICO: se o usuário pedir para criar um 'bloco', 'prédio' ou várias unidades de uma vez (ex: 'cria o bloco C', 'cadastra os apartamentos do B') sem informar a lista exata de identificações, NÃO invente uma identificação genérica (ex: só 'C' ou 'Bloco C') nem presuma a numeração — pergunte antes quantos apartamentos tem e qual a identificação exata de cada um (ex: 'C01 a C20'?). Só chame esta ferramenta depois de ter a lista completa e explícita de identificações. ALTERA O BANCO DE DADOS: exige o campo senha, que deve ser pedido ao usuário antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        identificacoes: {
          type: "array",
          items: { type: "string" },
          description: "Lista das identificações/códigos dos locais a criar, ex: ['C01','C02','C03'] (cada uma é salva em maiúsculas). Para criar só um local, use uma lista com um único item."
        },
        area:  { type: "number", description: "Área em m², aplicada a todos os locais desta chamada (opcional, padrão 0 se omitido)" },
        tipo:  { type: "string", description: "Tipo dos locais (opcional — padrão e único tipo em uso hoje é 'Apartamento')" },
        senha: { type: "string", description: "Senha de autorização para alterar o banco de dados. Deve ser pedida ao usuário antes de chamar esta ferramenta." }
      },
      required: ["identificacoes", "senha"]
    }
  }
];

function normCodigo(s) {
  // normaliza "BM 06", "BM06", "BM006", "Bm 06" → "bm6"
  return String(s).toLowerCase()
    .replace(/\s+/g, "")                      // remove espaços
    .replace(/([a-z]+)0*(\d+)/g, "$1$2");     // remove zeros à esquerda do número
}

// Retorna o número do boletim (1-9) se "nome" for BM01..BM09 (com ou sem zero à
// esquerda, com ou sem espaço). "BMT..." nunca casa, pois exige "bm" seguido
// direto de dígito/espaço/zero — não de "t".
function numeroBM(nome) {
  const m = String(nome || "").trim().match(/^bm\s*0*([1-9])\b/i);
  return m ? Number(m[1]) : null;
}

function ehTratamentoMedicao(m) {
  if ((m.itens || []).some(it => it.apartamento === "1.0")) return true;
  return /^bmt/i.test(m.nome || "");
}

// Mesmo bot/chat já usados para o relatório do caixa (caixa/relatorio.html).
const TELEGRAM_BOT_TOKEN = "7469790318:AAEFzcPeS_MG6vvmKrhiZjVWXv1m9J0PTk4";
const TELEGRAM_CHAT_ID = "1672059919";

async function enviarDocumentoTelegram(buffer, filename, caption) {
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("document", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
  form.append("caption", caption);

  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form
  });
  const result = await resp.json().catch(() => null);
  if (!resp.ok || !result || !result.ok) {
    console.error("Erro ao enviar documento Telegram:", resp.status, JSON.stringify(result).slice(0, 500));
    throw new Error("Falha ao enviar documento pelo Telegram: " + (result?.description || `status ${resp.status}`));
  }
  return result;
}

async function enviarFotoTelegram(buffer, filename, caption) {
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("photo", new Blob([buffer], { type: "image/png" }), filename);
  form.append("caption", caption);

  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form
  });
  const result = await resp.json().catch(() => null);
  if (!resp.ok || !result || !result.ok) {
    console.error("Erro ao enviar foto Telegram:", resp.status, JSON.stringify(result).slice(0, 500));
    throw new Error("Falha ao enviar imagem pelo Telegram: " + (result?.description || `status ${resp.status}`));
  }
  return result;
}

// ── Extrato de refeições ────────────────────────────────────────────────

// Períodos de refeição já registrados como pagos (coleção "refeicoesPagas")
// se sobrepõem ao período pedido agora — compara datas YYYY-MM-DD como
// string, que ordena/compara igual a data real nesse formato. Firestore não
// permite range em dois campos diferentes na mesma query, então filtra só
// por dataFim no banco e o resto (dataInicio <= data_fim) em JS — a coleção
// é pequena (1 registro por período fechado), sem custo relevante.
async function verificarSobreposicaoPagamento(data_inicio, data_fim) {
  const snap = await db.collection("refeicoesPagas")
    .where("dataFim", ">=", data_inicio)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => r.dataInicio <= data_fim);
}

async function calcularExtratoRefeicoes(data_inicio, data_fim) {
  const PRECO_CAFE = 10;
  const PRECO_ALMOCO = 15;

  const inicio = new Date(data_inicio + "T00:00:00-03:00");
  const fim    = new Date(data_fim + "T23:59:59-03:00");

  const snap = await db.collection("pontos")
    .where("tipo", "==", "entrada")
    .where("timestamp", ">=", inicio)
    .where("timestamp", "<=", fim)
    .orderBy("timestamp")
    .get();

  // Agrupa por dia (fuso de Brasília) e guarda só a entrada mais cedo de
  // cada funcionário naquele dia — evita contar duas vezes se houver
  // mais de um registro de entrada no mesmo dia.
  const porDia = {};
  snap.docs.forEach(d => {
    const p = d.data();
    const ts = p.timestamp.toDate();
    const diaKey = ts.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    if (!porDia[diaKey]) porDia[diaKey] = {};
    const atual = porDia[diaKey][p.funcionarioId];
    if (atual === undefined || ts.getTime() < atual) porDia[diaKey][p.funcionarioId] = ts.getTime();
  });

  let totalCafe = 0, totalAlmoco = 0;
  const dias = Object.keys(porDia).sort().map(diaKey => {
    let cafe = 0, almoco = 0;
    Object.values(porDia[diaKey]).forEach(ms => {
      const horaLocal = new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });
      const [h, m] = horaLocal.split(":").map(Number);
      const horaDecimal = h + m / 60;
      if (horaDecimal < 7)    cafe++;
      if (horaDecimal < 10.5) almoco++;
    });
    totalCafe   += cafe;
    totalAlmoco += almoco;
    const [ano, mes, dia] = diaKey.split("-");
    return {
      data: `${dia}/${mes}/${ano}`,
      cafeManha: cafe,
      almoco,
      custoCafe: cafe * PRECO_CAFE,
      custoAlmoco: almoco * PRECO_ALMOCO,
      custoDia: cafe * PRECO_CAFE + almoco * PRECO_ALMOCO
    };
  });

  const periodosJaPagos = await verificarSobreposicaoPagamento(data_inicio, data_fim);

  return {
    periodo: { inicio: data_inicio, fim: data_fim },
    precoCafe: PRECO_CAFE,
    precoAlmoco: PRECO_ALMOCO,
    dias,
    totais: {
      cafeManha: totalCafe,
      almoco: totalAlmoco,
      custoCafe: totalCafe * PRECO_CAFE,
      custoAlmoco: totalAlmoco * PRECO_ALMOCO,
      custoGeral: totalCafe * PRECO_CAFE + totalAlmoco * PRECO_ALMOCO
    },
    // presente e não-vazio quando parte (ou tudo) desse período já foi
    // registrado como pago antes — o assistente deve avisar o usuário.
    periodosJaPagos: periodosJaPagos.map(p => ({
      dataInicio: p.dataInicio, dataFim: p.dataFim, valorPago: p.custoTotal
    }))
  };
}

function construirSVGExtrato(dados, logoBase64) {
  const fmt = v => "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fmtDataBR = iso => iso.split("-").reverse().join("/");

  const LARGURA = 800;
  const PAD = 44;
  const ALT_HEADER = 200;
  const ALT_LINHA = 48;
  const ALT_TABELA_HEADER = 40;
  const ALT_TOTAIS = 150;
  const ALT_FOOTER = 50;

  const ALTURA = ALT_HEADER + ALT_TABELA_HEADER + dados.dias.length * ALT_LINHA + ALT_TOTAIS + ALT_FOOTER + PAD;

  const larguraTabela = LARGURA - PAD * 2;
  const colData = PAD + 24;
  const colCafe = PAD + larguraTabela * 0.46;
  const colAlmoco = PAD + larguraTabela * 0.68;
  const colCusto = PAD + larguraTabela - 24;

  let y = ALT_HEADER;

  const headerTabela = `
    <text x="${colData}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif">DATA</text>
    <text x="${colCafe}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">CAFÉ</text>
    <text x="${colAlmoco}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">ALMOÇO</text>
    <text x="${colCusto}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif" text-anchor="end">CUSTO</text>
    <line x1="${PAD}" y1="${y + 36}" x2="${PAD + larguraTabela}" y2="${y + 36}" stroke="rgba(165,214,167,0.25)" stroke-width="1"/>
  `;
  y += ALT_TABELA_HEADER;

  const linhas = dados.dias.map((d, i) => {
    const bg = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "transparent";
    const rowY = y;
    const linha = `
      <rect x="${PAD}" y="${rowY}" width="${larguraTabela}" height="${ALT_LINHA}" fill="${bg}" rx="10"/>
      <text x="${colData}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" fill="#e8f5e9" font-family="Arial, Helvetica, sans-serif">${d.data}</text>
      <text x="${colCafe}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">${d.cafeManha}</text>
      <text x="${colAlmoco}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">${d.almoco}</text>
      <text x="${colCusto}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" font-weight="600" fill="#69f0ae" font-family="Arial, Helvetica, sans-serif" text-anchor="end">${fmt(d.custoDia)}</text>
    `;
    y += ALT_LINHA;
    return linha;
  }).join("");

  const totaisY = y + 20;
  const totaisAltura = ALT_TOTAIS - 20;
  const blocoTotais = `
    <rect x="${PAD}" y="${totaisY}" width="${larguraTabela}" height="${totaisAltura}" rx="16" fill="rgba(105,240,174,0.08)" stroke="rgba(105,240,174,0.35)" stroke-width="1.5"/>
    <text x="${PAD + 28}" y="${totaisY + 34}" font-size="14" font-weight="700" letter-spacing="1" fill="#a5d6a7" font-family="Arial, Helvetica, sans-serif">TOTAL DO PERÍODO</text>

    <text x="${PAD + 28}" y="${totaisY + 66}" font-size="14" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif">Café da manhã</text>
    <text x="${PAD + 28}" y="${totaisY + 88}" font-size="20" font-weight="700" fill="#e8f5e9" font-family="Arial, Helvetica, sans-serif">${dados.totais.cafeManha} <tspan font-size="13" fill="#8fbf99" font-weight="400">(${fmt(dados.totais.custoCafe)})</tspan></text>

    <text x="${PAD + larguraTabela * 0.36}" y="${totaisY + 66}" font-size="14" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif">Almoço</text>
    <text x="${PAD + larguraTabela * 0.36}" y="${totaisY + 88}" font-size="20" font-weight="700" fill="#e8f5e9" font-family="Arial, Helvetica, sans-serif">${dados.totais.almoco} <tspan font-size="13" fill="#8fbf99" font-weight="400">(${fmt(dados.totais.custoAlmoco)})</tspan></text>

    <line x1="${PAD + larguraTabela * 0.66}" y1="${totaisY + 20}" x2="${PAD + larguraTabela * 0.66}" y2="${totaisY + totaisAltura - 20}" stroke="rgba(165,214,167,0.3)" stroke-width="1"/>

    <text x="${PAD + larguraTabela - 28}" y="${totaisY + 40}" font-size="14" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif" text-anchor="end">TOTAL GERAL</text>
    <text x="${PAD + larguraTabela - 28}" y="${totaisY + 74}" font-size="30" font-weight="800" fill="#69f0ae" font-family="Arial, Helvetica, sans-serif" text-anchor="end">${fmt(dados.totais.custoGeral)}</text>
  `;

  const footerY = totaisY + totaisAltura + 34;
  const footer = `
    <text x="${LARGURA / 2}" y="${footerY}" font-size="11" letter-spacing="1" fill="#5a8a63" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">Extrato de Refeições • Sistema GW • Gerado em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</text>
  `;

  const logoW = 64, logoH = 64 * (1106 / 1422);

  return `
<svg width="${LARGURA}" height="${ALTURA}" viewBox="0 0 ${LARGURA} ${ALTURA}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#12331f"/>
      <stop offset="45%" stop-color="#0c2417"/>
      <stop offset="100%" stop-color="#06120b"/>
    </linearGradient>
    <clipPath id="logoClip"><rect x="0" y="0" width="${logoW}" height="${logoH}" rx="10"/></clipPath>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#69f0ae" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#69f0ae" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="${LARGURA}" height="${ALTURA}" fill="url(#bg)"/>

  <circle cx="${LARGURA / 2}" cy="${40 + logoH / 2}" r="90" fill="url(#glow)"/>

  <g transform="translate(${LARGURA / 2 - logoW / 2}, 40)">
    <image href="data:image/png;base64,${logoBase64}" width="${logoW}" height="${logoH}" clip-path="url(#logoClip)"/>
  </g>

  <text x="${LARGURA / 2}" y="${40 + logoH + 34}" font-size="26" font-weight="800" letter-spacing="3" fill="#f1f8f2" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">GREEN WALL</text>
  <text x="${LARGURA / 2}" y="${40 + logoH + 58}" font-size="13" font-weight="700" letter-spacing="4" fill="#69f0ae" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">EXTRATO DE REFEIÇÕES</text>
  <text x="${LARGURA / 2}" y="${40 + logoH + 82}" font-size="14" fill="#a5d6a7" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">${fmtDataBR(dados.periodo.inicio)} a ${fmtDataBR(dados.periodo.fim)}</text>

  ${headerTabela}
  ${linhas}
  ${blocoTotais}
  ${footer}
</svg>`;
}

async function gerarImagemExtrato(dados) {
  const logoBase64 = fs.readFileSync(path.join(__dirname, "Logo-gw.png")).toString("base64");
  const svg = construirSVGExtrato(dados, logoBase64);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Extrato de ponto individual ──────────────────────────────────────────

function escXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtHorasMin(decimalHoras) {
  const totalMin = Math.round(decimalHoras * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m > 0 ? " " + m + "min" : ""}`;
}

// Pareia entrada->saída em ordem (cobre o caso de intervalo de almoço com
// duas entradas/saídas no mesmo dia) e soma só os intervalos já fechados.
// Uma entrada sem saída correspondente marca o dia como "incompleto" —
// nunca chuta quantas horas o funcionário ainda ia trabalhar. Saídas
// geradas pelo fechamento automático do ponto (index.html fecha, às 14h,
// entradas esquecidas sem saída — flag "fechamentoAutomatico") são
// marcadas como tal, pra não parecerem um horário real batido pela pessoa.
//
// Também traz os registros de TODOS os funcionários no período (não só o
// alvo) pra descobrir em que dias outros bateram ponto e o funcionário
// alvo não — esses dias entram no relatório como "falta". Como a
// referência de "dia trabalhado pela empresa" vem só de entradas reais de
// outras pessoas, dias sem ninguém trabalhando (fim de semana, feriado)
// nunca são sinalizados como falta.
async function calcularExtratoPonto(funcionarioId, data_inicio, data_fim) {
  const funcionarioDoc = await db.collection("funcionarios").doc(funcionarioId).get();
  const funcionarioNome = funcionarioDoc.exists ? funcionarioDoc.data().nome : null;

  const inicio = new Date(data_inicio + "T00:00:00-03:00");
  const fim    = new Date(data_fim + "T23:59:59-03:00");

  const snap = await db.collection("pontos")
    .where("timestamp", ">=", inicio)
    .where("timestamp", "<=", fim)
    .orderBy("timestamp")
    .get();

  const porDiaAlvo = {};
  const diasComOutros = new Set();

  snap.docs.forEach(d => {
    const p = d.data();
    if (!p.timestamp || !p.tipo) return;
    const ts = p.timestamp.toDate();
    const diaKey = ts.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

    if (p.funcionarioId === funcionarioId) {
      if (!porDiaAlvo[diaKey]) porDiaAlvo[diaKey] = [];
      porDiaAlvo[diaKey].push({ tipo: p.tipo, ts, auto: !!p.fechamentoAutomatico });
    } else if (p.tipo === "entrada") {
      // Sábado/domingo nunca vira falta, mesmo que outros tenham trabalhado
      // nesse fim de semana — só entram como referência de falta os dias
      // úteis. Se o próprio alvo tiver um registro no fim de semana, ele
      // ainda aparece normal no relatório (via porDiaAlvo, não depende disso).
      const diaSemana = ts.toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" });
      if (diaSemana !== "Sat" && diaSemana !== "Sun") diasComOutros.add(diaKey);
    }
  });

  const fmtHora = ts => ts.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const todasAsChaves = new Set([...Object.keys(porDiaAlvo), ...diasComOutros]);

  let totalHoras = 0;
  let diasIncompletos = 0;
  let diasFalta = 0;
  let algumSaidaAuto = false;

  const dias = [...todasAsChaves].sort().map(diaKey => {
    const [ano, mes, dia] = diaKey.split("-");
    const dataBR = `${dia}/${mes}/${ano}`;
    const eventos = porDiaAlvo[diaKey];

    if (!eventos) {
      diasFalta++;
      return { data: dataBR, falta: true };
    }

    const primeiraEntrada = eventos.find(e => e.tipo === "entrada");
    const ultimaSaida = [...eventos].reverse().find(e => e.tipo === "saida");

    let abertura = null;
    let horasDia = 0;
    eventos.forEach(e => {
      if (e.tipo === "entrada") {
        abertura = e.ts;
      } else if (e.tipo === "saida" && abertura) {
        horasDia += (e.ts.getTime() - abertura.getTime()) / 3600000;
        abertura = null;
      }
    });
    const incompleto = abertura !== null; // sobrou entrada sem saída

    totalHoras += horasDia;
    if (incompleto) diasIncompletos++;
    const saidaAuto = !incompleto && !!(ultimaSaida && ultimaSaida.auto);
    if (saidaAuto) algumSaidaAuto = true;

    return {
      data: dataBR,
      entrada: primeiraEntrada ? fmtHora(primeiraEntrada.ts) : "—",
      saida: (ultimaSaida && !incompleto) ? fmtHora(ultimaSaida.ts) : "—",
      horas: horasDia,
      incompleto,
      saidaAuto,
      falta: false
    };
  });

  return {
    periodo: { inicio: data_inicio, fim: data_fim },
    funcionarioId,
    funcionarioNome,
    dias,
    algumSaidaAuto,
    totais: {
      diasTrabalhados: dias.filter(d => !d.falta).length,
      totalHoras,
      diasIncompletos,
      diasFalta
    }
  };
}

function construirSVGExtratoPonto(dados, logoBase64) {
  const fmtDataBR = iso => iso.split("-").reverse().join("/");

  const LARGURA = 800;
  const PAD = 44;
  const ALT_HEADER = 200;
  const ALT_LINHA = 48;
  const ALT_TABELA_HEADER = 40;
  const ALT_TOTAIS = 150;
  const ALT_FOOTER = 50;
  const ALT_LEGENDA = dados.algumSaidaAuto ? 22 : 0;

  const ALTURA = ALT_HEADER + ALT_TABELA_HEADER + dados.dias.length * ALT_LINHA + ALT_TOTAIS + ALT_LEGENDA + ALT_FOOTER + PAD;

  const larguraTabela = LARGURA - PAD * 2;
  const colData = PAD + 24;
  const colEntrada = PAD + larguraTabela * 0.42;
  const colSaida = PAD + larguraTabela * 0.62;
  const colHoras = PAD + larguraTabela - 24;

  let y = ALT_HEADER;

  const headerTabela = `
    <text x="${colData}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif">DATA</text>
    <text x="${colEntrada}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">ENTRADA</text>
    <text x="${colSaida}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">SAÍDA</text>
    <text x="${colHoras}" y="${y + 26}" font-size="13" font-weight="700" letter-spacing="1.5" fill="#7fb88a" font-family="Arial, Helvetica, sans-serif" text-anchor="end">HORAS</text>
    <line x1="${PAD}" y1="${y + 36}" x2="${PAD + larguraTabela}" y2="${y + 36}" stroke="rgba(165,214,167,0.25)" stroke-width="1"/>
  `;
  y += ALT_TABELA_HEADER;

  const linhas = dados.dias.map((d, i) => {
    const bg = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "transparent";
    const rowY = y;
    let linha;
    if (d.falta) {
      linha = `
        <rect x="${PAD}" y="${rowY}" width="${larguraTabela}" height="${ALT_LINHA}" fill="${bg}" rx="10"/>
        <text x="${colData}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" fill="#e8f5e9" font-family="Arial, Helvetica, sans-serif">${d.data}</text>
        <text x="${colHoras}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="15" font-weight="700" letter-spacing="1.5" fill="#ff8a80" font-family="Arial, Helvetica, sans-serif" text-anchor="end">FALTA</text>
      `;
    } else {
      const corHoras = d.incompleto ? "#ffb74d" : "#69f0ae";
      const textoHoras = d.incompleto ? "em aberto" : fmtHorasMin(d.horas);
      const textoSaida = d.saidaAuto ? `${d.saida}*` : d.saida;
      const corSaida = d.saidaAuto ? "#ffb74d" : "#c8e6c9";
      linha = `
        <rect x="${PAD}" y="${rowY}" width="${larguraTabela}" height="${ALT_LINHA}" fill="${bg}" rx="10"/>
        <text x="${colData}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" fill="#e8f5e9" font-family="Arial, Helvetica, sans-serif">${d.data}</text>
        <text x="${colEntrada}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">${d.entrada}</text>
        <text x="${colSaida}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" fill="${corSaida}" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">${textoSaida}</text>
        <text x="${colHoras}" y="${rowY + ALT_LINHA / 2 + 6}" font-size="16" font-weight="600" fill="${corHoras}" font-family="Arial, Helvetica, sans-serif" text-anchor="end">${textoHoras}</text>
      `;
    }
    y += ALT_LINHA;
    return linha;
  }).join("");

  const totaisY = y + 20;
  const totaisAltura = ALT_TOTAIS - 20;
  const extrasDias = [];
  if (dados.totais.diasIncompletos) extrasDias.push(`${dados.totais.diasIncompletos} em aberto`);
  if (dados.totais.diasFalta) extrasDias.push(`${dados.totais.diasFalta} falta${dados.totais.diasFalta > 1 ? "s" : ""}`);
  const extrasDiasTxt = extrasDias.length ? ` <tspan font-size="13" fill="#ffb74d" font-weight="400">(${extrasDias.join(", ")})</tspan>` : "";
  const blocoTotais = `
    <rect x="${PAD}" y="${totaisY}" width="${larguraTabela}" height="${totaisAltura}" rx="16" fill="rgba(105,240,174,0.08)" stroke="rgba(105,240,174,0.35)" stroke-width="1.5"/>
    <text x="${PAD + 28}" y="${totaisY + 34}" font-size="14" font-weight="700" letter-spacing="1" fill="#a5d6a7" font-family="Arial, Helvetica, sans-serif">TOTAL DO PERÍODO</text>

    <text x="${PAD + 28}" y="${totaisY + 66}" font-size="14" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif">Dias trabalhados</text>
    <text x="${PAD + 28}" y="${totaisY + 88}" font-size="20" font-weight="700" fill="#e8f5e9" font-family="Arial, Helvetica, sans-serif">${dados.totais.diasTrabalhados}${extrasDiasTxt}</text>

    <line x1="${PAD + larguraTabela * 0.5}" y1="${totaisY + 20}" x2="${PAD + larguraTabela * 0.5}" y2="${totaisY + totaisAltura - 20}" stroke="rgba(165,214,167,0.3)" stroke-width="1"/>

    <text x="${PAD + larguraTabela - 28}" y="${totaisY + 40}" font-size="14" fill="#c8e6c9" font-family="Arial, Helvetica, sans-serif" text-anchor="end">TOTAL DE HORAS</text>
    <text x="${PAD + larguraTabela - 28}" y="${totaisY + 74}" font-size="30" font-weight="800" fill="#69f0ae" font-family="Arial, Helvetica, sans-serif" text-anchor="end">${fmtHorasMin(dados.totais.totalHoras)}</text>
  `;

  const legendaY = totaisY + totaisAltura + 26;
  const legenda = dados.algumSaidaAuto ? `
    <text x="${PAD}" y="${legendaY}" font-size="11" fill="#ffb74d" font-family="Arial, Helvetica, sans-serif">* saída fechada automaticamente às 14h — sem registro manual nesse dia</text>
  ` : "";

  const footerY = legendaY + ALT_LEGENDA + 8;
  const footer = `
    <text x="${LARGURA / 2}" y="${footerY}" font-size="11" letter-spacing="1" fill="#5a8a63" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">Extrato de Ponto • Sistema GW • Gerado em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</text>
  `;

  const logoW = 64, logoH = 64 * (1106 / 1422);

  return `
<svg width="${LARGURA}" height="${ALTURA}" viewBox="0 0 ${LARGURA} ${ALTURA}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#12331f"/>
      <stop offset="45%" stop-color="#0c2417"/>
      <stop offset="100%" stop-color="#06120b"/>
    </linearGradient>
    <clipPath id="logoClip"><rect x="0" y="0" width="${logoW}" height="${logoH}" rx="10"/></clipPath>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#69f0ae" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#69f0ae" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="${LARGURA}" height="${ALTURA}" fill="url(#bg)"/>

  <circle cx="${LARGURA / 2}" cy="${40 + logoH / 2}" r="90" fill="url(#glow)"/>

  <g transform="translate(${LARGURA / 2 - logoW / 2}, 40)">
    <image href="data:image/png;base64,${logoBase64}" width="${logoW}" height="${logoH}" clip-path="url(#logoClip)"/>
  </g>

  <text x="${LARGURA / 2}" y="${40 + logoH + 34}" font-size="26" font-weight="800" letter-spacing="3" fill="#f1f8f2" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">GREEN WALL</text>
  <text x="${LARGURA / 2}" y="${40 + logoH + 58}" font-size="13" font-weight="700" letter-spacing="4" fill="#69f0ae" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">EXTRATO DE PONTO — ${escXml((dados.funcionarioNome || "").toUpperCase())}</text>
  <text x="${LARGURA / 2}" y="${40 + logoH + 82}" font-size="14" fill="#a5d6a7" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">${fmtDataBR(dados.periodo.inicio)} a ${fmtDataBR(dados.periodo.fim)}</text>

  ${headerTabela}
  ${linhas}
  ${blocoTotais}
  ${legenda}
  ${footer}
</svg>`;
}

async function gerarImagemExtratoPonto(dados) {
  const logoBase64 = fs.readFileSync(path.join(__dirname, "Logo-gw.png")).toString("base64");
  const svg = construirSVGExtratoPonto(dados, logoBase64);
  return sharp(Buffer.from(svg)).png().toBuffer();
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

    const funcionarioDoc = await db.collection("funcionarios").doc(funcionarioId).get();
    if (!funcionarioDoc.exists) {
      return { sucesso: false, erro: "funcionario_invalido", mensagem: "funcionarioId não corresponde a nenhum funcionário real. Chame listar_funcionarios de novo para pegar o ID correto antes de tentar novamente." };
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

  if (nome === "consultar_ponto_periodo") {
    const { funcionarioId, data_inicio, data_fim } = input;
    if (!data_inicio || !data_fim) {
      return { erro: "parametros_invalidos", mensagem: "data_inicio e data_fim são obrigatórios." };
    }
    const inicio = new Date(data_inicio + "T00:00:00-03:00");
    const fim = new Date(data_fim + "T23:59:59-03:00");

    let query = db.collection("pontos")
      .where("timestamp", ">=", inicio)
      .where("timestamp", "<=", fim);
    if (funcionarioId) query = query.where("funcionarioId", "==", funcionarioId);
    const snap = await query.orderBy("timestamp").get();

    const porDia = {};
    for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
      porDia[d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })] = [];
    }

    snap.docs.forEach(d => {
      const dd = d.data();
      const ts = dd.timestamp.toDate();
      const diaISO = ts.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const hora = ts.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      if (!porDia[diaISO]) porDia[diaISO] = [];
      porDia[diaISO].push({
        id: d.id,
        tipo: dd.tipo,
        hora,
        ...(funcionarioId ? {} : { funcionarioId: dd.funcionarioId, funcionarioNome: dd.funcionarioNome })
      });
    });

    return {
      periodo: { inicio: data_inicio, fim: data_fim },
      dias: Object.keys(porDia).sort().map(dia => ({ data: dia, registros: porDia[dia] }))
    };
  }

  if (nome === "ultimo_registro_ponto") {
    const { funcionarioId } = input;
    const snap = await db.collection("pontos")
      .where("funcionarioId", "==", funcionarioId)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (snap.empty) return { encontrado: false, mensagem: "Nenhum registro de ponto encontrado para esse funcionário." };

    const dd = snap.docs[0].data();
    const ts = dd.timestamp.toDate();
    const loc = dd.localizacao;

    return {
      encontrado: true,
      funcionarioNome: dd.funcionarioNome,
      tipo: dd.tipo,
      data: ts.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      hora: ts.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
      localizacao: (loc && (loc.lat || loc.lng)) ? {
        lat: loc.lat,
        lng: loc.lng,
        link: `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
      } : null
    };
  }

  if (nome === "extrato_refeicoes") {
    return calcularExtratoRefeicoes(input.data_inicio, input.data_fim);
  }

  if (nome === "extrato_refeicoes_imagem") {
    const dados = await calcularExtratoRefeicoes(input.data_inicio, input.data_fim);
    if (!dados.dias.length) {
      return { sucesso: false, erro: "sem_dados", mensagem: "Nenhum registro de ponto encontrado nesse período." };
    }

    try {
      const buffer = await gerarImagemExtrato(dados);
      await enviarFotoTelegram(
        buffer,
        `extrato-refeicoes-${input.data_inicio}-a-${input.data_fim}.png`,
        `Extrato de Refeições — ${dados.periodo.inicio.split("-").reverse().join("/")} a ${dados.periodo.fim.split("-").reverse().join("/")}`
      );
    } catch (err) {
      console.error(err);
      return { sucesso: false, erro: "falha_geracao_ou_envio", mensagem: err.message };
    }

    return {
      sucesso: true,
      mensagem: "Imagem do extrato de refeições gerada e enviada pelo Telegram com sucesso.",
      totais: dados.totais,
      periodosJaPagos: dados.periodosJaPagos
    };
  }

  if (nome === "extrato_ponto_individual_imagem") {
    const { funcionarioId, data_inicio, data_fim } = input;
    const dados = await calcularExtratoPonto(funcionarioId, data_inicio, data_fim);
    if (!dados.funcionarioNome) {
      return { sucesso: false, erro: "funcionario_invalido", mensagem: "funcionarioId não corresponde a nenhum funcionário real. Chame listar_funcionarios de novo para pegar o ID correto antes de tentar novamente." };
    }
    if (!dados.dias.length) {
      return { sucesso: false, erro: "sem_dados", mensagem: "Nenhum registro de ponto encontrado para esse funcionário nesse período." };
    }

    try {
      const buffer = await gerarImagemExtratoPonto(dados);
      await enviarFotoTelegram(
        buffer,
        `extrato-ponto-${dados.funcionarioNome.replace(/\s+/g, "-")}-${data_inicio}-a-${data_fim}.png`,
        `Extrato de Ponto — ${dados.funcionarioNome} — ${data_inicio.split("-").reverse().join("/")} a ${data_fim.split("-").reverse().join("/")}`
      );
    } catch (err) {
      console.error(err);
      return { sucesso: false, erro: "falha_geracao_ou_envio", mensagem: err.message };
    }

    return {
      sucesso: true,
      mensagem: "Imagem do extrato de ponto gerada e enviada pelo Telegram com sucesso.",
      funcionarioNome: dados.funcionarioNome,
      totais: dados.totais
    };
  }

  if (nome === "registrar_pagamento_refeicoes") {
    const { data_inicio, data_fim, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    if (!data_inicio || !data_fim) {
      return { sucesso: false, erro: "parametros_invalidos", mensagem: "data_inicio e data_fim são obrigatórios." };
    }

    // Recalcula do zero — nunca confia num total já dito antes na conversa.
    const dados = await calcularExtratoRefeicoes(data_inicio, data_fim);
    if (!dados.dias.length) {
      return { sucesso: false, erro: "sem_dados", mensagem: "Nenhum registro de ponto encontrado nesse período — nada a registrar." };
    }
    if (dados.periodosJaPagos.length) {
      return {
        sucesso: false,
        erro: "periodo_ja_pago",
        mensagem: "Esse período (ou parte dele) já foi registrado como pago antes. Confirme com o usuário se ele quer registrar mesmo assim (ex: se o período pedido agora só sobrepõe uma parte) antes de insistir.",
        periodosJaPagos: dados.periodosJaPagos
      };
    }

    const dataHojeBR = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const descricao = `Refeições (café da manhã e almoço) — ${data_inicio.split("-").reverse().join("/")} a ${data_fim.split("-").reverse().join("/")}`;

    const refContaPagar = db.collection("contasPagar").doc();
    const refPago = db.collection("refeicoesPagas").doc();
    const batch = db.batch();
    batch.set(refContaPagar, {
      data: dataHojeBR,
      descricao,
      valor: dados.totais.custoGeral,
      status: "aberto",
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    batch.set(refPago, {
      dataInicio: data_inicio,
      dataFim: data_fim,
      totalCafe: dados.totais.cafeManha,
      totalAlmoco: dados.totais.almoco,
      custoTotal: dados.totais.custoGeral,
      contaPagarId: refContaPagar.id,
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();

    return {
      sucesso: true,
      mensagem: "Lançamento criado no Contas a Pagar e período marcado como pago.",
      contaPagarId: refContaPagar.id,
      valor: dados.totais.custoGeral,
      periodo: { inicio: data_inicio, fim: data_fim }
    };
  }

  if (nome === "consultar_contas_pagar") {
    const { status, busca } = input;
    const snap = await db.collection("contasPagar").orderBy("criadoEm", "desc").get();
    let itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (status) {
      itens = itens.filter(c => (c.status || "").toLowerCase() === status.toLowerCase());
    }
    if (busca) {
      itens = itens.filter(c => (c.descricao || "").toLowerCase().includes(busca.toLowerCase()));
    }

    const totalAberto = itens.filter(c => c.status !== "baixado").reduce((s, c) => s + (Number(c.valor) || 0), 0);

    return {
      lancamentos: itens.slice(0, 50).map(c => ({
        id: c.id,
        data: c.data,
        descricao: c.descricao,
        valor: Number(c.valor) || 0,
        status: c.status || "aberto"
      })),
      totalAberto,
      quantidade: itens.length
    };
  }

  if (nome === "editar_conta_pagar") {
    const { id, descricao, valor, data, status, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = db.collection("contasPagar").doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { sucesso: false, erro: "nao_encontrado", mensagem: "Lançamento não encontrado no Contas a Pagar." };

    const updates = {};
    if (descricao !== undefined) updates.descricao = descricao;
    if (valor !== undefined) updates.valor = Number(valor) || 0;
    if (data !== undefined) updates.data = data;
    if (status !== undefined) updates.status = status;

    await ref.update(updates);
    return { sucesso: true, id, atualizado: updates };
  }

  if (nome === "dar_baixa_conta_pagar") {
    const { id, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const ref = db.collection("contasPagar").doc(id);
    const doc = await ref.get();
    if (!doc.exists) return { sucesso: false, erro: "nao_encontrado", mensagem: "Lançamento não encontrado no Contas a Pagar." };
    const atual = doc.data();
    if (atual.status === "baixado") {
      return { sucesso: false, erro: "ja_baixado", mensagem: "Esse lançamento já estava marcado como baixado — nada foi alterado.", descricao: atual.descricao, valor: atual.valor };
    }

    await ref.update({ status: "baixado" });
    return { sucesso: true, id, descricao: atual.descricao, valor: atual.valor };
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

  if (nome === "gerar_planilha_medicoes") {
    const snap = await db.collection("medicoes").get();
    const medicoes = snap.docs
      .map(d => ({ id: d.id, ...d.data(), numero: numeroBM(d.data().nome) }))
      .filter(m => m.numero !== null && !ehTratamentoMedicao(m))
      .sort((a, b) => a.numero - b.numero);

    if (medicoes.length === 0) {
      return { sucesso: false, erro: "sem_dados", mensagem: "Nenhum boletim BM01 a BM09 encontrado nas medições cadastradas." };
    }

    const workbook = new ExcelJS.Workbook();

    const resumo = workbook.addWorksheet("Resumo");
    resumo.columns = [
      { header: "Boletim", key: "nome", width: 14 },
      { header: "Data", key: "data", width: 12 },
      { header: "Valor Medido", key: "valor", width: 16 },
      { header: "Descontos", key: "descontos", width: 14 },
      { header: "Valor NF", key: "valorNotaFiscal", width: 14 }
    ];
    medicoes.forEach(m => resumo.addRow({
      nome: m.nome || "",
      data: m.data || "",
      valor: m.valor || 0,
      descontos: m.descontos || 0,
      valorNotaFiscal: m.valorNotaFiscal || 0
    }));
    resumo.getRow(1).font = { bold: true };

    const itensSheet = workbook.addWorksheet("Itens");
    itensSheet.columns = [
      { header: "Boletim", key: "boletim", width: 14 },
      { header: "Item", key: "apartamento", width: 10 },
      { header: "Serviço", key: "servico", width: 40 },
      { header: "Quantidade", key: "quantidade", width: 12 },
      { header: "Valor", key: "valor", width: 14 }
    ];
    medicoes.forEach(m => (m.itens || []).forEach(it => itensSheet.addRow({
      boletim: m.nome || "",
      apartamento: it.apartamento || "",
      servico: it.servico || "",
      quantidade: it.quantidade || 0,
      valor: it.valor || 0
    })));
    itensSheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `medicoes_bm01-09_${Date.now()}.xlsx`;

    try {
      await enviarDocumentoTelegram(
        Buffer.from(buffer),
        filename,
        `Planilha de medições BM01 a BM09 (${medicoes.length} boletins)`
      );
    } catch (err) {
      console.error(err);
      return { sucesso: false, erro: "falha_envio_telegram", mensagem: err.message };
    }

    return {
      sucesso: true,
      quantidadeBoletins: medicoes.length,
      boletins: medicoes.map(m => m.nome),
      mensagem: "Planilha gerada e enviada pelo Telegram com sucesso."
    };
  }

  if (nome === "gerar_planilha_mapa") {
    const [locaisSnap, servicosSnap] = await Promise.all([
      db.collection("locais").orderBy("identificacao", "asc").get(),
      db.collection("servicos").get()
    ]);

    const nomesMapa = {};
    servicosSnap.docs.forEach(d => {
      const s = d.data();
      if (s.nomeMapa) nomesMapa[d.id] = s.nomeMapa;
    });

    const linhas = [];
    locaisSnap.docs.forEach(d => {
      const local = d.data();
      const ident = local.identificacao || d.id;
      const blocoMatch = String(ident).match(/^([A-Za-z]+)/);
      const bloco = blocoMatch ? blocoMatch[1].toUpperCase() : "";
      (local.servicos || []).forEach(s => {
        if (s.status !== "concluido") return;
        linhas.push({
          bloco,
          apartamento: ident,
          servico: (s.id && nomesMapa[s.id]) || s.nome || "",
          executor: (s.executor && s.executor.nome) || "",
          dataPagamento: s.dataPagamento || "",
          valorPago: s.valorPago || 0
        });
      });
    });

    if (linhas.length === 0) {
      return { sucesso: false, erro: "sem_dados", mensagem: "Nenhum serviço concluído encontrado no Mapa de Obra." };
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Mapa de Obra");
    sheet.columns = [
      { header: "Bloco", key: "bloco", width: 10 },
      { header: "Apartamento", key: "apartamento", width: 14 },
      { header: "Serviço", key: "servico", width: 30 },
      { header: "Executor", key: "executor", width: 24 },
      { header: "Data Pagamento", key: "dataPagamento", width: 16 },
      { header: "Valor Pago", key: "valorPago", width: 14 }
    ];
    linhas.forEach(l => sheet.addRow(l));
    sheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `mapa_obra_${Date.now()}.xlsx`;

    try {
      await enviarDocumentoTelegram(
        Buffer.from(buffer),
        filename,
        `Planilha do Mapa de Obra — serviços concluídos (${linhas.length} itens)`
      );
    } catch (err) {
      console.error(err);
      return { sucesso: false, erro: "falha_envio_telegram", mensagem: err.message };
    }

    return {
      sucesso: true,
      quantidadeServicos: linhas.length,
      mensagem: "Planilha do Mapa de Obra gerada e enviada pelo Telegram com sucesso."
    };
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

  if (nome === "criar_local") {
    const { identificacoes, area, tipo, senha } = input;
    if (senha !== SENHA_ALTERACAO_BANCO) {
      return { sucesso: false, erro: "senha_invalida", mensagem: "Senha incorreta. Peça a senha de autorização ao usuário para alterar o banco de dados." };
    }
    const lista = Array.isArray(identificacoes) ? identificacoes.map(v => String(v || "").trim()).filter(Boolean) : [];
    if (lista.length === 0) {
      return { sucesso: false, erro: "identificacoes_obrigatorias", mensagem: "Informe a lista de identificações dos locais a criar (identificacoes). Nunca invente uma identificação genérica pra um bloco inteiro — pergunte ao usuário a lista exata antes." };
    }

    // Mesmo padrão de todo local já existente: cada um começa com TODOS os
    // serviços atuais do sistema, "pendente" (é o que sincronizarNovosServicos,
    // em locais/app.js, converge com o tempo pros locais criados manualmente).
    const servicosSnap = await db.collection("servicos").get();
    const servicosBase = servicosSnap.docs.map(d => {
      const s = d.data();
      return { id: d.id, nome: s.nome || "", status: "pendente", ...(s.item ? { item: s.item } : {}) };
    });

    const criados = [];
    const duplicados = [];
    for (const raw of lista) {
      const identificacaoNorm = raw.toUpperCase();
      const existe = await db.collection("locais").where("identificacao", "==", identificacaoNorm).limit(1).get();
      if (!existe.empty) { duplicados.push(identificacaoNorm); continue; }
      const ref = await db.collection("locais").add({
        tipo: tipo || "Apartamento",
        identificacao: identificacaoNorm,
        area: Number(area) || 0,
        servicos: servicosBase,
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
      criados.push({ id: ref.id, identificacao: identificacaoNorm });
    }

    const listaCriados = criados.map(c => c.identificacao).join(", ");
    const listaDuplicados = duplicados.join(", ");
    return {
      sucesso: criados.length > 0,
      criados,
      duplicados,
      quantidadeServicosPorLocal: servicosBase.length,
      mensagem: criados.length === 0
        ? `Nenhum local criado — todas as identificações já existiam: ${listaDuplicados}.`
        : `Criado(s) ${criados.length} local(is) (${listaCriados}), cada um com ${servicosBase.length} serviço(s) pendente(s).${duplicados.length ? ` Já existiam e foram ignorados: ${listaDuplicados}.` : ""}`
    };
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
Para criar locais novos, use criar_local — ela já atribui automaticamente TODOS os serviços atualmente cadastrados no sistema (o mesmo padrão de qualquer local já existente); nunca tente montar a lista de serviços manualmente nem pergunte ao usuário quais serviços incluir. criar_local aceita uma LISTA de identificações (pode criar vários locais numa só chamada). CRÍTICO: se o usuário pedir pra criar um "bloco", "prédio" ou várias unidades sem dizer a identificação exata de cada uma, NUNCA invente (ex: criar um único local chamado "C" pra representar o bloco inteiro) — pergunte primeiro quantos apartamentos e qual a numeração/identificação de cada um, e só chame criar_local depois de ter essa lista completa.
IMPORTANTE: qualquer ferramenta que altere o banco de dados (ex: registrar_ponto, editar_ponto, cancelar_ponto, criar_lancamento_caixa, editar_lancamento_caixa, excluir_lancamento_caixa, registrar_pagamento_refeicoes, editar_conta_pagar, dar_baixa_conta_pagar) exige uma senha de autorização. Antes de chamar essa ferramenta, sempre pergunte ao usuário "Qual a senha de autorização para alterar o banco de dados?" e só prossiga depois que ele informar a senha. Nunca invente, sugira ou revele a senha.
CRÍTICO: NUNCA diga ao usuário que uma ação foi concluída/registrada/salva com sucesso a menos que o resultado da ferramenta (o tool_result mais recente) traga explicitamente "sucesso": true. Se vier "sucesso": false, ou se você não tiver certeza de ter chamado a ferramenta de verdade, informe claramente que a ação FALHOU (use a "mensagem" do erro, se houver) e peça pra tentar de novo — nunca componha uma confirmação de sucesso a partir de memória da conversa ou suposição. Isso já causou TRÊS casos reais: (1) o assistente disse "Pagamento registrado com sucesso" sem a ferramenta ter sido executada de verdade, nada gravado no banco; (2) o usuário pediu baixa em 2 lançamentos do Contas a Pagar, o assistente confirmou os dois, mas NENHUMA ferramenta foi chamada pra nenhum dos dois; (3) o usuário pediu pra editar_conta_pagar mudar uma data, o assistente confirmou a troca, mas não chamou NENHUMA ferramenta — o registro no banco nunca mudou. SE O USUÁRIO PEDIR UMA AÇÃO EM MAIS DE UM ITEM (ex: "dá baixa nesses dois", "edita esses três"), chame a ferramenta correspondente UMA VEZ PARA CADA item, com o id real de cada um — nunca responda como se todos tivessem sido feitos sem ter chamado a ferramenta pra cada um individualmente.
VERIFICAÇÃO OBRIGATÓRIA antes de qualquer resposta que confirme uma ação (registrar, editar, excluir, dar baixa, pagar, cancelar): pare e confira, nesta mesma resposta que você está montando, se existe um tool_result correspondente com "sucesso": true. Se a resposta que você está prestes a mandar afirma que algo foi feito e você não consegue apontar esse tool_result específico, isso é um sinal de que você pulou a chamada da ferramenta — pare, chame a ferramenta de verdade primeiro, e só confirme depois de ver o resultado real.
Depois que extrato_refeicoes_imagem enviar a imagem com sucesso, pergunte ao usuário se ele quer registrar esse valor total no Contas a Pagar. Se ele confirmar, peça a senha de autorização e chame registrar_pagamento_refeicoes com o mesmo período. Se o resultado de qualquer ferramenta de refeições trouxer "periodosJaPagos" preenchido, avise o usuário que esse período (ou parte dele) já foi registrado como pago antes, ANTES de prosseguir — não insista em registrar de novo sem ele confirmar que quer mesmo assim.
Para editar ou excluir um lançamento do caixa, use consultar_caixa primeiro para encontrar o id correto e confirme com o usuário qual lançamento é (data, descrição e valor) antes de aplicar a alteração.
Para editar ou dar baixa num lançamento do Contas a Pagar, use consultar_contas_pagar primeiro para encontrar o id correto — NUNCA invente um id (ex: "1", "2", "3" não são ids válidos, só o id exato que consultar_contas_pagar retornou) — e confirme com o usuário qual lançamento é (descrição e valor atuais) antes de aplicar. Pra "dar baixa"/"marcar como pago"/"quitar", use dar_baixa_conta_pagar. Pra mudar descrição, valor ou data, use editar_conta_pagar.
Para cancelar um registro de ponto, use consultar_ponto primeiro para encontrar o id correto e confirme com o usuário qual registro é (funcionário, tipo e horário) antes de cancelar.
Para corrigir um registro de ponto já existente (mudar data, horário ou tipo), use editar_ponto com o id obtido via consultar_ponto — NÃO cancele e registre de novo manualmente em duas chamadas separadas; editar_ponto já faz isso internamente (substitui o registro e guarda um histórico da alteração).
Quando o usuário pedir para registrar ponto em uma data diferente de hoje (ex: "registre a saída de fulano dia 27/06"), SEMPRE preencha o campo "data" de registrar_ponto com essa data — nunca deixe em branco, senão o registro cai na data de hoje por engano.
Quando o usuário pedir o ponto de "todos", "todos os funcionários" ou não especificar um funcionário, chame consultar_ponto UMA ÚNICA VEZ sem o campo funcionarioId — essa ferramenta já retorna os registros de todos de uma vez. NUNCA chame consultar_ponto repetidamente por funcionário para montar essa lista.
CRÍTICO: consultar_ponto só serve para UM dia. Quando o usuário pedir ponto de mais de um dia (ex: "essa semana", "de 21 a 24/07", "semana passada", "esse mês"), use consultar_ponto_periodo com data_inicio e data_fim — nunca chame consultar_ponto dia por dia nem responda com base em consultas anteriores da conversa. Sempre consulte de novo antes de responder sobre um período.`;

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
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1024, system: systemPrompt, tools: TOOLS_GW, messages: msgs })
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
          // Achado ao vivo em 2026-07-31: registrar_pagamento_refeicoes
          // reportou sucesso pro usuário no WhatsApp, mas NADA foi gravado
          // no Firestore (nem contasPagar, nem refeicoesPagas) — sem
          // nenhum erro visível no log. Duas correções: (1) log explícito
          // de toda chamada de ferramenta que altera o banco, pra próxima
          // vez que isso acontecer dar pra ver a causa real no `firebase
          // functions:log`; (2) captura qualquer exceção aqui em vez de
          // deixar propagar — sem isso, uma falha nessa chamada quebraria
          // o Promise.all inteiro (todas as ferramentas desse turno, não
          // só essa), e o Claude nunca veria um tool_result de verdade pra
          // relatar corretamente ao usuário que algo deu errado.
          const alteraBanco = /senha/i.test(JSON.stringify(b.input || {})) || b.name.startsWith("registrar_")
            || b.name.startsWith("cancelar_") || b.name.startsWith("editar_") || b.name.startsWith("criar_");
          let resultado;
          try {
            resultado = await executarFerramenta(b.name, b.input);
            if (alteraBanco) {
              logger.info(`[ferramenta] ${b.name} concluída`, { input: b.input, resultado });
            }
          } catch (err) {
            logger.error(`[ferramenta] ${b.name} lançou exceção`, { input: b.input, erro: err.message, stack: err.stack });
            resultado = { sucesso: false, erro: "excecao_interna", mensagem: `Falha interna ao executar ${b.name}: ${err.message}. NÃO informe sucesso ao usuário — avise que a ação falhou e peça pra tentar de novo.` };
          }
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

// Auto-corretor: sempre que um documento em 'diarias' é criado/atualizado,
// verifica se a quinzena atual já foi fechada (última folha paga criada
// dentro dela) — se foi, apaga o documento de novo. Protege contra clientes
// desatualizados (cache de service worker antigo) recriando diárias que o
// fechamento já zerou de propósito, não importa qual aparelho/navegador
// tenha feito a escrita.
exports.protegerDiariasFechadas = onDocumentWritten("diarias/{funcionarioId}", async (event) => {
  const depois = event.data.after;
  if (!depois.exists) return; // documento foi deletado, nada a corrigir

  process.env.TZ = "America/Sao_Paulo";
  const hoje = new Date();
  const ano = hoje.getFullYear(), mes = hoje.getMonth(), dia = hoje.getDate();
  const quinzenaInicio = new Date(ano, mes, dia <= 15 ? 1 : 16);
  const quinzenaFim    = dia <= 15 ? new Date(ano, mes, 15, 23, 59, 59, 999) : new Date(ano, mes + 1, 0, 23, 59, 59, 999);

  const ultimaFolhaSnap = await db.collection("folhas").orderBy("criadoEm", "desc").limit(1).get();
  if (ultimaFolhaSnap.empty) return;

  const ultima = ultimaFolhaSnap.docs[0].data();
  if (ultima.status !== "paga" || !ultima.criadoEm) return;

  const dtCriacao = ultima.criadoEm.toDate();
  if (dtCriacao >= quinzenaInicio && dtCriacao <= quinzenaFim) {
    await depois.ref.delete();
  }
});

// Todo dia 01, lança no Contas a Pagar uma cópia de cada despesa
// recorrente cadastrada em Configurações, com a data de vencimento no
// dia cadastrado (dentro do mesmo mês do lançamento; se o mês for mais
// curto que o dia cadastrado, usa o último dia do mês). Marca cada
// despesa recorrente com o mês já lançado pra nunca duplicar, mesmo se
// o Cloud Scheduler reexecutar a função.
exports.lancarDespesasRecorrentes = onSchedule(
  { schedule: "0 6 1 * *", timeZone: "America/Sao_Paulo" },
  async () => {
    const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth(); // 0-indexed
    const chaveMes = `${ano}-${String(mes + 1).padStart(2, "0")}`;
    const ultimoDiaMes = new Date(ano, mes + 1, 0).getDate();

    const snap = await db.collection("despesasRecorrentes").get();
    if (snap.empty) return;

    const batch = db.batch();
    let algumLancado = false;

    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.ultimoLancamento === chaveMes) continue;

      const dia = Math.min(Math.max(1, Number(d.diaMes) || 1), ultimoDiaMes);
      const dataVencimento = `${String(dia).padStart(2, "0")}/${String(mes + 1).padStart(2, "0")}/${ano}`;

      batch.set(db.collection("contasPagar").doc(), {
        data: dataVencimento,
        descricao: d.descricao,
        valor: d.valor,
        status: "aberto",
        despesaRecorrenteId: doc.id,
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
      batch.update(doc.ref, { ultimoLancamento: chaveMes });
      algumLancado = true;
    }

    if (algumLancado) await batch.commit();
    logger.info(`[despesasRecorrentes] lançamento do mês ${chaveMes} concluído`, { totalCadastradas: snap.size });
  }
);

// Converte "DD/MM/AAAA" pro timestamp de meia-noite (America/Sao_Paulo) do dia de vencimento
function parseDataVencimento(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((s || "").trim());
  if (!m) return null;
  const [, d, mo, a] = m;
  const ano = a.length === 2 ? "20" + a : a;
  const iso = `${ano}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return new Date(iso + "T00:00:00-03:00").getTime();
}

function fmtMoeda(v) {
  return "R$ " + (v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function linhaContaPagar(c) {
  return `${c.numero ? `Nº ${c.numero} - ` : ""}${c.descricao} - ${fmtMoeda(c.valor)} - vencimento ${c.data}`;
}

// Mensagem livre (sem restrição de template como a API da Meta usada no
// relatório de ponto) via Evolution API, self-hosted na VM da GCP.
// Manda pra todos os "destinatarios"; se algum falhar, tenta os outros
// mesmo assim e só lança erro no final (evita 1 número quebrado silenciar
// o aviso pros demais).
async function enviarWhatsAppEvolution(texto, apiKeyValue, destinatarios = EVOLUTION_DESTINATARIOS) {
  const erros = [];
  for (const numero of destinatarios) {
    const resp = await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: {
        "apikey": apiKeyValue,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ number: numero, text: texto })
    });
    if (!resp.ok) {
      const respText = await resp.text();
      erros.push(`${numero}: status ${resp.status} - ${respText.slice(0, 200)}`);
    }
  }
  if (erros.length > 0) {
    throw new Error(`Falha ao enviar WhatsApp via Evolution API para: ${erros.join(" | ")}`);
  }
}

// Mesma lógica de enviarWhatsAppEvolution, mas pra imagem (endpoint
// sendMedia em vez de sendText). "buffer" é o PNG já pronto (ex: retorno de
// gerarImagemExtrato).
async function enviarImagemEvolution(buffer, filename, caption, apiKeyValue, destinatarios = EVOLUTION_DESTINATARIOS) {
  const mediaBase64 = buffer.toString("base64");
  const erros = [];
  for (const numero of destinatarios) {
    const resp = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: {
        "apikey": apiKeyValue,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        number: numero,
        mediatype: "image",
        mimetype: "image/png",
        media: mediaBase64,
        fileName: filename,
        caption
      })
    });
    if (!resp.ok) {
      const respText = await resp.text();
      erros.push(`${numero}: status ${resp.status} - ${respText.slice(0, 200)}`);
    }
  }
  if (erros.length > 0) {
    throw new Error(`Falha ao enviar imagem via Evolution API para: ${erros.join(" | ")}`);
  }
}

// Dispara assim que uma conta a pagar é criada (não importa a origem — form
// manual em "apagar", adiantamento em "funcionarios", lançamento em "caixa"
// ou lançamento recorrente automático): se o vencimento já é hoje, avisa na
// hora em vez de esperar o resumo das 8h. Marca avisoImediatoEnviadoEm pra
// o resumo diário não avisar de novo a mesma conta no mesmo dia.
exports.avisoContaVencendoHoje = onDocumentCreated(
  { document: "contasPagar/{contaId}", secrets: [evolutionApiKey] },
  async (event) => {
    const c = event.data?.data();
    if (!c || c.status !== "aberto") return;

    const venc = parseDataVencimento(c.data);
    if (venc === null) return;

    const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const hoje = new Date(hojeStr + "T00:00:00-03:00").getTime();
    if (venc !== hoje) return;

    const texto = [
      "Nova conta a pagar vencendo hoje:",
      "",
      linhaContaPagar(c)
    ].join("\n");

    try {
      await enviarWhatsAppEvolution(texto, evolutionApiKey.value());
    } catch (e) {
      logger.error("Erro ao enviar aviso imediato de conta vencendo hoje:", e.message);
      throw e;
    }

    await event.data.ref.update({ avisoImediatoEnviadoEm: admin.firestore.FieldValue.serverTimestamp() });
    logger.info("[avisoContaVencendoHoje] aviso imediato enviado", { descricao: c.descricao, valor: c.valor });
  }
);

// Dispara quando uma conta a pagar de adiantamento salarial (descrição
// começando com "Adiantamento:" — padrão usado tanto na solicitação em
// Funcionários quanto no lançamento direto pelo Caixa) é baixada
// integralmente no Caixa (baixarContaAPagar em caixa/app.js muda o status
// pra "baixado"). Avisa pra um grupo de destinatários diferente do alerta
// de vencimento.
exports.avisoPagamentoAdiantamento = onDocumentUpdated(
  { document: "contasPagar/{contaId}", secrets: [evolutionApiKey] },
  async (event) => {
    const antes = event.data.before.data();
    const depois = event.data.after.data();
    if (!antes || !depois) return;
    if (antes.status === "baixado" || depois.status !== "baixado") return;
    if (!depois.descricao || !depois.descricao.startsWith("Adiantamento:")) return;

    const m = /^Adiantamento:\s*(.+?)\s*—/.exec(depois.descricao);
    const nome = m ? m[1].trim() : depois.descricao;
    const valorPago = depois.valorOriginal !== undefined ? depois.valorOriginal : depois.valor;

    const texto = [
      "Adiantamento pago no Caixa:",
      "",
      `${nome} - ${fmtMoeda(valorPago)} - pago em ${depois.dataBaixa || ""}`
    ].join("\n");

    try {
      await enviarWhatsAppEvolution(texto, evolutionApiKey.value(), EVOLUTION_DESTINATARIOS_ADIANTAMENTO);
    } catch (e) {
      logger.error("Erro ao enviar aviso de pagamento de adiantamento:", e.message);
      throw e;
    }

    logger.info("[avisoPagamentoAdiantamento] aviso enviado", { nome, valorPago });
  }
);

// Roda toda manhã e avisa no WhatsApp quais contas em "contasPagar" vencem
// hoje ou já passaram da data e ainda não foram baixadas. Contas que já
// levaram o aviso imediato (avisoContaVencendoHoje, acima) no mesmo dia da
// criação não entram de novo no bloco "Vencendo hoje" pra não duplicar aviso.
exports.alertaContasVencidas = onSchedule(
  { schedule: "0 8 * * *", timeZone: "America/Sao_Paulo", secrets: [evolutionApiKey] },
  async () => {
    const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const hoje = new Date(hojeStr + "T00:00:00-03:00").getTime();

    const snap = await db.collection("contasPagar").where("status", "==", "aberto").get();
    if (snap.empty) return;

    const abertasComVenc = snap.docs
      .map(doc => doc.data())
      .map(c => ({ c, venc: parseDataVencimento(c.data) }))
      .filter(({ venc }) => venc !== null && venc <= hoje)
      .sort((a, b) => a.venc - b.venc);

    if (abertasComVenc.length === 0) return;

    const vencendoHoje = abertasComVenc
      .filter(({ c, venc }) => venc === hoje && !c.avisoImediatoEnviadoEm)
      .map(({ c }) => c);
    const vencidas = abertasComVenc.filter(({ venc }) => venc < hoje).map(({ c }) => c);

    if (vencendoHoje.length === 0 && vencidas.length === 0) return;

    const blocos = [];
    if (vencendoHoje.length > 0) {
      blocos.push(`Vencendo hoje (${vencendoHoje.length}):`, "", ...vencendoHoje.map(linhaContaPagar), "");
    }
    if (vencidas.length > 0) {
      blocos.push(`Vencidas (${vencidas.length}):`, "", ...vencidas.map(linhaContaPagar), "");
    }
    const totalGeral = [...vencendoHoje, ...vencidas].reduce((acc, c) => acc + (c.valor || 0), 0);
    blocos.push(`Total: ${fmtMoeda(totalGeral)}`);

    const texto = blocos.join("\n");

    try {
      await enviarWhatsAppEvolution(texto, evolutionApiKey.value());
    } catch (e) {
      logger.error("Erro ao enviar alerta de contas vencidas:", e.message);
      throw e;
    }

    logger.info(`[alertaContasVencidas] enviado: ${vencendoHoje.length} vencendo hoje, ${vencidas.length} vencida(s)`, { totalGeral });
  }
);

// Roda todo dia às 10:35 e manda a imagem do extrato de refeições (café da
// manhã: entrada antes das 7h; almoço: entrada antes das 10:30) do dia atual
// pelo WhatsApp — mesma imagem gerada pela ferramenta extrato_refeicoes_imagem
// do agenteGW, mas automática e diária, via Evolution API em vez de Telegram.
exports.relatorioRefeicoesHoje = onSchedule(
  { schedule: "35 10 * * *", timeZone: "America/Sao_Paulo", secrets: [evolutionApiKey] },
  async () => {
    const hojeISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const dados = await calcularExtratoRefeicoes(hojeISO, hojeISO);
    const buffer = await gerarImagemExtrato(dados);

    try {
      await enviarImagemEvolution(
        buffer,
        `refeicoes_${hojeISO}.png`,
        "Refeições de Hoje",
        evolutionApiKey.value(),
        EVOLUTION_DESTINATARIOS_REFEICOES
      );
    } catch (e) {
      logger.error("Erro ao enviar relatório de refeições de hoje:", e.message);
      throw e;
    }

    logger.info("[relatorioRefeicoesHoje] enviado", {
      cafe: dados.totais.cafeManha,
      almoco: dados.totais.almoco
    });
  }
);
