/**
 * Cross-source com mídia paga (Google Ads e Meta Ads).
 *
 * Os contextos de Ads vêm dos compositores REAIS (`composeAdsContext` /
 * `composeMetaAdsContext`, via `cross-source-fixtures.ts`) — nunca objetos escritos à
 * mão. Nenhum teste toca banco ou rede.
 *
 * O que estes testes travam:
 *  1. a mídia paga é OPCIONAL: sem linhas, nenhum insight a menciona e os das fontes de
 *     base são idênticos ao que sempre foram;
 *  2. com linhas, cada plataforma aparece com os próprios números, moeda e definição —
 *     nunca somados nem comparados entre plataformas;
 *  3. "no mesmo período" só vale quando a plataforma cobre o período solicitado;
 *  4. nenhuma razão sai 0/NaN: denominador 0 vira `null`;
 *  5. determinismo, pureza e serialização em JSON puro (é o que vai para o banco).
 */
import { describe, expect, it, vi } from "vitest";

import {
  buildCrossSourceInsights,
  canonicalJson,
  contentHash,
  fromStoredRows,
  toStoredRows,
  type CrossSourceInsight,
} from "@/server/analysis/cross-source";

import {
  codes,
  deepFreeze,
  evidence,
  expectNoUnnegatedCausality,
  expectStructurallyValid,
  find,
  get,
  textOf,
} from "./cross-source-asserts";
import {
  OCT,
  deal,
  makeGoogleAds,
  makeMetaAds,
  makeRdCrm,
  makeRdMarketing,
  octoberCrmRows,
  periodContext,
} from "./cross-source-fixtures";

vi.mock("@/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`Cross-source acessou o banco (db.${String(prop)})`);
      },
    },
  ),
}));

const OCT_ROWS = [
  { date: "2026-10-01", sessions: 120 },
  { date: "2026-10-02", sessions: 130 },
  { date: "2026-10-03", sessions: 117 },
  { date: "2026-10-04", sessions: 120 },
];

const rd = () =>
  makeRdMarketing([{ assetId: "a1", assetIdentifier: "lp-exemplo", visits: 6, conversions: 0 }], {
    window: OCT,
    days: 4,
  });
const crm = () => makeRdCrm(octoberCrmRows(), OCT, "2026-04-07");

const googleAds = (over: Parameters<typeof makeGoogleAds>[1] = {}) =>
  makeGoogleAds(
    [
      { campaignId: "g1", campaignName: "Search institucional", impressions: 8000, clicks: 400, cost: 300, conversions: 12 },
      { campaignId: "g2", campaignName: "Search servidores", impressions: 2000, clicks: 100, cost: 100, conversions: 3.5 },
    ],
    { window: OCT, days: 4, ...over },
  );

const metaAds = (over: Parameters<typeof makeMetaAds>[1] = {}) =>
  makeMetaAds(
    [{ campaignId: "m1", campaignName: "Leads — servidores", impressions: 30000, clicks: 450, cost: 250, conversions: 9 }],
    { window: OCT, days: 4, ...over },
  );

function build(
  over: Partial<Parameters<typeof periodContext>[0]> = {},
): CrossSourceInsight[] {
  return buildCrossSourceInsights(
    periodContext({
      period: OCT,
      ga4Rows: OCT_ROWS,
      rdMarketing: rd(),
      rdCrm: crm(),
      ...over,
    }),
  );
}

/** Texto sem espaços não separáveis (o Intl de moeda os usa entre o símbolo e o número). */
const flat = (s: string) => s.replace(/ /g, " ");

describe("mídia paga ausente — nada muda", () => {
  it("sem linhas de Ads, nenhum insight a menciona e os tipos de mídia paga não existem", () => {
    const out = build();
    expectStructurallyValid(out);
    expect(find(out, "paid-media-activity")).toBeUndefined();
    expect(find(out, "paid-media-vs-traffic")).toBeUndefined();
    for (const i of out) {
      expect(i.sources).not.toContain("google_ads");
      expect(i.sources).not.toContain("meta_ads");
      expect(JSON.stringify(i)).not.toMatch(/Google Ads|Meta Ads/);
    }
  });

  it("os insights das fontes de base são IDÊNTICOS com e sem mídia paga desalinhada", () => {
    const base = build();
    // Ads só no 1º dia: a plataforma tem dado, mas não cobre o período inteiro
    const withAds = build({ ads: googleAds({ days: 1 }), metaAds: metaAds({ days: 2 }) });
    for (const type of [
      "acquisition-coverage",
      "traffic-and-rd-conversions",
      "commercial-activity",
      "attribution-quality",
      "partial-period",
      "period-mismatch",
      "metric-not-computable",
      "source-unavailable",
    ] as const) {
      expect(find(withAds, type), type).toEqual(find(base, type));
    }
  });
});

describe("Google Ads presente e alinhado", () => {
  const out = build({ ads: googleAds(), ga4Channels: { "Paid Search": 80, "Organic Search": 487 - 80 } });
  const activity = get(out, "paid-media-activity");

  it("é estruturalmente válido, sem causalidade e na categoria de aquisição", () => {
    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
    expect(activity.category).toBe("acquisition");
    expect(activity.sources).toEqual(["google_ads"]);
  });

  it("traz os números da PRÓPRIA plataforma, na moeda da conta", () => {
    expect(evidence(activity, "google_ads.cost")).toMatchObject({ value: 400, format: "currency", currency: "BRL" });
    expect(evidence(activity, "google_ads.impressions")?.value).toBe(10000);
    expect(evidence(activity, "google_ads.clicks")?.value).toBe(500);
    expect(evidence(activity, "google_ads.ctr")).toMatchObject({ value: 0.05, format: "rate" });
    expect(evidence(activity, "google_ads.cpc")).toMatchObject({ value: 0.8, format: "currency", currency: "BRL" });
    expect(evidence(activity, "google_ads.conversions")?.value).toBe(15.5);
    expect(evidence(activity, "google_ads.cost_per_conversion")?.value).toBeCloseTo(400 / 15.5, 4);
    const text = flat(textOf(activity, "fact").join(" "));
    expect(text).toContain("investimento de R$ 400,00 em 2 campanhas");
    expect(text).toContain("10.000 impressões e 500 cliques");
    expect(text).toContain("CTR de 5,0%");
  });

  it("conversão fracionária carrega a nota de arredondamento", () => {
    expect(evidence(activity, "google_ads.conversions")?.note).toMatch(/fracionário/);
  });

  it("as conversões são da plataforma e NÃO são somadas nem comparadas com outras fontes", () => {
    expect(codes(activity)).toContain("paid_media_conversions_definition");
    const limit = flat(textOf(activity, "limitation").join(" "));
    expect(limit).toMatch(/não são comparáveis com os key events do GA4/);
  });

  it("GA4 × cliques ficam lado a lado, sem razão", () => {
    const vs = get(out, "paid-media-vs-traffic");
    expect(vs.category).toBe("relationship");
    expect(vs.sources).toEqual(["ga4", "google_ads"]);
    expect(evidence(vs, "ga4.sessions_paid_search")?.value).toBe(80);
    expect(evidence(vs, "google_ads.clicks")?.value).toBe(500);
    expect(textOf(vs, "observable_relationship")[0]).toMatch(
      /500 cliques e o GA4 registrou 80 sessões no canal Paid Search — dois sinais de fontes diferentes/,
    );
    expect(codes(vs)).toEqual(
      expect.arrayContaining(["google_ads_clicks_vs_sessions", "paid_media_no_joint_rate"]),
    );
    // nenhuma razão sessões/cliques foi inventada
    expect(vs.evidence.every((e) => e.format !== "rate")).toBe(true);
  });

  it("canal ausente no GA4 é 0 sessões REGISTRADAS (o GA4 tem dados), nunca ausência do GA4", () => {
    const noPaid = build({ ads: googleAds() });
    const vs = get(noPaid, "paid-media-vs-traffic");
    expect(evidence(vs, "ga4.sessions_paid_search")?.value).toBe(0);
  });

  it("aparece na cobertura de dados com os dias da plataforma", () => {
    const coverage = get(out, "data-coverage");
    expect(evidence(coverage, "google_ads.days_with_data")?.value).toBe(4);
    expect(textOf(coverage, "fact").join(" ")).toMatch(/Google Ads: registros em 4 de 4 dias do período/);
    // a frase de equivalência continua sendo só das fontes de base
    expect(textOf(coverage, "observable_relationship").join(" ")).not.toMatch(/Google Ads/);
  });

  it("o investimento entra ao lado do CRM, sem atribuir negócio a campanha", () => {
    const rel = get(out, "commercial-vs-acquisition");
    expect(evidence(rel, "google_ads.cost")?.value).toBe(400);
    expect(textOf(rel, "fact").map(flat).join(" ")).toMatch(/Google Ads registrou investimento de R\$ 400,00/);
    expect(textOf(rel, "observable_relationship").join(" ")).toMatch(/a mídia paga \(Google Ads\) registrou investimento/);
    const pop = get(out, "population-not-comparable");
    expect(codes(pop)).toEqual(
      expect.arrayContaining(["not_computed:ads_clicks_to_sessions_rate", "not_computed:ads_to_deals_attribution"]),
    );
    expect(codes(pop)).not.toContain("not_computed:ads_conversions_across_platforms");
  });
});

describe("Meta Ads presente e alinhado", () => {
  const out = build({ metaAds: metaAds(), ga4Channels: { "Paid Social": 60, "Organic Search": 427 } });
  const activity = get(out, "paid-media-activity");

  it("é válido e usa cliques NO LINK, com o escopo da Meta dito", () => {
    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
    expect(activity.sources).toEqual(["meta_ads"]);
    expect(evidence(activity, "meta_ads.clicks")?.label).toBe("Cliques no link (Meta Ads)");
    expect(textOf(activity, "fact").join(" ")).toMatch(/450 cliques no link/);
    expect(codes(activity)).toEqual(
      expect.arrayContaining(["paid_media_conversions_definition", "meta_ads_metrics_scope"]),
    );
    expect(textOf(activity, "limitation").join(" ")).toMatch(/alcance e frequência não entram nos totais/);
  });

  it("cruza com o canal Paid Social do GA4", () => {
    const vs = get(out, "paid-media-vs-traffic");
    expect(vs.sources).toEqual(["ga4", "meta_ads"]);
    expect(evidence(vs, "ga4.sessions_paid_social")?.value).toBe(60);
    expect(codes(vs)).toContain("meta_ads_clicks_vs_sessions");
  });
});

describe("Google Ads e Meta Ads juntos", () => {
  it("mesma moeda: investimento lado a lado (sem soma) e conversões declaradas não somáveis", () => {
    const out = build({ ads: googleAds(), metaAds: metaAds() });
    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
    const activity = get(out, "paid-media-activity");
    expect(activity.sources).toEqual(["google_ads", "meta_ads"]);
    const relation = flat(textOf(activity, "observable_relationship").join(" "));
    expect(relation).toMatch(/investimento foi de R\$ 400,00 no Google Ads e de R\$ 250,00 no Meta Ads \(mesma moeda\)/);
    // nenhum ponto de evidência de "total" (a soma não foi feita)
    expect(activity.evidence.some((e) => e.id.includes("total"))).toBe(false);
    expect(activity.evidence.some((e) => e.value === 650)).toBe(false);
    expect(codes(activity)).toContain("paid_media_conversions_definition");
    expect(textOf(activity, "limitation").join(" ")).toMatch(/não foram somadas entre as plataformas/);

    const pop = get(out, "population-not-comparable");
    expect(codes(pop)).toContain("not_computed:ads_conversions_across_platforms");
  });

  it("moedas diferentes: sem relação e com a limitação de câmbio", () => {
    const out = build({ ads: googleAds(), metaAds: metaAds({ currency: "USD" }) });
    const activity = get(out, "paid-media-activity");
    expect(textOf(activity, "observable_relationship")).toEqual([]);
    expect(codes(activity)).toContain("paid_media_currency_differs");
    expect(textOf(activity, "limitation").join(" ")).toMatch(/não há conversão cambial e os valores não foram somados/);
  });

  it("moeda não informada: nunca se assume BRL", () => {
    const out = build({ metaAds: metaAds({ currency: null }) });
    const activity = get(out, "paid-media-activity");
    expect(evidence(activity, "meta_ads.cost")?.currency).toBeNull();
    expect(codes(activity)).toContain("paid_media_currency_not_informed");
    expect(flat(textOf(activity, "fact").join(" "))).toMatch(/moeda não informada/);
    expect(textOf(activity, "fact").join(" ")).not.toMatch(/R\$|BRL/);
  });
});

describe("cobertura da plataforma", () => {
  it("dados só em parte do período: limitação de alinhamento e NENHUM \"mesmo período\"", () => {
    const out = build({ ads: googleAds({ days: 2 }) });
    expectStructurallyValid(out);
    const activity = get(out, "paid-media-activity");
    expect(codes(activity)).toContain("google_ads_not_aligned");
    expect(textOf(activity, "limitation").join(" ")).toMatch(/cobrem só parte do período/);
    expect(evidence(activity, "google_ads.covered_days")?.value).toBe(2);
    expect(find(out, "paid-media-vs-traffic")).toBeUndefined();
    // e o investimento também não entra na relação com o CRM
    expect(JSON.stringify(get(out, "commercial-vs-acquisition"))).not.toMatch(/google_ads/);
  });

  it("dias sem veiculação NO MEIO do período não desalinham (a plataforma cobre as pontas)", () => {
    const out = build({ ads: googleAds({ dates: ["2026-10-01", "2026-10-04"] }) });
    const activity = get(out, "paid-media-activity");
    expect(codes(activity)).not.toContain("google_ads_not_aligned");
    expect(find(out, "paid-media-vs-traffic")).toBeDefined();
  });

  it("sem GA4 no período não há tráfego para pôr ao lado: o insight de tráfego não existe", () => {
    const out = build({ ads: googleAds(), ga4Days: [], ga4Rows: undefined });
    expect(find(out, "paid-media-activity")).toBeDefined();
    expect(find(out, "paid-media-vs-traffic")).toBeUndefined();
  });

  it("mídia paga sem CRM: a atividade continua existindo e o CRM não é inventado", () => {
    const out = build({ ads: googleAds(), rdCrm: null });
    expect(find(out, "paid-media-activity")).toBeDefined();
    expect(find(out, "commercial-vs-acquisition")).toBeUndefined();
  });
});

describe("zero não é ausência e razão nunca é 0/NaN", () => {
  it("campanha sem impressões, cliques nem conversões: razões ficam de fora (null), nunca 0", () => {
    const out = build({
      ads: makeGoogleAds([{ campaignId: "g1", impressions: 0, clicks: 0, cost: 0, conversions: 0 }], {
        window: OCT,
        days: 4,
      }),
    });
    expectStructurallyValid(out);
    const activity = get(out, "paid-media-activity");
    expect(evidence(activity, "google_ads.ctr")).toBeUndefined();
    expect(evidence(activity, "google_ads.cpc")).toBeUndefined();
    expect(evidence(activity, "google_ads.cost_per_conversion")).toBeUndefined();
    expect(evidence(activity, "google_ads.cost")?.value).toBe(0);
    expect(evidence(activity, "google_ads.conversions")?.value).toBe(0);
    const text = JSON.stringify(activity);
    expect(text).not.toMatch(/NaN|Infinity|null%/);
  });

  it("clique sem conversão: custo por conversão não existe", () => {
    const out = build({
      metaAds: makeMetaAds([{ campaignId: "m1", impressions: 1000, clicks: 10, cost: 5, conversions: 0 }], {
        window: OCT,
        days: 4,
      }),
    });
    const activity = get(out, "paid-media-activity");
    expect(evidence(activity, "meta_ads.cpc")?.value).toBe(0.5);
    expect(evidence(activity, "meta_ads.cost_per_conversion")).toBeUndefined();
  });

  it("ruído de ponto flutuante nas somas é arredondado (0,1 + 0,2 ≠ 0,30000000000000004)", () => {
    const out = build({
      ads: makeGoogleAds(
        [
          { campaignId: "g1", impressions: 10, clicks: 1, cost: 0.1 },
          { campaignId: "g2", impressions: 10, clicks: 1, cost: 0.2 },
        ],
        { window: OCT, days: 4 },
      ),
    });
    expect(evidence(get(out, "paid-media-activity"), "google_ads.cost")?.value).toBe(0.3);
  });
});

describe("determinismo, pureza e persistência", () => {
  const ctx = () =>
    periodContext({
      period: OCT,
      ga4Rows: OCT_ROWS,
      rdMarketing: rd(),
      rdCrm: crm(),
      ads: googleAds(),
      metaAds: metaAds(),
      ga4Channels: { "Paid Search": 80, "Paid Social": 60, "Organic Search": 347 },
    });

  it("mesmo contexto ⇒ mesma saída, e o contexto nunca é mutado", () => {
    const frozen = deepFreeze(ctx());
    const a = buildCrossSourceInsights(frozen);
    const b = buildCrossSourceInsights(frozen);
    expect(a).toEqual(b);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("a saída é JSON puro: sobrevive a ida e volta sem perder nada e mantém o hash", () => {
    const out = buildCrossSourceInsights(ctx());
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    const rows = toStoredRows("ws", OCT, out);
    expect(fromStoredRows(rows)).toEqual(out);
    for (const insight of out) {
      expect(contentHash(JSON.parse(JSON.stringify(insight)))).toBe(contentHash(insight));
    }
  });

  it("a ordem das fontes é a canônica e a dos insights é fixa", () => {
    const out = buildCrossSourceInsights(ctx());
    expect(out.map((i) => i.type)).toEqual([
      "data-coverage",
      "acquisition-coverage",
      "traffic-and-rd-conversions",
      "paid-media-activity",
      "paid-media-vs-traffic",
      "commercial-activity",
      "commercial-vs-acquisition",
      "attribution-quality",
      "population-not-comparable",
      "metric-not-computable",
    ]);
    expect(get(out, "population-not-comparable").sources).toEqual([
      "ga4",
      "rd_marketing",
      "rd_crm",
      "google_ads",
      "meta_ads",
    ]);
  });

  it("não vaza identificador de campanha nem o nome dela: o Cross-source só traz agregados", () => {
    const text = JSON.stringify(buildCrossSourceInsights(ctx()));
    expect(text).not.toMatch(/Search institucional|Search servidores|Leads — servidores|"g1"|"m1"/);
  });
});

describe("regressão: CRM sem mídia paga mantém a relação de sempre", () => {
  it("com Ads presente a frase original do CRM × aquisição continua intacta", () => {
    const base = get(build(), "commercial-vs-acquisition");
    const withAds = get(build({ ads: googleAds() }), "commercial-vs-acquisition");
    for (const s of base.statements) {
      expect(withAds.statements.map((x) => x.text), s.text).toContain(s.text);
    }
  });

  it("CRM sem atividade e sem Ads: nada novo aparece", () => {
    const out = build({ rdCrm: makeRdCrm([deal({ dealCreatedAt: "2026-10-02" })], OCT, "2026-04-07") });
    expect(find(out, "paid-media-activity")).toBeUndefined();
  });
});
