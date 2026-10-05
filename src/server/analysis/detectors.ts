/**
 * Detectores determinísticos da V0 (bloco C4).
 *
 *  - detectDataQuality        : repassa os insights derivados dos gates
 *  - detectTrafficVolumeDrop  : queda de sessões vs baseline (z robusto)
 *  - detectConversionEfficiencyDrop : queda de conversões (z de 2 proporções)
 *
 * Cada detector aplica G1 (volume), G2 (significância) e G3 (materialidade) e
 * anexa as medições em `gateTrace`. Só emite com confiança ≥ média.
 */
import { formatCount } from "@/lib/format";

import { decomposeBySegment, detectOnset, topContributors } from "./contribution";
import {
  deseasonalize,
  mean,
  robustZOfMean,
  twoProportionZTest,
  weekdayProfile,
} from "./stats";
import {
  absPct,
  conversionDropText,
  trafficDropText,
} from "./templates";
import type {
  AnalysisContext,
  DetectorInsight,
  GateReport,
  InsightConfidence,
} from "./types";

// limiares
const MIN_SESSIONS_WINDOW = 500;
const MIN_DELTA = 0.1;
const MIN_Z_ROBUST = 2.5;
const MIN_IMPACT_SESSIONS = 300;

const MIN_SESSIONS_CONV = 100;
const MIN_KEY_EVENTS = 25;
const MIN_Z_PROP = 1.96;
const MIN_IMPACT_CONVERSIONS = 10;

function halves<T>(xs: T[]): [T[], T[]] {
  const mid = Math.ceil(xs.length / 2);
  return [xs.slice(0, mid), xs.slice(mid)];
}

// ─────────────────────────────────────────────────────────────────────
export function detectDataQuality(
  _ctx: AnalysisContext,
  gates: GateReport,
): DetectorInsight[] {
  return gates.dataQualityInsights;
}

// ─────────────────────────────────────────────────────────────────────
export function detectTrafficVolumeDrop(
  ctx: AnalysisContext,
  gates: GateReport,
): DetectorInsight[] {
  if (gates.suppress.has("traffic") || !gates.hasComparableWindows) return [];

  const cur = ctx.current.totals.sessions;
  const prev = ctx.previous.totals.sessions;

  // G1 — volume mínimo
  if (cur < MIN_SESSIONS_WINDOW || prev < MIN_SESSIONS_WINDOW) return [];

  const deltaPct = prev > 0 ? (cur - prev) / prev : 0; // queda do SITE

  // séries diárias de sessões (com data) — janela atual (de dailyByChannel),
  // anterior e baseline (de dailySeries, que cobre baselineStart..analysisEnd).
  const currentDailySeries = [
    ...ctx.dailyByChannel
      .filter((r) => r.date >= ctx.current.start && r.date <= ctx.current.end)
      .reduce<Map<string, number>>((m, r) => {
        m.set(r.date, (m.get(r.date) ?? 0) + r.sessions);
        return m;
      }, new Map())
      .entries(),
  ]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const currentDailyValues = currentDailySeries.map((p) => p.value);

  const baselineDailySeries = ctx.dailySeries
    .filter((d) => d.date >= ctx.baseline.start && d.date <= ctx.baseline.end)
    .map((d) => ({ date: d.date, value: d.sessions }));
  const previousDailySeries = ctx.dailySeries
    .filter((d) => d.date >= ctx.previous.start && d.date <= ctx.previous.end)
    .map((d) => ({ date: d.date, value: d.sessions }));

  // #4 — remove a sazonalidade semanal antes do teste de significância.
  // Baseline curto (< 3 semanas) → sem ajuste (perfil neutro).
  const canDeseasonalize = baselineDailySeries.length >= 21;
  const profile = canDeseasonalize
    ? weekdayProfile(baselineDailySeries)
    : [1, 1, 1, 1, 1, 1, 1];
  const currentAdj = deseasonalize(currentDailySeries, profile).map(
    (p) => p.value,
  );
  const baselineAdj = deseasonalize(baselineDailySeries, profile).map(
    (p) => p.value,
  );
  const previousAdjMean = mean(
    deseasonalize(previousDailySeries, profile).map((p) => p.value),
  );

  const rawZ = robustZOfMean(currentDailyValues, ctx.baselineDailySessions);
  const desZ = canDeseasonalize
    ? robustZOfMean(currentAdj, baselineAdj)
    : rawZ;
  const z = desZ.z; // significância usa o z deseasonalizado
  const baselineMedian = desZ.baselineMedian;
  const sigma = desZ.sigma;

  // G2 — significância + direção (só quedas)
  if (!(deltaPct <= -MIN_DELTA && z <= -MIN_Z_ROBUST)) return [];

  // G3 — materialidade (impacto no nível do site)
  const impactSessions = Math.round(prev - cur);
  if (impactSessions < MIN_IMPACT_SESSIONS) return [];

  // contribuição por canal
  const contributions = decomposeBySegment(
    ctx.current.byChannel,
    ctx.previous.byChannel,
    "sessions",
  );
  const top = topContributors(contributions, 0.7);
  const responsible = top[0] ?? null;
  const otherContributors = Math.max(top.length - 1, 0);

  // números DO CANAL responsável (#3)
  const respPrev = responsible?.previous ?? 0;
  const respCur = responsible?.current ?? 0;
  const responsibleDeltaPct =
    respPrev > 0 ? (respCur - respPrev) / respPrev : 0;
  const channelImpact = Math.round(respPrev - respCur);

  // onset na série diária do canal responsável
  let onsetDate: string | null = null;
  if (responsible) {
    const segDaily = ctx.dailyByChannel
      .filter(
        (r) =>
          r.channel === responsible.key &&
          r.date >= ctx.previous.start &&
          r.date <= ctx.current.end,
      )
      .map((r) => ({ date: r.date, value: r.sessions }));
    onsetDate = detectOnset(segDaily)?.date ?? null;
  }

  // confiança (usa o z deseasonalizado e a série ajustada)
  const completeness = ctx.current.daysWithData / ctx.current.days;
  const [h1, h2] = halves(currentAdj);
  const stableAcrossHalves =
    h1.length > 0 &&
    h2.length > 0 &&
    mean(h1) < previousAdjMean &&
    mean(h2) < previousAdjMean;
  const confidence: InsightConfidence =
    Math.abs(z) >= 3 &&
    completeness >= 0.95 &&
    cur >= 2 * MIN_SESSIONS_WINDOW &&
    stableAcrossHalves
      ? "alta"
      : "media";

  // Severidade — REGRA ATUAL INALTERADA (D1 #5 pendente de calibração pós-piloto).
  // O `z` já é o deseasonalizado; `deltaPct` continua sendo o do site.
  const severity: DetectorInsight["severity"] =
    Math.abs(deltaPct) >= 0.25 || Math.abs(z) >= 4 ? "critical" : "attention";

  const text = trafficDropText({
    current: cur,
    previous: prev,
    deltaPct,
    baselineDaily: baselineMedian,
    responsibleValue: responsible?.key ?? null,
    responsibleShare: responsible?.share ?? 0,
    responsibleCurrent: respCur,
    responsiblePrevious: respPrev,
    onsetDate,
    otherContributorsCount: otherContributors,
  });

  const siteBaseline28 = Number.isFinite(baselineMedian)
    ? Math.round(baselineMedian * ctx.current.days)
    : null;
  const desLabel = canDeseasonalize
    ? "sem sazonalidade semanal"
    : "baseline curto — sem ajuste de sazonalidade";

  return [
    {
      detector: "traffic-volume-drop",
      type: "sessions_drop",
      kind: "problem",
      severity,
      title: text.title,
      impact: {
        value: responsible ? channelImpact : impactSessions,
        unit: "sessions",
        basis: responsible
          ? `sessões de ${responsible.key} abaixo do período anterior`
          : "sessões abaixo do período anterior",
        isEstimate: true,
      },
      explanation: text.explanation,
      hypothesis: text.hypothesis,
      evidence: {
        metricLabel: responsible ? `Sessões — ${responsible.key}` : "Sessões",
        current: responsible ? respCur : cur,
        previous: responsible ? respPrev : prev,
        baseline: responsible ? null : siteBaseline28,
        deltaPct: responsible ? responsibleDeltaPct : deltaPct,
        format: "count",
        test: responsible
          ? `Site (todos os canais): ${formatCount(prev)} → ${formatCount(cur)} (${absPct(deltaPct)})${
              siteBaseline28 != null
                ? `, vs. baseline ~120d ≈ ${formatCount(siteBaseline28)}/28d`
                : ""
            }. ${responsible.key} = ${absPct(responsible.share)} da queda. Significância (sessões do site, ${desLabel}): z robusto = ${z.toFixed(1)} (bruto ${rawZ.z.toFixed(1)}).`
          : `z robusto vs. baseline diária (mediana ${formatCount(
              Math.round(baselineMedian),
            )}, σ ${formatCount(Math.round(sigma))}), ${desLabel}: z = ${z.toFixed(1)} (bruto ${rawZ.z.toFixed(1)})`,
        breakdown: top.map((c) => ({
          label: c.key,
          contributionPct: c.share,
          detail: `${formatCount(c.previous)} → ${formatCount(c.current)} sessões`,
        })),
      },
      periodStart: ctx.current.start,
      periodEnd: ctx.current.end,
      comparedTo: "28 dias anteriores",
      responsibleDimension: responsible
        ? {
            name: "canal",
            value: responsible.key,
            share: Math.abs(responsible.share),
          }
        : null,
      confidence,
      confidenceBasis: `z = ${z.toFixed(1)}${
        canDeseasonalize ? " (deseasonalizado)" : ""
      } · ${formatCount(cur)} sessões/28d · completude ${absPct(completeness)}${
        confidence === "alta" ? " · efeito estável nas 2 metades" : ""
      }`,
      recommendedAction: text.recommendedAction,
      priorityScore: 0,
      dedupeKey: `traffic-volume-drop:${responsible?.key ?? "total"}`,
      gateTrace: {
        onsetDate,
        // significância (#4)
        g2_zRobust: Number(z.toFixed(2)), // = deseasonalizado — o que a regra usa
        g2_zRobust_raw: Number(rawZ.z.toFixed(2)),
        g2_zRobust_deseasonalized: Number(desZ.z.toFixed(2)),
        weekdayProfile: profile.map((f) => Number(f.toFixed(3))),
        deseasonalized: canDeseasonalize,
        // magnitude
        g3_deltaPct: Number(deltaPct.toFixed(3)), // site
        channelDeltaPct: responsible
          ? Number(responsibleDeltaPct.toFixed(3))
          : null,
        // impacto
        impactSessions, // site — o que G3 checou
        channelImpactSessions: responsible ? channelImpact : null,
        // volume
        currentSessions: cur,
        previousSessions: prev,
        baselineMedianDaily: Math.round(baselineMedian),
        // componentes para calibrar a severidade depois do piloto (#5)
        severityRule: "|siteDeltaPct| >= 0.25 || |zDeseason| >= 4",
        severityComputed: severity,
        severityInputs: {
          siteDeltaPct: Number(deltaPct.toFixed(3)),
          channelDeltaPct: responsible
            ? Number(responsibleDeltaPct.toFixed(3))
            : null,
          zRaw: Number(rawZ.z.toFixed(2)),
          zDeseasonalized: Number(desZ.z.toFixed(2)),
          siteImpactSessions: impactSessions,
          channelImpactSessions: responsible ? channelImpact : null,
        },
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────
export function detectConversionEfficiencyDrop(
  ctx: AnalysisContext,
  gates: GateReport,
): DetectorInsight[] {
  if (gates.suppress.has("conversion") || !gates.hasComparableWindows) return [];

  const curSess = ctx.current.totals.sessions;
  const prevSess = ctx.previous.totals.sessions;
  const curKE = ctx.current.totals.keyEvents;
  const prevKE = ctx.previous.totals.keyEvents;

  // G1
  if (
    curSess < MIN_SESSIONS_CONV ||
    prevSess < MIN_SESSIONS_CONV ||
    curKE < MIN_KEY_EVENTS ||
    prevKE < MIN_KEY_EVENTS
  ) {
    return [];
  }

  const { z, p } = twoProportionZTest(curKE, curSess, prevKE, prevSess);
  const curRate = curKE / curSess;
  const prevRate = prevKE / prevSess;
  const deltaPct = prevKE > 0 ? (curKE - prevKE) / prevKE : 0;

  // G2 + direção
  if (!(Math.abs(z) >= MIN_Z_PROP && deltaPct <= -MIN_DELTA)) return [];

  // G3 — materialidade (conversões perdidas)
  const impactConversions = Math.round((prevRate - curRate) * curSess);
  if (impactConversions < MIN_IMPACT_CONVERSIONS) return [];

  // decomposição volume vs eficiência por canal
  const byKey = new Map(
    ctx.current.byChannel.map((s) => [
      s.key,
      { curSess: s.sessions, curKE: s.keyEvents },
    ]),
  );
  let volumeEffect = 0;
  let efficiencyEffect = 0;
  const perChannel: { key: string; efficiency: number; volume: number }[] = [];
  for (const prevSeg of ctx.previous.byChannel) {
    const c = byKey.get(prevSeg.key) ?? { curSess: 0, curKE: 0 };
    const rPrev = prevSeg.sessions > 0 ? prevSeg.keyEvents / prevSeg.sessions : 0;
    const rCur = c.curSess > 0 ? c.curKE / c.curSess : 0;
    const vol = (c.curSess - prevSeg.sessions) * rPrev;
    const eff = c.curSess * (rCur - rPrev);
    volumeEffect += vol;
    efficiencyEffect += eff;
    perChannel.push({ key: prevSeg.key, efficiency: eff, volume: vol });
  }
  const effect: "efficiency" | "volume" | "mixed" =
    Math.abs(efficiencyEffect) > Math.abs(volumeEffect) * 1.5
      ? "efficiency"
      : Math.abs(volumeEffect) > Math.abs(efficiencyEffect) * 1.5
        ? "volume"
        : "mixed";

  const responsible =
    [...perChannel].sort(
      (a, b) =>
        Math.abs(effect === "volume" ? b.volume : b.efficiency) -
        Math.abs(effect === "volume" ? a.volume : a.efficiency),
    )[0] ?? null;
  const respPrevSeg = ctx.previous.byChannel.find(
    (s) => s.key === responsible?.key,
  );
  const respCur = byKey.get(responsible?.key ?? "");
  const rBefore =
    respPrevSeg && respPrevSeg.sessions > 0
      ? respPrevSeg.keyEvents / respPrevSeg.sessions
      : 0;
  const rAfter =
    respCur && respCur.curSess > 0 ? respCur.curKE / respCur.curSess : 0;
  const totalEffect = volumeEffect + efficiencyEffect;
  const responsibleShare =
    totalEffect !== 0 && responsible
      ? (effect === "volume" ? responsible.volume : responsible.efficiency) /
        totalEffect
      : 0;

  const onsetDate =
    detectOnset(
      ctx.dailySeries.map((d) => ({ date: d.date, value: d.keyEvents })),
    )?.date ?? null;

  const completeness = ctx.current.daysWithData / ctx.current.days;
  const confidence: InsightConfidence =
    Math.abs(z) >= 3 && completeness >= 0.95 && curKE >= 2 * MIN_KEY_EVENTS
      ? "alta"
      : "media";
  const severity: DetectorInsight["severity"] =
    Math.abs(deltaPct) >= 0.2 ? "critical" : "attention";

  const text = conversionDropText({
    currentRate: curRate,
    previousRate: prevRate,
    currentKeyEvents: curKE,
    previousKeyEvents: prevKE,
    deltaPct,
    responsibleValue: responsible?.key ?? null,
    responsibleShare,
    responsibleRateBefore: rBefore,
    responsibleRateAfter: rAfter,
    effect,
    onsetDate,
  });

  return [
    {
      detector: "conversion-efficiency-drop",
      type: "conversions_drop",
      kind: "problem",
      severity,
      title: text.title,
      impact: {
        value: impactConversions,
        unit: "conversions",
        basis: "conversões a menos vs. o período anterior",
        isEstimate: true,
      },
      explanation: text.explanation,
      hypothesis: text.hypothesis,
      evidence: {
        metricLabel: "Conversões (key events)",
        current: curKE,
        previous: prevKE,
        baseline: null,
        deltaPct,
        format: "count",
        test: `z de 2 proporções (taxa de conversão): z = ${z.toFixed(1)} (p ${
          p < 0.001 ? "< 0,001" : `= ${p.toFixed(3)}`
        })`,
        breakdown: perChannel
          .filter((c) => Math.abs(c.efficiency) + Math.abs(c.volume) > 0)
          .sort(
            (a, b) =>
              Math.abs(b.efficiency + b.volume) -
              Math.abs(a.efficiency + a.volume),
          )
          .slice(0, 4)
          .map((c) => ({
            label: c.key,
            contributionPct:
              totalEffect !== 0 ? (c.efficiency + c.volume) / totalEffect : 0,
            detail:
              Math.abs(c.efficiency) > Math.abs(c.volume)
                ? "efeito eficiência"
                : "efeito volume",
          })),
      },
      periodStart: ctx.current.start,
      periodEnd: ctx.current.end,
      comparedTo: "28 dias anteriores",
      responsibleDimension: responsible
        ? { name: "canal", value: responsible.key, share: Math.abs(responsibleShare) }
        : null,
      confidence,
      confidenceBasis: `z = ${z.toFixed(1)} · ${formatCount(curKE)} conversões/28d · completude ${absPct(completeness)}`,
      recommendedAction: text.recommendedAction,
      priorityScore: 0,
      dedupeKey: `conversion-efficiency-drop:${responsible?.key ?? "total"}`,
      gateTrace: {
        onsetDate,
        g2_z: Number(z.toFixed(2)),
        g2_p: Number(p.toFixed(4)),
        g3_deltaPct: Number(deltaPct.toFixed(3)),
        volumeEffect: Math.round(volumeEffect),
        efficiencyEffect: Math.round(efficiencyEffect),
        impactConversions,
      },
    },
  ];
}
