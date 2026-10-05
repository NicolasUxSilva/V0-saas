/**
 * Fixtures da camada Cross-source V1.
 *
 * Os contextos de RD são montados pelos compositores REAIS (`composeRdMarketingContext`
 * / `composeRdCrmContext`), a partir de linhas no formato das fact tables — assim os
 * testes exercitam exatamente o shape que `buildAnalysisContext` entrega, em vez de
 * objetos escritos à mão que poderiam divergir dele.
 *
 * Janela de todos os cenários = a de `makeContext` (2026-08-01 → 2026-08-28).
 */
import { addDays } from "@/lib/dates";
import {
  assembleAnalysisContext,
  composeRdCrmContext,
  composeRdMarketingContext,
} from "@/server/analysis/context";
import { planWindows } from "@/server/analysis/period";
import type {
  AnalysisContext,
  DayPoint,
  RdCrmContext,
  RdMarketingContext,
} from "@/server/analysis/types";

import { makeContext, type ContextOpts } from "./fixtures";

export const WINDOW = { start: "2026-08-01", end: "2026-08-28" };

// ── RD Marketing ─────────────────────────────────────────────────────────

export interface FakeAsset {
  assetId: string;
  assetIdentifier?: string;
  assetType?: string;
  visits: number;
  conversions: number;
}

/** Todas as datas de `start` a `end`, inclusive. */
export function range(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Ativos × dias → `RdMarketingContext` real. `days` = quantos dias DA JANELA a fonte
 * respondeu (padrão: todos); os dias começam no 1º dia da janela. `dates` escolhe
 * EXATAMENTE quais dias têm linha (ex.: só o meio do período) e prevalece sobre
 * `days` — dia fora de `dates` é dia SEM DADO, nunca uma linha zerada.
 */
export function makeRdMarketing(
  assets: FakeAsset[],
  opts: { days?: number; dates?: string[]; window?: { start: string; end: string } } = {},
): RdMarketingContext {
  const window = opts.window ?? WINDOW;
  const days = opts.days ?? 28;
  const dates = opts.dates ?? Array.from({ length: days }, (_, i) => addDays(window.start, i));

  const ctx = composeRdMarketingContext(
    assets.map((a) => ({
      assetId: a.assetId,
      visits: a.visits,
      conversions: a.conversions,
      conversionRate: a.visits > 0 ? a.conversions / a.visits : 0,
    })),
    assets.flatMap((a) =>
      dates.map((date) => ({
        assetId: a.assetId,
        date,
        assetIdentifier: a.assetIdentifier ?? `LP ${a.assetId}`,
        assetType: a.assetType ?? "LandingPage",
      })),
    ),
    window,
  );
  if (!ctx) throw new Error("fixture inválida: RD Marketing sem ativos");
  return ctx;
}

// ── RD CRM ───────────────────────────────────────────────────────────────

type CrmRow = Parameters<typeof composeRdCrmContext>[0][number];

/** Negociação criada dentro da janela, aberta, sem valor, com origem e sem campanha. */
export function deal(over: Partial<CrmRow> = {}): CrmRow {
  return {
    status: "ongoing",
    totalPrice: 0,
    pipelineId: "p1",
    dealCreatedAt: "2026-08-10",
    dealClosedAt: null,
    sourceId: "src-1",
    campaignId: "",
    ...over,
  };
}

export const deals = (n: number, over: Partial<CrmRow> = {}): CrmRow[] =>
  Array.from({ length: n }, () => deal(over));

/** Negociação GANHA dentro da janela (criada antes dela, para não contar também em `created`). */
export const won = (over: Partial<CrmRow> = {}): CrmRow =>
  deal({ status: "won", dealCreatedAt: "2026-07-01", dealClosedAt: "2026-08-12", ...over });

/** Negociação PERDIDA dentro da janela (criada antes dela). */
export const lost = (over: Partial<CrmRow> = {}): CrmRow =>
  deal({ status: "lost", dealCreatedAt: "2026-07-01", dealClosedAt: "2026-08-13", ...over });

export function makeRdCrm(
  rows: CrmRow[],
  window: { start: string; end: string } = WINDOW,
  /** início do histórico de CRM importado no SaaS; `null` (padrão) = desconhecido */
  importedHistoryStartDate: string | null = null,
): RdCrmContext {
  const ctx = composeRdCrmContext(rows, window, importedHistoryStartDate);
  if (!ctx) throw new Error("fixture inválida: RD CRM sem negociações na janela");
  return ctx;
}

// ── cenários ─────────────────────────────────────────────────────────────

/** GA4 com 5.377 sessões na janela atual (mesma ordem de grandeza do piloto). */
export const GA4_SESSIONS = 5377;

export function scenario(
  opts: {
    rdMarketing?: RdMarketingContext | null;
    rdCrm?: RdCrmContext | null;
    /** sessões da janela atual; 0 = GA4 SEM LINHAS (ausência de dado) — veja `ga4ZeroRows` */
    sessions?: number;
    /** com `sessions: 0`: o GA4 TEM linhas em todos os dias, todas com 0 sessões (zero registrado) */
    ga4ZeroRows?: boolean;
  } & Partial<ContextOpts> = {},
): AnalysisContext {
  const { rdMarketing, rdCrm, sessions = GA4_SESSIONS, ga4ZeroRows = false, ...rest } = opts;
  const channels: [string, number][] =
    sessions > 0
      ? [
          ["Organic Search", Math.round(sessions * 0.6)],
          ["Direct", sessions - Math.round(sessions * 0.6)],
        ]
      : [];
  return makeContext({
    currentChannels: channels,
    previousChannels: channels,
    currentDaysWithData: sessions > 0 ? 28 : 0,
    // linha com zero registrado = dado válido: a cobertura por existência de linha é a janela inteira
    ...(sessions === 0 && ga4ZeroRows
      ? { ga4InPeriod: { daysWithData: 28, firstDate: WINDOW.start, lastDate: WINDOW.end } }
      : {}),
    rdMarketing: rdMarketing ?? null,
    rdCrm: rdCrm ?? null,
    ...rest,
  });
}

/** Piloto em miniatura: 2 landing pages (6 visitas, 0 conversões) e um CRM com criados, ganhos e perdidos. */
export function pilotLikeContext(): AnalysisContext {
  return scenario({
    rdMarketing: makeRdMarketing([
      { assetId: "a1", assetIdentifier: "lp-exemplo", visits: 6, conversions: 0 },
      { assetId: "a2", assetIdentifier: "lp-confirmacao-exemplo", visits: 0, conversions: 0 },
    ]),
    rdCrm: makeRdCrm([
      // 9 criados na janela, todos abertos; origem em 8 de 9, campanha em nenhum
      ...Array.from({ length: 8 }, (_, i) => deal({ sourceId: `src-${(i % 3) + 1}` })),
      deal({ sourceId: "" }),
      // 5 ganhos (1 com valor), 14 perdidos (sem valor) — todos criados antes da janela
      won({ totalPrice: 23399 }),
      ...Array.from({ length: 4 }, () => won()),
      ...Array.from({ length: 14 }, () => lost()),
    ]),
  });
}

// ── período EXPLÍCITO (V1.1) ──────────────────────────────────────────────
// Montados por `assembleAnalysisContext` — o MESMO código que `buildAnalysisContext`
// usa depois de ler o banco — sobre linhas sintéticas, em vez de objetos à mão.

const dayPoint = (date: string, sessions: number): DayPoint => ({
  date,
  sessions,
  totalUsers: Math.round(sessions * 0.8),
  newUsers: Math.round(sessions * 0.5),
  engagedSessions: Math.round(sessions * 0.6),
  keyEvents: 0,
  conversionValue: 0,
});

/**
 * Contexto de um período explícito. O GA4 só tem sessões nos dias de `ga4Days`
 * (padrão: todos os do período) — dia ausente é dia SEM linha, como no banco.
 */
export function periodContext(opts: {
  period: { start: string; end: string };
  /** dias com sessões no GA4; padrão: todos os dias do período */
  ga4Days?: string[];
  sessionsPerDay?: number;
  /**
   * As linhas do GA4, uma por dia, com o valor exato — inclusive `sessions: 0` (linha
   * existente com zero registrado). Dia fora da lista é dia SEM linha (ausência de
   * dado). Prevalece sobre `ga4Days`/`sessionsPerDay`.
   */
  ga4Rows?: { date: string; sessions: number }[];
  /** último dia com linha no GA4 (todo o histórico); padrão: o maior de `ga4Days` */
  ga4LastDate?: string;
  /** padrão: o fim do período (é o que `buildAnalysisContext` usa com período explícito) */
  expectedLastDate?: string;
  rdMarketing?: RdMarketingContext | null;
  rdCrm?: RdCrmContext | null;
}): AnalysisContext {
  const { period } = opts;
  const periodDays = range(period.start, period.end);
  const plan = planWindows(period.end, periodDays.length);
  if (plan.periodStart !== period.start) throw new Error("fixture inválida: plano ≠ período");

  const perDay = opts.sessionsPerDay ?? 190;
  const rows =
    opts.ga4Rows ?? (opts.ga4Days ?? periodDays).map((date) => ({ date, sessions: perDay }));
  const ga4Days = rows.map((r) => r.date);
  const total = rows.reduce((sum, r) => sum + r.sessions, 0);
  const channel = (key: string, sessions: number) => ({
    key,
    sessions,
    totalUsers: Math.round(sessions * 0.8),
    newUsers: Math.round(sessions * 0.5),
    engagedSessions: Math.round(sessions * 0.6),
    keyEvents: 0,
    conversionValue: 0,
  });

  return assembleAnalysisContext({
    workspaceId: "ws-test",
    plan,
    expectedLastDate: opts.expectedLastDate ?? period.end,
    traffic: {
      timezone: "America/Sao_Paulo",
      firstDate: ga4Days[0] ?? null,
      lastDate: opts.ga4LastDate ?? ga4Days[ga4Days.length - 1] ?? period.end,
      distinctDates: ga4Days.length,
      daily: rows.map((r) => dayPoint(r.date, r.sessions)),
      curByChannel: total > 0 ? [channel("Organic Search", total)] : [],
      curBySM: total > 0 ? [channel("google / organic", total)] : [],
      prevByChannel: [],
      prevBySM: [],
      baseByChannel: [],
      dailyByChannel: [],
    },
    ads: null,
    rdMarketing: opts.rdMarketing ?? null,
    rdCrm: opts.rdCrm ?? null,
  });
}

/** O fechamento parcial de outubro em miniatura: 01–04/10/2026 (qui–dom). */
export const OCT = { start: "2026-10-01", end: "2026-10-04" };

/** Os 9 criados / 5 ganhos (1 com valor) / 14 perdidos do CRM piloto, na janela de outubro. */
export function octoberCrmRows(): CrmRow[] {
  const inWindow = { dealCreatedAt: "2026-10-02" };
  return [
    ...Array.from({ length: 8 }, (_, i) => deal({ ...inWindow, sourceId: `src-${(i % 3) + 1}` })),
    deal({ ...inWindow, sourceId: "" }),
    won({ totalPrice: 23399, dealClosedAt: "2026-10-01" }),
    ...Array.from({ length: 4 }, () => won({ dealClosedAt: "2026-10-01" })),
    ...Array.from({ length: 14 }, () => lost({ dealClosedAt: "2026-10-02" })),
  ];
}
