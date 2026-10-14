import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rota de início do OAuth (`/api/oauth/[provider]/start`) com o Meta Ads: redireciona
 * para o diálogo da Meta com `state` assinado e o redirect URI do ambiente; sem as
 * credenciais do app volta para Conexões com um erro legível (em vez de uma página 500).
 */
const h = vi.hoisted(() => ({
  appId: undefined as string | undefined,
  appSecret: undefined as string | undefined,
}));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://user:pass@localhost:5432/test",
    AUTH_SECRET: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
    AUTH_URL: "https://v0-saas-piloto.vercel.app",
    GA4_REDIRECT_URI: "https://v0-saas-piloto.vercel.app/api/oauth/ga4/callback",
    GOOGLE_OAUTH_CLIENT_ID: "cid",
    GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
    APP_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    USE_MOCK: false,
    get META_APP_ID() {
      return h.appId;
    },
    get META_APP_SECRET() {
      return h.appSecret;
    },
    META_LOGIN_CONFIG_ID: undefined,
    RD_MARKETING_CLIENT_ID: undefined,
    RD_MARKETING_CLIENT_SECRET: undefined,
    RD_CRM_CLIENT_ID: undefined,
    RD_CRM_CLIENT_SECRET: undefined,
  },
}));

vi.mock("@/server/auth", () => ({
  requireWorkspace: async () => ({ workspaceId: "ws-1", userId: "u-1" }),
}));

const { GET } = await import("@/app/api/oauth/[provider]/start/route");
const { verifyOAuthState } = await import("@/server/connectors/shared/oauth-state");

const start = (provider: string) =>
  GET(new Request(`https://v0-saas-piloto.vercel.app/api/oauth/${provider}/start`), {
    params: Promise.resolve({ provider }),
  });

beforeEach(() => {
  h.appId = "1234567890";
  h.appSecret = "segredo-do-app";
});

describe("/api/oauth/meta_ads/start", () => {
  it("redireciona para o diálogo da Meta com o redirect URI do ambiente e um state assinado do workspace", async () => {
    const res = await start("meta_ads");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://v0-saas-piloto.vercel.app/api/oauth/meta_ads/callback",
    );
    expect(location.searchParams.get("scope")).toBe("ads_read");
    // o state é o assinado de sempre: carrega o workspace da sessão
    expect(verifyOAuthState(location.searchParams.get("state")!)).toEqual({ workspaceId: "ws-1" });
    // o segredo do app nunca vai ao navegador
    expect(location.toString()).not.toContain("segredo-do-app");
  });

  it("sem META_APP_ID/META_APP_SECRET: volta para Conexões com `meta_ads_error=not_configured`", async () => {
    h.appId = undefined;
    const res = await start("meta_ads");
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://v0-saas-piloto.vercel.app/conexoes");
    expect(location.searchParams.get("meta_ads_error")).toBe("not_configured");
  });

  it("os outros provedores com credencial opcional ganham o mesmo tratamento", async () => {
    const res = await start("rd_station_marketing");
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).searchParams.get("rd_station_marketing_error")).toBe(
      "not_configured",
    );
  });

  it("provedor desconhecido ou não implementado responde 404", async () => {
    expect((await start("tiktok_ads")).status).toBe(404);
    expect((await start("rd_station")).status).toBe(404);
  });
});
