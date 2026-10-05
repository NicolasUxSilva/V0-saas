/**
 * Testes da montagem do contexto (V1.1): `assembleAnalysisContext` é a parte PURA
 * de `buildAnalysisContext` — recebe os dados crus que a leitura traz do banco e
 * devolve o contexto. Aqui ela roda sobre linhas sintéticas, o que permite provar
 * o modo padrão, o período explícito e o atraso do GA4 sem nenhum banco.
 *
 * O que estes testes travam:
 *  - modo padrão: as janelas de 28 dias que os detectors sempre viram;
 *  - período explícito: a janela `current` é o período pedido, com `period.start`/
 *    `period.end` explícitos;
 *  - cobertura REAL ≠ período SOLICITADO: dia sem linha é dia sem dado, NUNCA zero.
 */
import { describe, expect, it, vi } from "vitest";

import { assembleAnalysisContext } from "@/server/analysis/context";
import { planWindows } from "@/server/analysis/period";
import type { DayPoint } from "@/server/analysis/types";

import { deal, makeRdCrm, makeRdMarketing, periodContext, range } from "./cross-source-fixtures";

// `context.ts` importa `db` (só o usa dentro de funções). Se a montagem pura tocasse o banco, o Proxy lança.
vi.mock("@/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`A montagem do contexto acessou o banco (db.${String(prop)})`);
      },
    },
  ),
}));

const point = (date: string, sessions: number, keyEvents = 0): DayPoint => ({
  date,
  sessions,
  totalUsers: sessions,
  newUsers: Math.round(sessions / 2),
  engagedSessions: Math.round(sessions / 2),
  keyEvents,
  conversionValue: 0,
});

const seg = (key: string, sessions: number) => ({
  key,
  sessions,
  totalUsers: sessions,
  newUsers: 0,
  engagedSessions: 0,
  keyEvents: 0,
  conversionValue: 0,
});

/** `assembleAnalysisContext` com tráfego sintético: `rows` = as linhas que o GA4 tem. */
function assemble(opts: {
  end: string;
  days: number;
  rows: DayPoint[];
  lastDate?: string;
  expectedLastDate?: string;
  curBySM?: ReturnType<typeof seg>[];
}) {
  const plan = planWindows(opts.end, opts.days);
  return assembleAnalysisContext({
    workspaceId: "ws-test",
    plan,
    expectedLastDate: opts.expectedLastDate ?? opts.end,
    traffic: {
      timezone: "America/Sao_Paulo",
      firstDate: opts.rows[0]?.date ?? null,
      lastDate: opts.lastDate ?? opts.rows.at(-1)?.date ?? opts.end,
      distinctDates: opts.rows.length,
      daily: opts.rows,
      curByChannel: [],
      curBySM: opts.curBySM ?? [],
      prevByChannel: [],
      prevBySM: [],
      baseByChannel: [],
      dailyByChannel: [],
    },
    ads: null,
    rdMarketing: null,
    rdCrm: null,
  });
}

/** Linhas com `sessions` em todos os dias de [start, end]. */
const filled = (start: string, end: string, sessions = 100) =>
  range(start, end).map((d) => point(d, sessions));

describe("modo padrão — as janelas que os detectors sempre viram", () => {
  const plan = planWindows("2026-10-02", 28);
  const ctx = assemble({
    end: "2026-10-02",
    days: 28,
    rows: filled(plan.baselineStart, "2026-10-02"),
    expectedLastDate: "2026-10-02",
  });

  it("current / previous / baseline: datas, tamanhos, dias com dado e totais", () => {
    expect(ctx.current).toMatchObject({
      start: "2026-09-05",
      end: "2026-10-02",
      days: 28,
      daysWithData: 28,
    });
    expect(ctx.current.totals.sessions).toBe(2800);
    expect(ctx.previous).toMatchObject({ start: "2026-08-08", end: "2026-09-04", days: 28, daysWithData: 28 });
    expect(ctx.previous.totals.sessions).toBe(2800);
    expect(ctx.baseline).toMatchObject({ start: "2026-04-10", end: "2026-08-07", days: 120, daysWithData: 120 });
    expect(ctx.baseline.totals.sessions).toBe(12000);
    expect(ctx.baselineDailySessions).toHaveLength(120);
  });

  it("o período solicitado é a própria janela current, e o fim da análise é o fim dela", () => {
    expect(ctx.period).toEqual({ start: "2026-09-05", end: "2026-10-02" });
    expect(ctx.analysisEnd).toBe("2026-10-02");
    expect(ctx.period).toEqual({ start: ctx.current.start, end: ctx.current.end });
  });

  it("a cobertura real do GA4 no período cobre a janela inteira", () => {
    expect(ctx.coverage.inPeriod).toEqual({ daysWithData: 28, firstDate: "2026-09-05", lastDate: "2026-10-02" });
    expect(ctx.coverage.expectedLastDate).toBe("2026-10-02");
    expect(ctx.coverage.expectedDays).toBe(180);
  });

  it("buraco de coleta: dia ZERADO entre dias com tráfego liga `zeroDayGap`", () => {
    const rows = filled(plan.baselineStart, "2026-10-02").map((r) =>
      r.date === "2026-09-20" ? point(r.date, 0) : r,
    );
    expect(assemble({ end: "2026-10-02", days: 28, rows }).zeroDayGap).toBe(true);
    expect(ctx.zeroDayGap).toBe(false);
  });

  it("(not set)/(direct) é a parcela das sessões da janela atual", () => {
    const withDirect = assemble({
      end: "2026-10-02",
      days: 28,
      rows: filled(plan.baselineStart, "2026-10-02"),
      curBySM: [seg("(direct) / (none)", 700), seg("google / organic", 2100)],
    });
    expect(withDirect.notSetDirectSessionShare).toBe(700 / 2800);
  });

  it("os contextos das outras fontes entram como vieram — a montagem não os recalcula", () => {
    const rdMarketing = makeRdMarketing([{ assetId: "a1", visits: 3, conversions: 0 }], {
      window: ctx.period,
      days: 28,
    });
    const rdCrm = makeRdCrm([deal({ dealCreatedAt: "2026-09-10" })], ctx.period, "2026-04-07");
    const withSources = assembleAnalysisContext({
      workspaceId: "ws-test",
      plan,
      expectedLastDate: "2026-10-02",
      traffic: {
        timezone: "America/Sao_Paulo",
        firstDate: null,
        lastDate: "2026-10-02",
        distinctDates: 0,
        daily: [],
        curByChannel: [],
        curBySM: [],
        prevByChannel: [],
        prevBySM: [],
        baseByChannel: [],
        dailyByChannel: [],
      },
      ads: null,
      rdMarketing,
      rdCrm,
    });
    expect(withSources.rdMarketing).toBe(rdMarketing); // mesma referência
    expect(withSources.rdCrm).toBe(rdCrm);
    expect(withSources.ads).toBeNull();
  });
});

describe("modo padrão com o GA4 PARADO — a janela encolhe, mas o dia esperado não", () => {
  // hoje − 2 = 02/10, porém o GA4 só tem dados até 25/09: a janela termina em 25/09 (o que os
  // detectors sempre viram) e o contexto PRESERVA que o esperado era 02/10 — é assim que o atraso fica visível
  const plan = planWindows("2026-09-25", 28);
  const ctx = assemble({
    end: "2026-09-25",
    days: 28,
    rows: filled(plan.baselineStart, "2026-09-25"),
    lastDate: "2026-09-25",
    expectedLastDate: "2026-10-02",
  });

  it("o período e o fim da análise terminam no último dia do GA4", () => {
    expect(ctx.period).toEqual({ start: "2026-08-29", end: "2026-09-25" });
    expect(ctx.analysisEnd).toBe("2026-09-25");
    expect(ctx.coverage.inPeriod).toEqual({ daysWithData: 28, firstDate: "2026-08-29", lastDate: "2026-09-25" });
  });

  it("o dia esperado do GA4 NÃO é encolhido junto: continua sendo o que se esperava", () => {
    expect(ctx.coverage.lastDate).toBe("2026-09-25");
    expect(ctx.coverage.expectedLastDate).toBe("2026-10-02");
    expect(ctx.coverage.expectedLastDate > ctx.analysisEnd).toBe(true);
  });
});

describe("período explícito 01–04/10/2026", () => {
  const plan = planWindows("2026-10-04", 4);
  const ctx = assemble({
    end: "2026-10-04",
    days: 4,
    rows: filled(plan.baselineStart, "2026-10-04", 190),
  });

  it("carrega `period.start` e `period.end` exatamente como pedidos", () => {
    expect(ctx.period).toEqual({ start: "2026-10-01", end: "2026-10-04" });
    expect(ctx.analysisEnd).toBe("2026-10-04");
  });

  it("a janela current é o período: 4 dias, só as 4 datas pedidas entram nos totais", () => {
    expect(ctx.current).toMatchObject({ start: "2026-10-01", end: "2026-10-04", days: 4, daysWithData: 4 });
    expect(ctx.current.totals.sessions).toBe(4 * 190);
  });

  it("previous tem o mesmo tamanho e termina na véspera; baseline segue com 120 dias", () => {
    expect(ctx.previous).toMatchObject({ start: "2026-09-27", end: "2026-09-30", days: 4 });
    expect(ctx.previous.totals.sessions).toBe(4 * 190);
    expect(ctx.baseline).toMatchObject({ start: "2026-05-30", end: "2026-09-26", days: 120 });
  });

  it("a cobertura real do GA4 cobre o período pedido", () => {
    expect(ctx.coverage.inPeriod).toEqual({ daysWithData: 4, firstDate: "2026-10-01", lastDate: "2026-10-04" });
    expect(ctx.coverage.expectedLastDate).toBe("2026-10-04");
  });

  it("período de um único dia", () => {
    const one = assemble({ end: "2026-10-04", days: 1, rows: filled("2026-06-05", "2026-10-04", 50) });
    expect(one.period).toEqual({ start: "2026-10-04", end: "2026-10-04" });
    expect(one.current).toMatchObject({ days: 1, daysWithData: 1 });
    expect(one.current.totals.sessions).toBe(50);
  });
});

describe("GA4 atrasado — o período solicitado NÃO é encolhido e a ausência NÃO vira zero", () => {
  // pedido 01–04/10, mas o GA4 só tem dados até 02/10
  const ctx = periodContext({
    period: { start: "2026-10-01", end: "2026-10-04" },
    ga4Days: ["2026-10-01", "2026-10-02"],
  });

  it("o período segue sendo 01–04; é a COBERTURA que termina em 02", () => {
    expect(ctx.period).toEqual({ start: "2026-10-01", end: "2026-10-04" });
    expect(ctx.analysisEnd).toBe("2026-10-04");
    expect(ctx.current).toMatchObject({ start: "2026-10-01", end: "2026-10-04", days: 4, daysWithData: 2 });
    expect(ctx.coverage.inPeriod).toEqual({ daysWithData: 2, firstDate: "2026-10-01", lastDate: "2026-10-02" });
  });

  it("os dois conceitos ficam registrados lado a lado: último dia do GA4 × dia esperado", () => {
    expect(ctx.coverage.lastDate).toBe("2026-10-02");
    expect(ctx.coverage.expectedLastDate).toBe("2026-10-04");
  });

  it("os dias sem linha não são inventados: totais só das linhas que existem, e nada de linha zerada", () => {
    expect(ctx.current.totals.sessions).toBe(2 * 190);
    const days = ctx.dailySeries.map((d) => d.date);
    expect(days).not.toContain("2026-10-03");
    expect(days).not.toContain("2026-10-04");
  });

  it("linha com 0 sessões É dado válido: conta na cobertura, inclusive nas pontas (zero registrado ≠ ausência)", () => {
    const rows = [point("2026-10-01", 0), point("2026-10-02", 120), point("2026-10-03", 130), point("2026-10-04", 0)];
    const c = assemble({ end: "2026-10-04", days: 4, rows });
    // cobertura por EXISTÊNCIA de linha: os 4 dias têm linha, dois deles com valor zero
    expect(c.coverage.inPeriod).toEqual({ daysWithData: 4, firstDate: "2026-10-01", lastDate: "2026-10-04" });
    expect(c.current.totals.sessions).toBe(250); // o zero entra na soma como zero
    // o `daysWithData` da janela segue contando só dias com sessões > 0 — é o que gates e
    // detectors sempre usaram e não pode mudar
    expect(c.current.daysWithData).toBe(2);
  });

  it("a MESMA soma de sessões, com e sem linha, dá coberturas diferentes: o que importa é a linha, não o valor", () => {
    const withZeroRows = assemble({
      end: "2026-10-04",
      days: 4,
      rows: [point("2026-10-01", 100), point("2026-10-02", 100), point("2026-10-03", 0), point("2026-10-04", 0)],
    });
    const withoutRows = assemble({
      end: "2026-10-04",
      days: 4,
      rows: [point("2026-10-01", 100), point("2026-10-02", 100)],
    });
    expect(withZeroRows.current.totals.sessions).toBe(withoutRows.current.totals.sessions);
    expect(withZeroRows.coverage.inPeriod).toEqual({ daysWithData: 4, firstDate: "2026-10-01", lastDate: "2026-10-04" });
    expect(withoutRows.coverage.inPeriod).toEqual({ daysWithData: 2, firstDate: "2026-10-01", lastDate: "2026-10-02" });
  });

  it("dia SEM linha é ausência de dado: não entra na cobertura e não vira linha zerada na série", () => {
    const c = assemble({ end: "2026-10-04", days: 4, rows: [point("2026-10-01", 50), point("2026-10-04", 70)] });
    expect(c.coverage.inPeriod).toEqual({ daysWithData: 2, firstDate: "2026-10-01", lastDate: "2026-10-04" });
    expect(c.dailySeries.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-04"]);
  });

  it("GA4 sem nenhum dia no período → cobertura vazia, sem datas", () => {
    const c = assemble({ end: "2026-10-04", days: 4, rows: [], lastDate: "2026-09-20" });
    expect(c.coverage.inPeriod).toEqual({ daysWithData: 0, firstDate: null, lastDate: null });
    expect(c.current.totals.sessions).toBe(0);
  });
});

describe("não mistura o que está fora do período", () => {
  it("linhas anteriores ao período entram em previous/baseline, nunca em current", () => {
    const rows = [...filled("2026-09-27", "2026-09-30", 1000), ...filled("2026-10-01", "2026-10-04", 10)];
    const c = assemble({ end: "2026-10-04", days: 4, rows });
    expect(c.current.totals.sessions).toBe(40);
    expect(c.previous.totals.sessions).toBe(4000);
  });
});
