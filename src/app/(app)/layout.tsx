import { and, eq } from "drizzle-orm";

import { AppShell } from "@/components/shell";
import { formatRelativeTime } from "@/lib/format";
import { requireWorkspace, signOut } from "@/server/auth";
import { db } from "@/server/db";
import { connections } from "@/server/db/schema";

/**
 * Layout do grupo protegido `(app)`: portão de sessão + shell (sidebar/topbar).
 * O topbar mostra o mesmo `last_synced_at` real usado em Diagnóstico/Conexões.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, workspaceId, workspaceName } = await requireWorkspace();

  const [conn] = await db
    .select({ lastSyncedAt: connections.lastSyncedAt })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "ga4"),
      ),
    )
    .limit(1);
  const lastSyncLabel = conn?.lastSyncedAt
    ? `Atualizado ${formatRelativeTime(conn.lastSyncedAt.toISOString())}`
    : null;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppShell
      user={user}
      workspaceName={workspaceName}
      lastSyncLabel={lastSyncLabel}
      signOutAction={signOutAction}
    >
      {children}
    </AppShell>
  );
}
