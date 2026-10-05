/**
 * Datas do seletor de período do Advisor — puro, usado pelo client component.
 *
 * Só aritmética de calendário em "YYYY-MM-DD" (sem relógio, sem fuso): o período
 * de comparação sugerido é sempre o imediatamente anterior e de MESMA duração, que
 * é a única comparação que o Advisor aceita (`server/advisor/comparison.ts`).
 */
import { addDays } from "@/lib/dates";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Dias do intervalo, inclusive nas duas pontas. `null` se alguma data é inválida ou fora de ordem. */
export function daysBetween(start: string, end: string): number | null {
  if (!ISO.test(start) || !ISO.test(end)) return null;
  const diff = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff / MS_PER_DAY) + 1;
}

/** O período imediatamente anterior, com a mesma duração. `null` se o período é inválido. */
export function previousPeriod(
  start: string,
  end: string,
): { start: string; end: string } | null {
  const days = daysBetween(start, end);
  if (days === null) return null;
  return { start: addDays(start, -days), end: addDays(start, -1) };
}
