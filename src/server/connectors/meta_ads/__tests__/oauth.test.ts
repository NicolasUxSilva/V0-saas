import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOKEN, graphError, jsonResponse } from "./fixtures";

/**
 * OAuth do Meta Ads: URL do diálogo (scope × config_id), troca do código por token de
 * LONGA duração (duas chamadas + debug_token), permissão ads_read obrigatória, nenhum
 * segredo em mensagem de erro e nenhuma renovação inventada.
 */
const h = vi.hoisted(() => ({
  appId: undefined as string | undefined,
  appSecret: undefined as string | undefined,
  configId: undefined as string | undefined,
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
    get META_LOGIN_CONFIG_ID() {
      return h.configId;
    },
  },
}));

const { META_ADS_SCOPES, buildAuthUrl, exchangeCode, refreshTokens, revokeToken } = await import(
  "@/server/connectors/meta_ads/oauth"
);
const { MetaCredentialsMissingError } = await import("@/server/connectors/meta_ads/http");

const REDIRECT = "https://v0-saas-piloto.vercel.app/api/oauth/meta_ads/callback";
const SECRET = "app-secret-de-teste";
const SHORT = "EAAB-token-curto";

beforeEach(() => {
  h.appId = "1234567890";
  h.appSecret = SECRET;
  h.configId = undefined;
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T12:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
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

const urlOf = (fn: ReturnType<typeof stubFetch>, call: number) => (fn.mock.calls[call] as unknown as [URL])[0];

describe("buildAuthUrl", () => {
  it("Facebook Login clássico: scope=ads_read, response_type=code, state e redirect_uri intactos", () => {
    const url = new URL(buildAuthUrl({ state: "ESTADO", redirectUri: REDIRECT }));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("ESTADO");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("ads_read");
    expect(url.searchParams.has("config_id")).toBe(false);
    expect(META_ADS_SCOPES).toEqual(["ads_read"]);
  });

  it("Facebook Login for Business: config_id no lugar de scope", () => {
    h.configId = "9988776655";
    const url = new URL(buildAuthUrl({ state: "E", redirectUri: REDIRECT }));
    expect(url.searchParams.get("config_id")).toBe("9988776655");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("o segredo do app NUNCA entra na URL do navegador", () => {
    expect(buildAuthUrl({ state: "E", redirectUri: REDIRECT })).not.toContain(SECRET);
  });

  it("sem credenciais do app: erro claro, sem URL", () => {
    h.appId = undefined;
    expect(() => buildAuthUrl({ state: "E", redirectUri: REDIRECT })).toThrow(MetaCredentialsMissingError);
  });
});

describe("exchangeCode", () => {
  it("troca o código por um token CURTO e esse por um de LONGA duração; sem refresh token", async () => {
    const fetchFn = stubFetch(
      jsonResponse({ access_token: SHORT, token_type: "bearer", expires_in: 3600 }),
      jsonResponse({ access_token: TOKEN, token_type: "bearer", expires_in: 5_184_000 }),
      jsonResponse({ data: { is_valid: true, scopes: ["ads_read", "public_profile"], expires_at: 1_792_000_000 } }),
    );
    const tokens = await exchangeCode({ code: "CODIGO", redirectUri: REDIRECT });

    // 1ª chamada: código → token curto
    const first = urlOf(fetchFn, 0);
    expect(first.pathname).toBe("/v25.0/oauth/access_token");
    expect(first.searchParams.get("code")).toBe("CODIGO");
    expect(first.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(first.searchParams.get("client_id")).toBe("1234567890");
    expect(first.searchParams.get("client_secret")).toBe(SECRET);
    // 2ª: troca pelo de longa duração com o token curto
    const second = urlOf(fetchFn, 1);
    expect(second.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(second.searchParams.get("fb_exchange_token")).toBe(SHORT);
    // 3ª: debug_token do token LONGO, autenticado pelo app
    const third = urlOf(fetchFn, 2);
    expect(third.pathname).toBe("/v25.0/debug_token");
    expect(third.searchParams.get("input_token")).toBe(TOKEN);
    expect(third.searchParams.get("access_token")).toBe(`1234567890|${SECRET}`);

    expect(tokens.accessToken).toBe(TOKEN);
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.idToken).toBeNull();
    expect(tokens.scopes).toEqual(["ads_read", "public_profile"]);
    // o `expires_at` do debug_token (unix) prevalece sobre o `expires_in`
    expect(tokens.expiresAt.toISOString()).toBe(new Date(1_792_000_000 * 1000).toISOString());
  });

  it("sem debug_token utilizável, usa o expires_in da troca e as permissões pedidas", async () => {
    stubFetch(
      jsonResponse({ access_token: SHORT, expires_in: 3600 }),
      jsonResponse({ access_token: TOKEN, expires_in: 5_184_000 }),
      graphError(1, "erro qualquer do debug_token", { status: 400 }),
    );
    const tokens = await exchangeCode({ code: "C", redirectUri: REDIRECT });
    expect(tokens.expiresAt.getTime()).toBe(Date.parse("2026-10-14T12:00:00Z") + 5_184_000 * 1000);
    expect(tokens.scopes).toEqual(["ads_read"]);
  });

  it("sem expires_in em lugar nenhum: assume os ~60 dias documentados", async () => {
    stubFetch(
      jsonResponse({ access_token: SHORT }),
      jsonResponse({ access_token: TOKEN }),
      jsonResponse({ data: {} }),
    );
    const tokens = await exchangeCode({ code: "C", redirectUri: REDIRECT });
    expect(tokens.expiresAt.getTime()).toBe(Date.parse("2026-10-14T12:00:00Z") + 60 * 24 * 3600 * 1000);
  });

  it("permissão ads_read NÃO concedida: recusa a conexão (o usuário desmarcou no diálogo)", async () => {
    stubFetch(
      jsonResponse({ access_token: SHORT, expires_in: 3600 }),
      jsonResponse({ access_token: TOKEN, expires_in: 5_184_000 }),
      jsonResponse({ data: { is_valid: true, scopes: ["public_profile"] } }),
    );
    await expect(exchangeCode({ code: "C", redirectUri: REDIRECT })).rejects.toThrow(/ads_read não foi concedida/);
  });

  it("token inválido no debug_token: recusa", async () => {
    stubFetch(
      jsonResponse({ access_token: SHORT }),
      jsonResponse({ access_token: TOKEN }),
      jsonResponse({ data: { is_valid: false } }),
    );
    await expect(exchangeCode({ code: "C", redirectUri: REDIRECT })).rejects.toThrow(/token recebido não é válido/);
  });

  it("falha na troca do código: o erro não vaza o segredo do app nem os tokens", async () => {
    stubFetch(graphError(100, "Error validating verification code. Please make sure your redirect_uri is identical"));
    const err = (await exchangeCode({ code: "C", redirectUri: REDIRECT }).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/redirect_uri is identical/);
    for (const secret of [SECRET, TOKEN, SHORT]) expect(err.message).not.toContain(secret);
  });

  it("resposta sem access_token é erro explícito", async () => {
    stubFetch(jsonResponse({ token_type: "bearer" }));
    await expect(exchangeCode({ code: "C", redirectUri: REDIRECT })).rejects.toThrow(/não trouxe access_token/);
  });

  it("sem credenciais do app: erro claro ANTES de qualquer chamada de rede", async () => {
    h.appSecret = undefined;
    const fetchFn = stubFetch();
    await expect(exchangeCode({ code: "C", redirectUri: REDIRECT })).rejects.toBeInstanceOf(MetaCredentialsMissingError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("renovação e revogação", () => {
  it("a Meta não tem refresh token: renovar falha ALTO, nunca finge", async () => {
    await expect(refreshTokens()).rejects.toThrow(/não usa refresh token/);
  });

  it("revokeToken chama DELETE /me/permissions e engole falhas (best-effort)", async () => {
    const ok = stubFetch(jsonResponse({ success: true }));
    await revokeToken(TOKEN);
    const [url, init] = ok.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/v25.0/me/permissions");
    expect(init.method).toBe("DELETE");
    expect(url.searchParams.get("access_token")).toBe(TOKEN);

    stubFetch(graphError(190, "token inválido"));
    await expect(revokeToken(TOKEN)).resolves.toBeUndefined();
  });
});
