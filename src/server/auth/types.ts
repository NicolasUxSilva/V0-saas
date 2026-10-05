/**
 * Augmentação de tipos do Auth.js.
 *
 * O import de `next-auth/jwt` é necessário: sem ele, o TS não reconhece o
 * submódulo como alvo válido de `declare module` (TS2664).
 */
import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";

export type Role = "owner" | "admin" | "analyst" | "viewer";

declare module "next-auth" {
  interface Session {
    workspaceId: string;
    role: Role;
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    wsId: string;
    role: Role;
  }
}

// Reexport para "usar" o import e ancorar o módulo augmentado.
export type { JWT };
