/**
 * Formatação numérica/temporal em pt-BR. Usada pela tela Diagnóstico (A4).
 */
import type { MetricFormat } from "@/lib/insight";

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pctRate = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const pct0 = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 0,
});
const pct1Signed = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "always",
});
const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export function formatCount(n: number): string {
  return nf0.format(n);
}

/** value 0..1 -> "3,05%" */
export function formatRate(n: number): string {
  return pctRate.format(n);
}

export function formatCurrencyBRL(n: number): string {
  return brl.format(n);
}

const nf2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Dinheiro NA MOEDA DA FONTE. Sem código de moeda o número sai com o aviso — a regra do
 * projeto é nunca assumir BRL. (`formatCurrencyBRL` continua para o que é sabidamente BRL.)
 */
export function formatMoney(value: number, currency: string | null): string {
  if (!currency) return `${nf2.format(value)} (moeda não informada)`;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    // código de moeda que o Intl não conhece: o número e o código, sem inventar símbolo
    return `${nf2.format(value)} ${currency}`;
  }
}

export function formatMetricValue(value: number, format: MetricFormat): string {
  if (format === "rate") return formatRate(value);
  if (format === "currency") return formatCurrencyBRL(value);
  return formatCount(value);
}

/** share 0..1 -> "71%" */
export function formatShare(n: number): string {
  return pct0.format(n);
}

export interface DeltaParts {
  /** "−27,0%" (com sinal) */
  text: string;
  tone: "negative" | "positive" | "neutral";
}

/**
 * delta relativo (ex.: -0.27). `lowerIsWorse` define a cor: para uma métrica
 * onde cair é ruim (o padrão), -27% fica "negative".
 */
export function formatDelta(deltaPct: number, lowerIsWorse = true): DeltaParts {
  const text = pct1Signed.format(deltaPct).replace("-", "−");
  let tone: DeltaParts["tone"] = "neutral";
  if (Math.abs(deltaPct) >= 0.001) {
    const good = lowerIsWorse ? deltaPct > 0 : deltaPct < 0;
    tone = good ? "positive" : "negative";
  }
  return { text, tone };
}

/** {start:"2026-08-01", end:"2026-08-28"} -> "01 – 28 ago 2026" */
export function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const day = (d: Date) => String(d.getDate()).padStart(2, "0");
  const monthYear = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "numeric",
  }).format(e);
  return `${day(s)} – ${day(e)} ${monthYear}`;
}

/**
 * {start:"2026-09-23", end:"2026-10-20"} -> "23/09/2026 – 20/10/2026". Explícito em
 * qualquer intervalo (inclusive os que cruzam mês ou ano), sem depender do fuso local.
 */
export function formatDateSpan(start: string, end: string): string {
  const br = (iso: string) => iso.split("-").reverse().join("/");
  return start === end ? br(start) : `${br(start)} – ${br(end)}`;
}

/** ISO -> "há 2 horas" / "há 3 dias" / "em 28/08/2026" (fallback > 30 dias) */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = then.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (abs < hour) return rtf.format(Math.round(diffMs / min), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), "day");
  return `em ${new Intl.DateTimeFormat("pt-BR").format(then)}`;
}
