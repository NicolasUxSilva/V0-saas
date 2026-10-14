/**
 * Início do OAuth de dados de uma fonte (bloco B1 · generalizado no G1).
 *
 * `/api/oauth/<provider>/start` — resolve o conector pelo segmento dinâmico,
 * monta a URL de consentimento com um `state` assinado e redireciona.
 * Provider desconhecido ou não implementado responde 404; credenciais do app ausentes
 * neste ambiente voltam para /conexoes com `<provider>_error=not_configured`.
 */
import { NextResponse } from "next/server";

import { env } from "@/env";
import { requireWorkspace } from "@/server/auth";
import { PROVIDERS, getConnector, isImplemented } from "@/server/connectors/registry";
import { signOAuthState } from "@/server/connectors/shared/oauth-state";
import type { Provider } from "@/server/connectors/types";

function isKnownProvider(v: string): v is Provider {
  return (PROVIDERS as string[]).includes(v);
}

function redirectUriFor(provider: Provider): string {
  // GA4 usa a env dedicada (já cadastrada no OAuth Client do Google).
  if (provider === "ga4") return env.GA4_REDIRECT_URI;
  return `${env.AUTH_URL}/api/oauth/${provider}/callback`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (!isKnownProvider(provider) || !isImplemented(provider)) {
    return NextResponse.json(
      { error: `Provider não disponível: ${provider}` },
      { status: 404 },
    );
  }

  const { workspaceId } = await requireWorkspace(); // redireciona p/ /login se sem sessão

  const state = signOAuthState({ workspaceId });
  let url: string;
  try {
    url = getConnector(provider).buildAuthUrl({
      state,
      redirectUri: redirectUriFor(provider),
    });
  } catch {
    // credenciais do app ausentes neste ambiente (ex.: META_APP_ID): mensagem clara
    // na tela de Conexões em vez de uma página de erro
    const back = new URL("/conexoes", new URL(req.url).origin);
    back.searchParams.set(`${provider}_error`, "not_configured");
    return NextResponse.redirect(back, 303);
  }

  return NextResponse.redirect(url);
}
