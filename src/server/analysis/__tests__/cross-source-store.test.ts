/**
 * Persistência do Cross-source (V1.1): mapeamento insight ↔ linha, plano de
 * substituição, e o serviço `generate`/`get` com um store em memória (que imita o
 * contrato e o jsonb). O SQL real é validado no teste de integração opt-in.
 *
 * Fecha também as guardas de arquitetura da V1.1: um único ponto de leitura das
 * fontes, Diagnóstico e detectors intocados, camada pura sem banco.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CROSS_SOURCE_SCHEMA_VERSION,
  buildCrossSourceInsights,
  canonicalJson,
  contentHash,
  fromStoredRows,
  planReplace,
  toStoredRows,
  type CrossSourceInsight,
} from "@/server/analysis/cross-source";
import {
  generateCrossSourceInsights,
  getCrossSourceInsights,
} from "@/server/analysis/cross-source-store";
import { AnalysisPeriodError } from "@/server/analysis/period";
import type { AnalysisContext } from "@/server/analysis/types";

import { expectNoUnnegatedCausality, expectStructurallyValid, get } from "./cross-source-asserts";
import { createMemoryStore } from "./cross-source-store-memory";
import {
  OCT,
  makeRdCrm,
  makeRdMarketing,
  octoberCrmRows,
  periodContext,
  range,
} from "./cross-source-fixtures";

// A camada de serviço aqui só roda com store/contexto injetados: se QUALQUER caminho
// tocasse o `db` de verdade, o Proxy lança.
vi.mock("@/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`acesso inesperado ao banco (db.${String(prop)})`);
      },
    },
  ),
}));

const WS_A = "00000000-0000-4000-8000-00000000000a";
const WS_B = "00000000-0000-4000-8000-00000000000b";
const NOV = { start: "2026-09-27", end: "2026-09-30" };

const assets = [
  { assetId: "a1", assetIdentifier: "lp-exemplo", visits: 6, conversions: 0 },
  { assetId: "a2", assetIdentifier: "lp-confirmacao-exemplo", visits: 0, conversions: 0 },
];

/** Contexto completo de outubro (as três fontes cobrindo 01–04/10). */
const fullCtx = () =>
  periodContext({
    period: OCT,
    rdMarketing: makeRdMarketing(assets, { window: OCT, dates: range(OCT.start, OCT.end) }),
    rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-04-07"),
  });

const PERIOD = { startDate: OCT.start, endDate: OCT.end };
const AT = new Date("2026-10-04T18:00:00.000Z");

/** Serviço com contexto e relógio fixos e o store em memória. */
function makeEnv(ctx: AnalysisContext | null = fullCtx()) {
  const memory = createMemoryStore();
  const buildContext = vi.fn(async () => ctx);
  const deps = { buildContext, store: memory.store, now: () => AT };
  return { memory, buildContext, deps };
}

// ═════════════════════════════════════════════════════════════════════════════
// Mapeamento puro
// ═════════════════════════════════════════════════════════════════════════════

describe("canonicalJson / contentHash", () => {
  it("chaves em ordem alfabética, recursivamente; `undefined` some; arrays mantêm a ordem", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: undefined, b: null } })).toBe(
      '{"a":{"b":null,"d":[3,1,2]},"b":1}',
    );
  });

  it("o hash não depende da ordem das chaves (o jsonb as reordena)", () => {
    const [insight] = buildCrossSourceInsights(fullCtx());
    const shuffled = JSON.parse(canonicalJson(insight)) as CrossSourceInsight; // chaves reordenadas
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(insight!));
    expect(contentHash(shuffled)).toBe(contentHash(insight!));
  });

  it("o hash muda com qualquer mudança de conteúdo — número, texto ou período", () => {
    const [insight] = buildCrossSourceInsights(fullCtx());
    const base = contentHash(insight!);
    expect(base).toMatch(/^[0-9a-f]{64}$/);

    const evidenceChanged = structuredClone(insight!);
    evidenceChanged.evidence[0]!.value = (evidenceChanged.evidence[0]!.value ?? 0) + 1;
    expect(contentHash(evidenceChanged)).not.toBe(base);

    const textChanged = structuredClone(insight!);
    textChanged.statements[0]!.text += " ";
    expect(contentHash(textChanged)).not.toBe(base);

    const periodChanged = { ...structuredClone(insight!), periodEnd: "2026-10-05" };
    expect(contentHash(periodChanged)).not.toBe(base);
  });

  it("é determinístico entre execuções", () => {
    const a = buildCrossSourceInsights(fullCtx()).map(contentHash);
    const b = buildCrossSourceInsights(fullCtx()).map(contentHash);
    expect(a).toEqual(b);
  });
});

describe("toStoredRows / fromStoredRows", () => {
  const insights = buildCrossSourceInsights(fullCtx());
  const rows = toStoredRows(WS_A, OCT, insights);

  it("uma linha por insight, na ordem canônica, com a chave do conjunto = período ANALISADO", () => {
    expect(rows).toHaveLength(insights.length);
    expect(rows.map((r) => r.position)).toEqual(insights.map((_, i) => i));
    expect(rows.map((r) => r.dedupeKey)).toEqual(insights.map((i) => i.dedupeKey));
    for (const r of rows) {
      expect(r.workspaceId).toBe(WS_A);
      expect([r.periodStart, r.periodEnd]).toEqual([OCT.start, OCT.end]);
      expect(r.schemaVersion).toBe(CROSS_SOURCE_SCHEMA_VERSION);
      expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("guarda, em separado, o período em que cada insight vale (pode diferir do analisado)", () => {
    const shifted = { ...structuredClone(insights[0]!), periodStart: "2026-09-27", periodEnd: "2026-09-30" };
    const [row] = toStoredRows(WS_A, OCT, [shifted]);
    expect([row!.periodStart, row!.periodEnd]).toEqual([OCT.start, OCT.end]);
    expect([row!.insightPeriodStart, row!.insightPeriodEnd]).toEqual(["2026-09-27", "2026-09-30"]);
    expect(fromStoredRows([row!])[0]).toMatchObject({ periodStart: "2026-09-27", periodEnd: "2026-09-30" });
  });

  it("ida e volta sem perda — inclusive depois de o jsonb reordenar as chaves", () => {
    expect(fromStoredRows(rows)).toEqual(insights);
    const viaJsonb = JSON.parse(JSON.stringify(rows.map((r) => JSON.parse(canonicalJson(r))))) as typeof rows;
    expect(fromStoredRows(viaJsonb)).toEqual(insights);
  });

  it("a ordem de volta é a canônica, mesmo com as linhas embaralhadas", () => {
    expect(fromStoredRows([...rows].reverse()).map((i) => i.type)).toEqual(insights.map((i) => i.type));
  });

  it("o hash gravado bate com o hash do insight lido de volta (integridade verificável)", () => {
    for (const [i, restored] of fromStoredRows(rows).entries()) {
      expect(contentHash(restored)).toBe(rows[i]!.contentHash);
    }
  });
});

describe("planReplace", () => {
  const row = (dedupeKey: string, hash: string) => ({ dedupeKey, contentHash: hash });

  it("conjunto vazio → tudo é inserção", () => {
    expect(planReplace([], [row("a", "1"), row("b", "2")])).toEqual({
      inserted: ["a", "b"],
      updated: [],
      unchanged: [],
      removed: [],
    });
  });

  it("mesmo conteúdo → tudo igual (idempotente)", () => {
    const same = [row("a", "1"), row("b", "2")];
    expect(planReplace(same, same)).toEqual({ inserted: [], updated: [], unchanged: ["a", "b"], removed: [] });
  });

  it("conteúdo diferente → atualizado; novo → inserido; sumiu → removido", () => {
    expect(planReplace([row("a", "1"), row("b", "2"), row("c", "3")], [row("a", "1"), row("b", "9"), row("d", "4")])).toEqual({
      inserted: ["d"],
      updated: ["b"],
      unchanged: ["a"],
      removed: ["c"],
    });
  });

  it("nada produzido → o conjunto inteiro é removido", () => {
    expect(planReplace([row("a", "1")], [])).toEqual({ inserted: [], updated: [], unchanged: [], removed: ["a"] });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Serviço: gerar × ler
// ═════════════════════════════════════════════════════════════════════════════

describe("persistência 7 — a geração grava os resultados", () => {
  it("grava um conjunto igual ao que a camada pura produz, e devolve o que gravou", async () => {
    const { memory, deps } = makeEnv();
    const generated = await generateCrossSourceInsights(WS_A, PERIOD, deps);

    expect(generated).not.toBeNull();
    const expected = buildCrossSourceInsights(fullCtx());
    expect(generated!.insights).toEqual(expected);
    expect(memory.rows()).toHaveLength(expected.length);
    expect(generated!.persisted).toEqual({ inserted: expected.length, updated: 0, unchanged: 0, removed: 0 });
    expect(generated!.period).toEqual(OCT);
    expect(generated!.generatedAt).toBe(AT.toISOString());
    expect(generated!.schemaVersion).toBe(CROSS_SOURCE_SCHEMA_VERSION);
  });

  it("repassa ao contexto EXATAMENTE o período pedido", async () => {
    const { buildContext, deps } = makeEnv();
    await generateCrossSourceInsights(WS_A, PERIOD, deps);
    expect(buildContext).toHaveBeenCalledTimes(1);
    expect(buildContext).toHaveBeenCalledWith(WS_A, PERIOD);
  });

  it("sem contexto (workspace sem GA4) → devolve null e não grava nada", async () => {
    const { memory, deps } = makeEnv(null);
    expect(await generateCrossSourceInsights(WS_A, PERIOD, deps)).toBeNull();
    expect(memory.rows()).toHaveLength(0);
  });

  it("período inválido → erro tipado ANTES de tocar no contexto ou no store", async () => {
    const { memory, buildContext, deps } = makeEnv();
    for (const bad of [
      { startDate: "2026-10-05", endDate: "2026-10-01" },
      { startDate: "01/10/2026", endDate: "04/10/2026" },
    ]) {
      await expect(generateCrossSourceInsights(WS_A, bad, deps)).rejects.toBeInstanceOf(AnalysisPeriodError);
      await expect(getCrossSourceInsights(WS_A, bad, deps)).rejects.toBeInstanceOf(AnalysisPeriodError);
    }
    expect(buildContext).not.toHaveBeenCalled();
    expect(memory.rows()).toHaveLength(0);
  });

  it("o conjunto persistido é estruturalmente válido e não afirma causalidade", async () => {
    const { deps } = makeEnv();
    const generated = await generateCrossSourceInsights(WS_A, PERIOD, deps);
    expectStructurallyValid(generated!.insights);
    expectNoUnnegatedCausality(generated!.insights);
  });
});

describe("persistência 8 — a segunda geração não duplica", () => {
  it("gerar de novo para o mesmo workspace e período: mesmo número de linhas, mesmos ids, nada novo", async () => {
    const { memory, deps } = makeEnv();
    const first = await generateCrossSourceInsights(WS_A, PERIOD, deps);
    const idsBefore = memory.rows().map((r) => r.id);
    const total = first!.insights.length;

    const second = await generateCrossSourceInsights(WS_A, PERIOD, deps);

    expect(memory.rows()).toHaveLength(total); // nenhuma duplicata
    expect(memory.rows().map((r) => r.id)).toEqual(idsBefore); // mesma identidade
    expect(second!.persisted).toEqual({ inserted: 0, updated: 0, unchanged: total, removed: 0 });
    expect(second!.insights).toEqual(first!.insights); // mesmo conjunto lógico
  });

  it("gerar muitas vezes nunca cria linha extra, e a data da 1ª geração é preservada", async () => {
    const { memory, deps } = makeEnv();
    const first = await generateCrossSourceInsights(WS_A, PERIOD, deps);
    const createdAt = memory.rows().map((r) => r.createdAt);
    for (let i = 0; i < 5; i++) {
      await generateCrossSourceInsights(WS_A, PERIOD, { ...deps, now: () => new Date(AT.getTime() + (i + 1) * 3_600_000) });
    }
    expect(memory.rows()).toHaveLength(first!.insights.length);
    expect(memory.rows().map((r) => r.createdAt)).toEqual(createdAt);
  });

  it("regenerar atualiza `generatedAt` do conjunto inteiro", async () => {
    const { deps } = makeEnv();
    await generateCrossSourceInsights(WS_A, PERIOD, deps);
    const later = new Date("2026-10-05T09:00:00.000Z");
    await generateCrossSourceInsights(WS_A, PERIOD, { ...deps, now: () => later });
    expect((await getCrossSourceInsights(WS_A, PERIOD, deps)).generatedAt).toBe(later.toISOString());
  });

  it("os dados mudaram → a regeneração SUBSTITUI o conjunto: atualiza o que mudou e remove o que deixou de valer", async () => {
    const memory = createMemoryStore();
    const now = () => AT;

    // 1ª geração: GA4 atrasado (tem partial-period e period-mismatch)
    const stale = periodContext({
      period: OCT,
      ga4Days: ["2026-10-01", "2026-10-02"],
      rdMarketing: makeRdMarketing(assets, { window: OCT, dates: range(OCT.start, OCT.end) }),
      rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-04-07"),
    });
    const first = await generateCrossSourceInsights(WS_A, PERIOD, {
      buildContext: async () => stale,
      store: memory.store,
      now,
    });
    const staleTypes = first!.insights.map((i) => i.type);
    expect(staleTypes).toContain("partial-period");
    expect(staleTypes).toContain("period-mismatch");

    // 2ª geração: o GA4 foi sincronizado — o período agora está completo
    const second = await generateCrossSourceInsights(WS_A, PERIOD, {
      buildContext: async () => fullCtx(),
      store: memory.store,
      now,
    });
    const freshTypes = second!.insights.map((i) => i.type);
    expect(freshTypes).not.toContain("partial-period");
    expect(freshTypes).not.toContain("period-mismatch");

    // as linhas dos dois tipos que deixaram de valer SAÍRAM; nenhuma sobra
    expect(second!.persisted.removed).toBe(2);
    expect(second!.persisted.inserted).toBeGreaterThan(0); // traffic-and-rd-conversions etc. passaram a valer
    expect(memory.rows().map((r) => r.type).sort()).toEqual([...freshTypes].sort());
    expect(memory.rows()).toHaveLength(freshTypes.length);
    // e o conteúdo que mudou (GA4 de 2 para 4 dias) foi ATUALIZADO, não duplicado
    expect(second!.persisted.updated).toBeGreaterThan(0);
  });
});

describe("persistência 9 — a leitura devolve o mesmo resultado lógico", () => {
  it("get == o que generate devolveu, na mesma ordem, sem recalcular nada", async () => {
    const { buildContext, deps } = makeEnv();
    const generated = await generateCrossSourceInsights(WS_A, PERIOD, deps);
    buildContext.mockClear();

    const read = await getCrossSourceInsights(WS_A, PERIOD, deps);

    expect(read.insights).toEqual(generated!.insights);
    expect(read.insights.map((i) => i.type)).toEqual(generated!.insights.map((i) => i.type));
    expect(read.generatedAt).toBe(generated!.generatedAt);
    expect(read.schemaVersion).toBe(CROSS_SOURCE_SCHEMA_VERSION);
    expect(read.period).toEqual(OCT);
    expect(read.workspaceId).toBe(WS_A);
  });

  it("ler NÃO toca GA4/RD/CRM: nunca monta contexto, nem recalcula métrica", async () => {
    const { buildContext, deps } = makeEnv();
    await generateCrossSourceInsights(WS_A, PERIOD, deps);
    buildContext.mockClear();
    await getCrossSourceInsights(WS_A, PERIOD, { store: deps.store });
    expect(buildContext).not.toHaveBeenCalled();
  });

  it("o que se lê tem a evidência e as afirmações intactas (nada virou texto livre)", async () => {
    const { deps } = makeEnv();
    await generateCrossSourceInsights(WS_A, PERIOD, deps);
    const { insights } = await getCrossSourceInsights(WS_A, PERIOD, deps);
    expectStructurallyValid(insights);
    expect(get(insights, "commercial-activity").evidence.find((e) => e.id === "rd_crm.won_deals")).toMatchObject({
      source: "rd_crm",
      metric: "won_deals",
      period: OCT,
      value: 5,
      format: "count",
    });
  });

  it("período nunca gerado → conjunto vazio, sem data de geração", async () => {
    const { deps } = makeEnv();
    expect(await getCrossSourceInsights(WS_A, PERIOD, deps)).toEqual({
      workspaceId: WS_A,
      period: OCT,
      generatedAt: null,
      schemaVersion: null,
      insights: [],
    });
  });
});

describe("persistência 10 — workspace A não interfere em B", () => {
  it("cada workspace tem o seu conjunto; regenerar A não toca em B", async () => {
    const memory = createMemoryStore();
    const base = { store: memory.store, now: () => AT };
    const ctxA = fullCtx();
    const ctxB = periodContext({ period: OCT }); // B: só GA4 — outro conjunto de insights

    const a1 = await generateCrossSourceInsights(WS_A, PERIOD, { ...base, buildContext: async () => ctxA });
    const b1 = await generateCrossSourceInsights(WS_B, PERIOD, { ...base, buildContext: async () => ctxB });
    expect(memory.rows()).toHaveLength(a1!.insights.length + b1!.insights.length);
    expect(a1!.insights.map((i) => i.type)).not.toEqual(b1!.insights.map((i) => i.type));

    const rowsB = memory.rows().filter((r) => r.workspaceId === WS_B).map((r) => ({ ...r }));
    await generateCrossSourceInsights(WS_A, PERIOD, { ...base, buildContext: async () => ctxA }); // regenera A

    expect(memory.rows().filter((r) => r.workspaceId === WS_B)).toEqual(rowsB); // B intocado
    expect((await getCrossSourceInsights(WS_B, PERIOD, base)).insights).toEqual(b1!.insights);
    expect((await getCrossSourceInsights(WS_A, PERIOD, base)).insights).toEqual(a1!.insights);
  });

  it("o mesmo tipo de insight existe em A e em B sem colidir (a chave inclui o workspace)", async () => {
    const memory = createMemoryStore();
    const base = { store: memory.store, now: () => AT, buildContext: async () => fullCtx() };
    await generateCrossSourceInsights(WS_A, PERIOD, base);
    await generateCrossSourceInsights(WS_B, PERIOD, base);
    const keys = memory.rows().map((r) => `${r.workspaceId}|${r.dedupeKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(memory.rows().filter((r) => r.dedupeKey === "cross-source:data-coverage")).toHaveLength(2);
  });

  it("ler um workspace que nunca foi gerado não vaza o de outro", async () => {
    const memory = createMemoryStore();
    await generateCrossSourceInsights(WS_A, PERIOD, { store: memory.store, now: () => AT, buildContext: async () => fullCtx() });
    expect((await getCrossSourceInsights(WS_B, PERIOD, { store: memory.store })).insights).toEqual([]);
  });
});

describe("persistência 11 — período A não interfere no período B", () => {
  const PERIOD_B = { startDate: NOV.start, endDate: NOV.end };

  it("períodos distintos do mesmo workspace são conjuntos independentes", async () => {
    const memory = createMemoryStore();
    const base = { store: memory.store, now: () => AT };
    const ctxOct = fullCtx();
    const ctxSep = periodContext({ period: NOV });

    const octSet = await generateCrossSourceInsights(WS_A, PERIOD, { ...base, buildContext: async () => ctxOct });
    const sepSet = await generateCrossSourceInsights(WS_A, PERIOD_B, { ...base, buildContext: async () => ctxSep });
    expect(memory.rows()).toHaveLength(octSet!.insights.length + sepSet!.insights.length);

    const octRows = memory.rows().filter((r) => r.periodStart === OCT.start).map((r) => ({ ...r }));
    await generateCrossSourceInsights(WS_A, PERIOD_B, { ...base, buildContext: async () => ctxSep }); // regenera B

    expect(memory.rows().filter((r) => r.periodStart === OCT.start)).toEqual(octRows); // outubro intocado
    expect((await getCrossSourceInsights(WS_A, PERIOD, base)).insights).toEqual(octSet!.insights);
    expect((await getCrossSourceInsights(WS_A, PERIOD_B, base)).insights).toEqual(sepSet!.insights);
  });

  it("regenerar um período NÃO remove os insights de outro, mesmo com tipos diferentes", async () => {
    const memory = createMemoryStore();
    const base = { store: memory.store, now: () => AT };
    await generateCrossSourceInsights(WS_A, PERIOD, { ...base, buildContext: async () => fullCtx() });
    const before = memory.rows().length;
    // o outro período só tem GA4 → produz MENOS tipos; nada de outubro pode sumir
    await generateCrossSourceInsights(WS_A, PERIOD_B, { ...base, buildContext: async () => periodContext({ period: NOV }) });
    expect(memory.rows().filter((r) => r.periodStart === OCT.start)).toHaveLength(before);
  });

  it("períodos que só diferem no fim também são conjuntos distintos", async () => {
    const memory = createMemoryStore();
    const base = { store: memory.store, now: () => AT, buildContext: async () => fullCtx() };
    await generateCrossSourceInsights(WS_A, PERIOD, base);
    await generateCrossSourceInsights(WS_A, { startDate: OCT.start, endDate: "2026-10-03" }, base);
    const keys = memory.rows().map((r) => [r.periodStart, r.periodEnd, r.dedupeKey].join("|"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(memory.rows().map((r) => r.periodEnd))).toEqual(new Set([OCT.end, "2026-10-03"]));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Arquitetura
// ═════════════════════════════════════════════════════════════════════════════

describe("arquitetura (V1.1)", () => {
  const SRC_ROOT = join(import.meta.dirname, "..", "..", "..");
  const read = (rel: string) => readFileSync(join(SRC_ROOT, rel), "utf8");
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  /** Todos os .ts de produção (fora de __tests__) de uma pasta, recursivamente. */
  function productionFiles(dir: string): string[] {
    const abs = join(SRC_ROOT, dir);
    return readdirSync(abs).flatMap((name) => {
      const full = join(abs, name);
      if (statSync(full).isDirectory()) return name === "__tests__" ? [] : productionFiles(relative(SRC_ROOT, full));
      return name.endsWith(".ts") ? [relative(SRC_ROOT, full)] : [];
    });
  }

  it("`buildAnalysisContext` continua o ÚNICO ponto que lê as fontes: nenhuma fact table nem raw_records fora de context.ts", () => {
    const facts = /\b(factTrafficDaily|factAdPerformanceDaily|factConversionAssetsDaily|factDeals|rawRecords)\b/;
    const files = productionFiles("server/analysis");
    expect(files).toContain("server/analysis/context.ts");
    expect(files).toContain("server/analysis/cross-source-store.ts");
    for (const file of files) {
      if (file === "server/analysis/context.ts") continue;
      expect(stripComments(read(file)), file).not.toMatch(facts);
    }
    expect(stripComments(read("server/analysis/context.ts"))).toMatch(facts); // sanity: é ele que lê
  });

  it("o store lê/escreve SÓ `cross_source_insights` — importa só essa tabela do schema", () => {
    const code = stripComments(read("server/analysis/cross-source-store.ts"));
    const schemaImport = code.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/server\/db\/schema["']/);
    expect(schemaImport).not.toBeNull();
    expect(schemaImport![1]!.split(",").map((s) => s.trim()).filter(Boolean)).toEqual(["crossSourceInsights"]);
    // e as fontes só chegam até ele por `buildAnalysisContext`
    expect(code).toMatch(/import\s*\{\s*buildAnalysisContext\s*\}\s*from\s*["']\.\/context["']/);
  });

  it("a ESCRITA do store só acontece em `cross_source_insights` (nenhum insert/update/delete em outra tabela)", () => {
    const code = stripComments(read("server/analysis/cross-source-store.ts"));
    for (const match of code.matchAll(/\.(insert|update|delete)\(\s*([A-Za-z_.]+)\s*\)/g)) {
      expect(match[2], match[0]).toBe("crossSourceInsights");
    }
    expect(code.match(/\.(insert|update|delete)\(/g)?.length).toBe(2); // o delete do que sumiu + o upsert
  });

  it("Diagnóstico e detectors não conhecem nem o Cross-source nem o store (INV-4: nada do que eles produzem muda)", () => {
    const wired =
      /from\s+["'][^"']*cross-source[^"']*["']|buildCrossSourceInsights|generateCrossSourceInsights|getCrossSourceInsights|crossSourceInsights/;
    for (const path of [
      "server/analysis/engine.ts",
      "server/analysis/detectors.ts",
      "server/analysis/gates.ts",
      "server/analysis/scoring.ts",
      "server/analysis/enrichment.ts",
      "server/analysis/context.ts",
      "server/analysis/contribution.ts",
      "server/analysis/stats.ts",
      "server/analysis/templates.ts",
      "server/sync/run-sync.ts",
      "app/(app)/diagnostico/data.ts",
    ]) {
      expect(stripComments(read(path)), path).not.toMatch(wired);
    }
  });

  it("o Diagnóstico segue chamando `buildAnalysisContext(workspaceId)` SEM período — o modo padrão", () => {
    expect(stripComments(read("server/analysis/engine.ts"))).toMatch(
      /buildAnalysisContext\(\s*input\.workspaceId\s*\)/,
    );
    expect(stripComments(read("app/(app)/diagnostico/data.ts"))).toMatch(
      /buildAnalysisContext\(\s*workspaceId\s*\)/,
    );
  });

  it("a persistência não vira detector: `insights` (do /diagnostico) não é tocada por nenhum arquivo do Cross-source", () => {
    for (const file of [...productionFiles("server/analysis/cross-source"), "server/analysis/cross-source-store.ts"]) {
      expect(stripComments(read(file)), file).not.toMatch(/\bfrom\s+["']@\/server\/db\/schema["'][^;]*\binsights\b/);
      expect(stripComments(read(file)), file).not.toMatch(/\.(insert|update|delete)\(\s*insights\s*\)/);
    }
  });

  it("a matemática de período é pura: sem banco, rede, env nem relógio", () => {
    const code = stripComments(read("server/analysis/period.ts"));
    for (const re of [
      /@\/server\/db/,
      /drizzle-orm/,
      /@\/env\b|process\.env/,
      /\bfetch\s*\(/,
      /Date\.now\s*\(|new Date\s*\(\s*\)|performance\.now/,
      /Math\.random/,
    ]) {
      expect(code).not.toMatch(re);
    }
  });

  it("a pasta cross-source continua sem acesso a banco, mesmo com a parte pura da persistência dentro dela", () => {
    const files = productionFiles("server/analysis/cross-source");
    expect(files.map((f) => f.split("/").pop())).toContain("storage.ts");
    for (const file of files) {
      expect(stripComments(read(file)), file).not.toMatch(/@\/server\/db|drizzle-orm|\bpostgres\b/);
    }
  });
});
