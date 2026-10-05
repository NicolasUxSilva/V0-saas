/**
 * Forma do que atravessa a fronteira do server action do Advisor.
 *
 * Fica fora de `actions.ts` porque um arquivo "use server" só pode exportar
 * funções assíncronas — os tipos (e qualquer constante) vivem aqui.
 */
import type { AdvisorResponse } from "@/server/advisor/types";

/** O que a tela envia. A identidade (workspace) NUNCA vem daqui: o action a lê da sessão. */
export interface AskAdvisorInput {
  startDate: string;
  endDate: string;
  /** só para `comparison` */
  compareStartDate?: string;
  compareEndDate?: string;
  intent: string;
  /** só para `free_question` */
  question?: string;
}

export type AskAdvisorResult =
  | { ok: true; response: AdvisorResponse }
  | { ok: false; message: string };
