/**
 * Cross-source — persistência e interface de leitura/geração (V1.1).
 *
 *   generateCrossSourceInsights(workspace, período)   ← ESCRITA
 *     buildAnalysisContext(workspace, período)         (o único leitor das fontes)
 *       → buildCrossSourceInsights(ctx)                (pura)
 *       → substitui o conjunto (workspace, período) em `cross_source_insights`
 *
 *   getCrossSourceInsights(workspace, período)        ← LEITURA
 *     lê SÓ `cross_source_insights` — não toca GA4/RD/CRM, não recalcula nada.
 *     É a porta de entrada do futuro Advisor.
 *
 * Este arquivo é uma fronteira de banco própria: lê/escreve apenas
 * `cross_source_insights` (a parte pura — linhas, hash, plano — está em
 * `./cross-source/storage`). Nenhuma fact table é lida aqui: quem lê as fontes
 * continua sendo `context.ts`. Nada neste arquivo é chamado pelo engine, pelo sync
 * ou pelo /diagnostico — a geração é sempre uma chamada explícita.
 *
 * Idempotência: a identidade de uma linha é `(workspace, período analisado,
 * dedupeKey)` (índice único). Regenerar o mesmo conjunto faz upsert do que foi
 * produzido e remove o que deixou de ser produzido, tudo numa transação — o mesmo
 * conjunto lógico, sem duplicata, com os `id`s estáveis.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { crossSourceInsights } from "@/server/db/schema";

import { buildAnalysisContext } from "./context";
import {
  CROSS_SOURCE_SCHEMA_VERSION,
  buildCrossSourceInsights,
  fromStoredRows,
  planReplace,
  summarizePlan,
  toStoredRows,
  type CrossSourceEvidencePoint,
  type CrossSourceInsight,
  type CrossSourcePeriod,
  type CrossSourceSource,
  type CrossSourceStatement,
  type ReplaceSummary,
  type StoredCrossSourceRow,
} from "./cross-source";
import { validateAnalysisPeriod } from "./period";
import type { AnalysisContext, AnalysisPeriodInput } from "./types";

// ─────────────────────────────────────────────────────────────────────
// Acesso à tabela (a única parte deste arquivo que fala SQL)
// ─────────────────────────────────────────────────────────────────────

export interface StoredRowWithMeta extends StoredCrossSourceRow {
  /** instante da geração que escreveu/confirmou a linha */
  generatedAt: Date;
}

export interface CrossSourceStore {
  /**
   * Substitui o conjunto `(workspace, período)`: upsert de `rows` e remoção do que
   * já estava lá e não está em `rows`. Atômico.
   */
  replaceSet(args: {
    workspaceId: string;
    period: CrossSourcePeriod;
    rows: StoredCrossSourceRow[];
    generatedAt: Date;
  }): Promise<ReplaceSummary>;
  /** Linhas do conjunto, em ordem canônica. Vazio = nunca gerado para este período. */
  list(workspaceId: string, period: CrossSourcePeriod): Promise<StoredRowWithMeta[]>;
}

/**
 * Implementação em Postgres. `executor` é o `db` (padrão) ou uma transação — os
 * testes de integração passam uma transação que sempre dá rollback.
 */
export function createCrossSourceStore(executor: typeof db = db): CrossSourceStore {
  const inSet = (workspaceId: string, period: CrossSourcePeriod) =>
    and(
      eq(crossSourceInsights.workspaceId, workspaceId),
      eq(crossSourceInsights.periodStart, period.start),
      eq(crossSourceInsights.periodEnd, period.end),
    );

  return {
    async replaceSet({ workspaceId, period, rows, generatedAt }) {
      return executor.transaction(async (tx) => {
        const existing = await tx
          .select({
            dedupeKey: crossSourceInsights.dedupeKey,
            contentHash: crossSourceInsights.contentHash,
          })
          .from(crossSourceInsights)
          .where(inSet(workspaceId, period));

        const plan = planReplace(existing, rows);

        // o que deixou de ser produzido sai do conjunto (um tipo que não vale mais)
        if (plan.removed.length > 0) {
          await tx
            .delete(crossSourceInsights)
            .where(
              and(
                inSet(workspaceId, period),
                inArray(crossSourceInsights.dedupeKey, plan.removed),
              ),
            );
        }

        // upsert do que foi produzido. `id`, a chave e `created_at` NÃO entram no SET:
        // a identidade da linha e a data da 1ª geração sobrevivem às regenerações.
        if (rows.length > 0) {
          await tx
            .insert(crossSourceInsights)
            .values(
              rows.map((r) => ({
                workspaceId: r.workspaceId,
                periodStart: r.periodStart,
                periodEnd: r.periodEnd,
                dedupeKey: r.dedupeKey,
                type: r.type,
                category: r.category,
                position: r.position,
                title: r.title,
                insightPeriodStart: r.insightPeriodStart,
                insightPeriodEnd: r.insightPeriodEnd,
                sourcesJson: r.sources,
                statementsJson: r.statements,
                evidenceJson: r.evidence,
                contentHash: r.contentHash,
                schemaVersion: r.schemaVersion,
                generatedAt,
              })),
            )
            .onConflictDoUpdate({
              target: [
                crossSourceInsights.workspaceId,
                crossSourceInsights.periodStart,
                crossSourceInsights.periodEnd,
                crossSourceInsights.dedupeKey,
              ],
              set: {
                type: sql`excluded.type`,
                category: sql`excluded.category`,
                position: sql`excluded.position`,
                title: sql`excluded.title`,
                insightPeriodStart: sql`excluded.insight_period_start`,
                insightPeriodEnd: sql`excluded.insight_period_end`,
                sourcesJson: sql`excluded.sources_json`,
                statementsJson: sql`excluded.statements_json`,
                evidenceJson: sql`excluded.evidence_json`,
                contentHash: sql`excluded.content_hash`,
                schemaVersion: sql`excluded.schema_version`,
                generatedAt: sql`excluded.generated_at`,
              },
            });
        }

        return summarizePlan(plan);
      });
    },

    async list(workspaceId, period) {
      const rows = await executor
        .select()
        .from(crossSourceInsights)
        .where(inSet(workspaceId, period))
        .orderBy(asc(crossSourceInsights.position));

      return rows.map((r) => ({
        workspaceId: r.workspaceId,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        dedupeKey: r.dedupeKey,
        type: r.type as StoredCrossSourceRow["type"],
        category: r.category as StoredCrossSourceRow["category"],
        position: r.position,
        title: r.title,
        insightPeriodStart: r.insightPeriodStart,
        insightPeriodEnd: r.insightPeriodEnd,
        sources: r.sourcesJson as CrossSourceSource[],
        statements: r.statementsJson as CrossSourceStatement[],
        evidence: r.evidenceJson as CrossSourceEvidencePoint[],
        contentHash: r.contentHash,
        schemaVersion: r.schemaVersion,
        generatedAt: r.generatedAt,
      }));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Interface para o futuro Advisor: gerar × ler
// ─────────────────────────────────────────────────────────────────────

/** O conjunto Cross-source de um (workspace, período), como está persistido. */
export interface StoredCrossSourceInsights {
  workspaceId: string;
  /** período ANALISADO */
  period: CrossSourcePeriod;
  /** instante da geração do conjunto (ISO); `null` = nunca gerado para este período */
  generatedAt: string | null;
  /** versão do formato persistido (`CROSS_SOURCE_SCHEMA_VERSION` quando foi escrito); `null` se vazio */
  schemaVersion: number | null;
  /** na ordem canônica, exatamente como `buildCrossSourceInsights` os produziu */
  insights: CrossSourceInsight[];
}

export interface GeneratedCrossSourceInsights extends StoredCrossSourceInsights {
  /** o que a geração fez com o conjunto: inseridos / atualizados / iguais / removidos */
  persisted: ReplaceSummary;
}

/** Dependências injetáveis — os padrões abaixo são os de produção; os testes trocam por fakes. */
export interface CrossSourceDeps {
  buildContext?: (
    workspaceId: string,
    period: AnalysisPeriodInput,
  ) => Promise<AnalysisContext | null>;
  store?: CrossSourceStore;
  now?: () => Date;
}

/**
 * GERA o Cross-source de um período e o persiste (substitui o conjunto).
 *
 * Só lê os dados já existentes no banco (via `buildAnalysisContext`): não dispara
 * sync, OAuth nem chamada externa. Devolve `null` quando não há contexto (o
 * workspace não tem nenhum dado de GA4) — nada é gravado nesse caso.
 * Lança `AnalysisPeriodError` para período inválido, antes de tocar em qualquer coisa.
 */
export async function generateCrossSourceInsights(
  workspaceId: string,
  period: AnalysisPeriodInput,
  deps: CrossSourceDeps = {},
): Promise<GeneratedCrossSourceInsights | null> {
  const { start, end } = validateAnalysisPeriod(period);
  const buildContext = deps.buildContext ?? buildAnalysisContext;
  const store = deps.store ?? createCrossSourceStore();
  const now = deps.now ?? (() => new Date());

  const ctx = await buildContext(workspaceId, period);
  if (!ctx) return null;

  const insights = buildCrossSourceInsights(ctx);
  const analysed = { start, end };
  const generatedAt = now();
  const persisted = await store.replaceSet({
    workspaceId,
    period: analysed,
    rows: toStoredRows(workspaceId, analysed, insights),
    generatedAt,
  });

  return {
    workspaceId,
    period: analysed,
    generatedAt: generatedAt.toISOString(),
    schemaVersion: CROSS_SOURCE_SCHEMA_VERSION,
    insights,
    persisted,
  };
}

/**
 * LÊ o Cross-source persistido de um período. Só consulta `cross_source_insights`:
 * não toca GA4/RD/CRM e não recalcula nenhuma métrica. Período nunca gerado →
 * `insights: []` e `generatedAt: null`.
 */
export async function getCrossSourceInsights(
  workspaceId: string,
  period: AnalysisPeriodInput,
  deps: Pick<CrossSourceDeps, "store"> = {},
): Promise<StoredCrossSourceInsights> {
  const { start, end } = validateAnalysisPeriod(period);
  const store = deps.store ?? createCrossSourceStore();

  const rows = await store.list(workspaceId, { start, end });
  const generatedAt = rows.reduce<Date | null>(
    (latest, r) => (latest === null || r.generatedAt > latest ? r.generatedAt : latest),
    null,
  );

  return {
    workspaceId,
    period: { start, end },
    generatedAt: generatedAt ? generatedAt.toISOString() : null,
    schemaVersion: rows[0]?.schemaVersion ?? null,
    insights: fromStoredRows(rows),
  };
}
