/**
 * Leitura do estado de uma conexão de um workspace (bloco B2 · generalizado no G1).
 *
 * Retorna SÓ colunas seguras — nunca os bytes cifrados dos tokens (esta função
 * alimenta a UI). O acesso aos tokens é feito por `./token`.
 *
 * Idêntico ao antigo `getGa4ConnectionForWorkspace`, só com `provider` como
 * parâmetro. `properties` mantém o nome (a tela de Conexões ainda fala em
 * "propriedade"); a semântica serve qualquer fonte (`external_id` opaco).
 */
import { and, asc, desc, eq } from "drizzle-orm";

import type { Provider } from "@/server/connectors/types";
import { db } from "@/server/db";
import { connectionProperties, connections, syncRuns } from "@/server/db/schema";

export interface ConnectionView {
  connection: {
    id: string;
    status: "connected" | "reauth_required" | "error";
    externalAccountEmail: string | null;
    scopes: string[] | null;
    tokenExpiresAt: Date | null;
    lastSyncedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
  };
  properties: {
    id: string;
    externalId: string;
    displayName: string;
    timezone: string | null;
    currency: string | null;
    isSelected: boolean;
  }[];
  recentSyncRuns: {
    id: string;
    trigger: "manual" | "initial";
    status: "running" | "success" | "partial" | "failed";
    periodStart: string | null;
    periodEnd: string | null;
    rowsIn: number | null;
    rowsWritten: number | null;
    error: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  }[];
}

export async function getConnectionForWorkspace(
  workspaceId: string,
  provider: Provider,
): Promise<ConnectionView | null> {
  const [connection] = await db
    .select({
      id: connections.id,
      status: connections.status,
      externalAccountEmail: connections.externalAccountEmail,
      scopes: connections.scopes,
      tokenExpiresAt: connections.tokenExpiresAt,
      lastSyncedAt: connections.lastSyncedAt,
      lastError: connections.lastError,
      createdAt: connections.createdAt,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, provider),
      ),
    )
    .limit(1);

  if (!connection) return null;

  const properties = await db
    .select({
      id: connectionProperties.id,
      externalId: connectionProperties.externalId,
      displayName: connectionProperties.displayName,
      timezone: connectionProperties.timezone,
      currency: connectionProperties.currency,
      isSelected: connectionProperties.isSelected,
    })
    .from(connectionProperties)
    .where(eq(connectionProperties.connectionId, connection.id))
    .orderBy(asc(connectionProperties.displayName));

  const recentSyncRuns = await db
    .select({
      id: syncRuns.id,
      trigger: syncRuns.trigger,
      status: syncRuns.status,
      periodStart: syncRuns.periodStart,
      periodEnd: syncRuns.periodEnd,
      rowsIn: syncRuns.rowsIn,
      rowsWritten: syncRuns.rowsWritten,
      error: syncRuns.error,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
    })
    .from(syncRuns)
    .where(eq(syncRuns.connectionId, connection.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(5);

  return { connection, properties, recentSyncRuns };
}
