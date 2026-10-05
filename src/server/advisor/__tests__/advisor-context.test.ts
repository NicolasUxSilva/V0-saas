/**
 * AdvisorContext — o contrato de entrada da camada de IA.
 *
 * O que estes testes travam: período correto, fontes presentes, evidência e
 * limitações PRESERVADAS (verbatim), camadas separadas, ausência ≠ zero, e que a
 * composição é pura (mesma entrada ⇒ mesma saída, entrada nunca mutada).
 */
import { describe, expect, it } from "vitest";

import { deepFreeze } from "@/server/analysis/__tests__/cross-source-asserts";
import { createMemoryStore } from "@/server/analysis/__tests__/cross-source-store-memory";
import { canonicalJson } from "@/server/analysis/cross-source";
import { getCrossSourceInsights } from "@/server/analysis/cross-source-store";

import { AdvisorContextError, composeAdvisorContext, figuresOf } from "../compose";
import { buildAdvisorContext } from "../context";
import { displayValue } from "../format";
import type { AdvisorContext, AdvisorEvidence } from "../types";
import {
  NOW,
  OCT,
  OCT_GA4_ROWS,
  OCT_PERIOD,
  SEP_PERIOD,
  WS,
  diagnosticItem,
  makeRdCrm,
  octoberContext,
  octoberCrmRows,
  persist,
  septemberContext,
  sourcesFrom,
} from "./advisor-fixtures";

async function build(
  ctx = octoberContext(),
  diagnostics = [diagnosticItem()],
  period = OCT_PERIOD,
): Promise<AdvisorContext> {
  const memory = await persist(ctx, period);
  return buildAdvisorContext(WS, period, {}, sourcesFrom(memory, diagnostics));
}

const byId = (c: AdvisorContext, id: string): AdvisorEvidence | undefined =>
  c.evidence.find((e) => `${e.source}.${e.metric}` === id);

describe("AdvisorContext — período e identidade", () => {
  it("carrega workspace, versão, relógio injetado e o período pedido (4 dias, inclusivo)", async () => {
    const c = await build();
    expect(c.schemaVersion).toBe(1);
    expect(c.workspaceId).toBe(WS);
    expect(c.generatedAt).toBe(NOW.toISOString());
    expect(c.period).toEqual({ startDate: "2026-10-01", endDate: "2026-10-04", days: 4 });
  });

  it("período inválido falha antes de qualquer leitura", async () => {
    let reads = 0;
    const deps = {
      readCrossSource: async () => {
        reads++;
        throw new Error("não deveria ler");
      },
      readDiagnostics: async () => {
        reads++;
        return [];
      },
    };
    for (const period of [
      { startDate: "2026-10-05", endDate: "2026-10-01" },
      { startDate: "2026-02-30", endDate: "2026-03-01" },
      { startDate: "ontem", endDate: "hoje" },
    ]) {
      await expect(buildAdvisorContext(WS, period, {}, deps)).rejects.toThrow(/Período inválido/);
    }
    await expect(
      buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: { startDate: "x", endDate: "y" } }, deps),
    ).rejects.toThrow(/Período inválido/);
    expect(reads).toBe(0);
  });

  it("lê o workspace e o período pedidos — nada além disso", async () => {
    const calls: unknown[][] = [];
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const base = sourcesFrom(memory);
    await buildAdvisorContext(WS, OCT_PERIOD, {}, {
      ...base,
      readCrossSource: async (ws, p) => {
        calls.push(["cross", ws, p]);
        return base.readCrossSource!(ws, p);
      },
      readDiagnostics: async (ws) => {
        calls.push(["diag", ws]);
        return [];
      },
    });
    expect(calls).toContainEqual(["cross", WS, OCT_PERIOD]);
    expect(calls).toContainEqual(["diag", WS]);
    expect(calls).toHaveLength(2);
  });
});

describe("AdvisorContext — fontes presentes", () => {
  it("as três fontes, na ordem, todas cobertas, com os dias do Cross-source (4 de 4)", async () => {
    const c = await build();
    expect(c.sources.map((s) => s.source)).toEqual(["ga4", "rd_marketing", "rd_crm"]);
    expect(c.sources.map((s) => s.status)).toEqual(["covered", "covered", "covered"]);

    const [ga4, rdm, crm] = c.sources;
    expect([ga4?.daysWithData, ga4?.periodDays]).toEqual([4, 4]);
    expect([rdm?.daysWithData, rdm?.periodDays]).toEqual([4, 4]);
    // o CRM é evento a evento: não tem "dias com dado" — e o contexto NÃO inventa um 0
    expect([crm?.daysWithData, crm?.periodDays]).toEqual([null, null]);
    expect(ga4?.limitationCodes).toEqual([]);
  });

  it("o estado do Cross-source: gerado, quando e quais insights", async () => {
    const c = await build();
    expect(c.crossSource.status).toBe("generated");
    expect(c.crossSource.generatedAt).toBe("2026-10-04T20:10:55.505Z");
    expect(c.crossSource.schemaVersion).toBe(1);
    expect(c.crossSource.insights.map((i) => i.type)).toEqual([
      "data-coverage",
      "acquisition-coverage",
      "traffic-and-rd-conversions",
      "commercial-activity",
      "commercial-vs-acquisition",
      "attribution-quality",
      "population-not-comparable",
      "metric-not-computable",
    ]);
  });

  it("os números de fechamento saem do Cross-source: 487 · 6/0 · 9/5/14 · 23.399,00", async () => {
    const c = await build();
    const display = (id: string) => byId(c, id)?.display;
    expect(display("ga4.sessions")).toBe("487");
    expect(display("rd_marketing.visits")).toBe("6");
    expect(display("rd_marketing.conversions")).toBe("0");
    expect(display("rd_crm.created_deals")).toBe("9");
    expect(display("rd_crm.won_deals")).toBe("5");
    expect(display("rd_crm.lost_deals")).toBe("14");
    expect(display("rd_crm.won_value")).toBe("23.399,00");
    // a moeda NÃO foi informada pelo CRM: o valor sai sem símbolo e a moeda é `null`
    expect(byId(c, "rd_crm.won_value")?.currency).toBeNull();
    expect(byId(c, "rd_crm.won_deals_with_value")?.display).toBe("1");
  });

  it("perdidos com valor registrado é CONTAGEM (\"0\"), nunca dinheiro (\"0,00\"); o valor perdido é ausência (null)", async () => {
    const c = await build();
    const count = byId(c, "rd_crm.lost_deals_with_value");
    expect(count).toMatchObject({ value: 0, format: "count", display: "0" });
    expect(count).not.toHaveProperty("currency"); // moeda só existe em evidência de dinheiro
    expect(byId(c, "rd_crm.lost_value")).toMatchObject({
      value: null,
      format: "currency",
      currency: null,
      display: null,
    });
    expect(byId(c, "rd_crm.lost_deals")?.display).toBe("14");
  });
});

describe("AdvisorContext — evidência e limitações PRESERVADAS", () => {
  it("cada ponto de evidência do Cross-source está no registro com os mesmos campos", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const stored = await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store });
    const c = await buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(memory));

    const registry = new Map(c.evidence.map((e) => [e.ref, e] as const));
    let seen = 0;
    for (const insight of stored.insights) {
      for (const point of insight.evidence) {
        const e = registry.get(`${point.id}@${point.period.start}..${point.period.end}`);
        expect(e, point.id).toBeDefined();
        expect(e).toMatchObject({
          source: point.source,
          metric: point.metric,
          label: point.label,
          period: point.period,
          value: point.value,
          format: point.format,
        });
        expect(e?.display).toBe(displayValue(point));
        if (point.currency !== undefined) expect(e?.currency).toBe(point.currency);
        if (point.note) expect(e?.note).toBe(point.note);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(30);
    // o registro é deduplicado: o mesmo ponto citado por vários insights aparece uma vez
    expect(c.evidence.length).toBeLessThan(seen);
    expect(new Set(c.evidence.map((e) => e.ref)).size).toBe(c.evidence.length);
  });

  it("toda limitação do Cross-source (código e texto, sem reescrita) está em `limitations`, com gravidade", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const stored = await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store });
    const c = await buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(memory));

    const expected = stored.insights.flatMap((i) =>
      i.statements.filter((s) => s.layer === "limitation").map((s) => ({ code: s.code, text: s.text })),
    );
    expect(expected.length).toBeGreaterThan(15);
    for (const e of expected) {
      const found = c.limitations.find((l) => l.code === e.code && l.message === e.text);
      expect(found, `${e.code}`).toBeDefined();
      expect(found?.origin).toBe("cross_source");
      expect(["blocking", "warning", "info"]).toContain(found?.severity);
    }
    // gravidades que o produto espera ver
    const sev = (code: string) => c.limitations.find((l) => l.code === code)?.severity;
    expect(sev("currency_not_informed")).toBe("warning");
    expect(sev("won_value_partial")).toBe("warning");
    expect(sev("attribution_not_supported")).toBe("info");
    expect(sev("not_computed:cac")).toBe("info");
    expect(sev("metric_not_computable:lost_value")).toBe("warning");
  });

  it("limitação idêntica em dois insights vira uma só (e nenhum texto some)", async () => {
    // CRM com histórico importado que começa DEPOIS do início do período: o Cross-source
    // emite `rd_crm_partial_imported_history` em `partial-period` e em `commercial-activity`
    const ctx = octoberContext({ rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-10-03") });
    const memory = await persist(ctx, OCT_PERIOD);
    const stored = await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store });
    const emitted = stored.insights.flatMap((i) =>
      i.statements.filter((s) => s.code === "rd_crm_partial_imported_history"),
    );
    expect(emitted.length).toBe(2);

    const c = await buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(memory));
    const kept = c.limitations.filter((l) => l.code === "rd_crm_partial_imported_history");
    expect(kept).toHaveLength(1);
    expect(kept[0]?.message).toBe(emitted[0]?.text);
    // as evidências das duas ocorrências foram somadas
    expect(kept[0]?.evidenceRefs.length).toBeGreaterThanOrEqual(1);
  });

  it("as camadas ficam SEPARADAS: nenhuma frase aparece em duas camadas", async () => {
    const c = await build();
    const texts = {
      facts: c.facts.map((s) => s.text),
      observations: c.observations.map((s) => s.text),
      hypotheses: c.hypotheses.map((h) => h.text),
      limitations: c.limitations.map((l) => l.message),
    };
    expect(c.facts.every((s) => s.layer === "fact")).toBe(true);
    expect(c.observations.every((s) => s.layer === "observable_relationship")).toBe(true);
    const all = Object.entries(texts).flatMap(([layer, list]) => list.map((t) => [t, layer] as const));
    for (const [text, layer] of all) {
      const layers = new Set(all.filter(([t]) => t === text).map(([, l]) => l));
      expect(layers.size, `${layer}: ${text}`).toBe(1);
    }
    // fatos e observações citam evidência que existe no registro
    const refs = new Set(c.evidence.map((e) => e.ref));
    for (const s of [...c.facts, ...c.observations]) {
      for (const ref of s.evidenceRefs) expect(refs.has(ref), ref).toBe(true);
    }
  });

  it("hipóteses (do Cross-source e do motor) ficam marcadas, com a origem", async () => {
    const c = await build();
    const origins = new Set(c.hypotheses.map((h) => h.origin));
    expect(origins).toEqual(new Set(["cross_source", "diagnostics"]));
    const fromMotor = c.hypotheses.find((h) => h.origin === "diagnostics");
    expect(fromMotor?.from).toBe("data-quality:no_key_events");
    expect(fromMotor?.text).toMatch(/key event/);
    // uma hipótese NÃO é um fato: não está na lista de fatos
    const factTexts = new Set(c.facts.map((s) => s.text));
    for (const h of c.hypotheses) expect(factTexts.has(h.text)).toBe(false);
  });

  it("`figuresOf` devolve só evidência citada por FATOS, uma vez cada, na ordem de aparição", async () => {
    const c = await build();
    const figures = figuresOf(c);
    expect(new Set(figures.map((f) => f.ref)).size).toBe(figures.length);
    const cited = new Set(c.facts.flatMap((s) => s.evidenceRefs));
    for (const f of figures) expect(cited.has(f.ref)).toBe(true);
    expect(figuresOf(c, "ga4").every((f) => f.source === "ga4")).toBe(true);
  });
});

describe("AdvisorContext — ausência ≠ zero", () => {
  it("GA4 sem NENHUMA linha: sessões `null` (nunca 0), fonte `unavailable`, limitação bloqueante", async () => {
    const c = await build(octoberContext({ ga4Days: [] }));
    const sessions = byId(c, "ga4.sessions");
    expect(sessions?.value).toBeNull();
    expect(sessions?.display).toBeNull();
    expect(sessions?.note).toMatch(/ausência de dado, não zero/);

    const ga4 = c.sources.find((s) => s.source === "ga4");
    expect(ga4?.status).toBe("unavailable");
    expect(ga4?.limitationCodes).toContain("ga4_unavailable");
    expect(c.limitations.find((l) => l.code === "ga4_unavailable")?.severity).toBe("blocking");
  });

  it("RD Marketing e RD CRM ausentes: `unavailable`, SEM nenhuma figura de visitas/negócios", async () => {
    const c = await build(octoberContext({ rdMarketing: null, rdCrm: null }));
    expect(c.sources.map((s) => s.status)).toEqual(["covered", "unavailable", "unavailable"]);
    for (const id of ["rd_marketing.visits", "rd_marketing.conversions", "rd_crm.created_deals", "rd_crm.won_deals"]) {
      expect(byId(c, id), id).toBeUndefined();
    }
    expect(c.limitations.map((l) => l.code)).toEqual(
      expect.arrayContaining(["rd_marketing_unavailable", "rd_crm_unavailable"]),
    );
  });

  it("zero registrado NÃO é ausência: GA4 com linhas zeradas tem 0 sessões, cobertura inteira e `covered`", async () => {
    const zeroRows = OCT_GA4_ROWS.map((r) => ({ ...r, sessions: 0 }));
    const c = await build(octoberContext({ ga4Rows: zeroRows }));
    const sessions = byId(c, "ga4.sessions");
    expect(sessions?.value).toBe(0);
    expect(sessions?.display).toBe("0");
    expect(c.sources.find((s) => s.source === "ga4")?.status).toBe("covered");
    expect(c.limitations.some((l) => l.code === "ga4_unavailable")).toBe(false);
  });

  it("valor que o Cross-source não calculou continua `null`: perdido sem valor nunca vira 0", async () => {
    const c = await build();
    const lostValue = byId(c, "rd_crm.lost_value");
    expect(lostValue?.value).toBeNull();
    expect(lostValue?.display).toBeNull();
    expect(lostValue?.note).toMatch(/nenhum dos 14 negócios perdidos/);
  });

  it("Cross-source NÃO gerado: todas as fontes `unknown`, nenhuma figura, limitação bloqueante", async () => {
    const memory = createMemoryStore();
    const c = await buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(memory, []));
    expect(c.crossSource).toEqual({ status: "not_generated", generatedAt: null, schemaVersion: null, insights: [] });
    expect(c.sources.map((s) => s.status)).toEqual(["unknown", "unknown", "unknown"]);
    expect(c.sources.every((s) => s.daysWithData === null && s.periodDays === null)).toBe(true);
    expect(c.evidence).toEqual([]);
    expect(c.facts).toEqual([]);
    expect(figuresOf(c)).toEqual([]);
    const l = c.limitations.find((x) => x.code === "cross_source_not_generated");
    expect(l?.severity).toBe("blocking");
    expect(l?.origin).toBe("advisor");
    expect(l?.message).toMatch(/01\/10\/2026 a 04\/10\/2026/);
  });

  it("fonte parcial: GA4 com 2 de 4 dias vira `partial`, com os dias reais — não 4 e não 0", async () => {
    const c = await build(octoberContext({ ga4Days: ["2026-10-01", "2026-10-02"] }));
    const ga4 = c.sources.find((s) => s.source === "ga4");
    expect(ga4?.status).toBe("partial");
    expect([ga4?.daysWithData, ga4?.periodDays]).toEqual([2, 4]);
    expect(ga4?.limitationCodes).toContain("ga4_partial_days");
  });

  it("histórico de CRM importado parcial: o CRM vira `partial`, nunca histórico completo", async () => {
    const c = await build(octoberContext({ rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-10-03") }));
    const crm = c.sources.find((s) => s.source === "rd_crm");
    expect(crm?.status).toBe("partial");
    expect(crm?.limitationCodes).toContain("rd_crm_partial_imported_history");
  });
});

describe("AdvisorContext — diagnóstico do motor", () => {
  it("janela do motor ≠ período pedido → `alignedWithPeriod: false` + limitação, e o motor não é reescrito", async () => {
    const item = diagnosticItem();
    const c = await build(octoberContext(), [item]);
    expect(c.diagnostics.status).toBe("available");
    expect(c.diagnostics.alignedWithPeriod).toBe(false);
    expect(c.diagnostics.items).toEqual([item]); // verbatim: janela, textos e evidência do motor
    const l = c.limitations.find((x) => x.code === "diagnostics_period_differs");
    expect(l?.origin).toBe("advisor");
    expect(l?.message).toContain("05/09/2026 a 02/10/2026");
    expect(l?.message).toContain("01/10/2026 a 04/10/2026");
  });

  it("insight do MESMO período → `aligned` e sem limitação de janela", async () => {
    const c = await build(octoberContext(), [diagnosticItem({ period: { start: OCT.start, end: OCT.end } })]);
    expect(c.diagnostics.alignedWithPeriod).toBe(true);
    expect(c.limitations.some((l) => l.code === "diagnostics_period_differs")).toBe(false);
  });

  it("um único insight desalinhado já basta para `false` (todos precisam ser do período)", async () => {
    const c = await build(octoberContext(), [
      diagnosticItem({ period: { start: OCT.start, end: OCT.end } }),
      diagnosticItem({ dedupeKey: "outro", period: { start: "2026-09-05", end: "2026-10-02" } }),
    ]);
    expect(c.diagnostics.alignedWithPeriod).toBe(false);
  });

  it("sem insights: `none`, `aligned: null` e nenhuma limitação de janela", async () => {
    const c = await build(octoberContext(), []);
    expect(c.diagnostics).toEqual({ status: "none", alignedWithPeriod: null, items: [] });
    expect(c.limitations.some((l) => l.code === "diagnostics_period_differs")).toBe(false);
  });

  it("insight sem hipótese não gera hipótese vazia", async () => {
    const c = await build(octoberContext(), [diagnosticItem({ hypothesis: "  " })]);
    expect(c.hypotheses.every((h) => h.origin === "cross_source")).toBe(true);
  });
});

describe("AdvisorContext — composição pura", () => {
  it("mesma entrada ⇒ mesma saída, byte a byte", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const a = await buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(memory, [diagnosticItem()]));
    const b = await buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(memory, [diagnosticItem()]));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(a).toEqual(b);
  });

  it("não muta a entrada (entrada congelada) e é JSON puro", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const stored = deepFreeze(await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store }));
    const diagnostics = deepFreeze([diagnosticItem()]);
    const c = composeAdvisorContext({
      workspaceId: WS,
      period: OCT_PERIOD,
      crossSource: stored,
      diagnostics,
      generatedAt: NOW.toISOString(),
    });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    // nenhum valor não finito, nenhum `undefined` em campo
    const walk = (v: unknown, path: string): void => {
      if (typeof v === "number") expect(Number.isFinite(v), path).toBe(true);
      if (v === undefined) throw new Error(`undefined em ${path}`);
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(c, "$");
  });
});

describe("AdvisorContext — recusa dado de outro lugar", () => {
  it("Cross-source de OUTRO workspace nunca entra", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD, undefined, "outro-workspace");
    const stored = await getCrossSourceInsights("outro-workspace", OCT_PERIOD, { store: memory.store });
    expect(() =>
      composeAdvisorContext({ workspaceId: WS, period: OCT_PERIOD, crossSource: stored, diagnostics: [], generatedAt: NOW.toISOString() }),
    ).toThrow(AdvisorContextError);
  });

  it("Cross-source de OUTRO período nunca entra", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const stored = await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store });
    expect(() =>
      composeAdvisorContext({ workspaceId: WS, period: SEP_PERIOD, crossSource: stored, diagnostics: [], generatedAt: NOW.toISOString() }),
    ).toThrow(/não do pedido/);
  });

  it("afirmação que cita evidência inexistente falha alto, em vez de montar meia verdade", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const stored = await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store });
    const broken = structuredClone(stored);
    broken.insights[0]!.statements[0]!.evidenceIds = ["ga4.nao_existe"];
    expect(() =>
      composeAdvisorContext({ workspaceId: WS, period: OCT_PERIOD, crossSource: broken, diagnostics: [], generatedAt: NOW.toISOString() }),
    ).toThrow(/ga4\.nao_existe/);
  });

  it("evidência com o mesmo id e valores diferentes: o primeiro vale e a limitação aparece", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const stored = await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store });
    const tampered = structuredClone(stored);
    const second = tampered.insights.find((i) => i.type === "traffic-and-rd-conversions")!;
    second.evidence.find((e) => e.id === "ga4.sessions")!.value = 9999;
    const c = composeAdvisorContext({ workspaceId: WS, period: OCT_PERIOD, crossSource: tampered, diagnostics: [], generatedAt: NOW.toISOString() });
    expect(byId(c, "ga4.sessions")?.value).toBe(487);
    expect(c.limitations.map((l) => l.code)).toContain("evidence_conflict");
  });
});

describe("AdvisorContext — comparação anexada", () => {
  it("sem período de comparação o contexto não traz `comparison`", async () => {
    expect((await build()).comparison).toBeNull();
  });

  it("com período de comparação lê o Cross-source do período-base e anexa o resultado", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    await persist(septemberContext(), SEP_PERIOD, memory);
    const c = await buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: SEP_PERIOD }, sourcesFrom(memory));
    expect(c.comparison?.status).toBe("computed");
    expect(c.comparison?.baselinePeriod).toEqual({ startDate: "2026-09-27", endDate: "2026-09-30", days: 4 });
    // o contexto principal continua sendo o do período atual
    expect(c.period.startDate).toBe("2026-10-01");
  });
});
