"use client";

/**
 * Error boundary do segmento `(app)` (bloco D0). Captura falhas de render/carga
 * em Diagnóstico, Conexões etc. `reset()` re-renderiza o segmento (o "tentar de
 * novo" do `ErrorState`).
 */
import { useEffect } from "react";

import { ErrorState } from "@/components/states";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl">
      <ErrorState
        description="Não foi possível carregar esta tela. Tente de novo; se persistir, verifique a conexão com o GA4 em Conexões."
        onRetry={reset}
      />
    </div>
  );
}
