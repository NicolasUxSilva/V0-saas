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
const REFRESH_SKEW_MS = 2 * 60_000;

export async function getValidAccessToken(
  connectionId: string,
): Promise<string> {
  const [conn] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  if (!conn) throw new Error("Conexão não encontrada.");
  if (!conn.accessTokenEnc || !conn.refreshTokenEnc) {
    throw new Error("Conexão sem tokens — reconecte a fonte.");
  }

  const msToExpiry = (conn.tokenExpiresAt?.getTime() ?? 0) - Date.now();
  if (msToExpiry > REFRESH_SKEW_MS) {
    return decryptSecret(conn.accessTokenEnc);
  }

  // ── renovação ────────────────────────────────────────────────────
  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  let fresh;
  try {
    fresh = await getConnector(conn.provider).refreshTokens({ refreshToken });
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
