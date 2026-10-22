import { Stethoscope } from "lucide-react";

import { DiagnosticCard } from "@/components/campaigns/diagnostic-card";
import { CampaignFiltersForm, FIELD, Field } from "@/components/campaigns/filters";
import { CampaignsSectionNav } from "@/components/campaigns/section-nav";
import { EmptyState } from "@/components/states";
import type { CampaignDiagnostic } from "@/lib/campaign-diagnostics";
import { todayInTimeZone } from "@/lib/dates";
import { formatDateSpan } from "@/lib/format";
import { requireWorkspace } from "@/server/auth";
import { REFERENCE_TIMEZONE } from "@/server/campaigns/compose";
import { SEVERITY_LABEL, TYPE_LABEL, buildDiagnosticsView, parseDiagnosticFilters } from "@/server/campaigns/diagnostics/view";
import { filtersToQuery, parseFilters } from "@/server/campaigns/period";
import { readCampaignDiagnostics } from "@/server/campaigns/read";

export const metadata = { title: "Diagnóstico de campanhas — v0-saas" };

function Section({ title, hint, items }: { title: string; hint: string; items: CampaignDiagnostic[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title} <span className="font-normal normal-case">({items.length})</span>
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-3">
        {items.map((d) => (
          <DiagnosticCard key={d.id} d={d} />
        ))}
      </div>
    </section>
  );
}

export default async function DiagnosticosPage(props: PageProps<"/campanhas/diagnosticos">) {
  const { workspaceId } = await requireWorkspace();
  const params = await props.searchParams;
  const { filters, warnings } = parseFilters(params, todayInTimeZone(REFERENCE_TIMEZONE));
  const diagFilters = parseDiagnosticFilters(params);
  // calculado a cada visita sobre os dados já importados — nada é importado nem gravado aqui
  const all = await readCampaignDiagnostics({ workspaceId, filters, now: new Date() });
  const view = buildDiagnosticsView(all, diagFilters);
  const shared = filtersToQuery(filters, { page: 1, status: null, onlyCostWithoutResult: false, sort: "cost" });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Campanhas</h1>
        <p className="text-sm text-muted-foreground">
          O que mudou nas campanhas, onde, com que evidência — e o que os dados ainda não permitem concluir.
        </p>
      </div>
      <CampaignsSectionNav active="diagnostics" query={shared} />

      <CampaignFiltersForm action="/campanhas/diagnosticos" filters={filters} statusOptions={[]} showListOptions={false}>
        <Field label="Severidade">
          <select name="severidade" defaultValue={diagFilters.severity ?? ""} className={FIELD}>
            <option value="">Todas</option>
            {(["high", "medium", "low", "info"] as const).map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo">
          <select name="tipo" defaultValue={diagFilters.type ?? ""} className={FIELD}>
            <option value="">Todos</option>
            {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nível">
          <select name="nivel" defaultValue={diagFilters.level ?? ""} className={FIELD}>
            <option value="">Todos</option>
            <option value="platform">Plataforma</option>
            <option value="campaign">Campanha</option>
            <option value="ad_group">Grupo / conjunto</option>
            <option value="ad">Anúncio</option>
          </select>
        </Field>
        {view.campaignOptions.length > 0 ? (
          <Field label="Campanha">
            <select name="campanha" defaultValue={diagFilters.campaignId ?? ""} className={`${FIELD} max-w-56`}>
              <option value="">Todas</option>
              {view.campaignOptions.map((c) => (
                <option key={`${c.platform}:${c.id}`} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </CampaignFiltersForm>

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Período: {formatDateSpan(filters.current.start, filters.current.end)}
          {filters.previous
            ? ` · comparado com ${formatDateSpan(filters.previous.start, filters.previous.end)}`
            : " · sem comparação"}
          . {view.totals.findings} {view.totals.findings === 1 ? "alerta" : "alertas"} ({view.totals.high} de severidade alta),{" "}
          {view.totals.inconclusive} inconclusivo(s), {view.totals.limitations} limitação(ões) dos dados.
        </p>
        <p>
          Severidade = quanto importa se o sinal for verdadeiro (tamanho da mudança e peso no investimento). Confiança = quanto
          os dados sustentam o sinal (volume e cobertura). Resultados são os reportados por cada plataforma — não são vendas
          confirmadas — e nada é somado entre plataformas ou moedas.
        </p>
      </div>

      {view.findings.length + view.inconclusive.length + view.limitations.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Nenhum diagnóstico com estes filtros"
          description="Nenhuma regra encontrou sinal suficiente no período, e não há limitação de dados a relatar."
        />
      ) : null}

      <Section
        title="Alertas"
        hint="Mudanças sustentadas pelos dados, da maior para a menor prioridade."
        items={view.findings}
      />
      <Section
        title="Inconclusivos"
        hint="A mudança é grande, mas o volume ainda não permite afirmar que não é acaso. Acompanhe ou use um período maior."
        items={view.inconclusive}
      />
      <Section
        title="Limitações dos dados"
        hint="O que impede ou restringe a análise neste período — sem elas, um diagnóstico poderia parecer mais certo do que é."
        items={view.limitations}
      />
    </div>
  );
}
