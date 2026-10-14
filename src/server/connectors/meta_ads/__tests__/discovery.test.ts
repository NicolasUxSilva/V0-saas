import { afterEach, describe, expect, it, vi } from "vitest";

import { TOKEN, graphError, jsonResponse } from "./fixtures";

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_URL: "http://localhost:3000",
    META_APP_ID: undefined,
    META_APP_SECRET: undefined,
    META_LOGIN_CONFIG_ID: undefined,
  },
}));

const { actAccountId, listAccounts } = await import("@/server/connectors/meta_ads/discovery");

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

describe("listAccounts", () => {
  it("lista as contas de anúncios com id act_, fuso e moeda; a conta ativa não leva sufixo", async () => {
    const fetchFn = stubFetch(
      jsonResponse({
        data: [
          { id: "act_222", account_id: "222", name: "Zeta Servidores", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 },
          { id: "act_111", account_id: "111", name: "Alfa", currency: "USD", timezone_name: "America/New_York", account_status: 101 },
        ],
      }),
    );
    const accounts = await listAccounts({ accessToken: TOKEN });

    const [url] = fetchFn.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/v25.0/me/adaccounts");
    expect(url.searchParams.get("fields")).toBe("id,account_id,name,currency,timezone_name,account_status");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("access_token")).toBe(TOKEN);

    // ordenadas pelo nome exibido
    expect(accounts).toEqual([
      { externalId: "act_111", displayName: "Alfa (encerrada)", timezone: "America/New_York", currency: "USD" },
      { externalId: "act_222", displayName: "Zeta Servidores", timezone: "America/Sao_Paulo", currency: "BRL" },
    ]);
  });

  it("id sem o prefixo act_ ganha o prefixo; nome ausente cai para o id; fuso/moeda ausentes são null", async () => {
    stubFetch(jsonResponse({ data: [{ id: "333", account_id: "333" }] }));
    expect(await listAccounts({ accessToken: TOKEN })).toEqual([
      { externalId: "act_333", displayName: "act_333", timezone: null, currency: null },
    ]);
    expect(actAccountId("act_9")).toBe("act_9");
    expect(actAccountId("9", "77")).toBe("act_77");
  });

  it("pagina pelo CURSOR (nunca pela URL `next`, que ecoa o token)", async () => {
    const fetchFn = stubFetch(
      jsonResponse({
        data: [{ id: "act_1", name: "A" }],
        paging: { cursors: { after: "CURSOR1" }, next: `https://graph.facebook.com/v25.0/me/adaccounts?access_token=${TOKEN}&after=CURSOR1` },
      }),
      jsonResponse({ data: [{ id: "act_2", name: "B" }], paging: { cursors: { after: "CURSOR2" } } }),
    );
    const accounts = await listAccounts({ accessToken: TOKEN });

    expect(accounts.map((a) => a.externalId)).toEqual(["act_1", "act_2"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const second = (fetchFn.mock.calls[1] as unknown as [URL])[0];
    expect(second.pathname).toBe("/v25.0/me/adaccounts");
    expect(second.searchParams.get("after")).toBe("CURSOR1");
  });

  it("sem contas: lista vazia (a tela explica)", async () => {
    stubFetch(jsonResponse({ data: [] }));
    expect(await listAccounts({ accessToken: TOKEN })).toEqual([]);
  });

  it("resposta fora do contrato falha alto; erro da API sobe sem o token", async () => {
    stubFetch(jsonResponse({ nada: true }));
    await expect(listAccounts({ accessToken: TOKEN })).rejects.toThrow();

    stubFetch(graphError(190, "Session has expired"));
    const err = (await listAccounts({ accessToken: TOKEN }).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/reconecte a conta/);
    expect(err.message).not.toContain(TOKEN);
  });
});
