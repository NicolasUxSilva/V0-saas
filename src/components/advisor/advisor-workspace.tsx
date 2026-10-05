"use client";

/**
 * Área de trabalho do Advisor: período, sugestões, pergunta e resposta estruturada.
 *
 * O fluxo que esta tela valida é o do produto, de ponta a ponta:
 *   dados reais → AnalysisContext → análise determinística → Cross-source
 *   → AdvisorContext → Advisor (determinístico ou modelo de linguagem)
 *   → schema + guard → resposta fundamentada
 * Os botões chamam o server action `askAdvisor` com uma INTENÇÃO; o campo de texto é
 * a pergunta livre, que só ganha resposta de um modelo de linguagem quando
 * `ADVISOR_LLM_ENABLED` está ligado (senão o Advisor diz isso, sem inventar nada).
 *
 * Estados: carregando, vazio, erro, resposta e fallback (o aviso é do visualizador da
 * resposta). Nada aqui calcula um número — a tela só desenha o que o `AdvisorResponse` traz.
 */
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

import { askAdvisor } from "@/app/(app)/advisor/actions";
import type { AskAdvisorResult } from "@/app/(app)/advisor/types";
import { AdvisorResponseView } from "@/components/advisor/response-view";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { previousPeriod } from "@/lib/advisor-period";
import { cn } from "@/lib/utils";
import type { AdvisorIntent, AdvisorSuggestion } from "@/server/advisor/intents";
import type { AdvisorLlmStatus } from "@/server/advisor/types";

export interface AvailablePeriod {
  start: string;
  end: string;
  /** quando o Cross-source do período foi gerado (ISO) */
  generatedAt: string;
}

const br = (iso: string) => iso.split("-").reverse().join("/");

// data fixa, com fuso explícito: igual no servidor e no cliente (tempo relativo divergiria na hidratação)
const generatedFmt = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const inputClass =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Uma linha sob o campo de pergunta: o que responde a pergunta livre neste ambiente. */
const LLM_HINT: Record<AdvisorLlmStatus, string> = {
  ready:
    "Perguntas livres são respondidas por um modelo de linguagem que só vê os dados já calculados. Toda resposta passa por validação; se for recusada, o sistema responde de forma determinística.",
  off: "O modelo de linguagem está desativado neste ambiente: uma pergunta livre recebe o resumo determinístico do período, calculado pelo sistema. As análises sugeridas continuam funcionando.",
  not_configured:
    "O modelo de linguagem está habilitado, mas não está configurado neste ambiente: o Advisor responde de forma determinística.",
};

export function AdvisorWorkspace({
  periods,
  suggestions,
  llm,
}: {
  periods: AvailablePeriod[];
  suggestions: readonly AdvisorSuggestion[];
  llm: AdvisorLlmStatus;
}) {
  const first = periods[0];
  const [startDate, setStartDate] = useState(first?.start ?? "");
  const [endDate, setEndDate] = useState(first?.end ?? "");
  const [compare, setCompare] = useState<{ start: string; end: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{ intent: AdvisorIntent; value: AskAdvisorResult } | null>(null);
  const [pending, startTransition] = useTransition();

  // sem escolha do usuário, a comparação é com o período imediatamente anterior, de mesma duração
  const comparePeriod = compare ?? previousPeriod(startDate, endDate) ?? { start: "", end: "" };
  const hasPeriod = startDate !== "" && endDate !== "";

  const run = (intent: AdvisorIntent) => {
    startTransition(async () => {
      try {
        const value = await askAdvisor({
          startDate,
          endDate,
          ...(intent === "comparison"
            ? { compareStartDate: comparePeriod.start, compareEndDate: comparePeriod.end }
            : {}),
          intent,
          ...(intent === "free_question" ? { question } : {}),
        });
        setResult({ intent, value });
      } catch {
        setResult({
          intent,
          value: { ok: false, message: "Não foi possível consultar o Advisor agora. Tente de novo." },
        });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* ── período ─────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10" aria-labelledby="adv-period">
        <h2 id="adv-period" className="text-sm font-semibold">
          Período
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            De
            <input
              type="date"
              className={cn(inputClass, "block")}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Até
            <input
              type="date"
              className={cn(inputClass, "block")}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer py-1.5">Período de comparação</summary>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                De
                <input
                  type="date"
                  className={cn(inputClass, "block")}
                  value={comparePeriod.start}
                  onChange={(e) => setCompare({ start: e.target.value, end: comparePeriod.end })}
                />
              </label>
              <label className="space-y-1">
                Até
                <input
                  type="date"
                  className={cn(inputClass, "block")}
                  value={comparePeriod.end}
                  onChange={(e) => setCompare({ start: comparePeriod.start, end: e.target.value })}
                />
              </label>
              <p className="max-w-56">
                Usado só no comparativo. Precisa terminar antes do período e ter a mesma duração.
              </p>
            </div>
          </details>
        </div>

        {periods.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Cross-source gerado para:</span>
            {periods.map((p) => (
              <button
                key={`${p.start}:${p.end}`}
                type="button"
                onClick={() => {
                  setStartDate(p.start);
                  setEndDate(p.end);
                  setCompare(null);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium hover:bg-muted",
                  p.start === startDate && p.end === endDate && "border-foreground/40 bg-muted",
                )}
                title={`Cross-source gerado em ${generatedFmt.format(new Date(p.generatedAt))}`}
              >
                {br(p.start)} → {br(p.end)}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ainda não há Cross-source gerado para nenhum período. O Advisor só interpreta
            resultados já calculados; ele não gera dados.
          </p>
        )}
      </section>

      {/* ── sugestões ───────────────────────────────────────────── */}
      <section className="space-y-2" aria-labelledby="adv-suggestions">
        <h2 id="adv-suggestions" className="text-sm font-semibold">
          Sugestões
        </h2>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <Button
              key={s.intent}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || !hasPeriod}
              title={s.hint}
              onClick={() => run(s.intent)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </section>

      {/* ── pergunta ────────────────────────────────────────────── */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim() !== "") run("free_question");
        }}
      >
        <input
          type="text"
          className={cn(inputClass, "min-w-64 flex-1")}
          placeholder="Pergunte alguma coisa…"
          aria-label="Pergunte alguma coisa"
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={pending || !hasPeriod || question.trim() === ""}>
          <Sparkles className="size-3.5" aria-hidden />
          Perguntar
        </Button>
        <p className="basis-full text-xs text-muted-foreground">{LLM_HINT[llm]}</p>
      </form>

      {/* ── resposta ────────────────────────────────────────────── */}
      <div aria-live="polite" aria-busy={pending}>
        {pending ? (
          <LoadingState
            label={
              llm === "ready"
                ? "O modelo de linguagem está analisando os dados — pode levar até um minuto…"
                : "Consultando o Advisor…"
            }
            rows={3}
          />
        ) : result === null ? (
          <EmptyState
            icon={Sparkles}
            title="Escolha uma análise ou faça uma pergunta"
            description="O Advisor interpreta o diagnóstico e o Cross-source já calculados. Ele não calcula métricas, não inventa números e mostra o que os dados não permitem afirmar."
          />
        ) : !result.value.ok ? (
          <ErrorState
            title="O Advisor não conseguiu responder"
            description={result.value.message}
            onRetry={() => run(result.intent)}
          />
        ) : (
          <AdvisorResponseView response={result.value.response} onFollowUp={run} />
        )}
      </div>

    </div>
  );
}
