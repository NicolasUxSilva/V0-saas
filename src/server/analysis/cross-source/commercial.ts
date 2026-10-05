/**
 * Camada comercial: atividade do CRM (C), coexistência temporal com os sinais de
 * aquisição (§5) e qualidade de atribuição (§6).
 *
 * Regras que atravessam este arquivo:
 *  - nada aqui diz de onde um negócio veio: coexistir no tempo não é causa;
 *  - taxa de ganho = ganhos ÷ (ganhos + perdidos), com os abertos FORA do
 *    denominador, e nunca chamada de "conversão de leads";
 *  - ticket médio só existe com ganho COM valor registrado.
 */
import { inclusiveDays } from "../period";

import { createInsight } from "./builder";
import type { SourceFacts } from "./facts";
import { amount, brDate, count, joinPt, pct, periodText, plural } from "./text";
import type { CrossSourceInsight } from "./types";

/**
 * Cobertura mínima de `source_id`/`campaign_id` para considerar o campo utilizável
 * em atribuição. Decisão de produto (não vem de nenhum dado): abaixo disso o campo
 * é tratado como insuficiente. Ver o relatório da tarefa — precisa de aprovação.
 */
export const MIN_ATTRIBUTION_COVERAGE = 0.8;

// ─────────────────────────────────────────────────────────────────────
// Atividade comercial (C)
// ─────────────────────────────────────────────────────────────────────
export function commercialActivity(f: SourceFacts): CrossSourceInsight | null {
  const c = f.rdCrm;
  if (!c) return null;

  const b = createInsight({
    type: "commercial-activity",
    category: "commercial",
    title: "Atividade comercial registrada no CRM",
    period: c.window,
  });
  const P = periodText(c.window);
  const crm = (
    metric: string,
    label: string,
    value: number,
    format: "count" | "rate" | "currency" = "count",
  ) =>
    b.ev({
      source: "rd_crm",
      metric,
      label,
      period: c.window,
      value,
      format,
      ...(format === "currency" ? { currency: null } : {}),
    });

  const created = crm("created_deals", "Negócios criados", c.created);
  const won = crm("won_deals", "Negócios ganhos", c.won);
  const lost = crm("lost_deals", "Negócios perdidos", c.lost);

  b.fact(
    `O CRM registrou ${count(c.created)} ${plural(c.created, "negócio criado", "negócios criados")}, ${count(c.won)} ${plural(c.won, "ganho", "ganhos")} e ${count(c.lost)} ${plural(c.lost, "perdido", "perdidos")} no período (${P}); criação e fechamento são contados pela data de cada evento.`,
    [created, won, lost],
  );

  if (c.created > 0) {
    const open = crm("created_still_open_deals", "Negócios criados no período e ainda em aberto", c.createdOpen);
    b.fact(
      `${count(c.createdOpen)} dos ${count(c.created)} ${plural(c.created, "negócio criado", "negócios criados")} no período ${plural(c.createdOpen, "segue", "seguem")} em aberto na última sincronização do CRM.`,
      [created, open],
    );
  }

  if (c.winRate !== null) {
    const rate = crm("win_rate", "Taxa de ganho (ganhos ÷ (ganhos + perdidos))", c.winRate, "rate");
    b.fact(
      `Taxa de ganho dos negócios fechados no período: ${pct(c.winRate)} (${count(c.won)} ${plural(c.won, "ganho", "ganhos")} de ${count(c.closed)} ${plural(c.closed, "negócio fechado", "negócios fechados")}; ganhos ÷ (ganhos + perdidos), com os negócios em aberto fora do cálculo).`,
      [rate, won, lost],
    );
    b.limit(
      "win_rate_scope",
      "A taxa de ganho descreve os negócios fechados no período; não representa conversão de leads, porque não há evidência de que o conjunto de negócios seja formado por leads.",
      [rate],
    );
  }

  let hasValueFact = false;

  if (c.wonWithValue > 0) {
    hasValueFact = true;
    const value = crm("won_value", "Valor dos negócios ganhos", c.wonValue, "currency");
    const withValue = crm("won_deals_with_value", "Negócios ganhos com valor registrado", c.wonWithValue);
    b.fact(
      `Valor dos negócios ganhos: ${amount(c.wonValue)} (soma de ${count(c.wonWithValue)} de ${count(c.won)} ${plural(c.won, "ganho", "ganhos")} com valor registrado).`,
      [value, withValue, won],
    );
    if (c.averageTicket !== null) {
      const ticket = crm("average_ticket", "Ticket médio dos ganhos com valor registrado", c.averageTicket, "currency");
      b.fact(
        `Ticket médio dos ganhos com valor registrado: ${amount(c.averageTicket)} (base: ${count(c.wonWithValue)} ${plural(c.wonWithValue, "negócio", "negócios")}).`,
        [ticket, value, withValue],
      );
    }
    if (c.wonWithValue < c.won) {
      b.limit(
        "won_value_partial",
        `${count(c.won - c.wonWithValue)} dos ${count(c.won)} negócios ganhos não têm valor registrado: o valor ganho e o ticket médio consideram só os negócios com valor.`,
        [withValue, won],
      );
    }
  }

  if (c.lostWithValue > 0) {
    hasValueFact = true;
    const value = crm("lost_value", "Valor dos negócios perdidos", c.lostValue, "currency");
    const withValue = crm("lost_deals_with_value", "Negócios perdidos com valor registrado", c.lostWithValue);
    b.fact(
      `Valor dos negócios perdidos: ${amount(c.lostValue)} (soma de ${count(c.lostWithValue)} de ${count(c.lost)} ${plural(c.lost, "perdido", "perdidos")} com valor registrado).`,
      [value, withValue, lost],
    );
    if (c.lostWithValue < c.lost) {
      b.limit(
        "lost_value_partial",
        `${count(c.lost - c.lostWithValue)} dos ${count(c.lost)} negócios perdidos não têm valor registrado: o valor perdido considera só os negócios com valor.`,
        [withValue, lost],
      );
    }
  }

  // Histórico importado parcial: as contagens de um período que começa ANTES do
  // histórico de CRM importado no SaaS são piso, não total — nunca apresentar histórico
  // parcial como completo.
  if (c.partialImportedHistory && c.importedHistoryStartDate) {
    const covered = b.ev({
      source: "rd_crm",
      metric: "covered_days",
      label: "Dias do período cobertos pelo histórico importado (RD CRM)",
      period: c.covered,
      value: inclusiveDays(c.covered.start, c.covered.end),
    });
    b.limit(
      "rd_crm_partial_imported_history",
      `O histórico de CRM importado para o SaaS começa em ${brDate(c.importedHistoryStartDate)}, depois do início do período (${brDate(c.window.start)}): negócios criados ou fechados antes dessa data podem não estar nas contagens. É o início do histórico importado, não o do histórico real do CRM, que não é conhecido.`,
      [covered],
    );
  }

  if (c.pipelineCount >= 2) {
    const pipelines = crm("pipelines", "Funis de vendas com atividade", c.pipelineCount);
    b.limit(
      "pipelines_aggregated",
      `Os totais somam ${count(c.pipelineCount)} funis de vendas do CRM (identificados apenas por ID); contagens, taxa de ganho e valores não são separados por funil.`,
      [pipelines],
    );
  }
  if (hasValueFact) {
    b.limit(
      "currency_not_informed",
      "O CRM não informa a moeda dos valores; eles são exibidos sem símbolo monetário.",
    );
  }
  b.limit(
    "deal_state_snapshot",
    "Os números refletem o estado atual dos negócios na última sincronização: o CRM importado não guarda histórico de mudanças de status, e os negócios em aberto só são contados entre os criados no período (o estoque total em aberto não é avaliado).",
    [created],
  );

  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Atividade comercial × aquisição (§5): coexistência no tempo, nunca causa.
// ─────────────────────────────────────────────────────────────────────
export function commercialVsAcquisition(f: SourceFacts): CrossSourceInsight | null {
  const { ga4: g, rdMarketing: m, rdCrm: c } = f;
  if (!c) return null;
  if (!g.hasData && !m) return null; // nada de aquisição para situar o CRM
  if (!f.windowsEquivalent) return null; // "mesmo período" só vale com janelas idênticas

  const ref = f.referencePeriod;
  const P = periodText(ref);
  const b = createInsight({
    type: "commercial-vs-acquisition",
    category: "relationship",
    title: "Atividade comercial e sinais de aquisição no mesmo período",
    period: ref,
  });
  const crm = (metric: string, label: string, value: number) =>
    b.ev({ source: "rd_crm", metric, label, period: c.window, value });

  const created = crm("created_deals", "Negócios criados", c.created);
  const won = crm("won_deals", "Negócios ganhos", c.won);
  const lost = crm("lost_deals", "Negócios perdidos", c.lost);
  const crmIds = [created, won, lost];

  b.fact(
    `O CRM registrou ${count(c.created)} ${plural(c.created, "negócio criado", "negócios criados")}, ${count(c.won)} ${plural(c.won, "ganho", "ganhos")} e ${count(c.lost)} ${plural(c.lost, "perdido", "perdidos")} no período (${periodText(c.window)}).`,
    crmIds,
  );

  let sessions: string | null = null;
  if (g.hasData) {
    sessions = b.ev({
      source: "ga4",
      metric: "sessions",
      label: "Sessões (GA4)",
      period: g.window,
      value: g.sessions,
    });
    b.fact(`O GA4 registrou ${count(g.sessions)} sessões no período (${periodText(g.window)}).`, [sessions]);
  }

  let rdIds: string[] = [];
  if (m) {
    rdIds = [
      b.ev({
        source: "rd_marketing",
        metric: "visits",
        label: "Visitas (RD Marketing)",
        period: m.window,
        value: m.visits,
      }),
      b.ev({
        source: "rd_marketing",
        metric: "conversions",
        label: "Conversões (RD Marketing)",
        period: m.window,
        value: m.conversions,
      }),
    ];
    b.fact(
      `O RD Marketing registrou ${count(m.visits)} ${plural(m.visits, "visita", "visitas")} e ${count(m.conversions)} ${plural(m.conversions, "conversão", "conversões")} no período (${periodText(m.window)}).`,
      rdIds,
    );
  }

  const sessionsSentence = sessions
    ? ` No mesmo período, o GA4 registrou ${count(g.sessions)} sessões.`
    : "";
  const sessionsIds = sessions ? [sessions] : [];

  if (!c.hasActivity) {
    // defensivo: `rdCrm` presente sem nenhum criado/ganho/perdido só ocorre em contexto montado à mão
    const clauses: string[] = [];
    if (g.hasData) clauses.push(`o GA4 registrou ${count(g.sessions)} sessões`);
    if (m) {
      clauses.push(
        `o RD Marketing registrou ${count(m.visits)} ${plural(m.visits, "visita", "visitas")} e ${count(m.conversions)} ${plural(m.conversions, "conversão", "conversões")}`,
      );
    }
    b.relation(
      `No mesmo período (${P}), o CRM não registrou negócios criados, ganhos nem perdidos, enquanto ${joinPt(clauses)}.`,
      [...crmIds, ...sessionsIds, ...rdIds],
    );
  } else if (m && m.conversions === 0) {
    b.relation(
      `Durante o período analisado (${P}), houve atividade comercial no CRM enquanto os dados de conversão do RD Marketing permaneceram sem conversões registradas.${sessionsSentence}`,
      [...crmIds, ...rdIds, ...sessionsIds],
    );
  } else if (m) {
    b.relation(
      `No mesmo período (${P}), o CRM registrou atividade comercial e o RD Marketing registrou ${count(m.conversions)} ${plural(m.conversions, "conversão", "conversões")}; os dois sinais coexistem no tempo.${sessionsSentence}`,
      [...crmIds, ...rdIds, ...sessionsIds],
    );
  } else {
    b.relation(
      `No mesmo período (${P}), o GA4 registrou ${count(g.sessions)} sessões e o CRM registrou atividade comercial; não há dados do RD Marketing no período.`,
      [...crmIds, ...sessionsIds, ...rdIds],
    );
  }

  b.limit(
    "coexistence_only",
    "A coexistência no tempo não indica relação de causa: os dados importados não ligam os negócios do CRM ao tráfego do GA4 nem aos ativos do RD Marketing.",
    [...crmIds, ...sessionsIds, ...rdIds],
  );

  if (c.hasActivity) {
    b.hypothesis("Pode existir uma oportunidade de investigar a origem desses negócios.", crmIds);
  }

  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Qualidade de atribuição (§6): quanto da origem dos negócios está preenchida —
// e por que, mesmo preenchida, ela não prova atribuição a uma fonte de aquisição.
// ─────────────────────────────────────────────────────────────────────
export function attributionQuality(f: SourceFacts): CrossSourceInsight | null {
  const c = f.rdCrm;
  if (!c) return null;

  const b = createInsight({
    type: "attribution-quality",
    category: "attribution",
    title: "Qualidade de atribuição dos negócios do CRM",
    period: c.window,
  });
  const crm = (
    metric: string,
    label: string,
    value: number | null,
    format: "count" | "rate" = "count",
  ) => b.ev({ source: "rd_crm", metric, label, period: c.window, value, format });

  const populations = [
    { key: "created", noun: "criados", attr: c.attribution.created },
    { key: "won", noun: "ganhos", attr: c.attribution.won },
  ];
  const evaluated = populations.filter((p) => p.attr.total > 0);
  const popIds: string[] = [];

  if (evaluated.length === 0) {
    const ids = [
      crm("created_deals", "Negócios criados", 0),
      crm("won_deals", "Negócios ganhos", 0),
    ];
    popIds.push(...ids);
    b.fact(
      "Nenhum negócio criado ou ganho no período: a cobertura de origem e de campanha não pôde ser avaliada.",
      ids,
    );
  }

  for (const p of evaluated) {
    const a = p.attr;
    const total = crm(`${p.key}_deals`, `Negócios ${p.noun}`, a.total);
    const withSource = crm(`${p.key}_with_source_id`, `Negócios ${p.noun} com source_id`, a.withSourceId);
    const withCampaign = crm(`${p.key}_with_campaign_id`, `Negócios ${p.noun} com campaign_id`, a.withCampaignId);
    const sourceCov = crm(`${p.key}_source_id_coverage`, `Cobertura de source_id (${p.noun})`, a.sourceCoverage, "rate");
    const campaignCov = crm(`${p.key}_campaign_id_coverage`, `Cobertura de campaign_id (${p.noun})`, a.campaignCoverage, "rate");
    popIds.push(total);

    b.fact(
      `Negócios ${p.noun} no período: ${count(a.total)}; ${count(a.withSourceId)} (${pct(a.sourceCoverage ?? 0)}) com origem (source_id) preenchida e ${count(a.withCampaignId)} (${pct(a.campaignCoverage ?? 0)}) com campanha (campaign_id) preenchida — ${count(a.total - a.withSourceId)} sem origem e ${count(a.total - a.withCampaignId)} sem campanha.`,
      [total, withSource, withCampaign, sourceCov, campaignCov],
    );

    if (p.key === "created" && a.withSourceId > 0) {
      const distinct = crm("created_distinct_source_ids", "Valores distintos de source_id (criados)", a.distinctSourceIds);
      b.fact(
        `Os source_id preenchidos entre os negócios criados assumem ${count(a.distinctSourceIds)} ${plural(a.distinctSourceIds, "valor distinto", "valores distintos")}.`,
        [distinct, withSource],
      );
    }
  }

  const lowCampaign = evaluated.filter((p) => (p.attr.campaignCoverage ?? 0) < MIN_ATTRIBUTION_COVERAGE);
  if (lowCampaign.length > 0) {
    b.limit(
      "campaign_id_insufficient",
      `Os dados comerciais disponíveis não possuem cobertura suficiente de campanha (campaign_id) para atribuir negócios a campanhas: ${joinPt(lowCampaign.map((p) => `${pct(p.attr.campaignCoverage ?? 0)} dos negócios ${p.noun}`))} têm campanha preenchida (referência mínima: ${pct(MIN_ATTRIBUTION_COVERAGE)}).`,
      lowCampaign.map((p) => `rd_crm.${p.key}_campaign_id_coverage`),
    );
  }
  const lowSource = evaluated.filter((p) => (p.attr.sourceCoverage ?? 0) < MIN_ATTRIBUTION_COVERAGE);
  if (lowSource.length > 0) {
    b.limit(
      "source_id_insufficient",
      `Os dados comerciais disponíveis não possuem cobertura suficiente de origem (source_id) para atribuir negócios a origens: ${joinPt(lowSource.map((p) => `${pct(p.attr.sourceCoverage ?? 0)} dos negócios ${p.noun}`))} têm origem preenchida (referência mínima: ${pct(MIN_ATTRIBUTION_COVERAGE)}).`,
      lowSource.map((p) => `rd_crm.${p.key}_source_id_coverage`),
    );
  }

  b.limit(
    "no_origin_mapping",
    "Mesmo quando preenchidos, source_id e campaign_id são apenas identificadores do CRM: os dados importados não trazem o nome da origem nem ligação com os canais do GA4 ou com os ativos do RD Marketing.",
    popIds,
  );
  b.limit(
    "attribution_not_supported",
    "Com os dados atuais não é possível atribuir os negócios do CRM às fontes de aquisição (GA4, RD Marketing). É uma limitação analítica dos dados, não um erro técnico.",
    popIds,
  );

  if (evaluated.length > 0) {
    b.hypothesis(
      "Pode existir uma oportunidade de investigar como a origem dos negócios é cadastrada no CRM.",
      popIds,
    );
  }

  return b.build();
}
