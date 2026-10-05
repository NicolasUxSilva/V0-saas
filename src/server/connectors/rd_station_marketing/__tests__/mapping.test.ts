import { describe, expect, it } from "vitest";

import type { RawRecord } from "@/server/connectors/types";

import { mapToCanonical } from "@/server/connectors/rd_station_marketing/mapping";

import { fakeAssetRow, fakeConversionsResponse } from "./fixtures";

function rawFromDay(day: string, rows: Array<Record<string, unknown>>): RawRecord {
  return {
    stream: "conversion_assets_daily",
    externalId: `rd_station_marketing:${day}`,
    occurredOn: day,
    payload: fakeConversionsResponse(day, rows),
    sourceHash: "test-hash",
  };
}

describe("rd_station_marketing mapToCanonical — stream desconhecido", () => {
  it("devolve lote vazio (não lança)", () => {
    const batch = mapToCanonical("outro", rawFromDay("2026-08-01", []));
    expect(batch).toEqual({ target: "conversion_assets", rows: [] });
  });
});

describe("rd_station_marketing mapToCanonical — conversion_assets_daily", () => {
  it("mapeia 1 ativo com todos os campos", () => {
    const raw = rawFromDay("2026-08-01", [fakeAssetRow()]);
    const batch = mapToCanonical("conversion_assets_daily", raw);
    expect(batch.target).toBe("conversion_assets");
    if (batch.target !== "conversion_assets") throw new Error("unreachable");

    expect(batch.rows).toHaveLength(1);
    expect(batch.rows[0]).toMatchObject({
      date: "2026-08-01",
      assetId: "111",
      assetIdentifier: "LP Black Friday",
      assetType: "LandingPage",
      visits: 1000,
      conversions: 50,
      conversionRate: 0.05,
      dims: null,
    });
    expect(typeof batch.rows[0]!.sourceHash).toBe("string");
  });

  it("asset_id numérico (não string) vira string na linha canônica", () => {
    const raw = rawFromDay("2026-08-01", [fakeAssetRow({ assetId: 999 })]);
    const batch = mapToCanonical("conversion_assets_daily", raw);
    if (batch.target !== "conversion_assets") throw new Error("unreachable");
    expect(batch.rows[0]!.assetId).toBe("999");
  });

  it("conversion_rate ausente vira `null`, não 0 (ausência ≠ zero)", () => {
    const raw = rawFromDay("2026-08-01", [fakeAssetRow({ conversionRate: null })]);
    const batch = mapToCanonical("conversion_assets_daily", raw);
    if (batch.target !== "conversion_assets") throw new Error("unreachable");
    expect(batch.rows[0]!.conversionRate).toBeNull();
  });

  it("linha sem asset_id → erro explícito, resposta fora do contrato", () => {
    const raw = rawFromDay("2026-08-01", [fakeAssetRow({ omitAssetId: true })]);
    expect(() => mapToCanonical("conversion_assets_daily", raw)).toThrow(
      /sem asset_id/,
    );
  });

  it("sem `occurredOn` no RawRecord, usa query_date.start_date como fallback", () => {
    const raw: RawRecord = {
      stream: "conversion_assets_daily",
      externalId: "x",
      occurredOn: null,
      payload: fakeConversionsResponse("2026-08-02", [fakeAssetRow()]),
      sourceHash: "h",
    };
    const batch = mapToCanonical("conversion_assets_daily", raw);
    if (batch.target !== "conversion_assets") throw new Error("unreachable");
    expect(batch.rows[0]!.date).toBe("2026-08-02");
  });

  it("idempotência: o mesmo payload produz sempre o mesmo sourceHash", () => {
    const raw1 = rawFromDay("2026-08-01", [fakeAssetRow()]);
    const raw2 = rawFromDay("2026-08-01", [fakeAssetRow()]);
    const b1 = mapToCanonical("conversion_assets_daily", raw1);
    const b2 = mapToCanonical("conversion_assets_daily", raw2);
    if (b1.target !== "conversion_assets" || b2.target !== "conversion_assets") {
      throw new Error("unreachable");
    }
    expect(b1.rows[0]!.sourceHash).toBe(b2.rows[0]!.sourceHash);
  });

  it("mudar uma métrica muda o sourceHash", () => {
    const raw1 = rawFromDay("2026-08-01", [fakeAssetRow({ visitsCount: 1000 })]);
    const raw2 = rawFromDay("2026-08-01", [fakeAssetRow({ visitsCount: 1001 })]);
    const b1 = mapToCanonical("conversion_assets_daily", raw1);
    const b2 = mapToCanonical("conversion_assets_daily", raw2);
    if (b1.target !== "conversion_assets" || b2.target !== "conversion_assets") {
      throw new Error("unreachable");
    }
    expect(b1.rows[0]!.sourceHash).not.toBe(b2.rows[0]!.sourceHash);
  });

  it("sem linhas de conversão no dia → lote com 0 linhas (dia sem ativos, não erro)", () => {
    const raw = rawFromDay("2026-08-01", []);
    const batch = mapToCanonical("conversion_assets_daily", raw);
    if (batch.target !== "conversion_assets") throw new Error("unreachable");
    expect(batch.rows).toHaveLength(0);
  });
});

// ── nomes REAIS da API: `assets_type` e `conversion_count` ──────────────────
// A documentação oficial publica `asset_type` e `conversions_count`; a API real
// devolve `assets_type` e `conversion_count` (confirmado nas 90 linhas da conta
// piloto). O mapper lia os nomes da doc: `asset_type` ficou "" e as conversões
// ficariam sempre 0, sem erro e sem nenhum teste vermelho — as fixtures também
// seguiam a doc. Os testes abaixo fixam os nomes reais.

/**
 * Payload LITERAL no formato exato que `GET /platform/analytics/conversions`
 * devolve na conta real (chaves e tipos copiados dela — dia com um ativo com
 * visitas e outro sem, zero conversões; valores sintéticos). Sem helper no
 * meio, de propósito: se a API mudar os nomes, ou alguém "consertar" o mapper de
 * volta para os nomes da doc, são estes testes que têm que quebrar.
 * Repare nos dois tipos de `visits_count` da API real: string quando > 0
 * (`"6"`), number quando 0.
 */
const REAL_SHAPED_ZERO_DAY = {
  account_id: 1234567,
  query_date: { start_date: "2026-10-02", end_date: "2026-10-02" },
  assets_type: ["LandingPage", "Forms", "Popup"],
  conversions: [
    {
      asset_id: 1000001,
      assets_type: "LandingPage",
      visits_count: "6",
      conversion_rate: 0,
      asset_created_at: "2026-07-14T12:32:13.944-03:00",
      asset_identifier: "lp-exemplo",
      asset_updated_at: "2026-08-03T16:50:54.470-03:00",
      conversion_count: 0,
    },
    {
      asset_id: 1000002,
      assets_type: "LandingPage",
      visits_count: 0,
      conversion_rate: 0,
      asset_created_at: "2026-09-01T09:00:00.000-03:00",
      asset_identifier: "lp-confirmacao-exemplo",
      asset_updated_at: "2026-09-01T09:00:00.000-03:00",
      conversion_count: 0,
    },
  ],
};

function mapRows(payload: Record<string, unknown>) {
  const raw: RawRecord = {
    stream: "conversion_assets_daily",
    externalId: "rd_station_marketing:2026-10-02",
    occurredOn: "2026-10-02",
    payload,
    sourceHash: "test-hash",
  };
  const batch = mapToCanonical("conversion_assets_daily", raw);
  if (batch.target !== "conversion_assets") throw new Error("unreachable");
  return batch.rows;
}

describe("rd_station_marketing mapToCanonical — nomes reais da API (assets_type / conversion_count)", () => {
  it("assets_type da linha chega em assetType no canonical (não fica vazio)", () => {
    const rows = mapRows(
      fakeConversionsResponse("2026-10-02", [
        fakeAssetRow({ assetId: 1, assetsType: "LandingPage" }),
        fakeAssetRow({ assetId: 2, assetsType: "Forms" }),
        fakeAssetRow({ assetId: 3, assetsType: "Popup" }),
      ]),
    );
    expect(rows.map((r) => r.assetType)).toEqual(["LandingPage", "Forms", "Popup"]);
  });

  it("o assets_type do TOPO (lista de tipos) não vaza para a linha — só o da própria linha vale", () => {
    // topo: ["LandingPage","Forms","Popup"]; linha: "Popup"
    const rows = mapRows(
      fakeConversionsResponse("2026-10-02", [fakeAssetRow({ assetsType: "Popup" })]),
    );
    expect(rows[0]!.assetType).toBe("Popup");
  });

  it("conversion_count chega em conversions — como number e como string numérica", () => {
    const rows = mapRows(
      fakeConversionsResponse("2026-10-02", [
        fakeAssetRow({ assetId: 1, conversionCount: 7 }),
        // a API manda `visits_count` como string quando > 0; `conversion_count` > 0
        // ainda não foi observado, então a string numérica tem que valer também
        fakeAssetRow({ assetId: 2, conversionCount: "12" }),
      ]),
    );
    expect(rows.map((r) => r.conversions)).toEqual([7, 12]);
  });

  it("payload com conversões > 0 NUNCA resulta em conversions = 0 (a falha silenciosa original)", () => {
    const rows = mapRows(
      fakeConversionsResponse("2026-10-02", [
        fakeAssetRow({ assetId: 1, visitsCount: "40", conversionCount: 3 }),
        fakeAssetRow({ assetId: 2, visitsCount: 0, conversionCount: 0, conversionRate: 0 }),
        fakeAssetRow({ assetId: 3, visitsCount: "90", conversionCount: 12 }),
      ]),
    );
    // cada ativo que a fonte reporta com conversão tem conversão no canonical…
    expect(rows[0]!.conversions).toBeGreaterThan(0);
    expect(rows[2]!.conversions).toBeGreaterThan(0);
    expect(rows.map((r) => r.conversions)).toEqual([3, 0, 12]);
    // …e o total do dia bate com o da fonte (3 + 0 + 12), não 0
    expect(rows.reduce((sum, r) => sum + r.conversions, 0)).toBe(15);
    // visitas e conversões são lidas de campos independentes
    expect(rows.map((r) => r.visits)).toEqual([40, 0, 90]);
  });

  it("payload no formato real com 0 conversões continua correto (conversions 0, visitas e tipo preservados)", () => {
    const rows = mapRows(REAL_SHAPED_ZERO_DAY);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-10-02",
      assetId: "1000001",
      assetIdentifier: "lp-exemplo",
      assetType: "LandingPage",
      visits: 6, // "6" (string) na API
      conversions: 0,
      conversionRate: 0, // 0 reportado ≠ null (ausência)
    });
    expect(rows[1]).toMatchObject({
      assetId: "1000002",
      assetIdentifier: "lp-confirmacao-exemplo",
      assetType: "LandingPage",
      visits: 0, // 0 (number) na API
      conversions: 0,
      conversionRate: 0,
    });
  });

  it("mudar só o conversion_count muda o sourceHash — senão o upsert não atualizaria uma linha já gravada", () => {
    const hashFor = (n: number) =>
      mapRows(
        fakeConversionsResponse("2026-10-02", [fakeAssetRow({ conversionCount: n })]),
      )[0]!.sourceHash;
    expect(hashFor(0)).not.toBe(hashFor(1));
  });

  it("mudar só o assets_type muda o sourceHash — é o que faz o upsert corrigir, no re-pull do dia, as linhas antigas gravadas com asset_type vazio", () => {
    const hashFor = (assetsType: string) =>
      mapRows(
        fakeConversionsResponse("2026-10-02", [fakeAssetRow({ assetsType })]),
      )[0]!.sourceHash;
    expect(hashFor("")).not.toBe(hashFor("LandingPage"));
  });
});
