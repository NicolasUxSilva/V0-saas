import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cliente HTTP da Graph API: montagem da URL, mapeamento de erro (sem vazar o token),
 * retry em limite de taxa e credenciais do app. `@/env` é mockado com getters ligados a
 * um holder mutável (o `env` real congela no import).
 */
const h = vi.hoisted(() => ({
  appId: undefined as string | undefined,
  appSecret: undefined as string | undefined,
}));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_URL: "http://localhost:3000",
    get META_APP_ID() {
      return h.appId;
    },
    get META_APP_SECRET() {
      return h.appSecret;
    },
    META_LOGIN_CONFIG_ID: undefined,
  },
}));

const {
  GRAPH_BASE,
  META_GRAPH_VERSION,
  MetaApiError,
  MetaCredentialsMissingError,
  metaFetch,
  requireMetaApp,
} = await import("@/server/connectors/meta_ads/http");

import { TOKEN, graphError, jsonResponse } from "./fixtures";

beforeEach(() => {
  h.appId = undefined;
  h.appSecret = undefined;
});
afterEach(() => {
  vi.useRealTimers();
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

describe("metaFetch — requisição", () => {
  it("monta a URL da versão vigente, com os parâmetros e o token na query", async () => {
    const fetchFn = stubFetch(jsonResponse({ data: [] }));
    await metaFetch("/me/adaccounts", { accessToken: TOKEN, params: { fields: "id,name", limit: "100" } });

    expect(META_GRAPH_VERSION).toBe("v25.0");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(`${GRAPH_BASE}/me/adaccounts`);
    expect(url.searchParams.get("fields")).toBe("id,name");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
  });

  it("sem token, nenhum access_token vai na URL", async () => {
    const fetchFn = stubFetch(jsonResponse({}));
    await metaFetch("/oauth/access_token", { params: { code: "c" } });
    const [url] = fetchFn.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.has("access_token")).toBe(false);
  });

  it("resposta 200 que não é JSON é erro explícito", async () => {
    stubFetch(new Response("<html>oops</html>", { status: 200 }));
    await expect(metaFetch("/x")).rejects.toThrow(/resposta que não é JSON/);
  });
});

describe("metaFetch — erros", () => {
  it("código 190: token inválido; o erro diz para reconectar e NÃO contém o token", async () => {
    stubFetch(graphError(190, "Error validating access token: Session has expired", { subcode: 463 }));
    const err = await metaFetch("/me/adaccounts", { accessToken: TOKEN }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MetaApiError);
    const e = err as InstanceType<typeof MetaApiError>;
    expect(e.isAuthError).toBe(true);
    expect([e.status, e.code, e.subcode, e.fbtraceId]).toEqual([400, 190, 463, "FBTRACE123"]);
    expect(e.message).toMatch(/reconecte a conta/);
    expect(e.message).toContain("[code 190/463]");
    expect(e.message).toContain("FBTRACE123");
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain("access_token=");
  });

  it("falta de permissão e excesso de dados têm dica própria", async () => {
    stubFetch(graphError(200, "Requires ads_read permission"));
    await expect(metaFetch("/act_1/insights", { accessToken: TOKEN })).rejects.toThrow(/permissão ads_read ausente/);
    stubFetch(graphError(100, "Please reduce the amount of data", { subcode: 1487534 }));
    await expect(metaFetch("/act_1/insights", { accessToken: TOKEN })).rejects.toThrow(/reduza o período por chamada/);
  });

  it("erro comum (400/100) NÃO é repetido", async () => {
    const fetchFn = stubFetch(graphError(100, "Invalid parameter"));
    await expect(metaFetch("/x")).rejects.toBeInstanceOf(MetaApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("corpo de erro que não é JSON vira mensagem curta com o status", async () => {
    stubFetch(new Response("Bad Gateway".repeat(200), { status: 400 }));
    const e = (await metaFetch("/x").catch((x: unknown) => x)) as Error;
    expect(e.message).toMatch(/^Meta Graph API 400 em \/x/);
    expect(e.message.length).toBeLessThan(500);
  });
});

describe("metaFetch — retry", () => {
  it("limite de taxa (código 17) é repetido com backoff e depois dá certo", async () => {
    vi.useFakeTimers();
    const fetchFn = stubFetch(
      graphError(17, "User request limit reached"),
      graphError(4, "Application request limit reached"),
      jsonResponse({ ok: true }),
    );
    const pending = metaFetch("/x");
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("5xx é repetido; ao esgotar as tentativas o erro sobe", async () => {
    vi.useFakeTimers();
    const fetchFn = stubFetch(
      new Response("e", { status: 503 }),
      new Response("e", { status: 503 }),
      new Response("e", { status: 503 }),
      new Response("e", { status: 503 }),
    );
    const pending = metaFetch("/x").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBeInstanceOf(MetaApiError);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("os códigos de limite de taxa dos casos de uso de negócio (80000–80014) também são repetidos", async () => {
    vi.useFakeTimers();
    const fetchFn = stubFetch(graphError(80004, "too many calls"), jsonResponse({ ok: 1 }));
    const pending = metaFetch("/x");
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("credenciais do app", () => {
  it("sem META_APP_ID/META_APP_SECRET: erro claro e sem nenhum valor", () => {
    expect(() => requireMetaApp()).toThrow(MetaCredentialsMissingError);
    h.appId = "123";
    expect(() => requireMetaApp()).toThrow(/META_APP_ID \/ META_APP_SECRET não configurados/);
  });

  it("com as duas, devolve-as", () => {
    h.appId = "123";
    h.appSecret = "segredo";
    expect(requireMetaApp()).toEqual({ appId: "123", appSecret: "segredo" });
  });
});
