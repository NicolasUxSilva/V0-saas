/**
 * Asserções compartilhadas dos testes do Cross-source: as mesmas invariantes
 * estruturais e a mesma checagem de causalidade que valem para a V1, para que os
 * testes da V1.1 (período explícito, persistência) as apliquem aos seus cenários.
 */
import { expect } from "vitest";

import type {
  CrossSourceInsight,
  CrossSourceInsightType,
} from "@/server/analysis/cross-source";

export function find(out: CrossSourceInsight[], type: CrossSourceInsightType) {
  return out.find((i) => i.type === type);
}

export function get(out: CrossSourceInsight[], type: CrossSourceInsightType): CrossSourceInsight {
  const insight = find(out, type);
  if (!insight) {
    throw new Error(
      `insight ausente: ${type} (presentes: ${out.map((i) => i.type).join(", ")})`,
    );
  }
  return insight;
}

export const evidence = (i: CrossSourceInsight, id: string) => i.evidence.find((e) => e.id === id);
export const codes = (i: CrossSourceInsight) =>
  i.statements.filter((s) => s.layer === "limitation").map((s) => s.code);
export const textOf = (i: CrossSourceInsight, layer?: string) =>
  i.statements.filter((s) => !layer || s.layer === layer).map((s) => s.text);

export function assertAllFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `número não finito em ${path}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
  }
}

/** Identidade, período, evidência e afirmações rastreáveis — em todo insight. */
export function expectStructurallyValid(out: CrossSourceInsight[]): void {
  expect(out.length).toBeGreaterThan(0);
  const keys = out.map((i) => i.dedupeKey);
  expect(new Set(keys).size).toBe(keys.length);

  for (const i of out) {
    expect(i.dedupeKey).toBe(`cross-source:${i.type}`);
    expect(i.title.trim().length).toBeGreaterThan(0);
    expect(i.periodStart <= i.periodEnd).toBe(true);

    // TODO insight tem evidência estruturada
    expect(i.evidence.length, i.type).toBeGreaterThan(0);
    const ids = i.evidence.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of i.evidence) {
      expect(e.id).toBe(`${e.source}.${e.metric}`);
      expect(e.label.trim().length).toBeGreaterThan(0);
      expect(e.period.start <= e.period.end, e.id).toBe(true);
      expect(e.value === null || Number.isFinite(e.value)).toBe(true);
      if (e.value === null) expect(e.note, `${e.id}: null sem explicação`).toBeTruthy();
      if (e.format === "currency") expect(e.currency).toBeNull();
    }
    expect(i.sources).toEqual(
      (["ga4", "rd_marketing", "rd_crm"] as const).filter((s) =>
        i.evidence.some((e) => e.source === s),
      ),
    );

    expect(i.statements.length).toBeGreaterThan(0);
    for (const s of i.statements) {
      expect(s.text.trim().length).toBeGreaterThan(0);
      for (const ref of s.evidenceIds) expect(ids).toContain(ref);
      if (s.layer === "fact" || s.layer === "observable_relationship") {
        expect(s.evidenceIds.length, s.text).toBeGreaterThan(0);
      }
      if (s.layer === "observable_relationship") {
        const sources = new Set(
          s.evidenceIds.map((ref) => i.evidence.find((e) => e.id === ref)?.source),
        );
        expect(sources.size, s.text).toBeGreaterThanOrEqual(2);
      }
      if (s.layer === "limitation") expect(s.code, s.text).toBeTruthy();
      else expect(s.code).toBeUndefined();
    }
    assertAllFinite(i);
  }
}

/** Causa, origem e atribuição só aparecem NEGADAS, e só em limitações. */
const CAUSAL =
  /\b(gerou|geraram|causou|causaram|causa|provocou|provocaram|originou|originaram|resultou|resultaram|veio|vieram|decorre|decorrem|explica|explicam|responsável|responsáveis|atribui|atribuir|atribuição)\b/i;

export function expectNoUnnegatedCausality(out: CrossSourceInsight[]): void {
  for (const i of out) {
    for (const s of i.statements) {
      if (!CAUSAL.test(s.text)) continue;
      expect(s.layer, `${i.type}: "${s.text}"`).toBe("limitation");
      expect(s.text, `${i.type}: "${s.text}"`).toMatch(/\bnão\b/i);
    }
    for (const s of i.statements.filter((x) => x.layer === "hypothesis")) {
      expect(s.text).toMatch(/^(Pode|Podem|Talvez|É possível|Vale)\b/);
      expect(s.text).not.toMatch(/\d/);
    }
  }
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}
