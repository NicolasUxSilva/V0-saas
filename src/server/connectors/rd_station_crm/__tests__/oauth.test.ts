import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesmo padrão do conector Google Ads / RD Station Marketing: `@/env` é
 * mockado com um getter ligado a um holder mutável para alternar a presença
 * das credenciais do RD CRM por teste.
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
    RD_MARKETING_CLIENT_ID: undefined,
    RD_MARKETING_CLIENT_SECRET: undefined,
    get RD_CRM_CLIENT_ID() {
      return h.clientId;
    },
    get RD_CRM_CLIENT_SECRET() {
      return h.clientSecret;
    },
  },
}));

const { buildAuthUrl, exchangeCode, refreshTokens, revokeToken, RdCrmCredentialsMissingError } =
  await import("@/server/connectors/rd_station_crm/oauth");

beforeEach(() => {
  h.clientId = undefined;
  h.clientSecret = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RD Station CRM oauth — credenciais ausentes", () => {
  it("buildAuthUrl lança RdCrmCredentialsMissingError sem client_id/secret", () => {
    expect(() => buildAuthUrl({ state: "s", redirectUri: "http://x/cb" })).toThrow(
      RdCrmCredentialsMissingError,
    );
  });

  it("exchangeCode lança RdCrmCredentialsMissingError sem client_id/secret, sem fazer fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      exchangeCode({ code: "c", redirectUri: "http://x/cb" }),
    ).rejects.toBeInstanceOf(RdCrmCredentialsMissingError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("RD Station CRM oauth — buildAuthUrl", () => {
  it("monta a URL em accounts.rdstation.com/oauth/authorize (host DIFERENTE do Marketing), SEM scope", () => {
    h.clientId = "client-abc";
    h.clientSecret = "secret-abc";
    const url = new URL(
      buildAuthUrl({ state: "state-xyz", redirectUri: "http://localhost:3000/cb" }),
    );
    expect(url.origin).toBe("https://accounts.rdstation.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-abc");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/cb");
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("RD Station CRM oauth — exchangeCode", () => {
  it("faz POST form-urlencoded em api.rd.services/oauth2/token com redirect_uri OBRIGATÓRIO e grant_type=authorization_code", async () => {
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
            expires_in: 7200,
            refresh_token: "refresh-1",
          }),
          { status: 200 },
        );
      }),
    );

    const tokens = await exchangeCode({ code: "the-code", redirectUri: "http://x/cb" });

    expect(seenUrl).toBe("https://api.rd.services/oauth2/token");
    expect(String((seenInit.headers as Record<string, string>)["content-type"])).toContain(
      "application/x-www-form-urlencoded",
    );
    const params = new URLSearchParams(String(seenInit.body));
    expect(params.get("client_id")).toBe("client-abc");
    expect(params.get("client_secret")).toBe("secret-abc");
    expect(params.get("code")).toBe("the-code");
    expect(params.get("redirect_uri")).toBe("http://x/cb");
    expect(params.get("grant_type")).toBe("authorization_code");

    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    // 7200s = 2h — bem diferente das 24h do Marketing
    expect(tokens.expiresAt.getTime() - Date.now()).toBeLessThan(7_300_000);
    expect(tokens.expiresAt.getTime() - Date.now()).toBeGreaterThan(7_000_000);
  });

  it("resposta não-ok → erro claro, sem tokens inventados", async () => {
    h.clientId = "client-abc";
    h.clientSecret = "secret-abc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"errors":[{"status":"401"}]}', { status: 401 })),
    );
    await expect(exchangeCode({ code: "c", redirectUri: "http://x/cb" })).rejects.toThrow(
      /401/,
    );
  });
});

describe("RD Station CRM oauth — refreshTokens (refresh_token ROTATIVO)", () => {
  it("faz POST com grant_type=refresh_token e repassa o refresh_token NOVO que a API devolver", async () => {
    h.clientId = "client-abc";
    h.clientSecret = "secret-abc";
    let seenBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seenBody = String(init.body);
        return new Response(
          JSON.stringify({
            access_token: "access-2",
            expires_in: 7200,
            refresh_token: "refresh-2-ROTACIONADO",
          }),
          { status: 200 },
        );
      }),
    );

    const tokens = await refreshTokens({ refreshToken: "refresh-1-antigo" });

    const params = new URLSearchParams(seenBody);
    expect(params.get("refresh_token")).toBe("refresh-1-antigo");
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.has("redirect_uri")).toBe(false); // não é parte do refresh grant
    // o conector REPASSA o novo token (quem persiste é o shared/token.ts genérico)
    expect(tokens.refreshToken).toBe("refresh-2-ROTACIONADO");
  });
});

describe("RD Station CRM oauth — revokeToken", () => {
  it("é um no-op proposital (sem endpoint de revogação documentado) — nunca lança, nunca chama fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(revokeToken("tok")).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
