import { describe, expect, it } from "vitest";

import type { SourceStatus } from "@/lib/insight";
import {
  buildCampaignRow,
  buildEntityLevel,
  buildPanel,
  detailCovers,
  filterSortPaginate,
  statusOptions,
  syncState,
  type CampaignAggregate,
  type PlatformFacts,
} from "@/server/campaigns/compose";
import { EMPTY_TOTALS, type Totals } from "@/server/campaigns/metrics";
import { parseFilters } from "@/server/campaigns/period";
import { DETAIL_ERROR_PREFIX } from "@/server/sync/detail-window";

const NOW = new Date("2026-10-21T15:00:00Z");
const TODAY = "2026-10-21";
const { filters } = parseFilters({}, TODAY); // 23/09–20/10 × 26/08–22/09

const t = (over: Partial<Totals> = {}): Totals => ({ ...EMPTY_TOTALS, ...over });

const source = (over: Partial<SourceStatus> = {}): SourceStatus => ({
  key: "google_ads",
  label: "Google Ads",
  health: "synced",
  summary: "",
  notice: null,
  action: null,
  lastSyncedAt: null,
  coverage: null,
  feeds: "",
  ...over,
});

const facts = (over: Partial<PlatformFacts> = {}): PlatformFacts => ({
  platform: "google_ads",
  source: source(),
  account: { name: "Conta", externalId: "customers/1", timezone: "America/Sao_Paulo", currency: "BRL" },
  runs: [{ periodStart: "2026-04-20", periodEnd: "2026-10-21" }],
  lastRun: { status: "success", startedAt: new Date("2026-10-21T10:00:00Z"), finishedAt: new Date("2026-10-21T10:01:00Z"), error: null },
  lastSyncedAt: new Date("2026-10-21T10:01:00Z"),
  restatementDays: 14,
  accountToday: TODAY,
  ...over,
});

const agg = (over: Partial<CampaignAggregate> = {}): CampaignAggregate => ({
  platform: "google_ads",
  campaignId: "1",
  name: "Busca marca",
  status: "ENABLED",
  objective: null,
  channelType: "SEARCH",
  currencies: ["BRL"],
  hasNullCurrency: false,
  current: t({ cost: 300, impressions: 10_000, clicks: 200, conversions: 6 }),
  previous: t({ cost: 200, impressions: 8_000, clicks: 160, conversions: 8 }),
  ...over,
});

describe("buildPanel", () => {
  it("importação completa nos dois períodos → comparável, com totais na moeda da conta", () => {
    const p = buildPanel({ facts: facts(), filters, campaigns: [agg()], now: NOW });
    expect(p.comparable).toBe(true);
    expect(p.totals).toHaveLength(1);
    expect(p.totals[0]!.currency).toBe("BRL");
    expect(p.totals[0]!.metrics.find((m) => m.key === "cost")).toMatchObject({ current: 300, previous: 200, deltaPct: 0.5 });
  });

  it("dados defasados (última importação antes do fim do período) → parcial, sem comparação", () => {
    const p = buildPanel({ facts: facts({ runs: [{ periodStart: "2026-04-10", periodEnd: "2026-10-07" }] }), filters, campaigns: [agg()], now: NOW });
    expect(p.comparable).toBe(false);
    expect(p.comparabilityNote).toMatch(/período atual não foi importado por completo/);
    expect(p.notes.join(" ")).toMatch(/13 sem importação/);
    expect(p.totals[0]!.metrics.find((m) => m.key === "cost")!.deltaPct).toBeNull();
  });

  it("fonte não conectada → sem cobertura nem totais (não vira zero)", () => {
    const p = buildPanel({
      facts: facts({ platform: "meta_ads", source: source({ key: "meta_ads", health: "not_connected" }), account: null, runs: [], lastRun: null, lastSyncedAt: null }),
      filters,
      campaigns: [],
      now: NOW,
    });
    expect(p.coverage).toBeNull();
    expect(p.totals).toEqual([]);
  });

  it("moedas diferentes nunca são somadas", () => {
    const p = buildPanel({
      facts: facts(),
      filters,
      campaigns: [agg(), agg({ campaignId: "2", currencies: ["USD"] }), agg({ campaignId: "3", currencies: ["BRL", "USD"] })],
      now: NOW,
    });
    expect(p.totals.map((x) => x.currency).sort()).toEqual(["BRL", "USD"]);
    expect(p.notes.join(" ")).toMatch(/mais de uma moeda ficaram fora/);
  });

  it("Meta com objetivos diferentes: resultados não somados", () => {
    const p = buildPanel({
      facts: facts({ platform: "meta_ads", source: source({ key: "meta_ads" }) }),
      filters,
      campaigns: [
        agg({ platform: "meta_ads", objective: "OUTCOME_LEADS" }),
        agg({ platform: "meta_ads", campaignId: "2", objective: "OUTCOME_SALES" }),
      ],
      now: NOW,
    });
    expect(p.totals[0]!.metrics.some((m) => m.key === "results")).toBe(false);
    expect(p.notes.join(" ")).toMatch(/definições de resultado diferentes/);
  });

  it("avisa fuso diferente e dias ainda sujeitos a reprocessamento", () => {
    const p = buildPanel({
      facts: facts({ account: { name: "C", externalId: "act_1", timezone: "America/Los_Angeles", currency: "USD" } }),
      filters,
      campaigns: [agg()],
      now: NOW,
    });
    expect(p.notes.join(" ")).toMatch(/fuso da conta \(America\/Los_Angeles\)/);
    expect(p.notes.join(" ")).toMatch(/reprocessar os últimos 14 dias/);
  });
});

describe("syncState", () => {
  it("em curso recente × interrompida", () => {
    const running = (min: number) => ({
      lastRun: { status: "running" as const, startedAt: new Date(NOW.getTime() - min * 60_000), finishedAt: null, error: null },
      lastSyncedAt: null,
    });
    expect(syncState(running(2), NOW)).toMatchObject({ running: true, stalled: false });
    expect(syncState(running(60), NOW)).toMatchObject({ running: false, stalled: true });
  });

  it("falha só no detalhe é reconhecida pelo prefixo", () => {
    const s = syncState(
      {
        lastRun: { status: "partial", startedAt: NOW, finishedAt: NOW, error: `${DETAIL_ERROR_PREFIX}limite de taxa` },
        lastSyncedAt: NOW,
      },
      NOW,
    );
    expect(s.detailError).toBe("limite de taxa");
  });
});

describe("buildCampaignRow", () => {
  const panel = buildPanel({ facts: facts(), filters, campaigns: [agg()], now: NOW });

  it("métricas compactas com variação e link que preserva o período", () => {
    const r = buildCampaignRow({ agg: agg(), panel, filters });
    expect(r.cost).toMatchObject({ current: 300, deltaPct: 0.5 });
    expect(r.results).toMatchObject({ current: 6, previous: 8, deltaPct: -0.25 });
    expect(r.costPerResult.current).toBe(50);
    expect(r.href).toBe("/campanhas/google_ads/1");
  });

  it("sem linhas no período importado = zero real, sinalizado", () => {
    const r = buildCampaignRow({ agg: agg({ current: null }), panel, filters });
    expect(r.cost.current).toBe(0);
    expect(r.flags).toContain("Sem veiculação no período");
  });

  it("investimento sem resultados é sinalizado; Meta sem objetivo mapeado também", () => {
    const r = buildCampaignRow({ agg: agg({ current: t({ cost: 50, impressions: 100 }) }), panel, filters });
    expect(r.flags).toContain("Investimento sem resultados");
    const m = buildCampaignRow({ agg: agg({ platform: "meta_ads", objective: "OUTCOME_TRAFFIC" }), panel, filters });
    expect(m.results.current).toBeNull();
    expect(m.flags).toContain("Resultado não definido para o objetivo");
  });

  it("campanha com mais de uma moeda: sem comparação", () => {
    const r = buildCampaignRow({ agg: agg({ currencies: ["BRL", "USD"] }), panel, filters });
    expect(r.currency).toBeNull();
    expect(r.cost.deltaPct).toBeNull();
  });
});

describe("filterSortPaginate", () => {
  const panel = buildPanel({ facts: facts(), filters, campaigns: [], now: NOW });
  const rows = [
    buildCampaignRow({ agg: agg({ campaignId: "a", name: "A", current: t({ cost: 10 }) }), panel, filters }),
    buildCampaignRow({ agg: agg({ campaignId: "b", name: "B", status: "PAUSED" }), panel, filters }),
    buildCampaignRow({ agg: agg({ platform: "meta_ads", campaignId: "c", name: "C", status: null, objective: "OUTCOME_LEADS" }), panel, filters }),
  ];

  it("ordena por investimento e filtra status avisando quem ficou de fora", () => {
    expect(filterSortPaginate(rows, filters).rows.map((r) => r.campaignId)).toEqual(["b", "c", "a"]);
    const f = filterSortPaginate(rows, { ...filters, status: "PAUSED" });
    expect(f.rows.map((r) => r.campaignId)).toEqual(["b"]);
    expect(f.statusFilterExcludes).toMatch(/1 campanha/);
  });

  it("null vai para o fim em qualquer ordenação", () => {
    const sorted = filterSortPaginate(rows, { ...filters, sort: "cost_per_result" }).rows;
    expect(sorted.at(-1)!.costPerResult.current).toBeNull();
  });

  it("opções de status só com o que existe nos dados", () => {
    expect(statusOptions([agg(), agg({ status: "PAUSED" }), agg({ status: null })])).toEqual([
      { value: "ENABLED", label: "Ativa" },
      { value: "PAUSED", label: "Pausada" },
    ]);
  });
});

describe("buildEntityLevel", () => {
  const panel = buildPanel({ facts: facts(), filters, campaigns: [agg()], now: NOW });
  const span = { detailFirst: "2026-04-20", detailLast: "2026-10-21", campaignFirst: "2026-04-20", campaignLast: "2026-10-21" };
  const base = {
    platform: "google_ads" as const,
    level: "ad_group" as const,
    tableReady: true,
    span,
    channelType: "SEARCH",
    def: null,
    parent: t({ cost: 300 }),
    currency: "BRL",
    parentComparable: true,
    coverage: panel.coverage,
    filters,
    rows: [
      { id: "g1", name: "Grupo 1", status: "ENABLED", type: "SEARCH_STANDARD", current: t({ cost: 200 }), previous: t({ cost: 100 }) },
      { id: "g2", name: "Grupo 2", status: "PAUSED", type: null, current: null, previous: t({ cost: 50 }) },
    ],
    hrefFor: (id: string) => `/x/${id}`,
  };

  it("migração pendente, Performance Max e detalhe não importado são estados explícitos", () => {
    expect(buildEntityLevel({ ...base, tableReady: false }).availability.state).toBe("migration_pending");
    expect(buildEntityLevel({ ...base, channelType: "PERFORMANCE_MAX" }).availability.state).toBe("unsupported");
    expect(buildEntityLevel({ ...base, span: { ...span, detailFirst: null, detailLast: null } }).availability.state).toBe("not_imported");
  });

  it("preserva o rótulo do provedor", () => {
    expect(buildEntityLevel(base).title).toBe("Grupos de anúncios");
    expect(buildEntityLevel({ ...base, platform: "meta_ads" }).title).toBe("Conjuntos de anúncios");
  });

  it("fatia do investimento, zero real e conciliação com a campanha", () => {
    const v = buildEntityLevel(base);
    expect(v.rows.map((r) => r.id)).toEqual(["g1", "g2"]);
    expect(v.rows[0]!.costShare).toBeCloseTo(2 / 3);
    expect(v.rows[1]!.cost.current).toBe(0);
    expect(v.reconciliation).toEqual({ childCost: 200, parentCost: 300, currency: "BRL" });
    expect(v.comparable).toBe(true);
  });

  it("detalhe importado depois da campanha → sem comparação e com aviso", () => {
    const late = { ...span, detailFirst: "2026-10-01" };
    expect(detailCovers(late, filters.current)).toBe(false);
    const v = buildEntityLevel({ ...base, span: late });
    expect(v.comparable).toBe(false);
    expect(v.notes.join(" ")).toMatch(/parte do período não está detalhada/);
    expect(v.rows[1]!.cost.current).toBeNull(); // sem detalhe ≠ zero
  });
});
