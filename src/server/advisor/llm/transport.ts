/**
 * A fronteira com o provedor de LLM — só TIPOS e o erro. PURO.
 *
 *   AdvisorService ─▶ AdvisorModel (LlmAdvisorModel) ─▶ LlmTransport ─▶ provedor
 *
 * O serviço, o guard e o contexto conhecem `AdvisorModel`; o `LlmAdvisorModel`
 * conhece `LlmTransport`; só o adaptador concreto (`anthropic.ts`) conhece o
 * provedor, o endereço, o formato do pedido e a credencial. Trocar de provedor é
 * escrever outro `LlmTransport` — nada acima muda.
 */
import { MODEL_FAILURE_TEXT, type ModelFailureReason } from "../limitations";

export interface LlmRequest {
  /** instruções fixas (confiáveis): papel, regras, hierarquia da verdade, formato */
  system: string;
  /** a mensagem do usuário: um documento JSON com `query` (inclui a pergunta, NÃO confiável) e `context` */
  user: string;
  /** JSON Schema da saída; o provedor pode impô-lo, mas a validação Zod acontece de qualquer forma */
  jsonSchema: Record<string, unknown>;
}

export interface LlmResult {
  /** o texto devolvido pelo modelo — JSON no formato do schema, ainda NÃO confiável */
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** id da requisição no provedor, para suporte */
  requestId?: string;
}

export interface LlmTransport {
  /** `anthropic` — compõe o id do modelo e vai para o log */
  readonly provider: string;
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResult>;
}

interface LlmErrorInit {
  httpStatus?: number;
  providerErrorType?: string;
  requestId?: string;
  piiKinds?: string[];
  /** detalhe técnico (texto do provedor, caminho de schema) — SÓ depuração local: nunca vai para log nem para a tela */
  debugDetail?: string;
}

/**
 * Falha de uma chamada ao modelo. `message` é sempre o texto genérico do `code`
 * (`MODEL_FAILURE_TEXT`), nunca o do provedor — o provedor pode ecoar o pedido.
 */
export class AdvisorLlmError extends Error {
  readonly code: ModelFailureReason;
  readonly httpStatus?: number;
  readonly providerErrorType?: string;
  readonly requestId?: string;
  readonly piiKinds?: string[];
  readonly debugDetail?: string;

  constructor(code: ModelFailureReason, init: LlmErrorInit = {}) {
    super(MODEL_FAILURE_TEXT[code]);
    this.name = "AdvisorLlmError";
    this.code = code;
    if (init.httpStatus !== undefined) this.httpStatus = init.httpStatus;
    if (init.providerErrorType !== undefined) this.providerErrorType = init.providerErrorType;
    if (init.requestId !== undefined) this.requestId = init.requestId;
    if (init.piiKinds !== undefined) this.piiKinds = init.piiKinds;
    if (init.debugDetail !== undefined) this.debugDetail = init.debugDetail.slice(0, 300);
  }
}
