/**
 * Adaptador da Anthropic (Messages API) — `fetch` direto, SEM SDK.
 *
 * É o ÚNICO arquivo do Advisor que conhece o provedor: o endereço, os cabeçalhos, o
 * formato do pedido e a credencial (que chega por parâmetro — este arquivo não lê o
 * ambiente nem escreve em log). Segue o padrão dos conectores do projeto (`fetch` +
 * Zod) e evita uma dependência nova; um SDK traria retry, log e telemetria próprios,
 * que seria preciso desligar para nada do pedido vazar.
 *
 * O que o pedido leva (conferido na documentação oficial da API, em 2026-10-04):
 *  - `output_config.format = { type: "json_schema", schema }`: saída estruturada
 *    nativa — o modelo é forçado ao schema (a validação Zod em `schema.ts` acontece
 *    de qualquer forma: nunca se confia cegamente no JSON);
 *  - `output_config.effort`: quanto o modelo pensa (latência × custo);
 *  - NÃO leva `temperature`, `top_p` nem `top_k`: os modelos Claude 5 respondem 400 a
 *    qualquer valor diferente do padrão. A baixa criatividade vem do prompt, do
 *    schema e do guard;
 *  - NÃO leva ferramentas, `tool_choice`, `metadata` nem nada que identifique o usuário.
 *
 * Falhas viram `AdvisorLlmError` com um código do vocabulário do Advisor; o texto do
 * provedor fica só em `debugDetail` (nunca em log, nunca na tela). Sem retry
 * automático: uma segunda tentativa dobraria latência e custo, e o fallback
 * determinístico já cobre a indisponibilidade.
 */
import { z } from "zod";

import type { ModelFailureReason } from "../limitations";

import { AdvisorLlmError, type LlmRequest, type LlmResult, type LlmTransport } from "./transport";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
/** Versão estável da API (cabeçalho obrigatório). */
export const ANTHROPIC_VERSION = "2023-06-01";
/**
 * Teto de saída. Os tokens de raciocínio contam aqui; é um limite, não uma meta: só se
 * paga o que o modelo gera. Alto o bastante para raciocínio + um fechamento completo.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
export const DEFAULT_TIMEOUT_MS = 90_000;

export interface AnthropicTransportOptions {
  /** a credencial — nunca registrada */
  apiKey: string;
  model: string;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
  maxOutputTokens?: number;
  baseUrl?: string;
  /** injetável: os testes trocam o `fetch` por um servidor de mentira */
  fetchImpl?: typeof fetch;
}

const successSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

const errorSchema = z.object({
  error: z.object({ type: z.string().optional(), message: z.string().optional() }).optional(),
});

/**
 * Cobrança: a API usa 402 (`billing_error`) e TAMBÉM responde 400 quando o saldo acaba ou o
 * limite de gasto é atingido ("credit balance is too low…"). O texto do provedor serve só
 * para CLASSIFICAR (nunca é mostrado nem registrado); se mudar, cai no motivo genérico.
 */
function isBilling(status: number, errorType: string | undefined, message: string | undefined): boolean {
  if (status === 402 || errorType === "billing_error") return true;
  return status === 400 && /credit balance|spend limit|billing/i.test(message ?? "");
}

/** Mapa de status HTTP → motivo. 429/529/5xx: indisponível agora; 408/504: tempo; o resto: pedido recusado. */
function failureForStatus(status: number): ModelFailureReason {
  if (status === 408 || status === 504) return "timeout";
  if (status === 429 || status === 529 || status >= 500) return "unavailable";
  return "rejected_by_provider";
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export function createAnthropicTransport(options: AnthropicTransportOptions): LlmTransport {
  const {
    apiKey,
    model,
    effort = "medium",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    baseUrl = ANTHROPIC_BASE_URL,
    fetchImpl = fetch,
  } = options;

  return {
    provider: "anthropic",
    model,

    async generate(request: LlmRequest): Promise<LlmResult> {
      const body = {
        model,
        max_tokens: maxOutputTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: {
          effort,
          format: { type: "json_schema", schema: request.jsonSchema },
        },
      };

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
          redirect: "error",
        });
      } catch (error) {
        // rede fora do ar, DNS, conexão recusada, ou o tempo limite estourou
        throw new AdvisorLlmError(isTimeout(error) ? "timeout" : "unavailable", {
          debugDetail: (error as { name?: string } | null)?.name,
        });
      }

      const requestId = response.headers.get("request-id") ?? undefined;

      if (!response.ok) {
        let providerErrorType: string | undefined;
        let providerMessage: string | undefined;
        try {
          const parsed = errorSchema.safeParse(await response.json());
          if (parsed.success) {
            providerErrorType = parsed.data.error?.type;
            providerMessage = parsed.data.error?.message;
          }
        } catch {
          // corpo que não é JSON (proxy, página de erro): o status basta
        }
        const code = isBilling(response.status, providerErrorType, providerMessage)
          ? "billing"
          : failureForStatus(response.status);
        throw new AdvisorLlmError(code, {
          httpStatus: response.status,
          ...(providerErrorType ? { providerErrorType } : {}),
          ...(requestId ? { requestId } : {}),
          ...(providerMessage ? { debugDetail: providerMessage } : {}),
        });
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch (error) {
        throw new AdvisorLlmError(isTimeout(error) ? "timeout" : "invalid_output", {
          ...(requestId ? { requestId } : {}),
          debugDetail: "corpo da resposta não é JSON",
        });
      }

      const parsed = successSchema.safeParse(json);
      if (!parsed.success) {
        throw new AdvisorLlmError("invalid_output", {
          ...(requestId ? { requestId } : {}),
          debugDetail: "resposta do provedor fora do formato esperado",
        });
      }

      const { content, stop_reason: stopReason, usage } = parsed.data;
      const fail = (code: ModelFailureReason, detail: string) =>
        new AdvisorLlmError(code, { ...(requestId ? { requestId } : {}), debugDetail: detail });

      // recusa e truncamento NÃO garantem o schema: nunca aproveitar o texto
      if (stopReason === "refusal") throw fail("refusal", "stop_reason=refusal");
      if (stopReason === "max_tokens") throw fail("truncated", "stop_reason=max_tokens");
      if (stopReason && stopReason !== "end_turn" && stopReason !== "stop_sequence") {
        throw fail("invalid_output", `stop_reason=${stopReason}`);
      }

      // blocos de raciocínio (`thinking`) são ignorados; o JSON está no bloco de texto
      const text = content.find((block) => block.type === "text" && typeof block.text === "string")?.text;
      if (text === undefined || text.trim() === "") throw fail("invalid_output", "sem bloco de texto");

      return {
        text,
        ...(usage
          ? {
              usage: {
                ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
                ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
              },
            }
          : {}),
        ...(requestId ? { requestId } : {}),
      };
    },
  };
}
