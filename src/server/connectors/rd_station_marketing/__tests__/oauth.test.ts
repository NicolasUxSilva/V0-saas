import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/env.ts` valida `process.env` uma única vez no import e congela o objeto
 * `env`. Para alternar a presença das credenciais do RD Marketing por teste,
 * mockamos `@/env` com um getter ligado a um holder mutável — mesmo padrão do
 * conector Google Ads.
 */
const h = vi.hoisted(() => ({
  clientId: undefined as string | undefined,
  clientSecret: undefined as string | undefined,
}));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://user:pass@localhost:5432/test",
    AUTH_SECRET: "test-secret",
    AUTH_URL: "http://localhost:3000",
    GA4_REDIRECT_URI: "http://localhost:3000/api/oauth/ga4/callback",
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
    APP_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    USE_MOCK: false,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined,
    GOOGLE_ADS_DEVELOPER_TOKEN: undefined,
    RD_CRM_CLIENT_ID: undefined,
    RD_CRM_CLIENT_SECRET: undefined,
    get RD_MARKETING_CLIENT_ID() {
      return h.clientId;
    },
    get RD_MARKETING_CLIENT_SECRET() {
      return h.clientSecret;
    },
  },
}));

const {
  buildAuthUrl,
  exchangeCode,
  refreshTokens,
  revokeToken,
  RdMarketingCredentialsMissingError,
} = await import("@/server/connectors/rd_station_marketing/oauth");

beforeEach(() => {
  h.clientId = undefined;
  h.clientSecret = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RD Station Marketing oauth — credenciais ausentes", () => {
  it("buildAuthUrl lança RdMarketingCredentialsMissingError sem client_id/secret", () => {
    expect(() => buildAuthUrl({ state: "s", redirectUri: "http://x/cb" })).toThrow(
      RdMarketingCredentialsMissingError,
    );
  });

  it("exchangeCode lança RdMarketingCredentialsMissingError sem client_id/secret, sem fazer fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      exchangeCode({ code: "c", redirectUri: "http://x/cb" }),
    ).rejects.toBeInstanceOf(RdMarketingCredentialsMissingError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("RD Station Marketing oauth — buildAuthUrl", () => {
  it("monta a URL de autorização em api.rd.services/auth/dialog, SEM parâmetro scope", () => {
    h.clientId = "client-abc";
    h.clientSecret = "secret-abc";
    const url = new URL(
      buildAuthUrl({ state: "state-xyz", redirectUri: "http://localhost:3000/cb" }),
    );
    expect(url.origin).toBe("https://api.rd.services");
    expect(url.pathname).toBe("/auth/dialog");
    expect(url.searchParams.get("client_id")).toBe("client-abc");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/cb");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("RD Station Marketing oauth — exchangeCode", () => {
  it("faz POST em /auth/token?token_by=code com JSON {client_id, client_secret, code} (sem redirect_uri)", async () => {
    h.clientId = "client-abc";
    h.clientSecret = "secret-abc";
    let seenUrl = "";
    let seenInit: RequestInit = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenInit = init;
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            expires_in: 86_400,
            refresh_token: "refresh-1",
          }),
          { status: 200 },
        );
      }),
    );

    const tokens = await exchangeCode({ code: "the-code", redirectUri: "http://x/cb" });

    expect(seenUrl).toBe("https://api.rd.services/auth/token?token_by=code");
    const body = JSON.parse(String(seenInit.body)) as Record<string, unknown>;
    expect(body).toEqual({
      client_id: "client-abc",
      client_secret: "secret-abc",
      code: "the-code",
    });
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.scopes).toEqual([]);
    expect(tokens.idToken).toBeNull();
    // 86400s = 24h, dentro de uma margem de alguns segundos de execução do teste
    expect(tokens.expiresAt.getTime() - Date.now()).toBeGreaterThan(86_000_000);
  });

  it("resposta não-ok → erro claro, sem tokens inventados", async () => {
    h.clientId = "client-abc";
    h.clientSecret = "secret-abc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"errors":[{"error_type":"UNAUTHORIZED"}]}', { status: 401 })),
    );
    await expect(exchangeCode({ code: "c", redirectUri: "http://x/cb" })).rejects.toThrow(
      /401/,
    );
  });
});

describe("RD Station Marketing oauth — refreshTokens", () => {
  it("faz POST em /auth/token (sem query) e repassa o refresh_token ROTACIONADO que a API devolver", async () => {
    h.clientId = "client-abc";
    h.clientSecret = "secret-abc";
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            access_token: "access-2",
            expires_in: 86_400,
            refresh_token: "refresh-2-NOVO",
          }),
          { status: 200 },
        );
      }),
    );

    const tokens = await refreshTokens({ refreshToken: "refresh-1-antigo" });

    expect(seenUrl).toBe("https://api.rd.services/auth/token");
    expect(seenBody).toEqual({
      client_id: "client-abc",
      client_secret: "secret-abc",
      refresh_token: "refresh-1-antigo",
    });
    // a rotação em si (persistir o novo) é testada no genérico shared/token.ts —
    // aqui só confirmamos que o conector REPASSA o que a API devolveu.
    expect(tokens.refreshToken).toBe("refresh-2-NOVO");
  });
});

describe("RD Station Marketing oauth — revokeToken", () => {
  it("é best-effort: nunca lança, mesmo se o fetch falhar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(revokeToken("tok", "refresh_token")).resolves.toBeUndefined();
  });

  it("faz POST form-urlencoded em /auth/revoke com token e token_type_hint", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenInit = init;
        return new Response("{}", { status: 200 });
      }),
    );
    await revokeToken("tok-abc", "refresh_token");
    expect(seenUrl).toBe("https://api.rd.services/auth/revoke");
    expect(String(seenInit.headers && (seenInit.headers as Record<string, string>)["content-type"])).toContain(
      "application/x-www-form-urlencoded",
    );
    expect(String(seenInit.body)).toBe("token=tok-abc&token_type_hint=refresh_token");
  });
});
