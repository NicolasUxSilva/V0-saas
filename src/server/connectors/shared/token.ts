/**
 * Gerência de access token de conexão de terceiros (bloco B2 · generalizado no G1).
 *
 * `getValidAccessToken` decifra o access token guardado; se estiver perto de
 * expirar, resolve o conector por `connection.provider`, renova via
 * `connector.refreshTokens`, re-cifra e persiste. Comportamento idêntico ao
 * antigo `getValidGa4AccessToken` — só a resolução do conector passou a ser
 * genérica.
 */
import { eq } from "drizzle-orm";

import { getConnector } from "@/server/connectors/registry";
import { ACTIVE_KEY_VERSION, decryptSecret, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import { connections } from "@/server/db/schema";

/** Renova o token se faltar menos que isto para expirar. */
export const REFRESH_SKEW_MS = 2 * 60_000;

/**
 *  - `missing` — a conexão não tem os tokens de que o provedor precisa: reconectar;
 *  - `use`     — o access token ainda vale;
 *  - `refresh` — venceu (ou está perto) e há refresh token: renovar;
 *  - `reauth`  — venceu e o provedor NÃO emite refresh token (Meta Ads, token de
 *                longa duração): só reautorizar resolve.
 */
export type TokenAction = "missing" | "use" | "refresh" | "reauth";

/** Decide o que fazer com o token de uma conexão. PURA — sem banco, relógio nem rede. */
export function decideTokenAction(input: {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  /** o provedor emite refresh token? (`ConnectorMeta.refreshTokenRequired !== false`) */
  refreshTokenRequired: boolean;
  msToExpiry: number;
}): TokenAction {
  if (!input.hasAccessToken) return "missing";
  if (input.refreshTokenRequired && !input.hasRefreshToken) return "missing";
  if (input.msToExpiry > REFRESH_SKEW_MS) return "use";
  return input.hasRefreshToken ? "refresh" : "reauth";
}

export async function getValidAccessToken(
  connectionId: string,
): Promise<string> {
  const [conn] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  if (!conn) throw new Error("Conexão não encontrada.");

  const connector = getConnector(conn.provider);
  const action = decideTokenAction({
    hasAccessToken: Boolean(conn.accessTokenEnc),
    hasRefreshToken: Boolean(conn.refreshTokenEnc),
    refreshTokenRequired: connector.meta.refreshTokenRequired !== false,
    msToExpiry: (conn.tokenExpiresAt?.getTime() ?? 0) - Date.now(),
  });

  if (action === "missing" || !conn.accessTokenEnc) {
    throw new Error("Conexão sem tokens — reconecte a fonte.");
  }
  if (action === "use") return decryptSecret(conn.accessTokenEnc);

  if (action === "reauth" || !conn.refreshTokenEnc) {
    await db
      .update(connections)
      .set({
        status: "reauth_required",
        lastError: "acesso expirado: reautorize a conta (a fonte não emite refresh token)",
      })
      .where(eq(connections.id, connectionId));
    throw new Error("O acesso à fonte expirou. Reconecte a conta.");
  }

  // ── renovação ────────────────────────────────────────────────────
  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  let fresh;
  try {
    fresh = await connector.refreshTokens({ refreshToken });
  } catch (e) {
    await db
      .update(connections)
      .set({
        status: "reauth_required",
        lastError: `refresh: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          1000,
        ),
      })
      .where(eq(connections.id, connectionId));
    throw new Error(
      "Não foi possível renovar o acesso à fonte. Reconecte a conta.",
    );
  }

  await db
    .update(connections)
    .set({
      accessTokenEnc: encryptSecret(fresh.accessToken),
      tokenExpiresAt: fresh.expiresAt,
      // resposta de refresh não traz refresh_token novo — mantém o atual
      ...(fresh.refreshToken
        ? { refreshTokenEnc: encryptSecret(fresh.refreshToken) }
        : {}),
      keyVersion: ACTIVE_KEY_VERSION,
      scopes: fresh.scopes.length > 0 ? fresh.scopes : conn.scopes,
      status: "connected",
      lastError: null,
    })
    .where(eq(connections.id, connectionId));

  return fresh.accessToken;
}
