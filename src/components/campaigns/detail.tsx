/**
 * Página de detalhe (campanha ou grupo/conjunto): todas as métricas, atual × anterior,
 * a definição de "resultado", e o nível imediatamente abaixo — ou o motivo objetivo de
 * ele não estar disponível (migração pendente, não importado, tipo de campanha sem esse
 * nível). Nenhum dado é inventado para preencher um nível que falta.
 */
import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CampaignDetail } from "@/lib/campaigns";
import { formatDateSpan, formatMoney } from "@/lib/format";

import { MetricTile } from "./metric";
import { PlatformPanelCard } from "./platform-panel";
import { EntityTable } from "./tables";

export function CampaignDetailView({ detail }: { detail: CampaignDetail }) {
  const { campaign, filters, children } = detail;
  const compare = filters.previous !== null;
  const currency = campaign.currency;

  return (
    <div className="space-y-6">
      {detail.filterWarnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          {detail.filterWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <PlatformPanelCard panel={detail.panel} compare={compare} showTotals={false} />

      <section className="space-y-3" aria-label="Métricas">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Métricas</h2>
          <span className="text-xs text-muted-foreground">
            {formatDateSpan(filters.current.start, filters.current.end)}
            {filters.previous
              ? ` · comparado com ${formatDateSpan(filters.previous.start, filters.previous.end)}`
              : " · sem comparação"}
            {currency ? ` · ${currency}` : ""}
          </span>
        </div>
        {campaign.mixedCurrency ? (
          <p className="text-xs text-amber-700">
            Esta campanha tem dados em mais de uma moeda (troca de conta): os totais abaixo não somam moedas e a comparação
            foi desligada.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {detail.metrics.map((m) => (
            <MetricTile key={m.key} m={m} currency={currency} compare={compare} />
          ))}
        </div>
        <div className="flex gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="space-y-1">
            {detail.result ? (
              <p>
                <span className="font-medium text-foreground">Resultado = {detail.result.label}.</span>{" "}
                {detail.result.description}
              </p>
            ) : (
              <p>
                <span className="font-medium text-foreground">Sem definição de resultado para o objetivo desta campanha.</span>{" "}
                O &quot;resultado&quot; do Ads Manager depende da otimização do conjunto e não é importado; os eventos de
                conversão por tipo aparecem abaixo.
              </p>
            )}
            {detail.panel.platform === "meta_ads" ? (
              <p>Cliques, CTR e CPC usam cliques no link — não todos os cliques (curtidas, comentários, expansões).</p>
            ) : null}
          </div>
        </div>
        {detail.conversionBreakdown.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Eventos de conversão atribuídos pela Meta, por tipo</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {detail.conversionBreakdown.map((m) => (
                <MetricTile key={m.label} m={m} currency={currency} compare={compare} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-label={children.title}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children.title}</h2>
          {children.availability.state === "ready" ? (
            <Badge variant="outline" className="text-[11px] font-normal">
              {children.rows.length + children.truncated}
            </Badge>
          ) : null}
        </div>
        {children.availability.state !== "ready" ? (
          <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">{children.availability.message}</p>
        ) : null}
        {children.notes.length > 0 || (compare && !children.comparable && children.availability.state === "ready") ? (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {children.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {compare && !children.comparable && children.notes.length === 0 && children.availability.state === "ready" ? (
              <li>Sem variação neste nível: os períodos não são comparáveis (veja o estado da importação acima).</li>
            ) : null}
          </ul>
        ) : null}
        {children.reconciliation ? (
          <p className="text-xs text-amber-700">
            Os itens abaixo somam {formatMoney(children.reconciliation.childCost, children.reconciliation.currency)} dos{" "}
            {formatMoney(children.reconciliation.parentCost, children.reconciliation.currency)} investidos no nível de cima
            no período. A diferença pode vir de dias ainda não importados neste nível, de itens sem detalhe na plataforma
            ou de reprocessamento recente.
          </p>
        ) : null}
        {children.availability.state === "ready" ? (
          <EntityTable
            rows={children.rows}
            currency={currency}
            resultLabel={detail.result?.label ?? "Resultados"}
          />
        ) : null}
        {children.truncated > 0 ? (
          <p className="text-xs text-muted-foreground">
            Mostrando os {children.rows.length} de maior investimento; {children.truncated} não exibidos.
          </p>
        ) : null}
      </section>
    </div>
  );
}
