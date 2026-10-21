/**
 * Leituras do banco para a área Campanhas (SOMENTE `select`). Toda consulta é escopada
 * pelo `workspace_id` da sessão — quem chama passa o workspace de `requireWorkspace()`,
 * nunca um valor vindo da URL. Ids de campanha/grupo vindos da URL só filtram DENTRO do
 * workspace: um id de outro workspace simplesmente não encontra nada.
 *
 * As decisões (estado, cobertura, comparação, rótulos) ficam em `./compose.ts` e
 * `./metrics.ts`, puros e testados sem banco. Não dispara importação nenhuma: a página
 * só lê o que já foi importado (importar é a ação explícita em Conexões).
 */
import { and, desc, eq, gte, inArray, lte, sql, type AnyColumn, type SQL } from "drizzle-orm";

import type {
  AdPlatform,
  CampaignDetail,
  CampaignFilters,
  CampaignsOverview,
} from "@/lib/campaigns";
import { todayInTimeZone } from "@/lib/dates";
import { getConnector } from "@/server/connectors/registry";
import { db } from "@/server/db";
import {
  connectionProperties,
  connections,
  factAdEntityDaily,
  factAdPerformanceDaily,
  syncRuns,
} from "@/server/db/schema";
import { tableExists } from "@/server/db/table-exists";
import { readSources } from "@/server/diagnostico/read";

import {
  REFERENCE_TIMEZONE,
  buildCampaignRow,
  buildEntityLevel,
  buildPanel,
  filterSortPaginate,
  statusOptions,
  type CampaignAggregate,
  detailCoverage,
  entityTotals,
  orZero,
  type DetailSpan,
  type EntityAggregate,
  type PlatformFacts,
} from "./compose";
import {
  ALL_METRICS,
  compareAll,
  kindLabel,
  metaBreakdown,
  resultDefinition,
  statusLabel,
  typeLabel,
  type Totals,
} from "./metrics";
import { filtersToQuery } from "./period";

const ENTITY_TABLE = "fact_ad_entity_daily";
const ALL_PLATFORMS: readonly AdPlatform[] = ["google_ads", "meta_ads"];

const platformsOf = (f: CampaignFilters): AdPlatform[] =>
  f.platform === "all" ? [...ALL_PLATFORMS] : [f.platform];

/** O intervalo que cobre o período atual e, se pedido, o anterior. */
const rangeOf = (f: CampaignFilters) => ({ start: f.previous?.start ?? f.current.start, end: f.current.end });

// ── estado das plataformas ────────────────────────────────────────────

async function readPlatformFacts(
  workspaceId: string,
  platforms: AdPlatform[],
  range: { start: string; end: string },
  now: Date,
): Promise<PlatformFacts[]> {
  const [{ sources }, conns] = await Promise.all([
    readSources(workspaceId, now),
    db
      .select({ id: connections.id, provider: connections.provider, lastSyncedAt: connections.lastSyncedAt })
      .from(connections)
      .where(and(eq(connections.workspaceId, workspaceId), inArray(connections.provider, platforms))),
  ]);
  const ids = conns.map((c) => c.id);

  const [accounts, runs, lastRuns] = ids.length
    ? await Promise.all([
        db
          .select({
            connectionId: connectionProperties.connectionId,
            name: connectionProperties.displayName,
            externalId: connectionProperties.externalId,
            timezone: connectionProperties.timezone,
            currency: connectionProperties.currency,
          })
          .from(connectionProperties)
          .where(and(inArray(connectionProperties.connectionId, ids), eq(connectionProperties.isSelected, true))),
        db
          .select({
            connectionId: syncRuns.connectionId,
            periodStart: syncRuns.periodStart,
            periodEnd: syncRuns.periodEnd,
          })
          .from(syncRuns)
          .where(
            and(
              inArray(syncRuns.connectionId, ids),
              inArray(syncRuns.status, ["success", "partial"]),
              lte(syncRuns.periodStart, range.end),
              gte(syncRuns.periodEnd, range.start),
            ),
          ),
        db
          .selectDistinctOn([syncRuns.connectionId], {
            connectionId: syncRuns.connectionId,
            status: syncRuns.status,
            startedAt: syncRuns.startedAt,
            finishedAt: syncRuns.finishedAt,
            error: syncRuns.error,
          })
          .from(syncRuns)
          .where(inArray(syncRuns.connectionId, ids))
          .orderBy(syncRuns.connectionId, desc(syncRuns.startedAt)),
      ])
    : [[], [], []];

  return platforms.map((platform): PlatformFacts => {
    const conn = conns.find((c) => c.provider === platform) ?? null;
    const account = conn ? (accounts.find((a) => a.connectionId === conn.id) ?? null) : null;
    const run = conn ? (lastRuns.find((r) => r.connectionId === conn.id) ?? null) : null;
    const source = sources.find((s) => s.key === platform);
    if (!source) throw new Error(`Fonte ${platform} ausente do estado das fontes.`);
    return {
      platform,
      source,
      account: account
        ? { name: account.name, externalId: account.externalId, timezone: account.timezone, currency: account.currency }
        : null,
      runs: conn
        ? runs
            .filter((r) => r.connectionId === conn.id && r.periodStart && r.periodEnd)
            .map((r) => ({ periodStart: r.periodStart!, periodEnd: r.periodEnd! }))
        : [],
      lastRun: run
        ? { status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error }
        : null,
      lastSyncedAt: conn?.lastSyncedAt ?? null,
      restatementDays: getConnector(platform).meta.restatementWindowDays,
      accountToday: todayInTimeZone(account?.timezone ?? REFERENCE_TIMEZONE),
    };
  });
}

// ── agregados ─────────────────────────────────────────────────────────

/** Somas filtradas por janela (as colunas numéricas voltam como float8, não string). */
function windowSums(
  t: typeof factAdPerformanceDaily | typeof factAdEntityDaily,
  win: SQL,
) {
  const s = (col: AnyColumn | SQL) => sql<number>`coalesce(sum(${col}) filter (where ${win}), 0)::float8`;
  const action = (type: string) => sql`coalesce((${t.dims}->'conversionActions'->>${type})::numeric, 0)`;
  return {
    rows: sql<number>`count(*) filter (where ${win})::int`,
    cost: s(t.cost),
    impressions: s(t.impressions),
    clicks: s(t.clicks),
    conversions: s(t.conversions),
    conversionValue: s(t.conversionValue),
    lead: s(action("lead")),
    purchase: s(action("purchase")),
    registration: s(action("complete_registration")),
  };
}

type WindowSums = {
  rows: number;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  lead: number;
  purchase: number;
  registration: number;
};

/** Somas de uma janela → `Totals`; janela sem nenhuma linha → `null`. */
function toTotals(w: WindowSums | null): Totals | null {
  if (!w || w.rows === 0) return null;
  const actions: Record<string, number> = {};
  if (w.lead) actions.lead = w.lead;
  if (w.purchase) actions.purchase = w.purchase;
  if (w.registration) actions.complete_registration = w.registration;
  return {
    cost: w.cost,
    impressions: w.impressions,
    clicks: w.clicks,
    conversions: w.conversions,
    conversionValue: w.conversionValue,
    actions,
  };
}

function splitWindows<T extends Record<string, unknown>>(row: T, prefix: "c" | "p"): WindowSums {
  const g = (k: string) => Number(row[`${prefix}_${k}`] ?? 0);
  return {
    rows: g("rows"),
    cost: g("cost"),
    impressions: g("impressions"),
    clicks: g("clicks"),
    conversions: g("conversions"),
    conversionValue: g("conversionValue"),
    lead: g("lead"),
    purchase: g("purchase"),
    registration: g("registration"),
  };
}

function prefixed<T extends Record<string, unknown>>(obj: T, prefix: string) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [`${prefix}_${k}`, v])) as Record<string, SQL>;
}

async function readCampaignAggregates(
  workspaceId: string,
  platforms: AdPlatform[],
  filters: CampaignFilters,
  campaignId?: string,
): Promise<CampaignAggregate[]> {
  const f = factAdPerformanceDaily;
  const range = rangeOf(filters);
  const inCur = sql`${f.date} between ${filters.current.start} and ${filters.current.end}`;
  const inPrev = filters.previous
    ? sql`${f.date} between ${filters.previous.start} and ${filters.previous.end}`
    : sql`false`;
  const scope = and(
    eq(f.workspaceId, workspaceId),
    inArray(f.platform, platforms),
    ...(campaignId ? [eq(f.campaignId, campaignId)] : []),
  );

  const sums = await db
    .select({
      platform: f.platform,
      campaignId: f.campaignId,
      currencies: sql<string[]>`array_remove(array_agg(distinct ${f.currency}), null)`,
      hasNullCurrency: sql<boolean>`bool_or(${f.currency} is null)`,
      ...prefixed(windowSums(f, inCur), "c"),
      ...prefixed(windowSums(f, inPrev), "p"),
    })
    .from(f)
    .where(and(scope, gte(f.date, range.start), lte(f.date, range.end)))
    .groupBy(f.platform, f.campaignId);
  if (sums.length === 0) return [];

  // nome, status, objetivo e canal: do registro mais recente de cada campanha
  const attrs = await readCampaignAttributes(
    workspaceId,
    platforms,
    sums.map((s) => s.campaignId),
  );
  const key = (p: string, id: string) => `${p}\u0000${id}`;
  const attrBy = new Map(attrs.map((a) => [key(a.platform, a.campaignId), a]));

  return sums.map((s) => {
    const a = attrBy.get(key(s.platform, s.campaignId));
    return {
      platform: s.platform as AdPlatform,
      campaignId: s.campaignId,
      name: a?.name ?? "",
      status: a?.status || null,
      objective: a?.objective ?? null,
      channelType: a?.channelType ?? null,
      currencies: s.currencies ?? [],
      hasNullCurrency: Boolean(s.hasNullCurrency),
      current: toTotals(splitWindows(s, "c")),
      previous: filters.previous ? toTotals(splitWindows(s, "p")) : null,
    };
  });
}

async function readCampaignAttributes(workspaceId: string, platforms: AdPlatform[], campaignIds: string[]) {
  const f = factAdPerformanceDaily;
  return db
    .selectDistinctOn([f.platform, f.campaignId], {
      platform: f.platform,
      campaignId: f.campaignId,
      name: f.campaignName,
      status: f.campaignStatus,
      objective: sql<string | null>`${f.dims}->>'objective'`,
      channelType: sql<string | null>`${f.dims}->>'advertisingChannelType'`,
      currency: f.currency,
    })
    .from(f)
    .where(and(eq(f.workspaceId, workspaceId), inArray(f.platform, platforms), inArray(f.campaignId, campaignIds)))
    .orderBy(f.platform, f.campaignId, desc(f.date));
}

// ── visão geral ───────────────────────────────────────────────────────

export async function readCampaignsOverview(input: {
  workspaceId: string;
  filters: CampaignFilters;
  filterWarnings: string[];
  today: string;
  now: Date;
}): Promise<CampaignsOverview> {
  const { workspaceId, filters, now } = input;
  const platforms = platformsOf(filters);
  const [facts, aggs] = await Promise.all([
    readPlatformFacts(workspaceId, platforms, rangeOf(filters), now),
    readCampaignAggregates(workspaceId, platforms, filters),
  ]);

  const panels = facts.map((fa) =>
    buildPanel({ facts: fa, filters, campaigns: aggs.filter((a) => a.platform === fa.platform), now }),
  );
  const rows = aggs.map((agg) =>
    buildCampaignRow({ agg, panel: panels.find((p) => p.platform === agg.platform)!, filters }),
  );
  const page = filterSortPaginate(rows, filters);

  return {
    filters: { ...filters, page: Math.min(filters.page, page.pageCount) },
    filterWarnings: input.filterWarnings,
    today: input.today,
    panels,
    rows: page.rows,
    totalRows: page.totalRows,
    pageCount: page.pageCount,
    statusOptions: statusOptions(aggs),
    statusFilterExcludes: page.statusFilterExcludes,
  };
}

// ── detalhe (níveis 2 e 3) ────────────────────────────────────────────

/** Primeiro/último dia do detalhe (por nível) e da campanha, na conexão da plataforma. */
async function readDetailSpan(workspaceId: string, platform: AdPlatform, level: "ad_group" | "ad"): Promise<DetailSpan> {
  const e = factAdEntityDaily;
  const f = factAdPerformanceDaily;
  const [[detail], [campaign]] = await Promise.all([
    db
      .select({ first: sql<string | null>`min(${e.date})`, last: sql<string | null>`max(${e.date})` })
      .from(e)
      .where(and(eq(e.workspaceId, workspaceId), eq(e.platform, platform), eq(e.level, level))),
    db
      .select({ first: sql<string | null>`min(${f.date})`, last: sql<string | null>`max(${f.date})` })
      .from(f)
      .where(and(eq(f.workspaceId, workspaceId), eq(f.platform, platform))),
  ]);
  return {
    detailFirst: detail?.first ?? null,
    detailLast: detail?.last ?? null,
    campaignFirst: campaign?.first ?? null,
    campaignLast: campaign?.last ?? null,
  };
}

/** Grupos/conjuntos de uma campanha, ou anúncios de um grupo, com somas por janela. */
async function readEntityAggregates(input: {
  workspaceId: string;
  platform: AdPlatform;
  level: "ad_group" | "ad";
  campaignId: string;
  adGroupId?: string;
  filters: CampaignFilters;
}): Promise<EntityAggregate[]> {
  const e = factAdEntityDaily;
  const { filters } = input;
  const range = rangeOf(filters);
  const inCur = sql`${e.date} between ${filters.current.start} and ${filters.current.end}`;
  const inPrev = filters.previous
    ? sql`${e.date} between ${filters.previous.start} and ${filters.previous.end}`
    : sql`false`;
  const idCol = input.level === "ad" ? e.adId : e.adGroupId;
  const nameCol = input.level === "ad" ? e.adName : e.adGroupName;

  const rows = await db
    .select({
      id: idCol,
      name: sql<string>`(array_agg(${nameCol} order by ${e.date} desc))[1]`,
      status: sql<string>`(array_agg(${e.status} order by ${e.date} desc))[1]`,
      type: sql<string>`(array_agg(${e.entityType} order by ${e.date} desc))[1]`,
      ...prefixed(windowSums(e, inCur), "c"),
      ...prefixed(windowSums(e, inPrev), "p"),
    })
    .from(e)
    .where(
      and(
        eq(e.workspaceId, input.workspaceId),
        eq(e.platform, input.platform),
        eq(e.level, input.level),
        eq(e.campaignId, input.campaignId),
        ...(input.adGroupId ? [eq(e.adGroupId, input.adGroupId)] : []),
        gte(e.date, range.start),
        lte(e.date, range.end),
      ),
    )
    .groupBy(idCol);

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    status: r.status || null,
    type: r.type || null,
    current: toTotals(splitWindows(r, "c")),
    previous: filters.previous ? toTotals(splitWindows(r, "p")) : null,
  }));
}

/** Página da campanha: métricas completas + grupos/conjuntos. `null` = não existe no workspace. */
export async function readCampaignDetail(input: {
  workspaceId: string;
  platform: AdPlatform;
  campaignId: string;
  filters: CampaignFilters;
  filterWarnings: string[];
  now: Date;
}): Promise<CampaignDetail | null> {
  const { workspaceId, platform, campaignId, now } = input;
  const filters: CampaignFilters = { ...input.filters, platform };

  const [attr] = await readCampaignAttributes(workspaceId, [platform], [campaignId]);
  if (!attr) return null;

  const [[facts], aggs, ready] = await Promise.all([
    readPlatformFacts(workspaceId, [platform], rangeOf(filters), now),
    readCampaignAggregates(workspaceId, [platform], filters, campaignId),
    tableExists(ENTITY_TABLE),
  ]);
  if (!facts) return null;
  const agg: CampaignAggregate = aggs[0] ?? {
    platform,
    campaignId,
    name: attr.name,
    status: attr.status || null,
    objective: attr.objective,
    channelType: attr.channelType,
    currencies: attr.currency ? [attr.currency] : [],
    hasNullCurrency: !attr.currency,
    current: null,
    previous: null,
  };
  const panel = buildPanel({ facts, filters, campaigns: [agg], now });
  const row = buildCampaignRow({ agg, panel, filters });
  const def = resultDefinition(platform, agg.objective);
  const comparable = panel.comparable && !row.mixedCurrency;
  const cur = orZero(agg.current, panel.coverage?.current ?? null);
  const prev = filters.previous ? orZero(agg.previous, panel.coverage?.previous ?? null) : null;

  const span = ready ? await readDetailSpan(workspaceId, platform, "ad_group") : emptySpan();
  const children = buildEntityLevel({
    platform,
    level: "ad_group",
    tableReady: ready,
    span,
    channelType: agg.channelType,
    def,
    parent: cur,
    currency: row.currency,
    parentComparable: comparable,
    coverage: panel.coverage,
    filters,
    rows:
      ready && span.detailFirst
        ? await readEntityAggregates({ workspaceId, platform, level: "ad_group", campaignId, filters })
        : [],
    hrefFor: (id) =>
      `/campanhas/${platform}/${encodeURIComponent(campaignId)}/${encodeURIComponent(id)}${filtersToQuery(filters, { page: 1, platform: "all" })}`,
  });

  return {
    filters,
    filterWarnings: input.filterWarnings,
    panel,
    campaign: {
      id: campaignId,
      name: row.name,
      status: row.status,
      statusLabel: row.statusLabel,
      kindLabel: row.kindLabel,
      currency: row.currency,
      mixedCurrency: row.mixedCurrency,
    },
    result: def,
    metrics: compareAll({ platform, def, current: cur, previous: prev, comparable }, ALL_METRICS),
    conversionBreakdown: platform === "meta_ads" ? metaBreakdown(cur, prev, comparable) : [],
    children,
    group: null,
  };
}

/** Página do grupo/conjunto: suas métricas + anúncios. `null` = não existe no workspace. */
export async function readAdGroupDetail(input: {
  workspaceId: string;
  platform: AdPlatform;
  campaignId: string;
  adGroupId: string;
  filters: CampaignFilters;
  filterWarnings: string[];
  now: Date;
}): Promise<CampaignDetail | null> {
  const { workspaceId, platform, campaignId, adGroupId, now } = input;
  const filters: CampaignFilters = { ...input.filters, platform };
  if (!(await tableExists(ENTITY_TABLE))) return null;

  const e = factAdEntityDaily;
  const [[group], [attr]] = await Promise.all([
    db
      .select({ name: e.adGroupName, status: e.status, type: e.entityType, currency: e.currency, dims: e.dims })
      .from(e)
      .where(
        and(
          eq(e.workspaceId, workspaceId),
          eq(e.platform, platform),
          eq(e.level, "ad_group"),
          eq(e.campaignId, campaignId),
          eq(e.adGroupId, adGroupId),
        ),
      )
      .orderBy(desc(e.date))
      .limit(1),
    readCampaignAttributes(workspaceId, [platform], [campaignId]),
  ]);
  if (!group || !attr) return null;

  const [[facts], campaignAggs, groupAggs, groupSpan, adSpan] = await Promise.all([
    readPlatformFacts(workspaceId, [platform], rangeOf(filters), now),
    readCampaignAggregates(workspaceId, [platform], filters, campaignId),
    readEntityAggregates({ workspaceId, platform, level: "ad_group", campaignId, filters }),
    readDetailSpan(workspaceId, platform, "ad_group"),
    readDetailSpan(workspaceId, platform, "ad"),
  ]);
  if (!facts) return null;

  const panel = buildPanel({ facts, filters, campaigns: campaignAggs, now });
  const campaignRow = campaignAggs[0] ? buildCampaignRow({ agg: campaignAggs[0], panel, filters }) : null;
  const def = resultDefinition(platform, attr.objective);

  // o grupo em si é uma linha do nível 2 — mesma regra de cobertura do detalhe
  const groupAgg = groupAggs.find((g) => g.id === adGroupId) ?? { current: null, previous: null };
  const { cur, prev } = entityTotals(groupAgg, { span: groupSpan, coverage: panel.coverage, filters });
  const { coversCurrent, coversPrevious } = detailCoverage(groupSpan, filters);
  const groupComparable = panel.comparable && coversCurrent && coversPrevious;
  const groupNotes: string[] = [];
  if (!coversCurrent) groupNotes.push("O detalhe deste conjunto/grupo não cobre todo o período selecionado.");
  if (filters.previous && panel.comparable && !coversPrevious) {
    groupNotes.push("Sem comparação neste nível: o detalhe não cobre o período anterior.");
  }

  const children = buildEntityLevel({
    platform,
    level: "ad",
    tableReady: true,
    span: adSpan,
    channelType: attr.channelType,
    def,
    parent: cur,
    currency: group.currency,
    parentComparable: groupComparable,
    coverage: panel.coverage,
    filters,
    rows: adSpan.detailFirst
      ? await readEntityAggregates({ workspaceId, platform, level: "ad", campaignId, adGroupId, filters })
      : [],
    hrefFor: null,
  });

  return {
    filters,
    filterWarnings: [...input.filterWarnings, ...groupNotes],
    panel,
    campaign: {
      id: campaignId,
      name: attr.name || `Campanha ${campaignId}`,
      status: attr.status || null,
      statusLabel: statusLabel(attr.status || null),
      kindLabel: kindLabel(platform, attr.objective, attr.channelType),
      currency: campaignRow?.currency ?? group.currency,
      mixedCurrency: campaignRow?.mixedCurrency ?? false,
    },
    result: def,
    metrics: compareAll({ platform, def, current: cur, previous: prev, comparable: groupComparable }, ALL_METRICS),
    conversionBreakdown: platform === "meta_ads" ? metaBreakdown(cur, prev, groupComparable) : [],
    children,
    group: {
      id: adGroupId,
      name: group.name || `${adGroupId}`,
      statusLabel: statusLabel(group.status || null),
      typeLabel: typeLabel(group.type || null),
    },
  };
}

function emptySpan(): DetailSpan {
  return { detailFirst: null, detailLast: null, campaignFirst: null, campaignLast: null };
}
