/**
 * Tabelas da área Campanhas. Visão principal enxuta: investimento, resultados (na
 * definição de cada campanha), custo por resultado, cliques e CTR; as demais métricas
 * ficam no detalhe. Cada linha leva a moeda e a plataforma dela: nada é somado aqui.
 */
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { CampaignRow, EntityRow } from "@/lib/campaigns";
import { formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";

import { MetricCell } from "./metric";

const TH = "px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap";
const TD = "px-3 py-2 text-right align-top text-sm";

export function CampaignsTable({ rows }: { rows: CampaignRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[860px] border-collapse">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className={cn(TH, "text-left")}>Campanha</th>
            <th className={TH}>Investimento</th>
            <th className={TH} title="Definição da plataforma; muda com o objetivo da campanha (veja o rótulo na linha)">
              Resultados
            </th>
            <th className={TH}>Custo por resultado</th>
            <th className={TH} title="No Meta Ads, cliques no link">
              Cliques
            </th>
            <th className={TH}>CTR</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={`${r.platform}:${r.campaignId}`} className="hover:bg-muted/30">
              <td className="max-w-[360px] px-3 py-2 align-top">
                <Link href={r.href} className="text-sm font-medium hover:underline">
                  {r.name}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>{r.platformLabel}</span>
                  {r.statusLabel ? <span>· {r.statusLabel}</span> : null}
                  {r.kindLabel ? <span>· {r.kindLabel}</span> : null}
                  {r.currency ? <span>· {r.currency}</span> : null}
                </div>
                {r.flags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <Badge key={f} variant="outline" className="text-[11px] font-normal">
                        {f}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </td>
              <td className={TD}>
                <MetricCell m={r.cost} currency={r.currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.results} currency={r.currency} />
                {r.result ? (
                  <div className="text-[11px] text-muted-foreground" title={r.result.description}>
                    {r.result.label}
                  </div>
                ) : null}
              </td>
              <td className={TD}>
                <MetricCell m={r.costPerResult} currency={r.currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.clicks} currency={r.currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.ctr} currency={r.currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EntityTable({ rows, currency, resultLabel }: { rows: EntityRow[]; currency: string | null; resultLabel: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[960px] border-collapse">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className={cn(TH, "text-left")}>Nome</th>
            <th className={TH}>Investimento</th>
            <th className={TH} title="Fatia do investimento do nível de cima no período">
              % do invest.
            </th>
            <th className={TH}>Impressões</th>
            <th className={TH}>Cliques</th>
            <th className={TH}>CTR</th>
            <th className={TH}>CPC</th>
            <th className={TH}>{resultLabel}</th>
            <th className={TH}>Custo por resultado</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="max-w-[320px] px-3 py-2 align-top">
                {r.href ? (
                  <Link href={r.href} className="text-sm font-medium hover:underline">
                    {r.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium">{r.name}</span>
                )}
                <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
                  <span>ID {r.id}</span>
                  {r.statusLabel ? <span>· {r.statusLabel}</span> : null}
                  {r.typeLabel ? <span>· {r.typeLabel}</span> : null}
                </div>
              </td>
              <td className={TD}>
                <MetricCell m={r.cost} currency={currency} />
              </td>
              <td className={cn(TD, "text-muted-foreground")}>{r.costShare === null ? "—" : formatShare(r.costShare)}</td>
              <td className={TD}>
                <MetricCell m={r.impressions} currency={currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.clicks} currency={currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.ctr} currency={currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.cpc} currency={currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.results} currency={currency} />
              </td>
              <td className={TD}>
                <MetricCell m={r.costPerResult} currency={currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
