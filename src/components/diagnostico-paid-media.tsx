/**
 * "Mídia paga" da tela Diagnóstico: o que o Google Ads e o Meta Ads REGISTRARAM nos 28
 * dias de dados mais recentes de cada um, contra os 28 anteriores. Cada plataforma tem a
 * própria moeda e a própria definição de conversão — por isso os números ficam em cartões
 * separados, nunca somados e nunca postos numa taxa entre plataformas.
 */
import Link from "next/link";

import { formatCount, formatDateRange, formatDelta, formatMoney } from "@/lib/format";
import type { PaidMediaMetric, PaidMediaSnapshot } from "@/lib/insight";

function valueOf(m: PaidMediaMetric, currency: string | null): string {
  return m.format === "currency" ? formatMoney(m.current, currency) : formatCount(m.current);
}

function previousOf(m: PaidMediaMetric, currency: string | null): string | null {
  if (m.previous === null) return null;
  return m.format === "currency" ? formatMoney(m.previous, currency) : formatCount(m.previous);
}

function Tile({ metric, currency }: { metric: PaidMediaMetric; currency: string | null }) {
  const previous = previousOf(metric, currency);
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{metric.label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{valueOf(metric, currency)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {previous === null ? (
          "sem período anterior para comparar"
        ) : metric.deltaPct === null ? (
          <>antes: {previous} (variação não calculável: base zero)</>
        ) : (
          <>
            <span className="font-medium">{formatDelta(metric.deltaPct).text}</span> vs. {previous}
          </>
        )}
      </div>
    </div>
  );
}

export function DiagnosticoPaidMedia({ snapshots }: { snapshots: PaidMediaSnapshot[] }) {
  if (snapshots.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Mídia paga">
      <h2 className="font-heading text-heading">
        Mídia paga
      </h2>
      <p className="text-xs text-muted-foreground">
        Dados reais de cada plataforma, nos 28 dias mais recentes que ela importou. Moeda e conversões
        seguem a definição de cada plataforma: não são somadas nem comparadas entre si, nem com os
        key events do GA4.{" "}
        <Link href="/campanhas/diagnosticos" className="font-medium text-foreground hover:underline">
          Diagnóstico por campanha, grupo e anúncio →
        </Link>
      </p>
      {snapshots.map((s) => (
        <div key={s.platform} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{s.label}</span>
            <span className="text-xs text-muted-foreground">
              {formatDateRange(s.window.start, s.window.end)} · {s.daysWithData} de 28 dias com
              registro
              {s.comparedTo
                ? ` · comparado com ${formatDateRange(s.comparedTo.start, s.comparedTo.end)}`
                : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {s.metrics.map((m) => (
              <Tile key={m.key} metric={m} currency={s.currency} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
