/**
 * A decisão de modo da tela Diagnóstico — PURA. Existe separada da leitura do banco para
 * que a regra que importa seja testável sem Postgres:
 *
 *  - `USE_MOCK=true`  → `demo`. O conjunto fictício é mostrado COMO demonstração, e nunca
 *    recebe mídia paga real (real e fictício não se misturam no mesmo bloco);
 *  - `USE_MOCK=false` → `real` se há insight ou métrica reais; senão `empty`, com o
 *    motivo e a ação. Dado fictício NUNCA entra para "preencher" a tela.
 */
import type {
  DiagnosticoData,
  DiagnosticoView,
  PaidMediaSnapshot,
  SourceStatus,
} from "@/lib/insight";

import { emptyReason } from "./status";

export function assembleView(input: {
  useMock: boolean;
  /** o conjunto fictício (só usado no modo demonstração) */
  demo: DiagnosticoData;
  /** o diagnóstico real; `null` quando não foi lido (modo demonstração) */
  real: DiagnosticoData | null;
  sources: SourceStatus[];
  paidMedia: PaidMediaSnapshot[];
}): DiagnosticoView {
  const { sources } = input;

  if (input.useMock) {
    return { mode: "demo", data: input.demo, sources, paidMedia: [], empty: null };
  }
  if (!input.real) {
    throw new Error("Diagnóstico real não foi lido fora do modo demonstração.");
  }

  const hasReal = input.real.supportMetrics.length > 0 || input.real.insights.length > 0;
  return {
    mode: hasReal ? "real" : "empty",
    data: input.real,
    sources,
    paidMedia: input.paidMedia,
    empty: hasReal ? null : emptyReason(sources),
  };
}
