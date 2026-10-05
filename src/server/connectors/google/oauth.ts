/**
 * OAuth 2.0 do Google — compartilhado entre GA4 e Google Ads (G1).
 *
 * Usa o MESMO OAuth Client do Google (login + dados). O que muda por conector é
 * apenas o **scope** e o **redirect URI** — a mecânica de troca de código /
 * refresh / revoke / parse do id_token é idêntica.
 *
 * Extraído de `ga4/auth.ts` sem alteração de comportamento.
 */
import { OAuth2Client, type Credentials } from "google-auth-library";

import { env } from "@/env";
import type { TokenSet } from "@/server/connectors/types";

function oauthClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri,
  });
}

function toTokenSet(c: Credentials, fallbackRefresh?: string): TokenSet {
  if (!c.access_token) {
    throw new Error("Resposta OAuth do Google sem access_token");
  }
  return {
    accessToken: c.access_token,
    refreshToken: c.refresh_token ?? fallbackRefresh ?? null,
    expiresAt: c.expiry_date
      ? new Date(c.expiry_date)
      : new Date(Date.now() + 55 * 60_000),
    scopes: (c.scope ?? "").split(" ").filter(Boolean),
    idToken: c.id_token ?? null,
  };
}

/** Monta a URL de consentimento do Google para os `scopes` do conector. */
export function buildGoogleAuthUrl(params: {
  scopes: readonly string[];
  state: string;
  redirectUri: string;
}): string {
  return oauthClient(params.redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...params.scopes],
    include_granted_scopes: false,
    state: params.state,
  });
}

export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
}): Promise<TokenSet> {
  const { tokens } = await oauthClient(params.redirectUri).getToken(params.code);
  return toTokenSet(tokens);
}

export async function refreshTokens(params: {
  refreshToken: string;
}): Promise<TokenSet> {
  // O grant `refresh_token` não usa `redirect_uri`; qualquer URL válida serve
  // para construir o client.
  const client = oauthClient(env.AUTH_URL);
  client.setCredentials({ refresh_token: params.refreshToken });
  await client.getAccessToken(); // dispara o refresh e popula client.credentials
  return toTokenSet(client.credentials, params.refreshToken);
}

/** Revoga um token no Google (best-effort — usado ao desconectar). */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // ignora — a desconexão local acontece de qualquer forma
  }
}

/**
 * Extrai o e-mail do `id_token` (JWT OIDC). Best-effort: sem verificação de
 * assinatura (o token veio direto do endpoint do Google sobre TLS).
 */
export function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}
