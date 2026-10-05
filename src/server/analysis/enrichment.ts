/**
 * Enriquecimento cross-source determinístico (bloco G6).
 *
 * `enrichWithAds` acrescenta EVIDÊNCIA COMPLEMENTAR do Google Ads a um insight
 * `traffic-volume-drop` que o detector de GA4 já emitiu. As camadas ficam
 * separadas — nunca misturadas:
 *   1. fato primário          → title / explanation / evidence do detector (intocados)
 *   2. evidência complementar → `evidence.supportingEvidence[]` (números ABSOLUTOS do Ads)
 *   3. hipótese               → uma frase acrescentada a `hypothesis`, sem causalidade
 *   4. ação                   → `recommendedAction` do detector (intocada)
 *
 * Invariantes (INV-3 / INV-4, docs/v1-architecture.md §8):
 *  - nunca cria nem remove insight; nunca muda `dedupeKey`, `severity`,
 *    `confidence`, `priorityScore`, `title`, `explanation`, `recommendedAction`,
 *    `gateTrace` — só acrescenta texto a `hypothesis` e `evidence.supportingEvidence`;
 *  - pura: recebe SÓ os insights e `ctx.ads` — nunca o resto do `AnalysisContext`,
 *    logo não tem como ler nem recalcular sessões de GA4;
 *  - `ads === null` (sem Google Ads, ou sem linhas na janela) → devolve os
 *    insights exatamente como vieram (mesma referência do array);
 *  - fail-closed: qualquer condição não satisfeita → o insight segue intacto.
 *
 * O que NÃO faz: variação percentual do lado Ads (o `AdsContext` só tem a janela
 * atual, não há período anterior de Ads), ROAS, CAC, atribuição, nem qualquer
 * afirmação causal. Só métricas absolutas já presentes no `AdsContext`.
 */
import { formatCount, formatShare } from "@/lib/format";

import type {
  AdsCampaignSummary,
  AdsContext,
  CrossSourceEvidence,
  DetectorInsight,
} from "./types";

/** Único detector enriquecido no G6. */
const ENRICHED_DETECTOR = "traffic-volume-drop";

/**
 * Canal GA4 (`responsibleDimension.value`, dimensão "canal") → `advertisingChannelType`s
 * do Google Ads que podem ser uma de suas origens. Allowlist explícita e
 * conservadora — sem fuzzy match. `Map` (não objeto literal) para que um nome de
 * canal como "constructor" nunca resolva para algo herdado de `Object.prototype`.
 */
const CHANNEL_TO_ADS_TYPES: ReadonlyMap<string, readonly string[]> = new Map([
  ["Paid Search", ["SEARCH"]],
]);

/**
 * Frase acrescentada à `hypothesis`. Deliberadamente NÃO diz que o Ads "explica",
 * "causou" ou "é compatível com" a queda: sem período anterior do Google Ads não
 * se sabe sequer se houve queda do lado dos anúncios.
 */
const HYPOTHESIS_ADDENDUM =
  " Contexto do Google Ads (mesmo período): campanhas de Search registraram atividade — " +
  "ver evidência complementar. Sem comparação com o período anterior do Google Ads, isso " +
  "não indica se houve queda nos anúncios nem permite atribuir causalidade; serve como " +
  "ponto de partida para investigação.";

function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

const plainNumber = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Dinheiro na moeda DA CONTA — nunca assume BRL (G3 §17). */
function formatMoney(amount: number, currency: string | null): string {
  if (!currency) return `${plainNumber.format(amount)} (moeda não informada)`;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
  } catch {
    // código de moeda malformado — mostra o número com o código cru
    return `${plainNumber.format(amount)} ${currency}`;
  }
}

/** Remove ruído de ponto flutuante de somas (o dado vem em ≤ 4 casas). */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Somas sobre as campanhas compatíveis — mesma operação que `composeAdsContext` faz no total. */
function summarize(
  campaigns: AdsCampaignSummary[],
): CrossSourceEvidence["metrics"] {
  const sum = campaigns.reduce(
    (acc, c) => ({
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      cost: acc.cost + c.cost,
      conversions: acc.conversions + c.conversions,
      conversionValue: acc.conversionValue + c.conversionValue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 },
  );

  return {
    campaignCount: campaigns.length,
    impressions: sum.impressions,
    clicks: sum.clicks,
    cost: round4(sum.cost),
    conversions: round4(sum.conversions),
    conversionValue: round4(sum.conversionValue),
    // Impression share é uma razão: só se repassa quando é inequívoco (1 campanha
    // compatível que reportou). Agregar razões entre campanhas exigiria escolher
    // uma ponderação — lógica nova, fora do que o G6 aprova.
    impressionShare:
      campaigns.length === 1 ? (campaigns[0]?.impressionShare ?? null) : null,
  };
}

/**
 * Decide se — e com o quê — enriquecer UM insight. `null` = não enriquecer
 * (alguma condição de "quando enriquecer" falhou); o insight original não muda.
 */
function buildEvidenceFor(
  insight: DetectorInsight,
  ads: AdsContext,
): CrossSourceEvidence | null {
  if (insight.detector !== ENRICHED_DETECTOR) return null;

  // 5) relação de canal explícita: o responsável é um CANAL e está na allowlist.
  const responsible = insight.responsibleDimension;
  if (!responsible || responsible.name !== "canal") return null;
  const compatibleTypes = CHANNEL_TO_ADS_TYPES.get(responsible.value);
  if (!compatibleTypes) return null;

  // 2) correspondência temporal exata — a janela do Ads é a MESMA do insight.
  if (
    insight.periodStart !== ads.window.start ||
    insight.periodEnd !== ads.window.end
  ) {
    return null;
  }

  // 3) informação relevante: só campanhas cujo tipo é confirmadamente compatível
  // (tipo desconhecido/`null` não conta — não se assume Search).
  const compatible = ads.campaigns.filter(
    (c) =>
      c.advertisingChannelType !== null &&
      compatibleTypes.includes(c.advertisingChannelType),
  );
  if (compatible.length === 0) return null;

  // 4) dados suficientes: alguma atividade objetiva registrada.
  const metrics = summarize(compatible);
  if (metrics.impressions <= 0 && metrics.clicks <= 0 && metrics.cost <= 0) {
    return null;
  }

  const n = metrics.campaignCount;
  const detail =
    `No mesmo período (${brDate(ads.window.start)} a ${brDate(ads.window.end)}), ` +
    `${n} ${n === 1 ? "campanha" : "campanhas"} de Search no Google Ads ` +
    `${n === 1 ? "registrou" : "registraram"} ${formatCount(metrics.impressions)} impressões, ` +
    `${formatCount(metrics.clicks)} cliques e ${formatMoney(metrics.cost, ads.currency)} de custo` +
    (metrics.impressionShare !== null
      ? ` (parcela de impressões: ${formatShare(metrics.impressionShare)})`
      : "") +
    `. É contexto complementar do Google Ads: não representa a totalidade de ` +
    `${responsible.value} (o canal do GA4 pode incluir outras origens) e não ` +
    `estabelece causalidade.`;

  return {
    source: "google_ads",
    relationship: "same_period",
    title: `Contexto complementar: campanhas de Search no Google Ads`,
    detail,
    metrics,
    currency: ads.currency,
  };
}

/**
 * Passo de enriquecimento (G6). Roda depois dos detectores e do `priorityScore`,
 * antes de persistir — ver `engine.ts`. Idempotente: um insight que já carrega
 * evidência do Google Ads não é enriquecido de novo.
 */
export function enrichWithAds(
  insights: DetectorInsight[],
  ads: AdsContext | null,
): DetectorInsight[] {
  if (!ads) return insights;

  return insights.map((insight) => {
    const existing = insight.evidence.supportingEvidence ?? [];
    if (existing.some((e) => e.source === "google_ads")) return insight;

    const evidence = buildEvidenceFor(insight, ads);
    if (!evidence) return insight;

    return {
      ...insight,
      hypothesis: `${insight.hypothesis}${HYPOTHESIS_ADDENDUM}`,
      evidence: {
        ...insight.evidence,
        supportingEvidence: [...existing, evidence],
      },
    };
  });
}
