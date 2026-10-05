/**
 * Período de uma análise: validação do período EXPLÍCITO e planejamento das
 * janelas do `AnalysisContext`.
 *
 * Puro — sem banco e sem relógio: a "data de hoje" e o último dia com dados do
 * GA4 entram como argumento. `context.ts` continua sendo o único ponto que lê o
 * banco; aqui só se decide QUAIS datas ele deve ler.
 *
 * Dois modos, e o primeiro é o que já existia:
 *  - DEFAULT (sem período): janela `current` de 28 dias que termina em
 *    `min(hoje − 2, último dia com dados do GA4)`. O fim é ENCOLHIDO até o último
 *    dia do GA4 — é o que os detectors sempre viram, e continua exatamente assim.
 *  - EXPLÍCITO (`{ startDate, endDate }`): a janela `current` é o período pedido,
 *    sem encolher. Se o GA4 não tem dados até `endDate`, isso aparece como
 *    cobertura parcial (`coverage.inPeriod`), nunca como um período menor — o
 *    período SOLICITADO e a cobertura REAL de cada fonte são conceitos separados.
 */
import { addDays } from "@/lib/dates";

import type { AnalysisPeriodInput } from "./types";

export const HISTORY_DAYS = 180;
export const WINDOW_DAYS = 28;
export const BASELINE_DAYS = 120;
/** o GA4 só fecha o dia depois de ~48h: a análise padrão termina em hoje − 2 */
export const CUTOFF_LAG_DAYS = 2;
/** teto de um período explícito (dias) — evita uma consulta acidentalmente gigante */
export const MAX_PERIOD_DAYS = 366;

const MS_PER_DAY = 86_400_000;

/** Período solicitado inválido (formato, ordem, tamanho ou futuro). */
export class AnalysisPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisPeriodError";
  }
}

/** "YYYY-MM-DD" que existe no calendário ("2026-02-30" não existe). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Dias do intervalo, inclusive nas duas pontas ("2026-10-01".."2026-10-04" = 4). 0 se inválido. */
export function inclusiveDays(start: string, end: string): number {
  const diff = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Number.isFinite(diff) && diff >= 0 ? Math.round(diff / MS_PER_DAY) + 1 : 0;
}

/**
 * Valida a FORMA do período explícito (formato, ordem, tamanho). Não olha o
 * relógio — a checagem de "fim no futuro" fica em `resolveWindowPlan`, que recebe
 * a data de hoje.
 */
export function validateAnalysisPeriod(input: AnalysisPeriodInput): {
  start: string;
  end: string;
  days: number;
} {
  const { startDate, endDate } = input ?? ({} as Partial<AnalysisPeriodInput>);
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new AnalysisPeriodError(
      "Período inválido: startDate e endDate devem ser datas reais no formato YYYY-MM-DD.",
    );
  }
  if (startDate > endDate) {
    throw new AnalysisPeriodError(
      `Período inválido: startDate (${startDate}) é posterior a endDate (${endDate}).`,
    );
  }
  const days = inclusiveDays(startDate, endDate);
  if (days > MAX_PERIOD_DAYS) {
    throw new AnalysisPeriodError(
      `Período inválido: ${days} dias excede o máximo de ${MAX_PERIOD_DAYS}.`,
    );
  }
  return { start: startDate, end: endDate, days };
}

/**
 * Todas as datas que o `AnalysisContext` lê, derivadas de UM fim e UM tamanho de
 * janela: `current` (o período), `previous` (mesmo tamanho, imediatamente antes),
 * `baseline` (120 dias antes de `previous`) e o início do histórico de 180 dias.
 */
export interface WindowPlan {
  /** início da janela `current` */
  periodStart: string;
  /** fim da janela `current` (= `AnalysisContext.analysisEnd`) */
  analysisEnd: string;
  windowDays: number;
  previousStart: string;
  previousEnd: string;
  baselineStart: string;
  baselineEnd: string;
  historyStart: string;
}

export function planWindows(analysisEnd: string, windowDays: number): WindowPlan {
  const periodStart = addDays(analysisEnd, -(windowDays - 1));
  const previousEnd = addDays(periodStart, -1);
  const previousStart = addDays(previousEnd, -(windowDays - 1));
  const baselineEnd = addDays(previousStart, -1);
  const baselineStart = addDays(baselineEnd, -(BASELINE_DAYS - 1));
  const historyStart = addDays(analysisEnd, -(HISTORY_DAYS - 1));
  return {
    periodStart,
    analysisEnd,
    windowDays,
    previousStart,
    previousEnd,
    baselineStart,
    baselineEnd,
    historyStart,
  };
}

/**
 * Escolhe as janelas da análise.
 *
 * `expectedLastDate` é o último dia com dados que o GA4 DEVERIA ter para esta
 * análise: no modo default, `hoje − 2` (o fim da janela pode ficar ANTES dele, se
 * o GA4 estiver atrasado); no modo explícito, o `endDate` pedido. `lastDate <
 * expectedLastDate` é como a camada Cross-source enxerga um GA4 atrasado.
 */
export function resolveWindowPlan(
  period: AnalysisPeriodInput | undefined,
  ref: {
    /** hoje − 2 dias, no fuso da propriedade */
    naturalEnd: string;
    /** último dia com linha em fact_traffic_daily */
    lastDate: string;
    /** hoje, no fuso da propriedade */
    today: string;
  },
): { plan: WindowPlan; expectedLastDate: string } {
  if (!period) {
    // Comportamento histórico, intocado: o fim encolhe até o último dia do GA4.
    const analysisEnd = ref.naturalEnd < ref.lastDate ? ref.naturalEnd : ref.lastDate;
    return {
      plan: planWindows(analysisEnd, WINDOW_DAYS),
      expectedLastDate: ref.naturalEnd,
    };
  }

  const { end, days } = validateAnalysisPeriod(period);
  if (end > ref.today) {
    throw new AnalysisPeriodError(
      `Período inválido: endDate (${end}) está no futuro (hoje é ${ref.today}).`,
    );
  }
  return { plan: planWindows(end, days), expectedLastDate: end };
}
