/**
 * Instância do Auth.js + helpers de sessão (bloco A2).
 */
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import { redirect } from "next/navigation";

import { db } from "@/server/db";
import { workspaces } from "@/server/db/schema";

import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** Sessão atual (ou null). Não redireciona. */
export function getSession() {
  return auth();
}

export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "analyst" | "viewer";
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

/**
 * Exige sessão com workspace resolvido. Redireciona para /login se não houver
 * sessão válida (ou se o workspace do token não existir mais). Usar em Server
 * Components / Server Actions das rotas protegidas.
 *
 * Faz uma leitura do nome do workspace no banco (fonte da verdade, não o token).
 */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const session = await auth();
  if (!session?.user?.id || !session.workspaceId) {
    redirect("/login");
  }

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, session.workspaceId))
    .limit(1);
  if (!workspace) {
    redirect("/login");
  }

  return {
    userId: session.user.id,
    workspaceId: session.workspaceId,
    workspaceName: workspace.name,
    role: session.role,
    user: session.user,
  };
}
