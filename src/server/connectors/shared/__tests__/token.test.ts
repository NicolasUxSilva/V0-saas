import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gerência de access token: a decisão (usar / renovar / reautorizar / reconectar) é PURA
 * e a função com banco é exercitada contra um `db` falso. O ponto novo é o Meta Ads, que
 * não emite refresh token: token vencido pede REAUTORIZAÇÃO, nunca "renova" nem finge.
 */
const state = vi.hoisted(() => ({
  conn: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (state.conn ? [state.conn] : []) }) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
  },
}));

const { REFRESH_SKEW_MS, decideTokenAction, getValidAccessToken } = await import(
  "@/server/connectors/shared/token"
);
const { encryptSecret } = await import("@/server/crypto");
const { getConnector, isImplemented } = await import("@/server/connectors/registry");

const NOW = Date.parse("2026-10-14T12:00:00Z");

beforeEach(() => {
  state.conn = null;
  state.updates = [];
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

describe("decideTokenAction (pura)", () => {
  const base = { hasAccessToken: true, hasRefreshToken: true, refreshTokenRequired: true, msToExpiry: 3_600_000 };

  it("provedor com refresh token: usa enquanto vale, renova quando vence", () => {
    expect(decideTokenAction(base)).toBe("use");
    expect(decideTokenAction({ ...base, msToExpiry: REFRESH_SKEW_MS + 1 })).toBe("use");
    expect(decideTokenAction({ ...base, msToExpiry: REFRESH_SKEW_MS })).toBe("refresh");
    expect(decideTokenAction({ ...base, msToExpiry: -5 })).toBe("refresh");
  });

  it("provedor com refresh token exige OS DOIS tokens (comportamento de sempre)", () => {
    expect(decideTokenAction({ ...base, hasRefreshToken: false })).toBe("missing");
    expect(decideTokenAction({ ...base, hasAccessToken: false })).toBe("missing");
    // mesmo com o access token ainda válido, sem refresh token a conexão está quebrada
    expect(decideTokenAction({ ...base, hasRefreshToken: false, msToExpiry: 9e9 })).toBe("missing");
  });

  it("provedor SEM refresh token (Meta): usa enquanto vale; vencido pede reautorização", () => {
    const meta = { ...base, hasRefreshToken: false, refreshTokenRequired: false };
    expect(decideTokenAction(meta)).toBe("use");
    expect(decideTokenAction({ ...meta, msToExpiry: REFRESH_SKEW_MS })).toBe("reauth");
    expect(decideTokenAction({ ...meta, msToExpiry: -1 })).toBe("reauth");
    expect(decideTokenAction({ ...meta, hasAccessToken: false })).toBe("missing");
  });

  it("se um provedor sem refresh token tiver um (não deveria), renova em vez de reautorizar", () => {
    expect(
      decideTokenAction({ ...base, refreshTokenRequired: false, hasRefreshToken: true, msToExpiry: -1 }),
    ).toBe("refresh");
  });
});

describe("quem exige refresh token", () => {
  it("só o Meta Ads declara que não emite; os demais seguem o padrão", () => {
    expect(isImplemented("meta_ads")).toBe(true);
    expect(getConnector("meta_ads").meta.refreshTokenRequired).toBe(false);
    for (const p of ["ga4", "google_ads", "rd_station_marketing", "rd_station_crm"] as const) {
      expect(getConnector(p).meta.refreshTokenRequired, p).toBeUndefined();
    }
  });
});

describe("getValidAccessToken — Meta Ads", () => {
  const meta = (over: Record<string, unknown> = {}) => ({
    id: "conn-1",
    provider: "meta_ads",
    accessTokenEnc: encryptSecret("EAAB-longo"),
    refreshTokenEnc: null,
    tokenExpiresAt: new Date(NOW + 30 * 86_400_000),
    scopes: ["ads_read"],
    ...over,
  });

  it("token de longa duração ainda válido: devolve o token decifrado, sem tocar no banco", async () => {
    state.conn = meta();
    await expect(getValidAccessToken("conn-1")).resolves.toBe("EAAB-longo");
    expect(state.updates).toEqual([]);
  });

  it("token vencido: marca a conexão como reauth_required e pede reconectar (sem tentar renovar)", async () => {
    state.conn = meta({ tokenExpiresAt: new Date(NOW - 1000) });
    await expect(getValidAccessToken("conn-1")).rejects.toThrow(/Reconecte a conta/);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ status: "reauth_required" });
    expect(String(state.updates[0]!.lastError)).toMatch(/reautorize a conta/);
  });

  it("conexão sem token de acesso: pede reconectar", async () => {
    state.conn = meta({ accessTokenEnc: null });
    await expect(getValidAccessToken("conn-1")).rejects.toThrow(/sem tokens/);
  });
});

describe("getValidAccessToken — provedores com refresh token (comportamento preservado)", () => {
  it("sem refresh token a conexão está quebrada, mesmo com o access token válido", async () => {
    state.conn = {
      id: "c2",
      provider: "google_ads",
      accessTokenEnc: encryptSecret("ya29.valido"),
      refreshTokenEnc: null,
      tokenExpiresAt: new Date(NOW + 3_600_000),
    };
    await expect(getValidAccessToken("c2")).rejects.toThrow(/Conexão sem tokens/);
  });

  it("access token válido e refresh token presente: devolve o access token", async () => {
    state.conn = {
      id: "c3",
      provider: "google_ads",
      accessTokenEnc: encryptSecret("ya29.valido"),
      refreshTokenEnc: encryptSecret("1//refresh"),
      tokenExpiresAt: new Date(NOW + 3_600_000),
    };
    await expect(getValidAccessToken("c3")).resolves.toBe("ya29.valido");
  });

  it("conexão inexistente", async () => {
    await expect(getValidAccessToken("nada")).rejects.toThrow(/não encontrada/);
  });
});
