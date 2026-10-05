/**
 * Motor de análise (bloco C4) + orquestração workspace-level (bloco G4):
 * contexto → gates → detectores → scoring → persistência. Determinístico, sem LLM.
 *
 * `runWorkspaceAnalysis` é a **única** camada de orquestração da análise —
 * conhece `workspaceId` (identidade da análise, INV-7/INV-8) e `syncRunId`
 * (rastreabilidade), nunca `provider` nem `connector`. Quem a chama (hoje só
 * `sync/run-sync.ts`, para qualquer fonte) não precisa — e não deve — ramificar
 * por fonte antes de disparar a análise (INV-9): GA4 e Google Ads chamam
 * exatamente a mesma função, com os mesmos parâmetros. Antes do G4 esta função
 * se chamava `runAnalysis` e já tinha esse shape; o bloco só tornou o nome (e a
 * responsabilidade) explícitos — nenhuma lógica de `context`/`gates`/
 * `detectors`/`scoring` mudou.
 *
 * `AnalysisContext` (via `buildAnalysisContext`) ganhou `ctx.ads` no bloco G5
 * (lido de `fact_ad_performance_daily`, alinhado à mesma janela do tráfego) —
 * mas **nenhum detector abaixo lê `ctx.ads`**. `gates`/`detectDataQuality`/
 * `detectTrafficVolumeDrop`/`detectConversionEfficiencyDrop` continuam
 * puramente sobre o tráfego GA4.
 *
 * Bloco G6: depois dos detectores e do `priorityScore`, `enrichWithAds`
 * (enrichment.ts) pode anexar evidência COMPLEMENTAR do Google Ads a um insight
 * já emitido — sem criar insight, sem mexer em dedupeKey/severity/confidence/
 * priorityScore, sem causalidade. Com `ctx.ads === null` é um no-op.
 *
 * Ciclo de vida (D12 · ajuste D1): a identidade de um insight é o `dedupe_key`.
 * Cada análise faz UPSERT por `(workspace_id, dedupe_key)` — atualiza o conteúdo
 * mas **preserva `status`, `rating` e `created_at`** (o 👍/👎 e o
 * reconhecido/descartado do usuário sobrevivem ao re-sync, inclusive em insights
 * `open`). Um insight `open` que deixa de ser detectado é removido (resolvido);
 * `acknowledged`/`dismissed` permanecem como histórico.
 */
import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { insights } from "@/server/db/schema";

import { buildAnalysisContext } from "./context";
import {
  detectConversionEfficiencyDrop,
  detectDataQuality,
  detectTrafficVolumeDrop,
} from "./detectors";
import { enrichWithAds } from "./enrichment";
import { evaluateGates } from "./gates";
import { priorityScore } from "./scoring";
import type { DetectorInsight } from "./types";

export interface AnalysisSummary {
  analysisEnd: string | null;
  suppressed: string[];
  produced: {
    detector: string;
    kind: string;
    severity: string;
    priorityScore: number;
    title: string;
    confidence: string;
  }[];
  insightsWritten: number;
}

export async function runWorkspaceAnalysis(input: {
  workspaceId: string;
  syncRunId: string;
}): Promise<AnalysisSummary> {
  const ctx = await buildAnalysisContext(input.workspaceId);
  if (!ctx) {
    return {
      analysisEnd: null,
      suppressed: [],
      produced: [],
      insightsWritten: 0,
    };
  }

  const gates = evaluateGates(ctx);

  const scored: DetectorInsight[] = [
    ...detectDataQuality(ctx, gates),
    ...detectTrafficVolumeDrop(ctx, gates),
    ...detectConversionEfficiencyDrop(ctx, gates),
  ].map((i) => ({
    ...i,
    gateTrace: { ...i.gateTrace, ...gates.trace },
    priorityScore: priorityScore(
      i,
      typeof i.gateTrace.onsetDate === "string" ? i.gateTrace.onsetDate : null,
    ),
  }));

  // G6 — evidência complementar do Google Ads em insights já emitidos. Só recebe
  // `ctx.ads` (nunca o contexto inteiro), não cria/remove insight e não muda
  // dedupeKey/severity/confidence/priorityScore. `ctx.ads === null` → no-op.
  const produced = enrichWithAds(scored, ctx.ads);

  produced.sort((a, b) => b.priorityScore - a.priorityScore);

  const producedKeys = produced.map((i) => i.dedupeKey);

  await db.transaction(async (tx) => {
    // insights `open` que não foram detectados desta vez → resolvidos.
    await tx.delete(insights).where(
      producedKeys.length > 0
        ? and(
            eq(insights.workspaceId, input.workspaceId),
            eq(insights.status, "open"),
            notInArray(insights.dedupeKey, producedKeys),
          )
        : and(
            eq(insights.workspaceId, input.workspaceId),
            eq(insights.status, "open"),
          ),
    );

    if (produced.length === 0) return;

    // UPSERT por (workspace_id, dedupe_key): atualiza o conteúdo; NÃO toca em
    // `status`, `rating` nem `created_at` (preservados entre análises).
    await tx
      .insert(insights)
      .values(
        produced.map((i) => ({
          workspaceId: input.workspaceId,
          syncRunId: input.syncRunId,
          // `i.type` (ex.: "sessions_drop") é interno — o schema guarda só `detector`.
          detector: i.detector,
          kind: i.kind,
          severity: i.severity,
          status: "open" as const,
          title: i.title,
          impactJson: i.impact,
          explanation: i.explanation,
          hypothesis: i.hypothesis,
          evidenceJson: i.evidence,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
          comparedTo: i.comparedTo,
          responsibleDimensionJson: i.responsibleDimension,
          confidence: i.confidence,
          confidenceBasisJson: i.confidenceBasis,
          recommendedAction: i.recommendedAction,
          priorityScore: i.priorityScore,
          dedupeKey: i.dedupeKey,
          gateTraceJson: i.gateTrace,
        })),
      )
      .onConflictDoUpdate({
        target: [insights.workspaceId, insights.dedupeKey],
        set: {
          syncRunId: sql`excluded.sync_run_id`,
          detector: sql`excluded.detector`,
          kind: sql`excluded.kind`,
          severity: sql`excluded.severity`,
          title: sql`excluded.title`,
          impactJson: sql`excluded.impact_json`,
          explanation: sql`excluded.explanation`,
          hypothesis: sql`excluded.hypothesis`,
          evidenceJson: sql`excluded.evidence_json`,
          periodStart: sql`excluded.period_start`,
          periodEnd: sql`excluded.period_end`,
          comparedTo: sql`excluded.compared_to`,
          responsibleDimensionJson: sql`excluded.responsible_dimension_json`,
          confidence: sql`excluded.confidence`,
          confidenceBasisJson: sql`excluded.confidence_basis_json`,
          recommendedAction: sql`excluded.recommended_action`,
          priorityScore: sql`excluded.priority_score`,
          gateTraceJson: sql`excluded.gate_trace_json`,
          updatedAt: new Date(),
        },
      });
  });

  return {
    analysisEnd: ctx.analysisEnd,
    suppressed: [...gates.suppress],
    produced: produced.map((i) => ({
      detector: i.detector,
      kind: i.kind,
      severity: i.severity,
      priorityScore: i.priorityScore,
      title: i.title,
      confidence: i.confidence,
    })),
    insightsWritten: produced.length,
  };
}
