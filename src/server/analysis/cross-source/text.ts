/**
 * Formatação de texto (pt-BR) da camada Cross-source. Determinística: nenhuma
 * dependência de relógio, de locale do processo ou de estado — só `Intl` com
 * locale fixo.
 */
import { formatCount } from "@/lib/format";

import type { CrossSourcePeriod, CrossSourceSource } from "./types";

/** Nome de cada fonte como aparece nos textos. */
export const SOURCE_LABEL: Record<CrossSourceSource, string> = {
  ga4: "GA4",
  rd_marketing: "RD Marketing",
  rd_crm: "RD CRM",
};

const pct1Fmt = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Valores monetários SEM símbolo: o CRM não informa a moeda, e a regra do projeto é nunca assumir BRL (G3 §17). */
const amountFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Nota da evidência `ga4.sessions` quando o GA4 não tem NENHUMA linha no período:
 * isso é ausência de dado, e a evidência vai com `value: null` — nunca com 0.
 */
export const GA4_NO_ROWS_NOTE =
  "o GA4 não tem nenhuma linha no período (ausência de dado, não zero sessões)";

export const count = formatCount;

/** 0..1 → "26,3%" */
export const pct = (ratio: number): string => pct1Fmt.format(ratio);

export const amount = (value: number): string => amountFmt.format(value);

/** "2026-09-05" → "05/09/2026" */
export function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** {start,end} → "05/09/2026 a 02/10/2026" */
export const periodText = (p: CrossSourcePeriod): string =>
  `${brDate(p.start)} a ${brDate(p.end)}`;

export const plural = (n: number, one: string, many: string): string =>
  n === 1 ? one : many;

/** ["A","B","C"] → "A, B e C" */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/**
 * Tipo de ativo do RD → rótulo no plural. `Map` (não objeto literal) para que um
 * tipo chamado "constructor" nunca resolva para algo herdado de `Object.prototype`
 * — mesmo cuidado do `CHANNEL_TO_ADS_TYPES` no G6.
 */
const ASSET_TYPE_PLURAL: ReadonlyMap<string, string> = new Map([
  ["LandingPage", "landing pages"],
  ["Forms", "formulários"],
  ["Popup", "pop-ups"],
]);

/** "2 ativos de conversão (landing pages)" — tipos desconhecidos aparecem como vieram. */
export function describeAssets(assetCount: number, assetTypes: string[]): string {
  const base = `${count(assetCount)} ${plural(assetCount, "ativo de conversão", "ativos de conversão")}`;
  if (assetTypes.length === 0) return base;
  return `${base} (${joinPt(assetTypes.map((t) => ASSET_TYPE_PLURAL.get(t) ?? t))})`;
}
