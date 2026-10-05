/**
 * "Métricas de apoio" (seção 4 da tela Diagnóstico, bloco A4).
 *
 * Camada de apoio — não é o produto. Números-cabeçalho: atual vs. anterior vs. Δ%.
 * Sem gráficos (não preencher espaço).
 */
import { formatDelta, formatMetricValue } from "@/lib/format";
import type { SupportMetric } from "@/lib/insight";
import { cn } from "@/lib/utils";

function Tile({ metric }: { metric: SupportMetric }) {
  const delta = formatDelta(metric.deltaPct, metric.lowerIsWorse ?? true);
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{metric.label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {formatMetricValue(metric.current, metric.format)}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5 text-xs">
        <span
          className={cn(
            "font-medium",
            delta.tone === "negative" && "text-red-600",
            delta.tone === "positive" && "text-emerald-600",
            delta.tone === "neutral" && "text-muted-foreground",
          )}
        >
          {delta.text}
        </span>
        <span className="text-muted-foreground">
          vs. {formatMetricValue(metric.previous, metric.format)}
        </span>
      </div>
    </div>
  );
}

export function SupportMetrics({ metrics }: { metrics: SupportMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {metrics.map((m) => (
        <Tile key={m.key} metric={m} />
      ))}
    </div>
  );
}
