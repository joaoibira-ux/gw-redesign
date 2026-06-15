const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const PROMPT = `Esta imagem é um boletim/planilha de medição de obra (construção civil).

ESTRUTURA DA TABELA (colunas da esquerda para a direita):
ITEM | DESCRIÇÃO | UND | [bloco QUANTIDADES: Prevista no Contrato, Acumulado Anterior, Executado no Período, Acumulado] | PREÇOS UNITÁRIOS | [bloco PREÇOS: Contratado, Acumulado Anterior, Executado no Período, Acumulado] | % EXECUTADO

Abaixo da tabela de itens normalmente existem linhas de resumo, nesta ordem: "TOTAL", "VALORES A DESCONTAR" (geralmente destacada em vermelho) e "A PAGAR".

Extraia um objeto JSON com 4 campos:

1. "itens": para cada linha de item (ex: 1.1, 1.2, 1.12), extraia:
   - "apartamento": o número do item, exatamente como aparece na coluna ITEM (ex: "1.1", "1.12").
   - "servico": o texto da coluna DESCRIÇÃO.
   - "valor": o valor em reais da coluna "Executado no Período" DENTRO DO BLOCO PREÇOS — é a 3ª das 4 colunas do bloco PREÇOS, vem logo depois de "Preços Unitários" e antes da última coluna "Acumulado" do bloco PREÇOS.

   ATENÇÃO: existem DUAS colunas chamadas "Executado no Período" — uma no bloco QUANTIDADES (números pequenos, m²/unidades) e outra no bloco PREÇOS (valores em R$). Use SEMPRE a do bloco PREÇOS. Não confunda com "Acumulado" (última coluna de cada bloco) nem com "Contratado".

   Regras para "itens":
   - "valor": número decimal (use ponto como separador decimal, sem o símbolo R$ e sem separador de milhar).
   - Ignore linhas de cabeçalho e a linha de totais do "ITEM" pai (em negrito, sem descrição própria).
   - Ignore itens cujo "Executado no Período" (no bloco PREÇOS) seja "-", vazio ou igual a 0.

2. "total": o valor da linha "TOTAL", na coluna "Executado no Período" do bloco PREÇOS (geralmente é a soma dos valores de "itens").

3. "descontos": o valor da linha "VALORES A DESCONTAR" (geralmente destacada em vermelho). Se essa linha não existir, use 0.

4. "aPagar": o valor da linha "A PAGAR" (fica logo abaixo de "VALORES A DESCONTAR").

Todos os valores numéricos devem ser números decimais positivos (ponto como separador decimal, sem R$ e sem separador de milhar).

Retorne APENAS um objeto JSON (sem texto antes ou depois, sem markdown) no seguinte formato:
{"itens":[{"apartamento":"1.1","servico":"Revestimento de gesso em pasta (Sala, área e quartos)","valor":14400.00}], "total":24959.70, "descontos":3352.00, "aPagar":21607.70}

Se não conseguir identificar a tabela, retorne {"itens":[],"total":0,"descontos":0,"aPagar":0}.`;

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

    const itens = (resultado.itens || [])
      .map(it => ({
        apartamento: String(it.apartamento || "").trim(),
        servico: String(it.servico || "").trim(),
        valor: Number(it.valor) || 0
      }))
      .filter(it => it.apartamento && it.servico && it.valor !== 0);

    return {
      itens,
      total: Number(resultado.total) || 0,
      descontos: Number(resultado.descontos) || 0,
      aPagar: Number(resultado.aPagar) || 0
    };
  }
);
