/**
 * Início do OAuth de dados de uma fonte (bloco B1 · generalizado no G1).
 *
 * `/api/oauth/<provider>/start` — resolve o conector pelo segmento dinâmico,
 * monta a URL de consentimento com um `state` assinado e redireciona.
 * Hoje só `ga4` está implementado; os outros providers respondem 404.
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
  _req: Request,
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
  const url = getConnector(provider).buildAuthUrl({
    state,
    redirectUri: redirectUriFor(provider),
  });

  return NextResponse.redirect(url);
}
