/**
 * OAuth do fluxo de DADOS do GA4 (bloco B1 · generalizado no G1).
 *
 * A mecânica OAuth do Google (troca de código / refresh / revoke / id_token)
 * vive em `connectors/google/oauth.ts` — compartilhada com o Google Ads. Este
 * arquivo guarda só o que é específico do GA4: os escopos e a montagem da URL
 * de consentimento com esses escopos.
 */
import type { AccessContext } from "@/server/connectors/types";

import { buildGoogleAuthUrl } from "@/server/connectors/google/oauth";

export {
  exchangeCode,
  refreshTokens,
  revokeToken,
  emailFromIdToken,
} from "@/server/connectors/google/oauth";

export const GA4_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

/** URL de consentimento do Google para os escopos do GA4. */
export function buildAuthUrl(params: {
  state: string;
  redirectUri: string;
}): string {
  return buildGoogleAuthUrl({ scopes: GA4_SCOPES, ...params });
}

/** Contexto de acesso a partir de um access token já válido. */
export function accessContext(accessToken: string): AccessContext {
  return { accessToken };
}
