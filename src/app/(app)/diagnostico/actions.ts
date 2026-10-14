"use server";

/**
 * Feedback de insight na tela Diagnóstico (bloco C5 · ajustes D1).
 *
 *  - acknowledgeInsight / reopenInsight / dismissInsight → `insights.status`
 *  - rateInsight                                         → `insights.rating` (+1 / −1 / null)
 *
 * A identidade é o `dedupe_key` (estável entre análises), NÃO o `insights.id`
 * (recriável). Toda ação é escopada pelo workspace da sessão. `revalidatePath`
 * re-renderiza a tela com o estado do banco.
 *
 * Modo demonstração (`USE_MOCK=true`): os insights na tela são FICTÍCIOS, então nenhuma
 * ação grava nada — senão um clique num cartão de exemplo poderia alterar um insight real
 * de mesma chave.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { env } from "@/env";
import type { InsightRating } from "@/lib/insight";
import { requireWorkspace } from "@/server/auth";
import { db } from "@/server/db";
import { insights } from "@/server/db/schema";

type InsightStatus = "open" | "acknowledged" | "dismissed";

async function setInsightStatus(
  dedupeKey: string,
  status: InsightStatus,
): Promise<void> {
  const { workspaceId } = await requireWorkspace();
  if (env.USE_MOCK) return;
  await db
    .update(insights)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(insights.workspaceId, workspaceId),
        eq(insights.dedupeKey, dedupeKey),
      ),
    );
  revalidatePath("/diagnostico");
}

export async function acknowledgeInsight(dedupeKey: string): Promise<void> {
  await setInsightStatus(dedupeKey, "acknowledged");
}

export async function reopenInsight(dedupeKey: string): Promise<void> {
  await setInsightStatus(dedupeKey, "open");
}

export async function dismissInsight(dedupeKey: string): Promise<void> {
  await setInsightStatus(dedupeKey, "dismissed");
}

export async function rateInsight(
  dedupeKey: string,
  rating: InsightRating,
): Promise<void> {
  if (rating !== 1 && rating !== -1 && rating !== null) {
    throw new Error("Avaliação inválida.");
  }
  const { workspaceId } = await requireWorkspace();
  if (env.USE_MOCK) return;
  await db
    .update(insights)
    .set({ rating, updatedAt: new Date() })
    .where(
      and(
        eq(insights.workspaceId, workspaceId),
        eq(insights.dedupeKey, dedupeKey),
      ),
    );
  revalidatePath("/diagnostico");
}
