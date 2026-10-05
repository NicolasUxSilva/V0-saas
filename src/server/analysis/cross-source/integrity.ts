/**
 * Integridade analítica (§8): fonte sem dados, período parcial, períodos não
 * equivalentes, populações não comparáveis, métrica não calculável.
 *
 * Isto NÃO é erro técnico — são limites do que os dados permitem afirmar. Cada
 * insight só existe quando a condição se verifica; todas as afirmações são
 * `limitation`, com `code` estável, e todo insight carrega evidência.
 */
import { inclusiveDays } from "../period";

import { createInsight } from "./builder";
import type { SourceFacts } from "./facts";
import { GA4_NO_ROWS_NOTE, SOURCE_LABEL, brDate, count, joinPt, periodText, plural } from "./text";
import type { CrossSourceInsight, CrossSourcePeriod, CrossSourceSource } from "./types";

// ─────────────────────────────────────────────────────────────────────
// Fonte disponível × indisponível
// ─────────────────────────────────────────────────────────────────────
export function sourceUnavailable(f: SourceFacts): CrossSourceInsight | null {
  const { ga4: g, rdMarketing: m, rdCrm: c } = f;
  const ref = f.referencePeriod;

  const missing: CrossSourceSource[] = [];
  if (!g.hasData) missing.push("ga4");
  if (!m) missing.push("rd_marketing");
  if (!c) missing.push("rd_crm");
  if (missing.length === 0) return null;

  const b = createInsight({
    type: "source-unavailable",
    category: "integrity",
    title: "Fontes sem dados no período analisado",
    period: ref,
  });

  // Um ponto por fonte (com ou sem dados) — a frase de "fontes com dados" aponta para eles.
  const headline: Record<CrossSourceSource, string> = {
    ga4: b.ev({
      source: "ga4",
      metric: "sessions",
      label: "Sessões (GA4)",
      period: g.window,
      // GA4 indisponível = sem linha nenhuma: ausência de dado, nunca "0 sessões"
      value: g.hasData ? g.sessions : null,
      ...(g.hasData ? {} : { note: GA4_NO_ROWS_NOTE }),
    }),
    rd_marketing: b.ev({
      source: "rd_marketing",
      metric: "days_with_data",
      label: "Dias com registros (RD Marketing)",
      period: m ? m.window : ref,
      value: m ? m.daysWithData : 0,
    }),
    rd_crm: b.ev({
      source: "rd_crm",
      metric: "pipelines_with_activity",
      label: "Funis com atividade (RD CRM)",
      period: c ? c.window : ref,
      value: c ? c.pipelineCount : 0,
    }),
  };

  if (f.availableSources.length > 0) {
    b.fact(
      `Fontes com dados no período: ${joinPt(f.availableSources.map((s) => SOURCE_LABEL[s]))}.`,
      f.availableSources.map((s) => headline[s]),
    );
  }

  if (!g.hasData) {
    b.limit(
      "ga4_unavailable",
      `GA4: sem dados no período (${periodText(g.window)}) — nenhuma linha do GA4, ou seja, ausência de dado e não zero sessões.`,
      [headline.ga4],
    );
  }
  if (!m) {
    b.limit(
      "rd_marketing_unavailable",
      `RD Marketing: sem dados no período (${periodText(ref)}). O contexto de análise não distingue fonte não conectada de fonte sem registros no período.`,
      [headline.rd_marketing],
    );
  }
  if (!c) {
    b.limit(
      "rd_crm_unavailable",
      `RD CRM: sem negócios criados ou fechados no período (${periodText(ref)}). O contexto de análise não distingue fonte não conectada de fonte sem atividade no período.`,
      [headline.rd_crm],
    );
  }

  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Período parcial: dias faltando dentro do período, GA4 atrasado ou histórico do
// CRM que começa depois do início do período
// ─────────────────────────────────────────────────────────────────────
export function partialPeriod(f: SourceFacts): CrossSourceInsight | null {
  const { ga4: g, rdMarketing: m, rdCrm: c } = f;
  const b = createInsight({
    type: "partial-period",
    category: "integrity",
    title: "Período parcial em uma ou mais fontes",
    period: f.referencePeriod,
  });
  let any = false;

  if (g.hasData && g.daysWithData < g.windowDays) {
    any = true;
    const id = b.ev({
      source: "ga4",
      metric: "days_with_data",
      label: "Dias com dados (GA4)",
      period: g.window,
      value: g.daysWithData,
    });
    b.limit(
      "ga4_partial_days",
      `GA4 tem dados em ${count(g.daysWithData)} de ${count(g.windowDays)} dias do período (${periodText(g.window)}): período parcial.`,
      [id],
    );
  }

  const lastDate = g.history.lastDate;
  if (g.lagKind && lastDate) {
    any = true;
    const id = b.ev({
      source: "ga4",
      metric: "data_lag_days",
      label: "Atraso do GA4 em relação ao último dia esperado (dias)",
      period: { start: lastDate, end: g.expectedLastDate },
      value: g.lagDays,
    });
    const dias = `${count(g.lagDays)} ${plural(g.lagDays, "dia", "dias")}`;
    b.limit(
      "ga4_data_lag",
      g.lagKind === "window_clamped"
        ? // modo padrão: a janela foi ENCURTADA até o último dia do GA4 — as outras fontes seguem nela
          `O GA4 só tem dados até ${brDate(lastDate)}, ${dias} antes do último dia esperado (${brDate(g.expectedLastDate)}): a janela de análise termina no último dia com dados do GA4, e dados posteriores das outras fontes não entram na comparação.`
        : // período explícito: a janela é a PEDIDA — é o GA4 que cobre só parte dela
          `O GA4 só tem dados até ${brDate(lastDate)}, ${dias} antes do fim do período solicitado (${brDate(g.expectedLastDate)}): os números do GA4 cobrem só parte do período.`,
      [id],
    );
  }

  if (m && m.daysWithData < m.windowDays) {
    any = true;
    const id = b.ev({
      source: "rd_marketing",
      metric: "days_with_data",
      label: "Dias com registros (RD Marketing)",
      period: m.window,
      value: m.daysWithData,
    });
    b.limit(
      "rd_marketing_partial_days",
      `RD Marketing tem registros em ${count(m.daysWithData)} de ${count(m.windowDays)} dias do período (${periodText(m.window)}): período parcial.`,
      [id],
    );
  }

  if (c && c.partialImportedHistory && c.importedHistoryStartDate) {
    any = true;
    const id = b.ev({
      source: "rd_crm",
      metric: "covered_days",
      label: "Dias do período cobertos pelo histórico importado (RD CRM)",
      period: c.covered,
      value: inclusiveDays(c.covered.start, c.covered.end),
    });
    b.limit(
      "rd_crm_partial_imported_history",
      `O histórico de CRM importado para o SaaS começa em ${brDate(c.importedHistoryStartDate)}, depois do início do período (${brDate(c.window.start)}): negócios criados ou fechados antes dessa data podem não estar nas contagens. É o início do histórico importado, não o do histórico real do CRM, que não é conhecido.`,
      [id],
    );
  }

  return any ? b.build() : null;
}

// ─────────────────────────────────────────────────────────────────────
// Períodos não equivalentes (§7): nunca comparar períodos diferentes como iguais.
// "Período" aqui é o que cada fonte de fato COBRE (a janela que ela usa e o trecho
// em que tem dado) — não só a janela pedida.
// ─────────────────────────────────────────────────────────────────────
export function periodMismatch(f: SourceFacts): CrossSourceInsight | null {
  if (f.windowsEquivalent) return null;
  const { ga4: g, rdMarketing: m, rdCrm: c } = f;

  const b = createInsight({
    type: "period-mismatch",
    category: "integrity",
    title: "Períodos não equivalentes entre as fontes",
    period: f.referencePeriod,
  });

  // Cada fonte: a janela que usa e o período que de fato cobre.
  const entries: {
    source: CrossSourceSource;
    label: string;
    window: CrossSourcePeriod;
    covered: CrossSourcePeriod;
    windowDays: number;
  }[] = [
    {
      source: "ga4",
      label: "GA4",
      window: g.window,
      covered: g.covered ?? g.window,
      windowDays: g.windowDays,
    },
  ];
  if (m) {
    entries.push({
      source: "rd_marketing",
      label: "RD Marketing",
      window: m.window,
      covered: m.covered ?? m.window,
      windowDays: m.windowDays,
    });
  }
  if (c) {
    entries.push({
      source: "rd_crm",
      label: "RD CRM",
      window: c.window,
      covered: c.covered,
      windowDays: c.windowDays,
    });
  }

  const windowIds = entries.map((e) =>
    b.ev({
      source: e.source,
      metric: "window_days",
      label: `Dias da janela (${e.label})`,
      period: e.window,
      value: e.windowDays,
    }),
  );
  b.fact(
    `Período solicitado: ${periodText(f.referencePeriod)}. Janelas de análise: ${entries.map((e) => `${e.label} ${periodText(e.window)}`).join("; ")}.`,
    windowIds,
  );

  // Fontes cuja cobertura real é menor que a própria janela (GA4 atrasado, RD parcial…).
  const narrower = entries.filter(
    (e) => e.covered.start !== e.window.start || e.covered.end !== e.window.end,
  );
  const coveredIds = narrower.map((e) =>
    b.ev({
      source: e.source,
      metric: "covered_days",
      label: `Dias efetivamente cobertos (${e.label})`,
      period: e.covered,
      value: inclusiveDays(e.covered.start, e.covered.end),
    }),
  );
  if (narrower.length > 0) {
    b.fact(
      `Períodos efetivamente cobertos: ${narrower.map((e) => `${e.label} ${periodText(e.covered)}`).join("; ")}.`,
      coveredIds,
    );
  }

  b.limit(
    "period_mismatch",
    `Os períodos disponíveis não são equivalentes entre as fontes: ${entries.map((e) => `${e.label} ${periodText(e.covered)}`).join("; ")}. Os números dessas fontes não foram comparados como se fossem do mesmo período.`,
    [...windowIds, ...coveredIds],
  );
  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Populações não comparáveis: o que NÃO foi calculado, e por quê
// ─────────────────────────────────────────────────────────────────────

type Present = Record<CrossSourceSource, boolean>;

/**
 * Relações entre fontes que o sistema NÃO calcula sem prova explícita de que os
 * dados permitem. Cada uma só é listada quando as fontes que ela envolve estão
 * presentes. Nenhuma pode ser provada com o `AnalysisContext` atual: não existe
 * nele chave de ligação entre as fontes.
 */
const UNPROVEN_RELATIONS: readonly {
  code: string;
  label: string;
  applies: (has: Present) => boolean;
  reason: string;
}[] = [
  {
    code: "ga4_to_rd_rate",
    label: "taxa de conversão do tráfego do GA4 para o RD Marketing",
    applies: (h) => h.ga4 && h.rd_marketing,
    reason:
      "sessões do GA4 e visitas do RD Marketing são medidas de fontes diferentes, sem chave de ligação entre elas",
  },
  {
    code: "rd_to_crm_rate",
    label: "taxa de conversão do RD Marketing para o CRM",
    applies: (h) => h.rd_marketing && h.rd_crm,
    reason:
      "conversões do RD Marketing e negócios do CRM são eventos diferentes, e não há prova de que um negócio nasça de uma conversão do RD",
  },
  {
    code: "traffic_to_sales_conversion",
    label: "conversão de tráfego em vendas",
    applies: (h) => h.ga4 && h.rd_crm,
    reason: "sessões do GA4 e negócios do CRM são populações diferentes, sem vínculo entre as fontes",
  },
  {
    code: "sales_attribution",
    label: "atribuição de vendas às fontes de aquisição",
    applies: (h) => h.rd_crm && (h.ga4 || h.rd_marketing),
    reason:
      "a origem registrada no CRM não está ligada aos canais do GA4 nem aos ativos do RD Marketing nos dados importados",
  },
  {
    code: "cac",
    label: "CAC",
    applies: (h) => h.rd_crm,
    reason: "exigiria atribuir negócios a custos de aquisição, o que os dados não permitem comprovar",
  },
  {
    code: "roas",
    label: "ROAS",
    applies: (h) => h.rd_crm,
    reason: "exigiria atribuir receita a investimento em mídia, o que os dados não permitem comprovar",
  },
];

const POPULATION_DESCRIPTION: Record<CrossSourceSource, string> = {
  ga4: "sessões de visitantes do site (GA4)",
  rd_marketing: "visitas e conversões em ativos de conversão do RD (RD Marketing)",
  rd_crm: "negócios do CRM (RD CRM)",
};

export function populationNotComparable(f: SourceFacts): CrossSourceInsight | null {
  if (f.availableSources.length < 2) return null;
  const { ga4: g, rdMarketing: m, rdCrm: c } = f;

  const b = createInsight({
    type: "population-not-comparable",
    category: "integrity",
    title: "Populações das fontes não são comparáveis",
    period: f.referencePeriod,
  });

  const has: Present = {
    ga4: f.availableSources.includes("ga4"),
    rd_marketing: f.availableSources.includes("rd_marketing"),
    rd_crm: f.availableSources.includes("rd_crm"),
  };

  // Tamanho de cada população, cada um no período da própria fonte.
  const ids: string[] = [];
  if (has.ga4) {
    ids.push(
      b.ev({
        source: "ga4",
        metric: "sessions",
        label: "Sessões (GA4)",
        period: g.window,
        value: g.sessions,
      }),
    );
  }
  if (has.rd_marketing && m) {
    ids.push(
      b.ev({
        source: "rd_marketing",
        metric: "visits",
        label: "Visitas (RD Marketing)",
        period: m.window,
        value: m.visits,
      }),
    );
  }
  if (has.rd_crm && c) {
    ids.push(
      b.ev({
        source: "rd_crm",
        metric: "created_deals",
        label: "Negócios criados",
        period: c.window,
        value: c.created,
      }),
    );
  }

  b.limit(
    "populations_differ",
    `As fontes com dados medem populações e eventos diferentes: ${joinPt(f.availableSources.map((s) => POPULATION_DESCRIPTION[s]))}.`,
    ids,
  );
  for (const r of UNPROVEN_RELATIONS) {
    if (!r.applies(has)) continue;
    b.limit(`not_computed:${r.code}`, `Não calculado: ${r.label} — ${r.reason}.`, ids);
  }
  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Métricas do CRM não calculáveis com segurança
// ─────────────────────────────────────────────────────────────────────

/**
 * Métricas do CRM que são DINHEIRO — lista explícita, por nome exato. O formato nunca é
 * inferido do sufixo da chave: `won_deals_with_value` e `lost_deals_with_value` terminam
 * em `_value` e são CONTAGENS (quantos negócios têm valor registrado), não valores.
 */
const CRM_MONEY_METRICS: ReadonlySet<string> = new Set(["won_value", "lost_value", "average_ticket"]);

export function metricNotComputable(f: SourceFacts): CrossSourceInsight | null {
  const c = f.rdCrm;
  if (!c) return null;

  const b = createInsight({
    type: "metric-not-computable",
    category: "integrity",
    title: "Métricas comerciais não calculáveis com segurança no período",
    period: c.window,
  });
  const crm = (metric: string, label: string, value: number | null, note?: string) => {
    const money = CRM_MONEY_METRICS.has(metric);
    return b.ev({
      source: "rd_crm",
      metric,
      label,
      period: c.window,
      value,
      format: metric === "win_rate" ? "rate" : money ? "currency" : "count",
      ...(money ? { currency: null } : {}),
      ...(note ? { note } : {}),
    });
  };

  let any = false;

  if (c.closed === 0) {
    any = true;
    const reason = "nenhum negócio ganho ou perdido no período";
    const metric = crm("win_rate", "Taxa de ganho", null, reason);
    b.limit(
      "metric_not_computable:win_rate",
      `Taxa de ganho não calculável: ${reason} (denominador = ganhos + perdidos = 0).`,
      [metric, crm("won_deals", "Negócios ganhos", c.won), crm("lost_deals", "Negócios perdidos", c.lost)],
    );
  }

  if (c.won === 0) {
    any = true;
    const reason = "nenhum negócio ganho no período";
    const metric = crm("average_ticket", "Ticket médio", null, reason);
    b.limit(
      "metric_not_computable:average_ticket",
      `Ticket médio não calculável: ${reason}.`,
      [metric, crm("won_deals", "Negócios ganhos", c.won)],
    );
  } else if (c.wonWithValue === 0) {
    any = true;
    const reason = `nenhum dos ${count(c.won)} negócios ganhos tem valor registrado`;
    const ids = [
      crm("won_value", "Valor dos negócios ganhos", null, reason),
      crm("average_ticket", "Ticket médio", null, reason),
      crm("won_deals", "Negócios ganhos", c.won),
      crm("won_deals_with_value", "Negócios ganhos com valor registrado", c.wonWithValue),
    ];
    b.limit(
      "metric_not_computable:won_value",
      `Valor ganho não disponível: ${reason}.`,
      ids,
    );
    b.limit(
      "metric_not_computable:average_ticket",
      `Ticket médio não calculável: ${reason}.`,
      ids,
    );
  }

  if (c.lost > 0 && c.lostWithValue === 0) {
    any = true;
    const reason = `nenhum dos ${count(c.lost)} negócios perdidos tem valor registrado`;
    b.limit(
      "metric_not_computable:lost_value",
      `Valor perdido não disponível: ${reason}.`,
      [
        crm("lost_value", "Valor dos negócios perdidos", null, reason),
        crm("lost_deals", "Negócios perdidos", c.lost),
        crm("lost_deals_with_value", "Negócios perdidos com valor registrado", c.lostWithValue),
      ],
    );
  }

  return any ? b.build() : null;
}
