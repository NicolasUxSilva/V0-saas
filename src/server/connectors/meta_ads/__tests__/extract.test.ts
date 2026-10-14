import { afterEach, describe, expect, it, vi } from "vitest";

import type { PullArgs, RawRecord } from "@/server/connectors/types";

import { TOKEN, graphError, insightRow, jsonResponse, page } from "./fixtures";

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_URL: "http://localhost:3000",
    META_APP_ID: undefined,
    META_APP_SECRET: undefined,
    META_LOGIN_CONFIG_ID: undefined,
  },
}));

const { CHUNK_DAYS, PAGE_LIMIT, insightsPath, pull, sanitizePage, splitWindow } = await import(
  "@/server/connectors/meta_ads/extract"
);

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...responses: Response[]) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("fetch chamado mais vezes que o previsto");
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function args(over: Partial<PullArgs> = {}): PullArgs {
  return {
    access: { accessToken: TOKEN },
    account: { externalId: "act_123456789", timezone: "America/Sao_Paulo", currency: "BRL" },
    stream: "campaign_daily",
    since: "2026-10-01",
    until: "2026-10-10",
    ...over,
  };
}

async function drain(iter: AsyncIterable<RawRecord>): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("splitWindow", () => {
  it("uma janela que cabe fica inteira", () => {
    expect(splitWindow("2026-10-01", "2026-10-10")).toEqual([{ since: "2026-10-01", until: "2026-10-10" }]);
  });

  it("fatia em janelas consecutivas de até 31 dias, sem lacuna nem sobreposição", () => {
    const w = splitWindow("2026-04-17", "2026-10-14"); // 181 dias
    expect(CHUNK_DAYS).toBe(31);
    expect(w[0]).toEqual({ since: "2026-04-17", until: "2026-05-17" });
    expect(w.at(-1)?.until).toBe("2026-10-14");
    for (let i = 1; i < w.length; i++) {
      const prev = new Date(`${w[i - 1]!.until}T00:00:00Z`).getTime();
      const cur = new Date(`${w[i]!.since}T00:00:00Z`).getTime();
      expect(cur - prev).toBe(86_400_000);
    }
    const days = w.reduce(
      (n, x) => n + (new Date(`${x.until}T00:00:00Z`).getTime() - new Date(`${x.since}T00:00:00Z`).getTime()) / 86_400_000 + 1,
      0,
    );
    expect(days).toBe(181);
  });

  it("um dia só", () => {
    expect(splitWindow("2026-10-05", "2026-10-05")).toEqual([{ since: "2026-10-05", until: "2026-10-05" }]);
  });
});

describe("insightsPath", () => {
  it("aceita só act_<números>", () => {
    expect(insightsPath("act_123456789")).toBe("/act_123456789/insights");
    for (const bad of ["123", "act_", "act_12a", "act_1/../me", "../act_1", "act_1?x=1", ""]) {
      expect(() => insightsPath(bad), bad).toThrow(/Conta do Meta Ads inválida/);
    }
  });
});

describe("pull", () => {
  it("pede Insights por campanha × dia, com período JSON, campos fixos e o limite de página", async () => {
    const fetchFn = stubFetch(jsonResponse(page([insightRow()])));
    await drain(pull(args()));

    const [url] = fetchFn.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/v25.0/act_123456789/insights");
    expect(url.searchParams.get("level")).toBe("campaign");
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({ since: "2026-10-01", until: "2026-10-10" });
    expect(url.searchParams.get("limit")).toBe(String(PAGE_LIMIT));
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    const fields = url.searchParams.get("fields")!.split(",");
    expect(fields).toEqual(expect.arrayContaining(["campaign_id", "date_start", "spend", "inline_link_clicks", "actions", "action_values"]));
    // grão fixo: nada de breakdowns, anúncios nem demografia
    expect(url.searchParams.has("breakdowns")).toBe(false);
    expect(fields).not.toContain("ad_id");
    expect(fields).not.toContain("adset_id");
  });

  it("um RawRecord por página, com o stream, o id e o hash do payload", async () => {
    stubFetch(jsonResponse(page([insightRow(), insightRow({ campaign_id: "120002" })])));
    const [rec, ...rest] = await drain(pull(args()));
    expect(rest).toEqual([]);
    expect(rec).toMatchObject({
      stream: "campaign_daily",
      externalId: "act_123456789:2026-10-01:2026-10-10:0",
      occurredOn: null,
    });
    expect(rec!.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pagina por cursor dentro da janela e percorre todas as janelas", async () => {
    const fetchFn = stubFetch(
      // janela 1: duas páginas
      jsonResponse(page([insightRow()], { after: "CUR1", next: true })),
      jsonResponse(page([insightRow({ date_start: "2026-10-02" })])),
      // janela 2 (uma página)
      jsonResponse(page([insightRow({ date_start: "2026-11-05" })])),
    );
    const out = await drain(pull(args({ since: "2026-10-01", until: "2026-11-10" })));

    expect(out.map((r) => r.externalId)).toEqual([
      "act_123456789:2026-10-01:2026-10-31:0",
      "act_123456789:2026-10-01:2026-10-31:1",
      "act_123456789:2026-11-01:2026-11-10:0",
    ]);
    const second = (fetchFn.mock.calls[1] as unknown as [URL])[0];
    expect(second.searchParams.get("after")).toBe("CUR1");
    expect(JSON.parse(second.searchParams.get("time_range")!)).toEqual({ since: "2026-10-01", until: "2026-10-31" });
    const third = (fetchFn.mock.calls[2] as unknown as [URL])[0];
    expect(third.searchParams.has("after")).toBe(false);
  });

  it("NENHUM token vai para o payload guardado em raw_records (a `paging.next` ecoa o access_token)", async () => {
    stubFetch(jsonResponse(page([insightRow()], { after: "CUR1", next: true })), jsonResponse(page([])));
    const out = await drain(pull(args()));
    for (const rec of out) {
      const text = JSON.stringify(rec);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("access_token");
      expect(text).not.toContain('"next"');
    }
    // os cursores (sem segredo) são preservados
    expect(JSON.stringify(out[0]!.payload)).toContain("CUR1");
  });

  it("sanitizePage tira next/previous e mantém dados e cursores", () => {
    const dirty = { data: [{ a: 1 }], paging: { cursors: { after: "X" }, next: "u?access_token=S", previous: "p?access_token=S" } };
    expect(sanitizePage(dirty)).toEqual({ data: [{ a: 1 }], paging: { cursors: { after: "X" } } });
    expect(sanitizePage({ data: [], paging: { next: "u" } })).toEqual({ data: [] });
    expect(sanitizePage(null)).toBeNull();
  });

  it("stream desconhecido e conta inválida falham antes de qualquer chamada", async () => {
    const fetchFn = stubFetch();
    await expect(drain(pull(args({ stream: "ad_daily" })))).rejects.toThrow(/Stream desconhecido/);
    await expect(drain(pull(args({ account: { externalId: "123", timezone: null, currency: null } })))).rejects.toThrow(
      /Conta do Meta Ads inválida/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("resposta fora do contrato falha alto; erro da API sobe sem o token", async () => {
    stubFetch(jsonResponse({ data: "não é lista" }));
    await expect(drain(pull(args()))).rejects.toThrow();

    stubFetch(graphError(190, "Session has expired"));
    const err = (await drain(pull(args())).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/reconecte a conta/);
    expect(err.message).not.toContain(TOKEN);
  });

  it("período vazio de dados (data: []) é uma página válida, não um erro", async () => {
    stubFetch(jsonResponse({ data: [] }));
    const out = await drain(pull(args()));
    expect(out).toHaveLength(1);
  });
});
