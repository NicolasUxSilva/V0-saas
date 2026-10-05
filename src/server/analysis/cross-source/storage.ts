/**
 * Persistência do Cross-source — a parte PURA: insight ↔ linha, hash de conteúdo e
 * plano de substituição do conjunto. Nada aqui toca o banco (o acesso fica em
 * `../cross-source-store.ts`); por isso tudo é testável sem Postgres.
 *
 * Modelo (espelha os dois padrões que o projeto já usa — não é um estilo novo):
 *  - identidade = `(workspace, período ANALISADO, dedupeKey)` — como `insights` usa
 *    `(workspace, dedupe_key)` e as fact tables usam uma chave natural;
 *  - conteúdo versionado por `contentHash` — como as fact tables usam `source_hash`;
 *  - regenerar = SUBSTITUIR o conjunto do (workspace, período): upsert do que foi
 *    produzido e remoção do que deixou de ser produzido (INV-15, "recompute total +
 *    upsert") — sem duplicata e sem sobra de um tipo que não vale mais.
 */
import { createHash } from "node:crypto";

import type {
  CrossSourceEvidencePoint,
  CrossSourceInsight,
  CrossSourceInsightType,
  CrossSourcePeriod,
  CrossSourceSource,
  CrossSourceStatement,
} from "./types";

/** Versão do FORMATO persistido (`statements`/`evidence`). Sobe quando o shape muda. */
export const CROSS_SOURCE_SCHEMA_VERSION = 1;

/** Uma linha de `cross_source_insights`, sem os campos que o banco administra (`id`, datas). */
export interface StoredCrossSourceRow {
  workspaceId: string;
  /** período ANALISADO — a chave do conjunto; é o que `getCrossSourceInsights` filtra */
  periodStart: string;
  periodEnd: string;
  dedupeKey: string;
  type: CrossSourceInsightType;
  category: CrossSourceInsight["category"];
  /** ordem canônica do insight dentro do conjunto (0..n−1) */
  position: number;
  title: string;
  /** período em que ESTE insight vale — igual ao analisado, exceto em fontes desalinhadas */
  insightPeriodStart: string;
  insightPeriodEnd: string;
  sources: CrossSourceSource[];
  statements: CrossSourceStatement[];
  evidence: CrossSourceEvidencePoint[];
  contentHash: string;
  schemaVersion: number;
}

/** JSON com chaves em ordem alfabética, recursivamente — o mesmo valor gera sempre a mesma string. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Hash do CONTEÚDO do insight (não da posição nem do período analisado). Usa JSON
 * canônico: jsonb não preserva a ordem das chaves, e o hash de um insight lido de
 * volta do banco tem de ser o mesmo do que foi gravado.
 */
export function contentHash(insight: CrossSourceInsight): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        type: insight.type,
        category: insight.category,
        title: insight.title,
        periodStart: insight.periodStart,
        periodEnd: insight.periodEnd,
        sources: insight.sources,
        statements: insight.statements,
        evidence: insight.evidence,
      }),
    )
    .digest("hex");
}

/** Insights (já na ordem canônica) → linhas do conjunto `(workspace, período analisado)`. */
export function toStoredRows(
  workspaceId: string,
  period: CrossSourcePeriod,
  insights: CrossSourceInsight[],
): StoredCrossSourceRow[] {
  return insights.map((i, position) => ({
    workspaceId,
    periodStart: period.start,
    periodEnd: period.end,
    dedupeKey: i.dedupeKey,
    type: i.type,
    category: i.category,
    position,
    title: i.title,
    insightPeriodStart: i.periodStart,
    insightPeriodEnd: i.periodEnd,
    sources: i.sources,
    statements: i.statements,
    evidence: i.evidence,
    contentHash: contentHash(i),
    schemaVersion: CROSS_SOURCE_SCHEMA_VERSION,
  }));
}

/** Linhas → insights, na ordem canônica (`position`), sem recalcular nada. */
export function fromStoredRows(rows: StoredCrossSourceRow[]): CrossSourceInsight[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      dedupeKey: r.dedupeKey,
      type: r.type,
      category: r.category,
      title: r.title,
      periodStart: r.insightPeriodStart,
      periodEnd: r.insightPeriodEnd,
      sources: r.sources,
      statements: r.statements,
      evidence: r.evidence,
    }));
}

/** O que a substituição do conjunto fez, por `dedupeKey`. */
export interface ReplacePlan {
  /** produzidos e ainda inexistentes */
  inserted: string[];
  /** já existiam e o conteúdo mudou */
  updated: string[];
  /** já existiam com exatamente o mesmo conteúdo */
  unchanged: string[];
  /** existiam e NÃO foram mais produzidos — saem do conjunto */
  removed: string[];
}

export interface ReplaceSummary {
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
}

/** Compara o conjunto atual do banco com o que acabou de ser produzido. Pura. */
export function planReplace(
  existing: { dedupeKey: string; contentHash: string }[],
  desired: Pick<StoredCrossSourceRow, "dedupeKey" | "contentHash">[],
): ReplacePlan {
  const before = new Map(existing.map((r) => [r.dedupeKey, r.contentHash]));
  const wanted = new Set(desired.map((r) => r.dedupeKey));

  const plan: ReplacePlan = { inserted: [], updated: [], unchanged: [], removed: [] };
  for (const row of desired) {
    const previous = before.get(row.dedupeKey);
    if (previous === undefined) plan.inserted.push(row.dedupeKey);
    else if (previous === row.contentHash) plan.unchanged.push(row.dedupeKey);
    else plan.updated.push(row.dedupeKey);
  }
  for (const key of before.keys()) if (!wanted.has(key)) plan.removed.push(key);
  return plan;
}

export const summarizePlan = (plan: ReplacePlan): ReplaceSummary => ({
  inserted: plan.inserted.length,
  updated: plan.updated.length,
  unchanged: plan.unchanged.length,
  removed: plan.removed.length,
});
