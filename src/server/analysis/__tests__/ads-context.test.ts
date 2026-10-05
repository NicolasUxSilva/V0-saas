/**
 * Testes do contexto composto de Ads (bloco G5).
 *
 * `composeAdsContext` é pura (não toca o banco) — os testes de composição
 * usam fixtures pequenas e determinísticas, simulando o shape das duas
 * queries que `buildAdsContext` roda contra `fact_ad_performance_daily`
 * (agregado por campanha + snapshot mais recente por campanha).
 *
 * A seção de regressão prova, com os detectores REAIS (não um mock), que
 * `ctx.ads` — vazio ou preenchido — nunca muda o resultado GA4: os detectores
 * simplesmente não leem esse campo (ver `orchestration.test.ts`).
 */
import { describe, expect, it } from "vitest";

import {
  detectConversionEfficiencyDrop,
  detectDataQuality,
  detectTrafficVolumeDrop,
} from "@/server/analysis/detectors";
import { evaluateGates } from "@/server/analysis/gates";
import { priorityScore } from "@/server/analysis/scoring";

// `composeAdsContext` não é exportado de `types.ts` — importa do módulo que a
// implementa (é lá que INV-2 exige que a leitura de fact_ad_performance_daily
// exista; a função em si é pura e não toca o banco).
import { composeAdsContext } from "@/server/analysis/context";

import { makeContext } from "./fixtures";

const WINDOW = { start: "2026-08-01", end: "2026-08-28" };

// ── fixtures — "Campanha A"/"Campanha B" do enunciado do G5 ────────────────

function campaignA() {
  return {
    agg: {
      campaignId: "111",
      impressions: 10_000,
      clicks: 500,
      cost: 1000,
      conversions: 20,
      conversionValue: 4000,
      impressionShare: 0.65,
      budgetLostIs: 0.1,
      rankLostIs: 0.2,
    },
    snapshot: {
      campaignId: "111",
      date: "2026-08-28",
      campaignName: "Campanha A",
      status: "ENABLED",
      currency: "BRL",
      dims: { advertisingChannelType: "SEARCH", budgetAmount: 50 },
    },
  };
}

function campaignB() {
  return {
    agg: {
      campaignId: "222",
      impressions: 5_000,
      clicks: 200,
      cost: 500,
      conversions: 5,
      conversionValue: 1000,
      // nunca reportado pela fonte — precisa continuar `null`, não 0
      impressionShare: null,
      budgetLostIs: null,
      rankLostIs: null,
    },
    snapshot: {
      campaignId: "222",
      date: "2026-08-28",
      campaignName: "Campanha B",
      status: "PAUSED",
      currency: "BRL",
      dims: { advertisingChannelType: "SEARCH", budgetAmount: null },
    },
  };
}

describe("composeAdsContext — composição do contexto de Ads (G5)", () => {
  it("Ads vazio (sem linhas na janela) → contexto ausente de forma explícita, não zeros", () => {
    const ctx = composeAdsContext([], [], WINDOW);
    expect(ctx).toBeNull();
  });

  it("1 campanha com dados → todos os campos chegam ao contexto", () => {
    const a = campaignA();
    const ctx = composeAdsContext([a.agg], [a.snapshot], WINDOW);

    expect(ctx).not.toBeNull();
    expect(ctx!.window).toEqual(WINDOW);
    expect(ctx!.currency).toBe("BRL");
    expect(ctx!.campaignCount).toBe(1);
    expect(ctx!.totals).toEqual({
      impressions: 10_000,
      clicks: 500,
      cost: 1000,
      conversions: 20,
      conversionValue: 4000,
    });

    const [c] = ctx!.campaigns;
    expect(c).toEqual({
      campaignId: "111",
      campaignName: "Campanha A",
      status: "ENABLED",
      advertisingChannelType: "SEARCH",
      impressions: 10_000,
      clicks: 500,
      cost: 1000,
      conversions: 20,
      conversionValue: 4000,
      impressionShare: 0.65,
      budgetLostIs: 0.1,
      rankLostIs: 0.2,
    });
  });

  it("múltiplas campanhas → agregação workspace-level correta + granularidade campaign-level preservada", () => {
    const a = campaignA();
    const b = campaignB();
    const ctx = composeAdsContext(
      [a.agg, b.agg],
      [a.snapshot, b.snapshot],
      WINDOW,
    );

    expect(ctx!.campaignCount).toBe(2);
    // workspace-level = soma das duas campanhas, não a média nem só uma delas
    expect(ctx!.totals).toEqual({
      impressions: 15_000,
      clicks: 700,
      cost: 1500,
      conversions: 25,
      conversionValue: 5000,
    });
    // campaign-level: cada campanha mantém seus próprios números, não misturados
    const byId = Object.fromEntries(ctx!.campaigns.map((c) => [c.campaignId, c]));
    expect(byId["111"]!.impressions).toBe(10_000);
    expect(byId["222"]!.impressions).toBe(5_000);
    expect(byId["111"]!.status).toBe("ENABLED");
    expect(byId["222"]!.status).toBe("PAUSED");
  });

  it("campos opcionais continuam `null` quando a fonte nunca reportou (não viram 0)", () => {
    const b = campaignB();
    const ctx = composeAdsContext([b.agg], [b.snapshot], WINDOW);
    const [c] = ctx!.campaigns;
    expect(c!.impressionShare).toBeNull();
    expect(c!.budgetLostIs).toBeNull();
    expect(c!.rankLostIs).toBeNull();
    // budgetAmount ausente em dims (null) não deve virar advertisingChannelType errado
    expect(c!.advertisingChannelType).toBe("SEARCH");
  });

  it("campanha sem snapshot correspondente → defaults honestos, não erro", () => {
    // caso defensivo: agregado existe mas por algum motivo não achou snapshot
    // (não deveria acontecer na prática — mesma query de origem — mas a
    // composição não deve quebrar nem inventar dado).
    const a = campaignA();
    const ctx = composeAdsContext([a.agg], [], WINDOW);
    const [c] = ctx!.campaigns;
    expect(c!.campaignName).toBe("");
    expect(c!.status).toBe("");
    expect(c!.advertisingChannelType).toBeNull();
  });

  it("janela temporal: o contexto reporta exatamente a janela recebida", () => {
    const a = campaignA();
    const otherWindow = { start: "2026-07-01", end: "2026-07-28" };
    const ctx = composeAdsContext([a.agg], [a.snapshot], otherWindow);
    expect(ctx!.window).toEqual(otherWindow);
    expect(ctx!.window).not.toEqual(WINDOW);
  });

  it("status/canal são o snapshot do dia MAIS RECENTE da campanha na janela", () => {
    const agg = campaignA().agg;
    // duas linhas da mesma campanha em dias diferentes — precisa vir em ordem
    // ascendente de data (é o contrato de `buildAdsContext`/`snapshotRows`).
    const early = {
      campaignId: "111",
      date: "2026-08-10",
      campaignName: "Campanha A",
      status: "ENABLED",
      currency: "BRL",
      dims: { advertisingChannelType: "SEARCH", budgetAmount: 50 },
    };
    const late = {
      campaignId: "111",
      date: "2026-08-25",
      campaignName: "Campanha A",
      status: "PAUSED", // pausada no meio do período
      currency: "BRL",
      dims: { advertisingChannelType: "SEARCH", budgetAmount: 50 },
    };
    const ctx = composeAdsContext([agg], [early, late], WINDOW);
    expect(ctx!.campaigns[0]!.status).toBe("PAUSED"); // o dia mais recente, não o primeiro
  });
});

describe("regressão — GA4 + Ads (vazio ou preenchido) é idêntico a GA4 sozinho", () => {
  const baseOpts = {
    baselineDailyMean: 350,
    currentChannels: [
      ["Organic Search", 2000],
      ["Direct", 2800],
      ["Paid Search", 2000],
    ] as [string, number, number?][],
    previousChannels: [
      ["Organic Search", 5200],
      ["Direct", 2900],
      ["Paid Search", 2050],
    ] as [string, number, number?][],
    onsetChannel: "Organic Search",
    onsetDate: "2026-08-10",
    distinctDates: 176,
  };

  const adsFixture = composeAdsContext(
    [campaignA().agg, campaignB().agg],
    [campaignA().snapshot, campaignB().snapshot],
    { start: "2026-08-01", end: "2026-08-28" },
  );

  function runDetectors(ads: ReturnType<typeof composeAdsContext>) {
    const ctx = makeContext({ ...baseOpts, ads });
    const gates = evaluateGates(ctx);
    const produced = [
      ...detectDataQuality(ctx, gates),
      ...detectTrafficVolumeDrop(ctx, gates),
      ...detectConversionEfficiencyDrop(ctx, gates),
    ].map((i) => ({
      ...i,
      priorityScore: priorityScore(
        i,
        typeof i.gateTrace.onsetDate === "string" ? i.gateTrace.onsetDate : null,
      ),
    }));
    // conteúdo analítico relevante — não timestamps/campos técnicos (que nem existem aqui)
    return produced.map((i) => ({
      detector: i.detector,
      dedupeKey: i.dedupeKey,
      title: i.title,
      severity: i.severity,
      confidence: i.confidence,
      priorityScore: i.priorityScore,
      evidence: i.evidence,
      responsibleDimension: i.responsibleDimension,
    }));
  }

  it("ctx.ads === null (sem Ads conectado) produz exatamente os mesmos insights", () => {
    const semAds = runDetectors(null);
    const comAds = runDetectors(null); // dupla checagem: determinístico
    expect(semAds).toEqual(comAds);
    expect(semAds.length).toBeGreaterThan(0); // sanity: o cenário realmente dispara algo
  });

  it("ctx.ads preenchido (fixture com 2 campanhas) NÃO altera nenhum insight de GA4", () => {
    expect(adsFixture).not.toBeNull(); // sanity: a fixture de Ads é real, não vazia
    const semAds = runDetectors(null);
    const comAds = runDetectors(adsFixture);
    expect(comAds).toEqual(semAds);
  });
});
