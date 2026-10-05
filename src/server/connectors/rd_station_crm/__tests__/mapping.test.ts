import { describe, expect, it } from "vitest";

import type { RawRecord } from "@/server/connectors/types";

import { mapToCanonical } from "@/server/connectors/rd_station_crm/mapping";

import { fakeDeal, fakeDealsPage } from "./fixtures";

function rawFromDeals(deals: Array<Record<string, unknown>>): RawRecord {
  return {
    stream: "deals",
    externalId: "x",
    occurredOn: null,
    payload: fakeDealsPage(deals),
    sourceHash: "test-hash",
  };
}

describe("rd_station_crm mapToCanonical — stream desconhecido", () => {
  it("devolve lote vazio (não lança)", () => {
    const batch = mapToCanonical("outro", rawFromDeals([]));
    expect(batch).toEqual({ target: "opportunities", rows: [] });
  });
});

describe("rd_station_crm mapToCanonical — deals", () => {
  it("mapeia 1 negociação com todos os campos técnicos, SEM name nem contact_ids (PII/RD-1)", () => {
    const raw = rawFromDeals([
      fakeDeal({
        id: "deal-1",
        status: "won",
        totalPrice: 5000,
        pipelineId: "pipe-1",
        stageId: "stage-2",
        sourceId: "src-1",
        campaignId: "camp-1",
        createdAt: "2026-01-05T10:00:00Z",
        updatedAt: "2026-08-20T09:30:00Z",
        closedAt: "2026-08-15T14:00:00Z",
      }),
    ]);
    const batch = mapToCanonical("deals", raw);
    expect(batch.target).toBe("opportunities");
    if (batch.target !== "opportunities") throw new Error("unreachable");

    const row = batch.rows[0]!;
    expect(row).toMatchObject({
      dealId: "deal-1",
      status: "won",
      totalPrice: 5000,
      pipelineId: "pipe-1",
      stageId: "stage-2",
      sourceId: "src-1",
      campaignId: "camp-1",
      lostReasonId: "",
      // data do FATO (created_at/closed_at) — não deal_updated_at
      dealCreatedAt: "2026-01-05",
      dealClosedAt: "2026-08-15",
      dealUpdatedAt: "2026-08-20T09:30:00Z",
    });
    expect(Object.keys(row)).not.toContain("name");
    expect(Object.keys(row)).not.toContain("contactIds");
    expect(Object.keys(row)).not.toContain("ownerId");
  });

  it("deal_created_at usado para a data do fato, NUNCA deal_updated_at — mesmo quando são bem diferentes", () => {
    const raw = rawFromDeals([
      fakeDeal({
        createdAt: "2026-01-05T10:00:00Z", // aberta há 7+ meses
        updatedAt: "2026-08-20T09:30:00Z", // atualizada hoje (fechou agora)
      }),
    ]);
    const batch = mapToCanonical("deals", raw);
    if (batch.target !== "opportunities") throw new Error("unreachable");
    expect(batch.rows[0]!.dealCreatedAt).toBe("2026-01-05");
    expect(batch.rows[0]!.dealUpdatedAt).not.toBe(batch.rows[0]!.dealCreatedAt);
  });

  it("negociação aberta (sem closed_at) → dealClosedAt é `null`, não uma data inventada", () => {
    const raw = rawFromDeals([fakeDeal({ status: "ongoing", closedAt: null })]);
    const batch = mapToCanonical("deals", raw);
    if (batch.target !== "opportunities") throw new Error("unreachable");
    expect(batch.rows[0]!.dealClosedAt).toBeNull();
  });

  it("dimensões ausentes (null) viram string vazia — não null solto na coluna de texto", () => {
    const raw = rawFromDeals([
      fakeDeal({ pipelineId: null, stageId: null, sourceId: null, campaignId: null, lostReasonId: null }),
    ]);
    const batch = mapToCanonical("deals", raw);
    if (batch.target !== "opportunities") throw new Error("unreachable");
    const row = batch.rows[0]!;
    expect(row.pipelineId).toBe("");
    expect(row.stageId).toBe("");
    expect(row.sourceId).toBe("");
    expect(row.campaignId).toBe("");
    expect(row.lostReasonId).toBe("");
  });

  it("negociação sem id → erro explícito, resposta fora do contrato", () => {
    const raw = rawFromDeals([fakeDeal({ omitId: true })]);
    expect(() => mapToCanonical("deals", raw)).toThrow(/sem id\/created_at\/updated_at/);
  });

  it("negociação sem created_at → erro explícito", () => {
    const raw = rawFromDeals([fakeDeal({ omitCreatedAt: true })]);
    expect(() => mapToCanonical("deals", raw)).toThrow(/sem id\/created_at\/updated_at/);
  });

  it("negociação sem updated_at → erro explícito", () => {
    const raw = rawFromDeals([fakeDeal({ omitUpdatedAt: true })]);
    expect(() => mapToCanonical("deals", raw)).toThrow(/sem id\/created_at\/updated_at/);
  });

  it("idempotência: o mesmo deal produz sempre o mesmo sourceHash", () => {
    const raw1 = rawFromDeals([fakeDeal({ id: "deal-x" })]);
    const raw2 = rawFromDeals([fakeDeal({ id: "deal-x" })]);
    const b1 = mapToCanonical("deals", raw1);
    const b2 = mapToCanonical("deals", raw2);
    if (b1.target !== "opportunities" || b2.target !== "opportunities") {
      throw new Error("unreachable");
    }
    expect(b1.rows[0]!.sourceHash).toBe(b2.rows[0]!.sourceHash);
  });

  it("mudar o status muda o sourceHash (ex.: ongoing → won)", () => {
    const raw1 = rawFromDeals([fakeDeal({ id: "deal-x", status: "ongoing" })]);
    const raw2 = rawFromDeals([fakeDeal({ id: "deal-x", status: "won" })]);
    const b1 = mapToCanonical("deals", raw1);
    const b2 = mapToCanonical("deals", raw2);
    if (b1.target !== "opportunities" || b2.target !== "opportunities") {
      throw new Error("unreachable");
    }
    expect(b1.rows[0]!.sourceHash).not.toBe(b2.rows[0]!.sourceHash);
  });

  it("múltiplas negociações na mesma página → uma linha canônica por deal, sem agregação", () => {
    const raw = rawFromDeals([fakeDeal({ id: "deal-1" }), fakeDeal({ id: "deal-2" })]);
    const batch = mapToCanonical("deals", raw);
    if (batch.target !== "opportunities") throw new Error("unreachable");
    expect(batch.rows).toHaveLength(2);
    expect(batch.rows.map((r) => r.dealId).sort()).toEqual(["deal-1", "deal-2"]);
  });
});
