import { describe, expect, it } from "vitest";

import type { CampaignDiagnostic } from "@/lib/campaign-diagnostics";
import type { SourceStatus } from "@/lib/insight";
import { buildPanel, type CampaignAggregate, type DetailSpan, type PlatformFacts } from "@/server/campaigns/compose";
import { diagnose, weighSeverity, type DetailNode, type PlatformDiagnosticInput } from "@/server/campaigns/diagnostics/engine";
import { costPerCountZ, poissonDiffZ, twoProportionZ } from "@/server/campaigns/diagnostics/stats";
import { EMPTY_TOTALS, type Totals } from "@/server/campaigns/metrics";
import { parseFilters } from "@/server/campaigns/period";

const NOW = new Date("2026-10-21T15:00:00Z");
const TODAY = "2026-10-21";
const filters = parseFilters({}, TODAY).filters; // 23/09–20/10 × 26/08–22/09
const noCompare = parseFilters({ comparar: "nao" }, TODAY).filters;

const t = (over: Partial<Totals> = {}): Totals => ({ ...EMPTY_TOTALS, ...over });

const source = (over: Partial<SourceStatus> = {}): SourceStatus => ({
  key: "google_ads",
  label: "Google Ads",
  health: "synced",
  summary: "Dados de 20/04/2026 a 21/10/2026.",
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
  lastRun: null,
  lastSyncedAt: NOW,
  restatementDays: 0,
  accountToday: TODAY,
  ...over,
});

let seq = 0;
const camp = (over: Partial<CampaignAggregate> = {}): CampaignAggregate => ({
  platform: "google_ads",
  campaignId: String(++seq),
  name: `Campanha ${seq}`,
  status: "ENABLED",
  objective: null,
  channelType: "SEARCH",
  currencies: ["BRL"],
  hasNullCurrency: false,
  current: t({ cost: 1000, impressions: 20_000, clicks: 400, conversions: 20 }),
  previous: t({ cost: 1000, impressions: 20_000, clicks: 400, conversions: 20 }),
  ...over,
});

const span = (first: string | null = "2026-04-20", last: string | null = "2026-10-21"): DetailSpan => ({
  detailFirst: first,
  detailLast: last,
  campaignFirst: "2026-04-20",
  campaignLast: "2026-10-21",
});

function input(
  campaigns: CampaignAggregate[],
  opts: { facts?: Partial<PlatformFacts>; nodes?: DetailNode[]; ready?: boolean; f?: typeof filters; groupSpan?: DetailSpan } = {},
): { filters: typeof filters; platforms: PlatformDiagnosticInput[] } {
  const f = opts.f ?? filters;
  const fa = facts(opts.facts);
  return {
    filters: f,
    platforms: [
      {
        facts: fa,
        panel: buildPanel({ facts: fa, filters: f, campaigns, now: NOW }),
        campaigns,
        detail: {
          ready: opts.ready ?? true,
          groupSpan: opts.groupSpan ?? span(),
          adSpan: span(),
          nodes: opts.nodes ?? [],
        },
      },
    ],
  };
}

const run = (...args: Parameters<typeof input>) => diagnose(input(...args));
const signals = (ds: CampaignDiagnostic[]) => ds.filter((d) => d.kind !== "limitation");
const ofType = (ds: CampaignDiagnostic[], type: CampaignDiagnostic["type"]) => ds.filter((d) => d.type === type);
const limits = (ds: CampaignDiagnostic[]) => ds.filter((d) => d.kind === "limitation").map((d) => d.limitationReason);

describe("estatística", () => {
  it("z de proporções, de razão custo/contagem e de Poisson; sem base → null", () => {
    expect(twoProportionZ(100, 1000, 50, 1000)!).toBeGreaterThan(3);
    expect(costPerCountZ(200, 50, 100, 50)!).toBeGreaterThan(3);
    expect(poissonDiffZ(40, 10)!).toBeCloseTo(30 / Math.sqrt(50));
    expect(twoProportionZ(1, 0, 1, 10)).toBeNull();
    expect(costPerCountZ(100, 0, 100, 10)).toBeNull();
    expect(poissonDiffZ(0, 0)).toBeNull();
  });

  it("peso financeiro sobe/desce um nível de severidade", () => {
    expect(weighSeverity("medium", 0.3)).toBe("high");
    expect(weighSeverity("medium", 0.01)).toBe("low");
    expect(weighSeverity("high", 0.5)).toBe("high");
    expect(weighSeverity("info", 0.9)).toBe("info");
  });
});

describe("A — investimento sem resultados", () => {
  it("acusa com base no custo por resultado de referência da plataforma", () => {
    // referência: 2000 / 20 = 100 por conversão → 800 investidos ≈ 8 esperados
    const ds = run([camp({ current: t({ cost: 2000, impressions: 40_000, clicks: 800, conversions: 20 }) }), camp({ name: "Sem conversão", current: t({ cost: 800, impressions: 10_000, clicks: 200 }) })]);
    const [a] = ofType(ds, "cost_without_results");
    expect(a).toMatchObject({ kind: "finding", level: "campaign", confidence: "high", entity: { campaignName: "Sem conversão" } });
    expect(a!.facts.find((f) => f.label.startsWith("Resultados esperados"))!.value).toBeCloseTo(8);
    expect(a!.description).toMatch(/chance de < 0,1%/);
    expect(a!.title).toMatch(/sem conversões reportadas/);
  });

  it("uma campanha que concentra o gasto sem resultados não infla a própria referência", () => {
    // irmã: 1000 / 10 = 100 por conversão; a dominante gastou 9000 sem nenhuma
    const ds = run([camp({ current: t({ cost: 1000, conversions: 10 }) }), camp({ name: "Dominante", current: t({ cost: 9000 }) })]);
    const [a] = ofType(ds, "cost_without_results");
    expect(a).toMatchObject({ entity: { campaignName: "Dominante" }, severity: "high" });
    expect(a!.facts[0]!.value).toBe(100);
  });

  it("pouco investimento: nada (λ<2) ou inconclusivo (2≤λ<3)", () => {
    const ref = camp({ current: t({ cost: 1000, conversions: 10, impressions: 1, clicks: 1 }) });
    expect(ofType(run([ref, camp({ current: t({ cost: 150 }) })]), "cost_without_results")).toHaveLength(0);
    const [inc] = ofType(run([ref, camp({ current: t({ cost: 250 }) })]), "cost_without_results");
    expect(inc).toMatchObject({ kind: "inconclusive", confidence: "low", limitationReason: "low_volume" });
  });

  it("conta inteira sem resultados → UM aviso inconclusivo (provável rastreamento), não um por campanha", () => {
    const ds = run([camp({ current: t({ cost: 500 }) }), camp({ current: t({ cost: 700 }) })]);
    const a = ofType(ds, "cost_without_results");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ level: "platform", kind: "inconclusive", severity: "high", confidence: "low", limitationReason: "no_results_anywhere" });
  });

  it("período pouco importado (< 80% dos dias fechados) → não acusa, explica", () => {
    const ds = run([camp(), camp({ current: t({ cost: 900 }) })], { facts: { runs: [{ periodStart: "2026-04-20", periodEnd: "2026-10-10" }] } });
    expect(ofType(ds, "cost_without_results")).toHaveLength(0);
    expect(limits(ds)).toContain("stale_data");
  });

  it("dias ainda reprocessáveis reduzem a confiança e são ditos", () => {
    const ds = run([camp(), camp({ current: t({ cost: 1000 }) })], { facts: { restatementDays: 14 } });
    const [a] = ofType(ds, "cost_without_results");
    expect(a!.confidence).toBe("medium");
    expect(a!.description).toMatch(/reprocessar/);
    expect(limits(ds)).toContain("recent_data_unsettled");
  });
});

describe("definições de resultado Google × Meta", () => {
  const metaFacts = { platform: "meta_ads" as const, source: source({ key: "meta_ads", label: "Meta Ads" }) };

  it("Meta de cadastro conta só leads (compras não viram resultado)", () => {
    const ds = run(
      [
        camp({ platform: "meta_ads", objective: "OUTCOME_LEADS", current: t({ cost: 1000, impressions: 1, clicks: 1, actions: { lead: 20 } }) }),
        camp({ platform: "meta_ads", objective: "OUTCOME_LEADS", name: "Só compras", current: t({ cost: 600, impressions: 1, clicks: 1, actions: { purchase: 9 } }) }),
      ],
      { facts: metaFacts },
    );
    const [a] = ofType(ds, "cost_without_results");
    expect(a).toMatchObject({ platform: "meta_ads", entity: { campaignName: "Só compras" } });
    expect(a!.title).toMatch(/leads reportados/);
  });

  it("objetivo sem resultado definido não gera regra de resultado — gera limitação", () => {
    const ds = run([camp({ platform: "meta_ads", objective: "OUTCOME_TRAFFIC", current: t({ cost: 900 }) })], { facts: metaFacts });
    expect(ofType(ds, "cost_without_results")).toHaveLength(0);
    expect(limits(ds)).toContain("result_undefined");
  });

  it("objetivo que mudou no intervalo suspende as comparações", () => {
    const ds = run(
      [camp({ platform: "meta_ads", objective: "OUTCOME_LEADS", objectives: ["OUTCOME_LEADS", "OUTCOME_SALES"], current: t({ cost: 1000, actions: { lead: 10 } }), previous: t({ cost: 1000, actions: { lead: 40 } }) })],
      { facts: metaFacts },
    );
    expect(ofType(ds, "results_drop")).toHaveLength(0);
    expect(limits(ds)).toContain("result_definition_changed");
  });
});

describe("B — custo por resultado", () => {
  it("alta com volume → achado; a variação % nunca parte de base zero", () => {
    const ds = run([camp({ current: t({ cost: 2000, conversions: 40, impressions: 1, clicks: 1 }), previous: t({ cost: 1000, conversions: 40, impressions: 1, clicks: 1 }) })]);
    const [b] = ofType(ds, "cost_per_result_increase");
    expect(b).toMatchObject({ kind: "finding", confidence: "high" });
    expect(b!.evidence.find((e) => e.key === "cost_per_result")!.deltaPct).toBeCloseTo(1);

    const zeroBase = run([camp({ current: t({ cost: 1000, conversions: 10 }), previous: t({ cost: 1000 }) })]);
    expect(ofType(zeroBase, "cost_per_result_increase")).toHaveLength(0);
  });

  it("poucos resultados → inconclusivo, não afirmação", () => {
    const [b] = ofType(run([camp({ current: t({ cost: 1500, conversions: 5, impressions: 1, clicks: 1 }), previous: t({ cost: 1000, conversions: 6, impressions: 1, clicks: 1 }) })]), "cost_per_result_increase");
    expect(b).toMatchObject({ kind: "inconclusive", confidence: "low" });
  });

  it("melhora também é reportada (informativo), sem virar alerta", () => {
    const [m] = ofType(run([camp({ current: t({ cost: 1000, conversions: 60, impressions: 1, clicks: 1 }), previous: t({ cost: 1000, conversions: 30, impressions: 1, clicks: 1 }) })]), "cost_per_result_improvement");
    expect(m).toMatchObject({ kind: "finding", severity: "info" });
  });
});

describe("C/D — CTR e CPC", () => {
  it("queda de CTR significativa", () => {
    const [c] = ofType(run([camp({ current: t({ cost: 1000, impressions: 50_000, clicks: 500 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000 }) })]), "ctr_drop");
    expect(c).toMatchObject({ kind: "finding", confidence: "high" });
  });

  it("baixo volume: sem alerta e com limitação de volume", () => {
    const ds = run([camp({ current: t({ cost: 50, impressions: 300, clicks: 3, conversions: 1 }), previous: t({ cost: 50, impressions: 300, clicks: 9, conversions: 2 }) })]);
    expect(signals(ds)).toHaveLength(0);
    expect(limits(ds)).toContain("low_volume");
  });

  it("CPC subiu; Meta fala em CPC de link", () => {
    const g = ofType(run([camp({ current: t({ cost: 3000, clicks: 1000, impressions: 1 }), previous: t({ cost: 2000, clicks: 1000, impressions: 1 }) })]), "cpc_increase");
    expect(g[0]).toMatchObject({ kind: "finding", title: "CPC subiu 50%" });
    const m = ofType(
      run([camp({ platform: "meta_ads", objective: "OUTCOME_TRAFFIC", current: t({ cost: 3000, clicks: 1000, impressions: 1 }), previous: t({ cost: 2000, clicks: 1000, impressions: 1 }) })], {
        facts: { platform: "meta_ads", source: source({ key: "meta_ads" }) },
      }),
      "cpc_increase",
    );
    expect(m[0]!.title).toBe("CPC de link subiu 50%");
  });
});

describe("CTR × CPC com a mesma causa", () => {
  it("CPM estável: a alta do CPC entra no alerta de CTR, sem outro alerta", () => {
    const ds = run([camp({ current: t({ cost: 1000, impressions: 50_000, clicks: 300 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000 }) })]);
    expect(ofType(ds, "cpc_increase")).toHaveLength(0);
    const [c] = ofType(ds, "ctr_drop");
    expect(c!.description).toMatch(/consequência da queda do CTR/);
    expect(c!.evidence.some((e) => e.key === "cpc")).toBe(true);
  });

  it("CPM também subiu: são dois sinais distintos (leilão mais caro + CTR menor)", () => {
    const ds = run([camp({ current: t({ cost: 2000, impressions: 50_000, clicks: 500 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000 }) })]);
    expect(ofType(ds, "cpc_increase")).toHaveLength(1);
    expect(ofType(ds, "ctr_drop")).toHaveLength(1);
  });
});

describe("E — resultados caíram", () => {
  it("queda com custo por resultado estável = acompanha o investimento (severidade baixa)", () => {
    const [e] = ofType(run([camp({ current: t({ cost: 500, conversions: 20, impressions: 1, clicks: 1 }), previous: t({ cost: 1000, conversions: 40, impressions: 1, clicks: 1 }) })]), "results_drop");
    expect(e).toMatchObject({ severity: "low", title: "Conversões caíram 50%, junto com o investimento" });
  });

  it("queda com piora de eficiência absorve o alerta de custo por resultado (sem duplicar)", () => {
    const ds = run([camp({ current: t({ cost: 1000, conversions: 15, impressions: 1, clicks: 1 }), previous: t({ cost: 1000, conversions: 40, impressions: 1, clicks: 1 }) })]);
    expect(ofType(ds, "results_drop")).toHaveLength(1);
    expect(ofType(ds, "cost_per_result_increase")).toHaveLength(0);
    expect(ofType(ds, "results_drop")[0]!.evidence.some((e) => e.key === "cost_per_result")).toBe(true);
  });

  it("zero resultados agora com referência → só 'sem resultados', não também 'caíram'", () => {
    const ds = run([camp({ current: t({ cost: 2000, conversions: 20 }) }), camp({ current: t({ cost: 800 }), previous: t({ cost: 800, conversions: 15 }) })]);
    const second = signals(ds).filter((d) => d.entity.campaignId === String(seq));
    expect(second.map((d) => d.type)).toEqual(["cost_without_results"]);
  });
});

describe("G — dados insuficientes", () => {
  it("período anterior não importado → nada de B–E, e o motivo é dito", () => {
    const ds = run([camp({ current: t({ cost: 1000, conversions: 5 }), previous: t({ cost: 1000, conversions: 40 }) })], {
      facts: { runs: [{ periodStart: "2026-09-20", periodEnd: "2026-10-21" }] },
    });
    expect(signals(ds).filter((d) => d.type !== "cost_without_results")).toHaveLength(0);
    expect(limits(ds)).toContain("comparison_unavailable");
  });

  it("comparação desligada", () => {
    expect(limits(run([camp()], { f: noCompare }))).toContain("comparison_off");
  });

  it("fonte não conectada ou com falha", () => {
    expect(limits(run([], { facts: { source: source({ health: "not_connected" }), account: null, runs: [] } }))).toEqual(["source_unavailable"]);
    expect(limits(run([camp()], { facts: { source: source({ health: "needs_reauth", summary: "O acesso expirou ou foi revogado." }) } }))).toContain("source_unavailable");
  });

  it("moedas diferentes: fora da comparação e dos pesos, com limitação", () => {
    const ds = run([camp({ currencies: ["BRL", "USD"], current: t({ cost: 1000, conversions: 5 }), previous: t({ cost: 1000, conversions: 40 }) }), camp({ currencies: ["USD"] })]);
    expect(ofType(ds, "results_drop")).toHaveLength(0);
    expect(limits(ds)).toContain("currency_mixed");
  });

  it("detalhe indisponível sem a migração", () => {
    expect(limits(run([camp()], { ready: false }))).toContain("detail_unavailable");
  });
});

describe("hierarquia campanha → grupo → anúncio", () => {
  const node = (over: Partial<DetailNode>): DetailNode => ({
    level: "ad_group",
    campaignId: "c1",
    adGroupId: "g1",
    adGroupName: "Grupo 1",
    adId: "",
    name: "Grupo 1",
    status: "ENABLED",
    current: t(),
    previous: t(),
    ...over,
  });

  it("o mesmo sinal no grupo vira 'também aparece em' da campanha", () => {
    const drop = { current: t({ cost: 1000, impressions: 50_000, clicks: 500 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000 }) };
    const ds = run([camp({ campaignId: "c1", ...drop })], { nodes: [node(drop)] });
    const ctr = ofType(ds, "ctr_drop");
    expect(ctr).toHaveLength(1);
    expect(ctr[0]!.level).toBe("campaign");
    expect(ctr[0]!.related.map((r) => r.name)).toEqual(["Grupo 1"]);
  });

  it("sinal só no grupo (a campanha compensou) fica no grupo — ali está o problema", () => {
    const ds = run(
      [camp({ campaignId: "c1", current: t({ cost: 2000, impressions: 100_000, clicks: 2000 }), previous: t({ cost: 2000, impressions: 100_000, clicks: 2000 }) })],
      {
        nodes: [
          node({ adGroupId: "g1", name: "Caiu", current: t({ cost: 1000, impressions: 50_000, clicks: 500 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000 }) }),
          node({ adGroupId: "g2", name: "Subiu", current: t({ cost: 1000, impressions: 50_000, clicks: 1500 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000 }) }),
        ],
      },
    );
    const [c] = ofType(ds, "ctr_drop");
    expect(c).toMatchObject({ level: "ad_group", entity: { adGroupName: "Caiu" } });
    expect(c!.levelLabel).toBe("Grupo de anúncios");
    expect(c!.entity.href).toBe("/campanhas/google_ads/c1/g1");
  });

  it("grupo sem resultados dentro de campanha que converte; seus anúncios não repetem o alerta", () => {
    const ds = run([camp({ campaignId: "c1", current: t({ cost: 2000, conversions: 20 }) })], {
      nodes: [
        node({ adGroupId: "g1", name: "Converte", current: t({ cost: 1000, conversions: 20 }) }),
        node({ adGroupId: "g2", name: "Zero", current: t({ cost: 1000 }) }),
        node({ level: "ad", adGroupId: "g2", adId: "a1", name: "Anúncio A", current: t({ cost: 1000 }) }),
      ],
    });
    const a = ofType(ds, "cost_without_results");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ level: "ad_group", entity: { adGroupName: "Zero" } });
  });

  it("detalhe que não cobre o período anterior não compara no grupo", () => {
    const drop = { current: t({ cost: 1000, impressions: 50_000, clicks: 500 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000 }) };
    const ds = run([camp({ campaignId: "c1", current: t({ cost: 2000, impressions: 100_000, clicks: 2000 }), previous: t({ cost: 2000, impressions: 100_000, clicks: 2000 }) })], {
      nodes: [node(drop)],
      groupSpan: span("2026-10-01"),
    });
    expect(ofType(ds, "ctr_drop")).toHaveLength(0);
    expect(limits(ds)).toContain("detail_unavailable");
  });
});

describe("F — distribuição", () => {
  it("fatia relevante em campanhas sem resultados e concentração (informativa)", () => {
    const ds = run([
      camp({ current: t({ cost: 6000, conversions: 60 }) }),
      camp({ current: t({ cost: 1200 }) }),
      camp({ current: t({ cost: 1000 }) }),
    ]);
    const [share] = ofType(ds, "spend_without_results_share");
    expect(share!.related).toHaveLength(2);
    const [conc] = ofType(ds, "spend_concentration");
    expect(conc).toMatchObject({ severity: "info", level: "platform" });
    expect(conc!.description).toMatch(/não indica, sozinho/);
  });
});

describe("qualidade da saída", () => {
  const scenario = () =>
    run([
      camp({ campaignId: "x1", name: "X1", current: t({ cost: 2000, impressions: 50_000, clicks: 500, conversions: 10 }), previous: t({ cost: 1000, impressions: 50_000, clicks: 1000, conversions: 40 }) }),
      camp({ campaignId: "x2", name: "X2", current: t({ cost: 800 }), previous: t({ cost: 800, conversions: 8 }) }),
    ]);

  it("determinístico, ids estáveis e únicos", () => {
    const a = scenario();
    const b = scenario();
    expect(a).toEqual(b);
    expect(new Set(a.map((d) => d.id)).size).toBe(a.length);
    expect(a.find((d) => d.type === "ctr_drop")!.id).toBe("ctr_drop:google_ads:campaign:x1");
  });

  it("sem contradição: nenhuma unidade tem melhora e piora do custo por resultado", () => {
    const ds = scenario();
    const units = new Map<string, Set<string>>();
    for (const d of signals(ds)) units.set(d.id.split(":").slice(1).join(":"), new Set([...(units.get(d.id.split(":").slice(1).join(":")) ?? []), d.type]));
    for (const types of units.values()) {
      expect(types.has("cost_per_result_increase") && types.has("cost_per_result_improvement")).toBe(false);
    }
  });

  it("todo diagnóstico tem evidência ou fatos, período e próxima verificação", () => {
    for (const d of scenario()) {
      expect(d.nextCheck.length).toBeGreaterThan(10);
      expect(d.period.current).toEqual(filters.current);
      if (d.kind !== "limitation") expect(d.evidence.length + d.facts.length).toBeGreaterThan(0);
    }
  });

  it("prioridade: alta severidade com alta confiança vem antes", () => {
    const ds = signals(scenario());
    for (let i = 1; i < ds.length; i++) expect(ds[i - 1]!.priority).toBeGreaterThanOrEqual(ds[i]!.priority);
  });
});
