const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const PROMPT = `Esta imagem é um boletim/planilha de medição de obra (construção civil), com colunas como: ITEM, DESCRIÇÃO, UND, QUANTIDADES (Prevista no Contrato, Acumulado Anterior, Executado no Período, Acumulado) e PREÇOS (Unitário, Contratado, Acumulado Anterior, Executado no Período, Acumulado), além de % Executado.

Para cada linha de item (ex: 1.1, 1.2, 1.12), extraia:
- "apartamento": o número do item, exatamente como aparece na coluna ITEM (ex: "1.1", "1.12").
- "servico": o texto da coluna DESCRIÇÃO.
- "valor": o valor em reais da coluna PREÇOS > EXECUTADO NO PERÍODO (não confundir com Acumulado, Contratado ou Acumulado Anterior).

Analise a imagem e retorne APENAS um array JSON (sem texto antes ou depois, sem markdown) no seguinte formato:
[{"apartamento":"1.1","servico":"Revestimento de gesso em pasta (Sala, área e quartos)","valor":14400.00}]

Regras:
- "valor": número decimal (use ponto como separador decimal, sem o símbolo R$ e sem separador de milhar).
- Ignore linhas de cabeçalho, totais, subtotais (ex: "TOTAL", "VALORES A DESCONTAR", "A PAGAR") ou linhas vazias.
- Ignore itens cujo valor de "Executado no Período" (em Preços) seja "-", vazio ou igual a 0.
- Se não conseguir identificar nenhum item, retorne [].`;

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

    const match = texto.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error("Resposta sem JSON:", texto);
      throw new HttpsError("internal", "Não foi possível interpretar a resposta da IA.");
    }

    let itens;
    try {
      itens = JSON.parse(match[0]);
    } catch (e) {
      console.error("JSON inválido:", match[0]);
      throw new HttpsError("internal", "A IA retornou um formato inválido.");
    }

    const limpos = itens
      .map(it => ({
        apartamento: String(it.apartamento || "").trim(),
        servico: String(it.servico || "").trim(),
        valor: Number(it.valor) || 0
      }))
      .filter(it => it.apartamento && it.servico);

    return { itens: limpos };
  }
);
