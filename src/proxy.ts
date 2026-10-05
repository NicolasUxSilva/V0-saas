/**
 * Proxy (antigo "middleware" — renomeado no Next 16). Runtime nodejs.
 *
 * Portão de rota: sem sessão -> manda para /login; com sessão em /login ->
 * manda para "/". A verificação real (defense-in-depth) também acontece no
 * layout de `(app)` via `requireWorkspace()`.
 *
 * Só verifica o JWT da sessão — não toca no banco.
 */
import { NextResponse } from "next/server";

import { auth } from "@/server/auth";

export const proxy = auth((req) => {
  const isAuthed = Boolean(req.auth?.user);
  const isLoginRoute = req.nextUrl.pathname === "/login";

  if (!isAuthed && !isLoginRoute) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
  if (isAuthed && isLoginRoute) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  // Roda em rotas de página; ignora API, assets do Next e arquivos com extensão.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
