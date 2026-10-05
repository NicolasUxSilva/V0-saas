"use client";

/**
 * Botão "Importar dados" compartilhado pelos dois produtos RD Station
 * (bloco RD-1). Mesma forma do `GoogleAdsSyncButton`/`SyncButton` (roda o sync
 * inline via server action, com estado de progresso e resultado) — um
 * componente só porque RD Station Marketing e RD Station CRM usam exatamente
 * o mesmo `SyncResult` genérico e não têm seletor de conta (diferente do
 * Google Ads, que tem conta a escolher antes de poder sincronizar).
 */
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { SyncResult } from "@/server/sync/run-sync";

export function RdStationSyncButton({
  runImport,
  productLabel,
  disabled,
}: {
  runImport: () => Promise<SyncResult>;
  productLabel: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<SyncResult | null>(null);
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
              setOutcome(await runImport());
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
          Importando do {productLabel} — pode levar alguns segundos.
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
