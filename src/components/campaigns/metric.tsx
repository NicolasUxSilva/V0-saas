/**
 * Valor e variação de uma métrica da área Campanhas. Só formata: o valor, a variação e
 * o motivo de cada ausência já vêm decididos do servidor (`MetricComparison`).
 *
 * Cor só quando há leitura de melhor/pior (`lowerIsBetter` definido) E a variação existe
 * — e ela só existe entre períodos comparáveis. Investimento não tem cor: gastar mais
 * não é, por si, bom nem ruim.
 */
import { formatCount, formatDelta, formatMoney, formatRate } from "@/lib/format";
import type { MetricComparison, MetricFormatKind } from "@/lib/campaigns";
import { cn } from "@/lib/utils";

const nfDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const nfPp = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

export function formatValue(v: number, format: MetricFormatKind, currency: string | null): string {
  if (format === "money") return formatMoney(v, currency);
  if (format === "rate") return formatRate(v);
  if (format === "decimal") return nfDecimal.format(v);
  return formatCount(v);
}

/** Variação absoluta com sinal ("+R$ 50,00", "−3", "+0,4 p.p."). */
export function formatAbsDelta(v: number, format: MetricFormatKind, currency: string | null): string {
  if (format === "rate") return `${nfPp.format(v * 100).replace("-", "−")} p.p.`;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${formatValue(Math.abs(v), format, currency)}`;
}

const TONE = {
  positive: "text-emerald-700",
  negative: "text-red-700",
  neutral: "text-muted-foreground",
} as const;

export function DeltaText({ m, currency }: { m: MetricComparison; currency: string | null }) {
  if (m.deltaAbs === null) return null;
  if (m.deltaPct === null) {
    return (
      <span className="text-xs text-muted-foreground" title={m.note ?? undefined}>
        {formatAbsDelta(m.deltaAbs, m.format, currency)}
      </span>
    );
  }
  const d = formatDelta(m.deltaPct, m.lowerIsBetter === null ? true : !m.lowerIsBetter);
  const tone = m.lowerIsBetter === null ? "neutral" : d.tone;
  return (
    <span className={cn("text-xs font-medium tabular-nums", TONE[tone])}>
      {d.text}
    </span>
  );
}

/** Célula de tabela: valor atual + variação percentual (ou absoluta, se a base é zero). */
export function MetricCell({ m, currency }: { m: MetricComparison; currency: string | null }) {
  if (m.current === null) {
    return (
      <span className="text-muted-foreground" title={m.note ?? undefined}>
        —
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular-nums">{formatValue(m.current, m.format, currency)}</span>
      <DeltaText m={m} currency={currency} />
    </span>
  );
}

/** Bloco de detalhe: atual, anterior, variação absoluta e percentual, e o motivo de cada ausência. */
export function MetricTile({ m, currency, compare }: { m: MetricComparison; currency: string | null; compare: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{m.label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {m.current === null ? <span className="text-muted-foreground">—</span> : formatValue(m.current, m.format, currency)}
      </div>
      {compare ? (
        <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
          <div>
            anterior: {m.previous === null ? "—" : formatValue(m.previous, m.format, currency)}
          </div>
          {m.deltaAbs !== null ? (
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span>{formatAbsDelta(m.deltaAbs, m.format, currency)}</span>
              {m.deltaPct !== null ? <DeltaText m={m} currency={currency} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {m.note ? <div className="mt-1 text-xs text-muted-foreground">{m.note}</div> : null}
    </div>
  );
}
