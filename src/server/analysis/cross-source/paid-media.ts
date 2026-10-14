/**
 * Mídia paga (Google Ads e Meta Ads) no Cross-source.
 *
 * Duas camadas, ambas só com o que as plataformas registraram:
 *  - `paid-media-activity` — investimento, impressões, cliques e conversões de cada
 *    plataforma NO PRÓPRIO PERÍODO e na PRÓPRIA moeda e definição. Nenhuma métrica é
 *    somada ou comparada entre plataformas: conversão do Google Ads e conversão do Meta
 *    Ads são definições diferentes (modelo e janela de atribuição próprios), e o
 *    investimento só é posto lado a lado — nunca somado — quando a moeda é a mesma;
 *  - `paid-media-vs-traffic` — cliques da plataforma × sessões do GA4 no canal padrão
 *    que a plataforma alimenta (Google Ads → Paid Search; Meta Ads → Paid Social), lado
 *    a lado e SEM razão: clique e sessão não são a mesma medida e não há chave de ligação.
 *
 * Mídia paga é OPCIONAL: sem linhas no período a plataforma não aparece em nenhum
 * insight (não há o que dizer sobre uma fonte não conectada), e a ausência dela nunca
 * altera os insights das fontes de base.
 */
import { inclusiveDays } from "../period";

import { createInsight } from "./builder";
import type { PaidMediaFacts, PaidMediaPlatform, SourceFacts } from "./facts";
import { SOURCE_LABEL, count, joinPt, money, pct, periodText, plural } from "./text";
import type { CrossSourceInsight } from "./types";

/** Canal padrão do GA4 que cada plataforma alimenta. Allowlist explícita, sem fuzzy match. */
const GA4_CHANNEL: Record<PaidMediaPlatform, string> = {
  google_ads: "Paid Search",
  meta_ads: "Paid Social",
};

/** Id estável do ponto de evidência de sessões do canal (`ga4.<metric>`). */
const CHANNEL_METRIC: Record<PaidMediaPlatform, string> = {
  google_ads: "sessions_paid_search",
  meta_ads: "sessions_paid_social",
};

/**
 * Códigos de limitação por plataforma, escritos por extenso (e não montados por
 * template) para que o teste de completude do Advisor os encontre no código-fonte.
 */
const NOT_ALIGNED_CODE: Record<PaidMediaPlatform, string> = {
  google_ads: "google_ads_not_aligned",
  meta_ads: "meta_ads_not_aligned",
};
const CLICKS_VS_SESSIONS_CODE: Record<PaidMediaPlatform, string> = {
  google_ads: "google_ads_clicks_vs_sessions",
  meta_ads: "meta_ads_clicks_vs_sessions",
};

const clickNoun = (p: PaidMediaFacts, n: number): string =>
  p.platform === "meta_ads"
    ? plural(n, "clique no link", "cliques no link")
    : plural(n, "clique", "cliques");

const clickLabel = (p: PaidMediaFacts): string =>
  `${p.platform === "meta_ads" ? "Cliques no link" : "Cliques"} (${SOURCE_LABEL[p.platform]})`;

/** Conversões vêm da plataforma e podem ser fracionárias (atribuição por modelo). */
const isWhole = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-9;

const exactFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

// ─────────────────────────────────────────────────────────────────────
// Atividade de mídia paga por plataforma
// ─────────────────────────────────────────────────────────────────────
export function paidMediaActivity(f: SourceFacts): CrossSourceInsight | null {
  if (f.paidMedia.length === 0) return null;

  const ref = f.referencePeriod;
  const b = createInsight({
    type: "paid-media-activity",
    category: "acquisition",
    title: "Mídia paga: investimento e desempenho por plataforma",
    period: ref,
  });

  const costIds: string[] = [];
  const conversionIds: string[] = [];

  for (const p of f.paidMedia) {
    const label = SOURCE_LABEL[p.platform];
    const P = periodText(p.window);
    const ev = (
      metric: string,
      evLabel: string,
      value: number,
      format: "count" | "rate" | "currency" = "count",
      note?: string,
    ) =>
      b.ev({
        source: p.platform,
        metric,
        label: evLabel,
        period: p.window,
        value,
        format,
        ...(format === "currency" ? { currency: p.currency } : {}),
        ...(note ? { note } : {}),
      });

    const cost = ev("cost", `Investimento (${label})`, p.cost, "currency");
    const impressions = ev("impressions", `Impressões (${label})`, p.impressions);
    const clicks = ev("clicks", clickLabel(p), p.clicks);
    costIds.push(cost);

    b.fact(
      `${label}: investimento de ${money(p.cost, p.currency)} em ${count(p.campaignCount)} ${plural(p.campaignCount, "campanha", "campanhas")}, com ${count(p.impressions)} ${plural(p.impressions, "impressão", "impressões")} e ${count(p.clicks)} ${clickNoun(p, p.clicks)} no período (${P}).`,
      [cost, impressions, clicks],
    );

    // razões entre campos da MESMA plataforma; `null` (nunca 0) quando o denominador é 0
    const rates: string[] = [];
    const rateIds: string[] = [];
    if (p.ctr !== null) {
      rateIds.push(ev("ctr", `CTR (${label})`, p.ctr, "rate"));
      rates.push(`CTR de ${pct(p.ctr)} (${p.platform === "meta_ads" ? "cliques no link" : "cliques"} ÷ impressões)`);
    }
    if (p.cpc !== null) {
      rateIds.push(ev("cpc", `Custo por clique (${label})`, p.cpc, "currency"));
      rates.push(`custo por clique de ${money(p.cpc, p.currency)}`);
    }
    if (rates.length > 0) {
      b.fact(`${label}: ${joinPt(rates)} no período (${P}).`, [...rateIds, cost, clicks, impressions]);
    }

    // conversões como a PRÓPRIA plataforma as define
    const conversions = ev(
      "conversions",
      `Conversões reportadas pela plataforma (${label})`,
      p.conversions,
      "count",
      isWhole(p.conversions)
        ? undefined
        : "valor fracionário (atribuição por modelo da plataforma); exibido arredondado",
    );
    conversionIds.push(conversions);
    const per =
      p.costPerConversion !== null
        ? ev("cost_per_conversion", `Custo por conversão (${label})`, p.costPerConversion, "currency")
        : null;
    b.fact(
      `${label}: ${count(p.conversions)} ${plural(Math.round(p.conversions), "conversão reportada", "conversões reportadas")} pela plataforma no período (${P})${
        isWhole(p.conversions)
          ? ""
          : ` (valor exato: ${exactFmt.format(p.conversions)}, exibido arredondado)`
      }${
        p.costPerConversion !== null
          ? `, a ${money(p.costPerConversion, p.currency)} por conversão`
          : ""
      }.`,
      per ? [conversions, per, cost] : [conversions],
    );

    // cobertura: só os dias entre o 1º e o último registro foram cobertos — dizer quando não é o período todo
    if (!f.aligned[p.platform]) {
      const coveredWindow = p.covered ?? p.window;
      // o período PRÓPRIO do valor é o coberto (o mesmo critério de `period-mismatch`)
      const covered = b.ev({
        source: p.platform,
        metric: "covered_days",
        label: `Dias cobertos entre o primeiro e o último registro (${label})`,
        period: coveredWindow,
        value: inclusiveDays(coveredWindow.start, coveredWindow.end),
      });
      b.limit(
        NOT_ALIGNED_CODE[p.platform],
        `${label} tem registros de ${periodText(coveredWindow)}, e o período analisado é ${periodText(ref)}: os números da plataforma cobrem só parte do período e não foram tratados como do mesmo período das outras fontes.`,
        [covered],
      );
    }

    if (!p.currency) {
      b.limit(
        "paid_media_currency_not_informed",
        `A fonte não informou a moeda da conta do ${label}: o investimento é exibido sem símbolo monetário.`,
        [cost],
      );
    }
  }

  // Duas plataformas: investimento lado a lado só na MESMA moeda e com as duas no período inteiro.
  const [first, second] = f.paidMedia;
  if (f.paidMedia.length === 2 && first && second) {
    const sameCurrency = first.currency !== null && first.currency === second.currency;
    if (sameCurrency && f.aligned[first.platform] && f.aligned[second.platform]) {
      b.relation(
        `No mesmo período (${periodText(ref)}), o investimento foi de ${money(first.cost, first.currency)} no ${SOURCE_LABEL[first.platform]} e de ${money(second.cost, second.currency)} no ${SOURCE_LABEL[second.platform]} (mesma moeda), apresentados lado a lado.`,
        costIds,
      );
    } else if (!sameCurrency && first.currency !== null && second.currency !== null) {
      b.limit(
        "paid_media_currency_differs",
        `O investimento do ${SOURCE_LABEL[first.platform]} está em ${first.currency} e o do ${SOURCE_LABEL[second.platform]} em ${second.currency}: não há conversão cambial e os valores não foram somados nem comparados.`,
        costIds,
      );
    }
  }

  const labels = f.paidMedia.map((p) => SOURCE_LABEL[p.platform]);
  b.limit(
    "paid_media_conversions_definition",
    `${f.paidMedia.length > 1 ? `As conversões ${joinPt(labels.map((l) => `do ${l}`))} são contadas por cada plataforma` : `As conversões do ${labels[0]} são contadas pela própria plataforma`}, com definição e janela de atribuição próprias${
      f.metaAds ? " (no Meta Ads, eventos de lead, compra e cadastro completo)" : ""
    }: não são comparáveis com os key events do GA4 nem com as conversões do RD Marketing${
      f.paidMedia.length > 1 ? " e não foram somadas entre as plataformas" : ""
    }.`,
    conversionIds,
  );
  if (f.metaAds) {
    b.limit(
      "meta_ads_metrics_scope",
      "No Meta Ads, os cliques são cliques no link do anúncio; alcance e frequência não entram nos totais porque não são aditivos entre dias nem entre campanhas.",
      ["meta_ads.clicks"],
    );
  }

  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Mídia paga × tráfego do GA4, lado a lado (relação observável)
// ─────────────────────────────────────────────────────────────────────
export function paidMediaVsTraffic(f: SourceFacts): CrossSourceInsight | null {
  const g = f.ga4;
  // lado a lado só no MESMO período: o GA4 e a plataforma têm de cobrir o período solicitado
  if (!g.hasData || !f.aligned.ga4) return null;
  const platforms = f.paidMedia.filter((p) => f.aligned[p.platform]);
  if (platforms.length === 0) return null;

  const ref = f.referencePeriod;
  const b = createInsight({
    type: "paid-media-vs-traffic",
    category: "relationship",
    title: "Mídia paga e tráfego do GA4 no mesmo período",
    period: ref,
  });

  const allIds: string[] = [];
  for (const p of platforms) {
    const label = SOURCE_LABEL[p.platform];
    const channel = GA4_CHANNEL[p.platform];
    const sessionsInChannel = g.sessionsByChannel.get(channel) ?? 0;

    const clicks = b.ev({
      source: p.platform,
      metric: "clicks",
      label: clickLabel(p),
      period: p.window,
      value: p.clicks,
    });
    const sessions = b.ev({
      source: "ga4",
      metric: CHANNEL_METRIC[p.platform],
      label: `Sessões no canal ${channel} (GA4)`,
      period: g.window,
      value: sessionsInChannel,
    });
    allIds.push(clicks, sessions);

    b.fact(
      `${label}: ${count(p.clicks)} ${clickNoun(p, p.clicks)} no período (${periodText(p.window)}).`,
      [clicks],
    );
    b.fact(
      `GA4: ${count(sessionsInChannel)} ${plural(sessionsInChannel, "sessão", "sessões")} no canal ${channel} no período (${periodText(g.window)}).`,
      [sessions],
    );
    b.relation(
      `No mesmo período (${periodText(ref)}), o ${label} registrou ${count(p.clicks)} ${clickNoun(p, p.clicks)} e o GA4 registrou ${count(sessionsInChannel)} ${plural(sessionsInChannel, "sessão", "sessões")} no canal ${channel} — dois sinais de fontes diferentes, apresentados lado a lado.`,
      [clicks, sessions],
    );

    b.limit(
      CLICKS_VS_SESSIONS_CODE[p.platform],
      p.platform === "google_ads"
        ? "Cliques do Google Ads e sessões do GA4 não são a mesma medida: um clique pode não gerar sessão, e o tráfego de campanhas de Performance Max, Shopping, Display e Vídeo pode aparecer em outros canais do GA4 (como Cross-network, Paid Shopping, Display e Paid Video), que não foram somados ao Paid Search."
        : "Cliques no link do Meta Ads e sessões do GA4 não são a mesma medida: um clique pode não gerar sessão, e as sessões vindas do Meta sem marcação UTM podem aparecer em outros canais do GA4 (como Direct ou Unassigned) em vez do Paid Social.",
      [clicks, sessions],
    );
  }

  b.limit(
    "paid_media_no_joint_rate",
    "Não foi calculada razão entre as sessões do GA4 e os cliques dos anúncios: as fontes medem eventos diferentes e não há chave de ligação entre elas.",
    allIds,
  );

  return b.build();
}
