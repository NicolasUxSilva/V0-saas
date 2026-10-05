import { LoadingState } from "@/components/states";

/**
 * Loading do segmento `(app)` (bloco D0). O shell (sidebar/topbar) do layout
 * fica visível; só o conteúdo da rota mostra o esqueleto enquanto os Server
 * Components resolvem os dados.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto max-w-3xl">
      <LoadingState rows={4} />
    </div>
  );
}
