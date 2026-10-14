/**
 * "Fontes de dados" da tela Diagnóstico: o estado REAL de cada fonte (conectada ou não,
 * com conta escolhida ou não, até que dia vão os dados) e a próxima ação. É o que torna a
 * tela útil antes da primeira importação e quando uma fonte está desconectada. Não
 * depende de `USE_MOCK`: nada aqui é demonstração.
 */
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import type { SourceHealth, SourceStatus } from "@/lib/insight";
import { cn } from "@/lib/utils";

const ATTENTION: ReadonlySet<SourceHealth> = new Set([
  "needs_reauth",
  "error",
  "sync_failed",
  "no_account",
  "no_data",
]);

function Icon({ health }: { health: SourceHealth }) {
  if (health === "synced") return <CircleCheck className="size-4 text-emerald-600" aria-hidden />;
  if (ATTENTION.has(health)) return <CircleAlert className="size-4 text-amber-600" aria-hidden />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-hidden />;
}

const BR = (iso: string) => iso.split("-").reverse().join("/");

export function DiagnosticoSources({ sources }: { sources: SourceStatus[] }) {
  return (
    <section className="space-y-3" aria-label="Fontes de dados">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Fontes de dados
      </h2>
      <p className="text-xs text-muted-foreground">
        O estado real de cada fonte neste workspace — e o que cada uma alimenta.
      </p>
      <ul className="divide-y rounded-lg border">
        {sources.map((s) => (
          <li key={s.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
            <span className="mt-0.5">
              <Icon health={s.health} />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-sm text-muted-foreground">{s.summary}</div>
              {s.notice ? <div className="text-xs text-amber-700">{s.notice}</div> : null}
              <div className="text-xs text-muted-foreground">
                Alimenta {s.feeds}.
                {s.coverage ? ` Dados de ${BR(s.coverage.first)} a ${BR(s.coverage.last)}.` : ""}
              </div>
            </div>
            {s.action ? (
              <Link
                href={s.action.href}
                className={cn(
                  buttonVariants({
                    variant: ATTENTION.has(s.health) || s.health === "never_synced" ? "default" : "outline",
                    size: "sm",
                  }),
                )}
              >
                {s.action.label}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
