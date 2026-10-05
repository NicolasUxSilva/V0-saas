/**
 * OAuth 2.0 do RD Station CRM (bloco RD-1D).
 *
 * Mecânica DIFERENTE do RD Station Marketing e do Google — host de
 * autorização, endpoint de token e encoding do corpo são todos distintos (ver
 * developers.rdstation.com/reference/crm-v2-authentication-step-{1,2,3,4}):
 *
 *  - autorização em `accounts.rdstation.com` (não `api.rd.services`);
 *  - troca de code e refresh no MESMO endpoint `/oauth2/token`, diferenciados
 *    por `grant_type`, corpo `application/x-www-form-urlencoded` (não JSON);
 *  - `redirect_uri` é OBRIGATÓRIO na troca de code (ao contrário do Marketing);
 *  - `code` dura só 5 minutos (Marketing: 60);
 *  - `access_token` dura 7200s / 2h (Marketing: 86400s / 24h);
 *  - `refresh_token` ROTACIONA A CADA USO e expira se ficar 14 dias sem uso —
 *    por isso é essencial repassar sempre o novo `refresh_token` devolvido;
 *    `shared/token.ts` (genérico, já existente) já persiste um refresh_token
 *    novo quando ele vem preenchido, então nenhuma mudança é necessária lá.
 *
 * Sem `scope` na URL de autorização — mesma ausência observada no Marketing.
 *
 * Não há endpoint de revogação documentado para a API v2 do CRM (ao contrário
 * do Marketing e do Google) — `revokeToken` aqui é um no-op proposital, não
 * uma chamada inventada; desconectar só remove a conexão localmente.
 */
import { env } from "@/env";
import type { TokenSet } from "@/server/connectors/types";

const AUTHORIZE_BASE = "https://accounts.rdstation.com";
// Confirmado na auditoria oficial (curl de exemplo da doc): NÃO é
// `/crm/v2/oauth2/token` nem `/crm/oauth2/token` — é `/oauth2/token` direto na
// raiz de `api.rd.services`, fora do path `/crm/v2` usado pelos recursos.
const TOKEN_URL = "https://api.rd.services/oauth2/token";

export class RdCrmCredentialsMissingError extends Error {
  constructor() {
    super(
      "RD_CRM_CLIENT_ID / RD_CRM_CLIENT_SECRET não configurados. Crie um app " +
        "PRIVADO SEPARADO no App Publisher do RD Station (produto 'RD Station " +
        "CRM') e preencha as duas envs. Ver .env.example.",
    );
    this.name = "RdCrmCredentialsMissingError";
  }
}

function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = env.RD_CRM_CLIENT_ID;
  const clientSecret = env.RD_CRM_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new RdCrmCredentialsMissingError();
  return { clientId, clientSecret };
}

interface RdCrmTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

function toTokenSet(json: RdCrmTokenResponse): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scopes: [],
    idToken: null,
  };
}

async function postForm(body: Record<string, string>): Promise<RdCrmTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `RD Station CRM: falha no endpoint de token (${res.status})${
        text ? `: ${text.slice(0, 500)}` : ""
      }`,
    );
  }
  return (await res.json()) as RdCrmTokenResponse;
}

/** Monta a URL de autorização. Host `accounts.rdstation.com` — não `api.rd.services`. */
export function buildAuthUrl(params: {
  state: string;
  redirectUri: string;
}): string {
  const { clientId } = requireCredentials();
  const url = new URL("/oauth/authorize", AUTHORIZE_BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  // `state` não está documentado como parâmetro desta URL especificamente,
  // mas é passado por completude/consistência com o fluxo genérico — se a API
  // o ignorar, não quebra nada (parâmetro extra não documentado como proibido).
  url.searchParams.set("state", params.state);
  return url.toString();
}

/** Troca o `code` por tokens. `redirect_uri` é OBRIGATÓRIO aqui (diferente do Marketing). */
export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
}): Promise<TokenSet> {
  const { clientId, clientSecret } = requireCredentials();
  const json = await postForm({
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
  return toTokenSet(json);
}

/** Renova o access_token. O refresh_token SEMPRE rotaciona — repassa o novo. */
export async function refreshTokens(params: {
  refreshToken: string;
}): Promise<TokenSet> {
  const { clientId, clientSecret } = requireCredentials();
  const json = await postForm({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: params.refreshToken,
    grant_type: "refresh_token",
  });
  return toTokenSet(json);
}

/** Ver cabeçalho do arquivo — nenhum endpoint de revogação documentado para o CRM v2. */
export async function revokeToken(token: string): Promise<void> {
  // no-op proposital — o parâmetro existe para manter o call site pronto caso
  // um endpoint de revogação seja documentado no futuro.
  void token;
}
