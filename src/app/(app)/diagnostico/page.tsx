import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { DiagnosticoPaidMedia } from "@/components/diagnostico-paid-media";
import { DiagnosticoSources } from "@/components/diagnostico-sources";
import { DiagnosticoSummary } from "@/components/diagnostico-summary";
import { InsightCard } from "@/components/insight-card";
import { PageHeader as Header } from "@/components/page-header";
import { EmptyState, PartialState } from "@/components/states";
import { SupportMetrics } from "@/components/support-metrics";
import { buttonVariants } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import type { AnalysisMeta, AnalysisWindow, Insight } from "@/lib/insight";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth";

import { getDiagnostico } from "./data";

export const metadata = { title: "Diagnóstico — The Seed" };

const SUPPRESS_LABEL: Record<string, string> = {
  traffic: "tráfego",
  conversion: "conversão",
  attribution: "atribuição",
};

function PageHeader({ demo }: { demo?: boolean }) {
  return (
    <Header
      title="Diagnóstico"
      badge={
        demo ? (
          <span className="rounded-full bg-warning-subtle px-2 py-0.5 font-sans text-xs font-medium text-warning">
            DEMONSTRAÇÃO
          </span>
        ) : null
      }
      description="Onde está o gargalo, o que mudou e o que investigar primeiro."
    />
  );
}

/**
 * Aviso do modo demonstração (`USE_MOCK=true`). Os números do conjunto de exemplo NÃO vêm
 * das fontes do workspace — a tela diz isso por extenso e enquadra o conteúdo fictício.
 */
function DemoBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-2xl border border-warning-border bg-warning-subtle px-5 py-4 text-sm"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium text-foreground">
          Modo demonstração — os dados do quadro abaixo são fictícios.
        </p>
        <p className="text-muted-foreground">
          Eles não vêm do GA4, do Google Ads, do Meta Ads nem do RD Station deste workspace: servem
          só para ver como a tela funciona. As fontes de dados, mais abaixo, mostram o estado real.
          Para ver o diagnóstico real, desligue o modo demonstração (<code>USE_MOCK=false</code>).
        </p>
      </div>
    </div>
  );
}

function DemoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative space-y-8 rounded-3xl border border-dashed border-warning-border p-5 pt-7">
      <span className="absolute -top-3 left-5 rounded-full border border-warning-border bg-background px-2 py-0.5 text-xs font-medium text-warning">
        DEMONSTRAÇÃO — dados fictícios
      </span>
      {children}
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
      <h2 className="font-heading text-heading">
        {title}
        {insights.length > 0 ? (
          <span className="ml-2 font-sans text-sm text-muted-foreground tabular-nums">
            {insights.length}
          </span>
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
      <h2 className="font-heading text-heading">
        Diagnóstico de tendência
      </h2>
      <div className="rounded-2xl border bg-card p-5 text-sm">
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

  // Costura real ↔ vazio ↔ demonstração, decidida no servidor. Ver ./data.ts.
  const view = await getDiagnostico(workspaceId);
  const { data } = view;

  // Nada para analisar ainda: explica POR QUÊ, diz o que fazer e mostra o que já existe.
  if (view.mode === "empty" && view.empty) {
    const { empty } = view;
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PageHeader />
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={
            empty.action ? (
              <Link
                href={empty.action.href}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                {empty.action.label}
              </Link>
            ) : undefined
          }
        />
        <DiagnosticoPaidMedia snapshots={view.paidMedia} />
        <DiagnosticoSources sources={view.sources} />
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

  const content = (
    <>
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
          <h2 className="font-heading text-heading">
            Descartados
            <span className="ml-2 font-sans text-sm text-muted-foreground tabular-nums">
              {dismissed.length}
            </span>
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
        <h2 className="font-heading text-heading">
          Métricas de apoio
        </h2>
        <p className="text-xs text-muted-foreground">
          Camada de contexto — não é o foco do produto.
        </p>
        <SupportMetrics metrics={data.supportMetrics} />
      </section>
    </>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader demo={view.mode === "demo"} />

      {view.mode === "demo" ? (
        <>
          <DemoBanner />
          <DemoFrame>{content}</DemoFrame>
        </>
      ) : (
        content
      )}

      <DiagnosticoPaidMedia snapshots={view.paidMedia} />
      <DiagnosticoSources sources={view.sources} />
    </div>
  );
}
