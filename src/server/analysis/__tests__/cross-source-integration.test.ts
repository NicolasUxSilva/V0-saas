/**
 * Integração com o Postgres REAL — OPT-IN. Sem `CROSS_SOURCE_DB_URL` esta suíte é
 * pulada, e `pnpm test` continua offline, sem tocar em banco nenhum.
 *
 *   CROSS_SOURCE_DB_URL=<url> pnpm exec vitest run \
 *     src/server/analysis/__tests__/cross-source-integration.test.ts
 *
 * Dois blocos, com garantias diferentes:
 *
 *  1. FECHAMENTO DE OUTUBRO, SOMENTE LEITURA (só precisa da URL). Monta o contexto
 *     real de 01–04/10/2026 e roda o Cross-source sobre os dados que já estão no
 *     banco. A conexão é aberta com `default_transaction_read_only = on`: o próprio
 *     servidor recusa qualquer escrita. Sem sync, sem OAuth, sem chamada externa.
 *     (O serviço roda contra um store em memória — nada é persistido.)
 *
 *  2. STORE CONTRA O POSTGRES (precisa também de `CROSS_SOURCE_DB_WRITE_TEST=1`).
 *     Valida o SQL de `createCrossSourceStore` — índice único, upsert, remoção, FK
 *     com cascade — dentro de UMA transação que SEMPRE dá rollback: workspaces e
 *     linhas de teste nunca chegam a ser commitados, e o teste confere que não
 *     sobrou resíduo.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildAnalysisContext } from "@/server/analysis/context";
import { buildCrossSourceInsights } from "@/server/analysis/cross-source";
import {
  createCrossSourceStore,
  generateCrossSourceInsights,
  getCrossSourceInsights,
} from "@/server/analysis/cross-source-store";
import type { AnalysisContext } from "@/server/analysis/types";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";

import {
  evidence,
  expectNoUnnegatedCausality,
  expectStructurallyValid,
  find,
  textOf,
} from "./cross-source-asserts";
import { createMemoryStore } from "./cross-source-store-memory";
import {
  OCT,
  makeRdCrm,
  makeRdMarketing,
  octoberCrmRows,
  periodContext,
  range,
} from "./cross-source-fixtures";

const DB_URL = process.env.CROSS_SOURCE_DB_URL;
const WRITE_TEST = process.env.CROSS_SOURCE_DB_WRITE_TEST === "1";

// O `db` do app aponta para o banco real SOMENTE em modo leitura (e para uma
// armadilha quando não há URL, para nada tocar o banco por engano).
vi.mock("@/server/db", async () => {
  const url = process.env.CROSS_SOURCE_DB_URL;
  if (!url) {
    return {
      db: new Proxy(
        {},
        {
          get() {
            throw new Error("CROSS_SOURCE_DB_URL ausente: nenhum acesso a banco é permitido");
          },
        },
      ),
    };
  }
  const { default: pg } = await import("postgres");
  const { drizzle: make } = await import("drizzle-orm/postgres-js");
  const schemaModule = await import("@/server/db/schema");
  const client = pg(url, {
    prepare: false,
    max: 1,
    // o servidor recusa QUALQUER escrita nesta conexão. Tem de ser via `options` (-c):
    // o parâmetro de startup `default_transaction_read_only` simples é IGNORADO por
    // este endpoint (verificado: `show` devolvia `off`) — por isso o teste abaixo confere.
    connection: { options: "-c default_transaction_read_only=on" },
  });
  return { db: make(client, { schema: schemaModule }), schema: schemaModule };
});

const PERIOD = { startDate: OCT.start, endDate: OCT.end };

/** Código SQLSTATE de um erro do driver (o Drizzle embrulha o erro original em `cause`). */
const sqlState = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.cause?.code ?? err.code;
};


// ═════════════════════════════════════════════════════════════════════════════
// 1. Fechamento de outubro (01–04/10/2026) — dados reais, SOMENTE LEITURA
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!DB_URL)("Cross-source de 01–04/10/2026 com os dados reais (somente leitura)", () => {
  let workspaceId: string;
  let ctx: AnalysisContext;

  beforeAll(async () => {
    const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
    if (!ws) throw new Error("nenhum workspace no banco");
    workspaceId = ws.id;
    const built = await buildAnalysisContext(workspaceId, PERIOD);
    if (!built) throw new Error("workspace sem dados de GA4: sem contexto");
    ctx = built;
  });

  it("a conexão é SOMENTE LEITURA — o servidor recusa escrita", async () => {
    const rows = await db.execute(sql`show default_transaction_read_only`);
    expect(rows[0]?.default_transaction_read_only).toBe("on");
    // prova comportamental, sem risco: um CREATE (mesmo de tabela temporária) é recusado
    // com 25006 (read_only_sql_transaction) numa sessão somente leitura
    await expect(db.execute(sql`create temp table _cross_source_ro_probe (x int)`)).rejects.toSatisfy(
      (e: unknown) => sqlState(e) === "25006",
    );
  });

  it("o contexto carrega o período SOLICITADO (01–04/10), sem encolhê-lo", () => {
    expect(ctx.period).toEqual({ start: OCT.start, end: OCT.end });
    expect(ctx.analysisEnd).toBe(OCT.end);
    expect(ctx.current).toMatchObject({ start: OCT.start, end: OCT.end, days: 4 });
    expect(ctx.coverage.expectedLastDate).toBe(OCT.end);
    // GA4: o período pedido e a cobertura real são coisas distintas e ambas estão no contexto
    expect(ctx.coverage.inPeriod.daysWithData).toBe(ctx.current.daysWithData);
    expect(ctx.coverage.inPeriod.daysWithData).toBeLessThanOrEqual(4);
  });

  it("as fontes de RD respeitam o período pedido e informam a própria cobertura", () => {
    if (ctx.rdMarketing) {
      expect(ctx.rdMarketing.window).toEqual({ start: OCT.start, end: OCT.end });
      expect(ctx.rdMarketing.coverage.daysWithData).toBeLessThanOrEqual(4);
    }
    if (ctx.rdCrm) {
      expect(ctx.rdCrm.window).toEqual({ start: OCT.start, end: OCT.end });
      expect(ctx.rdCrm.coverage).toHaveProperty("importedHistoryStartDate");
    }
  });

  it("o Cross-source do período é válido, determinístico e fiel ao contexto", () => {
    const insights = buildCrossSourceInsights(ctx);
    expectStructurallyValid(insights);
    expectNoUnnegatedCausality(insights);
    expect(JSON.stringify(buildCrossSourceInsights(ctx))).toBe(JSON.stringify(insights));

    // nenhuma evidência foge do período pedido (o histórico do GA4 é, por definição, mais longo)
    for (const i of insights) {
      expect([i.periodStart, i.periodEnd], i.type).toEqual([OCT.start, OCT.end]);
      for (const e of i.evidence) {
        if (e.metric === "history_distinct_dates") continue;
        expect(e.period.start >= OCT.start && e.period.end <= OCT.end, `${i.type}/${e.id}`).toBe(true);
      }
    }
    // os números das evidências são os do contexto — nada recalculado nem inventado
    const acquisition = find(insights, "acquisition-coverage");
    expect(evidence(acquisition!, "ga4.sessions")?.value).toBe(ctx.current.totals.sessions);
    if (ctx.rdMarketing) {
      expect(evidence(acquisition!, "rd_marketing.visits")?.value).toBe(ctx.rdMarketing.totals.visits);
    }
    if (ctx.rdCrm) {
      expect(evidence(find(insights, "commercial-activity")!, "rd_crm.won_deals")?.value).toBe(
        ctx.rdCrm.totals.wonCount,
      );
    }
  });

  it("gerar → ler (store em memória): o mesmo conjunto lógico, sem escrever no banco", async () => {
    const memory = createMemoryStore();
    const deps = { store: memory.store, now: () => new Date("2026-10-04T18:00:00.000Z") };
    const generated = await generateCrossSourceInsights(workspaceId, PERIOD, deps);
    const again = await generateCrossSourceInsights(workspaceId, PERIOD, deps);
    const read = await getCrossSourceInsights(workspaceId, PERIOD, deps);

    expect(generated).not.toBeNull();
    expect(memory.rows()).toHaveLength(generated!.insights.length); // sem duplicata
    expect(again!.persisted.unchanged).toBe(generated!.insights.length);
    expect(read.insights).toEqual(generated!.insights);
  });

  it("RELATÓRIO do fechamento parcial (01–04/10/2026)", async () => {
    const insights = buildCrossSourceInsights(ctx);
    const line = (s: string) => console.log(s);

    line("\n══ Cross-source · período solicitado 2026-10-01 → 2026-10-04 ══");
    line(`GA4          dias com dado ${ctx.coverage.inPeriod.daysWithData}/4 · ${ctx.coverage.inPeriod.firstDate ?? "—"} → ${ctx.coverage.inPeriod.lastDate ?? "—"} · sessões ${ctx.current.totals.sessions} · último dia no GA4 ${ctx.coverage.lastDate}`);
    line(
      ctx.rdMarketing
        ? `RD Marketing dias com registro ${ctx.rdMarketing.coverage.daysWithData}/4 · ${ctx.rdMarketing.coverage.firstDate ?? "—"} → ${ctx.rdMarketing.coverage.lastDate ?? "—"} · visitas ${ctx.rdMarketing.totals.visits} · conversões ${ctx.rdMarketing.totals.conversions} · ativos ${ctx.rdMarketing.assetCount}`
        : "RD Marketing sem dados no período",
    );
    line(
      ctx.rdCrm
        ? `RD CRM       criados ${ctx.rdCrm.totals.createdCount} · ganhos ${ctx.rdCrm.totals.wonCount} · perdidos ${ctx.rdCrm.totals.lostCount} · histórico de CRM importado desde ${ctx.rdCrm.coverage.importedHistoryStartDate ?? "(desconhecido)"}`
        : "RD CRM       sem negócios no período",
    );
    line(`\n${insights.length} insights: ${insights.map((i) => i.type).join(", ")}`);
    for (const i of insights) {
      line(`\n■ ${i.dedupeKey} [${i.category}] fontes=${i.sources.join(",")}`);
      for (const s of i.statements) line(`   - (${s.layer}${s.code ? `:${s.code}` : ""}) ${s.text}`);
      line(`   evidências: ${i.evidence.map((e) => `${e.id}=${e.value}`).join(" | ")}`);
    }
    const limits = insights.flatMap((i) => textOf(i, "limitation"));
    expect(limits.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. O store contra o Postgres de verdade — dentro de uma transação que dá rollback
// ═════════════════════════════════════════════════════════════════════════════

class Rollback extends Error {}

describe.skipIf(!DB_URL || !WRITE_TEST)("store contra o Postgres real (transação com ROLLBACK)", () => {
  const ctxFull = () =>
    periodContext({
      period: OCT,
      rdMarketing: makeRdMarketing(
        [{ assetId: "a1", assetIdentifier: "lp-exemplo", visits: 6, conversions: 0 }],
        { window: OCT, dates: range(OCT.start, OCT.end) },
      ),
      rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-04-07"),
    });
  const ctxGa4Only = () => periodContext({ period: OCT });

  it("upsert, substituição do conjunto, isolamento, índice único e cascade — e nenhum resíduo", async () => {
    const client = postgres(DB_URL!, { prepare: false, max: 1 });
    const wdb = drizzle(client, { schema });
    const t = schema.crossSourceInsights;
    const T0 = new Date("2026-10-04T18:00:00.000Z");
    const T1 = new Date("2026-10-04T19:00:00.000Z");

    const [before] = await wdb.select({ n: count() }).from(t);
    let completed = false;

    try {
      await wdb.transaction(async (tx) => {
        const [a] = await tx.insert(schema.workspaces).values({ name: "TESTE cross-source A (rollback)" }).returning({ id: schema.workspaces.id });
        const [b] = await tx.insert(schema.workspaces).values({ name: "TESTE cross-source B (rollback)" }).returning({ id: schema.workspaces.id });
        const wsA = a!.id;
        const wsB = b!.id;
        const store = createCrossSourceStore(tx as unknown as typeof wdb);
        const gen = (ws: string, period: typeof PERIOD, ctx: AnalysisContext, now: Date) =>
          generateCrossSourceInsights(ws, period, { buildContext: async () => ctx, store, now: () => now });
        const rowsOf = (ws: string, period = PERIOD) =>
          tx.select().from(t).where(and(eq(t.workspaceId, ws), eq(t.periodStart, period.startDate), eq(t.periodEnd, period.endDate)));

        // 1) gravar
        const first = await gen(wsA, PERIOD, ctxFull(), T0);
        const total = first!.insights.length;
        const rows1 = await rowsOf(wsA);
        expect(rows1, "1ª geração grava o conjunto").toHaveLength(total);
        expect(first!.persisted).toEqual({ inserted: total, updated: 0, unchanged: 0, removed: 0 });

        // 2) gerar de novo: mesmas linhas, mesmos ids, nenhuma duplicata
        const second = await gen(wsA, PERIOD, ctxFull(), T1);
        const rows2 = await rowsOf(wsA);
        expect(rows2, "2ª geração não duplica").toHaveLength(total);
        expect(rows2.map((r) => r.id).sort(), "identidade estável").toEqual(rows1.map((r) => r.id).sort());
        expect(second!.persisted).toEqual({ inserted: 0, updated: 0, unchanged: total, removed: 0 });
        // `generated_at` avança no conjunto todo; `created_at` (1ª geração) é preservado
        expect(new Set(rows2.map((r) => r.generatedAt.toISOString()))).toEqual(new Set([T1.toISOString()]));
        expect(rows2.map((r) => r.createdAt.getTime()).sort()).toEqual(rows1.map((r) => r.createdAt.getTime()).sort());

        // 3) ler devolve o MESMO conjunto lógico (jsonb reordena chaves; o conteúdo não muda)
        const read = await getCrossSourceInsights(wsA, PERIOD, { store });
        expect(read.insights).toEqual(first!.insights);
        expect(read.generatedAt).toBe(T1.toISOString());
        expect(read.schemaVersion).toBe(1);
        expect(buildCrossSourceInsights(ctxFull())).toEqual(read.insights);

        // 4) mudar os dados SUBSTITUI o conjunto: o que não vale mais sai, sem sobra
        const third = await gen(wsA, PERIOD, ctxGa4Only(), T1);
        const rows3 = await rowsOf(wsA);
        expect(third!.persisted.removed, "tipos que deixaram de valer saem").toBeGreaterThan(0);
        expect(rows3.map((r) => r.type).sort()).toEqual(third!.insights.map((i) => i.type).sort());
        await gen(wsA, PERIOD, ctxFull(), T1); // volta ao completo

        // 5) workspace B e período B não interferem
        await gen(wsB, PERIOD, ctxGa4Only(), T0);
        const otherPeriod = { startDate: "2026-09-27", endDate: "2026-09-30" };
        await gen(wsA, otherPeriod, periodContext({ period: { start: otherPeriod.startDate, end: otherPeriod.endDate } }), T0);
        const octA = await rowsOf(wsA);
        expect(octA, "regenerar outro workspace/período não mexe no conjunto de A em outubro").toHaveLength(total);
        expect(await rowsOf(wsB), "B tem só o seu conjunto").toHaveLength((await getCrossSourceInsights(wsB, PERIOD, { store })).insights.length);
        expect((await getCrossSourceInsights(wsA, otherPeriod, { store })).insights.length).toBeGreaterThan(0);

        // 6) o índice único é ENFORÇADO pelo banco (dentro de um savepoint, para não abortar a transação)
        const dup = rows1[0]!;
        await expect(
          tx.transaction(async (sp) => {
            await sp.insert(t).values({
              workspaceId: dup.workspaceId,
              periodStart: dup.periodStart,
              periodEnd: dup.periodEnd,
              dedupeKey: dup.dedupeKey,
              type: dup.type,
              category: dup.category,
              position: dup.position,
              title: dup.title,
              insightPeriodStart: dup.insightPeriodStart,
              insightPeriodEnd: dup.insightPeriodEnd,
              sourcesJson: dup.sourcesJson,
              statementsJson: dup.statementsJson,
              evidenceJson: dup.evidenceJson,
              contentHash: dup.contentHash,
            });
          }),
        ).rejects.toSatisfy((e: unknown) => sqlState(e) === "23505");

        // 7) FK com cascade: apagar o workspace apaga o conjunto dele
        await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, wsB));
        expect(await rowsOf(wsB)).toHaveLength(0);
        expect((await rowsOf(wsA)).length).toBe(total); // e só o dele

        completed = true;
        throw new Rollback(); // NADA disto é commitado
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    expect(completed, "todas as verificações rodaram antes do rollback").toBe(true);

    // sem resíduo: a tabela voltou a ter exatamente o que tinha, e os workspaces de teste não existem
    const [after] = await wdb.select({ n: count() }).from(t);
    const [leftover] = await wdb
      .select({ n: count() })
      .from(schema.workspaces)
      .where(sql`${schema.workspaces.name} like 'TESTE cross-source%'`);
    expect(after!.n).toBe(before!.n);
    expect(leftover!.n).toBe(0);
    await client.end({ timeout: 5 });
  });
});
