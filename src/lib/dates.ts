/** Datas em "YYYY-MM-DD" (bloco B3 — janela de sincronização). */

/** Data de hoje no fuso IANA informado. Cai para UTC se o fuso for inválido. */
export function todayInTimeZone(tz: string): string {
  try {
    // "en-CA" formata como YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Soma (ou subtrai) dias a uma data "YYYY-MM-DD". */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Retorna a maior (mais recente) de duas datas "YYYY-MM-DD". */
export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
