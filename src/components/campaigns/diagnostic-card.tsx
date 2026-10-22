/**
 * Um diagnóstico de campanha: o que aconteceu, onde (com link para a entidade na área
 * Campanhas), a evidência atual × anterior, severidade e confiança separadas, a
 * limitação quando houver e a próxima verificação. Só formata o que veio do servidor.
 */
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { CampaignDiagnostic, DiagnosticSeverity } from "@/lib/campaign-diagnostics";
import { formatDateSpan } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CONFIDENCE_LABEL, SEVERITY_LABEL, TYPE_LABEL } from "@/server/campaigns/diagnostics/view";

import { DeltaText, formatAbsDelta, formatValue } from "./metric";

const SEVERITY_CLASS: Record<DiagnosticSeverity, string> = {
  high: "border-red-500/50 text-red-700",
  medium: "border-amber-500/60 text-amber-700",
  low: "border-border text-muted-foreground",
  info: "border-sky-500/40 text-sky-700",
};

function EntityPath({ d }: { d: CampaignDiagnostic }) {
  const parts = [d.platformLabel, d.entity.campaignName, d.entity.adGroupName, d.entity.adName].filter(Boolean);
  const text = parts.join(" › ");
  return d.entity.href ? (
    <Link href={d.entity.href} className="hover:underline">
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  );
}

export function DiagnosticCard({ d, compact = false }: { d: CampaignDiagnostic; compact?: boolean }) {
  const compare = d.period.previous !== null;
  return (
    <article className="space-y-2 rounded-lg border p-4" aria-label={d.title}>
      <div className="flex flex-wrap items-center gap-1.5">
        {d.kind === "limitation" ? (
          <Badge variant="outline" className="text-[11px] font-normal">
            Limitação dos dados
          </Badge>
        ) : (
          <>
            <Badge variant="outline" className={cn("text-[11px] font-normal", SEVERITY_CLASS[d.severity])}>
              Severidade: {SEVERITY_LABEL[d.severity]}
            </Badge>
            <Badge variant="outline" className="text-[11px] font-normal">
              Confiança: {CONFIDENCE_LABEL[d.confidence]}
            </Badge>
            {d.kind === "inconclusive" ? (
              <Badge variant="outline" className="border-dashed text-[11px] font-normal">
                Inconclusivo
              </Badge>
            ) : null}
          </>
        )}
        <span className="text-xs text-muted-foreground">
          {d.kind === "limitation" ? d.platformLabel : `${TYPE_LABEL[d.type]} · ${d.levelLabel}`}
        </span>
      </div>

      <h3 className="text-sm font-medium">{d.title}</h3>
      {d.level !== "platform" ? (
        <div className="text-xs text-muted-foreground">
          <EntityPath d={d} />
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">{d.description}</p>

      {!compact && d.evidence.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-normal">Métrica</th>
                <th className="py-1 text-right font-normal">
                  Atual ({formatDateSpan(d.period.current.start, d.period.current.end)})
                </th>
                {compare ? (
                  <>
                    <th className="py-1 text-right font-normal">
                      Anterior ({formatDateSpan(d.period.previous!.start, d.period.previous!.end)})
                    </th>
                    <th className="py-1 text-right font-normal">Variação</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.evidence.map((m) => (
                <tr key={m.key}>
                  <td className="py-1">{m.label}</td>
                  <td className="py-1 text-right tabular-nums" title={m.note ?? undefined}>
                    {m.current === null ? "—" : formatValue(m.current, m.format, d.currency)}
                  </td>
                  {compare ? (
                    <>
                      <td className="py-1 text-right tabular-nums">
                        {m.previous === null ? "—" : formatValue(m.previous, m.format, d.currency)}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {m.deltaAbs === null ? (
                          <span className="text-muted-foreground" title={m.note ?? undefined}>
                            —
                          </span>
                        ) : (
                          <span className="inline-flex gap-1.5">
                            <span className="text-xs text-muted-foreground">{formatAbsDelta(m.deltaAbs, m.format, d.currency)}</span>
                            {m.deltaPct !== null ? <DeltaText m={m} currency={d.currency} /> : null}
                          </span>
                        )}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!compact && d.facts.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
          {d.facts.map((f) => (
            <div key={f.label} className="flex justify-between gap-2 sm:block">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="tabular-nums">{formatValue(f.value, f.format, d.currency)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {!compact && d.related.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          {d.type === "spend_without_results_share" || d.type === "spend_concentration" || d.kind === "limitation"
            ? "Itens: "
            : "Também aparece em: "}
          {d.related.map((r, i) => (
            <span key={`${r.name}-${i}`}>
              {i > 0 ? ", " : ""}
              {r.href ? (
                <Link href={r.href} className="hover:underline">
                  {r.name}
                </Link>
              ) : (
                r.name
              )}
            </span>
          ))}
        </div>
      ) : null}

      {d.limitation && d.kind !== "limitation" ? (
        <p className="text-xs text-amber-700">Limitação: {d.limitation}</p>
      ) : null}
      {d.nextCheck ? (
        <p className="text-xs">
          <span className="font-medium">Próxima verificação:</span> <span className="text-muted-foreground">{d.nextCheck}</span>
        </p>
      ) : null}
    </article>
  );
}
