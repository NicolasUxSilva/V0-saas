/**
 * Costura mock ↔ real da tela Diagnóstico (bloco C5).
 *
 * `USE_MOCK=true`  → devolve `src/mock.ts` (blocos A).
 * `USE_MOCK=false` → lê os `insights` reais do workspace + agrega
 *                    `fact_traffic_daily` (via o contexto do motor) para as
 *                    "Métricas de apoio" e para o "estado honesto".
 *
 * É só leitura. A escrita de feedback está em `./actions.ts`; a geração dos
 * insights está em `src/server/analysis/engine.ts` (disparada no fim do sync).
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { todayInTimeZone } from "@/lib/dates";
import type {
  DiagnosticoData,
  Insight,
  InsightEvidence,
  InsightImpact,
  InsightRating,
  ResponsibleDimension,
  SupportMetric,
} from "@/lib/insight";
import { mockDiagnostico } from "@/mock";
import { env } from "@/env";
import { buildAnalysisContext } from "@/server/analysis/context";
import { evaluateGates } from "@/server/analysis/gates";
import { db } from "@/server/db";
import { connections, insights, syncRuns } from "@/server/db/schema";

const COMPARED_TO = "28 dias anteriores";

function deltaPct(current: number, previous: number): number {
  return previous > 0 ? (current - previous) / previous : 0;
}

/** Linha de `insights` → objeto que a UI consome (`src/lib/insight.ts`). */
function rowToInsight(row: typeof insights.$inferSelect): Insight {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    detector: row.detector,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    title: row.title,
    impact: (row.impactJson as InsightImpact | null) ?? null,
    explanation: row.explanation,
    hypothesis: row.hypothesis,
    // jsonb sem `$type` volta como unknown; as formas do motor (types.ts) e da
    // UI (insight.ts) são compatíveis para renderização (null vs undefined).
    evidence: row.evidenceJson as InsightEvidence,
    window: {
      start: row.periodStart,
      end: row.periodEnd,
      comparedTo: row.comparedTo ?? COMPARED_TO,
    },
    responsibleDimension:
      (row.responsibleDimensionJson as ResponsibleDimension | null) ?? null,
    confidence: row.confidence,
    // o motor grava `confidenceBasis` (string) dentro da coluna jsonb.
    confidenceBasis:
      typeof row.confidenceBasisJson === "string"
        ? row.confidenceBasisJson
        : String(row.confidenceBasisJson ?? ""),
    recommendedAction: row.recommendedAction,
    priorityScore: row.priorityScore,
    rating: (row.rating as InsightRating) ?? null,
    detectedAt: row.createdAt.toISOString(),
  };
}

export async function getDiagnostico(
  workspaceId: string,
): Promise<DiagnosticoData> {
  if (env.USE_MOCK) return mockDiagnostico;

  const [conn] = await db
    .select({ id: connections.id, lastSyncedAt: connections.lastSyncedAt })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "ga4"),
      ),
    )
    .limit(1);
  const lastSyncedAt = conn?.lastSyncedAt?.toISOString() ?? null;

  // status do sync mais recente (para o aviso de dados parciais)
  let lastSyncStatus: DiagnosticoData["lastSyncStatus"] = null;
  if (conn) {
    const [lastRun] = await db
      .select({ status: syncRuns.status })
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, conn.id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    lastSyncStatus = lastRun?.status ?? null;
  }

  // Todos os insights do workspace, maior prioridade primeiro. A página separa
  // por seção; os `dismissed` viram tiras recolhidas com "Desfazer".
  const rows = await db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.workspaceId, workspaceId),
        inArray(insights.status, ["open", "acknowledged", "dismissed"]),
      ),
    )
    .orderBy(desc(insights.priorityScore));
  const insightList = rows.map(rowToInsight);

  // contexto do motor: janelas 28/28 agregadas + números dos gates
  const ctx = await buildAnalysisContext(workspaceId);
  if (!ctx) {
    const today = todayInTimeZone("UTC");
    return {
      lastSyncedAt,
      lastSyncStatus,
      window: { start: today, end: today, comparedTo: COMPARED_TO },
      insights: insightList,
      supportMetrics: [],
      analysis: null,
    };
  }

  const gates = evaluateGates(ctx);
  const cur = ctx.current.totals;
  const prev = ctx.previous.totals;
  const curRate = cur.sessions > 0 ? cur.keyEvents / cur.sessions : 0;
  const prevRate = prev.sessions > 0 ? prev.keyEvents / prev.sessions : 0;

  const supportMetrics: SupportMetric[] = [
    {
      key: "sessions",
      label: "Sessões",
      current: cur.sessions,
      previous: prev.sessions,
      deltaPct: deltaPct(cur.sessions, prev.sessions),
      format: "count",
    },
    {
      key: "users",
      label: "Usuários",
      current: cur.totalUsers,
      previous: prev.totalUsers,
      deltaPct: deltaPct(cur.totalUsers, prev.totalUsers),
      format: "count",
    },
    {
      key: "key_events",
      label: "Conversões (key events)",
      current: cur.keyEvents,
      previous: prev.keyEvents,
      deltaPct: deltaPct(cur.keyEvents, prev.keyEvents),
      format: "count",
    },
    {
      key: "conversion_rate",
      label: "Taxa de conversão",
      current: curRate,
      previous: prevRate,
      deltaPct: deltaPct(curRate, prevRate),
      format: "rate",
    },
  ];

  return {
    lastSyncedAt,
    lastSyncStatus,
    window: {
      start: ctx.current.start,
      end: ctx.current.end,
      comparedTo: COMPARED_TO,
    },
    insights: insightList,
    supportMetrics,
    analysis: {
      analysisEnd: ctx.analysisEnd,
      coverageDistinctDates: ctx.coverage.distinctDates,
      expectedDays: ctx.coverage.expectedDays,
      currentDaysWithData: ctx.current.daysWithData,
      previousDaysWithData: ctx.previous.daysWithData,
      windowDays: ctx.current.days,
      hasComparableWindows: gates.hasComparableWindows,
      suppressed: [...gates.suppress],
      totalKeyEvents: ctx.totalKeyEvents,
    },
  };
}
