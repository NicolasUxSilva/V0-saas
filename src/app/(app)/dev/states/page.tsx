import Link from "next/link";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PartialState,
} from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth";

export const metadata = { title: "Estados (dev) — v0-saas" };

function Section({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{name}</h2>
      <div>{children}</div>
    </section>
  );
}

/**
 * Página de revisão (dev) dos quatro estados reutilizáveis do bloco A3.
 * Não faz parte do produto — some quando a UI real estiver validada.
 */
export default async function DevStatesPage() {
  await requireWorkspace();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Estados (revisão dev)
        </h1>
        <p className="text-sm text-muted-foreground">
          Os quatro estados que toda tela de dados usa.
        </p>
      </div>

      <Section name="LoadingState">
        <LoadingState rows={2} />
      </Section>

      <Section name="EmptyState">
        <EmptyState
          title="Nenhum diagnóstico ainda"
          description="Conecte uma propriedade do GA4 e sincronize os dados."
          action={
            <Link
              href="/conexoes"
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Ir para Conexões
            </Link>
          }
        />
      </Section>

      <Section name="ErrorState">
        <ErrorState description="A sincronização falhou ao consultar a API do GA4." />
      </Section>

      <Section name="PartialState">
        <PartialState
          description="Os últimos 2 dias ainda não estão consolidados no GA4."
          retryable
        />
      </Section>
    </div>
  );
}
