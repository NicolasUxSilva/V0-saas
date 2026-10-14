import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connector, TokenSet } from "@/server/connectors/types";

/**
 * Callback do OAuth (`/api/oauth/[provider]/callback`) contra um `db` e um conector FALSOS:
 * o que se prova aqui é a regra da rota — validar o state do workspace, exigir refresh token
 * só de quem o emite (Google, RD) e aceitar a conexão sem ele de quem não emite (Meta Ads),
 * cifrar os tokens antes de gravar, descobrir as contas e nunca vazar segredo no erro.
 */
const h = vi.hoisted(() => ({
  connector: null as unknown,
  inserted: [] as { table: unknown; values: Record<string, unknown>; set: Record<string, unknown> }[],
  updates: [] as Record<string, unknown>[],
  txOps: [] as unknown[],
  exchangeArgs: [] as { code: string; redirectUri: string }[],
}));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_SECRET: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
    AUTH_URL: "https://v0-saas-piloto.vercel.app",
    GA4_REDIRECT_URI: "https://v0-saas-piloto.vercel.app/api/oauth/ga4/callback",
    APP_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  },
}));

vi.mock("@/server/auth", () => ({
  requireWorkspace: async () => ({ workspaceId: "ws-1", userId: "u-1" }),
}));

vi.mock("@/server/connectors/registry", () => ({
  PROVIDERS: ["ga4", "google_ads", "meta_ads", "rd_station", "rd_station_marketing", "rd_station_crm"],
  getConnector: () => h.connector,
  isImplemented: (p: string) => p !== "rd_station",
}));

vi.mock("@/server/db", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => ({
          returning: async () => {
            h.inserted.push({ table, values, set: cfg.set });
            return [{ id: "conn-1", ...values }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          h.updates.push(values);
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        delete: () => ({
          where: async () => {
            h.txOps.push("delete");
          },
        }),
        insert: () => ({
          values: async (rows: unknown) => {
            h.txOps.push(["insert", rows]);
          },
        }),
      }),
  },
}));

const { GET } = await import("@/app/api/oauth/[provider]/callback/route");
const { signOAuthState } = await import("@/server/connectors/shared/oauth-state");
const { decryptSecret } = await import("@/server/crypto");

const SECRET_TOKEN = "EAAB-longo-secreto";

function fakeConnector(over: {
  refreshTokenRequired?: boolean;
  tokens?: Partial<TokenSet>;
  exchange?: () => Promise<TokenSet>;
  accounts?: { externalId: string; displayName: string; timezone: string | null; currency: string | null }[];
  listAccounts?: () => Promise<unknown>;
}): Connector {
  const tokens: TokenSet = {
    accessToken: SECRET_TOKEN,
    refreshToken: null,
    expiresAt: new Date("2026-12-13T12:00:00Z"),
    scopes: ["ads_read"],
    idToken: null,
    ...over.tokens,
  };
  return {
    meta: {
      provider: "meta_ads",
      name: "x",
      authType: "oauth2",
      scopes: [],
      docsUrl: "",
      restatementWindowDays: 1,
      rateLimit: { requestsPerSecond: 1, concurrency: 1 },
      ...(over.refreshTokenRequired === undefined ? {} : { refreshTokenRequired: over.refreshTokenRequired }),
    },
    streams: [],
    buildAuthUrl: () => "",
    exchangeCode: async (args: { code: string; redirectUri: string }) => {
      h.exchangeArgs.push(args);
      return over.exchange ? over.exchange() : tokens;
    },
    refreshTokens: async () => tokens,
    listAccounts: (async () =>
      over.listAccounts
        ? over.listAccounts()
        : (over.accounts ?? [
            { externalId: "act_1", displayName: "A", timezone: "America/Sao_Paulo", currency: "BRL" },
          ])) as Connector["listAccounts"],
    pull: (async function* () {}) as Connector["pull"],
    schemas: {},
    mapToCanonical: () => ({ target: "ad_performance", rows: [] }),
  };
}

function callback(provider: string, query: Record<string, string>) {
  const url = new URL(`https://v0-saas-piloto.vercel.app/api/oauth/${provider}/callback`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return GET(new Request(url), { params: Promise.resolve({ provider }) });
}

const valid = () => ({ code: "CODIGO", state: signOAuthState({ workspaceId: "ws-1" }) });
const where = (res: Response) => new URL(res.headers.get("location")!);

beforeEach(() => {
  h.inserted = [];
  h.updates = [];
  h.txOps = [];
  h.exchangeArgs = [];
  h.connector = fakeConnector({ refreshTokenRequired: false });
});

describe("Meta Ads: conecta SEM refresh token", () => {
  it("grava o token de longa duração cifrado, sem refresh token, e volta para Conexões", async () => {
    const res = await callback("meta_ads", valid());
    expect(res.status).toBe(303);
    const loc = where(res);
    expect(loc.pathname).toBe("/conexoes");
    expect(loc.searchParams.get("meta_ads_connected")).toBe("1");
    expect(loc.searchParams.get("properties")).toBe("1");

    expect(h.inserted).toHaveLength(1);
    const { values, set } = h.inserted[0]!;
    expect(values).toMatchObject({ workspaceId: "ws-1", provider: "meta_ads", status: "connected", createdBy: "u-1" });
    expect(values.refreshTokenEnc).toBeNull();
    expect(set.refreshTokenEnc).toBeNull(); // reconectar também limpa
    // o token vai CIFRADO (nunca em claro) e decifra de volta
    expect(Buffer.isBuffer(values.accessTokenEnc)).toBe(true);
    expect((values.accessTokenEnc as Buffer).toString("utf8")).not.toContain(SECRET_TOKEN);
    expect(decryptSecret(values.accessTokenEnc as Buffer)).toBe(SECRET_TOKEN);
    expect((values.tokenExpiresAt as Date).toISOString()).toBe("2026-12-13T12:00:00.000Z");
    expect(values.externalAccountEmail).toBeNull();
  });

  it("usa o redirect URI genérico do ambiente na troca do código", async () => {
    await callback("meta_ads", valid());
    expect(h.exchangeArgs).toEqual([
      { code: "CODIGO", redirectUri: "https://v0-saas-piloto.vercel.app/api/oauth/meta_ads/callback" },
    ]);
  });

  it("uma conta descoberta já vem selecionada; várias, nenhuma (o usuário escolhe)", async () => {
    await callback("meta_ads", valid());
    let rows = (h.txOps.find((o) => Array.isArray(o)) as [string, { isSelected: boolean }[]])[1];
    expect(rows.map((r) => r.isSelected)).toEqual([true]);

    h.txOps = [];
    h.connector = fakeConnector({
      refreshTokenRequired: false,
      accounts: [
        { externalId: "act_1", displayName: "A", timezone: null, currency: "BRL" },
        { externalId: "act_2", displayName: "B", timezone: null, currency: "USD" },
      ],
    });
    await callback("meta_ads", valid());
    rows = (h.txOps.find((o) => Array.isArray(o)) as [string, { isSelected: boolean }[]])[1];
    expect(rows.map((r) => r.isSelected)).toEqual([false, false]);
    expect(h.txOps[0]).toBe("delete"); // as contas antigas saem antes das novas
  });
});

describe("provedores que EXIGEM refresh token (Google, RD) — regra preservada", () => {
  it("sem refresh token: recusa com no_refresh_token e não grava nada", async () => {
    h.connector = fakeConnector({}); // `refreshTokenRequired` ausente = exige
    const res = await callback("google_ads", valid());
    expect(where(res).searchParams.get("google_ads_error")).toBe("no_refresh_token");
    expect(h.inserted).toEqual([]);
  });

  it("com refresh token: grava os dois, cifrados", async () => {
    h.connector = fakeConnector({ tokens: { refreshToken: "1//refresh-secreto", idToken: null } });
    const res = await callback("google_ads", valid());
    expect(where(res).searchParams.get("google_ads_connected")).toBe("1");
    const { values } = h.inserted[0]!;
    expect(decryptSecret(values.refreshTokenEnc as Buffer)).toBe("1//refresh-secreto");
    expect((values.refreshTokenEnc as Buffer).toString("utf8")).not.toContain("refresh-secreto");
  });

  it("o GA4 continua usando a env dedicada de redirect", async () => {
    h.connector = fakeConnector({ tokens: { refreshToken: "r" } });
    await callback("ga4", valid());
    expect(h.exchangeArgs[0]!.redirectUri).toBe("https://v0-saas-piloto.vercel.app/api/oauth/ga4/callback");
  });
});

describe("validações da rota (valem para qualquer provedor)", () => {
  it("erro devolvido pelo provedor (usuário recusou)", async () => {
    const res = await callback("meta_ads", { error: "access_denied" });
    expect(where(res).searchParams.get("meta_ads_error")).toBe("access_denied");
    expect(h.inserted).toEqual([]);
  });

  it("sem code ou sem state", async () => {
    expect(where(await callback("meta_ads", { code: "x" })).searchParams.get("meta_ads_error")).toBe("missing_params");
    expect(where(await callback("meta_ads", { state: "x" })).searchParams.get("meta_ads_error")).toBe("missing_params");
  });

  it("state forjado ou adulterado", async () => {
    const forged = where(await callback("meta_ads", { code: "x", state: "naoassinado.xyz" }));
    expect(forged.searchParams.get("meta_ads_error")).toBe("invalid_state");
    const [body, sig] = valid().state.split(".");
    const tampered = where(await callback("meta_ads", { code: "x", state: `${body}.${sig!.slice(0, -2)}AA` }));
    expect(tampered.searchParams.get("meta_ads_error")).toBe("invalid_state");
    expect(h.inserted).toEqual([]);
  });

  it("state assinado para OUTRO workspace não conecta nada neste", async () => {
    const other = signOAuthState({ workspaceId: "ws-outro" });
    const res = await callback("meta_ads", { code: "x", state: other });
    expect(where(res).searchParams.get("meta_ads_error")).toBe("workspace_mismatch");
    expect(h.inserted).toEqual([]);
    expect(h.exchangeArgs).toEqual([]); // nem chegou a trocar o código
  });

  it("falha na troca do código: token_exchange_failed, sem vazar o erro do provedor", async () => {
    h.connector = fakeConnector({
      refreshTokenRequired: false,
      exchange: async () => {
        throw new Error(`Meta: segredo ${SECRET_TOKEN} no erro`);
      },
    });
    const res = await callback("meta_ads", valid());
    const loc = where(res);
    expect(loc.searchParams.get("meta_ads_error")).toBe("token_exchange_failed");
    expect(loc.toString()).not.toContain(SECRET_TOKEN);
    expect(h.inserted).toEqual([]);
  });

  it("falha na descoberta de contas: a conexão fica em erro, com a causa no último erro (limitada), e o usuário volta com discovery_failed", async () => {
    h.connector = fakeConnector({
      refreshTokenRequired: false,
      listAccounts: async () => {
        throw new Error("Meta Graph API 400 em /me/adaccounts [code 200]".padEnd(3000, "x"));
      },
    });
    const res = await callback("meta_ads", valid());
    expect(where(res).searchParams.get("meta_ads_error")).toBe("discovery_failed");
    const update = h.updates.find((u) => u.status === "error")!;
    expect(String(update.lastError).startsWith("discovery: Meta Graph API 400")).toBe(true);
    expect(String(update.lastError).length).toBeLessThanOrEqual(1000);
    expect(String(update.lastError)).not.toContain(SECRET_TOKEN);
  });

  it("provedor desconhecido ou não implementado: 404", async () => {
    expect((await callback("tiktok_ads", valid())).status).toBe(404);
    expect((await callback("rd_station", valid())).status).toBe(404);
  });
});
