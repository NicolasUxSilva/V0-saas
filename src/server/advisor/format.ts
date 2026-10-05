/**
 * Formatação pt-BR dos valores de evidência. Determinística: só `Intl` com locale
 * fixo, sem relógio nem estado.
 *
 * Os formatadores de contagem, taxa, valor e data são OS MESMOS que escrevem as
 * frases do Cross-source (`cross-source/text.ts`) — assim uma figura ("487") e a
 * frase que a cita ("487 sessões") nunca divergem de formato. É só apresentação:
 * nenhum número novo nasce aqui (INV-6).
 */
import {
  amount,
  brDate,
  count,
  joinPt,
  pct,
  periodText,
  plural,
} from "@/server/analysis/cross-source/text";
import type { MetricFormat } from "@/server/analysis/types";

export { amount, brDate, count, joinPt, pct, periodText, plural };

interface Formattable {
  value: number | null;
  format: MetricFormat;
  currency?: string | null;
}

/**
 * Valor de evidência → texto. `null` (ausência de dado) continua `null`: nunca vira
 * "0". Moeda: só com código ISO informado pela fonte vira símbolo; sem código o
 * número sai sem símbolo — a regra do projeto é nunca assumir BRL.
 */
export function displayValue(e: Formattable): string | null {
  if (e.value === null) return null;
  if (e.format === "rate") return pct(e.value);
  if (e.format === "currency") {
    if (!e.currency) return amount(e.value);
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: e.currency }).format(
        e.value,
      );
    } catch {
      // código de moeda que o Intl não conhece: mostra o número e o código, sem inventar símbolo
      return `${amount(e.value)} ${e.currency}`;
    }
  }
  return count(e.value);
}

const signedCount = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});
const signedAmount = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const signedPct = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

const minus = (s: string) => s.replace("-", "−");

/** Diferença com sinal ("+12", "−3,00"). */
export function displayDelta(delta: number, format: MetricFormat): string {
  if (format === "currency") return minus(signedAmount.format(delta));
  return minus(signedCount.format(delta));
}

/** Variação relativa com sinal ("+18,8%", "−3,0%"). */
export function displayDeltaPct(ratio: number): string {
  return minus(signedPct.format(ratio));
}
