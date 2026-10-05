/**
 * Orquestração de sync (bloco B3 · generalizado no G1): sync_run → token →
 * extract → raw → normalize → finaliza. Roda inline (sem fila). No fim, dispara
 * `runWorkspaceAnalysis` — falha nela não derruba o sync (dados já gravados).
 *
 * `runSync` resolve o conector por `connection.provider` (GA4 desde o B3;
 * Google Ads desde o G3) e é 100% agnóstico de fonte: nenhum branch por
 * provider decide *se* a análise roda (bloco G4, INV-9) — qualquer sync
 * bem-sucedido chama `runWorkspaceAnalysis({ workspaceId, syncRunId })` do
 * mesmo jeito. `runWorkspaceAnalysis` continua lendo só `fact_traffic_daily`
 * (GA4); dados de Ads em `fact_ad_performance_daily` não mudam o resultado —
 * isso é G5/G6.
 */
import { and, eq } from "drizzle-orm";

import { runWorkspaceAnalysis } from "@/server/analysis/engine";
import { getConnector } from "@/server/connectors/registry";
import { getValidAccessToken } from "@/server/connectors/shared/token";
import { MAX_TOTAL_ROWS } from "@/server/connectors/ga4/extract";
import { db } from "@/server/db";
import { connectionProperties, connections, rawRecords, syncRuns } from "@/server/db/schema";
import { addDays, maxDate, todayInTimeZone } from "@/lib/dates";

import { normalizeBatch } from "./normalize";

const HISTORY_DAYS = 180;

export interface SyncResult {
  syncRunId: string;
  status: "success" | "partial" | "failed";
  rowsIn: number;
  rowsWritten: number;
  periodStart: string;
  periodEnd: string;
  error: string | null;
}

export async function runSync(input: {
  connectionId: string;
}): Promise<SyncResult> {
  const [conn] = await db
    .select({
      id: connections.id,
      workspaceId: connections.workspaceId,
      provider: connections.provider,
      lastSyncedAt: connections.lastSyncedAt,
    })
    .from(connections)
    .where(eq(connections.id, input.connectionId))
    .limit(1);
  if (!conn) throw new Error("Conexão não encontrada.");

  const connector = getConnector(conn.provider);
  const restatementDays = connector.meta.restatementWindowDays;

  const [property] = await db
    .select({
      externalId: connectionProperties.externalId,
      timezone: connectionProperties.timezone,
      currency: connectionProperties.currency,
    })
    .from(connectionProperties)
    .where(
      and(
        eq(connectionProperties.connectionId, conn.id),
        eq(connectionProperties.isSelected, true),
      ),
    )
    .limit(1);
  if (!property) {
    throw new Error("Selecione uma propriedade antes de sincronizar.");
  }

  // ── janela ────────────────────────────────────────────────────────
  const tz = property.timezone ?? "UTC";
  const until = todayInTimeZone(tz);
  const historyStart = addDays(until, -HISTORY_DAYS);
  const since = conn.lastSyncedAt
    ? maxDate(
        addDays(todayInTimeZone(tz), -HISTORY_DAYS),
        addDays(
          new Date(conn.lastSyncedAt).toISOString().slice(0, 10),
          -restatementDays,
        ),
      )
    : historyStart;
  const trigger: "manual" | "initial" = conn.lastSyncedAt ? "manual" : "initial";

  // ── sync_run ─────────────────────────────────────────────────────
  const [run] = await db
    .insert(syncRuns)
    .values({
      connectionId: conn.id,
      trigger,
      status: "running",
      periodStart: since,
      periodEnd: until,
    })
    .returning({ id: syncRuns.id });
  if (!run) throw new Error("Falha ao criar sync_run.");

  try {
    const accessToken = await getValidAccessToken(conn.id);

    let rowsIn = 0;
    let rowsWritten = 0;

    for (const stream of connector.streams) {
      for await (const page of connector.pull({
        access: { accessToken },
        account: {
          externalId: property.externalId,
          timezone: property.timezone,
          currency: property.currency,
        },
        stream: stream.id,
        since,
        until,
      })) {
        await db.insert(rawRecords).values({
          connectionId: conn.id,
          provider: conn.provider,
          stream: stream.id,
          occurredOn: null,
          payload: page.payload,
          sourceHash: page.sourceHash,
        });

        const batch = connector.mapToCanonical(stream.id, page);
        rowsIn += batch.rows.length;
        rowsWritten += await normalizeBatch(
          conn.workspaceId,
          conn.id,
          conn.provider,
          batch,
        );
      }
    }

    const status: "success" | "partial" =
      rowsIn >= MAX_TOTAL_ROWS ? "partial" : "success";

    await db
      .update(syncRuns)
      .set({ status, rowsIn, rowsWritten, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    await db
      .update(connections)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(connections.id, conn.id));

    // ── análise workspace-level (bloco G4) ───────────────────────────
    // Determinístico, disparado por QUALQUER provider — sem branch por
    // `conn.provider` (INV-9). Se falhar, os dados já estão gravados — só
    // registra o erro, sem marcar o sync como falho.
    try {
      await runWorkspaceAnalysis({ workspaceId: conn.workspaceId, syncRunId: run.id });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db
        .update(connections)
        .set({ lastError: `análise: ${message}`.slice(0, 1000) })
        .where(eq(connections.id, conn.id));
    }

    return {
      syncRunId: run.id,
      status,
      rowsIn,
      rowsWritten,
      periodStart: since,
      periodEnd: until,
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        error: message.slice(0, 2000),
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));
    await db
      .update(connections)
      .set({ lastError: `sync: ${message}`.slice(0, 1000) })
      .where(eq(connections.id, conn.id));

    return {
      syncRunId: run.id,
      status: "failed",
      rowsIn: 0,
      rowsWritten: 0,
      periodStart: since,
      periodEnd: until,
      error: message,
    };
  }
}
