/**
 * Textos determinísticos dos insights (bloco C4). Preenchimento de lacunas com
 * valores calculados — sem LLM, sem geração livre.
 */
import { formatCount } from "@/lib/format";

const pct0 = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 0,
});
const pct1 = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** valor absoluto de uma fração como percentual, ex.: 0.271 -> "27,1%" */
export function absPct(x: number): string {
  return pct1.format(Math.abs(x));
}

export function sharePct(x: number): string {
  return pct0.format(Math.abs(x));
}

function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export interface TrafficDropSlots {
  /** totais do SITE (todos os canais) na janela */
  current: number;
  previous: number;
  deltaPct: number; // queda do site, negativo
  baselineDaily: number | null; // mediana diária do site no baseline
  responsibleValue: string | null; // "Paid Search"
  responsibleShare: number; // 0..1 — participação do canal na queda do site
  responsibleCurrent: number; // sessões do canal na janela atual
  responsiblePrevious: number; // sessões do canal na janela anterior
  onsetDate: string | null;
  otherContributorsCount: number;
}

/**
 * Bloco C4 · ajuste D1 #3: quando há um canal responsável, o título e os números
 * são do CANAL; a queda total do site entra como contexto. Sem canal dominante,
 * o texto fica no nível do site.
 */
export function trafficDropText(s: TrafficDropSlots): {
  title: string;
  explanation: string;
  hypothesis: string;
  recommendedAction: string;
} {
  const onsetClause = s.onsetDate
    ? ` a partir de ${brDate(s.onsetDate)}`
    : " ao longo do período (declínio gradual)";

  // queda percentual DO CANAL (não do site)
  const responsibleDeltaPct =
    s.responsiblePrevious > 0
      ? (s.responsibleCurrent - s.responsiblePrevious) / s.responsiblePrevious
      : 0;

  if (!s.responsibleValue) {
    const baseClause =
      s.baselineDaily != null
        ? ` A média diária ficou em ${formatCount(Math.round(s.current / 28))} sessões, contra ${formatCount(Math.round(s.baselineDaily))} na linha de base de ~120 dias.`
        : "";
    return {
      title: `Sessões do site caíram ${absPct(s.deltaPct)} nos últimos 28 dias`,
      explanation:
        `As sessões do site caíram de ${formatCount(s.previous)} para ${formatCount(s.current)} no período (${absPct(s.deltaPct)} de queda).` +
        baseClause,
      hypothesis: `A queda está distribuída entre vários segmentos, sem um dominante${onsetClause}.`,
      recommendedAction: `Investigar mudanças amplas no período (rastreio, sazonalidade, indexação) já que a queda não se concentra em um canal.`,
    };
  }

  const title = `Sessões de ${s.responsibleValue} caíram ${absPct(responsibleDeltaPct)} nos últimos 28 dias`;

  const explanation =
    `As sessões de ${s.responsibleValue} caíram de ${formatCount(s.responsiblePrevious)} para ${formatCount(s.responsibleCurrent)} no período (${absPct(responsibleDeltaPct)}). ` +
    `Isso representa ${sharePct(s.responsibleShare)} da queda total de sessões do site (${formatCount(s.previous)} → ${formatCount(s.current)}, ${absPct(s.deltaPct)}).`;

  const hypothesis =
    `Provável causa: redução de volume em ${s.responsibleValue}${onsetClause}.` +
    (s.otherContributorsCount > 0
      ? ` Outros ${s.otherContributorsCount} segmento(s) contribuem com o restante da queda do site.`
      : " Demais segmentos relativamente estáveis.");

  const recommendedAction =
    `Investigar em ${s.responsibleValue}${s.onsetDate ? ` o que mudou por volta de ${brDate(s.onsetDate)}` : " a origem do declínio"}: ` +
    `pausa/corte de campanha, perda de posição orgânica, link de referência quebrado ou sazonalidade. ` +
    `Priorizar os maiores contribuidores da queda.`;

  return { title, explanation, hypothesis, recommendedAction };
}

export interface ConversionDropSlots {
  currentRate: number; // 0..1
  previousRate: number;
  currentKeyEvents: number;
  previousKeyEvents: number;
  deltaPct: number; // negativo
  responsibleValue: string | null;
  responsibleShare: number;
  responsibleRateBefore: number;
  responsibleRateAfter: number;
  effect: "efficiency" | "volume" | "mixed";
  onsetDate: string | null;
}

export function conversionDropText(s: ConversionDropSlots): {
  title: string;
  explanation: string;
  hypothesis: string;
  recommendedAction: string;
} {
  const onsetClause = s.onsetDate
    ? ` a partir de ${brDate(s.onsetDate)}`
    : " ao longo do período";

  const title = `Conversões caíram ${absPct(s.deltaPct)} nos últimos 28 dias`;

  const explanation =
    `As conversões (key events) caíram de ${formatCount(s.previousKeyEvents)} para ${formatCount(s.currentKeyEvents)} ` +
    `(${absPct(s.deltaPct)}). A taxa de conversão foi de ${pct1.format(s.previousRate)} para ${pct1.format(s.currentRate)}.`;

  const hypothesis = s.responsibleValue
    ? s.effect === "efficiency"
      ? `Provável gargalo: perda de eficiência em ${s.responsibleValue}. A taxa de conversão desse segmento caiu de ` +
        `${pct1.format(s.responsibleRateBefore)} para ${pct1.format(s.responsibleRateAfter)}, respondendo por ` +
        `${sharePct(s.responsibleShare)} da variação${onsetClause}.`
      : `Provável causa: menos volume em ${s.responsibleValue} (${sharePct(s.responsibleShare)} da variação)${onsetClause}, ` +
        `com a taxa de conversão relativamente estável.`
    : `A queda de conversões está distribuída entre segmentos${onsetClause}.`;

  const recommendedAction =
    s.effect === "efficiency" && s.responsibleValue
      ? `Investigar as páginas de destino de ${s.responsibleValue} que perderam conversão no período; cruzar com mudanças de conteúdo, layout ou etapa de checkout.`
      : `Revisar o funil de conversão e a atribuição no período; confirmar se a queda acompanha uma queda de tráfego qualificado.`;

  return { title, explanation, hypothesis, recommendedAction };
}
