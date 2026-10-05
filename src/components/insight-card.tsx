"use client";

/**
 * InsightCard (bloco A4).
 *
 * Um insight = DADO → ANÁLISE → PROBLEMA/OPORTUNIDADE → EVIDÊNCIA → HIPÓTESE → AÇÃO.
 * Campos obrigatórios (todos presentes aqui): título · impacto · o que está
 * acontecendo · por que provavelmente · evidências numéricas · período analisado
 * · dimensão responsável · nível de confiança · ação recomendada ·
 * reconhecer/descartar · 👍/👎.
 *
 * A interatividade (reconhecer/descartar/avaliar) persiste no banco via server
 * actions (`diagnostico/actions.ts`), com atualização otimista (`useOptimistic`)
 * enquanto a ação roda e `revalidatePath` reconciliando ao estado real (C5).
 */
import { RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";

import {
  acknowledgeInsight,
  dismissInsight,
  rateInsight,
  reopenInsight,
} from "@/app/(app)/diagnostico/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  formatDateRange,
  formatDelta,
  formatMetricValue,
  formatShare,
} from "@/lib/format";
import type {
  Insight,
  InsightConfidence,
  InsightEvidence,
  InsightImpact,
  InsightRating,
  InsightStatus,
} from "@/lib/insight";
import { cn } from "@/lib/utils";

// ── acentos por tipo/severidade ──────────────────────────────────────
type Accent = { border: string; badge: string; label: string };

function accentFor(insight: Insight): Accent {
  if (insight.kind === "opportunity") {
    return {
      border: "border-l-emerald-500",
      badge: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
      label: "Oportunidade",
    };
  }
  if (insight.kind === "data_quality") {
    return {
      border: "border-l-slate-400",
      badge: "border-slate-500/30 bg-slate-100 text-slate-700",
      label: "Qualidade dos dados",
    };
  }
  if (insight.severity === "critical") {
    return {
      border: "border-l-red-500",
      badge: "border-red-600/30 bg-red-50 text-red-700",
      label: "Crítico",
    };
  }
  return {
    border: "border-l-amber-500",
    badge: "border-amber-600/30 bg-amber-50 text-amber-800",
    label: "Atenção",
  };
}

function priorityTone(score: number): string {
  if (score >= 80) return "border-red-600/30 bg-red-50 text-red-700";
  if (score >= 60) return "border-amber-600/30 bg-amber-50 text-amber-800";
  return "border-border bg-muted text-muted-foreground";
}

// ── blocos ──────────────────────────────────────────────────────────
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <p className="text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

function ImpactStat({ impact }: { impact: InsightImpact }) {
  const unitLabel =
    impact.unit === "conversions"
      ? "conversões"
      : impact.unit === "sessions"
        ? "sessões"
        : "";
  const value =
    impact.unit === "BRL"
      ? formatMetricValue(impact.value, "currency")
      : `${formatMetricValue(impact.value, "count")} ${unitLabel}`.trim();
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Impacto
      </span>
      <span className="text-sm font-semibold">
        {impact.isEstimate ? "≈ " : ""}
        {value}
      </span>
      <span className="text-xs text-muted-foreground">— {impact.basis}</span>
    </div>
  );
}

function EvidenceBlock({
  evidence,
  kind,
}: {
  evidence: InsightEvidence;
  kind: Insight["kind"];
}) {
  // A variação na evidência é sempre o cerne do insight: para problema /
  // qualidade de dados ela representa deterioração (vermelho); para
  // oportunidade, um movimento favorável (verde).
  const hasMove = Math.abs(evidence.deltaPct) >= 0.001;
  const deltaTone = !hasMove
    ? "text-muted-foreground"
    : kind === "opportunity"
      ? "text-emerald-600"
      : "text-red-600";
  const deltaText = formatDelta(evidence.deltaPct).text;
  const fmt = (n: number) => formatMetricValue(n, evidence.format);
  // Sem antes/depois numérico (ex.: "sem key events no período"): mostra o texto
  // explicativo em vez de um "0 → 0 +0,0%" sem significado.
  const noSeries =
    evidence.current === 0 &&
    evidence.previous === 0 &&
    (evidence.breakdown?.length ?? 0) === 0;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Evidências
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        {noSeries ? (
          <p className="text-sm leading-relaxed text-foreground">
            {evidence.test ??
              "Sem série numérica comparável para este item no período."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{evidence.metricLabel}</span>
              <span className="font-mono text-sm tabular-nums">
                {fmt(evidence.previous)} →{" "}
                <strong>{fmt(evidence.current)}</strong>
              </span>
              <span className={cn("text-sm font-semibold", deltaTone)}>
                {deltaText}
              </span>
              {evidence.baseline != null ? (
                <span className="text-xs text-muted-foreground">
                  baseline 90d: {fmt(evidence.baseline)}
                </span>
              ) : null}
            </div>
            {evidence.test ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {evidence.test}
              </p>
            ) : null}
            {evidence.breakdown && evidence.breakdown.length > 0 ? (
              <ul className="mt-2 space-y-1 border-t pt-2">
                {evidence.breakdown.map((row, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span>
                      {row.label}
                      {row.detail ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {row.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                      {formatShare(Math.abs(row.contributionPct))} da variação
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("text-xs", className)}>
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function confidenceLabel(c: InsightConfidence): string {
  return c === "alta" ? "Alta" : "Média";
}

function RatingButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon-sm"
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

// ── card ────────────────────────────────────────────────────────────
export function InsightCard({ insight }: { insight: Insight }) {
  // `useOptimistic` mostra o resultado esperado enquanto a server action roda;
  // após `revalidatePath` o card recebe o estado real do banco (a página usa
  // key={dedupeKey:status:rating}, então ele remonta com o valor reconciliado).
  const [status, setStatusOptimistic] = useOptimistic(
    insight.status,
    (_current, next: InsightStatus) => next,
  );
  const [rating, setRatingOptimistic] = useOptimistic(
    insight.rating,
    (_current, next: InsightRating) => next,
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accent = accentFor(insight);

  function changeStatus(
    next: InsightStatus,
    action: (dedupeKey: string) => Promise<void>,
  ) {
    setError(null);
    startTransition(async () => {
      setStatusOptimistic(next);
      try {
        await action(insight.dedupeKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });
  }

  function toggleRating(value: 1 | -1) {
    const next: InsightRating = rating === value ? null : value;
    setError(null);
    startTransition(async () => {
      setRatingOptimistic(next);
      try {
        await rateInsight(insight.dedupeKey, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });
  }

  if (status === "dismissed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-2.5 text-sm text-muted-foreground">
        <span className="truncate">
          Descartado: <span className="italic">{insight.title}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={isPending}
          onClick={() => changeStatus("open", reopenInsight)}
        >
          <RotateCcw className="size-3.5" />
          Desfazer
        </Button>
      </div>
    );
  }

  const dim = insight.responsibleDimension;

  return (
    <Card
      className={cn(
        "border-l-4",
        accent.border,
        status === "acknowledged" && "opacity-70",
      )}
    >
      <CardHeader>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn("font-mono", priorityTone(insight.priorityScore))}
          >
            Prioridade {Math.round(insight.priorityScore)}
          </Badge>
          <Badge variant="outline" className={accent.badge}>
            {accent.label}
          </Badge>
          {status === "acknowledged" ? (
            <Badge variant="outline">Reconhecido</Badge>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            Confiança: {confidenceLabel(insight.confidence)}
          </span>
        </div>
        <h3 className="text-base font-semibold leading-snug">{insight.title}</h3>
        {insight.impact ? <ImpactStat impact={insight.impact} /> : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <Field label="O que está acontecendo">{insight.explanation}</Field>
        <Field label="Por que provavelmente">{insight.hypothesis}</Field>
        <EvidenceBlock evidence={insight.evidence} kind={insight.kind} />
        <div className="grid gap-x-6 gap-y-1.5 rounded-md bg-muted/20 p-3 sm:grid-cols-2">
          <Meta
            label="Período analisado"
            value={`${formatDateRange(insight.window.start, insight.window.end)} · vs. ${insight.window.comparedTo}`}
          />
          <Meta
            label="Dimensão responsável"
            value={
              dim
                ? `${dim.name} — ${dim.value} (${formatShare(dim.share)} da variação)`
                : "—"
            }
          />
          <Meta
            label="Nível de confiança"
            value={`${confidenceLabel(insight.confidence)} · ${insight.confidenceBasis}`}
            className="sm:col-span-2"
          />
        </div>
        <Field label="Ação recomendada">{insight.recommendedAction}</Field>
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        {status === "open" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => changeStatus("acknowledged", acknowledgeInsight)}
          >
            Reconhecer
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => changeStatus("open", reopenInsight)}
          >
            Reabrir
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => changeStatus("dismissed", dismissInsight)}
        >
          Descartar
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">
            Este diagnóstico é útil?
          </span>
          <RatingButton
            active={rating === 1}
            disabled={isPending}
            label="Marcar como útil"
            onClick={() => toggleRating(1)}
          >
            <ThumbsUp className="size-3.5" />
          </RatingButton>
          <RatingButton
            active={rating === -1}
            disabled={isPending}
            label="Marcar como não útil"
            onClick={() => toggleRating(-1)}
          >
            <ThumbsDown className="size-3.5" />
          </RatingButton>
        </div>
        {error ? (
          <p className="w-full text-xs text-red-700">{error}</p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
