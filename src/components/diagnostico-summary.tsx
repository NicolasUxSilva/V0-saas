/**
 * Faixa-resumo da tela Diagnóstico (bloco A4): contagens por seção +
 * última atualização + janela analisada.
 */
import { CircleAlert, Lightbulb, ShieldAlert, TriangleAlert } from "lucide-react";

import { formatDateRange, formatRelativeTime } from "@/lib/format";
import type { DiagnosticoData } from "@/lib/insight";
import { cn } from "@/lib/utils";

function Stat({
  icon: Icon,
  count,
  label,
  tone,
}: {
  icon: typeof CircleAlert;
  count: number;
  label: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("size-4", tone)} aria-hidden />
      <span className="text-sm">
        <span className="font-semibold">{count}</span>{" "}
        <span className="text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

export function DiagnosticoSummary({ data }: { data: DiagnosticoData }) {
  const by = (fn: (kind: string, severity: string) => boolean) =>
    data.insights.filter(
      (i) => i.status !== "dismissed" && fn(i.kind, i.severity),
    ).length;

  const critical = by((k, s) => k === "problem" && s === "critical");
  const attention = by((k, s) => k === "problem" && s === "attention");
  const opportunities = by((k) => k === "opportunity");
  const dataQuality = by((k) => k === "data_quality");

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border bg-card px-5 py-4">
      <Stat
        icon={ShieldAlert}
        count={critical}
        label="críticos"
        tone="text-destructive"
      />
      <Stat
        icon={TriangleAlert}
        count={attention}
        label="pontos de atenção"
        tone="text-warning"
      />
      <Stat
        icon={Lightbulb}
        count={opportunities}
        label="oportunidades"
        tone="text-success"
      />
      <Stat
        icon={CircleAlert}
        count={dataQuality}
        label="qualidade dos dados"
        tone="text-muted-foreground"
      />
      <div className="ml-auto text-xs text-muted-foreground">
        {data.lastSyncedAt
          ? `Atualizado ${formatRelativeTime(data.lastSyncedAt)}`
          : "Sem sincronização"}
        {" · "}
        {formatDateRange(data.window.start, data.window.end)}
      </div>
    </div>
  );
}
