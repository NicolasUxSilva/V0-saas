/**
 * Testes do contexto composto de RD Station (bloco RD-1).
 *
 * `composeRdMarketingContext`/`composeRdCrmContext` são puras (não tocam o
 * banco) — os testes de composição usam fixtures pequenas e determinísticas,
 * simulando o shape das queries que `buildRdMarketingContext`/`buildRdCrmContext`
 * rodam contra `fact_conversion_assets_daily`/`fact_deals`.
 *
 * A seção de regressão prova, com os detectores REAIS (não um mock), que
 * `ctx.rdMarketing`/`ctx.rdCrm` — vazios ou preenchidos — nunca mudam o
 * resultado GA4: os detectores simplesmente não leem esses campos (ver
 * orchestration.test.ts).
 */
import { describe, expect, it } from "vitest";

import {
  detectConversionEfficiencyDrop,
  detectDataQuality,
  detectTrafficVolumeDrop,
} from "@/server/analysis/detectors";
import { evaluateGates } from "@/server/analysis/gates";
import { priorityScore } from "@/server/analysis/scoring";

import { composeRdCrmContext, composeRdMarketingContext } from "@/server/analysis/context";

import { makeContext } from "./fixtures";

const WINDOW = { start: "2026-08-01", end: "2026-08-28" };

// ── composeRdMarketingContext ───────────────────────────────────────────

function assetA() {
  return {
    agg: {
      assetId: "111",
      visits: 1000,
      conversions: 50,
      conversionRate: 0.05,
    },
    snapshot: {
      assetId: "111",
      date: "2026-08-28",
      assetIdentifier: "LP Black Friday",
      assetType: "LandingPage",
    },
  };
}

function assetB() {
  return {
    agg: {
      assetId: "222",
      visits: 400,
      conversions: 0,
      // nunca reportado pela fonte — precisa continuar `null`, não 0
      conversionRate: null,
    },
    snapshot: {
      assetId: "222",
      date: "2026-08-28",
      assetIdentifier: "Form contato",
      assetType: "Forms",
    },
  };
}

describe("composeRdMarketingContext — composição do contexto (RD-1C)", () => {
  it("vazio (sem linhas na janela) → contexto ausente de forma explícita, não zeros", () => {
    expect(composeRdMarketingContext([], [], WINDOW)).toBeNull();
  });

  it("1 ativo com dados → todos os campos chegam ao contexto", () => {
    const a = assetA();
    const ctx = composeRdMarketingContext([a.agg], [a.snapshot], WINDOW);

    expect(ctx).not.toBeNull();
    expect(ctx!.window).toEqual(WINDOW);
    expect(ctx!.assetCount).toBe(1);
    expect(ctx!.totals).toEqual({ visits: 1000, conversions: 50 });
    expect(ctx!.assets[0]).toEqual({
      assetId: "111",
      assetIdentifier: "LP Black Friday",
      assetType: "LandingPage",
      visits: 1000,
      conversions: 50,
      conversionRate: 0.05,
    });
  });

  it("múltiplos ativos → agregação workspace-level correta + granularidade por ativo preservada", () => {
    const a = assetA();
    const b = assetB();
    const ctx = composeRdMarketingContext([a.agg, b.agg], [a.snapshot, b.snapshot], WINDOW);

    expect(ctx!.assetCount).toBe(2);
    expect(ctx!.totals).toEqual({ visits: 1400, conversions: 50 });
    const byId = Object.fromEntries(ctx!.assets.map((x) => [x.assetId, x]));
    expect(byId["111"]!.visits).toBe(1000);
    expect(byId["222"]!.visits).toBe(400);
  });

  it("conversionRate ausente continua `null` (não vira 0)", () => {
    const b = assetB();
    const ctx = composeRdMarketingContext([b.agg], [b.snapshot], WINDOW);
    expect(ctx!.assets[0]!.conversionRate).toBeNull();
  });

  it("ativo sem snapshot correspondente → defaults honestos, não erro", () => {
    const a = assetA();
    const ctx = composeRdMarketingContext([a.agg], [], WINDOW);
    expect(ctx!.assets[0]!.assetIdentifier).toBe("");
    expect(ctx!.assets[0]!.assetType).toBe("");
  });

  it("identificador/tipo são o snapshot do dia MAIS RECENTE do ativo na janela", () => {
    const agg = assetA().agg;
    const early = {
      assetId: "111",
      date: "2026-08-10",
      assetIdentifier: "LP antiga",
      assetType: "LandingPage",
    };
    const late = {
      assetId: "111",
      date: "2026-08-25",
      assetIdentifier: "LP Black Friday",
      assetType: "LandingPage",
    };
    const ctx = composeRdMarketingContext([agg], [early, late], WINDOW);
    expect(ctx!.assets[0]!.assetIdentifier).toBe("LP Black Friday");
  });
});

// ── composeRdCrmContext ──────────────────────────────────────────────────

describe("composeRdCrmContext — composição do contexto (RD-1E)", () => {
  it("vazio (nenhuma negociação toca a janela) → contexto ausente de forma explícita", () => {
    expect(composeRdCrmContext([], WINDOW)).toBeNull();
  });

  it("negociação criada na janela (ainda aberta) → só entra em created, não em won/lost", () => {
    const ctx = composeRdCrmContext(
      [
        {
          status: "ongoing",
          totalPrice: 1000,
          pipelineId: "p1",
          dealCreatedAt: "2026-08-10",
          dealClosedAt: null,
        },
      ],
      WINDOW,
    );
    expect(ctx!.totals).toEqual({
      createdCount: 1,
      createdTotalPriceSum: 1000,
      wonCount: 0,
      wonTotalPriceSum: 0,
      lostCount: 0,
    });
  });

  it("negociação GANHA na janela → entra em won, usando deal_closed_at (não deal_created_at)", () => {
    const ctx = composeRdCrmContext(
      [
        {
          status: "won",
          totalPrice: 2000,
          pipelineId: "p1",
          // criada MUITO antes da janela — só o fechamento cai nela
          dealCreatedAt: "2026-01-05",
          dealClosedAt: "2026-08-15",
        },
      ],
      WINDOW,
    );
    expect(ctx!.totals.createdCount).toBe(0); // created_at fora da janela
    expect(ctx!.totals.wonCount).toBe(1);
    expect(ctx!.totals.wonTotalPriceSum).toBe(2000);
  });

  it("negociação PERDIDA na janela → entra em lost, sem somar valor (só contagem)", () => {
    const ctx = composeRdCrmContext(
      [
        {
          status: "lost",
          totalPrice: 500,
          pipelineId: "p1",
          dealCreatedAt: "2026-07-01",
          dealClosedAt: "2026-08-20",
        },
      ],
      WINDOW,
    );
    expect(ctx!.totals.lostCount).toBe(1);
    expect(ctx!.totals.wonCount).toBe(0);
  });

  it("negociação criada E fechada dentro da mesma janela → conta nos dois baldes (created e won)", () => {
    const ctx = composeRdCrmContext(
      [
        {
          status: "won",
          totalPrice: 300,
          pipelineId: "p1",
          dealCreatedAt: "2026-08-05",
          dealClosedAt: "2026-08-12",
        },
      ],
      WINDOW,
    );
    expect(ctx!.totals.createdCount).toBe(1);
    expect(ctx!.totals.wonCount).toBe(1);
  });

  it("múltiplos pipelines → agregação workspace-level correta + granularidade por pipeline preservada", () => {
    const ctx = composeRdCrmContext(
      [
        { status: "ongoing", totalPrice: 100, pipelineId: "p1", dealCreatedAt: "2026-08-02", dealClosedAt: null },
        { status: "ongoing", totalPrice: 200, pipelineId: "p2", dealCreatedAt: "2026-08-03", dealClosedAt: null },
      ],
      WINDOW,
    );
    expect(ctx!.pipelineCount).toBe(2);
    expect(ctx!.totals.createdCount).toBe(2);
    expect(ctx!.totals.createdTotalPriceSum).toBe(300);
    const byPipeline = Object.fromEntries(ctx!.pipelines.map((p) => [p.pipelineId, p]));
    expect(byPipeline.p1!.createdTotalPriceSum).toBe(100);
    expect(byPipeline.p2!.createdTotalPriceSum).toBe(200);
  });

  it("janela temporal: o contexto reporta exatamente a janela recebida", () => {
    const otherWindow = { start: "2026-07-01", end: "2026-07-28" };
    const ctx = composeRdCrmContext(
      [{ status: "ongoing", totalPrice: 1, pipelineId: "p1", dealCreatedAt: "2026-07-10", dealClosedAt: null }],
      otherWindow,
    );
    expect(ctx!.window).toEqual(otherWindow);
    expect(ctx!.window).not.toEqual(WINDOW);
  });
});

// ── extensão aditiva do contexto para a camada Cross-source V1 ───────────────
// `totals`/`pipelines` (acima) não mudam; o que entra é cobertura diária do
// Marketing e detalhe de estado/valor/origem do CRM — tudo calculado nas mesmas
// linhas que a composição já recebe, sem query nova.

describe("composeRdMarketingContext — cobertura diária da própria fonte (Cross-source V1)", () => {
  const snap = (assetId: string, date: string) => ({
    assetId,
    date,
    assetIdentifier: `LP ${assetId}`,
    assetType: "LandingPage",
  });

  it("conta DIAS distintos com linha (2 ativos × 3 dias = 3 dias, não 6) e informa o 1º/último dia", () => {
    const a = assetA();
    const ctx = composeRdMarketingContext(
      [a.agg],
      [
        snap("111", "2026-08-03"),
        snap("222", "2026-08-03"),
        snap("111", "2026-08-04"),
        snap("222", "2026-08-04"),
        snap("111", "2026-08-10"),
        snap("222", "2026-08-10"),
      ],
      WINDOW,
    );
    expect(ctx!.coverage).toEqual({
      daysWithData: 3,
      firstDate: "2026-08-03",
      lastDate: "2026-08-10",
    });
  });

  it("linhas fora da janela não contam para a cobertura", () => {
    const a = assetA();
    const ctx = composeRdMarketingContext(
      [a.agg],
      [snap("111", "2026-07-31"), snap("111", "2026-08-05"), snap("111", "2026-08-29")],
      WINDOW,
    );
    expect(ctx!.coverage).toEqual({
      daysWithData: 1,
      firstDate: "2026-08-05",
      lastDate: "2026-08-05",
    });
  });

  it("ativos sem nenhuma linha de snapshot → cobertura zerada com datas `null` (não inventa dia)", () => {
    const ctx = composeRdMarketingContext([assetA().agg], [], WINDOW);
    expect(ctx!.coverage).toEqual({ daysWithData: 0, firstDate: null, lastDate: null });
  });
});

describe("composeRdCrmContext — detalhe de estado/valor/origem (Cross-source V1)", () => {
  type Row = Parameters<typeof composeRdCrmContext>[0][number];
  const deal = (over: Partial<Row> = {}): Row => ({
    status: "ongoing",
    totalPrice: 0,
    pipelineId: "p1",
    dealCreatedAt: "2026-08-10",
    dealClosedAt: null,
    sourceId: "src-1",
    campaignId: "",
    ...over,
  });

  it("`totals` e `pipelines` continuam exatamente no formato do RD-1 (sem campos novos)", () => {
    const ctx = composeRdCrmContext([deal({ totalPrice: 100 })], WINDOW);
    expect(Object.keys(ctx!.totals).sort()).toEqual([
      "createdCount",
      "createdTotalPriceSum",
      "lostCount",
      "wonCount",
      "wonTotalPriceSum",
    ]);
    expect(Object.keys(ctx!.pipelines[0]!).sort()).toEqual([
      "createdCount",
      "createdTotalPriceSum",
      "lostCount",
      "pipelineId",
      "wonCount",
      "wonTotalPriceSum",
    ]);
  });

  it("createdOpenCount conta só criadas NA janela que seguem `ongoing` (ganha/perdida/pausada ficam de fora)", () => {
    const ctx = composeRdCrmContext(
      [
        deal({ status: "ongoing" }),
        deal({ status: "ongoing" }),
        deal({ status: "won", dealClosedAt: "2026-08-12" }),
        deal({ status: "lost", dealClosedAt: "2026-08-13" }),
        deal({ status: "paused" }),
        // aberta, mas criada ANTES da janela → entra por outro motivo (fechada na janela)
        deal({ status: "ongoing", dealCreatedAt: "2026-01-05" }),
      ],
      WINDOW,
    );
    expect(ctx!.totals.createdCount).toBe(5);
    expect(ctx!.detail.createdOpenCount).toBe(2);
  });

  it("wonWithValueCount e lostWithValueCount contam só total_price > 0; lostTotalPriceSum soma o valor perdido", () => {
    const ctx = composeRdCrmContext(
      [
        deal({ status: "won", totalPrice: 1000, dealClosedAt: "2026-08-11" }),
        deal({ status: "won", totalPrice: 0, dealClosedAt: "2026-08-12" }),
        deal({ status: "lost", totalPrice: 300, dealClosedAt: "2026-08-13" }),
        deal({ status: "lost", totalPrice: 200, dealClosedAt: "2026-08-14" }),
        deal({ status: "lost", totalPrice: 0, dealClosedAt: "2026-08-15" }),
      ],
      WINDOW,
    );
    expect(ctx!.totals.wonCount).toBe(2);
    expect(ctx!.detail.wonWithValueCount).toBe(1);
    expect(ctx!.totals.lostCount).toBe(3);
    expect(ctx!.detail.lostWithValueCount).toBe(2);
    expect(ctx!.detail.lostTotalPriceSum).toBe(500);
  });

  it("origem: só valor NÃO vazio conta como preenchido (`''`, espaços e ausente = sem origem/campanha)", () => {
    const ctx = composeRdCrmContext(
      [
        deal({ sourceId: "src-1", campaignId: "camp-1" }),
        deal({ sourceId: "src-1", campaignId: "" }),
        deal({ sourceId: "  ", campaignId: "   " }),
        deal({ sourceId: "", campaignId: "" }),
        deal({ sourceId: undefined, campaignId: undefined }),
      ],
      WINDOW,
    );
    expect(ctx!.attribution.created).toEqual({
      total: 5,
      withSourceId: 2,
      withCampaignId: 1,
      distinctSourceIds: 1,
    });
  });

  it("distinctSourceIds conta valores distintos (e ignora espaços nas pontas)", () => {
    const ctx = composeRdCrmContext(
      [
        deal({ sourceId: "a" }),
        deal({ sourceId: "b" }),
        deal({ sourceId: " a " }),
        deal({ sourceId: "c" }),
      ],
      WINDOW,
    );
    expect(ctx!.attribution.created.withSourceId).toBe(4);
    expect(ctx!.attribution.created.distinctSourceIds).toBe(3);
  });

  it("a população `won` é só quem foi GANHO na janela — independe de quando foi criada", () => {
    const ctx = composeRdCrmContext(
      [
        // criada antes da janela, ganha dentro dela → conta em `won`, não em `created`
        deal({ status: "won", dealCreatedAt: "2026-01-05", dealClosedAt: "2026-08-12", sourceId: "src-1", campaignId: "camp-9" }),
        // criada dentro, ainda aberta → conta em `created`, não em `won`
        deal({ status: "ongoing", sourceId: "", campaignId: "" }),
      ],
      WINDOW,
    );
    expect(ctx!.attribution.won).toEqual({
      total: 1,
      withSourceId: 1,
      withCampaignId: 1,
      distinctSourceIds: 1,
    });
    expect(ctx!.attribution.created).toEqual({
      total: 1,
      withSourceId: 0,
      withCampaignId: 0,
      distinctSourceIds: 0,
    });
  });

  it("população vazia → contagens 0 (nunca NaN/undefined)", () => {
    const ctx = composeRdCrmContext([deal({ status: "ongoing" })], WINDOW);
    expect(ctx!.attribution.won).toEqual({
      total: 0,
      withSourceId: 0,
      withCampaignId: 0,
      distinctSourceIds: 0,
    });
    expect(ctx!.detail.lostTotalPriceSum).toBe(0);
  });
});

describe("composeRdCrmContext — cobertura do histórico importado (V1.1)", () => {
  const rows = [
    {
      status: "ongoing",
      totalPrice: 0,
      pipelineId: "p1",
      dealCreatedAt: "2026-08-10",
      dealClosedAt: null,
    },
  ];

  it("sem informação sobre o histórico → `null`: o contexto não afirma que é completo nem parcial", () => {
    expect(composeRdCrmContext(rows, WINDOW)!.coverage).toEqual({ importedHistoryStartDate: null });
  });

  it("repassa o início do histórico de CRM IMPORTADO no SaaS, sem interpretar (não é o início do histórico real do CRM)", () => {
    expect(composeRdCrmContext(rows, WINDOW, "2026-04-07")!.coverage).toEqual({
      importedHistoryStartDate: "2026-04-07",
    });
    // mesmo um início DEPOIS da janela é só um dado — quem interpreta é o Cross-source
    expect(composeRdCrmContext(rows, WINDOW, "2026-12-01")!.coverage.importedHistoryStartDate).toBe("2026-12-01");
  });

  it("a cobertura não altera `totals`, `pipelines` nem o detalhe", () => {
    const without = composeRdCrmContext(rows, WINDOW)!;
    const withHistory = composeRdCrmContext(rows, WINDOW, "2026-04-07")!;
    expect(withHistory.totals).toEqual(without.totals);
    expect(withHistory.pipelines).toEqual(without.pipelines);
    expect(withHistory.detail).toEqual(without.detail);
    expect(withHistory.attribution).toEqual(without.attribution);
  });

  it("janela vazia continua `null`, com ou sem histórico informado", () => {
    expect(composeRdCrmContext([], WINDOW, "2026-04-07")).toBeNull();
  });
});

// ── regressão — GA4 + RD Station (vazio ou preenchido) é idêntico a GA4 sozinho ──

describe("regressão — GA4 + RD Station (vazio ou preenchido) é idêntico a GA4 sozinho", () => {
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

  const rdMarketingFixture = composeRdMarketingContext(
    [assetA().agg, assetB().agg],
    [assetA().snapshot, assetB().snapshot],
    WINDOW,
  );
  const rdCrmFixture = composeRdCrmContext(
    [
      { status: "won", totalPrice: 2000, pipelineId: "p1", dealCreatedAt: "2026-08-05", dealClosedAt: "2026-08-12" },
      { status: "lost", totalPrice: 500, pipelineId: "p1", dealCreatedAt: "2026-07-01", dealClosedAt: "2026-08-20" },
    ],
    WINDOW,
  );

  function runDetectors(
    rdMarketing: ReturnType<typeof composeRdMarketingContext>,
    rdCrm: ReturnType<typeof composeRdCrmContext>,
  ) {
    const ctx = makeContext({ ...baseOpts, rdMarketing, rdCrm });
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

  it("ctx.rdMarketing === null && ctx.rdCrm === null produz exatamente os mesmos insights em execuções repetidas", () => {
    const run1 = runDetectors(null, null);
    const run2 = runDetectors(null, null);
    expect(run1).toEqual(run2);
    expect(run1.length).toBeGreaterThan(0); // sanity: o cenário realmente dispara algo
  });

  it("ctx.rdMarketing/ctx.rdCrm preenchidos NÃO alteram nenhum insight de GA4", () => {
    expect(rdMarketingFixture).not.toBeNull(); // sanity: as fixtures são reais, não vazias
    expect(rdCrmFixture).not.toBeNull();
    const semRd = runDetectors(null, null);
    const comRd = runDetectors(rdMarketingFixture, rdCrmFixture);
    expect(comRd).toEqual(semRd);
  });
});
