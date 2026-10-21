/**
 * Período, comparação e cobertura de importação da área Campanhas — PURO.
 *
 * Datas são "YYYY-MM-DD" de calendário. Cada plataforma grava o dia no fuso da PRÓPRIA
 * conta de anúncios; o período escolhido é aplicado a cada conta nesse calendário dela
 * (o mesmo que o Ads Manager e o Google Ads mostram). O "hoje" de referência para
 * montar o período padrão é o de America/Sao_Paulo (o mesmo do Diagnóstico).
 *
 * Cobertura vem de `sync_runs`, não das linhas: um dia sem linha numa janela importada
 * é ZERO registrado (sem veiculação); um dia que nenhuma importação cobriu é AUSÊNCIA.
 * Uma importação cobre [period_start, period_end]; o `period_end` é o "hoje" da conta no
 * momento da importação — esse dia foi importado PARCIAL (ainda estava em curso).
 */
import { addDays } from "@/lib/dates";
import type {
  CampaignFilters,
  DateWindow,
  PlatformFilter,
  SortKey,
  WindowCoverage,
} from "@/lib/campaigns";

export const PERIOD_PRESETS = [7, 14, 28, 30, 90] as const;
export const DEFAULT_PRESET = 28;
export const MAX_PERIOD_DAYS = 366;
export const PAGE_SIZE = 50;

const SORT_KEYS: readonly SortKey[] = [
  "cost",
  "cost_delta",
  "results",
  "cost_per_result",
  "cost_per_result_delta",
  "name",
];

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/** Dias no intervalo inclusivo. */
export function daysIn(w: DateWindow): number {
  return dayNumber(w.end) - dayNumber(w.start) + 1;
}

/** "YYYY-MM-DD" válido de verdade (rejeita 2026-02-31). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** O período de mesmo tamanho imediatamente anterior. */
export function previousWindow(w: DateWindow): DateWindow {
  const n = daysIn(w);
  return { start: addDays(w.start, -n), end: addDays(w.start, -1) };
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Lê os filtros da URL. Valor inválido não quebra a página: cai no padrão e vira um
 * aviso explícito (nunca é "corrigido" em silêncio).
 */
export function parseFilters(
  params: Params,
  today: string,
): { filters: CampaignFilters; warnings: string[] } {
  const warnings: string[] = [];
  const yesterday = addDays(today, -1);

  const platformRaw = one(params.plataforma);
  const platform: PlatformFilter =
    platformRaw === "google_ads" || platformRaw === "meta_ads" ? platformRaw : "all";

  let preset: number | "custom" = DEFAULT_PRESET;
  let current: DateWindow = { start: addDays(yesterday, -(DEFAULT_PRESET - 1)), end: yesterday };

  const periodRaw = one(params.periodo);
  if (periodRaw === "custom") {
    const start = one(params.inicio);
    const end = one(params.fim);
    if (!isIsoDate(start) || !isIsoDate(end)) {
      warnings.push("Datas do período personalizado inválidas: usando os últimos 28 dias.");
    } else if (start > end) {
      warnings.push("A data inicial é posterior à final: usando os últimos 28 dias.");
    } else if (end > today) {
      warnings.push("O período não pode terminar depois de hoje: usando os últimos 28 dias.");
    } else if (daysIn({ start, end }) > MAX_PERIOD_DAYS) {
      warnings.push(`O período máximo é de ${MAX_PERIOD_DAYS} dias: usando os últimos 28 dias.`);
    } else {
      preset = "custom";
      current = { start, end };
    }
  } else if (periodRaw !== undefined) {
    const n = Number(periodRaw);
    if ((PERIOD_PRESETS as readonly number[]).includes(n)) {
      preset = n;
      current = { start: addDays(yesterday, -(n - 1)), end: yesterday };
    } else {
      warnings.push("Período desconhecido: usando os últimos 28 dias.");
    }
  }

  const compare = one(params.comparar) !== "nao";
  const statusRaw = one(params.status)?.trim();
  const sortRaw = one(params.ordem);
  const pageRaw = Number(one(params.pagina) ?? "1");

  return {
    filters: {
      platform,
      preset,
      current,
      previous: compare ? previousWindow(current) : null,
      status: statusRaw && /^[A-Z_]{1,40}$/.test(statusRaw) ? statusRaw : null,
      onlyCostWithoutResult: one(params.foco) === "sem_resultado",
      sort: SORT_KEYS.includes(sortRaw as SortKey) ? (sortRaw as SortKey) : "cost",
      page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    },
    warnings,
  };
}

/** Os filtros de volta para a URL (só o que difere do padrão). */
export function filtersToQuery(f: CampaignFilters, overrides: Partial<CampaignFilters> = {}): string {
  const v = { ...f, ...overrides };
  const q = new URLSearchParams();
  if (v.platform !== "all") q.set("plataforma", v.platform);
  if (v.preset === "custom") {
    q.set("periodo", "custom");
    q.set("inicio", v.current.start);
    q.set("fim", v.current.end);
  } else if (v.preset !== DEFAULT_PRESET) {
    q.set("periodo", String(v.preset));
  }
  if (!v.previous) q.set("comparar", "nao");
  if (v.status) q.set("status", v.status);
  if (v.onlyCostWithoutResult) q.set("foco", "sem_resultado");
  if (v.sort !== "cost") q.set("ordem", v.sort);
  if (v.page > 1) q.set("pagina", String(v.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Uma importação concluída (success | partial) e a janela que ela cobriu. */
export interface ImportedWindow {
  periodStart: string;
  periodEnd: string;
}

/**
 * Quanto de `w` foi importado. Dia `d` está FECHADO se alguma importação cobriu `d`
 * depois de ele terminar (`start ≤ d < end`); PARCIAL se só foi importado no próprio
 * dia (`d = end`); senão, AUSENTE.
 */
export function windowCoverage(runs: readonly ImportedWindow[], w: DateWindow): WindowCoverage {
  const first = dayNumber(w.start);
  const n = daysIn(w);
  const complete = new Uint8Array(n);
  const partial = new Uint8Array(n);

  for (const r of runs) {
    const s = dayNumber(r.periodStart) - first;
    const e = dayNumber(r.periodEnd) - first;
    for (let i = Math.max(0, s); i <= Math.min(n - 1, e - 1); i++) complete[i] = 1;
    if (e >= 0 && e < n && s <= e) partial[e] = 1;
  }

  let completeDays = 0;
  const partialDays: string[] = [];
  for (let i = 0; i < n; i++) {
    if (complete[i]) completeDays++;
    else if (partial[i]) partialDays.push(addDays(w.start, i));
  }
  const missingDays = n - completeDays - partialDays.length;
  return {
    days: n,
    completeDays,
    partialDays,
    missingDays,
    state: completeDays === n ? "complete" : completeDays + partialDays.length === 0 ? "none" : "partial",
  };
}

const BR = (iso: string) => iso.split("-").reverse().join("/");

/** Frase objetiva sobre a cobertura de um período (`null` = completo). */
export function coverageNote(label: string, c: WindowCoverage): string | null {
  if (c.state === "complete") return null;
  if (c.state === "none") return `${label}: nenhum dia importado.`;
  const parts: string[] = [`${label}: ${c.completeDays} de ${c.days} dias importados por completo`];
  if (c.partialDays.length > 0) {
    parts.push(
      c.partialDays.length === 1
        ? `${BR(c.partialDays[0]!)} importado ainda em curso (dia parcial)`
        : `${c.partialDays.length} dias importados ainda em curso (parciais)`,
    );
  }
  if (c.missingDays > 0) parts.push(`${c.missingDays} sem importação`);
  return `${parts.join("; ")}.`;
}

/**
 * Os dois períodos são comparáveis só se os DOIS estão importados por completo — dia
 * parcial ou lacuna de importação mudam o total sem que a campanha tenha mudado.
 */
export function comparability(
  current: WindowCoverage,
  previous: WindowCoverage | null,
): { comparable: boolean; note: string | null } {
  if (!previous) return { comparable: false, note: null };
  if (current.state !== "complete" && previous.state !== "complete") {
    return { comparable: false, note: "Sem comparação: nenhum dos dois períodos foi importado por completo." };
  }
  if (current.state !== "complete") {
    return { comparable: false, note: "Sem comparação: o período atual não foi importado por completo." };
  }
  if (previous.state !== "complete") {
    return { comparable: false, note: "Sem comparação: o período anterior não foi importado por completo." };
  }
  return { comparable: true, note: null };
}
