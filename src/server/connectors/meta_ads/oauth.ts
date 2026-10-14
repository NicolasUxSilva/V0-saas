/**
 * OAuth 2.0 do Meta Ads (Facebook Login) — fluxo manual do lado do servidor.
 *
 * Mecânica PRÓPRIA (não reaproveita `connectors/google/oauth.ts`): endpoints, forma de
 * request e ciclo de vida do token são diferentes. Fonte: Meta for Developers —
 * "Manually Build a Login Flow", "Long-Lived Access Tokens" e "Facebook Login for
 * Business" (verificados em 2026-10).
 *
 * Particularidades que moldam o conector:
 *  - NÃO existe refresh token. O `code` vira um token CURTO (~1–2 h), que é trocado na
 *    hora (`grant_type=fb_exchange_token`) por um token de LONGA duração (~60 dias). A
 *    documentação não garante que um token longo possa ser renovado — por isso o
 *    conector não tenta: quando expira, a conexão pede REAUTORIZAÇÃO (`reauth_required`)
 *    e a tela de Conexões avisa quantos dias faltam;
 *  - permissão pedida: só `ads_read` (leitura de Insights e de contas de anúncios) —
 *    menor privilégio; o conector nunca cria, edita nem pausa nada;
 *  - apps com "Facebook Login for Business" usam `config_id` no lugar de `scope`
 *    (`META_LOGIN_CONFIG_ID`); com o Facebook Login clássico, `scope=ads_read`;
 *  - `redirect_uri` precisa ser IDÊNTICO ao cadastrado em "Valid OAuth Redirect URIs".
 */
import { env } from "@/env";
import type { TokenSet } from "@/server/connectors/types";

import { DIALOG_BASE, metaFetch, requireMetaApp } from "./http";

export const META_ADS_SCOPES = ["ads_read"] as const;

/** Sem `expires_in` na resposta: a Meta documenta ~60 dias para o token de longa duração. */
const DEFAULT_LONG_LIVED_SECONDS = 60 * 24 * 3600;

export class MetaPermissionError extends Error {
  constructor(detail: string) {
    super(`Meta Ads: ${detail}`);
    this.name = "MetaPermissionError";
  }
}

/** URL do diálogo de login da Meta. */
export function buildAuthUrl(params: { state: string; redirectUri: string }): string {
  const { appId } = requireMetaApp();
  const url = new URL(DIALOG_BASE);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("response_type", "code");
  if (env.META_LOGIN_CONFIG_ID) {
    // Facebook Login for Business: a configuração define as permissões
    url.searchParams.set("config_id", env.META_LOGIN_CONFIG_ID);
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", META_ADS_SCOPES.join(","));
  }
  return url.toString();
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

function readToken(json: unknown, step: string): { token: string; expiresIn: number | null } {
  const body = (json ?? {}) as TokenResponse;
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new Error(`Meta Ads: a resposta de ${step} não trouxe access_token`);
  }
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? body.expires_in
      : null;
  return { token: body.access_token, expiresIn };
}

interface DebugTokenData {
  is_valid?: unknown;
  expires_at?: unknown;
  scopes?: unknown;
}

/**
 * Troca o `code` por um token de LONGA duração (duas chamadas) e confere, com
 * `debug_token`, a validade, a expiração real e a permissão `ads_read` concedida.
 * `debug_token` é a única fonte confiável do que o usuário de fato autorizou: ele pode
 * desmarcar permissões no diálogo.
 */
export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
}): Promise<TokenSet> {
  const { appId, appSecret } = requireMetaApp();

  const short = readToken(
    await metaFetch("/oauth/access_token", {
      params: {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: params.redirectUri,
        code: params.code,
      },
    }),
    "troca do código",
  );

  const long = readToken(
    await metaFetch("/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: short.token,
      },
    }),
    "troca pelo token de longa duração",
  );

  let expiresAt = new Date(Date.now() + (long.expiresIn ?? DEFAULT_LONG_LIVED_SECONDS) * 1000);
  let scopes: string[] = [...META_ADS_SCOPES];

  const debug = await debugToken(long.token, appId, appSecret);
  if (debug) {
    if (debug.is_valid === false) throw new MetaPermissionError("o token recebido não é válido");
    if (Array.isArray(debug.scopes)) {
      scopes = debug.scopes.filter((s): s is string => typeof s === "string");
      if (!scopes.includes("ads_read")) {
        throw new MetaPermissionError(
          "a permissão ads_read não foi concedida — autorize o acesso às contas de anúncios",
        );
      }
    }
    // `expires_at` em segundos (UNIX); 0 = não expira
    if (typeof debug.expires_at === "number" && debug.expires_at > 0) {
      expiresAt = new Date(debug.expires_at * 1000);
    }
  }

  return { accessToken: long.token, refreshToken: null, expiresAt, scopes, idToken: null };
}

/** `GET /debug_token` — best-effort: se falhar, o fluxo segue com o que a troca devolveu. */
async function debugToken(
  token: string,
  appId: string,
  appSecret: string,
): Promise<DebugTokenData | null> {
  try {
    const json = (await metaFetch("/debug_token", {
      params: { input_token: token, access_token: `${appId}|${appSecret}` },
    })) as { data?: DebugTokenData } | null;
    return json?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * A Meta não emite refresh token (ver o cabeçalho). Chamado por engano, falha alto em
 * vez de fingir que renovou: o `shared/token.ts` nunca o chama para este conector.
 */
export async function refreshTokens(): Promise<TokenSet> {
  throw new Error(
    "Meta Ads não usa refresh token: o acesso dura cerca de 60 dias e precisa ser reautorizado. Reconecte a conta.",
  );
}

/** Revoga as permissões do app para o usuário (best-effort — usado ao desconectar). */
export async function revokeToken(accessToken: string): Promise<void> {
  try {
    await metaFetch("/me/permissions", { method: "DELETE", accessToken });
  } catch {
    // ignora — a desconexão local acontece de qualquer forma
  }
}
