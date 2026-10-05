import { afterEach, describe, expect, it, vi } from "vitest";

import type { PullArgs, RawRecord } from "@/server/connectors/types";

import { MAX_HISTORY_DAYS, pull } from "@/server/connectors/rd_station_marketing/extract";
import { mapToCanonical } from "@/server/connectors/rd_station_marketing/mapping";

import { fakeAssetRow, fakeConversionsResponse } from "./fixtures";

function args(overrides: Partial<PullArgs> = {}): PullArgs {
  return {
    access: { accessToken: "access-token-abc" },
    account: { externalId: "account", timezone: null, currency: null },
    stream: "conversion_assets_daily",
    since: "2026-08-01",
    until: "2026-08-03",
    ...overrides,
  };
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("rd_station_marketing pull — stream desconhecido", () => {
  it("lança erro explícito, sem fazer nenhuma requisição HTTP", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(drain(pull(args({ stream: "outro" })))).rejects.toThrow(
      /Stream desconhecido/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("rd_station_marketing pull — uma chamada por dia", () => {
  it("3 dias na janela → 3 RawRecords, um por dia, cada um com start_date=end_date=<dia>", async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenUrls.push(url);
        const day = new URL(url).searchParams.get("start_date")!;
        return new Response(
          JSON.stringify(fakeConversionsResponse(day, [fakeAssetRow()])),
          { status: 200 },
        );
      }),
    );

    const records = (await drain(pull(args()))) as Array<{
      occurredOn: string | null;
      externalId: string;
    }>;

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.occurredOn)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(records[0]!.externalId).toBe("rd_station_marketing:2026-08-01");
    for (const url of seenUrls) {
      const u = new URL(url);
      expect(u.searchParams.get("start_date")).toBe(u.searchParams.get("end_date"));
    }
  });

  it("resposta fora do contrato (asset sem assetType — ok) mas sem array `conversions` → ainda assim não quebra (campo opcional)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ account_id: 1 }), { status: 200 })),
    );
    const records = await drain(pull(args({ since: "2026-08-01", until: "2026-08-01" })));
    expect(records).toHaveLength(1); // a VALIDAÇÃO de forma passa; ausência de `conversions` é tratada no mapping
  });

  it("resposta com formato errado (tipo trocado) → Zod rejeita, pull propaga o erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ conversions: "não é um array" }), {
            status: 200,
          }),
      ),
    );
    await expect(
      drain(pull(args({ since: "2026-08-01", until: "2026-08-01" }))),
    ).rejects.toThrow();
  });
});

describe("rd_station_marketing pull → mapToCanonical — caminho completo com o formato real da API", () => {
  it("resposta HTTP com conversões > 0 chega ao canonical com conversions > 0 e asset_type preenchido", async () => {
    // o `pull` valida a forma (Zod) e o `mapToCanonical` valida de novo: se o schema
    // não declarar `assets_type`/`conversion_count`, o Zod os descarta no caminho
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const day = new URL(url).searchParams.get("start_date")!;
        return new Response(
          JSON.stringify(
            fakeConversionsResponse(day, [
              fakeAssetRow({
                assetId: 1,
                assetsType: "LandingPage",
                visitsCount: "40",
                conversionCount: 3,
              }),
              fakeAssetRow({
                assetId: 2,
                assetsType: "Forms",
                visitsCount: 0,
                conversionCount: 0,
                conversionRate: 0,
              }),
            ]),
          ),
          { status: 200 },
        );
      }),
    );

    const records = (await drain(
      pull(args({ since: "2026-08-01", until: "2026-08-02" })),
    )) as RawRecord[];
    const rows = records.flatMap((record) => {
      const batch = mapToCanonical(record.stream, record);
      if (batch.target !== "conversion_assets") throw new Error("unreachable");
      return batch.rows;
    });

    expect(rows).toHaveLength(4); // 2 dias × 2 ativos
    for (const day of ["2026-08-01", "2026-08-02"]) {
      const ofDay = rows.filter((r) => r.date === day);
      expect(ofDay.map((r) => r.assetType)).toEqual(["LandingPage", "Forms"]);
      expect(ofDay.map((r) => r.conversions)).toEqual([3, 0]);
      expect(ofDay.map((r) => r.visits)).toEqual([40, 0]);
    }
  });
});

describe("rd_station_marketing pull — teto de 45 dias do plano Pro", () => {
  it("janela pedida de 200 dias é cortada para os últimos 45 (MAX_HISTORY_DAYS)", async () => {
    const until = "2026-09-20";
    const since = "2026-03-01"; // ~200 dias antes
    const seenDays: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenDays.push(new URL(url).searchParams.get("start_date")!);
        return new Response(JSON.stringify(fakeConversionsResponse("x", [])), {
          status: 200,
        });
      }),
    );

    await drain(pull(args({ since, until })));

    expect(seenDays).toHaveLength(MAX_HISTORY_DAYS);
    // o primeiro dia consultado é exatamente 45 dias antes de `until` (inclusive)
    expect(seenDays[0]).toBe("2026-08-07");
    expect(seenDays.at(-1)).toBe(until);
    expect(seenDays).not.toContain(since); // `since` original nunca é consultado
  });

  it("janela já dentro de 45 dias não é afetada pelo clamp", async () => {
    const seenDays: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenDays.push(new URL(url).searchParams.get("start_date")!);
        return new Response(JSON.stringify(fakeConversionsResponse("x", [])), {
          status: 200,
        });
      }),
    );
    await drain(pull(args({ since: "2026-08-01", until: "2026-08-03" })));
    expect(seenDays).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });
});
