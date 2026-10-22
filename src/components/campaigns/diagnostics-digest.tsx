/**
 * Resumo do diagnóstico dentro das páginas da área Campanhas (visão geral e detalhe): os
 * alertas de maior prioridade e o caminho para o diagnóstico completo, com os mesmos
 * filtros. É uma vista da mesma lista de `diagnose()` — não uma segunda fonte.
 */
import Link from "next/link";

import type { CampaignDiagnostic } from "@/lib/campaign-diagnostics";

import { DiagnosticCard } from "./diagnostic-card";

export function DiagnosticsDigest({
  title,
  diagnostics,
  href,
  limit = 3,
  compact = true,
}: {
  title: string;
  diagnostics: CampaignDiagnostic[];
  /** diagnóstico completo, já com os filtros */
  href: string;
  limit?: number;
  compact?: boolean;
}) {
  const signals = diagnostics.filter((d) => d.kind !== "limitation");
  const alerts = signals.filter((d) => d.kind === "finding" && d.severity !== "info");
  const top = [...alerts, ...signals.filter((d) => !alerts.includes(d))].slice(0, limit);
  const inconclusive = signals.filter((d) => d.kind === "inconclusive").length;
  const limitations = diagnostics.filter((d) => d.kind === "limitation").length;

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">
          {alerts.length} {alerts.length === 1 ? "alerta" : "alertas"} · {inconclusive} inconclusivo(s)
          {limitations ? ` · ${limitations} limitação(ões) dos dados` : ""}
        </span>
        <Link href={href} className="ml-auto text-xs font-medium hover:underline">
          Ver diagnóstico completo →
        </Link>
      </div>
      {top.length === 0 ? (
        <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
          Nenhum sinal encontrado no período{limitations ? " — veja as limitações dos dados no diagnóstico completo" : ""}.
        </p>
      ) : (
        <div className="space-y-3">
          {top.map((d) => (
            <DiagnosticCard key={d.id} d={d} compact={compact} />
          ))}
        </div>
      )}
    </section>
  );
}
