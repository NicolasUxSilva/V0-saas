/**
 * Filtros e seções da tela de diagnóstico — PURO. A lista vem de `diagnose()`, já ordenada
 * por prioridade; aqui só se filtra e se separa achados, inconclusivos e limitações.
 *
 * Limitações não somem com os filtros de severidade, tipo ou entidade: elas explicam por
 * que algo NÃO aparece, e esconder isso seria pior que mostrar a mais.
 */
import type {
  CampaignDiagnostic,
  DiagnosticFilters,
  DiagnosticLevel,
  DiagnosticSeverity,
  DiagnosticType,
  DiagnosticsView,
} from "@/lib/campaign-diagnostics";

const SEVERITIES: readonly DiagnosticSeverity[] = ["high", "medium", "low", "info"];
const TYPES: readonly DiagnosticType[] = [
  "cost_without_results",
  "cost_per_result_increase",
  "ctr_drop",
  "cpc_increase",
  "results_drop",
  "cost_per_result_improvement",
  "spend_without_results_share",
  "spend_concentration",
  "data_limitation",
];
const LEVELS: readonly DiagnosticLevel[] = ["platform", "campaign", "ad_group", "ad"];

export const TYPE_LABEL: Record<DiagnosticType, string> = {
  cost_without_results: "Investimento sem resultados",
  cost_per_result_increase: "Custo por resultado subiu",
  ctr_drop: "CTR caiu",
  cpc_increase: "CPC subiu",
  results_drop: "Resultados caíram",
  cost_per_result_improvement: "Custo por resultado melhorou",
  spend_without_results_share: "Gasto em itens sem resultados",
  spend_concentration: "Concentração do investimento",
  data_limitation: "Limitação dos dados",
};

export const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  info: "Informativo",
};

export const CONFIDENCE_LABEL = { high: "Alta", medium: "Média", low: "Baixa" } as const;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseDiagnosticFilters(params: Params): DiagnosticFilters {
  const severity = one(params.severidade);
  const type = one(params.tipo);
  const level = one(params.nivel);
  const campaign = one(params.campanha)?.trim();
  return {
    severity: SEVERITIES.includes(severity as DiagnosticSeverity) ? (severity as DiagnosticSeverity) : null,
    type: TYPES.includes(type as DiagnosticType) ? (type as DiagnosticType) : null,
    level: LEVELS.includes(level as DiagnosticLevel) ? (level as DiagnosticLevel) : null,
    // ids de campanha das plataformas são numéricos; nada além disso entra no filtro
    campaignId: campaign && /^[\w-]{1,64}$/.test(campaign) ? campaign : null,
  };
}

/** Parâmetros dos filtros de diagnóstico para somar à query dos filtros de campanha. */
export function diagnosticFiltersQuery(f: DiagnosticFilters): string {
  const q = new URLSearchParams();
  if (f.severity) q.set("severidade", f.severity);
  if (f.type) q.set("tipo", f.type);
  if (f.level) q.set("nivel", f.level);
  if (f.campaignId) q.set("campanha", f.campaignId);
  return q.toString();
}

export function buildDiagnosticsView(all: CampaignDiagnostic[], f: DiagnosticFilters): DiagnosticsView {
  const signals = all.filter((d) => d.kind !== "limitation");
  const matches = (d: CampaignDiagnostic) =>
    (!f.severity || d.severity === f.severity) &&
    (!f.type || d.type === f.type) &&
    (!f.level || d.level === f.level) &&
    (!f.campaignId || d.entity.campaignId === f.campaignId);
  const shown = signals.filter(matches);

  const campaigns = new Map<string, { platform: CampaignDiagnostic["platform"]; id: string; name: string }>();
  for (const d of signals) {
    if (d.entity.campaignId) {
      campaigns.set(`${d.platform}:${d.entity.campaignId}`, {
        platform: d.platform,
        id: d.entity.campaignId,
        name: d.entity.campaignName ?? d.entity.campaignId,
      });
    }
  }

  return {
    findings: shown.filter((d) => d.kind === "finding"),
    inconclusive: shown.filter((d) => d.kind === "inconclusive"),
    limitations: !f.type || f.type === "data_limitation" ? all.filter((d) => d.kind === "limitation") : [],
    totals: {
      findings: signals.filter((d) => d.kind === "finding" && d.severity !== "info").length,
      high: signals.filter((d) => d.kind === "finding" && d.severity === "high").length,
      inconclusive: signals.filter((d) => d.kind === "inconclusive").length,
      limitations: all.filter((d) => d.kind === "limitation").length,
    },
    campaignOptions: [...campaigns.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

/** Os diagnósticos de UMA campanha (ela e seus níveis inferiores), para a página dela. */
export function diagnosticsForCampaign(all: CampaignDiagnostic[], platform: string, campaignId: string, adGroupId?: string) {
  return all.filter(
    (d) =>
      d.kind !== "limitation" &&
      d.platform === platform &&
      d.entity.campaignId === campaignId &&
      (!adGroupId || d.entity.adGroupId === adGroupId),
  );
}
