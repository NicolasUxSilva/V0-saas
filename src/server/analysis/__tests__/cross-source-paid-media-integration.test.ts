/**
 * Mídia paga (Google Ads / Meta Ads) contra o Postgres REAL — OPT-IN e SOMENTE LEITURA.
 * Sem `CROSS_SOURCE_DB_URL` a suíte é pulada e `pnpm test` continua offline.
 *
 *   CROSS_SOURCE_DB_URL=<url> pnpm exec vitest run \
 *     src/server/analysis/__tests__/cross-source-paid-media-integration.test.ts
 *
 * A conexão é aberta com `default_transaction_read_only = on` (via `options -c`): o
 * próprio servidor recusa qualquer escrita. Sem sync, sem OAuth, sem chamada externa; o
 * Cross-source roda contra um store em memória — NADA é persistido. Serve para provar, com
 * os dados do piloto, que:
 *  - o contexto de cada plataforma lê só as linhas dela (filtro de `platform` no SQL real);
 *  - o Cross-source com mídia paga é válido e não altera os insights das fontes de base;
 *  - as leituras do Diagnóstico (estado das fontes e mídia paga) executam no Postgres real;
 *  - regenerar o conjunto persistido mudaria o quê (plano inserido/atualizado/igual/removido).
 *
 * `CROSS_SOURCE_DRYRUN_OUT=<arquivo>` grava, em JSON, o resumo dessa simulação (só
 * contagens e tipos de insight — nenhum valor de conexão nem de campanha).
 */
import { writeFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildAnalysisContext } from "@/server/analysis/context";
import {
  buildCrossSourceInsights,
  planReplace,
  toStoredRows,
  type CrossSourceInsight,
} from "@/server/analysis/cross-source";
import { createCrossSourceStore } from "@/server/analysis/cross-source-store";
import type { AnalysisContext } from "@/server/analysis/types";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { readPaidMedia, readSources } from "@/server/diagnostico/read";
import { assembleView } from "@/server/diagnostico/view";
import { mockDiagnostico } from "@/mock";

import {
  expectNoUnnegatedCausality,
  expectStructurallyValid,
  find,
} from "./cross-source-asserts";

const DB_URL = process.env.CROSS_SOURCE_DB_URL;

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
    connection: { options: "-c default_transaction_read_only=on" },
  });
  return { db: make(client, { schema: schemaModule }), schema: schemaModule };
});

/** Fechamento de setembro a 04/10 — o conjunto que o Advisor lê hoje no piloto. */
const CLOSING = { startDate: "2026-09-01", endDate: "2026-10-04" };

describe.skipIf(!DB_URL)("mídia paga com os dados reais (somente leitura)", () => {
  let workspaceId: string;
  let ctx: AnalysisContext;
  let insights: CrossSourceInsight[];

  beforeAll(async () => {
    const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
    if (!ws) throw new Error("nenhum workspace no banco");
    workspaceId = ws.id;
    const built = await buildAnalysisContext(workspaceId, CLOSING);
    if (!built) throw new Error("workspace sem dados de GA4: sem contexto");
    ctx = built;
    insights = buildCrossSourceInsights(ctx);
  });

  it("a conexão é SOMENTE LEITURA — o servidor recusa escrita", async () => {
    const rows = await db.execute(sql`show default_transaction_read_only`);
    expect(rows[0]?.default_transaction_read_only).toBe("on");
  });

  it("cada plataforma lê SÓ as próprias linhas (o filtro de `platform` funciona no Postgres real)", async () => {
    const byPlatform = await db
      .select({
        platform: schema.factAdPerformanceDaily.platform,
        cost: sql<number>`coalesce(sum(${schema.factAdPerformanceDaily.cost}), 0)::float8`,
        clicks: sql<number>`coalesce(sum(${schema.factAdPerformanceDaily.clicks}), 0)::float8`,
      })
      .from(schema.factAdPerformanceDaily)
      .where(
        sql`${schema.factAdPerformanceDaily.workspaceId} = ${workspaceId}
          and ${schema.factAdPerformanceDaily.date} between ${CLOSING.startDate} and ${CLOSING.endDate}`,
      )
      .groupBy(schema.factAdPerformanceDaily.platform);

    const google = byPlatform.find((p) => p.platform === "google_ads");
    const meta = byPlatform.find((p) => p.platform === "meta_ads");

    // o contexto do Google Ads bate com a soma da plataforma `google_ads` — não com a tabela toda
    if (google) {
      expect(ctx.ads).not.toBeNull();
      expect(ctx.ads!.totals.cost).toBeCloseTo(google.cost, 2);
      expect(ctx.ads!.totals.clicks).toBe(google.clicks);
    } else {
      expect(ctx.ads).toBeNull();
    }
    // o Meta só existe se houver linhas `meta_ads`
    if (meta) expect(ctx.metaAds?.totals.cost).toBeCloseTo(meta.cost, 2);
    else expect(ctx.metaAds).toBeNull();
  });

  it("o Cross-source com mídia paga é válido, sem causalidade, e a plataforma só entra com dados", () => {
    expectStructurallyValid(insights);
    expectNoUnnegatedCausality(insights);
    const activity = find(insights, "paid-media-activity");
    expect(Boolean(activity)).toBe(ctx.ads !== null || ctx.metaAds !== null);
    for (const i of insights) {
      if (ctx.ads === null) expect(i.sources).not.toContain("google_ads");
      if (ctx.metaAds === null) expect(i.sources).not.toContain("meta_ads");
    }
  });

  it("os insights das fontes de base são IDÊNTICOS com e sem a mídia paga no contexto", () => {
    const without = buildCrossSourceInsights({ ...ctx, ads: null, metaAds: null });
    for (const type of [
      "acquisition-coverage",
      "traffic-and-rd-conversions",
      "commercial-activity",
      "attribution-quality",
      "source-unavailable",
      "partial-period",
      "period-mismatch",
      "metric-not-computable",
    ] as const) {
      expect(find(insights, type), type).toEqual(find(without, type));
    }
  });

  it("simulação de regerar o conjunto persistido: o que mudaria (nada é gravado)", async () => {
    const stored = await createCrossSourceStore().list(workspaceId, {
      start: CLOSING.startDate,
      end: CLOSING.endDate,
    });
    const rows = toStoredRows(workspaceId, { start: CLOSING.startDate, end: CLOSING.endDate }, insights);
    const plan = planReplace(stored, rows);

    const summary = {
      period: CLOSING,
      persistedBefore: stored.length,
      producedNow: rows.length,
      plan: {
        inserted: plan.inserted,
        updated: plan.updated,
        unchanged: plan.unchanged,
        removed: plan.removed,
      },
      sourcesWithData: {
        google_ads: ctx.ads !== null,
        meta_ads: ctx.metaAds !== null,
      },
      paidMedia:
        ctx.ads === null
          ? null
          : {
              daysWithData: ctx.ads.coverage.daysWithData,
              first: ctx.ads.coverage.firstDate,
              last: ctx.ads.coverage.lastDate,
              campaigns: ctx.ads.campaignCount,
              currency: ctx.ads.currency,
            },
    };
    if (process.env.CROSS_SOURCE_DRYRUN_OUT) {
      writeFileSync(process.env.CROSS_SOURCE_DRYRUN_OUT, JSON.stringify(summary, null, 2));
    }
    // o plano é coerente: tudo o que existe hoje é igual, atualizado ou removido
    expect(plan.unchanged.length + plan.updated.length + plan.removed.length).toBe(stored.length);
    expect(plan.inserted.length + plan.unchanged.length + plan.updated.length).toBe(rows.length);
  });

  it("as leituras do Diagnóstico executam no Postgres real e são coerentes", async () => {
    const { sources, footprints } = await readSources(workspaceId);
    expect(sources.map((s) => s.key)).toEqual([
      "ga4",
      "google_ads",
      "meta_ads",
      "rd_station_marketing",
      "rd_station_crm",
    ]);
    // fonte com dados tem período; fonte sem conexão nunca inventa um
    for (const s of sources) {
      if (s.health === "not_connected") expect(s.coverage).toBeNull();
      if (s.coverage) expect(s.coverage.first <= s.coverage.last).toBe(true);
    }

    const paid = await readPaidMedia(workspaceId, footprints);
    for (const p of paid) {
      expect(p.metrics.map((m) => m.key)).toEqual(["cost", "impressions", "clicks", "conversions"]);
      expect(p.daysWithData).toBeGreaterThan(0);
      for (const m of p.metrics) expect(m.deltaPct === null || Number.isFinite(m.deltaPct)).toBe(true);
    }
    // Meta sem linhas não gera cartão
    if (!footprints.meta_ads) expect(paid.some((p) => p.platform === "meta_ads")).toBe(false);

    // com USE_MOCK=false e sem insight real a tela fica VAZIA com motivo — nunca preenchida com a demonstração
    const view = assembleView({
      useMock: false,
      demo: mockDiagnostico,
      real: {
        lastSyncedAt: null,
        lastSyncStatus: null,
        window: { start: "2026-10-14", end: "2026-10-14", comparedTo: "28 dias anteriores" },
        insights: [],
        supportMetrics: [],
        analysis: null,
      },
      sources,
      paidMedia: paid,
    });
    expect(view.mode).toBe("empty");
    expect(view.empty?.title.length).toBeGreaterThan(0);
  });
});
