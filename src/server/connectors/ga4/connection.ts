/**
 * Compat: a leitura de estado de conexão foi generalizada no G1 para
 * `connectors/shared/connection.ts`. Estes aliases mantêm os call-sites do GA4
 * (`conexoes/page.tsx`, `conexoes/actions.ts`, `connection-cards.tsx`) sem
 * alteração.
 */
import { getConnectionForWorkspace } from "@/server/connectors/shared/connection";

export type { ConnectionView as Ga4ConnectionView } from "@/server/connectors/shared/connection";

export function getGa4ConnectionForWorkspace(workspaceId: string) {
  return getConnectionForWorkspace(workspaceId, "ga4");
}
