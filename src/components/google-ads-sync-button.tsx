"use client";

/**
 * Botão "Importar dados" do Google Ads (bloco G3). Espelha o `SyncButton` do
 * GA4: roda o sync inline via server action, com estado de progresso e o
 * resultado (linhas gravadas / lidas ou erro).
 */
import { useState, useTransition } from "react";

import { importarDadosGoogleAds } from "@/app/(app)/conexoes/actions";
import { Button } from "@/components/ui/button";

interface SyncOutcome {
  status: "success" | "partial" | "failed";
  rowsIn: number;
  rowsWritten: number;
  periodStart: string;
  periodEnd: string;
  error: string | null;
}

export function GoogleAdsSyncButton({ disabled }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      <Button
        size="sm"
        disabled={disabled || pending}
        onClick={() => {
          setError(null);
          setOutcome(null);
          startTransition(async () => {
            try {
              setOutcome(await importarDadosGoogleAds());
            } catch (e) {
              setError(e instanceof Error ? e.message : "Falha ao importar.");
            }
          });
        }}
      >
        {pending ? "Importando…" : "Importar dados"}
      </Button>

      {pending ? (
        <p className="text-xs text-muted-foreground">
          Importando do Google Ads — pode levar até 1 min.
        </p>
      ) : null}

      {outcome && outcome.status !== "failed" ? (
        <p className="text-xs text-emerald-700">
          {outcome.status === "partial"
            ? "Parcial (teto de linhas atingido): "
            : "Concluído: "}
          {outcome.rowsWritten} linha(s) gravada(s), {outcome.rowsIn} lida(s) ·{" "}
          {outcome.periodStart} a {outcome.periodEnd}
        </p>
      ) : null}

      {error || outcome?.status === "failed" ? (
        <p className="text-xs text-red-700">Erro: {error ?? outcome?.error}</p>
      ) : null}
    </div>
  );
}
