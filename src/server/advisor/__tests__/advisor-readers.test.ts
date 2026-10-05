/**
 * Leitores de banco do Advisor — o mapeamento de linha → item e o SQL gerado
 * (escopo do workspace, filtro de status, só SELECT). O SQL de verdade roda contra
 * um Postgres real no teste de integração opt-in (`advisor-integration.test.ts`).
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { insights } from "@/server/db/schema";

import { createAdvisorReaders, rowToDiagnosticItem } from "../readers";

type Row = typeof insights.$inferSelect;

const row = (over: Partial<Row> = {}): Row => ({
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "ws-1",
  syncRunId: "22222222-2222-2222-2222-222222222222",
  detector: "data-quality",
  kind: "data_quality",
  severity: "attention",
  status: "open",
  title: "Sem dados de conversão",
  impactJson: null,
  explanation: "A métrica de key events retornou 0.",
  hypothesis: "A propriedade não tem key events.",
  evidenceJson: { metricLabel: "Key events", current: 0, previous: 0, baseline: null, deltaPct: 0, format: "count", test: null, breakdown: [] },
  periodStart: "2026-09-05",
  periodEnd: "2026-10-02",
  comparedTo: "28 dias anteriores",
  responsibleDimensionJson: null,
  confidence: "alta",
  confidenceBasisJson: "Contagem zerada em todo o intervalo.",
  recommendedAction: "Marcar os eventos-chave no GA4.",
  priorityScore: 70,
  dedupeKey: "data-quality:no_key_events",
  rating: 1,
  gateTraceJson: { secret: "interno" },
  createdAt: new Date("2026-09-24T10:00:00Z"),
  updatedAt: new Date("2026-10-04T10:00:00Z"),
  ...over,
});

describe("rowToDiagnosticItem", () => {
  it("copia o que o motor gravou e NADA além disso (sem id, sync, avaliação do usuário nem gate trace)", () => {
    const item = rowToDiagnosticItem(row());
    expect(item).toEqual({
      dedupeKey: "data-quality:no_key_events",
      detector: "data-quality",
      kind: "data_quality",
      severity: "attention",
      status: "open",
      title: "Sem dados de conversão",
      explanation: "A métrica de key events retornou 0.",
      hypothesis: "A propriedade não tem key events.",
      recommendedAction: "Marcar os eventos-chave no GA4.",
      confidence: "alta",
      confidenceBasis: "Contagem zerada em todo o intervalo.",
      impact: null,
      evidence: { metricLabel: "Key events", current: 0, previous: 0, baseline: null, deltaPct: 0, format: "count", test: null, breakdown: [] },
      period: { start: "2026-09-05", end: "2026-10-02" },
      comparedTo: "28 dias anteriores",
      priorityScore: 70,
    });
    const keys = Object.keys(item);
    for (const internal of ["id", "workspaceId", "syncRunId", "rating", "gateTraceJson", "createdAt", "updatedAt", "responsibleDimensionJson"]) {
      expect(keys).not.toContain(internal);
    }
  });

  it("status `acknowledged` é mantido; `comparedTo` ausente vira null; impacto vem como o motor gravou", () => {
    const item = rowToDiagnosticItem(
      row({ status: "acknowledged", comparedTo: null, impactJson: { value: 663, unit: "sessions", basis: "sessões perdidas", isEstimate: true } }),
    );
    expect(item.status).toBe("acknowledged");
    expect(item.comparedTo).toBeNull();
    expect(item.impact).toEqual({ value: 663, unit: "sessions", basis: "sessões perdidas", isEstimate: true });
  });

  it("`confidenceBasis` que não é string vira texto, nunca `undefined`", () => {
    expect(rowToDiagnosticItem(row({ confidenceBasisJson: null })).confidenceBasis).toBe("");
    expect(rowToDiagnosticItem(row({ confidenceBasisJson: 42 })).confidenceBasis).toBe("42");
  });
});

/** Um executor de mentira: grava cada chamada e devolve `rows` quando é aguardado. Só `select` existe. */
function fakeExecutor(rows: unknown[]) {
  const calls: { method: string; arg: unknown }[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "groupBy"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, arg: args.length > 1 ? args : args[0] });
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(rows);
  const executor = {
    select: (arg: unknown) => {
      calls.push({ method: "select", arg });
      return chain;
    },
  };
  return { executor: executor as never, calls };
}

const dialect = new PgDialect();
const whereOf = (calls: { method: string; arg: unknown }[]) => {
  const w = calls.find((c) => c.method === "where")!.arg as SQL;
  return dialect.sqlToQuery(w);
};

describe("createAdvisorReaders — o SQL", () => {
  it("diagnóstico: só do workspace pedido, só `open`/`acknowledged`, do mais ao menos prioritário", async () => {
    const { executor, calls } = fakeExecutor([row(), row({ dedupeKey: "outro", status: "acknowledged" })]);
    const items = await createAdvisorReaders(executor).diagnostics("ws-1");
    expect(items.map((i) => i.dedupeKey)).toEqual(["data-quality:no_key_events", "outro"]);

    const { sql, params } = whereOf(calls);
    expect(sql).toMatch(/"workspace_id" = \$1/);
    expect(sql).toMatch(/"status" in \(\$2, \$3\)/);
    expect(params).toEqual(["ws-1", "open", "acknowledged"]); // `dismissed` nunca entra
    expect(calls.map((c) => c.method)).toEqual(["select", "from", "where", "orderBy"]);
  });

  it("períodos do Cross-source: só do workspace pedido, agrupados por período, do mais recente ao mais antigo", async () => {
    const generatedAt = new Date("2026-10-04T20:10:55.505Z");
    const { executor, calls } = fakeExecutor([
      { start: "2026-10-01", end: "2026-10-04", generatedAt, insightCount: 8 },
      { start: "2026-09-27", end: "2026-09-30", generatedAt: new Date("2026-10-01T10:00:00Z"), insightCount: 7 },
    ]);
    const periods = await createAdvisorReaders(executor).crossSourcePeriods("ws-1");
    expect(periods).toEqual([
      { start: "2026-10-01", end: "2026-10-04", generatedAt: "2026-10-04T20:10:55.505Z", insightCount: 8 },
      { start: "2026-09-27", end: "2026-09-30", generatedAt: "2026-10-01T10:00:00.000Z", insightCount: 7 },
    ]);
    expect(whereOf(calls).params).toEqual(["ws-1"]);
    expect(calls.map((c) => c.method)).toEqual(["select", "from", "where", "groupBy", "orderBy"]);
  });

  it("sem linhas: lista vazia, não erro", async () => {
    const { executor } = fakeExecutor([]);
    const readers = createAdvisorReaders(executor);
    expect(await readers.diagnostics("ws-1")).toEqual([]);
    expect(await readers.crossSourcePeriods("ws-1")).toEqual([]);
  });

  it("o executor só precisa de `select`: qualquer escrita falharia (o objeto de teste não tem insert/update/delete)", async () => {
    const { executor } = fakeExecutor([]);
    const e = executor as unknown as Record<string, unknown>;
    expect(Object.keys(e)).toEqual(["select"]);
    await expect(createAdvisorReaders(executor).diagnostics("ws-1")).resolves.toEqual([]);
  });
});
