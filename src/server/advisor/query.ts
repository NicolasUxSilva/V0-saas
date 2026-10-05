/**
 * `AdvisorQuery`: validação do pedido (Zod) e normalização.
 *
 * É a fronteira de entrada do Advisor — o server action da tela e qualquer chamada
 * futura passam por aqui. Pura: valida a FORMA do pedido e dos períodos; não olha
 * banco nem relógio.
 */
import { z } from "zod";

import { AnalysisPeriodError, validateAnalysisPeriod } from "../analysis/period";

import { ADVISOR_INTENTS } from "./intents";
import type { AdvisorQuery } from "./types";

/** Pedido inválido — a mensagem é para o usuário (pt-BR), `issues` é o detalhe. */
export class AdvisorQueryError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "AdvisorQueryError";
    this.issues = issues;
  }
}

/** Tamanho máximo da pergunta livre (caracteres). */
export const MAX_QUESTION_LENGTH = 1000;

const periodSchema = z.strictObject({
  startDate: z.string(),
  endDate: z.string(),
});

// `strictObject`: um campo que não existe no contrato (ex.: um `workspace` extra vindo
// do cliente) é recusado, não ignorado em silêncio.
const querySchema = z.strictObject({
  workspaceId: z.string().min(1),
  period: periodSchema,
  comparePeriod: periodSchema.optional(),
  intent: z.enum(ADVISOR_INTENTS),
  question: z.string().max(MAX_QUESTION_LENGTH).optional(),
});

function checkPeriod(label: string, period: { startDate: string; endDate: string }): void {
  try {
    validateAnalysisPeriod(period);
  } catch (error) {
    if (error instanceof AnalysisPeriodError) {
      throw new AdvisorQueryError(`${label}: ${error.message}`, [error.message]);
    }
    throw error;
  }
}

/**
 * Valida e normaliza um pedido. Lança `AdvisorQueryError` com uma mensagem
 * apresentável. Normalização: só `comparison` mantém `comparePeriod` e só
 * `free_question` mantém `question`.
 */
export function parseAdvisorQuery(input: unknown): AdvisorQuery {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
    throw new AdvisorQueryError("Pedido inválido para o Advisor.", issues);
  }
  const { workspaceId, period, comparePeriod, intent, question } = parsed.data;

  checkPeriod("Período", period);

  if (intent === "comparison") {
    if (!comparePeriod) {
      throw new AdvisorQueryError("Informe o período de comparação para comparar dois períodos.");
    }
    checkPeriod("Período de comparação", comparePeriod);
  }

  const text = question?.trim() ?? "";
  if (intent === "free_question" && text === "") {
    throw new AdvisorQueryError("Escreva a pergunta para fazer uma pergunta livre.");
  }

  return {
    workspaceId,
    period: { startDate: period.startDate, endDate: period.endDate },
    ...(intent === "comparison" && comparePeriod
      ? { comparePeriod: { startDate: comparePeriod.startDate, endDate: comparePeriod.endDate } }
      : {}),
    intent,
    ...(intent === "free_question" ? { question: text } : {}),
  };
}
