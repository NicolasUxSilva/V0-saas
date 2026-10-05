/**
 * Construtores de `AnalysisContext` sintético para os testes do motor.
 */
import type {
  AdsContext,
  AnalysisContext,
  PeriodCoverage,
  RdCrmContext,
  RdMarketingContext,
  SegmentTotals,
  WindowAgg,
} from "@/server/analysis/types";

function seg(key: string, sessions: number, keyEvents = 0): SegmentTotals {
  return {
    key,
    sessions,
    totalUsers: Math.round(sessions * 0.8),
    newUsers: Math.round(sessions * 0.5),
    engagedSessions: Math.round(sessions * 0.6),
    keyEvents,
    conversionValue: 0,
  };
}

function windowFromChannels(
  start: string,
  end: string,
  channels: SegmentTotals[],
  daysWithData = 28,
): WindowAgg {
  const totals = channels.reduce(
    (acc, c) => ({
      sessions: acc.sessions + c.sessions,
      totalUsers: acc.totalUsers + c.totalUsers,
      newUsers: acc.newUsers + c.newUsers,
      engagedSessions: acc.engagedSessions + c.engagedSessions,
      keyEvents: acc.keyEvents + c.keyEvents,
      conversionValue: acc.conversionValue + c.conversionValue,
    }),
    {
      sessions: 0,
      totalUsers: 0,
      newUsers: 0,
      engagedSessions: 0,
      keyEvents: 0,
      conversionValue: 0,
    },
  );
  return {
    start,
    end,
    days: 28,
    daysWithData,
    totals,
    byChannel: channels,
    bySourceMedium: channels.map((c) => seg(`${c.key.toLowerCase()} / x`, c.sessions, c.keyEvents)),
  };
}

export interface ContextOpts {
  currentChannels: [string, number, number?][]; // [key, sessions, keyEvents?]
  previousChannels: [string, number, number?][];
  /** média diária de sessões no baseline */
  baselineDailyMean?: number;
  baselineDailyNoise?: number;
  distinctDates?: number;
  currentDaysWithData?: number;
  previousDaysWithData?: number;
  notSetDirectSessionShare?: number;
  zeroDayGap?: boolean;
  /** datas em que o canal responsável despenca (para testar onset) */
  onsetChannel?: string;
  onsetDate?: string;
  /** G5 — `null` por padrão (sem Ads); testes de regressão podem injetar um fixture */
  ads?: AdsContext | null;
  /** RD-1 — `null` por padrão (sem RD Station Marketing) */
  rdMarketing?: RdMarketingContext | null;
  /** RD-1 — `null` por padrão (sem RD Station CRM) */
  rdCrm?: RdCrmContext | null;
  /**
   * V1.1 — período SOLICITADO do contexto; padrão = a janela `current` do fixture.
   * Diferente dela só em testes que simulam fontes desalinhadas (para um período
   * explícito consistente, monte o contexto com `assembleAnalysisContext`).
   */
  period?: { start: string; end: string };
  /**
   * V1.1 — cobertura REAL do GA4 no período. Padrão: derivada de
   * `currentDaysWithData` e de `ga4LastDate` (sem sessões → nenhum dia, sem datas).
   */
  ga4InPeriod?: PeriodCoverage;
  /** Cross-source — último dia com dados do GA4; padrão = fim da janela (GA4 em dia) */
  ga4LastDate?: string;
  /** Cross-source — último dia que o GA4 deveria ter; padrão = fim da janela */
  expectedLastDate?: string;
}

const CUR_START = "2026-08-01";
const CUR_END = "2026-08-28";
const PREV_START = "2026-07-04";
const PREV_END = "2026-07-31";
const BASE_START = "2026-03-06";
const BASE_END = "2026-07-03";

export function makeContext(opts: ContextOpts): AnalysisContext {
  const cur = opts.currentChannels.map(([k, s, ke]) => seg(k, s, ke ?? 0));
  const prev = opts.previousChannels.map(([k, s, ke]) => seg(k, s, ke ?? 0));

  const baselineMean = opts.baselineDailyMean ?? 1000;
  const noise = opts.baselineDailyNoise ?? 20;
  const baselineDailySessions = Array.from({ length: 120 }, (_, i) =>
    Math.max(0, Math.round(baselineMean + ((i % 7) - 3) * noise)),
  );

  const current = windowFromChannels(
    CUR_START,
    CUR_END,
    cur,
    opts.currentDaysWithData ?? 28,
  );
  const previous = windowFromChannels(
    PREV_START,
    PREV_END,
    prev,
    opts.previousDaysWithData ?? 28,
  );
  const baseline: WindowAgg = {
    ...windowFromChannels(BASE_START, BASE_END, prev, 120),
    days: 120,
  };

  // série diária por canal na janela [PREV_START .. CUR_END]
  const dailyByChannel: AnalysisContext["dailyByChannel"] = [];
  const days: string[] = [];
  {
    let d = new Date(`${PREV_START}T00:00:00Z`);
    const endD = new Date(`${CUR_END}T00:00:00Z`);
    while (d <= endD) {
      days.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 86_400_000);
    }
  }
  for (const date of days) {
    const inCurrent = date >= CUR_START;
    for (const c of inCurrent ? cur : prev) {
      let daily = c.sessions / 28;
      if (
        opts.onsetChannel === c.key &&
        opts.onsetDate &&
        date >= opts.onsetDate
      ) {
        daily *= 0.3; // despenca após o onset
      }
      dailyByChannel.push({ date, channel: c.key, sessions: Math.round(daily) });
    }
  }

  const dailySeries = days.map((date) => {
    const chans = date >= CUR_START ? cur : prev;
    const sessions = dailyByChannel
      .filter((r) => r.date === date)
      .reduce((a, r) => a + r.sessions, 0);
    const keyEvents =
      chans.reduce((a, c) => a + c.keyEvents, 0) / 28;
    return {
      date,
      sessions,
      totalUsers: Math.round(sessions * 0.8),
      newUsers: Math.round(sessions * 0.5),
      engagedSessions: Math.round(sessions * 0.6),
      keyEvents,
      conversionValue: 0,
    };
  });

  const totalKeyEvents =
    current.totals.keyEvents + previous.totals.keyEvents + baseline.totals.keyEvents;

  // Cobertura real do GA4 no período: sem sessões não há dia com dado; com sessões
  // vale o que o teste pediu em `currentDaysWithData`, terminando em `ga4LastDate`
  // quando o GA4 está atrasado.
  const ga4LastDate = opts.ga4LastDate ?? CUR_END;
  const inPeriodDefault: PeriodCoverage =
    current.totals.sessions > 0
      ? {
          daysWithData: current.daysWithData,
          firstDate: CUR_START,
          lastDate: ga4LastDate < CUR_END ? ga4LastDate : CUR_END,
        }
      : { daysWithData: 0, firstDate: null, lastDate: null };

  return {
    workspaceId: "ws-test",
    propertyTimezone: "America/Sao_Paulo",
    period: opts.period ?? { start: CUR_START, end: CUR_END },
    analysisEnd: CUR_END,
    coverage: {
      firstDate: BASE_START,
      lastDate: ga4LastDate,
      distinctDates: opts.distinctDates ?? 176,
      expectedDays: 180,
      expectedLastDate: opts.expectedLastDate ?? CUR_END,
      inPeriod: opts.ga4InPeriod ?? inPeriodDefault,
    },
    totalKeyEvents,
    totalConversionValue: 0,
    notSetDirectSessionShare: opts.notSetDirectSessionShare ?? 0.1,
    zeroDayGap: opts.zeroDayGap ?? false,
    baselineDailySessions,
    dailyByChannel,
    dailySeries,
    current,
    previous,
    baseline,
    ads: opts.ads ?? null,
    rdMarketing: opts.rdMarketing ?? null,
    rdCrm: opts.rdCrm ?? null,
  };
}
