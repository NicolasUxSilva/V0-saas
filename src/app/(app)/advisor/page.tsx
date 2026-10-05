import { Sparkles } from "lucide-react";

import { AdvisorWorkspace } from "@/components/advisor/advisor-workspace";
import { EmptyState } from "@/components/states";
import { ADVISOR_SUGGESTIONS } from "@/server/advisor/intents";
import { isAdvisorEnabled } from "@/server/advisor/flag";
import { advisorLlmStatus } from "@/server/advisor/llm/config";
import { defaultReaders } from "@/server/advisor/readers";
import { requireWorkspace } from "@/server/auth";

export const metadata = { title: "Advisor — v0-saas" };

function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Advisor</h1>
      <p className="text-sm text-muted-foreground">
        Interpreta o diagnóstico e o Cross-source já calculados. A IA interpreta; o sistema
        calcula.
      </p>
    </div>
  );
}

export default async function AdvisorPage() {
  const { workspaceId } = await requireWorkspace();

  // INV-8: o produto funciona 100% sem o Advisor — desligado, só esta tela muda
  if (!isAdvisorEnabled()) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PageHeader />
        <EmptyState
          icon={Sparkles}
          title="O Advisor está desativado"
          description="O Diagnóstico e as Conexões continuam funcionando normalmente."
        />
      </div>
    );
  }

  // só metadado: quais períodos já têm Cross-source gerado (o Advisor nunca gera um)
  const periods = await defaultReaders.crossSourcePeriods(workspaceId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader />
      <AdvisorWorkspace
        periods={periods.map((p) => ({ start: p.start, end: p.end, generatedAt: p.generatedAt }))}
        suggestions={ADVISOR_SUGGESTIONS}
        llm={advisorLlmStatus()}
      />
    </div>
  );
}
