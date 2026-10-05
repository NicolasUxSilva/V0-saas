/**
 * Fixtures do modelo de linguagem do Advisor.
 *
 * O contexto é o MESMO dos testes da fundação: o fechamento parcial de outubro em
 * miniatura, produzido pelo construtor real do Cross-source e relido por um store em
 * memória que imita o jsonb. A "saída de um modelo bom" (`goodOutput`) é escrita a
 * partir desse contexto — cada número vem do `display` de uma evidência, nenhum é
 * digitado à mão — e é o que um LLM obediente devolveria. Os testes a deformam para
 * simular o que um modelo que mente, alucina ou obedece a um atacante devolveria.
 */
import { buildAdvisorContext } from "../context";
import { projectContextForModel } from "../llm/privacy";
import type { AdvisorLlmOutput } from "../llm/schema";
import type { LlmRequest, LlmResult, LlmTransport } from "../llm/transport";
import type { AdvisorContext, AdvisorDiagnosticItem, AdvisorQuery } from "../types";
import {
  OCT_PERIOD,
  SEP_PERIOD,
  WS,
  diagnosticItem,
  octoberContext,
  persist,
  septemberContext,
  sourcesFrom,
} from "./advisor-fixtures";

export const QUERY: AdvisorQuery = { workspaceId: WS, period: OCT_PERIOD, intent: "closing_report" };

export async function setup(
  opts: {
    compare?: boolean;
    diagnostics?: AdvisorDiagnosticItem[];
    context?: ReturnType<typeof octoberContext>;
  } = {},
) {
  const memory = await persist(opts.context ?? octoberContext(), OCT_PERIOD);
  if (opts.compare) await persist(septemberContext(), SEP_PERIOD, memory);
  const deps = sourcesFrom(memory, opts.diagnostics ?? [diagnosticItem()]);
  const context = await buildAdvisorContext(WS, OCT_PERIOD, opts.compare ? { comparePeriod: SEP_PERIOD } : {}, deps);
  return { deps, context, memory };
}

/** O id curto (E5…) que o modelo vê para a evidência `ga4.sessions`, `rd_crm.won_value`… */
export function evId(context: AdvisorContext, metricId: string): string {
  for (const [id, ref] of projectContextForModel(context).aliasToRef) {
    if (ref.startsWith(`${metricId}@`)) return id;
  }
  throw new Error(`a evidência ${metricId} não existe no contexto`);
}

/** O `display` de uma evidência — o texto que o modelo deve copiar. */
export function disp(context: AdvisorContext, metricId: string): string {
  const e = context.evidence.find((x) => x.ref.startsWith(`${metricId}@`));
  if (!e || e.display === null) throw new Error(`sem display para ${metricId}`);
  return e.display;
}

/** A referência real (`ga4.sessions@2026-10-01..2026-10-04`) de uma evidência. */
export function refOf(context: AdvisorContext, metricId: string): string {
  const e = context.evidence.find((x) => x.ref.startsWith(`${metricId}@`));
  if (!e) throw new Error(`a evidência ${metricId} não existe no contexto`);
  return e.ref;
}

/** Um item de seção, no formato do schema. */
export const item = (
  layer: AdvisorLlmOutput["sections"][number]["items"][number]["layer"],
  text: string,
  evidenceIds: string[],
  limitationCode: string | null = null,
): AdvisorLlmOutput["sections"][number]["items"][number] => ({ layer, text, evidenceIds, limitationCode });

/** O que um LLM obediente devolve para o fechamento de outubro: números só dos `display`, tudo citado. */
export function goodOutput(context: AdvisorContext): AdvisorLlmOutput {
  const id = (m: string) => evId(context, m);
  const d = (m: string) => disp(context, m);
  const days = String(context.period.days);
  return {
    title: "Fechamento parcial de 01/10/2026 a 04/10/2026",
    summary:
      `No período de 01/10/2026 a 04/10/2026, o GA4 registrou ${d("ga4.sessions")} sessões e o RD Marketing registrou ` +
      `${d("rd_marketing.visits")} visitas e ${d("rd_marketing.conversions")} conversões. No RD CRM, foram ` +
      `${d("rd_crm.created_deals")} negócios criados, ${d("rd_crm.won_deals")} ganhos e ${d("rd_crm.lost_deals")} perdidos.`,
    sections: [
      {
        title: "Aquisição",
        content: "Dois sinais de fontes diferentes, no mesmo período, apresentados lado a lado.",
        figureIds: [id("ga4.sessions"), id("rd_marketing.visits"), id("rd_marketing.conversions")],
        items: [
          item("fact", `O GA4 registrou ${d("ga4.sessions")} sessões em ${d("ga4.days_with_data")} de ${days} dias.`, [
            id("ga4.sessions"),
            id("ga4.days_with_data"),
          ]),
          item(
            "fact",
            `O RD Marketing registrou ${d("rd_marketing.visits")} visitas e ${d("rd_marketing.conversions")} conversões.`,
            [id("rd_marketing.visits"), id("rd_marketing.conversions")],
          ),
          item(
            "observable_relationship",
            `No período, o GA4 registrou ${d("ga4.sessions")} sessões e o RD Marketing registrou ${d("rd_marketing.visits")} visitas.`,
            [id("ga4.sessions"), id("rd_marketing.visits")],
          ),
          item("hypothesis", "Isso pode indicar uma diferença de população ou de instrumentação entre as fontes.", [
            id("ga4.sessions"),
            id("rd_marketing.visits"),
          ]),
        ],
      },
      {
        title: "Comercial",
        content: "Atividade registrada no RD CRM e a cobertura do valor.",
        figureIds: [id("rd_crm.created_deals"), id("rd_crm.won_deals"), id("rd_crm.lost_deals"), id("rd_crm.won_value")],
        items: [
          item(
            "fact",
            `O RD CRM registrou ${d("rd_crm.created_deals")} negócios criados, ${d("rd_crm.won_deals")} ganhos e ${d("rd_crm.lost_deals")} perdidos.`,
            [id("rd_crm.created_deals"), id("rd_crm.won_deals"), id("rd_crm.lost_deals")],
          ),
          item(
            "fact",
            `Valor ganho informado: ${d("rd_crm.won_value")}, referente a ${d("rd_crm.won_deals_with_value")} dos ${d("rd_crm.won_deals")} negócios ganhos; a moeda não está informada.`,
            [id("rd_crm.won_value"), id("rd_crm.won_deals_with_value"), id("rd_crm.won_deals")],
          ),
          item("limitation", "", [], "currency_not_informed"),
        ],
      },
    ],
    insightRefs: [{ origin: "cross_source", key: "commercial-activity" }],
  };
}

/**
 * O que um LLM obediente devolve quando o GA4 NÃO tem dado no período: só o que existe
 * (RD CRM) e, sobre o GA4, a ausência dita como ausência — sem número, sem "zero".
 */
export function ga4AbsentOutput(context: AdvisorContext): AdvisorLlmOutput {
  const id = (m: string) => evId(context, m);
  const d = (m: string) => disp(context, m);
  return {
    title: "Fechamento parcial de 01/10/2026 a 04/10/2026",
    summary: `O GA4 não tem dados para o período. No RD CRM, foram ${d("rd_crm.created_deals")} negócios criados, ${d("rd_crm.won_deals")} ganhos e ${d("rd_crm.lost_deals")} perdidos.`,
    sections: [
      {
        title: "Comercial",
        content: "Atividade registrada no RD CRM.",
        figureIds: [id("rd_crm.created_deals"), id("rd_crm.won_deals"), id("rd_crm.lost_deals")],
        items: [
          item("fact", `O RD CRM registrou ${d("rd_crm.created_deals")} negócios criados, ${d("rd_crm.won_deals")} ganhos e ${d("rd_crm.lost_deals")} perdidos.`, [
            id("rd_crm.created_deals"),
            id("rd_crm.won_deals"),
            id("rd_crm.lost_deals"),
          ]),
        ],
      },
    ],
    insightRefs: [],
  };
}

export const ok = (output: unknown): LlmResult => ({
  text: typeof output === "string" ? output : JSON.stringify(output),
  usage: { inputTokens: 5000, outputTokens: 900 },
  requestId: "req_test_123",
});

export interface FakeTransport extends LlmTransport {
  calls: LlmRequest[];
}

/** Um transporte de mentira: responde o que a função mandar e guarda o que recebeu. */
export function fakeTransport(
  respond: (request: LlmRequest, calls: LlmRequest[]) => LlmResult | Promise<LlmResult>,
  identity: { provider: string; model: string } = { provider: "fake", model: "fake-1" },
): FakeTransport {
  const calls: LlmRequest[] = [];
  return {
    ...identity,
    calls,
    async generate(request) {
      calls.push(request);
      return respond(request, calls);
    },
  };
}

// ── HTTP: um servidor de mentira no nível do `fetch` (para o adaptador da Anthropic) ──

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

export function fakeFetch(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** A resposta de sucesso da Messages API, com um bloco de raciocínio antes do texto. */
export function anthropicOk(
  text: string,
  over: { stop_reason?: string | null; content?: unknown[]; usage?: unknown } = {},
): Response {
  return new Response(
    JSON.stringify({
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: over.content ?? [
        { type: "thinking", thinking: "raciocínio interno", signature: "sig" },
        { type: "text", text },
      ],
      stop_reason: "stop_reason" in over ? over.stop_reason : "end_turn",
      usage: over.usage ?? { input_tokens: 5000, output_tokens: 900 },
    }),
    { status: 200, headers: { "content-type": "application/json", "request-id": "req_abc" } },
  );
}

export function anthropicError(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message }, request_id: "req_err" }), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_err" },
  });
}

/** Resposta colhida no log: todo evento (objeto) serializado como o servidor o escreveria. */
export function captureLog() {
  const events: unknown[] = [];
  return { events, sink: (e: unknown) => void events.push(e) };
}
