/**
 * Janela dos streams de DETALHE (grupos/conjuntos e anúncios) — PURO.
 *
 * Os streams de detalhe entraram depois do de campanha: uma conexão antiga já tem
 * `last_synced_at`, e a janela incremental do sync (restatement a partir da última
 * importação) deixaria o detalhe só com os dias mais recentes. Por isso o detalhe
 * decide a própria janela a partir do que JÁ existe na tabela de detalhe:
 *  - nada gravado num dos níveis → histórico completo (mesmo início do 1º sync);
 *  - senão → o mais antigo entre o início da janela do sync e (o último dia gravado
 *    no nível mais atrasado − restatement), limitado ao início do histórico.
 * Assim uma importação de detalhe que falhou é retomada de onde parou, sem buraco.
 */
import { addDays, maxDate } from "@/lib/dates";

/** Prefixo do erro de detalhe em `sync_runs.error` — a área Campanhas o reconhece. */
export const DETAIL_ERROR_PREFIX = "detalhe por grupo/anúncio: ";

export function detailWindowStart(input: {
  /** início da janela do sync de campanha */
  since: string;
  /** início do histórico (hoje − HISTORY_DAYS) */
  historyStart: string;
  /** último dia gravado em cada nível de detalhe (`null` = nenhum) */
  lastDates: (string | null)[];
  restatementDays: number;
}): string {
  const { since, historyStart, lastDates, restatementDays } = input;
  if (lastDates.length === 0 || lastDates.some((d) => d === null)) return historyStart;
  const oldest = (lastDates as string[]).reduce((a, b) => (a <= b ? a : b));
  const resume = maxDate(historyStart, addDays(oldest, -restatementDays));
  return resume < since ? resume : since;
}
