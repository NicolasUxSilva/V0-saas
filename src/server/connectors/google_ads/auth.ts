/**
 * OAuth do fluxo de DADOS do Google Ads (bloco G2).
 *
 * Reutiliza integralmente a mecânica OAuth do Google (`connectors/google/oauth.ts`,
 * criada no G1) — o MESMO OAuth Client, o MESMO `state`, a MESMA cifra. O único
 * diferencial em relação ao GA4 é o **scope** (`adwords` no lugar de
 * `analytics.readonly`). O redirect URI e o `provider` são resolvidos pela rota
 * genérica `/api/oauth/[provider]/*`.
 */
import { buildGoogleAuthUrl } from "@/server/connectors/google/oauth";

export {
  exchangeCode,
  refreshTokens,
  revokeToken,
  emailFromIdToken,
} from "@/server/connectors/google/oauth";

export const GOOGLE_ADS_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/adwords",
] as const;

/** URL de consentimento do Google para os escopos do Google Ads. */
export function buildAuthUrl(params: {
  state: string;
  redirectUri: string;
}): string {
  return buildGoogleAuthUrl({ scopes: GOOGLE_ADS_SCOPES, ...params });
}
