/**
 * Comparação entre dois períodos — PURA e determinística.
 *
 * É a ÚNICA aritmética do Advisor: diferença e variação % entre dois valores de
 * evidência que o Cross-source já calculou. Roda ANTES do modelo e o resultado
 * entra no `AdvisorContext`: nem a IA calcula uma variação nem uma frase digita
 * um número novo (INV-6). Quem compara é o sistema.
 *
 * Só há comparação quando os dois períodos são COMPARÁVEIS — do contrário a resposta
 * é "não computável", com o motivo, e nenhuma comparação é inventada:
 *   • os dois têm Cross-source gerado;
 *   • o período-base termina ANTES do início do atual (sem sobreposição);
 *   • os dois têm o MESMO número de dias (contagem absoluta de 4 dias não se compara
 *     com a de 30; normalizar por dia seria uma regra analítica nova — fica para uma
 *     decisão de produto);
 *   • cada métrica só entra quando a fonte COBRE o período inteiro nos dois lados
 *     (uma fonte parcial ou ausente em qualquer um deles tira as suas métricas).
 *
 * Só métricas de CONTAGEM e de VALOR entram — não taxas (uma taxa sobre poucos
 * negócios fechados oscila demais para virar variação %), e o valor ganho só entra
 * quando TODOS os ganhos dos dois períodos têm valor registrado (senão a soma
 * compara coberturas de valor diferentes, não desempenho). Variação sobre base 0 é
 * `null`, nunca infinita nem 0.
 */
import { displayDelta, displayDeltaPct, displayValue, periodText } from "./format";
import { comparisonNotComputable } from "./limitations";
import { SOURCE_LABEL } from "./compose";
import type {
  AdvisorComparison,
  AdvisorComparisonItem,
  AdvisorContext,
  AdvisorEvidence,
  AdvisorLimitation,
  AdvisorSource,
} from "./types";

/** Métricas que podem ser comparadas entre períodos (`<fonte>.<métrica>`), na ordem de exibição. */
export const COMPARABLE_METRICS: readonly string[] = [
  "ga4.sessions",
  "ga4.key_events",
  "rd_marketing.visits",
  "rd_marketing.conversions",
  "rd_crm.created_deals",
  "rd_crm.won_deals",
  "rd_crm.lost_deals",
  "rd_crm.won_value",
];

const periodLabel = (c: AdvisorContext) =>
  periodText({ start: c.period.startDate, end: c.period.endDate });

function find(context: AdvisorContext, metricId: string): AdvisorEvidence | undefined {
  const [source, ...rest] = metricId.split(".");
  const metric = rest.join(".");
  return context.evidence.find((e) => e.source === source && e.metric === metric);
}

const statusOf = (context: AdvisorContext, source: AdvisorSource) =>
  context.sources.find((s) => s.source === source)?.status;

export function compareAdvisorContexts(
  current: AdvisorContext,
  baseline: AdvisorContext,
): AdvisorComparison {
  const reasons: AdvisorLimitation[] = [];

  if (current.crossSource.status !== "generated") {
    reasons.push(
      comparisonNotComputable(
        "current_cross_source_missing",
        `Não há Cross-source gerado para o período atual (${periodLabel(current)}): não há o que comparar.`,
      ),
    );
  }
  if (baseline.crossSource.status !== "generated") {
    reasons.push(
      comparisonNotComputable(
        "baseline_cross_source_missing",
        `Não há Cross-source gerado para o período de comparação (${periodLabel(baseline)}): não há o que comparar.`,
      ),
    );
  }
  if (baseline.period.endDate >= current.period.startDate) {
    reasons.push(
      comparisonNotComputable(
        "periods_overlap",
        `O período de comparação (${periodLabel(baseline)}) não termina antes do início do período atual (${periodLabel(current)}): os dois períodos se sobrepõem ou estão fora de ordem.`,
      ),
    );
  }
  if (current.period.days !== baseline.period.days) {
    reasons.push(
      comparisonNotComputable(
        "different_duration",
        `Os períodos têm durações diferentes (${current.period.days} e ${baseline.period.days} dias): contagens absolutas de períodos de tamanhos diferentes não são comparáveis, e o Advisor não normaliza por dia.`,
      ),
    );
  }

  if (reasons.length > 0) {
    return {
      status: "not_computable",
      baselinePeriod: baseline.period,
      reasons,
      items: [],
      skipped: [],
      baselineEvidence: [],
    };
  }

  const items: AdvisorComparisonItem[] = [];
  const skipped: AdvisorComparison["skipped"] = [];
  const baselineEvidence: AdvisorEvidence[] = [];

  for (const metricId of COMPARABLE_METRICS) {
    const source = metricId.split(".")[0] as AdvisorSource;
    const cur = find(current, metricId);
    const base = find(baseline, metricId);
    const label = cur?.label ?? base?.label ?? metricId;
    const skip = (reason: string) => skipped.push({ metricId, label, reason });

    // uma métrica que nenhum dos dois períodos tem não é "pulada": simplesmente não existe
    if (!cur && !base) continue;

    const names = SOURCE_LABEL[source];
    if (statusOf(current, source) !== "covered" || statusOf(baseline, source) !== "covered") {
      skip(`${names} não cobre o período inteiro nos dois períodos.`);
      continue;
    }
    if (!cur || !base) {
      skip(`${names} não tem esta métrica em ${!cur ? "um" : "outro"} dos períodos.`);
      continue;
    }
    if (cur.value === null || base.value === null) {
      skip("a métrica não é calculável em um dos períodos.");
      continue;
    }
    if (cur.format !== base.format || cur.currency !== base.currency) {
      skip("a métrica tem formato ou moeda diferente entre os períodos.");
      continue;
    }
    if (metricId === "rd_crm.won_value") {
      // soma de valores só compara desempenho se todos os ganhos tiverem valor nos dois lados
      const full = (c: AdvisorContext) => {
        const withValue = find(c, "rd_crm.won_deals_with_value");
        const won = find(c, "rd_crm.won_deals");
        return withValue?.value != null && won?.value != null && withValue.value === won.value;
      };
      if (!full(current) || !full(baseline)) {
        skip("nem todos os negócios ganhos têm valor registrado nos dois períodos.");
        continue;
      }
    }

    const delta = cur.value - base.value;
    const deltaPct = base.value === 0 ? null : delta / base.value;
    items.push({
      metricId,
      source,
      label,
      format: cur.format,
      ...(cur.currency !== undefined ? { currency: cur.currency } : {}),
      current: cur.value,
      baseline: base.value,
      currentRef: cur.ref,
      baselineRef: base.ref,
      delta,
      deltaPct,
      currentDisplay: displayValue(cur) ?? "",
      baselineDisplay: displayValue(base) ?? "",
      deltaDisplay: displayDelta(delta, cur.format),
      deltaPctDisplay: deltaPct === null ? null : displayDeltaPct(deltaPct),
    });
    baselineEvidence.push(base);
  }

  if (items.length === 0) {
    return {
      status: "not_computable",
      baselinePeriod: baseline.period,
      reasons: [
        comparisonNotComputable(
          "no_comparable_metrics",
          "Nenhuma métrica é comparável entre os dois períodos: as fontes não cobrem os dois períodos inteiros ou não têm as mesmas métricas.",
        ),
      ],
      items: [],
      skipped,
      baselineEvidence: [],
    };
  }

  return {
    status: "computed",
    baselinePeriod: baseline.period,
    reasons: [],
    items,
    skipped,
    baselineEvidence,
  };
}
