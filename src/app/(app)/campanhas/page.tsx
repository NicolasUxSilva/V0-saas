import { Megaphone } from "lucide-react";
import Link from "next/link";

import { CampaignFiltersForm } from "@/components/campaigns/filters";
import { PlatformPanelCard } from "@/components/campaigns/platform-panel";
import { CampaignsTable } from "@/components/campaigns/tables";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { todayInTimeZone } from "@/lib/dates";
import { formatDateSpan } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth";
import { REFERENCE_TIMEZONE } from "@/server/campaigns/compose";
import { filtersToQuery, parseFilters } from "@/server/campaigns/period";
import { readCampaignsOverview } from "@/server/campaigns/read";

export const metadata = { title: "Campanhas — v0-saas" };

export default async function CampanhasPage(props: PageProps<"/campanhas">) {
  const { workspaceId } = await requireWorkspace();
  const today = todayInTimeZone(REFERENCE_TIMEZONE);
  const { filters, warnings } = parseFilters(await props.searchParams, today);
  const view = await readCampaignsOverview({ workspaceId, filters, filterWarnings: warnings, today, now: new Date() });
  const f = view.filters;
  const compare = f.previous !== null;

  const anyConnected = view.panels.some((p) => p.source.health !== "not_connected");
  const anyCampaign = view.panels.some((p) => p.campaignCount > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Campanhas</h1>
        <p className="text-sm text-muted-foreground">
          Google Ads e Meta Ads lado a lado, com os dados já importados — cada plataforma na sua moeda e na sua definição de
          resultado.
        </p>
      </div>

      <CampaignFiltersForm action="/campanhas" filters={f} statusOptions={view.statusOptions} />

      {view.filterWarnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          {view.filterWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Período: {formatDateSpan(f.current.start, f.current.end)}
        {f.previous ? ` · comparado com ${formatDateSpan(f.previous.start, f.previous.end)}` : " · sem comparação"}. Hoje
        ainda está em curso e não entra no período padrão; cada conta usa o calendário do próprio fuso.
      </p>

      <div className="space-y-3">
        {view.panels.map((p) => (
          <PlatformPanelCard key={p.platform} panel={p} compare={compare} />
        ))}
      </div>

      {!anyConnected ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma plataforma de mídia paga conectada"
          description="Conecte o Google Ads ou o Meta Ads em Conexões e rode a primeira importação para ver as campanhas aqui."
          action={
            <Link href="/conexoes" className={cn(buttonVariants({ size: "sm" }))}>
              Ir para Conexões
            </Link>
          }
        />
      ) : !anyCampaign ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma campanha com dados neste período"
          description="As contas conectadas não têm veiculação importada no período escolhido. Veja acima o estado de cada importação ou escolha outro período."
        />
      ) : (
        <section className="space-y-3" aria-label="Campanhas">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Campanhas</h2>
            <span className="text-xs text-muted-foreground">
              {view.totalRows} {view.totalRows === 1 ? "campanha" : "campanhas"}
              {compare ? " · variação contra o período anterior, só quando os dois foram importados por completo" : ""}
            </span>
          </div>
          {view.statusFilterExcludes ? (
            <p className="text-xs text-muted-foreground">{view.statusFilterExcludes}</p>
          ) : null}
          {view.rows.length === 0 ? (
            <EmptyState title="Nenhuma campanha corresponde aos filtros" description="Ajuste o status ou o foco." />
          ) : (
            <CampaignsTable rows={view.rows} />
          )}
          {view.pageCount > 1 ? (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
              <span className="text-xs text-muted-foreground">
                Página {f.page} de {view.pageCount}
              </span>
              <div className="flex gap-2">
                {f.page > 1 ? (
                  <Link
                    href={`/campanhas${filtersToQuery(f, { page: f.page - 1 })}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Anterior
                  </Link>
                ) : null}
                {f.page < view.pageCount ? (
                  <Link
                    href={`/campanhas${filtersToQuery(f, { page: f.page + 1 })}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Próxima
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
