/**
 * Composição da área Campanhas — PURO (sem banco, rede nem relógio: `now` e `today`
 * entram como argumento). Recebe os agregados já lidos (`./read.ts`) e decide o que a
 * tela mostra: estado de cada plataforma, cobertura do período, comparabilidade, linhas
 * de campanha, filtros, ordenação, paginação e o nível inferior (grupos/conjuntos e
 * anúncios).
 *
 * Nada aqui soma plataformas diferentes nem moedas diferentes.
 */
import type {
  AdPlatform,
  CampaignFilters,
  CampaignRow,
  DateWindow,
  EntityLevelView,
  EntityRow,
  MetricComparison,
  PlatformPanel,
  PlatformTotals,
  ResultDefinition,
  SyncState,
  WindowCoverage,
} from "@/lib/campaigns";
import { addDays } from "@/lib/dates";
import type { SourceStatus } from "@/lib/insight";
import { DETAIL_ERROR_PREFIX } from "@/server/sync/detail-window";

import {
  EMPTY_TOTALS,
  GROUP_LEVEL_LABEL,
  PLATFORM_LABEL,
  addTotals,
  compareMetric,
  kindLabel,
  resultDefinition,
  statusLabel,
  typeLabel,
  type Totals,
} from "./metrics";
import {
  PAGE_SIZE,
  comparability,
  coverageNote,
  filtersToQuery,
  windowCoverage,
  type ImportedWindow,
} from "./period";

/** Fuso de referência do produto (o mesmo do Diagnóstico). */
export const REFERENCE_TIMEZONE = "America/Sao_Paulo";
/** Importação "em curso" há mais que isto é tratada como interrompida. */
export const RUN_STALE_MS = 15 * 60_000;
/** Teto de linhas no nível inferior (o resto é contado, não escondido em silêncio). */
export const MAX_CHILD_ROWS = 200;

const BR = (iso: string) => iso.split("-").reverse().join("/");

// ── entradas (o que `read.ts` entrega) ────────────────────────────────

export interface LastRunFact {
  status: "running" | "success" | "partial" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

export interface PlatformFacts {
  platform: AdPlatform;
  source: SourceStatus;
  account: { name: string; externalId: string; timezone: string | null; currency: string | null } | null;
  /** importações concluídas (success | partial) que tocam o intervalo consultado */
  runs: ImportedWindow[];
  lastRun: LastRunFact | null;
  lastSyncedAt: Date | null;
  restatementDays: number;
  /** "hoje" no fuso da conta */
  accountToday: string;
}

export interface CampaignAggregate {
  platform: AdPlatform;
  campaignId: string;
  name: string;
  status: string | null;
  objective: string | null;
  channelType: string | null;
  currencies: string[];
  hasNullCurrency: boolean;
  /** `null` = nenhuma linha no período (pode ser zero real ou ausência — decide a cobertura) */
  current: Totals | null;
  previous: Totals | null;
  /** objetivos distintos no intervalo lido (Meta); mais de um = a definição de resultado mudou */
  objectives?: string[];
}

// ── estado da plataforma ──────────────────────────────────────────────

export function syncState(f: Pick<PlatformFacts, "lastRun" | "lastSyncedAt">, now: Date): SyncState {
  const r = f.lastRun;
  const inFlight = r?.status === "running" && !r.finishedAt;
  const fresh = inFlight && now.getTime() - r.startedAt.getTime() <= RUN_STALE_MS;
  const detailError =
    r && r.status === "partial" && r.error?.startsWith(DETAIL_ERROR_PREFIX)
      ? r.error.slice(DETAIL_ERROR_PREFIX.length)
      : null;
  return {
    lastSyncedAt: f.lastSyncedAt ? f.lastSyncedAt.toISOString() : null,
    lastRun: r
      ? {
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
          error: r.error,
        }
      : null,
    running: Boolean(fresh),
    stalled: Boolean(inFlight && !fresh),
    detailError,
  };
}

/** A conta já importou alguma vez (há o que medir)? */
const hasImports = (f: PlatformFacts) => f.source.health !== "not_connected" && f.account !== null;

/** Totais de um período para uma linha sem agregado: zero real se o período foi importado. */
export function orZero(t: Totals | null, c: WindowCoverage | null): Totals | null {
  if (t) return t;
  return c && c.state !== "none" ? EMPTY_TOTALS : null;
}

const mixed = (a: Pick<CampaignAggregate, "currencies" | "hasNullCurrency">) =>
  a.currencies.length + (a.hasNullCurrency ? 1 : 0) > 1;

const TOTAL_KEYS = ["cost", "impressions", "clicks", "ctr", "cpc", "cpm", "results", "cost_per_result"] as const;

function platformTotals(
  platform: AdPlatform,
  campaigns: CampaignAggregate[],
  coverage: PlatformPanel["coverage"],
  comparable: boolean,
): { totals: PlatformTotals[]; notes: string[] } {
  const notes: string[] = [];
  const byCurrency = new Map<string, CampaignAggregate[]>();
  let skipped = 0;
  for (const c of campaigns) {
    if (mixed(c)) {
      skipped++;
      continue;
    }
    const key = c.currencies[0] ?? "";
    byCurrency.set(key, [...(byCurrency.get(key) ?? []), c]);
  }
  if (skipped > 0) {
    notes.push(`${skipped} campanha(s) com dados em mais de uma moeda ficaram fora dos totais.`);
  }
  if (byCurrency.size > 1) notes.push("Há campanhas em moedas diferentes: os totais são mostrados por moeda, sem conversão.");

  const totals: PlatformTotals[] = [];
  for (const [currency, list] of byCurrency) {
    const defs = new Set(list.map((c) => resultDefinition(platform, c.objective)?.key ?? "none"));
    const shared: ResultDefinition | null =
      defs.size === 1 ? resultDefinition(platform, list[0]!.objective) : null;
    if (defs.size > 1) {
      notes.push("Resultados não somados: as campanhas têm definições de resultado diferentes (ex.: leads e compras).");
    }
    const sum = (pick: (c: CampaignAggregate) => Totals | null, cov: WindowCoverage | null) =>
      cov && cov.state !== "none" ? list.reduce((acc, c) => addTotals(acc, pick(c) ?? EMPTY_TOTALS), EMPTY_TOTALS) : null;
    const cur = sum((c) => c.current, coverage?.current ?? null);
    const prev = sum((c) => c.previous, coverage?.previous ?? null);
    totals.push({
      currency: currency || null,
      metrics: TOTAL_KEYS.map((key) =>
        compareMetric({ key, platform, def: shared, current: cur, previous: prev, comparable }),
      ).filter((m) => shared !== null || (m.key !== "results" && m.key !== "cost_per_result")),
    });
  }
  return { totals, notes: [...new Set(notes)] };
}

export function buildPanel(input: {
  facts: PlatformFacts;
  filters: CampaignFilters;
  campaigns: CampaignAggregate[];
  now: Date;
}): PlatformPanel {
  const { facts, filters, campaigns, now } = input;
  const notes: string[] = [];
  let coverage: PlatformPanel["coverage"] = null;
  let comparable = false;
  let comparabilityNote: string | null = null;

  if (hasImports(facts)) {
    coverage = {
      current: windowCoverage(facts.runs, filters.current),
      previous: filters.previous ? windowCoverage(facts.runs, filters.previous) : null,
    };
    const cmp = comparability(coverage.current, coverage.previous);
    comparable = cmp.comparable;
    comparabilityNote = cmp.note;

    const curNote = coverageNote("Período atual", coverage.current);
    if (curNote) notes.push(curNote);
    const prevNote = coverage.previous ? coverageNote("Período anterior", coverage.previous) : null;
    if (prevNote) notes.push(prevNote);

    if (coverage.current.state !== "none" && campaigns.every((c) => !c.current)) {
      notes.push("Sem veiculação registrada no período importado.");
    }
    const tz = facts.account?.timezone;
    if (tz && tz !== REFERENCE_TIMEZONE) notes.push(`As datas seguem o fuso da conta (${tz}).`);
    if (filters.current.end >= facts.accountToday) {
      notes.push("O período inclui hoje, que ainda está em curso no fuso da conta.");
    }
    const unsettledFrom = addDays(facts.accountToday, -facts.restatementDays);
    if (filters.current.end >= unsettledFrom) {
      notes.push(
        `A plataforma ainda pode reprocessar os últimos ${facts.restatementDays} dias (atribuição tardia): os números recentes podem mudar na próxima importação.`,
      );
    }
  }

  const { totals, notes: totalNotes } = platformTotals(facts.platform, campaigns, coverage, comparable);
  return {
    platform: facts.platform,
    label: PLATFORM_LABEL[facts.platform],
    source: facts.source,
    account: facts.account,
    sync: syncState(facts, now),
    coverage,
    comparable,
    comparabilityNote,
    notes: [...notes, ...totalNotes],
    totals: coverage ? totals : [],
    campaignCount: campaigns.length,
    restatementDays: facts.restatementDays,
  };
}

// ── linhas de campanha ────────────────────────────────────────────────

export function buildCampaignRow(input: {
  agg: CampaignAggregate;
  panel: PlatformPanel;
  filters: CampaignFilters;
}): CampaignRow {
  const { agg, panel, filters } = input;
  const def = resultDefinition(agg.platform, agg.objective);
  const isMixed = mixed(agg);
  const cur = orZero(agg.current, panel.coverage?.current ?? null);
  const prev = filters.previous ? orZero(agg.previous, panel.coverage?.previous ?? null) : null;
  const comparable = panel.comparable && !isMixed;
  const m = (key: Parameters<typeof compareMetric>[0]["key"]) =>
    compareMetric({ key, platform: agg.platform, def, current: cur, previous: prev, comparable });

  const results = m("results");
  const flags: string[] = [];
  if (!agg.current && cur) flags.push("Sem veiculação no período");
  if (agg.current && !agg.previous && prev && panel.comparable) flags.push("Sem veiculação no período anterior");
  if (def && cur && cur.cost > 0 && results.current === 0) flags.push("Investimento sem resultados");
  if (!def && agg.platform === "meta_ads") flags.push("Resultado não definido para o objetivo");
  if (isMixed) flags.push("Mais de uma moeda: sem totais nem comparação");

  return {
    platform: agg.platform,
    platformLabel: PLATFORM_LABEL[agg.platform],
    campaignId: agg.campaignId,
    name: agg.name || `Campanha ${agg.campaignId}`,
    status: agg.status,
    statusLabel: statusLabel(agg.status),
    kindLabel: kindLabel(agg.platform, agg.objective, agg.channelType),
    currency: isMixed ? null : (agg.currencies[0] ?? null),
    mixedCurrency: isMixed,
    result: def,
    cost: m("cost"),
    results,
    costPerResult: m("cost_per_result"),
    clicks: m("clicks"),
    ctr: m("ctr"),
    flags,
    href: `/campanhas/${agg.platform}/${encodeURIComponent(agg.campaignId)}${filtersToQuery(filters, { page: 1, status: null, onlyCostWithoutResult: false, sort: "cost" })}`,
  };
}

/** Ordena com `null` sempre por último (sem dado não é "o menor"). */
function byNullable(get: (r: CampaignRow) => number | null, desc = true) {
  return (a: CampaignRow, b: CampaignRow) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return desc ? y - x : x - y;
  };
}

export function filterSortPaginate(
  rows: CampaignRow[],
  filters: CampaignFilters,
): { rows: CampaignRow[]; totalRows: number; pageCount: number; statusFilterExcludes: string | null } {
  let list = rows;
  let statusFilterExcludes: string | null = null;
  if (filters.status) {
    const withoutStatus = list.filter((r) => r.status === null).length;
    list = list.filter((r) => r.status === filters.status);
    if (withoutStatus > 0) {
      statusFilterExcludes = `${withoutStatus} campanha(s) sem status informado ficaram de fora (a importação do Meta Ads não traz o status).`;
    }
  }
  if (filters.onlyCostWithoutResult) list = list.filter((r) => r.flags.includes("Investimento sem resultados"));

  const byName = (a: CampaignRow, b: CampaignRow) => a.name.localeCompare(b.name, "pt-BR");
  const sorters: Record<CampaignFilters["sort"], (a: CampaignRow, b: CampaignRow) => number> = {
    cost: byNullable((r) => r.cost.current),
    cost_delta: byNullable((r) => r.cost.deltaPct),
    results: byNullable((r) => r.results.current),
    cost_per_result: byNullable((r) => r.costPerResult.current),
    cost_per_result_delta: byNullable((r) => r.costPerResult.deltaPct),
    name: byName,
  };
  const sorted = [...list].sort((a, b) => sorters[filters.sort](a, b) || byName(a, b));

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  return {
    rows: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    totalRows: sorted.length,
    pageCount,
    statusFilterExcludes,
  };
}

/** Opções de status: só os valores que existem nos dados. */
export function statusOptions(aggs: CampaignAggregate[]): { value: string; label: string }[] {
  const values = [...new Set(aggs.map((a) => a.status).filter((s): s is string => Boolean(s)))].sort();
  return values.map((value) => ({ value, label: statusLabel(value) ?? value }));
}

// ── nível inferior (grupos/conjuntos e anúncios) ──────────────────────

export interface EntityAggregate {
  id: string;
  name: string;
  status: string | null;
  type: string | null;
  current: Totals | null;
  previous: Totals | null;
}

/** Até onde o DETALHE foi importado, em relação à campanha (por conexão e nível). */
export interface DetailSpan {
  detailFirst: string | null;
  detailLast: string | null;
  campaignFirst: string | null;
  campaignLast: string | null;
}

/** O detalhe cobre o período atual e o anterior? */
export function detailCoverage(span: DetailSpan, filters: CampaignFilters) {
  return {
    coversCurrent: detailCovers(span, filters.current),
    coversPrevious: filters.previous ? detailCovers(span, filters.previous) : false,
  };
}

/**
 * Totais atuais/anteriores de uma entidade de detalhe. Sem linha numa janela: zero real
 * só se a campanha foi importada E o detalhe cobre a janela; senão, ausência (`null`).
 */
export function entityTotals(
  r: Pick<EntityAggregate, "current" | "previous">,
  ctx: { span: DetailSpan; coverage: PlatformPanel["coverage"]; filters: CampaignFilters },
): { cur: Totals | null; prev: Totals | null } {
  const { coversCurrent, coversPrevious } = detailCoverage(ctx.span, ctx.filters);
  return {
    cur: coversCurrent ? orZero(r.current, ctx.coverage?.current ?? null) : r.current,
    prev: ctx.filters.previous
      ? coversPrevious
        ? orZero(r.previous, ctx.coverage?.previous ?? null)
        : r.previous
      : null,
  };
}

/** O detalhe cobre a janela inteira tanto quanto a campanha? */
export function detailCovers(span: DetailSpan, w: DateWindow): boolean {
  if (!span.detailFirst || !span.detailLast) return false;
  const fromOk = span.detailFirst <= (span.campaignFirst ?? span.detailFirst) || span.detailFirst <= w.start;
  const toOk = span.detailLast >= (span.campaignLast ?? span.detailLast) || span.detailLast >= w.end;
  return fromOk && toOk;
}

export function buildEntityLevel(input: {
  platform: AdPlatform;
  level: "ad_group" | "ad";
  tableReady: boolean;
  span: DetailSpan;
  /** tipo de canal da campanha (Google) — Performance Max não tem grupo de anúncios */
  channelType: string | null;
  def: ResultDefinition | null;
  /** totais do nível de cima no período atual (para a fatia e a conciliação) */
  parent: Totals | null;
  currency: string | null;
  /** os períodos do nível de cima são comparáveis? */
  parentComparable: boolean;
  /** cobertura da campanha (importação) */
  coverage: PlatformPanel["coverage"];
  filters: CampaignFilters;
  rows: EntityAggregate[];
  hrefFor: ((id: string) => string) | null;
}): EntityLevelView {
  const { platform, level, span, filters } = input;
  const title = level === "ad" ? "Anúncios" : GROUP_LEVEL_LABEL[platform].many;
  const base = { level, title, notes: [] as string[], comparable: false, reconciliation: null, rows: [], truncated: 0 };

  if (!input.tableReady) {
    return {
      ...base,
      availability: {
        state: "migration_pending",
        message:
          "O detalhe abaixo da campanha ainda não está habilitado neste ambiente: falta aplicar a migração 0005 (fact_ad_entity_daily).",
      },
    };
  }
  if (level === "ad_group" && platform === "google_ads" && input.channelType === "PERFORMANCE_MAX") {
    return {
      ...base,
      availability: {
        state: "unsupported",
        message:
          "Campanhas Performance Max não têm grupos de anúncios: usam grupos de recursos, que ainda não são importados.",
      },
    };
  }
  if (!span.detailFirst) {
    return {
      ...base,
      availability: {
        state: "not_imported",
        message: `O detalhe por ${level === "ad" ? "anúncio" : GROUP_LEVEL_LABEL[platform].one.toLowerCase()} ainda não foi importado. Rode "Importar dados" em Conexões para trazê-lo.`,
      },
    };
  }

  const { coversCurrent, coversPrevious } = detailCoverage(span, filters);
  const notes: string[] = [];
  if (!coversCurrent) {
    notes.push(
      `O detalhe deste nível vai de ${BR(span.detailFirst)} a ${BR(span.detailLast ?? span.detailFirst)}; parte do período não está detalhada.`,
    );
  }
  const comparable = input.parentComparable && coversCurrent && coversPrevious;
  if (filters.previous && input.parentComparable && !coversPrevious) {
    notes.push("Sem comparação neste nível: o detalhe não cobre o período anterior.");
  }

  const parentCost = input.parent?.cost ?? null;

  const rows: EntityRow[] = input.rows.map((r) => {
    const { cur, prev } = entityTotals(r, { span, coverage: input.coverage, filters });
    const m = (key: Parameters<typeof compareMetric>[0]["key"]): MetricComparison =>
      compareMetric({ key, platform, def: input.def, current: cur, previous: prev, comparable });
    const cost = m("cost");
    return {
      id: r.id,
      name: r.name || (level === "ad" ? `Anúncio ${r.id}` : `${GROUP_LEVEL_LABEL[platform].one} ${r.id}`),
      status: r.status,
      statusLabel: statusLabel(r.status),
      typeLabel: typeLabel(r.type),
      cost,
      costShare: parentCost && parentCost > 0 && cost.current !== null ? cost.current / parentCost : null,
      impressions: m("impressions"),
      clicks: m("clicks"),
      ctr: m("ctr"),
      cpc: m("cpc"),
      results: m("results"),
      costPerResult: m("cost_per_result"),
      href: input.hrefFor ? input.hrefFor(r.id) : null,
    };
  });
  rows.sort(
    (a, b) => (b.cost.current ?? -1) - (a.cost.current ?? -1) || a.name.localeCompare(b.name, "pt-BR"),
  );

  const childCost = input.rows.reduce((acc, r) => acc + (r.current?.cost ?? 0), 0);
  const reconciliation =
    parentCost !== null && Math.abs(childCost - parentCost) > 0.01 + parentCost * 0.001
      ? { childCost, parentCost, currency: input.currency }
      : null;

  if (rows.length === 0) {
    return {
      ...base,
      notes,
      availability: {
        state: "no_rows",
        message: `Nenhum registro deste nível no período${filters.previous ? " nem no anterior" : ""}.`,
      },
    };
  }
  return {
    level,
    title,
    availability: { state: "ready" },
    notes,
    comparable,
    reconciliation,
    rows: rows.slice(0, MAX_CHILD_ROWS),
    truncated: Math.max(0, rows.length - MAX_CHILD_ROWS),
  };
}
