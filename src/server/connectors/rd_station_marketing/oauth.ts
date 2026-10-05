/**
 * OAuth 2.0 do RD Station Marketing (bloco RD-1).
 *
 * Mecânica PRÓPRIA — não reaproveita `connectors/google/oauth.ts` (host,
 * endpoints e forma de request são diferentes do Google, e diferentes também
 * do RD Station CRM, ver `connectors/rd_station_crm/oauth.ts`). Fonte:
 * developers.rdstation.com/reference/{criar-aplicativo-appstore,gerar-code,
 * obter-tokens-acesso,atualizar-access-token,como-revogar-acesso-de-token}.
 *
 * Particularidades confirmadas na auditoria (não documentadas da mesma forma
 * no Google):
 *  - a URL de autorização NÃO tem parâmetro `scope` — é tudo-ou-nada por app
 *    (o `access_token` de exemplo nos docs oficiais traz `"scope":""` vazio);
 *  - `code` tem validade de 60 minutos e uso único;
 *  - `access_token` expira em 86400s (24h);
 *  - `refresh_token` é documentado como "não expira", mas ROTACIONA a cada uso
 *    (a troca devolve um `refresh_token` novo) — por isso `refreshTokens` aqui
 *    sempre repassa o que a API devolver, e `shared/token.ts` (genérico, já
 *    existente) já persiste um refresh_token novo quando ele vem preenchido.
 */
import { env } from "@/env";
import type { TokenSet } from "@/server/connectors/types";

const AUTH_BASE = "https://api.rd.services";

export class RdMarketingCredentialsMissingError extends Error {
  constructor() {
    super(
      "RD_MARKETING_CLIENT_ID / RD_MARKETING_CLIENT_SECRET não configurados. " +
        "Crie um app PRIVADO no App Publisher do RD Station (produto " +
        "'RD Station Marketing') e preencha as duas envs. Ver .env.example.",
    );
    this.name = "RdMarketingCredentialsMissingError";
  }
}

function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = env.RD_MARKETING_CLIENT_ID;
  const clientSecret = env.RD_MARKETING_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new RdMarketingCredentialsMissingError();
  return { clientId, clientSecret };
}

interface RdTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

function toTokenSet(json: RdTokenResponse): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scopes: [], // RD Station Marketing não usa scopes por app (ver cabeçalho)
    idToken: null, // sem OIDC
  };
}

/** Monta a URL de autorização. Sem `scope` — ver cabeçalho do arquivo. */
export function buildAuthUrl(params: {
  state: string;
  redirectUri: string;
}): string {
  const { clientId } = requireCredentials();
  const url = new URL("/auth/dialog", AUTH_BASE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * Troca o `code` do callback por tokens. `redirect_uri` NÃO está documentado
 * nos Body Params oficiais desta chamada (só `client_id`/`client_secret`/`code`)
 * — incomum frente à RFC 6749, mas é exatamente o que a doc atual descreve;
 * não envio um campo que a doc não lista.
 */
export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
}): Promise<TokenSet> {
  const { clientId, clientSecret } = requireCredentials();
  const res = await fetch(`${AUTH_BASE}/auth/token?token_by=code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `RD Station Marketing: falha ao trocar code por tokens (${res.status})${
        body ? `: ${body.slice(0, 500)}` : ""
      }`,
    );
  }
  return toTokenSet((await res.json()) as RdTokenResponse);
}

/** Renova o access_token. O refresh_token devolvido (se vier) ROTACIONA o atual. */
export async function refreshTokens(params: {
  refreshToken: string;
}): Promise<TokenSet> {
  const { clientId, clientSecret } = requireCredentials();
  const res = await fetch(`${AUTH_BASE}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: params.refreshToken,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `RD Station Marketing: falha ao renovar access_token (${res.status})${
        body ? `: ${body.slice(0, 500)}` : ""
      }`,
    );
  }
  return toTokenSet((await res.json()) as RdTokenResponse);
}

/** Revoga um token no RD Station (best-effort — usado ao desconectar). */
export async function revokeToken(
  token: string,
  tokenTypeHint: "access_token" | "refresh_token",
): Promise<void> {
  try {
    await fetch(`${AUTH_BASE}/auth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // A doc documenta "Form Data" para este endpoint (diferente do JSON dos
      // outros passos) — client_id/secret não aparecem no Form Data oficial.
      body: new URLSearchParams({ token, token_type_hint: tokenTypeHint }),
      cache: "no-store",
    });
  } catch {
    // ignora — a desconexão local acontece de qualquer forma
  }
}
