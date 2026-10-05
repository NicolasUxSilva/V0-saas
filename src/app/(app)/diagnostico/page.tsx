import Link from "next/link";

import { DiagnosticoSummary } from "@/components/diagnostico-summary";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PartialState } from "@/components/states";
import { SupportMetrics } from "@/components/support-metrics";
import { buttonVariants } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import type { AnalysisMeta, AnalysisWindow, Insight } from "@/lib/insight";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth";

import { getDiagnostico } from "./data";

export const metadata = { title: "Diagnóstico — v0-saas" };

const SUPPRESS_LABEL: Record<string, string> = {
  traffic: "tráfego",
  conversion: "conversão",
  attribution: "atribuição",
};

function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Diagnóstico</h1>
      <p className="text-sm text-muted-foreground">
        Onde está o gargalo, o que mudou e o que investigar primeiro.
      </p>
    </div>
  );
}

function Section({
  title,
  insights,
  emptyHint,
}: {
  title: string;
  insights: Insight[];
  emptyHint: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        {insights.length > 0 ? (
          <span className="text-foreground"> · {insights.length}</span>
        ) : null}
      </h2>
      {insights.length > 0 ? (
        <div className="space-y-4">
          {insights.map((i) => (
            <InsightCard
              key={`${i.dedupeKey}:${i.status}:${i.rating}`}
              insight={i}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      )}
    </section>
  );
}

/**
 * Estado honesto (plano §8): o motor rodou e nenhuma variação de tráfego ou
 * conversão passou pelos gates. Mostra os números em vez de silêncio.
 */
function HonestState({
  analysis,
  window: w,
}: {
  analysis: AnalysisMeta;
  window: AnalysisWindow;
}) {
  const suppressed = analysis.suppressed
    .map((s) => SUPPRESS_LABEL[s] ?? s)
    .join(", ");
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Diagnóstico de tendência
      </h2>
      <div className="rounded-lg border bg-muted/20 p-4 text-sm">
        <p className="font-medium text-foreground">
          Nenhuma variação estatisticamente relevante no período.
        </p>
        <p className="mt-1 text-muted-foreground">
          O motor comparou os 28 dias até {w.end} com os {w.comparedTo}. Nenhuma
          queda de tráfego ou de conversão passou pelos gates de volume,
          significância e materialidade.
        </p>
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          <li>
            Cobertura: {analysis.coverageDistinctDates}/{analysis.expectedDays}{" "}
            dias com dados no histórico
          </li>
          <li>
            Janela atual: {analysis.currentDaysWithData}/{analysis.windowDays}{" "}
            dias · anterior: {analysis.previousDaysWithData}/
            {analysis.windowDays} dias
          </li>
          <li>
            Key events no intervalo: {formatCount(analysis.totalKeyEvents)}
          </li>
          {suppressed ? (
            <li>Famílias suprimidas por qualidade de dados: {suppressed}</li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}

export default async function DiagnosticoPage() {
  const { workspaceId } = await requireWorkspace();

  // Costura mock ↔ real (respeita USE_MOCK). Ver ./data.ts.
  const data = await getDiagnostico(workspaceId);

  // Sem nenhuma métrica nem insight → não há dados sincronizados ainda.
  if (data.supportMetrics.length === 0 && data.insights.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PageHeader />
        <EmptyState
          title="Nenhum diagnóstico ainda"
          description="Conecte uma propriedade do GA4 e rode uma sincronização para gerar o primeiro diagnóstico."
          action={
            <Link
              href="/conexoes"
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Ir para Conexões
            </Link>
          }
        />
      </div>
    );
  }

  const open = data.insights.filter((i) => i.status !== "dismissed");
  const dismissed = data.insights.filter((i) => i.status === "dismissed");
  const dataQuality = open.filter((i) => i.kind === "data_quality");
  const critical = open.filter(
    (i) => i.kind === "problem" && i.severity === "critical",
  );
  const attention = open.filter(
    (i) => i.kind === "problem" && i.severity === "attention",
  );
  const opportunities = open.filter((i) => i.kind === "opportunity");

  // Sem insight de tendência + análise real disponível → estado honesto.
  const showHonestState =
    critical.length + attention.length + opportunities.length === 0 &&
    data.analysis != null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader />

      <DiagnosticoSummary data={data} />

      {data.lastSyncStatus === "partial" ? (
        <PartialState description="A última sincronização atingiu o limite de linhas — alguns dias do período podem estar incompletos. Rode 'Atualizar dados' de novo em Conexões." />
      ) : null}

      {dataQuality.length > 0 ? (
        <Section title="Qualidade dos dados" insights={dataQuality} emptyHint="" />
      ) : null}

      {showHonestState ? (
        <HonestState analysis={data.analysis!} window={data.window} />
      ) : (
        <>
          <Section
            title="Problemas críticos"
            insights={critical}
            emptyHint="Nenhum problema crítico no período."
          />
          <Section
            title="Pontos de atenção"
            insights={attention}
            emptyHint="Nenhum ponto de atenção no período."
          />
          <Section
            title="Oportunidades"
            insights={opportunities}
            emptyHint="Nenhuma oportunidade identificada no período."
          />
        </>
      )}

      {dismissed.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Descartados
            <span className="text-foreground"> · {dismissed.length}</span>
          </h2>
          <div className="space-y-2">
            {dismissed.map((i) => (
              <InsightCard
                key={`${i.dedupeKey}:${i.status}:${i.rating}`}
                insight={i}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Métricas de apoio
        </h2>
        <p className="text-xs text-muted-foreground">
          Camada de contexto — não é o foco do produto.
        </p>
        <SupportMetrics metrics={data.supportMetrics} />
      </section>
    </div>
  );
}
