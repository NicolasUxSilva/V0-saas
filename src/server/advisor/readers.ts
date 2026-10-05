/**
 * Leituras de banco do Advisor — SOMENTE LEITURA.
 *
 * O Advisor lê duas saídas já calculadas: o diagnóstico do motor (`insights`) e o
 * Cross-source persistido. O Cross-source em si entra por
 * `getCrossSourceInsights` (a porta oficial, em `analysis/cross-source-store.ts`) —
 * o que está AQUI é só o que essa porta não cobre:
 *
 *   • `diagnostics`          — as linhas de `insights` abertas ou reconhecidas;
 *   • `crossSourcePeriods`   — QUAIS períodos têm Cross-source gerado (só metadado:
 *                              datas, instante da geração e quantidade), para a tela
 *                              oferecer períodos que existem em vez de adivinhar.
 *
 * Este é o ÚNICO arquivo do Advisor que fala com o banco. Não há `insert`, `update`
 * nem `delete` aqui (travado por teste), e nenhuma fact table é tocada (INV-5):
 * `fact_*` e `raw_records` continuam lidas só por `analysis/context.ts`. Os campos
 * internos de `insights` (id, sync_run, avaliação do usuário, gate trace) nunca
 * saem daqui.
 *
 * `executor` é o `db` (padrão) ou uma conexão somente-leitura — o teste de
 * integração e a verificação real passam uma com `default_transaction_read_only`.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { crossSourceInsights, insights } from "@/server/db/schema";

import type { InsightEvidence, InsightImpact } from "../analysis/types";

import type { AdvisorDiagnosticItem } from "./types";

type InsightRow = typeof insights.$inferSelect;

/** Linha de `insights` → o que o Advisor recebe. Os campos jsonb voltam como `unknown`: a forma é a do motor (`types.ts`). */
export function rowToDiagnosticItem(row: InsightRow): AdvisorDiagnosticItem {
  return {
    dedupeKey: row.dedupeKey,
    detector: row.detector,
    kind: row.kind,
    severity: row.severity,
    status: row.status === "acknowledged" ? "acknowledged" : "open",
    title: row.title,
    explanation: row.explanation,
    hypothesis: row.hypothesis,
    recommendedAction: row.recommendedAction,
    confidence: row.confidence,
    // o motor grava `confidenceBasis` (string) dentro da coluna jsonb
    confidenceBasis:
      typeof row.confidenceBasisJson === "string"
        ? row.confidenceBasisJson
        : String(row.confidenceBasisJson ?? ""),
    impact: (row.impactJson as InsightImpact | null) ?? null,
    evidence: row.evidenceJson as InsightEvidence,
    period: { start: row.periodStart, end: row.periodEnd },
    comparedTo: row.comparedTo ?? null,
    priorityScore: row.priorityScore,
  };
}

export interface CrossSourcePeriodInfo {
  start: string;
  end: string;
  /** quando o conjunto foi gerado (ISO) */
  generatedAt: string;
  insightCount: number;
}

export interface AdvisorReaders {
  /** Insights `open`/`acknowledged` do workspace, do mais ao menos prioritário. `dismissed` fica de fora. */
  diagnostics(workspaceId: string): Promise<AdvisorDiagnosticItem[]>;
  /** Períodos com Cross-source gerado, do mais recente ao mais antigo. */
  crossSourcePeriods(workspaceId: string): Promise<CrossSourcePeriodInfo[]>;
}

export function createAdvisorReaders(executor: typeof db = db): AdvisorReaders {
  return {
    async diagnostics(workspaceId) {
      const rows = await executor
        .select()
        .from(insights)
        .where(
          and(
            eq(insights.workspaceId, workspaceId),
            inArray(insights.status, ["open", "acknowledged"]),
          ),
        )
        // `dedupeKey` desempata: a ordem é sempre a mesma para os mesmos dados
        .orderBy(desc(insights.priorityScore), asc(insights.dedupeKey));
      return rows.map(rowToDiagnosticItem);
    },

    async crossSourcePeriods(workspaceId) {
      const rows = await executor
        .select({
          start: crossSourceInsights.periodStart,
          end: crossSourceInsights.periodEnd,
          // `mapWith` devolve o mesmo tipo da coluna (Date), não a string crua do driver
          generatedAt: sql`max(${crossSourceInsights.generatedAt})`.mapWith(
            crossSourceInsights.generatedAt,
          ),
          insightCount: sql<number>`count(*)::int`,
        })
        .from(crossSourceInsights)
        .where(eq(crossSourceInsights.workspaceId, workspaceId))
        .groupBy(crossSourceInsights.periodStart, crossSourceInsights.periodEnd)
        .orderBy(desc(crossSourceInsights.periodEnd), desc(crossSourceInsights.periodStart));

      return rows.map((r) => ({
        start: r.start,
        end: r.end,
        generatedAt: r.generatedAt.toISOString(),
        insightCount: r.insightCount,
      }));
    },
  };
}

/** Leitores de produção — o `db` padrão. */
export const defaultReaders: AdvisorReaders = createAdvisorReaders();
