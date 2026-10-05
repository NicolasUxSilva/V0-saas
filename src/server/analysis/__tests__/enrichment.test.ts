/**
 * Testes do enriquecimento cross-source (bloco G6).
 *
 * `enrichWithAds` é pura — os insights vêm dos detectores REAIS (via `makeContext`),
 * não de mocks, e o `AdsContext` é um fixture pequeno e determinístico (nenhuma
 * chamada de rede, nenhum banco). Cada caso prova uma condição de "quando
 * enriquecer" ou uma garantia de preservação do insight original.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  detectDataQuality,
  detectTrafficVolumeDrop,
} from "@/server/analysis/detectors";
import { enrichWithAds } from "@/server/analysis/enrichment";
import { evaluateGates } from "@/server/analysis/gates";
import { priorityScore } from "@/server/analysis/scoring";
import type {
  AdsCampaignSummary,
  AdsContext,
  DetectorInsight,
} from "@/server/analysis/types";

import { makeContext } from "./fixtures";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Mesmo cálculo de `priorityScore` que o engine aplica antes do enriquecimento. */
function scored(insights: DetectorInsight[]): DetectorInsight[] {
  return insights.map((i) => ({
    ...i,
    priorityScore: priorityScore(
      i,
      typeof i.gateTrace.onsetDate === "string" ? i.gateTrace.onsetDate : null,
    ),
  }));
}

const ALL_CHANNELS = ["Organic Search", "Direct", "Paid Search"] as const;

/** `traffic-volume-drop` REAL cujo canal responsável é `channel` (os demais ficam estáveis). */
function trafficDropFor(channel: (typeof ALL_CHANNELS)[number]): DetectorInsight {
  const [a, b] = ALL_CHANNELS.filter((c) => c !== channel);
  const ctx = makeContext({
    baselineDailyMean: 480,
    currentChannels: [
      [channel, 2000],
      [a!, 5000],
      [b!, 2800],
    ],
    previousChannels: [
      [channel, 5200],
      [a!, 5050],
      [b!, 2900],
    ],
    onsetChannel: channel,
    onsetDate: "2026-08-10",
    distinctDates: 176,
  });
  const out = scored(detectTrafficVolumeDrop(ctx, evaluateGates(ctx)));
  expect(out).toHaveLength(1); // sanity: o cenário realmente dispara o detector
  const insight = out[0]!;
  expect(insight.responsibleDimension?.value).toBe(channel);
  expect(insight.priorityScore).toBeGreaterThan(0);
  return insight;
}

/** `data-quality:no_key_events` REAL (sem key events → detector de qualidade dispara). */
function dataQualityInsights(): DetectorInsight[] {
  const ctx = makeContext({
    currentChannels: [["Organic Search", 5000, 0]],
    previousChannels: [["Organic Search", 5000, 0]],
    distinctDates: 176,
  });
  const out = scored(detectDataQuality(ctx, evaluateGates(ctx)));
  expect(out.length).toBeGreaterThan(0);
  return out;
}

function campaign(
  id: string,
  over: Partial<AdsCampaignSummary> = {},
): AdsCampaignSummary {
  return {
    campaignId: id,
    campaignName: `Campanha ${id}`,
    status: "ENABLED",
    advertisingChannelType: "SEARCH",
    impressions: 10_000,
    clicks: 500,
    cost: 1000,
    conversions: 20,
    conversionValue: 4000,
    impressionShare: null,
    budgetLostIs: null,
    rankLostIs: null,
    ...over,
  };
}

function adsContext(
  campaigns: AdsCampaignSummary[],
  window: { start: string; end: string },
  currency: string | null = "BRL",
): AdsContext {
  return {
    window,
    currency,
    totals: campaigns.reduce(
      (t, c) => ({
        impressions: t.impressions + c.impressions,
        clicks: t.clicks + c.clicks,
        cost: t.cost + c.cost,
        conversions: t.conversions + c.conversions,
        conversionValue: t.conversionValue + c.conversionValue,
      }),
      { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 },
    ),
    campaignCount: campaigns.length,
    campaigns,
  };
}

/** Janela do Ads IGUAL à do insight — o caso normal de `buildAdsContext`. */
const windowOf = (i: DetectorInsight) => ({
  start: i.periodStart,
  end: i.periodEnd,
});

/** Duas campanhas Search — números do enunciado do G5 (A: 10k/500/1000; B: 5k/200/500). */
const twoSearchCampaigns = () => [
  campaign("111"),
  campaign("222", {
    impressions: 5_000,
    clicks: 200,
    cost: 500,
    conversions: 5,
    conversionValue: 1000,
  }),
];

/** NBSP → espaço comum, para asserções sobre `Intl` de moeda em pt-BR. */
const plain = (s: string) => s.replace(/ /g, " ");

/** Frases que AFIRMARIAM causalidade — nenhuma pode aparecer no texto acrescentado. */
const AFFIRMATIVE_CAUSAL =
  /causou|foi causad|explica(m)? a queda|devido ao google ads|por causa d[oa] google ads|responsável pela queda|provocou|resultou em/i;

// ── Caso 1 ──────────────────────────────────────────────────────────────────

describe("Caso 1 — ctx.ads === null", () => {
  it("devolve os insights exatamente como vieram: mesma referência, sem evidência Ads, sem erro", () => {
    const insight = trafficDropFor("Paid Search");
    const before = structuredClone(insight);
    const insights = [insight];

    const out = enrichWithAds(insights, null);

    expect(out).toBe(insights); // mesma referência do array
    expect(out[0]).toBe(insight);
    expect(out[0]).toEqual(before); // conteúdo idêntico ao comportamento anterior
    expect(out[0]!.evidence.supportingEvidence).toBeUndefined();
    expect(out[0]!.hypothesis).toBe(before.hypothesis);
  });

  it("lista vazia de insights (nada detectado) → segue vazia, com ou sem Ads", () => {
    const ads = adsContext(twoSearchCampaigns(), { start: "a", end: "b" });
    expect(enrichWithAds([], null)).toEqual([]);
    expect(enrichWithAds([], ads)).toEqual([]);
  });
});

// ── Caso 2 ──────────────────────────────────────────────────────────────────

describe("Caso 2 — Ads presente e compatível (Paid Search × campanhas SEARCH)", () => {
  const insight = trafficDropFor("Paid Search");
  const ads = adsContext(twoSearchCampaigns(), windowOf(insight));
  const [out] = enrichWithAds([insight], ads);
  const evidence = out!.evidence.supportingEvidence;

  it("adiciona exatamente 1 evidência do Google Ads, marcada como same_period", () => {
    expect(evidence).toHaveLength(1);
    expect(evidence![0]).toMatchObject({
      source: "google_ads",
      relationship: "same_period",
      currency: "BRL",
    });
  });

  it("métricas vêm do fixture: soma das 2 campanhas Search, só valores absolutos", () => {
    expect(evidence![0]!.metrics).toEqual({
      campaignCount: 2,
      impressions: 15_000,
      clicks: 700,
      cost: 1500,
      conversions: 25,
      conversionValue: 5000,
      impressionShare: null, // 2 campanhas → razão não é agregada (ver enrichment.ts)
    });
  });

  it("o texto reporta os números do fixture, na moeda da conta, sem % (nenhuma variação do Ads)", () => {
    const detail = plain(evidence![0]!.detail);
    expect(detail).toContain("2 campanhas de Search no Google Ads registraram");
    expect(detail).toContain("15.000 impressões");
    expect(detail).toContain("700 cliques");
    expect(detail).toContain("R$ 1.500,00 de custo");
    expect(detail).toContain("01/08/2026 a 28/08/2026"); // a janela do insight
    expect(detail).not.toContain("%"); // nenhuma variação/percentual do lado Ads
  });

  it("nenhum claim causal: o texto acrescentado nega causalidade e o escopo do canal", () => {
    const detail = evidence![0]!.detail;
    const addendum = out!.hypothesis.slice(insight.hypothesis.length);

    expect(detail).not.toMatch(AFFIRMATIVE_CAUSAL);
    expect(addendum).not.toMatch(AFFIRMATIVE_CAUSAL);
    expect(detail).toContain("não estabelece causalidade");
    expect(detail).toContain("não representa a totalidade de Paid Search");
    expect(addendum).toMatch(/não .*permite atribuir causalidade/);
    // sem período anterior do Ads, o texto não pode sugerir que o Ads "caiu"
    expect(addendum).toContain("não indica se houve queda nos anúncios");
  });

  it("o fato do GA4 fica separado: a hipótese original é prefixo intacto da nova", () => {
    expect(out!.hypothesis.startsWith(insight.hypothesis)).toBe(true);
    expect(out!.hypothesis.length).toBeGreaterThan(insight.hypothesis.length);
  });

  it("1 campanha compatível que reportou impression share → repassa o valor, sem agregar razões", () => {
    const one = adsContext(
      [campaign("111", { impressionShare: 0.65 })],
      windowOf(insight),
    );
    const [o] = enrichWithAds([insight], one);
    const e = o!.evidence.supportingEvidence![0]!;
    expect(e.metrics.impressionShare).toBe(0.65);
    expect(e.detail).toContain("parcela de impressões: 65%");
    expect(e.detail).toContain("1 campanha de Search no Google Ads registrou");
  });

  it("várias campanhas com impression share → NÃO agrega (null), pois exigiria ponderação nova", () => {
    const many = adsContext(
      [
        campaign("111", { impressionShare: 0.65 }),
        campaign("222", { impressionShare: 0.4 }),
      ],
      windowOf(insight),
    );
    const [o] = enrichWithAds([insight], many);
    expect(o!.evidence.supportingEvidence![0]!.metrics.impressionShare).toBeNull();
  });

  it("só somam campanhas compatíveis: Display/PMax no mesmo Ads ficam de fora", () => {
    const mixed = adsContext(
      [
        campaign("111"),
        campaign("222", { advertisingChannelType: "DISPLAY", impressions: 999_999 }),
        campaign("333", { advertisingChannelType: "PERFORMANCE_MAX", clicks: 999_999 }),
        campaign("444", { advertisingChannelType: null, cost: 999_999 }),
      ],
      windowOf(insight),
    );
    const [o] = enrichWithAds([insight], mixed);
    const m = o!.evidence.supportingEvidence![0]!.metrics;
    expect(m.campaignCount).toBe(1);
    expect(m.impressions).toBe(10_000);
    expect(m.clicks).toBe(500);
    expect(m.cost).toBe(1000);
  });

  it("moeda: usa a da conta (não assume BRL), e nunca quebra com código inválido/ausente", () => {
    const withCurrency = (currency: string | null) =>
      enrichWithAds([insight], adsContext(twoSearchCampaigns(), windowOf(insight), currency))[0]!
        .evidence.supportingEvidence![0]!;

    const usd = withCurrency("USD");
    expect(usd.currency).toBe("USD");
    expect(plain(usd.detail)).not.toContain("R$");
    expect(plain(usd.detail)).toMatch(/US\$ 1\.500,00 de custo/);

    const none = withCurrency(null);
    expect(none.currency).toBeNull();
    expect(none.detail).toContain("(moeda não informada)");

    const malformed = withCurrency("XX"); // Intl lança RangeError → fallback
    expect(malformed.detail).toContain("1.500,00 XX de custo");
  });

  it("soma sem ruído de ponto flutuante (0,1 + 0,2 → 0,3)", () => {
    const ads2 = adsContext(
      [campaign("1", { cost: 0.1 }), campaign("2", { cost: 0.2 })],
      windowOf(insight),
    );
    const e = enrichWithAds([insight], ads2)[0]!.evidence.supportingEvidence![0]!;
    expect(e.metrics.cost).toBe(0.3);
  });
});

// ── Caso 3 ──────────────────────────────────────────────────────────────────

describe("Caso 3 — Ads presente mas incompatível", () => {
  it("traffic-volume-drop de Organic Search + Ads só de Search → nenhuma evidência Ads", () => {
    const insight = trafficDropFor("Organic Search");
    const ads = adsContext(twoSearchCampaigns(), windowOf(insight));

    const out = enrichWithAds([insight], ads);

    expect(out[0]).toBe(insight); // mesma referência: nem copiado
    expect(out[0]!.evidence.supportingEvidence).toBeUndefined();
    expect(out[0]!.hypothesis).toBe(insight.hypothesis);
  });

  it("traffic-volume-drop de Direct + Ads presente → nenhuma evidência Ads", () => {
    const insight = trafficDropFor("Direct");
    const out = enrichWithAds([insight], adsContext(twoSearchCampaigns(), windowOf(insight)));
    expect(out[0]).toBe(insight);
  });

  it("Paid Search, mas as campanhas do Ads NÃO são Search (Display/PMax/tipo desconhecido) → nenhuma evidência", () => {
    const insight = trafficDropFor("Paid Search");
    const ads = adsContext(
      [
        campaign("1", { advertisingChannelType: "DISPLAY" }),
        campaign("2", { advertisingChannelType: "PERFORMANCE_MAX" }),
        campaign("3", { advertisingChannelType: null }), // tipo ausente: não se assume Search
      ],
      windowOf(insight),
    );
    expect(enrichWithAds([insight], ads)[0]).toBe(insight);
  });

  it("insight de nível de site (sem canal responsável) → nenhuma evidência", () => {
    const insight = { ...trafficDropFor("Paid Search"), responsibleDimension: null };
    const out = enrichWithAds([insight], adsContext(twoSearchCampaigns(), windowOf(insight)));
    expect(out[0]).toBe(insight);
  });

  it("responsável que não é um CANAL (outra dimensão com o mesmo texto) → nenhuma evidência", () => {
    const base = trafficDropFor("Paid Search");
    const insight = {
      ...base,
      responsibleDimension: { name: "source / medium", value: "Paid Search", share: 0.8 },
    };
    const out = enrichWithAds([insight], adsContext(twoSearchCampaigns(), windowOf(insight)));
    expect(out[0]).toBe(insight);
  });

  it("nome de canal que colide com Object.prototype ('constructor') → sem erro, sem evidência", () => {
    const base = trafficDropFor("Paid Search");
    const insight = {
      ...base,
      responsibleDimension: { name: "canal", value: "constructor", share: 0.8 },
    };
    expect(() =>
      enrichWithAds([insight], adsContext(twoSearchCampaigns(), windowOf(insight))),
    ).not.toThrow();
    expect(
      enrichWithAds([insight], adsContext(twoSearchCampaigns(), windowOf(insight)))[0],
    ).toBe(insight);
  });
});

// ── Caso 4 ──────────────────────────────────────────────────────────────────

describe("Caso 4 — período incompatível", () => {
  const insight = trafficDropFor("Paid Search");

  it.each([
    ["janela inteira fora (período anterior)", { start: "2026-07-04", end: "2026-07-31" }],
    ["início diferente por 1 dia", { start: "2026-08-02", end: insight.periodEnd }],
    ["fim diferente por 1 dia", { start: insight.periodStart, end: "2026-08-27" }],
    ["janela mais longa que a do insight", { start: "2026-07-01", end: insight.periodEnd }],
  ])("Ads com %s → nenhuma evidência", (_label, window) => {
    const ads = adsContext(twoSearchCampaigns(), window);
    const out = enrichWithAds([insight], ads);
    expect(out[0]).toBe(insight);
    expect(out[0]!.evidence.supportingEvidence).toBeUndefined();
  });
});

// ── Caso 5 ──────────────────────────────────────────────────────────────────

describe("Caso 5 — dados de Ads insuficientes", () => {
  const insight = trafficDropFor("Paid Search");

  it("campanhas Search existem mas sem nenhuma atividade (0 impressões, 0 cliques, 0 custo) → nenhuma evidência", () => {
    const ads = adsContext(
      [
        campaign("1", { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 }),
        campaign("2", { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 }),
      ],
      windowOf(insight),
    );
    expect(enrichWithAds([insight], ads)[0]).toBe(insight);
  });

  it("AdsContext sem campanhas (campaignCount 0) → nenhuma evidência, sem erro", () => {
    const ads = adsContext([], windowOf(insight));
    expect(() => enrichWithAds([insight], ads)).not.toThrow();
    expect(enrichWithAds([insight], ads)[0]).toBe(insight);
  });

  it("atividade mínima objetiva (só custo > 0) já basta para evidenciar", () => {
    const ads = adsContext(
      [campaign("1", { impressions: 0, clicks: 0, cost: 12.5 })],
      windowOf(insight),
    );
    const out = enrichWithAds([insight], ads)[0]!;
    expect(out.evidence.supportingEvidence).toHaveLength(1);
    expect(out.evidence.supportingEvidence![0]!.metrics.cost).toBe(12.5);
  });
});

// ── Caso 6 ──────────────────────────────────────────────────────────────────

describe("Caso 6 — preservação do insight (o enriquecimento não cria nem reescreve nada)", () => {
  const insight = trafficDropFor("Paid Search");
  const before = structuredClone(insight);
  const ads = adsContext(twoSearchCampaigns(), windowOf(insight));
  const out = enrichWithAds([insight], ads);
  const enriched = out[0]!;

  it("não cria nem remove insight (mesma quantidade, mesma ordem)", () => {
    const list = [...dataQualityInsights(), insight];
    const result = enrichWithAds(list, ads);
    expect(result).toHaveLength(list.length);
    expect(result.map((i) => i.dedupeKey)).toEqual(list.map((i) => i.dedupeKey));
  });

  it("dedupeKey, severity, confidence e priorityScore NÃO mudam", () => {
    expect(enriched.dedupeKey).toBe(before.dedupeKey);
    expect(enriched.dedupeKey).toBe("traffic-volume-drop:Paid Search");
    expect(enriched.severity).toBe(before.severity);
    expect(enriched.confidence).toBe(before.confidence);
    expect(enriched.priorityScore).toBe(before.priorityScore);
    expect(enriched.priorityScore).toBeGreaterThan(0); // não é 0 === 0
  });

  it("só `hypothesis` e `evidence` diferem — todo o resto (title, explanation, action, impact, gateTrace…) é idêntico", () => {
    for (const key of Object.keys(before) as (keyof DetectorInsight)[]) {
      if (key === "hypothesis" || key === "evidence") continue;
      expect(enriched[key], `campo ${key}`).toEqual(before[key]);
    }
  });

  it("não aparece nenhum campo novo no topo — logo status/rating/created_at (colunas do banco) nem são tocados", () => {
    expect(Object.keys(enriched).sort()).toEqual(Object.keys(before).sort());
  });

  it("dentro de `evidence`, só `supportingEvidence` é novo — fato primário do GA4 intacto", () => {
    const { supportingEvidence, ...rest } = enriched.evidence;
    expect(supportingEvidence).toHaveLength(1);
    expect(rest).toEqual(before.evidence);
  });

  it("não muta o insight de entrada", () => {
    expect(insight).toEqual(before);
    expect(insight.evidence.supportingEvidence).toBeUndefined();
  });

  it("é idempotente: enriquecer de novo não duplica evidência nem texto", () => {
    const twice = enrichWithAds(out, ads)[0]!;
    expect(twice).toBe(enriched); // já tem evidência do Google Ads → devolve como está
    expect(twice.evidence.supportingEvidence).toHaveLength(1);
    expect(twice.hypothesis.split("Contexto do Google Ads").length - 1).toBe(1);
  });
});

// ── Caso 7 ──────────────────────────────────────────────────────────────────

describe("Caso 7 — insight que não é traffic-volume-drop", () => {
  it("data-quality com ctx.ads preenchido → nada muda (hypothesis, evidence, sem evidência Ads, sem erro)", () => {
    const dq = dataQualityInsights();
    const before = structuredClone(dq);
    // janela idêntica à do insight e campanhas Search: TUDO compatível, exceto o detector
    const ads = adsContext(twoSearchCampaigns(), windowOf(dq[0]!));

    let out: DetectorInsight[] = [];
    expect(() => {
      out = enrichWithAds(dq, ads);
    }).not.toThrow();

    expect(out).toHaveLength(dq.length); // nenhum novo insight
    out.forEach((i, idx) => {
      expect(i).toBe(dq[idx]); // nem copiado
      expect(i.hypothesis).toBe(before[idx]!.hypothesis);
      expect(i.evidence).toEqual(before[idx]!.evidence);
      expect(i.evidence.supportingEvidence).toBeUndefined();
    });
  });

  it("outro detector com o MESMO canal (Paid Search), mesma janela e campanhas Search compatíveis → nada (o G6 começa só pelo traffic-volume-drop)", () => {
    // Satisfaz TODAS as outras condições — o único motivo para não enriquecer é
    // o detector. Sem isto, a regra "só traffic-volume-drop" ficaria mascarada
    // pela regra de canal (o data-quality real nem tem canal responsável).
    const base = trafficDropFor("Paid Search");
    const other: DetectorInsight = {
      ...base,
      detector: "conversion-efficiency-drop",
      type: "conversion_drop",
      dedupeKey: "conversion-efficiency-drop:Paid Search",
    };
    const out = enrichWithAds([other], adsContext(twoSearchCampaigns(), windowOf(other)));

    expect(out[0]).toBe(other);
    expect(out[0]!.evidence.supportingEvidence).toBeUndefined();
    expect(out[0]!.hypothesis).toBe(other.hypothesis);
  });

  it("lista mista: só o traffic-volume-drop de Paid Search é enriquecido; o resto passa intacto", () => {
    const dq = dataQualityInsights();
    const ps = trafficDropFor("Paid Search");
    const os = trafficDropFor("Organic Search");
    const list = [...dq, ps, os];
    const ads = adsContext(twoSearchCampaigns(), windowOf(ps));

    const out = enrichWithAds(list, ads);

    expect(out).toHaveLength(list.length);
    const enrichedKeys = out
      .filter((i) => (i.evidence.supportingEvidence?.length ?? 0) > 0)
      .map((i) => i.dedupeKey);
    expect(enrichedKeys).toEqual(["traffic-volume-drop:Paid Search"]);
    expect(out[list.indexOf(os)]).toBe(os);
    dq.forEach((d) => expect(out[list.indexOf(d)]).toBe(d));
  });
});

// ── guardas de arquitetura ──────────────────────────────────────────────────

const SRC_ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (relPath: string) => readFileSync(join(SRC_ROOT, relPath), "utf8");

describe("arquitetura — o enriquecimento é um passo puro depois dos detectores (INV-1, INV-3, INV-4)", () => {
  const engineSrc = read("server/analysis/engine.ts");
  const enrichmentSrc = read("server/analysis/enrichment.ts");

  it("enrichment.ts é puro: sem banco, sem HTTP/IA, sem o AnalysisContext inteiro", () => {
    // só o CÓDIGO importa aqui — o cabeçalho do arquivo documenta essas mesmas
    // restrições por extenso (e portanto menciona `AnalysisContext`).
    const code = enrichmentSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/@\/server\/db|drizzle-orm|from "\.\/context"/);
    expect(code).not.toMatch(/\bfetch\s*\(|openai|anthropic|gemini|embedding/i);
    // a função recebe só `ads` — o contexto inteiro (`ctx`) nem existe no módulo
    expect(code).not.toMatch(/\bAnalysisContext\b|\bctx\b/);
  });

  it("engine.ts passa SÓ ctx.ads ao enriquecimento, depois dos detectores e antes de ordenar/persistir", () => {
    const iCall = engineSrc.indexOf("enrichWithAds(scored, ctx.ads)");
    expect(iCall).toBeGreaterThan(-1);
    expect(iCall).toBeGreaterThan(engineSrc.indexOf("detectConversionEfficiencyDrop(ctx, gates)"));
    expect(iCall).toBeLessThan(engineSrc.indexOf("produced.sort("));
    expect(iCall).toBeLessThan(engineSrc.indexOf("db.transaction"));
  });

  it("os detectores continuam sendo chamados só com (ctx, gates) — nenhum recebe Ads", () => {
    expect(engineSrc).toContain("detectDataQuality(ctx, gates)");
    expect(engineSrc).toContain("detectTrafficVolumeDrop(ctx, gates)");
    expect(engineSrc).toContain("detectConversionEfficiencyDrop(ctx, gates)");
  });

  it("o upsert continua sem tocar status / rating / created_at (feedback do usuário preservado)", () => {
    const upsert = engineSrc.slice(engineSrc.indexOf("onConflictDoUpdate"));
    expect(upsert).not.toMatch(/\bstatus\s*:|\brating\s*:|\bcreatedAt\s*:/);
  });

  it("detectors / gates / scoring / contribution / stats / templates não conhecem o enriquecimento", () => {
    for (const f of ["detectors", "gates", "scoring", "contribution", "stats", "templates"]) {
      expect(read(`server/analysis/${f}.ts`), `${f}.ts`).not.toMatch(
        /supportingEvidence|enrichWithAds|CrossSourceEvidence/,
      );
    }
  });
});
