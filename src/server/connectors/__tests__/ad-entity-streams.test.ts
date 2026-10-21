/**
 * Streams de DETALHE (área Campanhas · Fase 1): grupo de anúncios / conjunto de anúncios
 * e anúncio, por dia, no Google Ads e no Meta Ads. Cobre a consulta enviada, o
 * mapeamento para `ad_entity` (hierarquia do provedor preservada, mesmas definições do
 * grão campanha) e a janela própria do detalhe no sync.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanonicalAdEntityRow, PullArgs, RawRecord } from "@/server/connectors/types";
import { detailWindowStart } from "@/server/sync/detail-window";

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_URL: "http://localhost:3000",
    GOOGLE_OAUTH_CLIENT_ID: "x",
    GOOGLE_OAUTH_CLIENT_SECRET: "x",
    GOOGLE_ADS_DEVELOPER_TOKEN: undefined,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined,
    META_APP_ID: undefined,
    META_APP_SECRET: undefined,
    META_LOGIN_CONFIG_ID: undefined,
  },
}));

const google = await import("@/server/connectors/google_ads");
const { buildQuery } = await import("@/server/connectors/google_ads/extract");
const meta = await import("@/server/connectors/meta_ads");
const metaExtract = await import("@/server/connectors/meta_ads/extract");

afterEach(() => vi.unstubAllGlobals());

const raw = (stream: string, payload: unknown): RawRecord => ({
  stream,
  externalId: null,
  occurredOn: null,
  payload,
  sourceHash: "h",
});

function entityRows(batch: ReturnType<typeof google.googleAdsConnector.mapToCanonical>): CanonicalAdEntityRow[] {
  expect(batch.target).toBe("ad_entity");
  return batch.rows as CanonicalAdEntityRow[];
}

describe("streams declarados", () => {
  it("campanha continua obrigatória; detalhe é opcional nas duas plataformas", () => {
    for (const c of [google.googleAdsConnector, meta.metaAdsConnector]) {
      const required = c.streams.filter((s) => !s.optional).map((s) => s.id);
      expect(required).toEqual(["campaign_daily"]);
      expect(c.streams.filter((s) => s.optional)).toHaveLength(2);
    }
  });
});

describe("Google Ads — GAQL de detalhe", () => {
  it("grupo × dia sai de FROM ad_group; anúncio × dia de FROM ad_group_ad", () => {
    const g = buildQuery("ad_group_daily", "2026-09-01", "2026-09-30");
    expect(g).toMatch(/FROM ad_group WHERE segments\.date BETWEEN '2026-09-01' AND '2026-09-30'/);
    expect(g).toContain("ad_group.status");
    expect(g).not.toMatch(/search_impression_share|keyword|search_term/);

    const a = buildQuery("ad_daily", "2026-09-01", "2026-09-30");
    expect(a).toMatch(/FROM ad_group_ad WHERE/);
    expect(a).toContain("ad_group_ad.ad.id");
    expect(a).toContain("ad_group.id");
  });

  it("a GAQL de campanha não mudou (sem ad_group)", () => {
    const c = buildQuery("campaign_daily", "2026-09-01", "2026-09-30");
    expect(c).toContain("FROM campaign");
    expect(c).not.toMatch(/ad_group/);
  });

  it("stream desconhecido continua falhando", () => {
    expect(() => buildQuery("keyword_daily", "2026-09-01", "2026-09-30")).toThrow(/Stream desconhecido/);
  });
});

describe("Google Ads — mapeamento de detalhe", () => {
  const groupRow = {
    customer: { id: "1234567890", currencyCode: "BRL" },
    campaign: { id: "111" },
    adGroup: { id: "900", name: " Grupo A ", status: "ENABLED", type: "SEARCH_STANDARD" },
    segments: { date: "2026-09-01" },
    metrics: { impressions: "1000", clicks: "50", costMicros: "12345678", conversions: 2.5, conversionsValue: 100 },
  };

  it("grupo: hierarquia, conta, micros → moeda (4 casas), conversões fracionárias", () => {
    const [r] = entityRows(google.googleAdsConnector.mapToCanonical("ad_group_daily", raw("ad_group_daily", { results: [groupRow] })));
    expect(r).toMatchObject({
      level: "ad_group",
      accountId: "customers/1234567890",
      campaignId: "111",
      adGroupId: "900",
      adGroupName: "Grupo A",
      adId: "",
      status: "ENABLED",
      entityType: "SEARCH_STANDARD",
      impressions: 1000,
      clicks: 50,
      cost: 12.3457,
      conversions: 2.5,
      currency: "BRL",
    });
  });

  it("anúncio: status e tipo do ANÚNCIO, com o grupo junto", () => {
    const adRow = {
      ...groupRow,
      adGroupAd: { status: "PAUSED", ad: { id: "55", name: "", type: "RESPONSIVE_SEARCH_AD" } },
    };
    const [r] = entityRows(google.googleAdsConnector.mapToCanonical("ad_daily", raw("ad_daily", { results: [adRow] })));
    expect(r).toMatchObject({ level: "ad", adGroupId: "900", adId: "55", status: "PAUSED", entityType: "RESPONSIVE_SEARCH_AD" });
  });

  it("moeda ausente é null (nunca BRL); hash determinístico e sensível a valor", () => {
    const noCur = { ...groupRow, customer: { id: "1" } };
    const a = entityRows(google.googleAdsConnector.mapToCanonical("ad_group_daily", raw("ad_group_daily", { results: [noCur] })))[0]!;
    const b = entityRows(google.googleAdsConnector.mapToCanonical("ad_group_daily", raw("ad_group_daily", { results: [noCur] })))[0]!;
    const c = entityRows(
      google.googleAdsConnector.mapToCanonical("ad_group_daily", raw("ad_group_daily", { results: [{ ...noCur, metrics: { ...noCur.metrics, clicks: "51" } }] })),
    )[0]!;
    expect(a.currency).toBeNull();
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.sourceHash).not.toBe(c.sourceHash);
  });

  it("linha sem ad_group.id ou sem ad.id falha alto", () => {
    const noGroup = { ...groupRow, adGroup: undefined };
    expect(() => google.googleAdsConnector.mapToCanonical("ad_group_daily", raw("ad_group_daily", { results: [noGroup] }))).toThrow(
      /fora do contrato/,
    );
    expect(() => google.googleAdsConnector.mapToCanonical("ad_daily", raw("ad_daily", { results: [groupRow] }))).toThrow(
      /fora do contrato/,
    );
  });
});

describe("Meta Ads — detalhe", () => {
  const row = {
    account_id: "123456789",
    campaign_id: "120001",
    adset_id: "230001",
    adset_name: "Conjunto SP",
    ad_id: "340001",
    ad_name: "Criativo 1",
    objective: "OUTCOME_LEADS",
    date_start: "2026-10-01",
    account_currency: "BRL",
    impressions: "1000",
    clicks: "40",
    inline_link_clicks: "25",
    spend: "123.45",
    actions: [
      { action_type: "lead", value: "3" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "3" },
      { action_type: "purchase", value: "1" },
    ],
    action_values: [{ action_type: "purchase", value: "200" }],
  };

  it("conjunto: adset vira o 2º nível; clique = clique no link; sem status inventado", () => {
    const [r] = entityRows(meta.metaAdsConnector.mapToCanonical("adset_daily", raw("adset_daily", { data: [row] })));
    expect(r).toMatchObject({
      level: "ad_group",
      accountId: "act_123456789",
      campaignId: "120001",
      adGroupId: "230001",
      adGroupName: "Conjunto SP",
      adId: "",
      status: "",
      clicks: 25,
      cost: 123.45,
      conversions: 4, // lead (3) + purchase (1), sem recontar o sub-tipo do pixel
      conversionValue: 200,
    });
    expect(r!.dims).toMatchObject({ objective: "OUTCOME_LEADS", allClicks: 40, conversionActions: { lead: 3, purchase: 1 } });
  });

  it("anúncio: preserva o conjunto e o anúncio", () => {
    const [r] = entityRows(meta.metaAdsConnector.mapToCanonical("ad_daily", raw("ad_daily", { data: [row] })));
    expect(r).toMatchObject({ level: "ad", adGroupId: "230001", adId: "340001", adName: "Criativo 1" });
  });

  it("linha de anúncio sem ad_id falha alto", () => {
    const noAd = { ...row, ad_id: undefined };
    expect(() => meta.metaAdsConnector.mapToCanonical("ad_daily", raw("ad_daily", { data: [noAd] }))).toThrow(/fora do contrato/);
  });

  it("pull do detalhe pede o nível certo à Insights", async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        calls.push(url);
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );
    const args = (stream: string): PullArgs => ({
      access: { accessToken: "t" },
      account: { externalId: "act_1", timezone: null, currency: null },
      stream,
      since: "2026-10-01",
      until: "2026-10-02",
    });
    for await (const _ of metaExtract.pull(args("adset_daily"))) void _;
    for await (const _ of metaExtract.pull(args("ad_daily"))) void _;
    expect(calls.map((u) => u.searchParams.get("level"))).toEqual(["adset", "ad"]);
    expect(calls[1]!.searchParams.get("fields")).toContain("ad_id");
  });
});

describe("detailWindowStart", () => {
  const base = { since: "2026-10-10", historyStart: "2026-04-20", restatementDays: 14 };

  it("nada gravado em algum nível → histórico completo", () => {
    expect(detailWindowStart({ ...base, lastDates: [null, null] })).toBe("2026-04-20");
    expect(detailWindowStart({ ...base, lastDates: ["2026-10-15", null] })).toBe("2026-04-20");
  });

  it("detalhe em dia → mesma janela do sync de campanha", () => {
    expect(detailWindowStart({ ...base, lastDates: ["2026-10-30", "2026-10-30"] })).toBe("2026-10-10");
  });

  it("detalhe atrasado (falha anterior) → retoma do nível mais atrasado − restatement", () => {
    expect(detailWindowStart({ ...base, lastDates: ["2026-10-20", "2026-09-01"] })).toBe("2026-08-18");
  });

  it("nunca antes do início do histórico", () => {
    expect(detailWindowStart({ ...base, lastDates: ["2026-04-21", "2026-04-21"] })).toBe("2026-04-20");
  });
});
