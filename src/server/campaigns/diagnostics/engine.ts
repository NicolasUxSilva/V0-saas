/**
 * Motor de diagnóstico de campanhas — PURO e DETERMINÍSTICO (sem banco, rede, relógio,
 * aleatoriedade nem LLM). Recebe os mesmos agregados da área Campanhas (`../read.ts`) e
 * as regras de cobertura da Fase 1 (`../period.ts`, `../compose.ts`) e devolve
 * diagnósticos explicáveis: o que mudou, onde, com que evidência, quão grave e quão certo.
 *
 * Como funciona:
 *  1. monta a árvore plataforma → campanha → grupo/conjunto → anúncio ("unidades"), com os
 *     totais de cada período JÁ decididos pela cobertura (ausência ≠ zero);
 *  2. roda as regras A–E em cada unidade e F em cada nível com filhos;
 *  3. remove duplicatas: o mesmo tipo num filho de quem já tem esse tipo vira "também
 *     aparece em…" do pai; dentro da mesma unidade, um sinal que implica outro absorve-o;
 *  4. acrescenta as limitações dos dados (G) por plataforma;
 *  5. ordena por prioridade (severidade × confiança × peso financeiro).
 *
 * Limiares: `./thresholds.ts`. Estatística: `./stats.ts`.
 */
import type { AdPlatform, CampaignFilters, MetricComparison, PlatformPanel, ResultDefinition } from "@/lib/campaigns";
import type {
  CampaignDiagnostic,
  DiagnosticConfidence,
  DiagnosticEntity,
  DiagnosticKind,
  DiagnosticLevel,
  DiagnosticSeverity,
  DiagnosticType,
  EvidenceFact,
  LimitationReason,
  RelatedEntity,
} from "@/lib/campaign-diagnostics";
import { addDays } from "@/lib/dates";
import { formatMoney } from "@/lib/format";

import {
  detailCoverage,
  detailCovers,
  entityTotals,
  orZero,
  type CampaignAggregate,
  type DetailSpan,
  type PlatformFacts,
} from "../compose";
import {
  EMPTY_TOTALS,
  GROUP_LEVEL_LABEL,
  PLATFORM_LABEL,
  addTotals,
  compareMetric,
  resultDefinition,
  resultsOf,
  type Totals,
} from "../metrics";
import { coverageNote, filtersToQuery } from "../period";
import { costPerCountZ, poissonDiffZ, twoProportionZ } from "./stats";
import {
  A,
  B,
  C,
  D,
  CPM_STABLE_BAND,
  E,
  F,
  IMPROVEMENT,
  MIN_CLOSED_DAY_SHARE,
  SHARE_LOWERS_SEVERITY,
  SHARE_RAISES_SEVERITY,
  Z_HIGH,
  Z_MEDIUM,
} from "./thresholds";

// ── entrada ───────────────────────────────────────────────────────────

/** Um grupo/conjunto (`adId = ""`) ou anúncio, com somas por período. */
export interface DetailNode {
  level: "ad_group" | "ad";
  campaignId: string;
  adGroupId: string;
  adGroupName: string;
  adId: string;
  name: string;
  status: string | null;
  current: Totals | null;
  previous: Totals | null;
}

export interface PlatformDiagnosticInput {
  facts: PlatformFacts;
  panel: PlatformPanel;
  campaigns: CampaignAggregate[];
  detail: {
    /** a tabela de detalhe existe (migração 0005) */
    ready: boolean;
    groupSpan: DetailSpan;
    adSpan: DetailSpan;
    nodes: DetailNode[];
  };
}

// ── unidades ──────────────────────────────────────────────────────────

type UnitLevel = "campaign" | "ad_group" | "ad";

interface Unit {
  key: string;
  platform: AdPlatform;
  level: UnitLevel;
  name: string;
  entity: DiagnosticEntity;
  def: ResultDefinition | null;
  currency: string | null;
  /** dados em mais de uma moeda (troca de conta): fora de totais e comparações */
  mixed: boolean;
  cur: Totals | null;
  prev: Totals | null;
  /** os dois períodos estão cobertos NESTE nível (importação + detalhe) e são comparáveis */
  comparable: boolean;
  /** o período atual está coberto o bastante para regras só do período atual */
  currentUsable: boolean;
  parent: Unit | null;
  children: Unit[];
  /** fatia do investimento da plataforma na mesma moeda (período atual) */
  share: number | null;
}

interface PlatformCtx {
  platform: AdPlatform;
  filters: CampaignFilters;
  panel: PlatformPanel;
  /** fração de dias fechados no período atual */
  closedShare: number;
  /** o período atual alcança os dias que a plataforma ainda pode reprocessar */
  unsettled: boolean;
  query: string;
}

const LEVEL_LABEL = (platform: AdPlatform, level: DiagnosticLevel): string =>
  level === "platform"
    ? "Plataforma"
    : level === "campaign"
      ? "Campanha"
      : level === "ad"
        ? "Anúncio"
        : GROUP_LEVEL_LABEL[platform].one;

const CHILDREN_LABEL = (platform: AdPlatform, level: UnitLevel): string =>
  level === "campaign" ? GROUP_LEVEL_LABEL[platform].many.toLowerCase() : "anúncios";

const currencyKey = (c: string | null) => c ?? "";

function buildUnits(input: PlatformDiagnosticInput, ctx: PlatformCtx): Unit[] {
  const { panel, campaigns, detail } = input;
  const { filters, platform, query } = ctx;
  const coverage = panel.coverage;
  if (!coverage) return [];

  const campaignUnits: Unit[] = campaigns.map((agg) => {
    const mixed = agg.currencies.length + (agg.hasNullCurrency ? 1 : 0) > 1;
    const definitionChanged = (agg.objectives?.length ?? 0) > 1;
    const href = `/campanhas/${platform}/${encodeURIComponent(agg.campaignId)}${query}`;
    const name = agg.name || `Campanha ${agg.campaignId}`;
    return {
      key: `${platform}:${agg.campaignId}`,
      platform,
      level: "campaign",
      name,
      entity: { campaignId: agg.campaignId, campaignName: name, adGroupId: null, adGroupName: null, adId: null, adName: null, href },
      def: resultDefinition(platform, agg.objective),
      currency: mixed ? null : (agg.currencies[0] ?? null),
      mixed,
      cur: orZero(agg.current, coverage.current),
      prev: filters.previous ? orZero(agg.previous, coverage.previous) : null,
      comparable: panel.comparable && !mixed && !definitionChanged,
      currentUsable: !mixed && ctx.closedShare >= MIN_CLOSED_DAY_SHARE,
      parent: null,
      children: [],
      share: null,
    };
  });

  const byCampaign = new Map(campaignUnits.map((u) => [u.entity.campaignId!, u]));
  const groupUnits = new Map<string, Unit>();
  if (detail.ready) {
    const groupCov = detailCoverage(detail.groupSpan, filters);
    const adCov = detailCoverage(detail.adSpan, filters);
    for (const n of detail.nodes.filter((x) => x.level === "ad_group")) {
      const parent = byCampaign.get(n.campaignId);
      if (!parent) continue;
      const { cur, prev } = entityTotals(n, { span: detail.groupSpan, coverage, filters });
      const name = n.name || `${GROUP_LEVEL_LABEL[platform].one} ${n.adGroupId}`;
      const u: Unit = {
        key: `${parent.key}/${n.adGroupId}`,
        platform,
        level: "ad_group",
        name,
        entity: {
          ...parent.entity,
          adGroupId: n.adGroupId,
          adGroupName: name,
          href: `/campanhas/${platform}/${encodeURIComponent(n.campaignId)}/${encodeURIComponent(n.adGroupId)}${query}`,
        },
        def: parent.def,
        currency: parent.currency,
        mixed: parent.mixed,
        cur,
        prev,
        comparable: parent.comparable && groupCov.coversCurrent && groupCov.coversPrevious,
        currentUsable: parent.currentUsable && groupCov.coversCurrent,
        parent,
        children: [],
        share: null,
      };
      parent.children.push(u);
      groupUnits.set(u.key, u);
    }
    for (const n of detail.nodes.filter((x) => x.level === "ad")) {
      const parent = groupUnits.get(`${platform}:${n.campaignId}/${n.adGroupId}`);
      if (!parent) continue;
      const { cur, prev } = entityTotals(n, { span: detail.adSpan, coverage, filters });
      const name = n.name || `Anúncio ${n.adId}`;
      parent.children.push({
        key: `${parent.key}/${n.adId}`,
        platform,
        level: "ad",
        name,
        entity: { ...parent.entity, adId: n.adId, adName: name },
        def: parent.def,
        currency: parent.currency,
        mixed: parent.mixed,
        cur,
        prev,
        comparable: parent.comparable && adCov.coversCurrent && adCov.coversPrevious,
        currentUsable: parent.currentUsable && adCov.coversCurrent,
        parent,
        children: [],
        share: null,
      });
    }
  }

  // fatia do investimento da plataforma, por moeda (campanhas com mais de uma moeda ficam de fora)
  const totalBy = new Map<string, number>();
  for (const u of campaignUnits) {
    if (u.mixed) continue;
    const k = currencyKey(u.currency);
    totalBy.set(k, (totalBy.get(k) ?? 0) + (u.cur?.cost ?? 0));
  }
  const all = flatten(campaignUnits);
  for (const u of all) {
    const total = totalBy.get(currencyKey(u.currency)) ?? 0;
    u.share = !u.mixed && total > 0 && u.cur ? u.cur.cost / total : null;
  }
  return campaignUnits;
}

function flatten(units: Unit[]): Unit[] {
  return units.flatMap((u) => [u, ...flatten(u.children)]);
}

// ── auxiliares de severidade e confiança ──────────────────────────────

const SEV_ORDER: DiagnosticSeverity[] = ["low", "medium", "high"];

function bySize(value: number, medium: number, high: number): DiagnosticSeverity {
  return value >= high ? "high" : value >= medium ? "medium" : "low";
}

/** Peso financeiro: sobe um nível com ≥ 20% do gasto, desce um com < 5%. */
export function weighSeverity(sev: DiagnosticSeverity, share: number | null): DiagnosticSeverity {
  if (sev === "info" || share === null) return sev;
  const i = SEV_ORDER.indexOf(sev);
  if (share >= SHARE_RAISES_SEVERITY) return SEV_ORDER[Math.min(i + 1, 2)]!;
  if (share < SHARE_LOWERS_SEVERITY) return SEV_ORDER[Math.max(i - 1, 0)]!;
  return sev;
}

/** Confiança pela evidência estatística; `null` = abaixo do mínimo (inconclusivo). */
export function confidenceFromZ(z: number | null): DiagnosticConfidence | null {
  if (z === null) return null;
  return z >= Z_HIGH ? "high" : z >= Z_MEDIUM ? "medium" : null;
}

function lower(c: DiagnosticConfidence): DiagnosticConfidence {
  return c === "high" ? "medium" : "low";
}

const SEV_W: Record<DiagnosticSeverity, number> = { high: 3, medium: 2, low: 1, info: 0.4 };
const CONF_W: Record<DiagnosticConfidence, number> = { high: 1, medium: 0.7, low: 0.4 };

const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const pct0 = (v: number) => `${nf1.format(Math.round(v * 1000) / 10)}%`;
/** probabilidade pequena sem arredondar para "0%" */
const chance = (p: number) => (p < 0.001 ? "< 0,1%" : `~${pct0(p)}`);
const BR = (iso: string) => iso.split("-").reverse().join("/");

/** "Conversões" → "conversões reportadas"; "Leads" → "leads reportados". */
function resultPhrase(def: ResultDefinition): string {
  const plural = def.label.toLowerCase();
  return `${plural} reportad${def.key === "meta_lead" ? "os" : "as"}`;
}

// ── rascunho de diagnóstico ───────────────────────────────────────────

interface Draft {
  type: DiagnosticType;
  kind: DiagnosticKind;
  unit: Unit | null;
  platform: AdPlatform;
  level: DiagnosticLevel;
  entity: DiagnosticEntity;
  title: string;
  description: string;
  evidence: MetricComparison[];
  facts: EvidenceFact[];
  currency: string | null;
  severity: DiagnosticSeverity;
  confidence: DiagnosticConfidence;
  limitation: string | null;
  limitationReason: LimitationReason | null;
  nextCheck: string;
  metrics: string[];
  related: RelatedEntity[];
  /** variação da métrica principal (para "também aparece em…") */
  mainDelta: number | null;
  share: number | null;
  /** E: a queda acompanha a do investimento (custo por resultado estável) */
  followsSpend?: boolean;
}

function base(u: Unit): Pick<Draft, "unit" | "platform" | "level" | "entity" | "currency" | "related" | "share"> {
  return { unit: u, platform: u.platform, level: u.level, entity: u.entity, currency: u.currency, related: [], share: u.share };
}

function evidenceOf(u: Unit, keys: Parameters<typeof compareMetric>[0]["key"][]): MetricComparison[] {
  return keys.map((key) =>
    compareMetric({ key, platform: u.platform, def: u.def, current: u.cur, previous: u.prev, comparable: u.comparable }),
  );
}

const UNSETTLED_NOTE = (ctx: PlatformCtx) =>
  `O período inclui dias que o ${PLATFORM_LABEL[ctx.platform]} ainda pode reprocessar (últimos ${ctx.panel.restatementDays} dias): resultados atribuídos com atraso podem mudar este quadro.`;

// ── A: investimento sem resultados ────────────────────────────────────

function nextCheckNoResults(u: Unit): string {
  const where =
    u.level === "campaign"
      ? ""
      : u.level === "ad"
        ? ` Compare com os anúncios do mesmo ${GROUP_LEVEL_LABEL[u.platform].one.toLowerCase()} que têm resultados.`
        : ` Compare com os ${GROUP_LEVEL_LABEL[u.platform].many.toLowerCase()} da mesma campanha que têm resultados.`;
  if (u.def?.key === "google_conversions") {
    return `Confira em Metas › Conversões se as ações incluídas em "Conversões" estão registrando e se esta ${u.level === "campaign" ? "campanha" : "entidade"} otimiza para uma delas; depois, termos de pesquisa e páginas de destino.${where}`;
  }
  if (u.def?.key === "meta_lead") {
    return `Confira se o evento de lead (formulário instantâneo ou pixel/API de conversões) está disparando e se a otimização do conjunto é para leads.${where}`;
  }
  return `Confira se o evento de compra (pixel/API de conversões) está disparando e se a otimização do conjunto é para compras.${where}`;
}

function ruleCostWithoutResults(u: Unit, ctx: PlatformCtx, reference: { cpr: number; source: string } | null): Draft | null {
  if (!u.def || !u.cur || !u.currentUsable || u.cur.cost <= 0) return null;
  if ((resultsOf(u.def, u.cur) ?? 0) > 0 || !reference) return null;

  const expected = u.cur.cost / reference.cpr;
  if (expected < A.MIN_EXPECTED) return null;

  const kind: DiagnosticKind = expected >= A.EXPECTED_MEDIUM ? "finding" : "inconclusive";
  let confidence: DiagnosticConfidence = expected >= A.EXPECTED_HIGH ? "high" : expected >= A.EXPECTED_MEDIUM ? "medium" : "low";
  const caveats: string[] = [];
  if (ctx.unsettled) {
    confidence = lower(confidence);
    caveats.push(UNSETTLED_NOTE(ctx));
  }
  if (ctx.closedShare < 1) {
    confidence = lower(confidence);
    caveats.push("Nem todos os dias do período foram importados por completo.");
  }
  const pZero = Math.exp(-expected);
  const prevResults = u.prev && u.comparable ? resultsOf(u.def, u.prev) : null;
  const money = formatMoney(u.cur.cost, u.currency);

  return {
    ...base(u),
    type: "cost_without_results",
    kind,
    title: `${money} investidos sem ${resultPhrase(u.def)}`,
    description:
      `${LEVEL_LABEL(u.platform, u.level)} "${u.name}" investiu ${money} no período sem nenhum resultado (${u.def.label}). ` +
      `Ao custo por resultado de referência (${formatMoney(reference.cpr, u.currency)}, ${reference.source}), esse investimento ` +
      `corresponderia a cerca de ${nf1.format(expected)} resultados; zero por acaso teria chance de ${chance(pZero)}.` +
      (prevResults !== null && prevResults > 0 ? ` No período anterior foram ${nf1.format(prevResults)}.` : "") +
      (caveats.length ? ` ${caveats.join(" ")}` : ""),
    evidence: evidenceOf(u, ["cost", "results", "clicks"]),
    facts: [
      { label: "Custo por resultado de referência", value: reference.cpr, format: "money" },
      { label: "Resultados esperados a esse custo", value: expected, format: "decimal" },
      { label: "Chance de zero por acaso", value: pZero, format: "rate" },
    ],
    severity: weighSeverity(bySize(expected, A.SEVERITY_MEDIUM, A.SEVERITY_HIGH), u.share),
    confidence,
    limitation: kind === "inconclusive" ? "Pouco investimento em relação ao custo por resultado de referência: o zero ainda pode ser acaso." : null,
    limitationReason: kind === "inconclusive" ? "low_volume" : null,
    nextCheck: nextCheckNoResults(u),
    metrics: ["cost", "results", "cost_per_result"],
    mainDelta: null,
  };
}

// ── B: custo por resultado (alta) e melhora ───────────────────────────

function ruleCostPerResult(u: Unit, ctx: PlatformCtx): Draft | null {
  if (!u.comparable || !u.def || !u.cur || !u.prev) return null;
  const rc = resultsOf(u.def, u.cur) ?? 0;
  const rp = resultsOf(u.def, u.prev) ?? 0;
  if (rc < B.MIN_RESULTS || rp < B.MIN_RESULTS || u.cur.cost <= 0 || u.prev.cost <= 0) return null;
  const change = u.cur.cost / rc / (u.prev.cost / rp) - 1;
  const z = costPerCountZ(u.cur.cost, rc, u.prev.cost, rp);
  const evidence = evidenceOf(u, ["cost_per_result", "results", "cost", "cpc"]);

  if (change <= -IMPROVEMENT.MIN_DECREASE && rc >= IMPROVEMENT.MIN_RESULTS && z !== null && -z >= Z_MEDIUM) {
    return {
      ...base(u),
      type: "cost_per_result_improvement",
      kind: "finding",
      title: `Custo por resultado caiu ${pct0(-change)}`,
      description:
        `Em "${u.name}", o custo por resultado (${u.def.label}) caiu de ${formatMoney(u.prev.cost / rp, u.currency)} para ` +
        `${formatMoney(u.cur.cost / rc, u.currency)} entre os períodos, com volume suficiente para descartar ruído (z = ${nf1.format(-z)}).`,
      evidence,
      facts: [],
      severity: "info",
      confidence: confidenceFromZ(-z) ?? "medium",
      limitation: null,
      limitationReason: null,
      nextCheck: "Identifique o que mudou (público, criativo, lance, página) para preservar o ganho — e confira se a qualidade dos resultados acompanhou.",
      metrics: ["cost_per_result", "results", "cost"],
      mainDelta: change,
    };
  }
  if (change < B.MIN_INCREASE) return null;

  const conf = confidenceFromZ(z);
  let confidence: DiagnosticConfidence = conf ?? "low";
  const caveats: string[] = [];
  if (conf && ctx.unsettled) {
    confidence = lower(confidence);
    caveats.push(UNSETTLED_NOTE(ctx));
  }
  return {
    ...base(u),
    type: "cost_per_result_increase",
    kind: conf ? "finding" : "inconclusive",
    title: `Custo por resultado subiu ${pct0(change)}`,
    description:
      `Em "${u.name}", o custo por resultado (${u.def.label}) foi de ${formatMoney(u.prev.cost / rp, u.currency)} para ` +
      `${formatMoney(u.cur.cost / rc, u.currency)} (${nf1.format(rp)} → ${nf1.format(rc)} resultados).` +
      (caveats.length ? ` ${caveats.join(" ")}` : ""),
    evidence,
    facts: z !== null ? [{ label: Z_LABEL, value: z, format: "decimal" }] : [],
    severity: weighSeverity(bySize(change, B.SEVERITY_MEDIUM, B.SEVERITY_HIGH), u.share),
    confidence,
    limitation: conf ? null : "Poucos resultados nos dois períodos: a alta pode ser ruído.",
    limitationReason: conf ? null : "low_volume",
    nextCheck: `Veja se a alta veio do CPC (leilão, concorrência, lance) ou da taxa de conversão (página, oferta, público): compare o CPC abaixo${u.children.length ? ` e os ${CHILDREN_LABEL(u.platform, u.level)}` : ""}.`,
    metrics: ["cost_per_result", "results", "cost", "cpc"],
    mainDelta: change,
  };
}

// ── C: CTR caiu ───────────────────────────────────────────────────────

function ruleCtrDrop(u: Unit): Draft | null {
  if (!u.comparable || !u.cur || !u.prev) return null;
  const { cur, prev } = u;
  if (cur.impressions < C.MIN_IMPRESSIONS || prev.impressions < C.MIN_IMPRESSIONS || prev.clicks < C.MIN_PREVIOUS_CLICKS) return null;
  const ctrC = cur.clicks / cur.impressions;
  const ctrP = prev.clicks / prev.impressions;
  const drop = 1 - ctrC / ctrP;
  if (drop < C.MIN_DROP) return null;
  const z = twoProportionZ(prev.clicks, prev.impressions, cur.clicks, cur.impressions);
  const conf = confidenceFromZ(z);
  const clickWord = u.platform === "meta_ads" ? "CTR de link" : "CTR";
  return {
    ...base(u),
    type: "ctr_drop",
    kind: conf ? "finding" : "inconclusive",
    title: `${clickWord} caiu ${pct0(drop)}`,
    description:
      `Em "${u.name}", o ${clickWord} passou de ${pct0(ctrP)} para ${pct0(ctrC)} ` +
      `(${nf1.format(prev.clicks)} cliques em ${nf1.format(prev.impressions)} impressões → ${nf1.format(cur.clicks)} em ${nf1.format(cur.impressions)}).` +
      (u.platform === "meta_ads" ? " Conta só cliques no link, não curtidas ou comentários." : ""),
    evidence: evidenceOf(u, ["ctr", "clicks", "impressions"]),
    facts: z !== null ? [{ label: Z_LABEL, value: z, format: "decimal" }] : [],
    severity: weighSeverity(bySize(drop, C.SEVERITY_MEDIUM, C.SEVERITY_HIGH), u.share),
    confidence: conf ?? "low",
    limitation: conf ? null : "Volume de cliques pequeno para separar a queda do ruído.",
    limitationReason: conf ? null : "low_volume",
    nextCheck:
      u.platform === "meta_ads"
        ? "Compare os anúncios: frequência alta, criativo repetido ou mudança de público/posicionamento costumam derrubar o CTR de link."
        : "Compare os anúncios e os termos de pesquisa: correspondências mais amplas, novos termos ou anúncios menos relevantes costumam derrubar o CTR.",
    metrics: ["ctr", "clicks", "impressions"],
    mainDelta: -drop,
  };
}

// ── D: CPC subiu ──────────────────────────────────────────────────────

function ruleCpcIncrease(u: Unit): Draft | null {
  if (!u.comparable || !u.cur || !u.prev) return null;
  const { cur, prev } = u;
  if (cur.clicks < D.MIN_CLICKS || prev.clicks < D.MIN_CLICKS || cur.cost <= 0 || prev.cost <= 0) return null;
  const increase = cur.cost / cur.clicks / (prev.cost / prev.clicks) - 1;
  if (increase < D.MIN_INCREASE) return null;
  const z = costPerCountZ(cur.cost, cur.clicks, prev.cost, prev.clicks);
  const conf = confidenceFromZ(z);
  const label = u.platform === "meta_ads" ? "CPC de link" : "CPC";
  return {
    ...base(u),
    type: "cpc_increase",
    kind: conf ? "finding" : "inconclusive",
    title: `${label} subiu ${pct0(increase)}`,
    description:
      `Em "${u.name}", o ${label} foi de ${formatMoney(prev.cost / prev.clicks, u.currency)} para ${formatMoney(cur.cost / cur.clicks, u.currency)} ` +
      `(${nf1.format(prev.clicks)} → ${nf1.format(cur.clicks)} cliques).`,
    evidence: evidenceOf(u, ["cpc", "clicks", "cost", "cpm"]),
    facts: z !== null ? [{ label: Z_LABEL, value: z, format: "decimal" }] : [],
    severity: weighSeverity(bySize(increase, D.SEVERITY_MEDIUM, D.SEVERITY_HIGH), u.share),
    confidence: conf ?? "low",
    limitation: conf ? null : "Poucos cliques para separar a alta do ruído.",
    limitationReason: conf ? null : "low_volume",
    nextCheck:
      u.platform === "meta_ads"
        ? "Veja se o CPM também subiu (leilão mais caro, público menor) ou se o CTR caiu (mais impressões por clique)."
        : "Veja mudanças de lance ou estratégia, orçamento e concorrência (Insights de leilão); se o CPM subiu junto, o leilão ficou mais caro.",
    metrics: ["cpc", "clicks", "cost", "cpm"],
    mainDelta: increase,
  };
}

// ── E: resultados caíram ──────────────────────────────────────────────

function ruleResultsDrop(u: Unit, ctx: PlatformCtx): Draft | null {
  if (!u.comparable || !u.def || !u.cur || !u.prev) return null;
  const rp = resultsOf(u.def, u.prev) ?? 0;
  const rc = resultsOf(u.def, u.cur) ?? 0;
  if (rp < E.MIN_PREVIOUS_RESULTS) return null;
  const drop = 1 - rc / rp;
  if (drop < E.MIN_DROP) return null;
  const z = poissonDiffZ(rp, rc);
  const conf = confidenceFromZ(z);
  let confidence: DiagnosticConfidence = conf ?? "low";
  const caveats: string[] = [];
  if (conf && ctx.unsettled) {
    confidence = lower(confidence);
    caveats.push(UNSETTLED_NOTE(ctx));
  }

  const cprChange = rc > 0 && u.prev.cost > 0 ? u.cur.cost / rc / (u.prev.cost / rp) - 1 : null;
  const followsSpend = cprChange !== null && Math.abs(cprChange) <= E.STABLE_CPR_BAND && u.cur.cost < u.prev.cost;
  const spendChange = u.prev.cost > 0 ? u.cur.cost / u.prev.cost - 1 : null;

  return {
    ...base(u),
    type: "results_drop",
    kind: conf ? "finding" : "inconclusive",
    title: followsSpend
      ? `${u.def.label} caíram ${pct0(drop)}, junto com o investimento`
      : `${u.def.label} caíram ${pct0(drop)}`,
    description:
      `Em "${u.name}", ${resultPhrase(u.def)} foram de ${nf1.format(rp)} para ${nf1.format(rc)}.` +
      (spendChange !== null ? ` O investimento variou ${spendChange >= 0 ? "+" : "−"}${pct0(Math.abs(spendChange))}.` : "") +
      (followsSpend
        ? " O custo por resultado ficou estável: a queda acompanha a redução do investimento, não uma piora de eficiência."
        : cprChange !== null && cprChange > E.STABLE_CPR_BAND
          ? ` O custo por resultado subiu ${pct0(cprChange)}: a eficiência piorou.`
          : "") +
      (caveats.length ? ` ${caveats.join(" ")}` : ""),
    evidence: evidenceOf(u, ["results", "cost", "cost_per_result", "clicks"]),
    facts: z !== null ? [{ label: Z_LABEL, value: z, format: "decimal" }] : [],
    severity: followsSpend ? "low" : weighSeverity(bySize(drop, E.SEVERITY_MEDIUM, E.SEVERITY_HIGH), u.share),
    confidence,
    limitation: conf ? null : "Poucos resultados para separar a queda do ruído.",
    limitationReason: conf ? null : "low_volume",
    nextCheck: followsSpend
      ? "Confirme se a redução de investimento foi intencional (orçamento, pausas, sazonalidade)."
      : `Confira mudanças de orçamento, pausas${u.children.length ? ` de ${CHILDREN_LABEL(u.platform, u.level)}` : ""} e alterações no rastreamento de ${u.def.label.toLowerCase()} no período.`,
    metrics: ["results", "cost", "cost_per_result"],
    mainDelta: -drop,
    followsSpend,
  };
}

// ── F: distribuição do investimento entre os filhos ───────────────────

function ruleDistribution(
  parent: { unit: Unit | null; name: string; children: Unit[]; cur: Totals | null; def: ResultDefinition | null; share: number | null },
  ctx: PlatformCtx,
  childLevel: UnitLevel,
): Draft[] {
  const out: Draft[] = [];
  const kids = parent.children.filter((c) => c.currentUsable && c.cur && c.cur.cost > 0);
  const parentCost = kids.reduce((s, c) => s + (c.cur?.cost ?? 0), 0);
  if (kids.length < 2 || parentCost <= 0) return out;
  const first = kids[0]!;
  const childrenName =
    childLevel === "campaign" ? "campanhas" : childLevel === "ad" ? "anúncios" : GROUP_LEVEL_LABEL[ctx.platform].many.toLowerCase();
  const level: DiagnosticLevel = parent.unit ? parent.unit.level : "platform";
  const entity: DiagnosticEntity = parent.unit
    ? parent.unit.entity
    : { campaignId: null, campaignName: null, adGroupId: null, adGroupName: null, adId: null, adName: null, href: null };
  const currency = first.currency;
  const common = {
    unit: parent.unit,
    platform: ctx.platform,
    level,
    entity,
    currency,
    share: parent.share,
    limitation: null,
    limitationReason: null,
    mainDelta: null,
  } as const;
  const related = (list: Unit[]): RelatedEntity[] =>
    list.map((c) => ({ level: c.level, name: c.name, href: c.entity.href, deltaPct: c.cur ? c.cur.cost / parentCost : null }));

  // zero resultados: só faz sentido se o pai TEM resultados (senão o problema é do pai — regra A)
  const parentResults = parent.def && parent.cur ? (resultsOf(parent.def, parent.cur) ?? 0) : 0;
  if (parent.def && parentResults > 0) {
    const zero = kids.filter((c) => c.def && (resultsOf(c.def, c.cur!) ?? 0) === 0);
    const zeroCost = zero.reduce((s, c) => s + c.cur!.cost, 0);
    const share = zeroCost / parentCost;
    // referência = custo por resultado dos filhos QUE converteram (sem o gasto dos zerados)
    const expected = parentCost - zeroCost > 0 ? zeroCost / ((parentCost - zeroCost) / parentResults) : 0;
    if (zero.length >= 2 && share >= F.ZERO_RESULT_SHARE && expected >= A.MIN_EXPECTED) {
      let confidence: DiagnosticConfidence = expected >= A.EXPECTED_HIGH ? "high" : expected >= A.EXPECTED_MEDIUM ? "medium" : "low";
      if (ctx.unsettled) confidence = lower(confidence);
      out.push({
        ...common,
        type: "spend_without_results_share",
        kind: expected >= A.EXPECTED_MEDIUM ? "finding" : "inconclusive",
        title: `${pct0(share)} do investimento em ${childrenName} sem resultados`,
        description:
          `Em ${parent.unit ? `"${parent.name}"` : PLATFORM_LABEL[ctx.platform]}, ${zero.length} de ${kids.length} ${childrenName} ` +
          `somaram ${formatMoney(zeroCost, currency)} (${pct0(share)} do investimento) sem nenhum resultado (${parent.def.label}), ` +
          `enquanto o conjunto teve ${nf1.format(parentResults)}.`,
        evidence: [],
        facts: [
          { label: "Investimento sem resultados", value: zeroCost, format: "money" },
          { label: "Fatia do investimento", value: share, format: "rate" },
          { label: "Resultados esperados ao custo médio", value: expected, format: "decimal" },
        ],
        severity: weighSeverity(bySize(share, F.ZERO_RESULT_SHARE_MEDIUM, F.ZERO_RESULT_SHARE_HIGH), parent.share),
        confidence,
        nextCheck: `Revise os ${childrenName} sem resultados listados abaixo antes de redistribuir: confirme se tiveram tempo e volume para converter.`,
        metrics: ["cost", "results"],
        related: related(zero),
      });
    }
  }

  // concentração (informativo — não é problema por si)
  if (kids.length >= F.MIN_CHILDREN) {
    const top = [...kids].sort((a, b) => b.cur!.cost - a.cur!.cost)[0]!;
    const share = top.cur!.cost / parentCost;
    if (share >= F.CONCENTRATION_SHARE) {
      out.push({
        ...common,
        type: "spend_concentration",
        kind: "finding",
        title: `${pct0(share)} do investimento em ${childLevel === "campaign" ? "uma só campanha" : childLevel === "ad" ? "um só anúncio" : `um só ${GROUP_LEVEL_LABEL[ctx.platform].one.toLowerCase()}`}`,
        description:
          `Em ${parent.unit ? `"${parent.name}"` : PLATFORM_LABEL[ctx.platform]}, "${top.name}" concentrou ${formatMoney(top.cur!.cost, currency)} ` +
          `de ${formatMoney(parentCost, currency)} entre ${kids.length} ${childrenName}. Isto descreve a distribuição; não indica, sozinho, ` +
          `que os demais sejam piores — receber menos investimento pode ser decisão de orçamento ou da otimização automática.`,
        evidence: [],
        facts: [{ label: "Fatia do maior", value: share, format: "rate" }],
        severity: "info",
        confidence: "high",
        nextCheck: "Confirme se a concentração é intencional (orçamento, otimização automática) antes de qualquer redistribuição.",
        metrics: ["cost"],
        related: related([top]),
      });
    }
  }
  return out;
}

// ── G: limitações dos dados ───────────────────────────────────────────

function limitation(
  ctx: PlatformCtx,
  reason: LimitationReason,
  title: string,
  description: string,
  nextCheck: string,
  severity: DiagnosticSeverity,
  related: RelatedEntity[] = [],
): Draft {
  return {
    type: "data_limitation",
    kind: "limitation",
    unit: null,
    platform: ctx.platform,
    level: "platform",
    entity: { campaignId: null, campaignName: null, adGroupId: null, adGroupName: null, adId: null, adName: null, href: null },
    title,
    description,
    evidence: [],
    facts: [],
    currency: null,
    severity,
    confidence: "high",
    limitation: description,
    limitationReason: reason,
    nextCheck,
    metrics: [],
    related,
    mainDelta: null,
    share: null,
  };
}

const LIMIT_ORDER: LimitationReason[] = [
  "source_unavailable",
  "stale_data",
  "import_incomplete",
  "no_results_anywhere",
  "comparison_unavailable",
  "detail_unavailable",
  "result_definition_changed",
  "currency_mixed",
  "result_undefined",
  "low_volume",
  "recent_data_unsettled",
  "comparison_off",
];

function limitations(input: PlatformDiagnosticInput, ctx: PlatformCtx, campaigns: Unit[]): Draft[] {
  const { panel, facts, detail } = input;
  const { filters } = ctx;
  const label = PLATFORM_LABEL[ctx.platform];
  const out: Draft[] = [];
  const toConexoes = "Abra Conexões para ver o estado da importação e, se for o caso, importe de novo.";

  if (panel.source.health === "not_connected") {
    out.push(limitation(ctx, "source_unavailable", `${label} não conectado`, `Sem conexão com o ${label}: nenhuma campanha desta plataforma é analisada.`, `Conecte o ${label} em Conexões.`, "info"));
    return out;
  }
  if (panel.source.health !== "synced") {
    out.push(limitation(ctx, "source_unavailable", `${label}: ${panel.source.summary}`, `${panel.source.summary} Enquanto isso, o diagnóstico usa só o que já foi importado.`, toConexoes, "medium"));
  }
  const cov = panel.coverage;
  if (!cov) return out;

  const lastImported = facts.runs.reduce<string | null>((m, r) => (m === null || r.periodEnd > m ? r.periodEnd : m), null);
  if (cov.current.state === "none") {
    out.push(limitation(ctx, "import_incomplete", `${label}: período sem importação`, "Nenhum dia do período escolhido foi importado: não há o que diagnosticar.", toConexoes, "medium"));
    return out;
  }
  if (lastImported !== null && lastImported < filters.current.end) {
    out.push(
      limitation(
        ctx,
        "stale_data",
        `${label}: dados desatualizados`,
        `A importação mais recente vai até ${BR(lastImported)}; os dias seguintes do período não foram importados. Regras que dependem do período inteiro foram suspensas ou têm confiança reduzida.`,
        toConexoes,
        "medium",
      ),
    );
  } else if (cov.current.state !== "complete") {
    out.push(limitation(ctx, "import_incomplete", `${label}: importação incompleta`, coverageNote("Período atual", cov.current) ?? "", toConexoes, "medium"));
  }

  if (!filters.previous) {
    out.push(limitation(ctx, "comparison_off", "Comparação desligada", "Sem período de comparação, só as regras do período atual rodam (investimento sem resultados e distribuição).", "Ligue a comparação com o período anterior nos filtros.", "info"));
  } else if (!panel.comparable) {
    out.push(
      limitation(
        ctx,
        "comparison_unavailable",
        `${label}: comparação indisponível`,
        `${panel.comparabilityNote ?? "Os períodos não são comparáveis."} Altas e quedas (custo por resultado, CTR, CPC, resultados) não são avaliadas.`,
        "Escolha um período inteiramente importado ou importe o período anterior.",
        "low",
      ),
    );
  }

  if (ctx.unsettled) {
    out.push(limitation(ctx, "recent_data_unsettled", `${label}: dias recentes ainda podem mudar`, UNSETTLED_NOTE(ctx) + " A confiança dos diagnósticos de resultados foi reduzida.", "Reavalie depois que esses dias saírem da janela de reprocessamento.", "info"));
  }

  const mixed = campaigns.filter((c) => c.mixed && (c.cur?.cost ?? 0) > 0);
  if (mixed.length) {
    out.push(limitation(ctx, "currency_mixed", `${mixed.length} campanha(s) com mais de uma moeda`, "Essas campanhas têm dados em moedas diferentes (troca de conta): ficam fora das comparações e dos totais — moedas não são somadas nem convertidas.", "Confira a conta selecionada em Conexões.", "low", rel(mixed)));
  }
  const undefinedResult = campaigns.filter((c) => !c.def && (c.cur?.cost ?? 0) > 0);
  if (undefinedResult.length) {
    out.push(limitation(ctx, "result_undefined", `${undefinedResult.length} campanha(s) sem definição de resultado`, "O objetivo dessas campanhas (ex.: tráfego, reconhecimento) não tem um resultado importado equivalente: as regras de resultado não se aplicam a elas.", "Avalie essas campanhas por CTR, CPC e CPM, ou no Ads Manager pelo resultado da otimização.", "info", rel(undefinedResult)));
  }
  const changed = input.campaigns.filter((a) => (a.objectives?.length ?? 0) > 1);
  if (changed.length) {
    out.push(limitation(ctx, "result_definition_changed", `${changed.length} campanha(s) mudaram de objetivo`, "O objetivo (e portanto o que conta como resultado) mudou dentro do intervalo analisado: as comparações dessas campanhas foram suspensas.", "Compare a partir da data da mudança de objetivo.", "low", rel(campaigns.filter((c) => changed.some((a) => a.campaignId === c.entity.campaignId)))));
  }

  const lowVolume = campaigns.filter((c) => c.comparable && c.cur && c.prev && (c.cur.cost > 0 || c.prev.cost > 0) && lacksVolume(c));
  if (lowVolume.length) {
    out.push(limitation(ctx, "low_volume", `${lowVolume.length} campanha(s) sem volume para comparar`, "Abaixo dos mínimos de impressões, cliques e resultados de todas as regras de comparação: variações nelas não são avaliadas para não gerar alertas sobre ruído.", "Use um período mais longo para acumular volume.", "info", rel(lowVolume)));
  }

  if (!detail.ready) {
    out.push(limitation(ctx, "detail_unavailable", `${label}: sem detalhe por ${GROUP_LEVEL_LABEL[ctx.platform].one.toLowerCase()} e anúncio`, "A tabela de detalhe ainda não existe neste ambiente (migração 0005): o diagnóstico fica no nível de campanha.", "Aplique a migração 0005 e importe de novo.", "low"));
  } else if (!detail.groupSpan.detailFirst) {
    out.push(limitation(ctx, "detail_unavailable", `${label}: detalhe ainda não importado`, "Grupos/conjuntos e anúncios ainda não foram importados: o diagnóstico fica no nível de campanha.", "Rode \"Importar dados\" em Conexões.", "low"));
  } else if (!detailCovers(detail.groupSpan, filters.current) || (filters.previous && !detailCovers(detail.groupSpan, filters.previous))) {
    out.push(limitation(ctx, "detail_unavailable", `${label}: detalhe cobre só parte do período`, `O detalhe por ${GROUP_LEVEL_LABEL[ctx.platform].one.toLowerCase()} vai de ${BR(detail.groupSpan.detailFirst)} a ${BR(detail.groupSpan.detailLast ?? detail.groupSpan.detailFirst)}: abaixo da campanha, só regras com cobertura completa rodam.`, "Escolha um período dentro da cobertura do detalhe.", "info"));
  }
  return out;
}

function rel(units: Unit[]): RelatedEntity[] {
  return units.map((u) => ({ level: u.level, name: u.name, href: u.entity.href, deltaPct: null }));
}

/** Nenhuma regra de comparação tem volume para esta unidade. */
function lacksVolume(u: Unit): boolean {
  const { cur, prev } = u;
  if (!cur || !prev) return true;
  const rc = u.def ? (resultsOf(u.def, cur) ?? 0) : 0;
  const rp = u.def ? (resultsOf(u.def, prev) ?? 0) : 0;
  const ctrOk = cur.impressions >= C.MIN_IMPRESSIONS && prev.impressions >= C.MIN_IMPRESSIONS && prev.clicks >= C.MIN_PREVIOUS_CLICKS;
  const cpcOk = cur.clicks >= D.MIN_CLICKS && prev.clicks >= D.MIN_CLICKS;
  const cprOk = rc >= B.MIN_RESULTS && rp >= B.MIN_RESULTS;
  const resOk = rp >= E.MIN_PREVIOUS_RESULTS;
  return !ctrOk && !cpcOk && !cprOk && !resOk;
}

// ── orquestração ──────────────────────────────────────────────────────

/** Somas por moeda e definição de resultado das campanhas da plataforma (para a referência). */
function campaignGroups(units: Unit[]): Map<string, { cost: number; results: number }> {
  const out = new Map<string, { cost: number; results: number }>();
  for (const u of units) {
    if (!u.def || !u.cur || !u.currentUsable) continue;
    const k = `${currencyKey(u.currency)}|${u.def.key}`;
    const g = out.get(k) ?? { cost: 0, results: 0 };
    g.cost += u.cur.cost;
    g.results += resultsOf(u.def, u.cur) ?? 0;
    out.set(k, g);
  }
  return out;
}

/**
 * Custo por resultado de referência de uma unidade SEM resultados: o das DEMAIS unidades do
 * mesmo nível (irmãs) — nunca incluindo o próprio gasto, senão uma entidade que concentra o
 * investimento inflaria a própria referência e nunca seria acusada.
 */
function referenceFor(u: Unit, groups: ReturnType<typeof campaignGroups>): { cpr: number; source: string } | null {
  if (!u.def || !u.cur) return null;
  let cost: number;
  let results: number;
  let source: string;
  if (u.parent) {
    const p = u.parent;
    if (!p.def || !p.cur) return null;
    cost = p.cur.cost - u.cur.cost;
    results = resultsOf(p.def, p.cur) ?? 0;
    source = u.level === "ad" ? "média dos demais anúncios do grupo/conjunto" : `média dos demais ${GROUP_LEVEL_LABEL[u.platform].many.toLowerCase()} da campanha`;
  } else {
    const g = groups.get(`${currencyKey(u.currency)}|${u.def.key}`);
    if (!g) return null;
    cost = g.cost - u.cur.cost;
    results = g.results;
    source = "média das demais campanhas da plataforma com a mesma definição e moeda";
  }
  return cost > 0 && results > 0 ? { cpr: cost / results, source } : null;
}

function platformDiagnostics(input: PlatformDiagnosticInput, filters: CampaignFilters): Draft[] {
  const { panel, facts } = input;
  const cov = panel.coverage;
  const ctx: PlatformCtx = {
    platform: facts.platform,
    filters,
    panel,
    closedShare: cov ? cov.current.completeDays / cov.current.days : 0,
    unsettled: cov !== null && filters.current.end >= addDays(facts.accountToday, -facts.restatementDays),
    query: filtersToQuery(filters, { page: 1, status: null, onlyCostWithoutResult: false, sort: "cost", platform: "all" }),
  };
  const campaigns = buildUnits(input, ctx);
  const drafts: Draft[] = limitations(input, ctx, campaigns);
  if (!cov || cov.current.state === "none") return drafts;

  const refs = campaignGroups(campaigns);
  // conta inteira sem resultado: um único aviso, sem acusar campanha por campanha
  for (const [k, ref] of refs) {
    if (ref.results > 0 || ref.cost <= 0) continue;
    const defKey = k.split("|")[1] as ResultDefinition["key"];
    const currency = k.split("|")[0] || null;
    const def = campaigns.find((c) => c.def?.key === defKey)?.def;
    if (!def) continue;
    drafts.push({
      ...limitation(ctx, "no_results_anywhere", `${formatMoney(ref.cost, currency)} investidos sem nenhum resultado (${def.label}) em toda a plataforma`, "Sem nenhuma campanha com resultado, não há custo de referência para estimar o esperado.", "", "high"),
      type: "cost_without_results",
      kind: "inconclusive",
      description:
        `Nenhuma campanha do ${PLATFORM_LABEL[ctx.platform]} com resultado "${def.label}" reportou resultados no período, somando ${formatMoney(ref.cost, currency)}. ` +
        "Sem nenhuma campanha convertendo não há custo de referência para dizer o que seria esperado — e um zero na conta inteira costuma indicar rastreamento, não desempenho.",
      currency,
      severity: "high",
      confidence: "low",
      nextCheck:
        def.key === "google_conversions"
          ? "Confira em Metas › Conversões se alguma ação está registrando e se está incluída em \"Conversões\"."
          : "Confira no Gerenciador de Eventos se o pixel/API de conversões está recebendo o evento.",
      metrics: ["cost", "results"],
    });
  }

  const all = flatten(campaigns);
  for (const u of all) {
    const a = ruleCostWithoutResults(u, ctx, referenceFor(u, refs));
    const rest = [ruleCostPerResult(u, ctx), ruleCtrDrop(u), ruleCpcIncrease(u), ruleResultsDrop(u, ctx)];
    const unitDrafts = [a, ...rest].filter((d): d is Draft => d !== null);
    drafts.push(...dedupeWithinUnit(unitDrafts));
  }

  // distribuição: campanhas da plataforma (por moeda), grupos de cada campanha, anúncios de cada grupo
  const byCurrency = new Map<string, Unit[]>();
  for (const c of campaigns) {
    if (c.mixed) continue;
    byCurrency.set(currencyKey(c.currency), [...(byCurrency.get(currencyKey(c.currency)) ?? []), c]);
  }
  for (const list of byCurrency.values()) {
    const defs = new Set(list.map((c) => c.def?.key ?? "none"));
    const sharedDef = defs.size === 1 ? (list[0]!.def ?? null) : null;
    const cur = list.reduce<Totals>((acc, c) => addTotals(acc, c.cur ?? EMPTY_TOTALS), EMPTY_TOTALS);
    drafts.push(...ruleDistribution({ unit: null, name: PLATFORM_LABEL[ctx.platform], children: list, cur, def: sharedDef, share: 1 }, ctx, "campaign"));
  }
  for (const u of all) {
    if (u.children.length === 0 || !u.currentUsable) continue;
    drafts.push(...ruleDistribution({ unit: u, name: u.name, children: u.children, cur: u.cur, def: u.def, share: u.share }, ctx, u.level === "campaign" ? "ad_group" : "ad"));
  }

  return dedupeHierarchy(drafts);
}

/**
 * Dentro da MESMA unidade: "sem resultados" (A) absorve "resultados caíram" (E) e
 * "custo por resultado subiu" (B); uma queda de resultados com piora de eficiência (E)
 * absorve B — o custo por resultado já está na evidência dela.
 */
export function dedupeWithinUnit(list: Draft[]): Draft[] {
  const has = (t: DiagnosticType) => list.some((d) => d.type === t && d.kind !== "limitation");
  let out = list;
  if (has("cost_without_results")) out = out.filter((d) => d.type !== "results_drop" && d.type !== "cost_per_result_increase");
  const e = out.find((d) => d.type === "results_drop");
  if (e && !e.followsSpend) out = out.filter((d) => d.type !== "cost_per_result_increase");
  // CPC = CPM ÷ (1000 × CTR): com o CPM estável, a alta do CPC é a própria queda do CTR
  const ctr = out.find((d) => d.type === "ctr_drop");
  const cpc = out.find((d) => d.type === "cpc_increase");
  const cpm = cpc?.evidence.find((m) => m.key === "cpm");
  if (ctr && cpc && cpm && cpm.deltaPct !== null && Math.abs(cpm.deltaPct) <= CPM_STABLE_BAND) {
    const cpcMetric = cpc.evidence.find((m) => m.key === "cpc");
    if (cpcMetric) ctr.evidence = [...ctr.evidence, cpcMetric];
    ctr.description += ` Com o CPM estável, isso elevou o CPC em ${pct0(cpc.mainDelta ?? 0)} — a alta do CPC é consequência da queda do CTR, não do leilão.`;
    out = out.filter((d) => d !== cpc);
  }
  return out;
}

const ANCESTOR_TYPES: ReadonlySet<DiagnosticType> = new Set([
  "cost_without_results",
  "cost_per_result_increase",
  "ctr_drop",
  "cpc_increase",
  "results_drop",
  "cost_per_result_improvement",
]);

/**
 * Entre níveis: o mesmo tipo num descendente de quem já tem esse tipo não vira outro
 * alerta — entra como "também aparece em…" do ancestral mais alto. Um sinal só no filho
 * (o pai não mudou) continua sendo do filho: é ali que o problema está localizado.
 */
export function dedupeHierarchy(drafts: Draft[]): Draft[] {
  const byUnitType = new Map<string, Draft>();
  for (const d of drafts) if (d.unit && ANCESTOR_TYPES.has(d.type)) byUnitType.set(`${d.unit.key}#${d.type}`, d);
  const out: Draft[] = [];
  for (const d of drafts) {
    if (!d.unit || !ANCESTOR_TYPES.has(d.type)) {
      out.push(d);
      continue;
    }
    let anc = d.unit.parent;
    let owner: Draft | null = null;
    while (anc) {
      const hit = byUnitType.get(`${anc.key}#${d.type}`);
      if (hit) owner = hit;
      anc = anc.parent;
    }
    if (owner) owner.related.push({ level: d.level, name: d.unit.name, href: d.entity.href, deltaPct: d.mainDelta });
    else out.push(d);
  }
  return out;
}

function finalize(d: Draft, filters: CampaignFilters): CampaignDiagnostic {
  const pathId = [d.entity.campaignId, d.entity.adGroupId, d.entity.adId].filter(Boolean).join("/");
  const id = `${d.type}:${d.platform}:${d.level}:${pathId || "-"}${d.limitationReason ? `:${d.limitationReason}` : ""}${d.level === "platform" && d.currency ? `:${d.currency}` : ""}`;
  const priority =
    d.kind === "limitation"
      ? LIMIT_ORDER.length - LIMIT_ORDER.indexOf(d.limitationReason ?? "comparison_off")
      : SEV_W[d.severity] * CONF_W[d.confidence] * (0.5 + Math.min(d.share ?? 0, 1));
  return {
    id,
    type: d.type,
    kind: d.kind,
    platform: d.platform,
    platformLabel: PLATFORM_LABEL[d.platform],
    level: d.level,
    levelLabel: LEVEL_LABEL(d.platform, d.level),
    entity: d.entity,
    title: d.title,
    description: d.description,
    evidence: d.evidence,
    facts: d.facts,
    currency: d.currency,
    period: { current: filters.current, previous: filters.previous },
    severity: d.severity,
    confidence: d.confidence,
    limitation: d.limitation,
    limitationReason: d.limitationReason,
    nextCheck: d.nextCheck,
    metrics: d.metrics,
    related: [...d.related].sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0)).slice(0, 10),
    priority: Math.round(priority * 1000) / 1000,
  };
}

/** O z é técnico: o rótulo diz como lê-lo. */
const Z_LABEL = "Evidência estatística (z ≥ 2 média, ≥ 3 alta)";

const KIND_ORDER: Record<DiagnosticKind, number> = { finding: 0, inconclusive: 1, limitation: 2 };

/**
 * Diagnóstico de todas as plataformas pedidas. Ordem: achados, inconclusivos, limitações;
 * dentro de cada um, prioridade e depois id (estável).
 */
export function diagnose(input: { filters: CampaignFilters; platforms: PlatformDiagnosticInput[] }): CampaignDiagnostic[] {
  return input.platforms
    .flatMap((p) => platformDiagnostics(p, input.filters))
    .map((d) => finalize(d, input.filters))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.priority - a.priority || a.id.localeCompare(b.id));
}
