/**
 * A tela, renderizada de verdade: os três modos do Diagnóstico, o painel de fontes, a
 * mídia paga real e o cartão do Meta Ads. O que se trava:
 *  - demonstração SEMPRE identificada (selo, aviso e moldura) e nunca presente no modo real;
 *  - estado vazio explica o motivo e dá a ação, mostra as fontes e NUNCA o conjunto fictício;
 *  - moeda ausente nunca vira R$; variação sem base nunca vira número.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticoData, DiagnosticoView, PaidMediaSnapshot, SourceStatus } from "@/lib/insight";
import { mockDiagnostico } from "@/mock";
import { buildSourceStatuses, emptyReason } from "@/server/diagnostico/status";

const h = vi.hoisted(() => ({ view: null as unknown }));

vi.mock("@/server/auth", () => ({ requireWorkspace: async () => ({ workspaceId: "ws-1", userId: "u-1" }) }));
vi.mock("@/app/(app)/diagnostico/data", () => ({ getDiagnostico: async () => h.view }));
vi.mock("@/app/(app)/diagnostico/actions", () => ({
  acknowledgeInsight: async () => {},
  dismissInsight: async () => {},
  rateInsight: async () => {},
  reopenInsight: async () => {},
}));
vi.mock("@/app/(app)/conexoes/actions", () => ({
  selecionarContaMetaAds: async () => {},
  importarDadosMetaAds: async () => ({}),
  desconectarMetaAds: async () => {},
  desconectar: async () => {},
  desconectarGoogleAds: async () => {},
  desconectarRdStationCrm: async () => {},
  desconectarRdStationMarketing: async () => {},
  importarDadosRdStationCrm: async () => ({}),
  importarDadosRdStationMarketing: async () => ({}),
  importarDadosGoogleAds: async () => ({}),
  selecionarContaGoogleAds: async () => {},
  selecionarPropriedade: async () => {},
  atualizarDados: async () => ({}),
}));

const NOW = new Date("2026-10-14T12:00:00Z");
const sources = (over: Parameters<typeof buildSourceStatuses>[0]["connections"] = []): SourceStatus[] =>
  buildSourceStatuses({ connections: over, footprints: {}, today: "2026-10-14", now: NOW });

const emptyData: DiagnosticoData = {
  lastSyncedAt: null,
  lastSyncStatus: null,
  window: { start: "2026-10-14", end: "2026-10-14", comparedTo: "28 dias anteriores" },
  insights: [],
  supportMetrics: [],
  analysis: null,
};

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ /g, " ");

async function page(view: DiagnosticoView): Promise<string> {
  h.view = view;
  const { default: DiagnosticoPage } = await import("@/app/(app)/diagnostico/page");
  return text(html((await DiagnosticoPage()) as ReactElement));
}

const MOCK_TITLE = mockDiagnostico.insights[0]!.title;

describe("Diagnóstico — modo demonstração", () => {
  let out: string;
  beforeEach(async () => {
    out = await page({ mode: "demo", data: mockDiagnostico, sources: sources(), paidMedia: [], empty: null });
  });

  it("é inequívoco: selo no título, aviso por extenso e moldura", () => {
    expect(out).toContain("DEMONSTRAÇÃO");
    expect(out).toContain("Modo demonstração — os dados do quadro abaixo são fictícios.");
    expect(out).toContain("DEMONSTRAÇÃO — dados fictícios");
    expect(out).toContain("USE_MOCK=false");
  });

  it("mostra o conjunto fictício e, FORA dele, o estado real das fontes", () => {
    expect(out).toContain(MOCK_TITLE);
    expect(out).toContain("Fontes de dados");
    expect(out).toContain("Não conectada.");
  });
});

describe("Diagnóstico — modo real", () => {
  it("não carrega nenhuma marca de demonstração e mostra mídia paga e fontes", async () => {
    const paid: PaidMediaSnapshot = {
      platform: "google_ads",
      label: "Google Ads",
      currency: "BRL",
      window: { start: "2026-09-10", end: "2026-10-07" },
      comparedTo: { start: "2026-08-13", end: "2026-09-09" },
      daysWithData: 28,
      metrics: [{ key: "cost", label: "Investimento", current: 1234.5, previous: 1000, deltaPct: 0.2345, format: "currency" }],
    };
    const out = await page({
      mode: "real",
      data: { ...mockDiagnostico, insights: [] },
      sources: sources(),
      paidMedia: [paid],
      empty: null,
    });
    expect(out).not.toMatch(/DEMONSTRAÇÃO|fictícios|Modo demonstração/);
    expect(out).toContain("Mídia paga");
    expect(out).toContain("Google Ads");
    expect(out).toContain("R$ 1.234,50");
    expect(out).toContain("+23,5%");
    expect(out).toContain("Fontes de dados");
  });
});

describe("Diagnóstico — estado vazio", () => {
  it("explica o motivo, dá a ação e lista as fontes — e NUNCA mostra o conjunto fictício", async () => {
    const s = sources();
    const out = await page({ mode: "empty", data: emptyData, sources: s, paidMedia: [], empty: emptyReason(s) });
    expect(out).toContain("O diagnóstico ainda não tem dados do GA4");
    expect(out).toContain("Ele analisa o tráfego e as conversões do GA4");
    expect(out).toContain("Conectar Google Analytics 4");
    expect(out).toContain("Fontes de dados");
    for (const label of ["Google Analytics 4", "Google Ads", "Meta Ads", "RD Station Marketing", "RD Station CRM"]) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain(MOCK_TITLE);
    expect(out).not.toMatch(/DEMONSTRAÇÃO|fictícios/);
  });

  it("o motivo muda com o estado real: acesso expirado do GA4", async () => {
    const s = sources([
      {
        provider: "ga4",
        status: "reauth_required",
        lastSyncedAt: null,
        lastError: null,
        tokenExpiresAt: null,
        hasSelectedAccount: true,
        lastRun: null,
      },
    ]);
    const out = await page({ mode: "empty", data: emptyData, sources: s, paidMedia: [], empty: emptyReason(s) });
    expect(out).toContain("O acesso ao GA4 expirou");
    expect(out).toContain("O acesso expirou ou foi revogado.");
    expect(out).toContain("Reconectar");
  });
});

describe("mídia paga real — formatação honesta", () => {
  const base = (over: Partial<PaidMediaSnapshot>): PaidMediaSnapshot => ({
    platform: "meta_ads",
    label: "Meta Ads",
    currency: "USD",
    window: { start: "2026-09-10", end: "2026-10-07" },
    comparedTo: null,
    daysWithData: 20,
    metrics: [
      { key: "cost", label: "Investimento", current: 100, previous: null, deltaPct: null, format: "currency" },
      { key: "clicks", label: "Cliques no link", current: 2500, previous: 0, deltaPct: null, format: "count" },
    ],
    ...over,
  });

  async function render(p: PaidMediaSnapshot): Promise<string> {
    const { DiagnosticoPaidMedia } = await import("@/components/diagnostico-paid-media");
    return text(html(createElement(DiagnosticoPaidMedia, { snapshots: [p] })));
  }

  it("moeda da conta (USD ≠ R$), sem período anterior e base zero ditos por extenso", async () => {
    const out = await render(base({}));
    expect(out).toContain("US$ 100,00");
    expect(out).not.toContain("R$");
    expect(out).toContain("sem período anterior para comparar");
    expect(out).toContain("antes: 0 (variação não calculável: base zero)");
    expect(out).toContain("20 de 28 dias com registro");
  });

  it("moeda não informada: o número sai com o aviso, nunca com R$", async () => {
    const out = await render(base({ currency: null }));
    expect(out).toContain("100,00 (moeda não informada)");
    expect(out).not.toContain("R$");
  });

  it("sem nenhuma plataforma, a seção não existe", async () => {
    const { DiagnosticoPaidMedia } = await import("@/components/diagnostico-paid-media");
    expect(html(createElement(DiagnosticoPaidMedia, { snapshots: [] }))).toBe("");
  });

  it("deixa claro que moeda e conversão são de cada plataforma", async () => {
    const out = await render(base({}));
    expect(out).toMatch(/não são somadas nem comparadas entre si/);
  });
});

describe("cartão do Meta Ads em Conexões", () => {
  const card = async (state: unknown) => {
    const { MetaAdsConnectionCard } = await import("@/components/connection-cards");
    return text(html(createElement(MetaAdsConnectionCard, { state: state as never })));
  };
  const conn = (over: Record<string, unknown> = {}) => ({
    connection: {
      id: "c1",
      status: "connected",
      externalAccountEmail: null,
      scopes: ["ads_read"],
      tokenExpiresAt: new Date(Date.now() + 40 * 86_400_000),
      lastSyncedAt: null,
      lastError: null,
      createdAt: new Date(),
      ...over,
    },
    properties: [
      { id: "p1", externalId: "act_1", displayName: "Conta A", timezone: "America/Sao_Paulo", currency: "BRL", isSelected: true },
    ],
    recentSyncRuns: [],
  });

  it("não conectado: explica o que importa e oferece conectar", async () => {
    const out = await card(null);
    expect(out).toContain("Meta Ads");
    expect(out).toContain("Não conectado");
    expect(out).toContain("Somente leitura");
    expect(out).toContain("Conectar Meta Ads");
  });

  it("conectado e saudável: conta selecionada e nenhum aviso de expiração", async () => {
    const out = await card(conn());
    expect(out).toContain("Conectado");
    expect(out).toContain("Conta selecionada: Conta A (act_1)");
    expect(out).not.toMatch(/expira em|expira hoje/);
  });

  it("perto de expirar: avisa quantos dias faltam (a Meta não renova sozinha)", async () => {
    const out = await card(conn({ tokenExpiresAt: new Date(Date.now() + 3 * 86_400_000 - 1000) }));
    expect(out).toContain("O acesso ao Meta Ads expira em 3 dias.");
    expect(out).toContain("Reconecte a conta antes disso");
  });

  it("acesso expirado: pede reconexão e explica que a Meta não renova", async () => {
    const out = await card(conn({ status: "reauth_required" }));
    expect(out).toContain("Reautorização necessária");
    expect(out).toContain("A Meta não renova o acesso sozinha");
  });

  it("sem conta de anúncios descoberta: explica o que conferir", async () => {
    const state = { ...conn(), properties: [] };
    const out = await card(state);
    expect(out).toContain("Nenhuma conta de anúncios encontrada");
  });

  it("daysUntilExpiry: arredonda para cima e aceita nulo", async () => {
    const { daysUntilExpiry } = await import("@/components/connection-cards");
    const now = new Date("2026-10-14T12:00:00Z");
    expect(daysUntilExpiry(null, now)).toBeNull();
    expect(daysUntilExpiry(new Date("2026-10-15T11:00:00Z"), now)).toBe(1);
    expect(daysUntilExpiry(new Date("2026-10-14T11:00:00Z"), now)).toBe(0);
    expect(daysUntilExpiry(new Date("2026-10-10T12:00:00Z"), now)).toBe(-4);
  });
});
