import { describe, expect, it } from "vitest";

import { mapToCanonical } from "@/server/connectors/google_ads/mapping";
import type {
  CanonicalAdPerfRow,
  CanonicalBatch,
} from "@/server/connectors/types";

import { fakePage, fakeRow, rawFromPage } from "./fixtures";

/** Narrowing + asserção do discriminante: todo caso confirma target ad_performance. */
function adRows(batch: CanonicalBatch): CanonicalAdPerfRow[] {
  if (batch.target !== "ad_performance") {
    throw new Error(`esperava target "ad_performance", veio "${batch.target}"`);
  }
  return batch.rows;
}

const mapRows = (stream: string, payload: unknown): CanonicalAdPerfRow[] =>
  adRows(mapToCanonical(stream, rawFromPage(payload)));

describe("google_ads mapToCanonical — campanha × dia", () => {
  it("linha normal → 1 CanonicalAdPerfRow com todos os campos mapeados", () => {
    const rows = mapRows(
      "campaign_daily",
      fakePage([
        fakeRow({
          campaignId: "111",
          campaignName: "Campanha Search Brasil",
          campaignStatus: "ENABLED",
          channelType: "SEARCH",
          date: "2026-09-01",
          impressions: "1000",
          clicks: "120",
          costMicros: "12340000", // 12.34
          conversions: 8,
          conversionsValue: 960.5,
          searchImpressionShare: 0.62,
          searchBudgetLostImpressionShare: 0.11,
          searchRankLostImpressionShare: 0.27,
          currencyCode: "BRL",
          budgetMicros: "50000000", // 50.00
        }),
      ]),
    );

    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.date).toBe("2026-09-01");
    expect(r.campaignId).toBe("111");
    expect(r.campaignName).toBe("Campanha Search Brasil");
    expect(r.campaignStatus).toBe("ENABLED");
    expect(r.adNetwork).toBe(""); // GAQL não segmenta por rede
    expect(r.impressions).toBe(1000);
    expect(r.clicks).toBe(120);
    expect(r.cost).toBe(12.34);
    expect(r.conversions).toBe(8);
    expect(r.conversionValue).toBe(960.5);
    expect(r.impressionShare).toBe(0.62);
    expect(r.budgetLostIs).toBe(0.11);
    expect(r.rankLostIs).toBe(0.27);
    expect(r.currency).toBe("BRL");
    expect(r.dims).toEqual({ advertisingChannelType: "SEARCH", budgetAmount: 50 });
    expect(r.sourceHash).toHaveLength(64);
  });

  it("múltiplas campanhas e múltiplos dias → uma linha por (campanha, dia)", () => {
    const rows = mapRows(
      "campaign_daily",
      fakePage([
        fakeRow({ campaignId: "111", date: "2026-09-01" }),
        fakeRow({ campaignId: "111", date: "2026-09-02" }),
        fakeRow({ campaignId: "222", date: "2026-09-01" }),
        fakeRow({ campaignId: "222", date: "2026-09-02" }),
      ]),
    );
    expect(rows).toHaveLength(4);
    const keys = rows.map((r) => `${r.campaignId}|${r.date}|${r.adNetwork}`);
    expect(new Set(keys).size).toBe(4); // chaves naturais todas distintas
  });

  it("cost_micros → cost: divisão por 1e6, 4 casas, determinística", () => {
    const cases: Array<[string, number]> = [
      ["0", 0],
      ["1500000", 1.5],
      ["12340000", 12.34],
      ["123456789", 123.4568], // 123.456789 → 4 casas
      ["1", 0], // 0.000001 → 0.0000 no grão numeric(18,4)
      ["987654321000", 987654.321],
    ];
    for (const [micros, expected] of cases) {
      const rows = mapRows(
        "campaign_daily",
        fakePage([fakeRow({ costMicros: micros })]),
      );
      expect(rows[0]!.cost).toBe(expected);
    }
  });

  it("zeros / métricas ausentes → 0 (não quebra)", () => {
    const rows = mapRows(
      "campaign_daily",
      fakePage([fakeRow({ omit: ["metrics"] })]),
    );
    const r = rows[0]!;
    expect(r.impressions).toBe(0);
    expect(r.clicks).toBe(0);
    expect(r.cost).toBe(0);
    expect(r.conversions).toBe(0);
    expect(r.conversionValue).toBe(0);
  });

  it("ausência de impression share → null, NUNCA 0 (§12)", () => {
    const rows = mapRows(
      "campaign_daily",
      fakePage([
        fakeRow({
          searchImpressionShare: null,
          searchBudgetLostImpressionShare: null,
          searchRankLostImpressionShare: null,
        }),
      ]),
    );
    const r = rows[0]!;
    expect(r.impressionShare).toBeNull();
    expect(r.budgetLostIs).toBeNull();
    expect(r.rankLostIs).toBeNull();
  });

  it("impression share presente (Search) → números 0..1", () => {
    const rows = mapRows(
      "campaign_daily",
      fakePage([
        fakeRow({
          searchImpressionShare: 0.8123,
          searchBudgetLostImpressionShare: 0.05,
          searchRankLostImpressionShare: 0.1377,
        }),
      ]),
    );
    const r = rows[0]!;
    expect(r.impressionShare).toBeCloseTo(0.8123, 6);
    expect(r.budgetLostIs).toBeCloseTo(0.05, 6);
    expect(r.rankLostIs).toBeCloseTo(0.1377, 6);
  });

  it("campos opcionais de campanha ausentes → defaults honestos", () => {
    const rows = adRows(
      mapToCanonical(
        "campaign_daily",
        rawFromPage(
          fakePage([
            {
              campaign: { id: "333" },
              segments: { date: "2026-09-03" },
              metrics: { impressions: "10" },
            },
          ]),
        ),
      ),
    );
    const r = rows[0]!;
    expect(r.campaignName).toBe("");
    expect(r.campaignStatus).toBe("");
    expect(r.currency).toBeNull();
    expect(r.impressionShare).toBeNull();
    expect(r.dims).toEqual({ advertisingChannelType: null, budgetAmount: null });
  });

  it("status passa por: ENABLED / PAUSED / REMOVED", () => {
    for (const status of ["ENABLED", "PAUSED", "REMOVED"]) {
      const rows = mapRows(
        "campaign_daily",
        fakePage([fakeRow({ campaignStatus: status })]),
      );
      expect(rows[0]!.campaignStatus).toBe(status);
    }
  });

  it("string int64 grande (impressions/clicks) → número inteiro", () => {
    const rows = mapRows(
      "campaign_daily",
      fakePage([fakeRow({ impressions: "2500000", clicks: "48000" })]),
    );
    expect(rows[0]!.impressions).toBe(2_500_000);
    expect(rows[0]!.clicks).toBe(48_000);
  });

  it("stream desconhecido → batch ad_performance vazio", () => {
    const batch = mapToCanonical("keyword_daily", rawFromPage(fakePage([fakeRow()])));
    expect(batch).toEqual({ target: "ad_performance", rows: [] });
  });

  it("página vazia → 0 linhas", () => {
    expect(mapRows("campaign_daily", fakePage([]))).toHaveLength(0);
  });

  it("linha sem campaign.id → erro explícito (não inventa id)", () => {
    expect(() =>
      mapToCanonical(
        "campaign_daily",
        rawFromPage(fakePage([fakeRow({ omit: ["campaign"] })])),
      ),
    ).toThrow(/campaign\.id ou segments\.date/);
  });

  it("linha sem segments.date → erro explícito (não inventa data)", () => {
    expect(() =>
      mapToCanonical(
        "campaign_daily",
        rawFromPage(fakePage([fakeRow({ omit: ["segments"] })])),
      ),
    ).toThrow(/campaign\.id ou segments\.date/);
  });
});

describe("google_ads mapToCanonical — idempotência / source_hash", () => {
  it("mesma página mapeada 2× → linhas idênticas, mesmo source_hash", () => {
    const page = fakePage([
      fakeRow({ campaignId: "111", date: "2026-09-01" }),
      fakeRow({ campaignId: "222", date: "2026-09-01" }),
    ]);
    const a = mapRows("campaign_daily", page);
    const b = mapRows("campaign_daily", page);
    expect(a).toEqual(b);
    expect(a.map((r) => r.sourceHash)).toEqual(b.map((r) => r.sourceHash));
  });

  it("mudança em métrica → source_hash muda (dispara re-gravação)", () => {
    const base = mapRows(
      "campaign_daily",
      fakePage([fakeRow({ costMicros: "12340000" })]),
    )[0]!;
    const changed = mapRows(
      "campaign_daily",
      fakePage([fakeRow({ costMicros: "99990000" })]),
    )[0]!;
    expect(changed.sourceHash).not.toBe(base.sourceHash);
  });

  it("mudança de status → source_hash muda", () => {
    const enabled = mapRows(
      "campaign_daily",
      fakePage([fakeRow({ campaignStatus: "ENABLED" })]),
    )[0]!;
    const paused = mapRows(
      "campaign_daily",
      fakePage([fakeRow({ campaignStatus: "PAUSED" })]),
    )[0]!;
    expect(paused.sourceHash).not.toBe(enabled.sourceHash);
  });

  it("chave natural estável entre execuções: (campaignId, date, adNetwork)", () => {
    const mk = () =>
      mapRows(
        "campaign_daily",
        fakePage([fakeRow({ campaignId: "111", date: "2026-09-01" })]),
      )[0]!;
    const a = mk();
    const b = mk();
    expect([a.campaignId, a.date, a.adNetwork]).toEqual([
      b.campaignId,
      b.date,
      b.adNetwork,
    ]);
  });

  it("re-ordenar linhas na página não muda os hashes por chave natural", () => {
    const r1 = fakeRow({ campaignId: "111", date: "2026-09-01" });
    const r2 = fakeRow({ campaignId: "222", date: "2026-09-02" });
    const forward = mapRows("campaign_daily", fakePage([r1, r2]));
    const reversed = mapRows("campaign_daily", fakePage([r2, r1]));
    const byKey = (rows: CanonicalAdPerfRow[]) =>
      Object.fromEntries(
        rows.map((r) => [`${r.campaignId}|${r.date}`, r.sourceHash]),
      );
    expect(byKey(forward)).toEqual(byKey(reversed));
  });
});
