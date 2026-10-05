/**
 * Visualizador de uma `AdvisorResponse` — só apresentação, sem estado nem hooks
 * (renderiza igual no servidor e no cliente, e o teste de renderização o exercita).
 *
 * A resposta é ESTRUTURADA e a tela a desenha a partir dos campos, não de um texto
 * livre: números em tabela (`figures`, copiados do contexto), cada item com a
 * etiqueta da sua camada (fato · relação observável · hipótese · limitação ·
 * diagnóstico), limitações por gravidade e as evidências citadas. Uma hipótese
 * NUNCA se parece com um fato, e um valor ausente (`null`) aparece como "sem dado",
 * nunca como 0.
 */
import type { AdvisorIntent } from "@/server/advisor/intents";
import type {
  AdvisorEvidence,
  AdvisorItem,
  AdvisorItemLayer,
  AdvisorLimitation,
  AdvisorLimitationSeverity,
  AdvisorPeriod,
  AdvisorResponse,
  AdvisorResponseStatus,
  AdvisorSection,
  AdvisorSource,
} from "@/server/advisor/types";
import { cn } from "@/lib/utils";

const br = (iso: string) => iso.split("-").reverse().join("/");
const range = (start: string, end: string) => `${br(start)} a ${br(end)}`;

const SOURCE_LABEL: Record<AdvisorSource, string> = {
  ga4: "GA4",
  rd_marketing: "RD Marketing",
  rd_crm: "RD CRM",
};

const STATUS: Record<AdvisorResponseStatus, { label: string; className: string }> = {
  answered: { label: "Respondido", className: "border-emerald-600/30 bg-emerald-50 text-emerald-700" },
  partial: { label: "Parcial", className: "border-amber-600/30 bg-amber-50 text-amber-800" },
  not_computable: { label: "Não computável", className: "border-slate-500/30 bg-slate-100 text-slate-700" },
  no_data: { label: "Sem dados", className: "border-slate-500/30 bg-slate-100 text-slate-700" },
  needs_model: { label: "Requer modelo de linguagem", className: "border-violet-600/30 bg-violet-50 text-violet-700" },
};

const LAYER: Record<AdvisorItemLayer, { label: string; border: string; chip: string }> = {
  fact: { label: "Fato", border: "border-l-slate-400", chip: "border-slate-500/30 bg-slate-100 text-slate-700" },
  observable_relationship: {
    label: "Relação observável",
    border: "border-l-sky-500",
    chip: "border-sky-600/30 bg-sky-50 text-sky-700",
  },
  hypothesis: {
    label: "Hipótese",
    border: "border-l-violet-500 border-dashed",
    chip: "border-violet-600/30 bg-violet-50 text-violet-700",
  },
  limitation: {
    label: "Limitação",
    border: "border-l-amber-500",
    chip: "border-amber-600/30 bg-amber-50 text-amber-800",
  },
  diagnostic: {
    label: "Diagnóstico do motor",
    border: "border-l-blue-500",
    chip: "border-blue-600/30 bg-blue-50 text-blue-700",
  },
  comparison: {
    label: "Comparação",
    border: "border-l-emerald-500",
    chip: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  },
};

const SEVERITY: Record<AdvisorLimitationSeverity, { label: string; border: string; chip: string }> = {
  blocking: { label: "Bloqueante", border: "border-l-red-500", chip: "border-red-600/30 bg-red-50 text-red-700" },
  warning: { label: "Atenção", border: "border-l-amber-500", chip: "border-amber-600/30 bg-amber-50 text-amber-800" },
  info: { label: "Definição", border: "border-l-slate-400", chip: "border-slate-500/30 bg-slate-100 text-slate-700" },
};

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── números ──────────────────────────────────────────────────────────

function Figures({ figures, period }: { figures: AdvisorEvidence[]; period: AdvisorPeriod }) {
  if (figures.length === 0) return null;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Números do período</caption>
      <tbody>
        {figures.map((f) => {
          const otherPeriod = f.period.start !== period.startDate || f.period.end !== period.endDate;
          return (
            <tr key={f.ref} className="border-t first:border-t-0">
              <td className="py-1.5 pr-3 text-muted-foreground">
                {f.label}
                {otherPeriod ? (
                  <span className="block text-xs">{range(f.period.start, f.period.end)}</span>
                ) : null}
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums">
                {f.display !== null ? (
                  f.display
                ) : (
                  <span className="font-normal italic text-muted-foreground">sem dado</span>
                )}
                {f.note ? (
                  <span className="block max-w-xs text-xs font-normal text-muted-foreground">{f.note}</span>
                ) : null}
              </td>
              <td className="py-1.5 pl-3 text-right text-xs whitespace-nowrap text-muted-foreground">
                {SOURCE_LABEL[f.source]}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── itens por camada ─────────────────────────────────────────────────

function Item({ item }: { item: AdvisorItem }) {
  const sev = item.layer === "limitation" && item.severity ? SEVERITY[item.severity] : null;
  const layer = LAYER[item.layer];
  return (
    <li className={cn("flex gap-2.5 rounded-md border-l-2 bg-muted/20 px-3 py-2 text-sm", sev?.border ?? layer.border)}>
      <Chip className={sev?.chip ?? layer.chip}>
        {sev ? `${layer.label} · ${sev.label}` : layer.label}
      </Chip>
      <p className="min-w-0">{item.text}</p>
    </li>
  );
}

function Section({ section, period }: { section: AdvisorSection; period: AdvisorPeriod }) {
  return (
    <section className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10" aria-labelledby={`adv-${section.id}`}>
      <div>
        <h3 id={`adv-${section.id}`} className="text-sm font-semibold">
          {section.title}
        </h3>
        <p className="text-xs text-muted-foreground">{section.content}</p>
      </div>
      <Figures figures={section.figures} period={period} />
      {section.items.length > 0 ? (
        <ul className="space-y-2">
          {section.items.map((item, i) => (
            <Item key={`${item.layer}:${item.code ?? i}:${i}`} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ── comparação ───────────────────────────────────────────────────────

function ComparisonTable({ response }: { response: AdvisorResponse }) {
  const c = response.comparison;
  if (!c || c.status !== "computed") return null;
  return (
    <section className="space-y-2 rounded-xl p-4 ring-1 ring-foreground/10" aria-labelledby="adv-comparison-table">
      <h3 id="adv-comparison-table" className="text-sm font-semibold">
        Comparação calculada pelo sistema
      </h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-medium">Métrica</th>
            <th className="py-1 text-right font-medium">{range(response.period.startDate, response.period.endDate)}</th>
            <th className="py-1 text-right font-medium">{range(c.baselinePeriod.startDate, c.baselinePeriod.endDate)}</th>
            <th className="py-1 text-right font-medium">Diferença</th>
            <th className="py-1 text-right font-medium">Variação</th>
          </tr>
        </thead>
        <tbody>
          {c.items.map((i) => (
            <tr key={i.metricId} className="border-t">
              <td className="py-1.5 pr-3 text-muted-foreground">{i.label}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{i.currentDisplay}</td>
              <td className="py-1.5 text-right tabular-nums">{i.baselineDisplay}</td>
              <td className="py-1.5 text-right tabular-nums">{i.deltaDisplay}</td>
              <td className="py-1.5 text-right tabular-nums">
                {i.deltaPctDisplay ?? (
                  <span className="italic text-muted-foreground">base zero</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── limitações ───────────────────────────────────────────────────────

const limitationKey = (code: string | undefined, text: string) => `${code ?? ""}\u0000${text}`;

function LimitationRow({ l }: { l: AdvisorLimitation }) {
  const sev = SEVERITY[l.severity];
  return (
    <li className={cn("flex gap-2.5 rounded-md border-l-2 bg-muted/20 px-3 py-2 text-sm", sev.border)}>
      <Chip className={sev.chip}>{sev.label}</Chip>
      <p className="min-w-0">
        {l.message}
        {l.sources.length > 0 ? (
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({l.sources.map((s) => SOURCE_LABEL[s]).join(", ")})
          </span>
        ) : null}
      </p>
    </li>
  );
}

// ── fallback: o modelo de linguagem não pôde ser usado ────────────────

const FALLBACK_CODES: readonly string[] = ["model_failed", "model_output_rejected"];

/** A limitação que explica por que o modelo foi trocado pela resposta determinística (só quando houve troca). */
function fallbackLimitation(response: AdvisorResponse): AdvisorLimitation | undefined {
  return response.provenance.fellBack
    ? response.limitations.find((l) => FALLBACK_CODES.includes(l.code))
    : undefined;
}

function FallbackNotice({ limitation }: { limitation: AdvisorLimitation }) {
  return (
    <div role="status" className="rounded-xl border border-amber-600/30 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">A resposta do modelo de linguagem não pôde ser usada</p>
      <p className="mt-1">{limitation.message}</p>
      <p className="mt-1 text-xs">Abaixo está a resposta determinística do sistema, calculada a partir dos mesmos dados.</p>
    </div>
  );
}

/** As limitações que as seções ainda não mostraram — todas aparecem na tela, cada uma uma vez. */
function Limitations({ response }: { response: AdvisorResponse }) {
  const inline = new Set(
    response.sections.flatMap((s) =>
      s.items.filter((i) => i.layer === "limitation").map((i) => limitationKey(i.code, i.text)),
    ),
  );
  // a do aviso de fallback já está na tela, no topo
  const notice = fallbackLimitation(response);
  const rest = response.limitations.filter(
    (l) => !inline.has(limitationKey(l.code, l.message)) && l !== notice,
  );
  if (rest.length === 0) return null;
  const important = rest.filter((l) => l.severity !== "info");
  const definitions = rest.filter((l) => l.severity === "info");

  return (
    <section className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10" aria-labelledby="adv-limitations">
      <h3 id="adv-limitations" className="text-sm font-semibold">
        {inline.size > 0 ? "Outras limitações dos dados" : "Limitações dos dados"}
      </h3>
      {important.length > 0 ? (
        <ul className="space-y-2">
          {important.map((l) => (
            <LimitationRow key={limitationKey(l.code, l.message)} l={l} />
          ))}
        </ul>
      ) : null}
      {definitions.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Definições e escopo dos dados ({definitions.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {definitions.map((l) => (
              <LimitationRow key={limitationKey(l.code, l.message)} l={l} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// ── evidências e proveniência ────────────────────────────────────────

function Evidence({ evidence }: { evidence: AdvisorEvidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="rounded-xl p-4 ring-1 ring-foreground/10">
      <summary className="cursor-pointer text-sm font-semibold">
        Evidências citadas ({evidence.length})
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Evidência</th>
              <th className="py-1 text-right font-medium">Valor</th>
              <th className="py-1 pl-3 text-left font-medium">Fonte</th>
              <th className="py-1 pl-3 text-left font-medium">Período</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((e) => (
              <tr key={e.ref} className="border-t">
                <td className="py-1 pr-3">{e.label}</td>
                <td className="py-1 text-right tabular-nums">
                  {e.display ?? <span className="italic text-muted-foreground">sem dado</span>}
                </td>
                <td className="py-1 pl-3 whitespace-nowrap">{SOURCE_LABEL[e.source]}</td>
                <td className="py-1 pl-3 whitespace-nowrap">{range(e.period.start, e.period.end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const savedAt = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function Provenance({ response }: { response: AdvisorResponse }) {
  const p = response.provenance;
  const producer =
    p.producer === "deterministic"
      ? "determinística (sem modelo de linguagem)"
      : `do modelo “${p.producer}”${p.promptVersion ? ` (prompt ${p.promptVersion})` : ""}, validada pelo sistema`;
  const cross =
    p.crossSource.status === "generated" && p.crossSource.generatedAt
      ? `Cross-source gerado em ${savedAt.format(new Date(p.crossSource.generatedAt))}`
      : "Cross-source não gerado para o período";
  const diag =
    p.diagnostics.status === "none"
      ? "sem insights de diagnóstico"
      : p.diagnostics.alignedWithPeriod
        ? "diagnóstico do mesmo período"
        : "diagnóstico de outra janela";
  return (
    <p className="text-xs text-muted-foreground">
      Resposta {producer}
      {p.fellBack ? " — o modelo de linguagem não pôde ser usado (veja o aviso no topo)" : ""}. {cross}; {diag}.
    </p>
  );
}

// ── resposta completa ────────────────────────────────────────────────

export function AdvisorResponseView({
  response,
  onFollowUp,
}: {
  response: AdvisorResponse;
  onFollowUp?: (intent: AdvisorIntent) => void;
}) {
  const status = STATUS[response.status];
  const notice = fallbackLimitation(response);
  return (
    <article className="space-y-4" aria-labelledby="adv-title">
      {notice ? <FallbackNotice limitation={notice} /> : null}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="adv-title" className="text-lg font-semibold tracking-tight">
            {response.title}
          </h2>
          <Chip className={status.className}>{status.label}</Chip>
        </div>
        <p className="text-xs text-muted-foreground">
          Período analisado: {range(response.period.startDate, response.period.endDate)}
        </p>
        <p className="text-sm">{response.summary}</p>
      </header>

      <ComparisonTable response={response} />
      {response.sections.map((section) => (
        <Section key={section.id} section={section} period={response.period} />
      ))}
      <Limitations response={response} />
      <Evidence evidence={response.evidence} />
      <Provenance response={response} />

      {onFollowUp && response.followUps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Continuar com:</span>
          {response.followUps.map((f) => (
            <button
              key={f.intent}
              type="button"
              onClick={() => onFollowUp(f.intent)}
              className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-muted"
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
