/**
 * Cobertura e aquisição: o que cada fonte tem no período (A e §7 do escopo) e,
 * quando GA4 e RD Marketing coexistem no MESMO período, os dois sinais lado a
 * lado (B) — sem nunca transformá-los numa taxa conjunta.
 */
import { createInsight } from "./builder";
import type { SourceFacts } from "./facts";
import {
  GA4_NO_ROWS_NOTE,
  SOURCE_LABEL,
  brDate,
  count,
  describeAssets,
  joinPt,
  periodText,
  plural,
} from "./text";
import type { CrossSourceInsight } from "./types";

// ─────────────────────────────────────────────────────────────────────
// Cobertura de dados por fonte (§7) — fatos puros; o julgamento ("parcial",
// "não equivalente") fica nos insights de integridade.
// ─────────────────────────────────────────────────────────────────────
export function dataCoverage(f: SourceFacts): CrossSourceInsight {
  const ref = f.referencePeriod;
  const { ga4: g, rdMarketing: m, rdCrm: c } = f;
  const b = createInsight({
    type: "data-coverage",
    category: "coverage",
    title: "Cobertura de dados por fonte no período analisado",
    period: ref,
  });

  const headline: string[] = []; // um ponto por fonte COM dados, para a frase de equivalência

  // GA4 — sempre há janela; `hasData` diz se ela tem LINHAS (zero registrado conta como dado).
  const gaDays = b.ev({
    source: "ga4",
    metric: "days_with_data",
    label: "Dias com dados (GA4)",
    period: g.window,
    value: g.daysWithData,
  });
  const { firstDate, lastDate } = g.history;
  const gaIds = [gaDays];
  let history = "";
  if (firstDate && lastDate) {
    gaIds.push(
      b.ev({
        source: "ga4",
        metric: "history_distinct_dates",
        label: "Dias distintos no histórico do GA4",
        period: { start: firstDate, end: lastDate },
        value: g.history.distinctDates,
      }),
    );
    history = `; histórico disponível de ${brDate(firstDate)} a ${brDate(lastDate)} (${count(g.history.distinctDates)} dias distintos)`;
  }
  // período efetivamente coberto: do 1º ao último dia com sessões (≠ período solicitado)
  const gaEdges = g.covered
    ? `; primeiro dia com dado em ${brDate(g.covered.start)} e último em ${brDate(g.covered.end)}`
    : "";
  b.fact(
    `GA4: dados em ${count(g.daysWithData)} de ${count(g.windowDays)} dias do período (${periodText(g.window)})${gaEdges}${history}.`,
    gaIds,
  );
  if (g.hasData) headline.push(gaDays);

  // RD Marketing
  if (m) {
    const id = b.ev({
      source: "rd_marketing",
      metric: "days_with_data",
      label: "Dias com registros (RD Marketing)",
      period: m.window,
      value: m.daysWithData,
    });
    const edges =
      m.firstDate && m.lastDate
        ? `; primeiro registro em ${brDate(m.firstDate)} e último em ${brDate(m.lastDate)}`
        : "";
    b.fact(
      `RD Marketing: registros em ${count(m.daysWithData)} de ${count(m.windowDays)} dias do período (${periodText(m.window)})${edges}.`,
      [id],
    );
    headline.push(id);
  } else {
    const id = b.ev({
      source: "rd_marketing",
      metric: "days_with_data",
      label: "Dias com registros (RD Marketing)",
      period: ref,
      value: 0,
    });
    b.fact(
      `RD Marketing: sem dados no período (${periodText(ref)}) — fonte não conectada ou sem registros no período.`,
      [id],
    );
  }

  // RD CRM — evento a evento, não diário: o indicador de presença é "funis com atividade"
  if (c) {
    const id = b.ev({
      source: "rd_crm",
      metric: "pipelines_with_activity",
      label: "Funis com atividade (RD CRM)",
      period: c.window,
      value: c.pipelineCount,
    });
    b.fact(
      `RD CRM: atividade comercial em ${count(c.pipelineCount)} ${plural(c.pipelineCount, "funil", "funis")} no período (${periodText(c.window)}).`,
      [id],
    );
    headline.push(id);
  } else {
    const id = b.ev({
      source: "rd_crm",
      metric: "pipelines_with_activity",
      label: "Funis com atividade (RD CRM)",
      period: ref,
      value: 0,
    });
    b.fact(
      `RD CRM: sem negócios criados ou fechados no período (${periodText(ref)}) — fonte não conectada ou sem atividade no período.`,
      [id],
    );
  }

  // Só afirma "mesmo período" quando há ≥ 2 fontes com dados E as janelas coincidem.
  if (f.availableSources.length >= 2 && f.windowsEquivalent) {
    b.relation(
      `As fontes com dados (${joinPt(f.availableSources.map((s) => SOURCE_LABEL[s]))}) cobrem exatamente o mesmo período (${periodText(ref)}).`,
      headline,
    );
  }

  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Cobertura de aquisição (A): GA4 × RD Marketing — o que existe de cada lado.
// ─────────────────────────────────────────────────────────────────────
export function acquisitionCoverage(f: SourceFacts): CrossSourceInsight {
  const ref = f.referencePeriod;
  const { ga4: g, rdMarketing: m } = f;
  const b = createInsight({
    type: "acquisition-coverage",
    category: "coverage",
    title: "Cobertura de aquisição: tráfego (GA4) e conversões (RD Marketing)",
    period: ref,
  });

  const sessions = b.ev({
    source: "ga4",
    metric: "sessions",
    label: "Sessões (GA4)",
    period: g.window,
    // sem linha nenhuma o GA4 não tem "0 sessões", tem ausência de dado: `null`, nunca zero
    value: g.hasData ? g.sessions : null,
    ...(g.hasData ? {} : { note: GA4_NO_ROWS_NOTE }),
  });
  if (g.hasData) {
    const days = b.ev({
      source: "ga4",
      metric: "days_with_data",
      label: "Dias com dados (GA4)",
      period: g.window,
      value: g.daysWithData,
    });
    if (g.sessions > 0) {
      b.fact(
        `Há dados de tráfego no GA4 para o período analisado: ${count(g.sessions)} sessões em ${count(g.daysWithData)} de ${count(g.windowDays)} dias (${periodText(g.window)}).`,
        [sessions, days],
      );
    } else {
      // linha existente com 0 sessões = dado válido com valor zero (não é atraso nem ausência)
      b.fact(
        `O GA4 tem dados no período analisado e registrou 0 sessões em ${count(g.daysWithData)} de ${count(g.windowDays)} dias (${periodText(g.window)}): é um zero registrado, não ausência de dado.`,
        [sessions, days],
      );
    }
  } else {
    b.fact(
      `Não há dados do GA4 no período analisado (nenhuma linha em ${periodText(g.window)}): ausência de dado, não zero sessões.`,
      [sessions],
    );
  }

  const rdIds: string[] = [];
  if (m) {
    rdIds.push(
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
    );
    b.fact(
      `O RD Marketing registrou ${count(m.visits)} ${plural(m.visits, "visita", "visitas")} e ${count(m.conversions)} ${plural(m.conversions, "conversão", "conversões")} em ${describeAssets(m.assetCount, m.assetTypes)} no período (${periodText(m.window)}).`,
      rdIds,
    );
  } else {
    rdIds.push(
      b.ev({
        source: "rd_marketing",
        metric: "days_with_data",
        label: "Dias com registros (RD Marketing)",
        period: ref,
        value: 0,
      }),
    );
    b.fact(`Não há dados do RD Marketing no período analisado (${periodText(ref)}).`, rdIds);
  }

  // "Mesmo período" só vale quando AS DUAS fontes cobrem exatamente o período solicitado.
  const sameCoverage = g.hasData && m !== null && f.aligned.ga4 && f.aligned.rd_marketing;
  if (sameCoverage) {
    b.relation(
      `GA4 e RD Marketing têm dados no mesmo período (${periodText(ref)}).`,
      [sessions, ...rdIds],
    );
  }

  if (g.hasData && m && !sameCoverage) {
    b.limit(
      "period_not_aligned",
      `O período coberto pelo GA4 (${periodText(g.covered ?? g.window)}) e o coberto pelo RD Marketing (${periodText(m.covered ?? m.window)}) não coincidem com o período solicitado (${periodText(ref)}): os dois sinais não foram comparados como se fossem do mesmo período.`,
      [sessions, ...rdIds],
    );
  }
  if (m && m.conversions === 0) {
    b.limit(
      "rd_marketing_no_conversions",
      "Os dados de conversão disponíveis no RD Marketing são limitados: nenhuma conversão registrada no período.",
      rdIds,
    );
  }
  if (m) {
    b.limit(
      "rd_marketing_scope",
      "O RD Marketing, nesta integração, mede apenas ativos de conversão do RD (landing pages, formulários e pop-ups), não o tráfego geral do site; sessões do GA4 e visitas do RD Marketing não são a mesma medida.",
      rdIds,
    );
  }
  if (!m && g.hasData) {
    b.limit(
      "rd_marketing_unavailable",
      "Sem dados do RD Marketing no período, não há sinal de conversão do RD para comparar com o tráfego do GA4.",
      [sessions, ...rdIds],
    );
  }
  if (m && !g.hasData) {
    b.limit(
      "ga4_unavailable",
      "Sem dados do GA4 no período, não há base de tráfego para situar os dados do RD Marketing.",
      [sessions, ...rdIds],
    );
  }
  if (!m && !g.hasData) {
    b.limit(
      "no_acquisition_data",
      "Nenhuma das fontes de aquisição (GA4 e RD Marketing) tem dados no período analisado.",
      [sessions, ...rdIds],
    );
  }

  return b.build();
}

// ─────────────────────────────────────────────────────────────────────
// Tráfego GA4 + conversões RD Marketing, lado a lado (B). Só no MESMO período.
// ─────────────────────────────────────────────────────────────────────
export function trafficAndRdConversions(f: SourceFacts): CrossSourceInsight | null {
  const { ga4: g, rdMarketing: m } = f;
  if (!g.hasData || !m) return null;
  // lado a lado só no MESMO período: as duas fontes têm de cobrir o período solicitado
  if (!f.aligned.ga4 || !f.aligned.rd_marketing) return null;

  const b = createInsight({
    type: "traffic-and-rd-conversions",
    category: "acquisition",
    title: "Tráfego do GA4 e conversões do RD Marketing no mesmo período",
    period: f.referencePeriod,
  });

  const sessions = b.ev({
    source: "ga4",
    metric: "sessions",
    label: "Sessões (GA4)",
    period: g.window,
    value: g.sessions,
  });
  const keyEvents = b.ev({
    source: "ga4",
    metric: "key_events",
    label: "Eventos-chave (GA4)",
    period: g.window,
    value: g.keyEvents,
  });
  const visits = b.ev({
    source: "rd_marketing",
    metric: "visits",
    label: "Visitas (RD Marketing)",
    period: m.window,
    value: m.visits,
  });
  const conversions = b.ev({
    source: "rd_marketing",
    metric: "conversions",
    label: "Conversões (RD Marketing)",
    period: m.window,
    value: m.conversions,
  });

  b.fact(
    `GA4: ${count(g.sessions)} sessões e ${count(g.keyEvents)} ${plural(g.keyEvents, "evento-chave", "eventos-chave")} no período (${periodText(g.window)}).`,
    [sessions, keyEvents],
  );
  b.fact(
    `RD Marketing: ${count(m.visits)} ${plural(m.visits, "visita", "visitas")} e ${count(m.conversions)} ${plural(m.conversions, "conversão", "conversões")} em ${describeAssets(m.assetCount, m.assetTypes)} no período (${periodText(m.window)}).`,
    [visits, conversions],
  );
  b.relation(
    `No mesmo período (${periodText(f.referencePeriod)}), o GA4 registrou ${count(g.sessions)} sessões e o RD Marketing registrou ${count(m.visits)} ${plural(m.visits, "visita", "visitas")} e ${count(m.conversions)} ${plural(m.conversions, "conversão", "conversões")} — dois sinais de fontes diferentes, apresentados lado a lado.`,
    [sessions, visits, conversions],
  );
  b.limit(
    "no_joint_rate",
    "Não foi calculada taxa de conversão conjunta: sessões do GA4 e visitas do RD Marketing vêm de fontes diferentes, medem populações diferentes e não há chave de ligação entre elas.",
    [sessions, visits, conversions],
  );

  return b.build();
}
