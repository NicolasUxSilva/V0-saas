/**
 * Store em memória do Cross-source — o par de teste de `createCrossSourceStore`.
 *
 * Implementa o MESMO contrato (substituir o conjunto `(workspace, período)`; ler em
 * ordem canônica) com a mesma regra de identidade do índice único, e imita o que o
 * Postgres faz com `jsonb`: grava e devolve os JSONs com as chaves REORDENADAS, para
 * que nenhum teste dependa da ordem das chaves. O SQL de verdade é validado contra
 * um Postgres real no teste de integração opt-in (`cross-source-integration.test.ts`).
 */
import {
  canonicalJson,
  planReplace,
  summarizePlan,
  type StoredCrossSourceRow,
} from "@/server/analysis/cross-source";
import type { CrossSourceStore, StoredRowWithMeta } from "@/server/analysis/cross-source-store";

export interface MemoryRow extends StoredRowWithMeta {
  id: string;
  createdAt: Date;
}

/** jsonb: mesmo valor, chaves em outra ordem. */
const viaJsonb = <T>(value: T): T => JSON.parse(canonicalJson(value)) as T;

export function createMemoryStore() {
  const table = new Map<string, MemoryRow>();
  let sequence = 0;

  /** A chave do índice único: (workspace, período analisado, dedupe_key). */
  const keyOf = (r: Pick<StoredCrossSourceRow, "workspaceId" | "periodStart" | "periodEnd" | "dedupeKey">) =>
    [r.workspaceId, r.periodStart, r.periodEnd, r.dedupeKey].join("|");

  const inSet = (workspaceId: string, start: string, end: string) =>
    [...table.values()].filter(
      (r) => r.workspaceId === workspaceId && r.periodStart === start && r.periodEnd === end,
    );

  const store: CrossSourceStore = {
    async replaceSet({ workspaceId, period, rows, generatedAt }) {
      const plan = planReplace(inSet(workspaceId, period.start, period.end), rows);

      for (const dedupeKey of plan.removed) {
        table.delete(
          keyOf({ workspaceId, periodStart: period.start, periodEnd: period.end, dedupeKey }),
        );
      }
      for (const r of rows) {
        const key = keyOf(r);
        const previous = table.get(key);
        table.set(key, {
          ...r,
          sources: viaJsonb(r.sources),
          statements: viaJsonb(r.statements),
          evidence: viaJsonb(r.evidence),
          generatedAt,
          // identidade e data da 1ª geração sobrevivem às regenerações (o SET do SQL não os toca)
          id: previous?.id ?? `row-${++sequence}`,
          createdAt: previous?.createdAt ?? generatedAt,
        });
      }
      return summarizePlan(plan);
    },

    async list(workspaceId, period) {
      return inSet(workspaceId, period.start, period.end)
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          ...r,
          sources: viaJsonb(r.sources),
          statements: viaJsonb(r.statements),
          evidence: viaJsonb(r.evidence),
        }));
    },
  };

  return {
    store,
    /** todas as linhas, de todos os conjuntos — para contar duplicatas */
    rows: () => [...table.values()],
  };
}
