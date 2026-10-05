/**
 * `LlmAdvisorModel` — o `AdvisorModel` que usa um modelo de linguagem.
 *
 *   AdvisorService ─▶ AdvisorModel ─▶ LlmTransport ─▶ provedor
 *
 * O que ele faz, na ordem:
 *   1. monta a entrada por PROJEÇÃO explícita do contexto (`buildAdvisorModelInput`);
 *   2. varre o payload em busca de PII — achou, NÃO envia (`privacy_blocked`);
 *   3. chama o transporte (o único que fala com o provedor);
 *   4. parseia e valida o JSON com Zod (`parseLlmOutput`) — nunca confia cegamente;
 *   5. converte para `AdvisorModelResponse` (ids curtos → referências reais; o status
 *      é derivado pelo sistema; o texto de uma limitação vem do contexto).
 *
 * O guard (`validateLlmDraft`) roda DEPOIS, no serviço: este módulo só produz o rascunho.
 * Toda falha lança `AdvisorLlmError` (nunca o texto do provedor) e o serviço cai no
 * modelo determinístico. Cada chamada registra só metadados (`log.ts`).
 */
import { ADVISOR_PROMPT_VERSION, buildAdvisorModelInput } from "../llm-contract";
import { logAdvisorEvent, type AdvisorLogSink } from "../log";
import type { AdvisorModel, AdvisorModelInput, AdvisorModelResponse } from "../types";

import { buildSystemPrompt, buildUserMessage } from "./prompt";
import { scanForPii } from "./privacy";
import { advisorLlmJsonSchema, parseLlmOutput, toModelResponse } from "./schema";
import { AdvisorLlmError, type LlmTransport } from "./transport";

export interface LlmAdvisorModelDeps {
  /** padrão: o log de metadados do servidor */
  log?: AdvisorLogSink;
  /** relógio monotônico em ms (padrão: `performance.now`) — injetável nos testes */
  clock?: () => number;
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

export class LlmAdvisorModel implements AdvisorModel {
  readonly id: string;
  readonly promptVersion = ADVISOR_PROMPT_VERSION;
  private readonly jsonSchema = advisorLlmJsonSchema();

  constructor(
    private readonly transport: LlmTransport,
    private readonly deps: LlmAdvisorModelDeps = {},
  ) {
    this.id = `${transport.provider}:${transport.model}`;
  }

  async generate({ context, query }: AdvisorModelInput): Promise<AdvisorModelResponse> {
    const log = this.deps.log ?? logAdvisorEvent;
    const clock = this.deps.clock ?? (() => performance.now());
    const started = clock();
    const base = {
      event: "advisor.llm" as const,
      workspaceId: query.workspaceId,
      intent: query.intent,
      period: { start: query.period.startDate, end: query.period.endDate },
      provider: this.transport.provider,
      model: this.transport.model,
      promptVersion: ADVISOR_PROMPT_VERSION,
    };
    const latency = () => Math.round(clock() - started);

    try {
      const input = buildAdvisorModelInput({ context, query });

      // a pergunta digitada vai junto: um dado pessoal nela também bloqueia o envio
      const pii = scanForPii({ query: input.query, context: input.view });
      if (pii.length > 0) {
        throw new AdvisorLlmError("privacy_blocked", { piiKinds: unique(pii.map((f) => f.kind)) });
      }

      const result = await this.transport.generate({
        system: buildSystemPrompt(),
        user: buildUserMessage(input),
        jsonSchema: this.jsonSchema,
      });

      const output = parseLlmOutput(result.text);
      const response = toModelResponse(output, { context, query, aliasToRef: input.aliasToRef });

      log({
        ...base,
        outcome: "ok",
        latencyMs: latency(),
        ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
        ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
        ...(result.requestId ? { requestId: result.requestId } : {}),
      });
      return response;
    } catch (error) {
      if (error instanceof AdvisorLlmError) {
        log({
          ...base,
          outcome: "failed",
          reason: error.code,
          latencyMs: latency(),
          ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
          ...(error.providerErrorType ? { providerErrorType: error.providerErrorType } : {}),
          ...(error.requestId ? { requestId: error.requestId } : {}),
          ...(error.piiKinds ? { piiKinds: error.piiKinds } : {}),
        });
      } else {
        // erro inesperado (bug nosso): registra que falhou, sem conteúdo, e deixa o serviço cair no determinístico
        log({ ...base, outcome: "failed", latencyMs: latency() });
      }
      throw error;
    }
  }
}

/**
 * O modelo de linguagem está HABILITADO mas sem credencial: em vez de fingir que não
 * existe, falha de forma explícita — o serviço responde de forma determinística e a
 * resposta diz por quê (`model_failed`, "não está configurado neste ambiente").
 */
export class UnconfiguredLlmModel implements AdvisorModel {
  readonly id: string;
  readonly promptVersion = ADVISOR_PROMPT_VERSION;

  constructor(
    provider: string,
    private readonly modelName: string,
    private readonly deps: Pick<LlmAdvisorModelDeps, "log"> = {},
  ) {
    this.id = `${provider}:${modelName}`;
  }

  async generate({ query }: AdvisorModelInput): Promise<AdvisorModelResponse> {
    (this.deps.log ?? logAdvisorEvent)({
      event: "advisor.llm",
      workspaceId: query.workspaceId,
      intent: query.intent,
      period: { start: query.period.startDate, end: query.period.endDate },
      provider: this.id.split(":")[0] ?? "unknown",
      model: this.modelName,
      promptVersion: ADVISOR_PROMPT_VERSION,
      outcome: "failed",
      reason: "not_configured",
      latencyMs: 0,
    });
    throw new AdvisorLlmError("not_configured");
  }
}
