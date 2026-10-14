import { describe, expect, it } from "vitest";

import type { RawRecord } from "@/server/connectors/types";
import {
  META_CONVERSION_ACTION_TYPES,
  META_VALUE_ACTION_TYPES,
  mapToCanonical,
} from "@/server/connectors/meta_ads/mapping";

import { insightRow, page } from "./fixtures";

const raw = (payload: unknown): RawRecord => ({
  stream: "campaign_daily",
  externalId: "act_1:2026-10-01:2026-10-10:0",
  occurredOn: null,
  payload,
  sourceHash: "h",
});

function rows(over: Record<string, unknown> = {}) {
  const batch = mapToCanonical("campaign_daily", raw(page([insightRow(over)])));
  expect(batch.target).toBe("ad_performance");
  if (batch.target !== "ad_performance") throw new Error("alvo inesperado");
  return batch.rows;
}

describe("mapToCanonical — campanha × dia", () => {
  it("mapeia a linha para o canônico de mídia paga", () => {
    const [r] = rows();
    expect(r).toMatchObject({
      date: "2026-10-01",
      campaignId: "120001",
      campaignName: "Leads — servidores",
      campaignStatus: "", // a Insights não traz o status; não se inventa
      adNetwork: "", // total da campanha no dia
      impressions: 1000,
      cost: 123.45,
      currency: "BRL",
      impressionShare: null, // métricas de leilão do Google não existem na Meta
      budgetLostIs: null,
      rankLostIs: null,
    });
    expect(r!.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("`clicks` são cliques NO LINK; os cliques totais ficam em dims, nunca no campo comparável", () => {
    const [r] = rows();
    expect(r!.clicks).toBe(25);
    expect(r!.dims).toMatchObject({ allClicks: 40, objective: "OUTCOME_LEADS", reach: 800, frequency: 1.25 });
  });

  it("conversões = SÓ os eventos agregados (lead/compra/cadastro): sub-tipos do mesmo evento não são recontados", () => {
    const [r] = rows();
    // `lead` 3 + (`offsite_conversion.fb_pixel_lead` 3 e `onsite_conversion.lead_grouped` 3 ignorados)
    expect(r!.conversions).toBe(3);
    expect(r!.dims).toMatchObject({ conversionActions: { lead: 3 } });
    expect(META_CONVERSION_ACTION_TYPES).toEqual(["lead", "purchase", "complete_registration"]);
  });

  it("lead + compra + cadastro somam; o valor monetário vem só da compra", () => {
    const [r] = rows({
      actions: [
        { action_type: "lead", value: "2" },
        { action_type: "purchase", value: "1" },
        { action_type: "complete_registration", value: "4" },
        { action_type: "link_click", value: "99" },
        { action_type: "omni_purchase", value: "1" },
      ],
      action_values: [
        { action_type: "purchase", value: "349.9" },
        { action_type: "omni_purchase", value: "349.9" },
        { action_type: "lead", value: "10" },
      ],
    });
    expect(r!.conversions).toBe(7);
    expect(r!.conversionValue).toBe(349.9);
    expect(META_VALUE_ACTION_TYPES).toEqual(["purchase"]);
  });

  it("campo OMITIDO pela Graph API (sem valor) vira 0 em volume e custo, e a moeda ausente é null — nunca BRL", () => {
    const [r] = rows({
      impressions: undefined,
      inline_link_clicks: undefined,
      spend: undefined,
      actions: undefined,
      action_values: undefined,
      account_currency: undefined,
      reach: undefined,
      frequency: undefined,
      clicks: undefined,
    });
    expect(r).toMatchObject({ impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0, currency: null });
    expect(r!.dims).toMatchObject({ allClicks: 0, reach: 0, frequency: null, conversionActions: {} });
  });

  it("números chegam como string e como number; gasto é arredondado a 4 casas", () => {
    const [a] = rows({ impressions: 1234, spend: 0.1 + 0.2 });
    expect(a).toMatchObject({ impressions: 1234, cost: 0.3 });
    const [b] = rows({ spend: "5339.5" });
    expect(b!.cost).toBe(5339.5);
    const [c] = rows({ spend: "abc", impressions: "x" });
    expect(c).toMatchObject({ cost: 0, impressions: 0 });
  });

  it("várias linhas da mesma página; a ordem é preservada", () => {
    const batch = mapToCanonical(
      "campaign_daily",
      raw(page([insightRow(), insightRow({ date_start: "2026-10-02" }), insightRow({ campaign_id: "9" })])),
    );
    if (batch.target !== "ad_performance") throw new Error("alvo");
    expect(batch.rows.map((r) => [r.date, r.campaignId])).toEqual([
      ["2026-10-01", "120001"],
      ["2026-10-02", "120001"],
      ["2026-10-01", "9"],
    ]);
  });

  it("linha sem campaign_id ou sem date_start é contrato quebrado: falha alto, não descarta", () => {
    expect(() => mapToCanonical("campaign_daily", raw(page([insightRow({ campaign_id: undefined })])))).toThrow(
      /fora do contrato/,
    );
    expect(() => mapToCanonical("campaign_daily", raw(page([insightRow({ date_start: undefined })])))).toThrow(
      /fora do contrato/,
    );
  });

  it("página vazia → nenhuma linha; stream desconhecido → lote vazio", () => {
    const empty = mapToCanonical("campaign_daily", raw({ data: [] }));
    expect(empty).toEqual({ target: "ad_performance", rows: [] });
    expect(mapToCanonical("outro", raw(page([insightRow()])))).toEqual({ target: "ad_performance", rows: [] });
  });
});

describe("hash da linha (upsert idempotente)", () => {
  it("é determinístico e muda com QUALQUER valor que precise ser regravado", () => {
    const base = rows()[0]!.sourceHash;
    expect(rows()[0]!.sourceHash).toBe(base);
    for (const change of [
      { spend: "123.46" },
      { impressions: "1001" },
      { inline_link_clicks: "26" },
      { campaign_name: "Outro nome" },
      { account_currency: "USD" },
      { objective: "OUTCOME_SALES" },
      { clicks: "41" },
      { reach: "801" },
      { frequency: "1.26" },
      { actions: [{ action_type: "lead", value: "4" }] },
      { action_values: [{ action_type: "purchase", value: "10" }] },
      { date_start: "2026-10-02" },
      { campaign_id: "120002" },
    ]) {
      expect(rows(change)[0]!.sourceHash, JSON.stringify(change)).not.toBe(base);
    }
  });

  it("não depende de campo que o canônico ignora (ex.: date_stop, link_click)", () => {
    const base = rows()[0]!.sourceHash;
    expect(rows({ date_stop: "2026-10-09" })[0]!.sourceHash).toBe(base);
    expect(
      rows({ actions: [...(insightRow().actions as unknown[]), { action_type: "link_click", value: "26" }] })[0]!.sourceHash,
    ).toBe(base);
  });
});

describe("privacidade", () => {
  it("o canônico só carrega agregados de campanha: nenhum dado pessoal nem token", () => {
    const text = JSON.stringify(rows());
    expect(text).not.toMatch(/email|phone|telefone|access_token|EAAB/i);
  });
});
