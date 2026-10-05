/**
 * Callback do OAuth de dados de uma fonte (bloco B1 · generalizado no G1).
 *
 * `/api/oauth/<provider>/callback` — valida o `state`, troca o `code` por
 * tokens, cifra-os, faz upsert em `connections`, descobre as contas e grava em
 * `connection_properties`. Sempre redireciona para /conexoes com um parâmetro
 * `<provider>_connected` ou `<provider>_error`.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { requireWorkspace } from "@/server/auth";
import { emailFromIdToken } from "@/server/connectors/google/oauth";
import { PROVIDERS, getConnector, isImplemented } from "@/server/connectors/registry";
import { verifyOAuthState } from "@/server/connectors/shared/oauth-state";
import type { Provider } from "@/server/connectors/types";
import { ACTIVE_KEY_VERSION, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import { connectionProperties, connections } from "@/server/db/schema";

function isKnownProvider(v: string): v is Provider {
  return (PROVIDERS as string[]).includes(v);
}

function redirectUriFor(provider: Provider): string {
  if (provider === "ga4") return env.GA4_REDIRECT_URI;
  return `${env.AUTH_URL}/api/oauth/${provider}/callback`;
}

function back(
  origin: string,
  params: Record<string, string>,
): NextResponse {
  const url = new URL("/conexoes", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;
  const url = new URL(request.url);
  const origin = url.origin;

  if (!isKnownProvider(provider) || !isImplemented(provider)) {
    return NextResponse.json(
      { error: `Provider não disponível: ${provider}` },
      { status: 404 },
    );
  }
  const errKey = `${provider}_error`;
  const okKey = `${provider}_connected`;
  const connector = getConnector(provider);

  const { workspaceId, userId } = await requireWorkspace();

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return back(origin, { [errKey]: oauthError });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back(origin, { [errKey]: "missing_params" });

  let stateData: { workspaceId: string };
  try {
    stateData = verifyOAuthState(state);
  } catch {
    return back(origin, { [errKey]: "invalid_state" });
  }
  if (stateData.workspaceId !== workspaceId) {
    return back(origin, { [errKey]: "workspace_mismatch" });
  }

  let tokens;
  try {
    tokens = await connector.exchangeCode({
      code,
      redirectUri: redirectUriFor(provider),
    });
  } catch {
    return back(origin, { [errKey]: "token_exchange_failed" });
  }
  if (!tokens.refreshToken) {
    return back(origin, { [errKey]: "no_refresh_token" });
  }

  const email = emailFromIdToken(tokens.idToken);

  const [conn] = await db
    .insert(connections)
    .values({
      workspaceId,
      provider,
      status: "connected",
      externalAccountEmail: email,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: encryptSecret(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      keyVersion: ACTIVE_KEY_VERSION,
      createdBy: userId,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [connections.workspaceId, connections.provider],
      set: {
        status: "connected",
        externalAccountEmail: email,
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        keyVersion: ACTIVE_KEY_VERSION,
        lastError: null,
      },
    })
    .returning();
  if (!conn) return back(origin, { [errKey]: "persist_failed" });

  let accounts;
  try {
    accounts = await connector.listAccounts({ accessToken: tokens.accessToken });
  } catch (e) {
    await db
      .update(connections)
      .set({
        status: "error",
        lastError: `discovery: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          1000,
        ),
      })
      .where(eq(connections.id, conn.id));
    return back(origin, { [errKey]: "discovery_failed" });
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(connectionProperties)
      .where(eq(connectionProperties.connectionId, conn.id));
    if (accounts.length > 0) {
      await tx.insert(connectionProperties).values(
        accounts.map((p) => ({
          connectionId: conn.id,
          externalId: p.externalId,
          displayName: p.displayName,
          timezone: p.timezone,
          currency: p.currency,
          isSelected: accounts.length === 1, // auto-seleciona se só há 1
        })),
      );
    }
  });

  return back(origin, {
    [okKey]: "1",
    properties: String(accounts.length),
  });
}
