/**
 * O Advisor com mídia paga (Google Ads e Meta Ads).
 *
 * Tudo vem do caminho real: construtor do Cross-source → store em memória (imita o
 * jsonb) → contexto do Advisor → resposta determinística. O que se trava aqui:
 *  - a mídia paga é OPCIONAL: sem ela a cobertura continua sendo exatamente as três
 *    fontes de base, e a ausência não rebaixa o status da resposta;
 *  - com ela, a plataforma ganha a própria linha de cobertura, a própria seção e uma
 *    frase no resumo — com os números formatados pelo sistema, nunca digitados;
 *  - a comparação entre períodos põe cada plataforma contra ELA MESMA;
 *  - nenhum nome de campanha chega ao contexto.
 */
import { describe, expect, it } from "vitest";

import { buildAdvisorContext } from "../context";
import { answerAdvisorQuery } from "../service";
import type { AdvisorIntent } from "../intents";
import type { AdvisorContext, AdvisorResponse } from "../types";
import {
  OCT,
  OCT_PERIOD,
  SEP,
  SEP_PERIOD,
  WS,
  diagnosticItem,
  makeGoogleAds,
  makeMetaAds,
  octoberContext,
  octoberGoogleAds,
  octoberMetaAds,
  persist,
  septemberContext,
  sourcesFrom,
} from "./advisor-fixtures";

type Ctx = ReturnType<typeof octoberContext>;

async function contextOf(ctx: Ctx): Promise<AdvisorContext> {
  const memory = await persist(ctx, OCT_PERIOD);
  return buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(memory));
}

async function respond(ctx: Ctx, intent: AdvisorIntent): Promise<AdvisorResponse> {
  const memory = await persist(ctx, OCT_PERIOD);
  return answerAdvisorQuery(
    { workspaceId: WS, period: OCT_PERIOD, intent },
    { ...sourcesFrom(memory, [diagnosticItem()]), log: () => {} },
  );
}

const flat = (s: string) => s.replace(/ /g, " ");
const all = octoberContext({ ads: octoberGoogleAds(), metaAds: octoberMetaAds() });

describe("cobertura por fonte", () => {
  it("sem mídia paga: exatamente as três fontes de base, na ordem de sempre", async () => {
    const c = await contextOf(octoberContext());
    expect(c.sources.map((s) => s.source)).toEqual(["ga4", "rd_marketing", "rd_crm"]);
  });

  it("com Google Ads: ganha a linha, coberta, com os dias da plataforma", async () => {
    const c = await contextOf(octoberContext({ ads: octoberGoogleAds() }));
    expect(c.sources.map((s) => s.source)).toEqual(["ga4", "rd_marketing", "rd_crm", "google_ads"]);
    expect(c.sources.at(-1)).toMatchObject({
      source: "google_ads",
      label: "Google Ads",
      status: "covered",
      daysWithData: 4,
      periodDays: 4,
      limitationCodes: [],
    });
  });

  it("com as duas plataformas: cinco linhas, na ordem canônica", async () => {
    const c = await contextOf(all);
    expect(c.sources.map((s) => s.source)).toEqual([
      "ga4",
      "rd_marketing",
      "rd_crm",
      "google_ads",
      "meta_ads",
    ]);
    expect(c.sources.map((s) => s.status)).toEqual(["covered", "covered", "covered", "covered", "covered"]);
  });

  it("plataforma que cobre só parte do período fica PARCIAL, com o código que explica", async () => {
    const c = await contextOf(
      octoberContext({
        metaAds: makeMetaAds([{ campaignId: "m1", impressions: 10, clicks: 1, cost: 5 }], { window: OCT, days: 2 }),
      }),
    );
    expect(c.sources.find((s) => s.source === "meta_ads")).toMatchObject({
      status: "partial",
      limitationCodes: ["meta_ads_not_aligned"],
    });
  });

  it("as limitações da mídia paga têm gravidade classificada (nenhuma cai no padrão por esquecimento)", async () => {
    const c = await contextOf(all);
    const byCode = new Map(c.limitations.map((l) => [l.code, l.severity]));
    expect(byCode.get("paid_media_conversions_definition")).toBe("info");
    expect(byCode.get("meta_ads_metrics_scope")).toBe("info");
    expect(byCode.get("google_ads_clicks_vs_sessions")).toBe("info");
    expect(byCode.get("paid_media_no_joint_rate")).toBe("info");
  });
});

describe("a ausência da mídia paga não rebaixa a resposta", () => {
  it("o status do fechamento é o mesmo com e sem mídia paga cobrindo o período", async () => {
    const without = await respond(octoberContext(), "closing_report");
    const withAds = await respond(all, "closing_report");
    expect(withAds.status).toBe(without.status);
  });

  it("sem mídia paga a resposta não menciona plataforma de anúncios nenhuma", async () => {
    const r = await respond(octoberContext(), "closing_report");
    expect(JSON.stringify(r)).not.toMatch(/Google Ads|Meta Ads|paid-media/);
    expect(r.sections.map((s) => s.id)).not.toContain("paid_media");
  });
});

describe("relatórios com mídia paga", () => {
  it("o fechamento ganha a seção de mídia paga, entre aquisição e comercial, com as figuras", async () => {
    const r = await respond(all, "closing_report");
    const ids = r.sections.map((s) => s.id);
    expect(ids.indexOf("paid_media")).toBeGreaterThan(ids.indexOf("acquisition"));
    expect(ids.indexOf("paid_media")).toBeLessThan(ids.indexOf("commercial"));

    const section = r.sections.find((s) => s.id === "paid_media")!;
    expect(section.title).toBe("Mídia paga — Google Ads e Meta Ads");
    const text = flat(section.items.map((i) => i.text).join(" "));
    expect(text).toContain("Google Ads: investimento de R$ 400,00");
    expect(text).toContain("Meta Ads: investimento de R$ 250,00");
    expect(text).toContain("apresentados lado a lado");

    // as figuras são evidências do contexto, com o valor já formatado pelo sistema
    const cost = section.figures.find((f) => f.ref.startsWith("google_ads.cost@"))!;
    expect(flat(cost.display ?? "")).toBe("R$ 400,00");
    expect(section.figures.every((f) => f.source === "google_ads" || f.source === "meta_ads")).toBe(true);
  });

  it("o resumo cita o investimento e os cliques de cada plataforma (só displays do contexto)", async () => {
    const r = await respond(all, "period_summary");
    const summary = flat(r.summary);
    expect(summary).toContain("Google Ads: R$ 400,00 investidos e 500 cliques");
    expect(summary).toContain("Meta Ads: R$ 250,00 investidos e 450 cliques");
  });

  it("a análise de aquisição inclui mídia paga e a de aspecto comercial não", async () => {
    const acquisition = await respond(all, "acquisition_analysis");
    expect(acquisition.sections.map((s) => s.id)).toContain("paid_media");
    const commercial = await respond(all, "commercial_analysis");
    expect(commercial.sections.map((s) => s.id)).not.toContain("paid_media");
  });

  it("toda figura e frase da mídia paga aponta para uma evidência que existe na resposta", async () => {
    const r = await respond(all, "closing_report");
    const refs = new Set(r.evidence.map((e) => e.ref));
    const section = r.sections.find((s) => s.id === "paid_media")!;
    for (const f of section.figures) expect(refs.has(f.ref), f.ref).toBe(true);
    for (const item of section.items) for (const ref of item.evidenceRefs) expect(refs.has(ref), ref).toBe(true);
  });

  it("nenhum nome ou id de campanha chega à resposta", async () => {
    const text = JSON.stringify(await respond(all, "closing_report"));
    expect(text).not.toMatch(/Search institucional|Search servidores|Leads — servidores/);
  });

  it("conversão fracionária do Google Ads aparece com o valor exato e o aviso de arredondamento", async () => {
    const r = await respond(all, "closing_report");
    const text = flat(r.sections.find((s) => s.id === "paid_media")!.items.map((i) => i.text).join(" "));
    expect(text).toContain("valor exato: 15,5, exibido arredondado");
  });
});

describe("comparação entre períodos com mídia paga", () => {
  const sepAds = () =>
    septemberContext({
      ads: makeGoogleAds(
        [{ campaignId: "g1", impressions: 4000, clicks: 200, cost: 100, conversions: 5 }],
        { window: SEP, days: 4 },
      ),
    });

  async function compare(current: Ctx, baseline: Ctx) {
    const memory = await persist(current, OCT_PERIOD);
    await persist(baseline, SEP_PERIOD, memory);
    const c = await buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: SEP_PERIOD }, sourcesFrom(memory));
    return c.comparison!;
  }

  it("compara cada plataforma contra ELA MESMA, na mesma moeda", async () => {
    const cmp = await compare(octoberContext({ ads: octoberGoogleAds() }), sepAds());
    expect(cmp.status).toBe("computed");
    const cost = cmp.items.find((i) => i.metricId === "google_ads.cost")!;
    expect([cost.current, cost.baseline, cost.delta]).toEqual([400, 100, 300]);
    expect(cost.deltaPct).toBe(3);
    expect(flat(cost.currentDisplay)).toBe("R$ 400,00");
    expect(cost.deltaPctDisplay).toBe("+300,0%");
    expect(cmp.items.find((i) => i.metricId === "google_ads.clicks")).toMatchObject({ current: 500, baseline: 200 });
    // sem Meta em nenhum dos dois períodos: a métrica simplesmente não existe
    expect(cmp.items.some((i) => i.source === "meta_ads")).toBe(false);
    expect(cmp.skipped.some((s) => s.metricId.startsWith("meta_ads."))).toBe(false);
  });

  it("plataforma que só existe em um dos períodos NÃO é comparada, e o motivo é dito", async () => {
    const cmp = await compare(octoberContext({ ads: octoberGoogleAds(), metaAds: octoberMetaAds() }), sepAds());
    expect(cmp.items.some((i) => i.source === "meta_ads")).toBe(false);
    const skipped = cmp.skipped.filter((s) => s.metricId.startsWith("meta_ads."));
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]!.reason).toMatch(/Meta Ads não cobre o período inteiro nos dois períodos/);
  });

  it("moedas diferentes entre os períodos: o custo não é comparado", async () => {
    const usd = septemberContext({
      ads: makeGoogleAds([{ campaignId: "g1", impressions: 4000, clicks: 200, cost: 100 }], {
        window: SEP,
        days: 4,
        currency: "USD",
      }),
    });
    const cmp = await compare(octoberContext({ ads: octoberGoogleAds() }), usd);
    expect(cmp.items.some((i) => i.metricId === "google_ads.cost")).toBe(false);
    expect(cmp.skipped.find((s) => s.metricId === "google_ads.cost")?.reason).toMatch(/moeda diferente/);
  });
});
