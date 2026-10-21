/**
 * Métricas da área Campanhas — PURO. Definições, razões e variações.
 *
 * Regras (não negociáveis — ver `src/lib/campaigns.ts`):
 *  - razão com denominador zero é `null`, nunca 0 nem infinito;
 *  - "sem dado importado" é `null`; zero registrado é 0;
 *  - variação só entre períodos comparáveis; percentual só sobre base ≠ 0;
 *  - "resultado" é o da PLATAFORMA e depende do objetivo; sem definição segura para o
 *    objetivo, não há resultado (nunca se soma lead com compra para "preencher").
 */
import type {
  AdPlatform,
  MetricComparison,
  MetricFormatKind,
  MetricKey,
  ResultDefinition,
} from "@/lib/campaigns";

/** Somas aditivas de um período (uma campanha, um grupo, um anúncio ou uma plataforma). */
export interface Totals {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  /** Meta: eventos por tipo (lead, purchase, complete_registration) */
  actions: Record<string, number>;
}

export const EMPTY_TOTALS: Totals = {
  cost: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  conversionValue: 0,
  actions: {},
};

export function addTotals(a: Totals, b: Totals): Totals {
  const actions: Record<string, number> = { ...a.actions };
  for (const [k, v] of Object.entries(b.actions)) actions[k] = (actions[k] ?? 0) + v;
  return {
    cost: a.cost + b.cost,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    conversions: a.conversions + b.conversions,
    conversionValue: a.conversionValue + b.conversionValue,
    actions,
  };
}

export const PLATFORM_LABEL: Record<AdPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
};

/** Rótulo do 2º nível, preservando o conceito de cada provedor. */
export const GROUP_LEVEL_LABEL: Record<AdPlatform, { one: string; many: string }> = {
  google_ads: { one: "Grupo de anúncios", many: "Grupos de anúncios" },
  meta_ads: { one: "Conjunto de anúncios", many: "Conjuntos de anúncios" },
};

const GOOGLE_CONVERSIONS: ResultDefinition = {
  key: "google_conversions",
  label: "Conversões",
  description:
    "Coluna \"Conversões\" do Google Ads: as ações de conversão que a conta inclui em Conversões, no modelo de atribuição da conta (pode ser fracionária). É o que a plataforma reporta — não é venda confirmada.",
};
const META_LEADS: ResultDefinition = {
  key: "meta_lead",
  label: "Leads",
  description:
    "Leads atribuídos pela Meta (evento agregado \"lead\": formulário instantâneo e pixel), na janela de atribuição da conta. Usado porque o objetivo da campanha é cadastro. É o que a plataforma reporta — não é lead qualificado nem venda.",
};
const META_PURCHASES: ResultDefinition = {
  key: "meta_purchase",
  label: "Compras",
  description:
    "Compras atribuídas pela Meta (evento agregado \"purchase\"), na janela de atribuição da conta. Usado porque o objetivo da campanha é vendas. É o que a plataforma reporta — não é venda confirmada no CRM.",
};

const META_RESULT_BY_OBJECTIVE: Record<string, ResultDefinition> = {
  OUTCOME_LEADS: META_LEADS,
  LEAD_GENERATION: META_LEADS,
  OUTCOME_SALES: META_PURCHASES,
  PRODUCT_CATALOG_SALES: META_PURCHASES,
};

/**
 * O que conta como resultado. Google: a coluna Conversões (definição da conta). Meta:
 * depende do objetivo — leads para cadastro, compras para vendas; nos demais objetivos
 * (tráfego, reconhecimento, engajamento…) o "resultado" do Ads Manager não é importado,
 * então não há resultado aqui.
 */
export function resultDefinition(platform: AdPlatform, objective: string | null): ResultDefinition | null {
  if (platform === "google_ads") return GOOGLE_CONVERSIONS;
  return objective ? (META_RESULT_BY_OBJECTIVE[objective] ?? null) : null;
}

/** Quantos resultados (na definição acima) há nestes totais. */
export function resultsOf(def: ResultDefinition | null, t: Totals): number | null {
  if (!def) return null;
  if (def.key === "google_conversions") return t.conversions;
  if (def.key === "meta_lead") return t.actions.lead ?? 0;
  return t.actions.purchase ?? 0;
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Valores (atuais OU anteriores) de cada métrica; `null` = sem dado ou sem base. */
export function metricValues(
  def: ResultDefinition | null,
  t: Totals | null,
): Record<MetricKey, number | null> {
  if (!t) {
    return {
      cost: null,
      impressions: null,
      clicks: null,
      ctr: null,
      cpc: null,
      cpm: null,
      results: null,
      cost_per_result: null,
      conversion_value: null,
    };
  }
  const results = resultsOf(def, t);
  return {
    cost: t.cost,
    impressions: t.impressions,
    clicks: t.clicks,
    ctr: ratio(t.clicks, t.impressions),
    cpc: ratio(t.cost, t.clicks),
    cpm: t.impressions > 0 ? (t.cost / t.impressions) * 1000 : null,
    results,
    cost_per_result: results === null ? null : ratio(t.cost, results),
    conversion_value: t.conversionValue,
  };
}

const COST_PER_LABEL: Record<ResultDefinition["key"], string> = {
  google_conversions: "Custo por conversão",
  meta_lead: "Custo por lead",
  meta_purchase: "Custo por compra",
};

interface MetricSpec {
  label: string;
  format: MetricFormatKind;
  lowerIsBetter: boolean | null;
}

export function metricSpec(key: MetricKey, platform: AdPlatform, def: ResultDefinition | null): MetricSpec {
  const meta = platform === "meta_ads";
  switch (key) {
    case "cost":
      return { label: "Investimento", format: "money", lowerIsBetter: null };
    case "impressions":
      return { label: "Impressões", format: "count", lowerIsBetter: null };
    case "clicks":
      return { label: meta ? "Cliques no link" : "Cliques", format: "count", lowerIsBetter: false };
    case "ctr":
      return { label: meta ? "CTR (link)" : "CTR", format: "rate", lowerIsBetter: false };
    case "cpc":
      return { label: meta ? "CPC (link)" : "CPC", format: "money", lowerIsBetter: true };
    case "cpm":
      return { label: "CPM", format: "money", lowerIsBetter: true };
    case "results":
      return { label: def?.label ?? "Resultados", format: "decimal", lowerIsBetter: false };
    case "cost_per_result":
      return {
        label: def ? COST_PER_LABEL[def.key] : "Custo por resultado",
        format: "money",
        lowerIsBetter: true,
      };
    case "conversion_value":
      return {
        label: meta ? "Valor das compras" : "Valor de conversão",
        format: "money",
        lowerIsBetter: false,
      };
  }
}

const NOTE_NO_DATA = "Sem dados importados.";

function nullNote(key: MetricKey, def: ResultDefinition | null): string {
  if (key === "results" || key === "cost_per_result") {
    if (!def) return "Sem definição de resultado para o objetivo desta campanha.";
    if (key === "cost_per_result") return "Sem resultados no período: custo por resultado não se aplica.";
  }
  if (key === "ctr" || key === "cpm") return "Sem impressões no período.";
  if (key === "cpc") return "Sem cliques no período.";
  return NOTE_NO_DATA;
}

/** Uma métrica, atual × anterior, com variação só quando válida. */
export function compareMetric(input: {
  key: MetricKey;
  platform: AdPlatform;
  def: ResultDefinition | null;
  current: Totals | null;
  previous: Totals | null;
  /** os dois períodos estão importados por completo? */
  comparable: boolean;
}): MetricComparison {
  const { key, platform, def, current, previous, comparable } = input;
  const spec = metricSpec(key, platform, def);
  const cur = metricValues(def, current)[key];
  const prev = previous ? metricValues(def, previous)[key] : null;

  let deltaAbs: number | null = null;
  let deltaPct: number | null = null;
  let note: string | null = null;
  if (cur === null) note = current ? nullNote(key, def) : NOTE_NO_DATA;
  if (comparable && cur !== null && prev !== null) {
    deltaAbs = cur - prev;
    deltaPct = prev !== 0 ? deltaAbs / prev : null;
    if (prev === 0 && note === null) note = "Base anterior zero: variação percentual não se aplica.";
  } else if (comparable && cur !== null && prev === null && note === null && previous) {
    note = `Período anterior: ${nullNote(key, def).toLowerCase()}`;
  }

  return {
    key,
    label: spec.label,
    format: spec.format,
    current: cur,
    previous: prev,
    deltaAbs,
    deltaPct,
    lowerIsBetter: spec.lowerIsBetter,
    note,
  };
}

export const ALL_METRICS: readonly MetricKey[] = [
  "cost",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "results",
  "cost_per_result",
  "conversion_value",
];

export function compareAll(input: Omit<Parameters<typeof compareMetric>[0], "key">, keys = ALL_METRICS) {
  return keys.map((key) => compareMetric({ ...input, key }));
}

/** Eventos de conversão da Meta, por tipo, atual × anterior (auditoria do "resultado"). */
export function metaBreakdown(
  current: Totals | null,
  previous: Totals | null,
  comparable: boolean,
): MetricComparison[] {
  const types: [string, string][] = [
    ["lead", "Leads"],
    ["purchase", "Compras"],
    ["complete_registration", "Cadastros completos"],
  ];
  return types.map(([type, label]) => {
    const cur = current ? (current.actions[type] ?? 0) : null;
    const prev = previous ? (previous.actions[type] ?? 0) : null;
    const ok = comparable && cur !== null && prev !== null;
    return {
      key: "results",
      label,
      format: "decimal",
      current: cur,
      previous: prev,
      deltaAbs: ok ? cur - prev : null,
      deltaPct: ok && prev !== 0 ? (cur - prev) / prev : null,
      lowerIsBetter: false,
      note: cur === null ? NOTE_NO_DATA : null,
    };
  });
}

// ── rótulos ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  ENABLED: "Ativa",
  PAUSED: "Pausada",
  REMOVED: "Removida",
};

export function statusLabel(status: string | null): string | null {
  if (!status) return null;
  return STATUS_LABEL[status] ?? status;
}

const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_LEADS: "Objetivo: cadastros",
  OUTCOME_SALES: "Objetivo: vendas",
  OUTCOME_TRAFFIC: "Objetivo: tráfego",
  OUTCOME_AWARENESS: "Objetivo: reconhecimento",
  OUTCOME_ENGAGEMENT: "Objetivo: engajamento",
  OUTCOME_APP_PROMOTION: "Objetivo: promoção de app",
};

const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: "Pesquisa",
  DISPLAY: "Display",
  PERFORMANCE_MAX: "Performance Max",
  VIDEO: "Vídeo",
  SHOPPING: "Shopping",
  DEMAND_GEN: "Demand Gen",
  MULTI_CHANNEL: "App",
  SMART: "Inteligente",
  LOCAL: "Local",
};

/** Objetivo (Meta) ou tipo de canal (Google), rotulado; código desconhecido sai cru. */
export function kindLabel(platform: AdPlatform, objective: string | null, channel: string | null): string | null {
  if (platform === "meta_ads") return objective ? (OBJECTIVE_LABEL[objective] ?? `Objetivo: ${objective}`) : null;
  return channel ? (CHANNEL_LABEL[channel] ?? channel) : null;
}

/** Tipo de grupo/anúncio do Google, legível (o código cru, sem sublinhado). */
export function typeLabel(type: string | null): string | null {
  if (!type || type === "UNSPECIFIED" || type === "UNKNOWN") return null;
  return type.toLowerCase().replace(/_/g, " ");
}
