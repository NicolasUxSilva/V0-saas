/**
 * Compat: o token manager foi generalizado no G1 para
 * `connectors/shared/token.ts`. Este alias mantém os call-sites do GA4
 * (`conexoes/actions.ts`, `sync/run-sync.ts`) sem alteração.
 */
export { getValidAccessToken as getValidGa4AccessToken } from "@/server/connectors/shared/token";
