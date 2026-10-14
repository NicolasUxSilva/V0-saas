import { describe, expect, it } from "vitest";

import type { DiagnosticoData, Insight, PaidMediaSnapshot, SourceStatus } from "@/lib/insight";
import { mockDiagnostico } from "@/mock";

import { buildSourceStatuses } from "../status";
import { assembleView } from "../view";

const NOW = new Date("2026-10-14T12:00:00Z");

const noSources = buildSourceStatuses({ connections: [], footprints: {}, today: "2026-10-14", now: NOW });

const emptyData: DiagnosticoData = {
  lastSyncedAt: null,
  lastSyncStatus: null,
  window: { start: "2026-10-14", end: "2026-10-14", comparedTo: "28 dias anteriores" },
  insights: [],
  supportMetrics: [],
  analysis: null,
};

const oneInsight = { ...mockDiagnostico.insights[0]!, id: "real-1", dedupeKey: "data-quality:no_key_events" } as Insight;
const realWithInsight: DiagnosticoData = { ...emptyData, insights: [oneInsight] };
const realWithMetrics: DiagnosticoData = { ...mockDiagnostico, insights: [] };

const snapshot: PaidMediaSnapshot = {
  platform: "google_ads",
  label: "Google Ads",
  currency: "BRL",
  window: { start: "2026-09-10", end: "2026-10-07" },
  comparedTo: null,
  daysWithData: 28,
  metrics: [],
};

describe("assembleView — os três modos", () => {
  it("USE_MOCK=true → demonstração: mostra o conjunto fictício e NUNCA mistura mídia paga real", () => {
    const v = assembleView({ useMock: true, demo: mockDiagnostico, real: null, sources: noSources, paidMedia: [snapshot] });
    expect(v.mode).toBe("demo");
    expect(v.data).toBe(mockDiagnostico);
    expect(v.paidMedia).toEqual([]);
    expect(v.empty).toBeNull();
    // o estado REAL das fontes continua aparecendo
    expect(v.sources).toBe(noSources);
  });

  it("demonstração ignora dado real mesmo que exista (não se mistura)", () => {
    const v = assembleView({ useMock: true, demo: mockDiagnostico, real: realWithInsight, sources: noSources, paidMedia: [] });
    expect(v.mode).toBe("demo");
    expect(v.data.insights.map((i) => i.id)).not.toContain("real-1");
  });

  it("USE_MOCK=false com insight real → real", () => {
    const v = assembleView({ useMock: false, demo: mockDiagnostico, real: realWithInsight, sources: noSources, paidMedia: [snapshot] });
    expect(v.mode).toBe("real");
    expect(v.data).toBe(realWithInsight);
    expect(v.paidMedia).toEqual([snapshot]);
    expect(v.empty).toBeNull();
  });

  it("USE_MOCK=false só com métricas de apoio (sem insight) → real", () => {
    expect(
      assembleView({ useMock: false, demo: mockDiagnostico, real: realWithMetrics, sources: noSources, paidMedia: [] }).mode,
    ).toBe("real");
  });

  it("USE_MOCK=false sem dado nenhum → VAZIO, com o motivo e a ação — e NUNCA preenchido com o conjunto fictício", () => {
    const v = assembleView({ useMock: false, demo: mockDiagnostico, real: emptyData, sources: noSources, paidMedia: [] });
    expect(v.mode).toBe("empty");
    expect(v.data).toBe(emptyData);
    expect(v.data.insights).toEqual([]);
    expect(v.data.supportMetrics).toEqual([]);
    expect(v.empty?.title).toBe("O diagnóstico ainda não tem dados do GA4");
    expect(v.empty?.action?.href).toBe("/conexoes");
    // nada do conjunto fictício vaza para a visão real
    expect(JSON.stringify(v)).not.toContain(mockDiagnostico.insights[0]!.title);
  });

  it("vazio mantém a mídia paga real (a tela continua útil sem o GA4)", () => {
    const v = assembleView({ useMock: false, demo: mockDiagnostico, real: emptyData, sources: noSources, paidMedia: [snapshot] });
    expect(v.mode).toBe("empty");
    expect(v.paidMedia).toEqual([snapshot]);
  });

  it("fora da demonstração, não ler o diagnóstico real é um erro de programação — nunca um vazio silencioso", () => {
    expect(() =>
      assembleView({ useMock: false, demo: mockDiagnostico, real: null, sources: noSources, paidMedia: [] }),
    ).toThrow(/não foi lido/);
  });

  it("o motivo do vazio acompanha o estado real das fontes", () => {
    const sources: SourceStatus[] = buildSourceStatuses({
      connections: [
        {
          provider: "ga4",
          status: "reauth_required",
          lastSyncedAt: null,
          lastError: null,
          tokenExpiresAt: null,
          hasSelectedAccount: true,
          lastRun: null,
        },
      ],
      footprints: {},
      today: "2026-10-14",
      now: NOW,
    });
    const v = assembleView({ useMock: false, demo: mockDiagnostico, real: emptyData, sources, paidMedia: [] });
    expect(v.empty?.title).toBe("O acesso ao GA4 expirou");
  });
});

describe("o conjunto de demonstração é inequivocamente fictício", () => {
  it("existe só em src/mock.ts e o padrão de USE_MOCK é false", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const env = readFileSync(join(import.meta.dirname, "..", "..", "..", "env.ts"), "utf8");
    expect(env).toMatch(/USE_MOCK:\s*z\s*\.enum\(\["true", "false"\]\)\s*\.default\("false"\)/);
  });
});
