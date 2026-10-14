/**
 * Mídia paga REAL no Diagnóstico — PURA: recebe os agregados já lidos e monta o cartão.
 *
 * Os números são os de CADA plataforma, na moeda e na definição dela: aqui nada é somado
 * entre Google Ads e Meta Ads, e a variação é de uma plataforma contra ela mesma
 * (28 dias de dados mais recentes × os 28 anteriores). Base zero ou janela anterior sem
 * dados → variação `null`, nunca infinito nem 0.
 */
import { addDays } from "@/lib/dates";
import type { PaidMediaMetric, PaidMediaSnapshot } from "@/lib/insight";

export const PAID_WINDOW_DAYS = 28;

export type PaidPlatform = PaidMediaSnapshot["platform"];

const LABEL: Record<PaidPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
};

/** Soma e dias com dado de UMA janela. */
export interface PaidWindowTotals {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  daysWithData: number;
}

/** [lastDate − 27, lastDate] e a janela de mesmo tamanho imediatamente anterior. */
export function paidWindows(lastDate: string): {
  current: { start: string; end: string };
  previous: { start: string; end: string };
} {
  const currentStart = addDays(lastDate, -(PAID_WINDOW_DAYS - 1));
  return {
    current: { start: currentStart, end: lastDate },
    previous: { start: addDays(currentStart, -PAID_WINDOW_DAYS), end: addDays(currentStart, -1) },
  };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

function metric(
  key: PaidMediaMetric["key"],
  label: string,
  format: PaidMediaMetric["format"],
  current: number,
  previous: PaidWindowTotals | null,
  pick: (t: PaidWindowTotals) => number,
): PaidMediaMetric {
  const before = previous && previous.daysWithData > 0 ? round4(pick(previous)) : null;
  return {
    key,
    label,
    current: round4(current),
    previous: before,
    deltaPct: before !== null && before > 0 ? (round4(current) - before) / before : null,
    format,
  };
}

export function composePaidMediaSnapshot(input: {
  platform: PaidPlatform;
  lastDate: string;
  currency: string | null;
  current: PaidWindowTotals;
  previous: PaidWindowTotals | null;
}): PaidMediaSnapshot | null {
  const { platform, lastDate, currency, current, previous } = input;
  // sem nenhum dia com dado na janela atual não há o que mostrar
  if (current.daysWithData === 0) return null;

  const windows = paidWindows(lastDate);
  const hasPrevious = previous !== null && previous.daysWithData > 0;
  return {
    platform,
    label: LABEL[platform],
    currency,
    window: windows.current,
    comparedTo: hasPrevious ? windows.previous : null,
    daysWithData: current.daysWithData,
    metrics: [
      metric("cost", "Investimento", "currency", current.cost, previous, (t) => t.cost),
      metric("impressions", "Impressões", "count", current.impressions, previous, (t) => t.impressions),
      metric(
        "clicks",
        platform === "meta_ads" ? "Cliques no link" : "Cliques",
        "count",
        current.clicks,
        previous,
        (t) => t.clicks,
      ),
      metric(
        "conversions",
        "Conversões (da plataforma)",
        "count",
        current.conversions,
        previous,
        (t) => t.conversions,
      ),
    ],
  };
}
