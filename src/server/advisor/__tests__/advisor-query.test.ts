/**
 * AdvisorQuery — a fronteira de entrada: validação, normalização e a flag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { daysBetween, previousPeriod } from "@/lib/advisor-period";

import { ADVISOR_INTENTS, ADVISOR_SUGGESTIONS, INTENT_LABEL } from "../intents";
import { AdvisorQueryError, MAX_QUESTION_LENGTH, parseAdvisorQuery } from "../query";

const base = { workspaceId: "ws-1", period: { startDate: "2026-10-01", endDate: "2026-10-04" } };

describe("parseAdvisorQuery", () => {
  it("aceita cada intenção e devolve o pedido normalizado", () => {
    for (const intent of ADVISOR_INTENTS) {
      const input = {
        ...base,
        intent,
        ...(intent === "comparison" ? { comparePeriod: { startDate: "2026-09-27", endDate: "2026-09-30" } } : {}),
        ...(intent === "free_question" ? { question: "  Como foi?  " } : {}),
      };
      const q = parseAdvisorQuery(input);
      expect(q.intent).toBe(intent);
      expect(q.workspaceId).toBe("ws-1");
      expect(q.period).toEqual(base.period);
    }
  });

  it("só `comparison` mantém o período de comparação e só `free_question` mantém a pergunta (aparada)", () => {
    const extra = { comparePeriod: { startDate: "2026-09-27", endDate: "2026-09-30" }, question: "x" };
    expect(parseAdvisorQuery({ ...base, intent: "period_summary", ...extra })).toEqual({ ...base, intent: "period_summary" });
    expect(parseAdvisorQuery({ ...base, intent: "comparison", ...extra })).toEqual({
      ...base,
      comparePeriod: extra.comparePeriod,
      intent: "comparison",
    });
    expect(parseAdvisorQuery({ ...base, intent: "free_question", question: "  Como foi outubro?  " })).toEqual({
      ...base,
      intent: "free_question",
      question: "Como foi outubro?",
    });
  });

  it("recusa campo desconhecido (um `workspace` extra do cliente não é ignorado em silêncio)", () => {
    expect(() => parseAdvisorQuery({ ...base, intent: "period_summary", workspace: "outro" })).toThrow(AdvisorQueryError);
    expect(() => parseAdvisorQuery({ ...base, period: { ...base.period, extra: 1 }, intent: "period_summary" })).toThrow(AdvisorQueryError);
  });

  it("recusa tipos e valores inválidos, com `issues` para depurar", () => {
    const bad: unknown[] = [
      null,
      "texto",
      42,
      {},
      { ...base, intent: "nao_existe" },
      { ...base, intent: undefined },
      { workspaceId: "", period: base.period, intent: "period_summary" },
      { workspaceId: 7, period: base.period, intent: "period_summary" },
      { ...base, period: null, intent: "period_summary" },
      { ...base, period: { startDate: 20261001, endDate: "2026-10-04" }, intent: "period_summary" },
    ];
    for (const input of bad) {
      expect(() => parseAdvisorQuery(input), JSON.stringify(input)).toThrow(AdvisorQueryError);
    }
    try {
      parseAdvisorQuery({ ...base, intent: "nao_existe" });
    } catch (e) {
      expect((e as AdvisorQueryError).issues.join(" ")).toMatch(/intent/);
    }
  });

  it("valida o período: datas reais, ordem e tamanho máximo", () => {
    const withPeriod = (startDate: string, endDate: string) => ({ ...base, period: { startDate, endDate }, intent: "period_summary" });
    expect(() => parseAdvisorQuery(withPeriod("2026-10-05", "2026-10-01"))).toThrow(/posterior a endDate/);
    expect(() => parseAdvisorQuery(withPeriod("2026-02-30", "2026-03-01"))).toThrow(/datas reais/);
    expect(() => parseAdvisorQuery(withPeriod("01/10/2026", "04/10/2026"))).toThrow(/YYYY-MM-DD/);
    expect(() => parseAdvisorQuery(withPeriod("2025-01-01", "2026-12-31"))).toThrow(/excede o máximo/);
    expect(() => parseAdvisorQuery(withPeriod("2026-10-01", "2026-10-01"))).not.toThrow(); // 1 dia vale
  });

  it("comparação exige um período de comparação válido", () => {
    expect(() => parseAdvisorQuery({ ...base, intent: "comparison" })).toThrow(/período de comparação/);
    expect(() =>
      parseAdvisorQuery({ ...base, intent: "comparison", comparePeriod: { startDate: "2026-09-30", endDate: "2026-09-27" } }),
    ).toThrow(/Período de comparação: .*posterior/);
  });

  it("pergunta livre exige texto e respeita o tamanho máximo", () => {
    expect(() => parseAdvisorQuery({ ...base, intent: "free_question" })).toThrow(/Escreva a pergunta/);
    expect(() => parseAdvisorQuery({ ...base, intent: "free_question", question: "   " })).toThrow(/Escreva a pergunta/);
    expect(() => parseAdvisorQuery({ ...base, intent: "free_question", question: "a".repeat(MAX_QUESTION_LENGTH) })).not.toThrow();
    expect(() => parseAdvisorQuery({ ...base, intent: "free_question", question: "a".repeat(MAX_QUESTION_LENGTH + 1) })).toThrow(AdvisorQueryError);
  });
});

describe("intenções e sugestões da tela", () => {
  it("toda intenção tem rótulo, e toda sugestão é uma intenção real (sem a pergunta livre)", () => {
    for (const intent of ADVISOR_INTENTS) expect(INTENT_LABEL[intent].trim()).not.toBe("");
    for (const s of ADVISOR_SUGGESTIONS) {
      expect(ADVISOR_INTENTS).toContain(s.intent);
      expect(s.intent).not.toBe("free_question");
      expect(s.label.trim()).not.toBe("");
      expect(s.hint.trim()).not.toBe("");
    }
    expect(new Set(ADVISOR_SUGGESTIONS.map((s) => s.intent)).size).toBe(ADVISOR_SUGGESTIONS.length);
  });

  it("as sugestões pedidas pelo produto estão todas na tela", () => {
    expect(ADVISOR_SUGGESTIONS.map((s) => s.label)).toEqual([
      "Fechamento do período",
      "Resumo executivo",
      "Performance de aquisição",
      "Performance comercial",
      "Comparativo mensal",
      "Principais problemas",
      "Oportunidades",
      "O que aconteceu?",
    ]);
  });
});

describe("datas do seletor de período (lib/advisor-period)", () => {
  it("dias inclusivos; inválido ou fora de ordem → null", () => {
    expect(daysBetween("2026-10-01", "2026-10-04")).toBe(4);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(1);
    expect(daysBetween("2026-02-01", "2026-03-01")).toBe(29);
    expect(daysBetween("2026-10-04", "2026-10-01")).toBeNull();
    expect(daysBetween("", "2026-10-01")).toBeNull();
    expect(daysBetween("01/10/2026", "04/10/2026")).toBeNull();
  });

  it("o período anterior tem a mesma duração e termina na véspera", () => {
    expect(previousPeriod("2026-10-01", "2026-10-04")).toEqual({ start: "2026-09-27", end: "2026-09-30" });
    expect(previousPeriod("2026-10-01", "2026-10-01")).toEqual({ start: "2026-09-30", end: "2026-09-30" });
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({ start: "2026-01-29", end: "2026-02-28" });
    expect(previousPeriod("2026-10-04", "2026-10-01")).toBeNull();
    expect(previousPeriod("", "")).toBeNull();
    // e a duração casa com a de `daysBetween`
    const p = previousPeriod("2026-10-01", "2026-10-04")!;
    expect(daysBetween(p.start, p.end)).toBe(4);
  });
});

describe("flag ADVISOR_ENABLED (INV-8: o produto funciona sem o Advisor)", () => {
  const original = process.env.ADVISOR_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.ADVISOR_ENABLED;
    else process.env.ADVISOR_ENABLED = original;
    vi.resetModules();
  });

  const load = async (value?: string) => {
    vi.resetModules();
    if (value === undefined) delete process.env.ADVISOR_ENABLED;
    else process.env.ADVISOR_ENABLED = value;
    return (await import("../flag")).isAdvisorEnabled();
  };

  it("padrão: ligado (o Advisor desta fase é determinístico e só lê)", async () => {
    expect(await load(undefined)).toBe(true);
    expect(await load("true")).toBe(true);
  });

  it("`false` desliga", async () => {
    expect(await load("false")).toBe(false);
  });

  it("valor inválido falha ao validar o ambiente, em vez de ligar/desligar por acidente", async () => {
    await expect(load("talvez")).rejects.toThrow(/ADVISOR_ENABLED/);
  });
});
