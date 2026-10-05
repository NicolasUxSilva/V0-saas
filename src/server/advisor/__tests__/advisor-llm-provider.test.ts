/**
 * Provider (Anthropic Messages API) — o adaptador testado no nível do HTTP.
 *
 * Um `fetch` de mentira faz o papel da API; o que se prova é o contrato do adaptador:
 * o pedido sai no formato documentado (e SEM o que os modelos Claude 5 recusam), a
 * resposta válida é lida, toda resposta inválida e todo erro da API viram um
 * `AdvisorLlmError` com o código certo — e nada do texto do provedor, nem a
 * credencial, vaza na mensagem de erro.
 */
import { describe, expect, it } from "vitest";

import { createAnthropicTransport, ANTHROPIC_VERSION } from "../llm/anthropic";
import { AdvisorLlmError } from "../llm/transport";
import type { LlmRequest } from "../llm/transport";
import { anthropicError, anthropicOk, fakeFetch } from "./advisor-llm-fixtures";

const KEY = "sk-ant-TESTE-credencial-que-nunca-pode-vazar";
const REQUEST: LlmRequest = {
  system: "instruções fixas",
  user: '{"query":{"intent":"closing_report"},"context":{}}',
  jsonSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
};

const transportOver = (handler: Parameters<typeof fakeFetch>[0], over: Partial<Parameters<typeof createAnthropicTransport>[0]> = {}) => {
  const http = fakeFetch(handler);
  const transport = createAnthropicTransport({ apiKey: KEY, model: "claude-sonnet-5-5", fetchImpl: http.fetchImpl, ...over });
  return { transport, ...http };
};

const failure = async (p: Promise<unknown>): Promise<AdvisorLlmError> => {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(AdvisorLlmError);
    return error as AdvisorLlmError;
  }
  throw new Error("era esperado que a chamada falhasse");
};

describe("o pedido que sai para a API", () => {
  it("endereço, método e cabeçalhos da Messages API — a credencial só no cabeçalho `x-api-key`", async () => {
    const { transport, calls } = transportOver(() => anthropicOk("{}"));
    await transport.generate(REQUEST);
    const [call] = calls;
    expect(call!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call!.init.method).toBe("POST");
    const headers = call!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(headers["content-type"]).toBe("application/json");
    // a credencial NÃO vai no corpo, na URL nem em outro cabeçalho
    expect(JSON.stringify(call!.body)).not.toContain(KEY);
    expect(call!.url).not.toContain(KEY);
    expect(Object.entries(headers).filter(([, v]) => v.includes(KEY)).map(([k]) => k)).toEqual(["x-api-key"]);
  });

  it("corpo: modelo, teto de saída, system, UMA mensagem do usuário e saída estruturada com `effort`", async () => {
    const { transport, calls } = transportOver(() => anthropicOk("{}"), { effort: "low", maxOutputTokens: 4000 });
    await transport.generate(REQUEST);
    const { body } = calls[0]!;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(4000);
    expect(body.system).toBe(REQUEST.system);
    expect(body.messages).toEqual([{ role: "user", content: REQUEST.user }]);
    expect(body.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: REQUEST.jsonSchema },
    });
  });

  it("NÃO envia o que os modelos Claude 5 recusam (temperature/top_p/top_k) nem ferramentas, tool_choice ou metadata", async () => {
    const { transport, calls } = transportOver(() => anthropicOk("{}"));
    await transport.generate(REQUEST);
    const keys = Object.keys(calls[0]!.body).sort();
    expect(keys).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
    for (const forbidden of ["temperature", "top_p", "top_k", "tools", "tool_choice", "metadata", "thinking", "stream"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("tem tempo limite, não segue redirecionamento e não usa cache", async () => {
    const { transport, calls } = transportOver(() => anthropicOk("{}"));
    await transport.generate(REQUEST);
    const init = calls[0]!.init;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
  });

  it("padrões seguros: esforço `medium` e teto de saída alto o bastante para raciocínio + fechamento", async () => {
    const { transport, calls } = transportOver(() => anthropicOk("{}"));
    await transport.generate(REQUEST);
    expect((calls[0]!.body.output_config as { effort: string }).effort).toBe("medium");
    expect(calls[0]!.body.max_tokens).toBeGreaterThanOrEqual(8000);
  });
});

describe("resposta VÁLIDA", () => {
  it("devolve o texto do bloco `text` (ignorando o bloco de raciocínio), o uso de tokens e o id da requisição", async () => {
    const { transport } = transportOver(() => anthropicOk('{"a":"x"}'));
    const result = await transport.generate(REQUEST);
    expect(result.text).toBe('{"a":"x"}');
    expect(result.usage).toEqual({ inputTokens: 5000, outputTokens: 900 });
    expect(result.requestId).toBe("req_abc");
  });

  it("identifica o provedor e o modelo", () => {
    const { transport } = transportOver(() => anthropicOk("{}"), { model: "claude-opus-5-5" });
    expect(transport.provider).toBe("anthropic");
    expect(transport.model).toBe("claude-opus-5-5");
  });

  it("aceita `stop_sequence` e ignora campos desconhecidos nos blocos", async () => {
    const { transport } = transportOver(() =>
      anthropicOk("x", { stop_reason: "stop_sequence", content: [{ type: "text", text: '{"a":"y"}', citations: [], extra: 1 }] }),
    );
    expect((await transport.generate(REQUEST)).text).toBe('{"a":"y"}');
  });
});

describe("resposta INVÁLIDA", () => {
  const codeFor = async (response: Response | (() => Response)) => {
    const { transport } = transportOver(() => (typeof response === "function" ? response() : response));
    return (await failure(transport.generate(REQUEST))).code;
  };

  it("sem bloco de texto (só raciocínio) → `invalid_output`", async () => {
    expect(await codeFor(anthropicOk("", { content: [{ type: "thinking", thinking: "…", signature: "s" }] }))).toBe("invalid_output");
  });

  it("texto vazio ou só espaços → `invalid_output`", async () => {
    expect(await codeFor(anthropicOk("   \n"))).toBe("invalid_output");
  });

  it("corpo que não é JSON (proxy devolvendo HTML com 200) → `invalid_output`", async () => {
    expect(await codeFor(new Response("<html>ok</html>", { status: 200 }))).toBe("invalid_output");
  });

  it("JSON fora do formato da Messages API (sem `content`) → `invalid_output`", async () => {
    expect(await codeFor(new Response(JSON.stringify({ hello: "world" }), { status: 200 }))).toBe("invalid_output");
  });

  it("`stop_reason: refusal` → `refusal`: a recusa não garante o schema, o texto nunca é aproveitado", async () => {
    expect(await codeFor(anthropicOk('{"a":"x"}', { stop_reason: "refusal" }))).toBe("refusal");
  });

  it("`stop_reason: max_tokens` → `truncated`: um JSON cortado nunca é aproveitado", async () => {
    expect(await codeFor(anthropicOk('{"a":', { stop_reason: "max_tokens" }))).toBe("truncated");
  });

  it("`stop_reason` inesperado (tool_use, pause_turn) → `invalid_output`", async () => {
    expect(await codeFor(anthropicOk("{}", { stop_reason: "tool_use" }))).toBe("invalid_output");
    expect(await codeFor(anthropicOk("{}", { stop_reason: "pause_turn" }))).toBe("invalid_output");
  });
});

describe("ERRO da API", () => {
  const table: [number, string, string, string][] = [
    [400, "invalid_request_error", "rejected_by_provider", "pedido inválido"],
    [401, "authentication_error", "rejected_by_provider", "chave inválida"],
    [402, "billing_error", "billing", "faturamento"],
    [403, "permission_error", "rejected_by_provider", "sem permissão"],
    [404, "not_found_error", "rejected_by_provider", "modelo não encontrado"],
    [413, "request_too_large", "rejected_by_provider", "pedido grande demais"],
    [429, "rate_limit_error", "unavailable", "limite de taxa"],
    [500, "api_error", "unavailable", "erro interno"],
    [529, "overloaded_error", "unavailable", "sobrecarregado"],
    [504, "timeout_error", "timeout", "tempo esgotado no provedor"],
  ];

  it.each(table)("HTTP %i (%s) → `%s`, com status e tipo do erro guardados", async (status, type, code, message) => {
    const { transport } = transportOver(() => anthropicError(status, type, message));
    const error = await failure(transport.generate(REQUEST));
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(status);
    expect(error.providerErrorType).toBe(type);
    expect(error.requestId).toBe("req_err");
  });

  it("COBRANÇA: a API também responde 400 quando o saldo acaba ou o limite de gasto é atingido — vira `billing`, não 'pedido recusado'", async () => {
    for (const message of [
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      "You have reached your workspace spend limit.",
    ]) {
      const { transport } = transportOver(() => anthropicError(400, "invalid_request_error", message));
      const error = await failure(transport.generate(REQUEST));
      expect(error.code, message).toBe("billing");
      expect(error.httpStatus).toBe(400);
      expect(error.message).toBe("a conta do provedor do modelo está sem crédito ou atingiu o limite de gasto");
      expect(error.message.includes("Plans & Billing")).toBe(false); // o texto do provedor não é repetido
    }
  });

  it("um 400 comum (pedido malformado) NÃO é cobrança — continua `rejected_by_provider`", async () => {
    const { transport } = transportOver(() => anthropicError(400, "invalid_request_error", "output_config.format.schema: campo desconhecido"));
    expect((await failure(transport.generate(REQUEST))).code).toBe("rejected_by_provider");
  });

  it("o texto do provedor fica só em `debugDetail`: a mensagem do erro é genérica e nunca o repete", async () => {
    const { transport } = transportOver(() => anthropicError(400, "invalid_request_error", "campo X com o valor SEGREDO-ECOADO é inválido"));
    const error = await failure(transport.generate(REQUEST));
    expect(error.message).not.toContain("SEGREDO-ECOADO");
    expect(error.debugDetail).toContain("SEGREDO-ECOADO"); // só para depuração local
    expect(error.message).toBe("o provedor recusou o pedido");
  });

  it("corpo de erro que não é JSON (página do proxy) → o status basta para classificar", async () => {
    const { transport } = transportOver(() => new Response("<h1>Bad gateway</h1>", { status: 502 }));
    const error = await failure(transport.generate(REQUEST));
    expect(error.code).toBe("unavailable");
    expect(error.httpStatus).toBe(502);
    expect(error.providerErrorType).toBeUndefined();
  });

  it("408 → `timeout`", async () => {
    const { transport } = transportOver(() => new Response("", { status: 408 }));
    expect((await failure(transport.generate(REQUEST))).code).toBe("timeout");
  });

  it("rede fora do ar (o `fetch` rejeita) → `unavailable`", async () => {
    const { transport } = transportOver(() => Promise.reject(new TypeError("fetch failed")));
    expect((await failure(transport.generate(REQUEST))).code).toBe("unavailable");
  });
});

describe("TIMEOUT", () => {
  it("o tempo limite estoura e vira `timeout` — a chamada nunca fica pendurada", async () => {
    // um servidor que nunca responde, mas respeita o sinal de cancelamento
    const { transport } = transportOver(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      { timeoutMs: 25 },
    );
    const started = Date.now();
    const error = await failure(transport.generate(REQUEST));
    expect(error.code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("o tempo limite também vale para a leitura do corpo", async () => {
    const { transport } = transportOver(
      ({ init }) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 200 });
      },
      { timeoutMs: 25 },
    );
    expect((await failure(transport.generate(REQUEST))).code).toBe("timeout");
  });
});

describe("a credencial nunca vaza", () => {
  it("nem na mensagem, nem no `debugDetail`, nem no JSON do erro — em nenhum tipo de falha", async () => {
    const scenarios: Parameters<typeof fakeFetch>[0][] = [
      () => anthropicError(401, "authentication_error", "invalid x-api-key"),
      () => anthropicError(500, "api_error", "boom"),
      () => Promise.reject(new TypeError("fetch failed")),
      () => anthropicOk("", { content: [] }),
      () => anthropicOk('{"a":1}', { stop_reason: "refusal" }),
    ];
    for (const handler of scenarios) {
      const { transport } = transportOver(handler);
      const error = await failure(transport.generate(REQUEST));
      expect(error.message).not.toContain(KEY);
      expect(error.debugDetail ?? "").not.toContain(KEY);
      expect(JSON.stringify({ ...error, message: error.message })).not.toContain(KEY);
    }
  });
});
