import { afterEach, describe, expect, it, vi } from "vitest";

import type { PullArgs } from "@/server/connectors/types";

import { pull } from "@/server/connectors/rd_station_crm/extract";

import {
  fakeDeal,
  fakeDealsPage,
  internalPageLink,
  publicPageLink,
} from "./fixtures";

function args(overrides: Partial<PullArgs> = {}): PullArgs {
  return {
    access: { accessToken: "access-token-abc" },
    account: { externalId: "account", timezone: null, currency: null },
    stream: "deals",
    since: "2026-08-01",
    until: "2026-08-28",
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

describe("rd_station_crm pull — stream desconhecido", () => {
  it("lança erro explícito, sem fazer nenhuma requisição HTTP", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(drain(pull(args({ stream: "outro" })))).rejects.toThrow(
      /Stream desconhecido/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("rd_station_crm pull — filtro RDQL por updated_at (since/until)", () => {
  it("a 1ª chamada usa since/until como limites de updated_at, não como data de um fato", async () => {
    let seenUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenUrl = url;
        return new Response(JSON.stringify(fakeDealsPage([fakeDeal()])), { status: 200 });
      }),
    );

    await drain(pull(args({ since: "2026-08-01", until: "2026-08-28" })));

    const url = new URL(seenUrl, "https://api.rd.services/crm/v2");
    const filter = url.searchParams.get("filter")!;
    expect(filter).toContain('updated_at:>="2026-08-01 00:00:00"');
    expect(filter).toContain('updated_at:<="2026-08-28 23:59:59"');
  });

  it("a URL base é https://api.rd.services/crm/v2/deals — e nunca /api/v2/deals", async () => {
    let seenUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenUrl = url;
        return new Response(JSON.stringify(fakeDealsPage([])), { status: 200 });
      }),
    );
    await drain(pull(args()));
    expect(seenUrl.startsWith("https://api.rd.services/crm/v2/deals?")).toBe(true);
    expect(seenUrl).not.toContain("/api/v2/");
  });

  it("a 1ª chamada pede ordenação explícita sort[updated_at]=asc — sem ela a paginação da API real não é determinística", async () => {
    // Verificado na API real (2026-10-04): a MESMA página 1 pedida 2× seguidas, sem
    // sort, voltou com listas diferentes. Com sort[updated_at]=asc, duas passadas de
    // 4 páginas devolveram listas idênticas, em ordem crescente, sem IDs repetidos.
    let seenUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenUrl = url;
        return new Response(JSON.stringify(fakeDealsPage([])), { status: 200 });
      }),
    );
    await drain(pull(args()));
    const url = new URL(seenUrl);
    expect(url.searchParams.get("sort[updated_at]")).toBe("asc");
    // o filtro continua lá, intacto, ao lado do sort
    expect(url.searchParams.get("filter")).toContain('updated_at:>="2026-08-01 00:00:00"');
  });
});

describe("rd_station_crm pull — paginação via links.next", () => {
  it("links.next no formato REAL da API (prefixo interno /api/v2/) é chamado em /crm/v2/ — o bug da 1ª importação real", async () => {
    const page1 = fakeDealsPage([fakeDeal({ id: "deal-1" })], internalPageLink(2));
    const page2 = fakeDealsPage([fakeDeal({ id: "deal-2" })], internalPageLink(3));
    const page3 = fakeDealsPage([fakeDeal({ id: "deal-3" })]); // sem next

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const payload = calls.length === 1 ? page1 : calls.length === 2 ? page2 : page3;
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );

    const records = (await drain(pull(args()))) as Array<{ externalId: string }>;

    expect(records).toHaveLength(3);
    expect(calls).toHaveLength(3);
    // 2ª e 3ª chamadas: mesma query que a API devolveu (filtro + sort + page[number]/
    // page[size], byte a byte), mas na raiz PÚBLICA /crm/v2/.
    expect(calls[1]).toBe(publicPageLink(2));
    expect(calls[2]).toBe(publicPageLink(3));
    // a reancoragem não pode perder o sort ao longo das páginas
    for (const url of calls.slice(1)) {
      expect(new URL(url).searchParams.get("sort[updated_at]")).toBe("asc");
    }
    // invariante central: NENHUMA requisição, de nenhuma página, usa /api/v2/
    for (const url of calls) {
      expect(url).not.toContain("/api/v2/");
      expect(url.startsWith("https://api.rd.services/crm/v2/deals")).toBe(true);
    }
    expect(new Set(records.map((r) => r.externalId)).size).toBe(3);
  });

  it("links.next que já está em /crm/v2/ é chamado como veio (reancoragem é idempotente)", async () => {
    const page1 = fakeDealsPage([fakeDeal({ id: "deal-1" })], publicPageLink(2));
    const page2 = fakeDealsPage([fakeDeal({ id: "deal-2" })]);

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(calls.length === 1 ? page1 : page2), {
          status: 200,
        });
      }),
    );

    await drain(pull(args()));

    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(publicPageLink(2));
  });

  it("resposta única sem links.next → 1 RawRecord, 1 requisição", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fakeDealsPage([fakeDeal()])), { status: 200 })),
    );
    const records = await drain(pull(args()));
    expect(records).toHaveLength(1);
  });

  it("links.next apontando para OUTRO host → erro, e o token NÃO é enviado para lá", async () => {
    const page1 = fakeDealsPage(
      [fakeDeal()],
      "https://evil.example.com/crm/v2/deals?page%5Bnumber%5D=2",
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(page1), { status: 200 });
      }),
    );

    await expect(drain(pull(args()))).rejects.toThrow(/outro destino/);
    // só a 1ª página (nossa URL, no host do RD) foi chamada — nada saiu para evil.example.com
    expect(calls).toHaveLength(1);
    expect(calls.some((u) => u.includes("evil.example.com"))).toBe(false);
  });

  it("links.next com caminho inesperado → erro (fail-closed), sem chamar", async () => {
    const page1 = fakeDealsPage(
      [fakeDeal()],
      "https://api.rd.services/platform/contacts?page%5Bnumber%5D=2",
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(page1), { status: 200 });
      }),
    );

    await expect(drain(pull(args()))).rejects.toThrow(/caminho inesperado/);
    expect(calls).toHaveLength(1);
  });

  it("404 numa página seguinte reporta a URL REALMENTE chamada (/crm/v2/), não o link cru /api/v2/", async () => {
    const page1 = fakeDealsPage([fakeDeal()], internalPageLink(2));
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        if (n === 1) return new Response(JSON.stringify(page1), { status: 200 });
        return new Response('{"message":"no Route matched with those values"}', {
          status: 404,
        });
      }),
    );

    const err = await drain(pull(args())).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("404");
    expect(message).toContain("https://api.rd.services/crm/v2/deals");
    expect(message).not.toContain("/api/v2/");
  });
});
