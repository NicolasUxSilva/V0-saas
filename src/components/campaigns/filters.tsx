/**
 * Filtros da área Campanhas: um formulário GET comum (sem JavaScript). O estado vive na
 * URL — dá para compartilhar o link e voltar com o navegador. A validação é do servidor
 * (`parseFilters`); valor inválido volta como aviso na página.
 */
import { buttonVariants } from "@/components/ui/button";
import type { CampaignFilters } from "@/lib/campaigns";
import { cn } from "@/lib/utils";

const FIELD =
  "h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export function CampaignFiltersForm({
  action,
  filters,
  statusOptions,
  showPlatform = true,
  showListOptions = true,
}: {
  action: string;
  filters: CampaignFilters;
  statusOptions: { value: string; label: string }[];
  showPlatform?: boolean;
  showListOptions?: boolean;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      {showPlatform ? (
        <Field label="Plataforma">
          <select name="plataforma" defaultValue={filters.platform} className={FIELD}>
            <option value="all">Todas</option>
            <option value="google_ads">Google Ads</option>
            <option value="meta_ads">Meta Ads</option>
          </select>
        </Field>
      ) : null}
      <Field label="Período">
        <select name="periodo" defaultValue={String(filters.preset)} className={FIELD}>
          <option value="7">Últimos 7 dias</option>
          <option value="14">Últimos 14 dias</option>
          <option value="28">Últimos 28 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="custom">Personalizado</option>
        </select>
      </Field>
      <Field label="De (personalizado)">
        <input type="date" name="inicio" defaultValue={filters.current.start} className={FIELD} />
      </Field>
      <Field label="Até (personalizado)">
        <input type="date" name="fim" defaultValue={filters.current.end} className={FIELD} />
      </Field>
      <Field label="Comparar com">
        <select name="comparar" defaultValue={filters.previous ? "sim" : "nao"} className={FIELD}>
          <option value="sim">Período anterior equivalente</option>
          <option value="nao">Sem comparação</option>
        </select>
      </Field>
      {showListOptions && statusOptions.length > 0 ? (
        <Field label="Status">
          <select name="status" defaultValue={filters.status ?? ""} className={FIELD}>
            <option value="">Todos</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {showListOptions ? (
        <Field label="Ordenar por">
          <select name="ordem" defaultValue={filters.sort} className={FIELD}>
            <option value="cost">Maior investimento</option>
            <option value="cost_delta">Maior aumento de investimento</option>
            <option value="results">Mais resultados</option>
            <option value="cost_per_result">Maior custo por resultado</option>
            <option value="cost_per_result_delta">Maior alta do custo por resultado</option>
            <option value="name">Nome</option>
          </select>
        </Field>
      ) : null}
      {showListOptions ? (
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="foco" value="sem_resultado" defaultChecked={filters.onlyCostWithoutResult} />
          Só investimento sem resultados
        </label>
      ) : null}
      <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
        Aplicar
      </button>
    </form>
  );
}
