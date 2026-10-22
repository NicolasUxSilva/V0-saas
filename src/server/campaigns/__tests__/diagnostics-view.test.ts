/**
 * Tela de diagnóstico (filtros e seções) e ISOLAMENTO POR WORKSPACE na leitura.
 *
 * Sem Postgres no teste, o isolamento é conferido como em `analysis/__tests__/ads-sql-filter`:
 * pelo SQL que o Drizzle gera para o escopo do detalhe e por uma varredura de `read.ts`
 * garantindo que TODA leitura de tabela de fatos filtra pelo workspace da sessão.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { CampaignDiagnostic } from "@/lib/campaign-diagnostics";
import { buildDiagnosticsView, diagnosticsForCampaign, parseDiagnosticFilters } from "@/server/campaigns/diagnostics/view";

vi.mock("@/server/db", () => ({ db: {} }));
const { detailNodesScope } = await import("@/server/campaigns/read");

const d = (over: Partial<CampaignDiagnostic>): CampaignDiagnostic => ({
  id: "x",
  type: "ctr_drop",
  kind: "finding",
  platform: "google_ads",
  platformLabel: "Google Ads",
  level: "campaign",
  levelLabel: "Campanha",
  entity: { campaignId: "1", campaignName: "A", adGroupId: null, adGroupName: null, adId: null, adName: null, href: null },
  title: "",
  description: "",
  evidence: [],
  facts: [],
  currency: "BRL",
  period: { current: { start: "2026-10-01", end: "2026-10-10" }, previous: null },
  severity: "high",
  confidence: "high",
  limitation: null,
  limitationReason: null,
  nextCheck: "",
  metrics: [],
  related: [],
  priority: 1,
  ...over,
});

describe("filtros", () => {
  it("só valores conhecidos; id de campanha restrito", () => {
    expect(parseDiagnosticFilters({ severidade: "high", tipo: "ctr_drop", nivel: "ad", campanha: "123" })).toEqual({
      severity: "high",
      type: "ctr_drop",
      level: "ad",
      campaignId: "123",
    });
    expect(parseDiagnosticFilters({ severidade: "x", tipo: "drop table", nivel: "?", campanha: "1' or '1'='1" })).toEqual({
      severity: null,
      type: null,
      level: null,
      campaignId: null,
    });
  });

  it("filtra sinais, mas mantém as limitações (elas explicam o que falta)", () => {
    const all = [
      d({ id: "a" }),
      d({ id: "b", severity: "low", entity: { ...d({}).entity, campaignId: "2", campaignName: "B" } }),
      d({ id: "c", kind: "inconclusive", severity: "medium" }),
      d({ id: "l", kind: "limitation", type: "data_limitation", level: "platform", severity: "info" }),
    ];
    const v = buildDiagnosticsView(all, { severity: "high", type: null, level: null, campaignId: null });
    expect(v.findings.map((x) => x.id)).toEqual(["a"]);
    expect(v.inconclusive).toEqual([]);
    expect(v.limitations.map((x) => x.id)).toEqual(["l"]);
    expect(v.totals).toEqual({ findings: 2, high: 1, inconclusive: 1, limitations: 1 });
    expect(v.campaignOptions.map((c) => c.name)).toEqual(["A", "B"]);
    expect(buildDiagnosticsView(all, { severity: null, type: null, level: null, campaignId: "2" }).findings.map((x) => x.id)).toEqual(["b"]);
    expect(diagnosticsForCampaign(all, "google_ads", "1").map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("isolamento por workspace na leitura", () => {
  it("o escopo do detalhe filtra workspace, plataformas e intervalo — por parâmetro", () => {
    const q = new PgDialect().sqlToQuery(detailNodesScope("ws-1' or '1'='1", ["google_ads"], { start: "2026-09-01", end: "2026-10-20" })!);
    expect(q.sql).toBe(
      '("fact_ad_entity_daily"."workspace_id" = $1 and "fact_ad_entity_daily"."platform" in ($2) and "fact_ad_entity_daily"."date" >= $3 and "fact_ad_entity_daily"."date" <= $4)',
    );
    expect(q.params[0]).toBe("ws-1' or '1'='1");
  });

  it("toda leitura de tabela de fatos em read.ts filtra pelo workspace", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "read.ts"), "utf8");
    const lines = src.split("\n");
    const froms = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\.from\((f|e|factAdPerformanceDaily|factAdEntityDaily)\)/.test(line));
    expect(froms.length).toBe(7); // uma leitura nova aqui precisa passar por este teste
    for (const { i } of froms) {
      const block = lines.slice(i, i + 14).join("\n");
      expect(block, `linha ${i + 1}`).toMatch(/eq\((f|e)\.workspaceId, (input\.)?workspaceId\)|detailNodesScope\(workspaceId|eq\(f\.workspaceId, workspaceId\)|\bscope\b/);
    }
  });
});
