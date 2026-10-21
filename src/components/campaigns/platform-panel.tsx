/**
 * Uma plataforma na área Campanhas: estado REAL da conexão e da importação (mesma regra
 * do Diagnóstico, mais o que só a importação sabe — em curso, interrompida, falha no
 * detalhe), cobertura do período escolhido e os totais da plataforma, na moeda da conta.
 * Nunca soma uma plataforma com a outra.
 */
import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import type { PlatformPanel } from "@/lib/campaigns";
import type { SourceHealth } from "@/lib/insight";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { MetricTile } from "./metric";

const ATTENTION: ReadonlySet<SourceHealth> = new Set(["needs_reauth", "error", "sync_failed", "no_account", "no_data"]);

function StateIcon({ panel }: { panel: PlatformPanel }) {
  if (panel.sync.running) return <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden />;
  if (panel.source.health === "synced" && !panel.sync.stalled && !panel.sync.detailError) {
    return <CircleCheck className="size-4 text-emerald-600" aria-hidden />;
  }
  if (ATTENTION.has(panel.source.health) || panel.sync.stalled || panel.sync.detailError) {
    return <CircleAlert className="size-4 text-amber-600" aria-hidden />;
  }
  return <CircleDashed className="size-4 text-muted-foreground" aria-hidden />;
}

export function PlatformPanelCard({
  panel,
  compare,
  showTotals = true,
}: {
  panel: PlatformPanel;
  compare: boolean;
  showTotals?: boolean;
}) {
  const { source, sync } = panel;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={panel.label}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="mt-0.5">
          <StateIcon panel={panel} />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-sm font-medium">
            {panel.label}
            {panel.account ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {panel.account.name} ({panel.account.externalId})
              </span>
            ) : null}
          </div>
          <div className="text-sm text-muted-foreground">{source.summary}</div>
          {source.notice ? <div className="text-xs text-amber-700">{source.notice}</div> : null}
          {sync.running ? (
            <div className="text-xs text-muted-foreground">Importação em andamento — os números podem mudar ao terminar.</div>
          ) : null}
          {sync.stalled ? (
            <div className="text-xs text-amber-700">
              Uma importação iniciada {formatRelativeTime(sync.lastRun!.startedAt)} não registrou fim: provavelmente foi
              interrompida. Importe de novo em Conexões.
            </div>
          ) : null}
          {sync.detailError ? (
            <div className="text-xs text-amber-700">
              A última importação trouxe as campanhas, mas falhou no detalhe por grupo/anúncio: {sync.detailError}
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">
            {sync.lastSyncedAt
              ? `Última importação concluída ${formatRelativeTime(sync.lastSyncedAt)}.`
              : "Nenhuma importação concluída."}
            {panel.account?.currency ? ` Moeda da conta: ${panel.account.currency}.` : ""}
          </div>
        </div>
        {source.action ? (
          <Link
            href={source.action.href}
            className={cn(buttonVariants({ variant: ATTENTION.has(source.health) ? "default" : "outline", size: "sm" }))}
          >
            {source.action.label}
          </Link>
        ) : (
          <Link href="/conexoes" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Conexões
          </Link>
        )}
      </div>

      {panel.notes.length > 0 || panel.comparabilityNote ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {panel.comparabilityNote ? <li className="text-amber-700">{panel.comparabilityNote}</li> : null}
          {panel.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {showTotals
        ? panel.totals.map((t) => (
            <div key={t.currency ?? "none"} className="space-y-2">
              {panel.totals.length > 1 ? (
                <div className="text-xs font-medium text-muted-foreground">Moeda: {t.currency ?? "não informada"}</div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {t.metrics.map((m) => (
                  <MetricTile key={m.key} m={m} currency={t.currency} compare={compare} />
                ))}
              </div>
            </div>
          ))
        : null}
    </section>
  );
}
