"use server";

/**
 * Server action do Advisor.
 *
 * Uma pergunta ao Advisor é uma LEITURA: nada é gravado, nenhum sync é disparado,
 * nenhum Cross-source é gerado. A única chamada externa possível é a do modelo de
 * linguagem (só com `ADVISOR_LLM_ENABLED=true`), e ela mora atrás de `AdvisorModel`:
 * recebe só uma projeção do contexto, sem PII, e a resposta passa por schema + guard
 * (ou cai no modelo determinístico). Mesmo assim a action chega por POST e é um
 * ponto de entrada não confiável (docs do Next, "Server Actions — Security"), então
 * aqui:
 *
 *  - a sessão é exigida DENTRO da action (`requireWorkspace`), e o workspace vem
 *    dela — nunca do cliente;
 *  - a entrada é validada com Zod (`strictObject`: campo desconhecido é recusado);
 *  - o retorno é só o `AdvisorResponse` estruturado, nunca um registro do banco;
 *  - erro esperado (pedido inválido) volta como valor; erro inesperado vira uma
 *    mensagem genérica e o detalhe vai para o log do servidor.
 */
import { z } from "zod";

import { requireWorkspace } from "@/server/auth";
import {
  AdvisorQueryError,
  answerAdvisorQuery,
  getConfiguredAdvisorModel,
  isAdvisorEnabled,
} from "@/server/advisor";

import type { AskAdvisorInput, AskAdvisorResult } from "./types";

const inputSchema = z.strictObject({
  startDate: z.string().max(10),
  endDate: z.string().max(10),
  compareStartDate: z.string().max(10).optional(),
  compareEndDate: z.string().max(10).optional(),
  intent: z.string().max(40),
  question: z.string().max(1000).optional(),
});

export async function askAdvisor(input: AskAdvisorInput): Promise<AskAdvisorResult> {
  const { workspaceId } = await requireWorkspace();

  if (!isAdvisorEnabled()) {
    return { ok: false, message: "O Advisor está desativado neste ambiente." };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Pedido inválido para o Advisor." };
  }
  const v = parsed.data;

  try {
    // `undefined` = LLM desligado (padrão): o serviço usa o modelo determinístico
    const model = getConfiguredAdvisorModel();
    const response = await answerAdvisorQuery(
      {
        workspaceId,
        period: { startDate: v.startDate, endDate: v.endDate },
        ...(v.compareStartDate && v.compareEndDate
          ? { comparePeriod: { startDate: v.compareStartDate, endDate: v.compareEndDate } }
          : {}),
        intent: v.intent,
        ...(v.question !== undefined ? { question: v.question } : {}),
      },
      model ? { model } : {},
    );
    return { ok: true, response };
  } catch (error) {
    if (error instanceof AdvisorQueryError) {
      return { ok: false, message: error.message };
    }
    console.error("[advisor] falha ao responder:", error);
    return {
      ok: false,
      message: "Não foi possível consultar o Advisor agora. Tente de novo.",
    };
  }
}
