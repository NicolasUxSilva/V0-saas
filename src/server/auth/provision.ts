/**
 * Provisionamento de usuário + workspace no primeiro login (bloco A2).
 *
 * Idempotente: chamado a cada login. Faz upsert do usuário (mantém nome/imagem
 * do Google atualizados) e garante que ele tenha exatamente um workspace com
 * papel `owner`. Sem convites, sem troca de workspace — isso é V1.
 *
 * Não importa nada de `./index` (evita ciclo: index -> config -> provision).
 */
import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { users, workspaceMembers, workspaces } from "@/server/db/schema";

type Role = "owner" | "admin" | "analyst" | "viewer";

export interface UserWorkspace {
  userId: string;
  workspaceId: string;
  role: Role;
}

function deriveWorkspaceName(name: string | null, email: string): string {
  const who = name?.trim() || email.split("@")[0] || "conta";
  return `Workspace de ${who}`;
}

export async function ensureUserAndWorkspace(input: {
  email: string;
  name: string | null;
  image: string | null;
}): Promise<UserWorkspace> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, name: input.name, image: input.image })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: input.name, image: input.image },
      })
      .returning();
    if (!user) throw new Error("provision: falha ao criar/atualizar usuário");

    const [membership] = await tx
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
      .limit(1);

    if (membership) {
      return {
        userId: user.id,
        workspaceId: membership.workspaceId,
        role: membership.role,
      };
    }

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: deriveWorkspaceName(input.name, input.email) })
      .returning();
    if (!workspace) throw new Error("provision: falha ao criar workspace");

    const [created] = await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
      .returning();
    if (!created) throw new Error("provision: falha ao criar associação");

    return { userId: user.id, workspaceId: workspace.id, role: created.role };
  });
}
