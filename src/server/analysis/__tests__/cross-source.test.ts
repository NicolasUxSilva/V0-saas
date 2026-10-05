/**
 * Testes da camada Cross-source V1.
 *
 * `buildCrossSourceInsights` é pura: os contextos vêm de `makeContext` + os
 * compositores REAIS de RD (via `cross-source-fixtures.ts`), nunca de um mock, e
 * nenhum teste toca banco ou rede. A armadilha de banco logo abaixo faz qualquer
 * acesso a `db` falhar alto.
 *
 * Organização:
 *  1. invariantes estruturais — valem para TODO cenário
 *  2. os 16 cenários do escopo (aquisição, comercial, atribuição, períodos, vazio…)
 *  3. camadas fato / relação / hipótese / limitação e ausência de causalidade
 *  4. determinismo, pureza e fronteira de arquitetura
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MIN_ATTRIBUTION_COVERAGE,
  buildCrossSourceInsights,
  type CrossSourceInsight,
  type CrossSourceInsightType,
} from "@/server/analysis/cross-source";
import type { AnalysisContext } from "@/server/analysis/types";

import {
  WINDOW,
  deal,
  deals,
  lost,
  makeRdCrm,
  makeRdMarketing,
  pilotLikeContext,
  scenario,
  won,
} from "./cross-source-fixtures";

// Armadilha: `context.ts` importa `db` (e as fixtures importam `context.ts`), mas só
// o USA dentro de funções. Se a camada Cross-source tocasse o banco, o Proxy lança.
vi.mock("@/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`Cross-source acessou o banco (db.${String(prop)})`);
      },
    },
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── helpers ─────────────────────────────────────────────────────────────────

const rdWith = (visits: number, conversions: number) =>
  makeRdMarketing([{ assetId: "a1", assetIdentifier: "lp-exemplo", visits, conversions }]);

function find(out: CrossSourceInsight[], type: CrossSourceInsightType) {
  return out.find((i) => i.type === type);
}

function get(out: CrossSourceInsight[], type: CrossSourceInsightType): CrossSourceInsight {
  const insight = find(out, type);
  if (!insight) {
    throw new Error(
      `insight ausente: ${type} (presentes: ${out.map((i) => i.type).join(", ")})`,
    );
  }
  return insight;
}

const evidence = (i: CrossSourceInsight, id: string) => i.evidence.find((e) => e.id === id);
const codes = (i: CrossSourceInsight) =>
  i.statements.filter((s) => s.layer === "limitation").map((s) => s.code);
const textOf = (i: CrossSourceInsight, layer?: string) =>
  i.statements.filter((s) => !layer || s.layer === layer).map((s) => s.text);
const allText = (i: CrossSourceInsight) => i.statements.map((s) => s.text).join("\n");

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

function assertAllFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `número não finito em ${path}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
  }
}

// ── cenários nomeados ───────────────────────────────────────────────────────

const OTHER_WINDOW = { start: "2026-07-01", end: "2026-07-28" };

const SCENARIOS: Record<string, () => AnalysisContext> = {
  piloto: pilotLikeContext,
  "só GA4": () => scenario(),
  "GA4 + RD com conversões + CRM": () =>
    scenario({
      rdMarketing: rdWith(120, 7),
      rdCrm: makeRdCrm([...deals(3), won({ totalPrice: 500 }), lost()]),
    }),
  "RD Marketing sem GA4": () => scenario({ sessions: 0, rdMarketing: rdWith(40, 0) }),
  "CRM sem GA4 nem RD": () =>
    scenario({ sessions: 0, rdCrm: makeRdCrm([...deals(2), won(), lost()]) }),
  "CRM só com abertos": () => scenario({ rdCrm: makeRdCrm(deals(4)) }),
  "CRM só com perdidos": () =>
    scenario({ rdCrm: makeRdCrm([lost({ totalPrice: 100 }), lost()]) }),
  "períodos diferentes": () =>
    scenario({
      rdMarketing: makeRdMarketing([{ assetId: "a1", visits: 10, conversions: 0 }], {
        window: OTHER_WINDOW,
      }),
      rdCrm: makeRdCrm(deals(3, { dealCreatedAt: "2026-07-10" }), OTHER_WINDOW),
    }),
  "GA4 atrasado": () =>
    scenario({
      ga4LastDate: "2026-08-21",
      expectedLastDate: "2026-08-28",
      // o GA4 que termina em 21/08 tem dado em 21 dos 28 dias do período
      currentDaysWithData: 21,
      rdMarketing: rdWith(10, 0),
    }),
  "períodos parciais": () =>
    scenario({
      currentDaysWithData: 20,
      rdMarketing: makeRdMarketing([{ assetId: "a1", visits: 10, conversions: 0 }], { days: 20 }),
    }),
  "tudo zerado": () =>
    scenario({
      rdMarketing: rdWith(0, 0),
      rdCrm: makeRdCrm([lost({ dealCreatedAt: "2026-07-01" })]),
    }),
  vazio: () => scenario({ sessions: 0 }),
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. Invariantes estruturais — todo cenário, todo insight
// ═════════════════════════════════════════════════════════════════════════════

describe("invariantes estruturais (valem para todos os cenários)", () => {
  for (const [name, build] of Object.entries(SCENARIOS)) {
    it(`${name}: todo insight tem identidade, período, evidência e afirmações rastreáveis`, () => {
      const out = buildCrossSourceInsights(build());
      expect(out.length).toBeGreaterThan(0);

      const keys = out.map((i) => i.dedupeKey);
      expect(new Set(keys).size).toBe(keys.length);

      for (const i of out) {
        expect(i.dedupeKey).toBe(`cross-source:${i.type}`);
        expect(i.title.trim().length).toBeGreaterThan(0);
        expect(i.periodStart <= i.periodEnd).toBe(true);

        // item 14 do escopo: TODO insight tem evidência estruturada
        expect(i.evidence.length).toBeGreaterThan(0);
        const ids = i.evidence.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const e of i.evidence) {
          expect(e.id).toBe(`${e.source}.${e.metric}`);
          expect(e.label.trim().length).toBeGreaterThan(0);
          expect(e.period.start <= e.period.end).toBe(true);
          expect(e.value === null || Number.isFinite(e.value)).toBe(true);
          if (e.value === null) expect(e.note, `${e.id}: null sem explicação`).toBeTruthy();
          // o CRM não informa moeda: nunca se assume uma
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
          // toda referência aponta para um ponto de evidência do MESMO insight
          for (const ref of s.evidenceIds) expect(ids).toContain(ref);
          // fato e relação observável sempre têm número que os sustente
          if (s.layer === "fact" || s.layer === "observable_relationship") {
            expect(s.evidenceIds.length, s.text).toBeGreaterThan(0);
          }
          // relação observável envolve ≥ 2 fontes — senão seria só um fato
          if (s.layer === "observable_relationship") {
            const sources = new Set(
              s.evidenceIds.map((ref) => i.evidence.find((e) => e.id === ref)?.source),
            );
            expect(sources.size, s.text).toBeGreaterThanOrEqual(2);
          }
          // limitação sempre tem código estável; as outras camadas nunca
          if (s.layer === "limitation") expect(s.code, s.text).toBeTruthy();
          else expect(s.code).toBeUndefined();
        }

        assertAllFinite(i);
      }
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Os 16 cenários do escopo
// ═════════════════════════════════════════════════════════════════════════════

describe("cenário 1 — GA4 + RD Marketing no mesmo período (aquisição lado a lado)", () => {
  const out = buildCrossSourceInsights(scenario({ rdMarketing: rdWith(120, 7) }));
  const t = get(out, "traffic-and-rd-conversions");

  it("mostra GA4 e RD Marketing lado a lado, cada ponto com a fonte e o período próprios", () => {
    expect(t.category).toBe("acquisition");
    expect(t.sources).toEqual(["ga4", "rd_marketing"]);
    expect(evidence(t, "ga4.sessions")).toMatchObject({ value: 5377, period: WINDOW });
    expect(evidence(t, "rd_marketing.visits")).toMatchObject({ value: 120, period: WINDOW });
    expect(evidence(t, "rd_marketing.conversions")).toMatchObject({ value: 7, period: WINDOW });
  });

  it("a relação observável cita os dois sinais e diz que é o mesmo período", () => {
    const relation = textOf(t, "observable_relationship")[0]!;
    expect(relation).toContain("5.377 sessões");
    expect(relation).toContain("120 visitas");
    expect(relation).toContain("7 conversões");
    expect(relation).toContain("No mesmo período");
    expect(relation).toContain("fontes diferentes");
  });

  it("NÃO vira taxa de conversão conjunta: nenhuma evidência é taxa, nenhum texto tem %, e a limitação é explícita", () => {
    expect(t.evidence.every((e) => e.format !== "rate")).toBe(true);
    expect(allText(t)).not.toContain("%");
    expect(codes(t)).toContain("no_joint_rate");
  });

  it("a cobertura de aquisição registra os dois lados e afirma o mesmo período", () => {
    const cov = get(out, "acquisition-coverage");
    expect(textOf(cov, "observable_relationship")[0]).toContain("mesmo período");
    expect(codes(cov)).toContain("rd_marketing_scope");
    // com conversões > 0 o RD NÃO é descrito como "limitado"
    expect(codes(cov)).not.toContain("rd_marketing_no_conversions");
  });
});

describe("cenário 2 — GA4 disponível e RD Marketing sem dados", () => {
  const out = buildCrossSourceInsights(scenario());

  it("não emite o lado a lado nem a coexistência: não há o que comparar", () => {
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
    expect(find(out, "commercial-vs-acquisition")).toBeUndefined();
  });

  it("a cobertura de aquisição mostra o tráfego do GA4 e diz que falta o RD Marketing", () => {
    const cov = get(out, "acquisition-coverage");
    expect(textOf(cov, "fact").join(" ")).toContain("5.377 sessões");
    expect(codes(cov)).toContain("rd_marketing_unavailable");
    expect(codes(cov)).not.toContain("ga4_unavailable");
    expect(evidence(cov, "rd_marketing.days_with_data")?.value).toBe(0);
  });

  it("a integridade lista só as fontes realmente sem dados", () => {
    const un = get(out, "source-unavailable");
    expect(codes(un)).toEqual(["rd_marketing_unavailable", "rd_crm_unavailable"]);
    expect(textOf(un, "fact")[0]).toBe("Fontes com dados no período: GA4.");
  });
});

describe("cenário 3 — RD Marketing disponível e GA4 sem dados", () => {
  const out = buildCrossSourceInsights(scenario({ sessions: 0, rdMarketing: rdWith(40, 0) }));

  it("não emite o lado a lado (sem tráfego não há base)", () => {
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
  });

  it("a cobertura de aquisição e a integridade apontam o GA4 como a fonte ausente", () => {
    const cov = get(out, "acquisition-coverage");
    expect(textOf(cov, "fact").join(" ")).toContain("Não há dados do GA4 no período analisado");
    expect(textOf(cov, "fact").join(" ")).toContain("ausência de dado, não zero sessões");
    expect(textOf(cov, "fact").join(" ")).toContain("40 visitas");
    expect(codes(cov)).toContain("ga4_unavailable");
    expect(codes(get(out, "source-unavailable"))).toContain("ga4_unavailable");
    expect(textOf(get(out, "source-unavailable"), "fact")[0]).toBe(
      "Fontes com dados no período: RD Marketing.",
    );
  });
});

describe("cenário 3b — GA4 com linhas zeradas NÃO é GA4 sem dados", () => {
  // linha existente com sessions = 0 é um zero registrado (dado válido); só a falta de linha é ausência
  const out = buildCrossSourceInsights(
    scenario({ sessions: 0, ga4ZeroRows: true, rdMarketing: rdWith(40, 0) }),
  );

  it("o GA4 está disponível com 0 sessões: há o lado a lado e ele não aparece como fonte indisponível", () => {
    const t = get(out, "traffic-and-rd-conversions");
    expect(evidence(t, "ga4.sessions")?.value).toBe(0);
    expect(textOf(t, "observable_relationship")[0]).toContain("o GA4 registrou 0 sessões");
    expect(codes(get(out, "source-unavailable"))).toEqual(["rd_crm_unavailable"]);
    expect(textOf(get(out, "source-unavailable"), "fact")[0]).toBe(
      "Fontes com dados no período: GA4 e RD Marketing.",
    );
  });

  it("nenhum atraso nem período parcial por causa do valor zero", () => {
    expect(find(out, "partial-period")).toBeUndefined();
    expect(find(out, "period-mismatch")).toBeUndefined();
  });

  it("o mesmo contexto SEM as linhas (sessions 0 e sem cobertura) é outra coisa: GA4 indisponível", () => {
    const absent = buildCrossSourceInsights(scenario({ sessions: 0, rdMarketing: rdWith(40, 0) }));
    expect(codes(get(absent, "source-unavailable"))).toContain("ga4_unavailable");
    expect(find(absent, "traffic-and-rd-conversions")).toBeUndefined();
  });
});

describe("cenário 4 — CRM com ganhos e perdas", () => {
  const rdCrm = makeRdCrm([
    ...deals(3),
    won({ totalPrice: 1000 }),
    won({ totalPrice: 3000 }),
    lost(),
    lost(),
    lost(),
  ]);
  const a = get(buildCrossSourceInsights(scenario({ rdCrm })), "commercial-activity");

  it("traz criados, ganhos, perdidos e abertos como fatos com evidência", () => {
    expect(evidence(a, "rd_crm.created_deals")?.value).toBe(3);
    expect(evidence(a, "rd_crm.won_deals")?.value).toBe(2);
    expect(evidence(a, "rd_crm.lost_deals")?.value).toBe(3);
    expect(evidence(a, "rd_crm.created_still_open_deals")?.value).toBe(3);
    expect(textOf(a, "fact")[0]).toContain("3 negócios criados, 2 ganhos e 3 perdidos");
  });

  it("valor ganho e ticket médio saem dos ganhos COM valor", () => {
    expect(evidence(a, "rd_crm.won_value")).toMatchObject({ value: 4000, format: "currency", currency: null });
    expect(evidence(a, "rd_crm.won_deals_with_value")?.value).toBe(2);
    expect(evidence(a, "rd_crm.average_ticket")?.value).toBe(2000);
  });

  it("valor perdido não aparece quando nenhum perdido tem valor", () => {
    expect(evidence(a, "rd_crm.lost_value")).toBeUndefined();
  });
});

describe("cenário 5 — CRM apenas com negócios abertos", () => {
  const out = buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm(deals(4)) }));
  const a = get(out, "commercial-activity");

  it("conta os criados e os que seguem abertos, sem inventar ganho/perda", () => {
    expect(evidence(a, "rd_crm.created_deals")?.value).toBe(4);
    expect(evidence(a, "rd_crm.won_deals")?.value).toBe(0);
    expect(evidence(a, "rd_crm.lost_deals")?.value).toBe(0);
    expect(evidence(a, "rd_crm.created_still_open_deals")?.value).toBe(4);
    expect(textOf(a, "fact").join(" ")).toContain("4 dos 4 negócios criados no período seguem em aberto");
  });

  it("não calcula taxa de ganho nem ticket — e a integridade diz isso explicitamente", () => {
    expect(evidence(a, "rd_crm.win_rate")).toBeUndefined();
    expect(evidence(a, "rd_crm.average_ticket")).toBeUndefined();
    expect(codes(a)).not.toContain("win_rate_scope");

    const nc = get(out, "metric-not-computable");
    expect(codes(nc)).toEqual([
      "metric_not_computable:win_rate",
      "metric_not_computable:average_ticket",
    ]);
    expect(evidence(nc, "rd_crm.win_rate")).toMatchObject({
      value: null,
      note: "nenhum negócio ganho ou perdido no período",
    });
  });
});

describe("cenário 6 — CRM com source_id ausente", () => {
  const out = buildCrossSourceInsights(
    scenario({ rdCrm: makeRdCrm(deals(10, { sourceId: "", campaignId: "camp-1" })) }),
  );
  const q = get(out, "attribution-quality");

  it("mede a cobertura e gera a limitação de origem — a de campanha não, porque está preenchida", () => {
    expect(evidence(q, "rd_crm.created_with_source_id")?.value).toBe(0);
    expect(evidence(q, "rd_crm.created_source_id_coverage")?.value).toBe(0);
    expect(evidence(q, "rd_crm.created_campaign_id_coverage")?.value).toBe(1);
    expect(codes(q)).toContain("source_id_insufficient");
    expect(codes(q)).not.toContain("campaign_id_insufficient");
  });

  it("mesmo com campanha preenchida, atribuir às fontes de aquisição continua não suportado", () => {
    expect(codes(q)).toContain("no_origin_mapping");
    expect(codes(q)).toContain("attribution_not_supported");
  });
});

describe("cenário 7 — CRM com campaign_id ausente", () => {
  const out = buildCrossSourceInsights(
    scenario({ rdCrm: makeRdCrm(deals(10, { sourceId: "src-1", campaignId: "" })) }),
  );
  const q = get(out, "attribution-quality");

  it("gera a limitação de campanha — a de origem não, porque está preenchida", () => {
    expect(evidence(q, "rd_crm.created_campaign_id_coverage")?.value).toBe(0);
    expect(evidence(q, "rd_crm.created_source_id_coverage")?.value).toBe(1);
    expect(codes(q)).toContain("campaign_id_insufficient");
    expect(codes(q)).not.toContain("source_id_insufficient");
  });

  it("a frase de limitação diz o que NÃO se pode atribuir, sem culpar a técnica", () => {
    const limitation = q.statements.find((s) => s.code === "campaign_id_insufficient")!;
    expect(limitation.text).toContain("não possuem cobertura suficiente de campanha");
    expect(limitation.text).toContain("0,0% dos negócios criados");
    expect(textOf(q, "limitation").join(" ")).toContain("não um erro técnico");
  });
});

describe("cenário 8 — períodos diferentes entre as fontes", () => {
  const ctx = scenario({
    rdMarketing: makeRdMarketing([{ assetId: "a1", visits: 10, conversions: 0 }], {
      window: OTHER_WINDOW,
    }),
    rdCrm: makeRdCrm(deals(3, { dealCreatedAt: "2026-07-10" }), OTHER_WINDOW),
  });
  const out = buildCrossSourceInsights(ctx);

  it("diz explicitamente que os períodos não são equivalentes e mostra a janela de cada fonte", () => {
    const pm = get(out, "period-mismatch");
    expect(textOf(pm, "limitation")[0]).toContain("não são equivalentes entre as fontes");
    expect(evidence(pm, "ga4.window_days")?.period).toEqual(WINDOW);
    expect(evidence(pm, "rd_marketing.window_days")?.period).toEqual(OTHER_WINDOW);
    expect(evidence(pm, "rd_crm.window_days")?.period).toEqual(OTHER_WINDOW);
  });

  it("não compara períodos diferentes como se fossem iguais: nada de lado a lado nem de coexistência", () => {
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
    expect(find(out, "commercial-vs-acquisition")).toBeUndefined();
    for (const i of out) {
      expect(textOf(i, "observable_relationship"), i.type).toEqual([]);
    }
    expect(codes(get(out, "acquisition-coverage"))).toContain("period_not_aligned");
  });

  it("a atividade comercial continua existindo, mas no período PRÓPRIO do CRM", () => {
    const a = get(out, "commercial-activity");
    expect(a.periodStart).toBe(OTHER_WINDOW.start);
    expect(a.periodEnd).toBe(OTHER_WINDOW.end);
    expect(evidence(a, "rd_crm.created_deals")?.period).toEqual(OTHER_WINDOW);
  });

  it("basta UMA fonte desalinhada para suspender a coexistência das demais", () => {
    const onlyCrmShifted = buildCrossSourceInsights(
      scenario({
        rdMarketing: rdWith(10, 0),
        rdCrm: makeRdCrm(deals(3, { dealCreatedAt: "2026-07-10" }), OTHER_WINDOW),
      }),
    );
    expect(find(onlyCrmShifted, "commercial-vs-acquisition")).toBeUndefined();
    expect(find(onlyCrmShifted, "period-mismatch")).toBeDefined();
    // GA4 × RD Marketing seguem no mesmo período e continuam comparáveis
    expect(find(onlyCrmShifted, "traffic-and-rd-conversions")).toBeDefined();
  });
});

describe("cenário 9 — dados vazios", () => {
  const out = buildCrossSourceInsights(scenario({ sessions: 0 }));

  it("não lança, produz insights determinísticos e nenhum número inválido", () => {
    expect(out.map((i) => i.type)).toEqual([
      "data-coverage",
      "acquisition-coverage",
      "source-unavailable",
    ]);
    assertAllFinite(out);
  });

  it("diz que nenhuma fonte tem dados — sem inventar sinal", () => {
    expect(codes(get(out, "acquisition-coverage"))).toEqual(["no_acquisition_data"]);
    expect(codes(get(out, "source-unavailable"))).toEqual([
      "ga4_unavailable",
      "rd_marketing_unavailable",
      "rd_crm_unavailable",
    ]);
    // GA4 sem NENHUMA linha: a evidência é `null` com nota — ausência de dado nunca vira "0 sessões"
    expect(evidence(get(out, "acquisition-coverage"), "ga4.sessions")).toMatchObject({
      value: null,
      note: "o GA4 não tem nenhuma linha no período (ausência de dado, não zero sessões)",
    });
    expect(evidence(get(out, "source-unavailable"), "ga4.sessions")?.value).toBeNull();
  });
});

describe("cenário 10 — nenhuma inferência causal indevida", () => {
  /** Verbos/substantivos de causa, origem e atribuição. */
  const CAUSAL =
    /\b(gerou|geraram|causou|causaram|causa|provocou|provocaram|originou|originaram|resultou|resultaram|veio|vieram|decorre|decorrem|explica|explicam|responsável|responsáveis|atribui|atribuir|atribuição)\b/i;

  for (const [name, build] of Object.entries(SCENARIOS)) {
    it(`${name}: causa/atribuição só aparecem NEGADAS, e só em limitações`, () => {
      for (const i of buildCrossSourceInsights(build())) {
        for (const s of i.statements) {
          if (!CAUSAL.test(s.text)) continue;
          expect(s.layer, `${i.type}: "${s.text}"`).toBe("limitation");
          expect(s.text, `${i.type}: "${s.text}"`).toMatch(/\bnão\b/i);
        }
      }
    });
  }

  it("nunca afirma que os negócios vieram de uma fonte, nem chama a taxa de ganho de conversão de leads", () => {
    const FORBIDDEN = [
      /negócios? vieram? d/i,
      /(google|marketing|rd station|ga4)\s+(gerou|geraram)/i,
      /geraram?\s+\d/i,
    ];
    for (const build of Object.values(SCENARIOS)) {
      for (const i of buildCrossSourceInsights(build())) {
        for (const s of i.statements) {
          for (const re of FORBIDDEN) expect(s.text).not.toMatch(re);
          if (/conversão de leads/i.test(s.text)) {
            expect(s.layer).toBe("limitation");
            expect(s.text).toMatch(/\bnão\b/i);
          }
        }
      }
    }
  });

  it("toda hipótese é condicional, não carrega número e vem separada dos fatos", () => {
    let seen = 0;
    for (const build of Object.values(SCENARIOS)) {
      for (const i of buildCrossSourceInsights(build())) {
        for (const s of i.statements.filter((x) => x.layer === "hypothesis")) {
          seen += 1;
          expect(s.text).toMatch(/^(Pode|Podem|Talvez|É possível|Vale)\b/);
          expect(s.text).not.toMatch(/\d/);
        }
      }
    }
    expect(seen).toBeGreaterThan(0); // sanity: os cenários realmente geram hipóteses
  });

  it("a coexistência temporal é descrita como coexistência e acompanha a limitação de causa", () => {
    const out = buildCrossSourceInsights(pilotLikeContext());
    const rel = get(out, "commercial-vs-acquisition");
    expect(textOf(rel, "observable_relationship")[0]).toContain(
      "houve atividade comercial no CRM enquanto os dados de conversão do RD Marketing permaneceram sem conversões registradas",
    );
    expect(codes(rel)).toContain("coexistence_only");
    expect(textOf(rel, "hypothesis")).toEqual([
      "Pode existir uma oportunidade de investigar a origem desses negócios.",
    ]);
    // a hipótese NÃO aparece misturada em fato nem em relação observável
    for (const text of [...textOf(rel, "fact"), ...textOf(rel, "observable_relationship")]) {
      expect(text).not.toMatch(/oportunidade|investigar/i);
    }
  });
});

describe("cenário 11 — taxa de ganho = ganhos ÷ (ganhos + perdidos)", () => {
  const winRate = (rows: ReturnType<typeof won>[]) =>
    evidence(
      get(buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm(rows) })), "commercial-activity"),
      "rd_crm.win_rate",
    )?.value;

  it("5 ganhos e 14 perdidos → 5/19", () => {
    const rows = [...Array.from({ length: 5 }, () => won()), ...Array.from({ length: 14 }, () => lost())];
    expect(winRate(rows)).toBe(0.2632); // 5/19, arredondado a 4 casas
    const a = get(buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm(rows) })), "commercial-activity");
    expect(textOf(a, "fact").join(" ")).toContain("26,3% (5 ganhos de 19 negócios fechados");
  });

  it("negócios em aberto ficam FORA do denominador", () => {
    const rows = [won(), lost(), ...deals(100)]; // 100 abertos não mudam 1/2
    expect(winRate(rows)).toBe(0.5);
  });

  it("zero ganhos com perdas é 0% (válido) — não 'não calculável'", () => {
    expect(winRate([lost(), lost(), lost()])).toBe(0);
  });

  it("só ganhos é 100%", () => {
    expect(winRate([won(), won()])).toBe(1);
  });

  it("a definição está no texto e não se chama de conversão de leads", () => {
    const a = get(
      buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm([won(), lost()]) })),
      "commercial-activity",
    );
    const factText = textOf(a, "fact").join(" ");
    expect(factText).toContain("ganhos ÷ (ganhos + perdidos)");
    expect(factText).toContain("negócios em aberto fora do cálculo");
    expect(factText).not.toMatch(/conversão de leads/i);
    expect(codes(a)).toContain("win_rate_scope");
  });
});

describe("cenário 12 — ticket médio só com valores válidos", () => {
  const activity = (rows: ReturnType<typeof won>[]) =>
    buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm(rows) }));

  it("é a média dos ganhos COM valor — ganhos sem valor não puxam a média para baixo", () => {
    const a = get(activity([won({ totalPrice: 1000 }), won(), won()]), "commercial-activity");
    expect(evidence(a, "rd_crm.average_ticket")?.value).toBe(1000); // não 333,33
    expect(evidence(a, "rd_crm.won_deals_with_value")?.value).toBe(1);
    expect(textOf(a, "fact").join(" ")).toContain("Ticket médio dos ganhos com valor registrado: 1.000,00 (base: 1 negócio)");
    expect(codes(a)).toContain("won_value_partial");
  });

  it("calcula sobre dois valores positivos", () => {
    const a = get(
      activity([won({ totalPrice: 1000 }), won({ totalPrice: 2000 }), won()]),
      "commercial-activity",
    );
    expect(evidence(a, "rd_crm.average_ticket")?.value).toBe(1500);
  });

  it("ganhos sem nenhum valor → sem ticket e sem valor ganho; a integridade explica o porquê", () => {
    const out = activity([won(), won()]);
    const a = get(out, "commercial-activity");
    expect(evidence(a, "rd_crm.average_ticket")).toBeUndefined();
    expect(evidence(a, "rd_crm.won_value")).toBeUndefined();

    const nc = get(out, "metric-not-computable");
    expect(codes(nc)).toEqual(
      expect.arrayContaining([
        "metric_not_computable:won_value",
        "metric_not_computable:average_ticket",
      ]),
    );
    expect(evidence(nc, "rd_crm.average_ticket")).toMatchObject({
      value: null,
      note: "nenhum dos 2 negócios ganhos tem valor registrado",
    });
  });

  it("sem nenhum ganho → ticket não calculável por falta de ganhos", () => {
    const nc = get(activity([lost(), ...deals(1)]), "metric-not-computable");
    expect(evidence(nc, "rd_crm.average_ticket")?.note).toBe("nenhum negócio ganho no período");
  });

  it("`*_deals_with_value` é CONTAGEM, não dinheiro — mesmo terminando em `_value` (ganhos sem valor)", () => {
    const nc = get(activity([won(), won()]), "metric-not-computable");
    // contagens: formato `count`, sem moeda
    expect(evidence(nc, "rd_crm.won_deals_with_value")).toEqual({
      id: "rd_crm.won_deals_with_value",
      source: "rd_crm",
      metric: "won_deals_with_value",
      label: "Negócios ganhos com valor registrado",
      period: WINDOW,
      value: 0,
      format: "count",
    });
    expect(evidence(nc, "rd_crm.won_deals")).toMatchObject({ value: 2, format: "count" });
    // dinheiro: formato `currency`, moeda não informada, valor ausente (null)
    for (const id of ["rd_crm.won_value", "rd_crm.average_ticket"]) {
      expect(evidence(nc, id), id).toMatchObject({ value: null, format: "currency", currency: null });
    }
  });

  it("`*_deals_with_value` é CONTAGEM, não dinheiro (perdidos sem valor)", () => {
    const nc = get(activity([lost(), lost(), won({ totalPrice: 100 })]), "metric-not-computable");
    expect(evidence(nc, "rd_crm.lost_deals_with_value")).toEqual({
      id: "rd_crm.lost_deals_with_value",
      source: "rd_crm",
      metric: "lost_deals_with_value",
      label: "Negócios perdidos com valor registrado",
      period: WINDOW,
      value: 0,
      format: "count",
    });
    expect(evidence(nc, "rd_crm.lost_deals")).toMatchObject({ value: 2, format: "count" });
    expect(evidence(nc, "rd_crm.lost_value")).toMatchObject({ value: null, format: "currency", currency: null });
  });

  it("o piloto (9 criados · 5 ganhos · 14 perdidos): o `metric-not-computable` persistido tem a contagem de perdidos com valor como `count`", () => {
    const nc = get(buildCrossSourceInsights(pilotLikeContext()), "metric-not-computable");
    // o mesmo ponto que o conjunto real de 01–04/10 persistiu como `currency` ("0,00")
    expect(evidence(nc, "rd_crm.lost_deals_with_value")).toMatchObject({ value: 0, format: "count" });
    expect(evidence(nc, "rd_crm.lost_deals_with_value")).not.toHaveProperty("currency");
  });

  it("invariante global: só `won_value`, `lost_value` e `average_ticket` são dinheiro; moeda só existe em `currency`", () => {
    const MONEY = ["average_ticket", "lost_value", "won_value"];
    const money = new Set<string>();
    const rows = [
      [won(), won()], // ganhos sem valor
      [lost(), lost()], // só perdidos, sem valor
      [lost(), lost(), won({ totalPrice: 100 })], // perdidos sem valor + ganho com valor
      [lost({ totalPrice: 300 }), lost(), won(), won({ totalPrice: 100 })], // valores parciais
      [...deals(2), won({ totalPrice: 1000 }), lost({ totalPrice: 50 })],
    ];
    const builds = [
      ...Object.values(SCENARIOS).map((build) => build()),
      ...rows.map((r) => scenario({ rdCrm: makeRdCrm(r) })),
    ];
    for (const ctx of builds) {
      for (const insight of buildCrossSourceInsights(ctx)) {
        for (const e of insight.evidence) {
          if (e.format === "currency") {
            money.add(e.metric);
            expect(e.currency, `${insight.type}/${e.id}: moeda deve ser null (não informada)`).toBeNull();
          } else {
            expect(e, `${insight.type}/${e.id}: moeda fora de \`currency\``).not.toHaveProperty("currency");
          }
          // contagem de negócios "com valor registrado" nunca é dinheiro
          if (/_deals_with_value$/.test(e.metric)) expect(e.format, `${insight.type}/${e.id}`).toBe("count");
        }
      }
    }
    expect([...money].sort()).toEqual(MONEY);
  });

  it("o valor perdido só entra quando algum perdido tem valor", () => {
    const withValue = get(
      activity([lost({ totalPrice: 300 }), lost({ totalPrice: 200 }), lost()]),
      "commercial-activity",
    );
    expect(evidence(withValue, "rd_crm.lost_value")?.value).toBe(500);
    expect(evidence(withValue, "rd_crm.lost_deals_with_value")?.value).toBe(2);
    expect(codes(withValue)).toContain("lost_value_partial");
  });

  it("os valores vêm sem símbolo de moeda e com a limitação de moeda não informada", () => {
    const a = get(activity([won({ totalPrice: 1000 })]), "commercial-activity");
    expect(textOf(a, "fact").join(" ")).not.toMatch(/R\$|BRL|USD|\$/);
    expect(codes(a)).toContain("currency_not_informed");
  });
});

describe("cenário 13 — valores zero não geram divisão inválida", () => {
  it("tudo zerado (visitas 0, conversões 0, só perdidos sem valor) → nenhum número inválido", () => {
    const out = buildCrossSourceInsights(SCENARIOS["tudo zerado"]!());
    assertAllFinite(out);
    const a = get(out, "commercial-activity");
    expect(evidence(a, "rd_crm.win_rate")?.value).toBe(0); // 0 ganhos ÷ 1 perdido
    expect(evidence(a, "rd_crm.average_ticket")).toBeUndefined();
    expect(evidence(get(out, "traffic-and-rd-conversions"), "rd_marketing.visits")?.value).toBe(0);
  });

  it("sem negócio fechado a taxa é null (nunca 0, NaN ou Infinity) e não vira texto", () => {
    const out = buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm(deals(2)) }));
    assertAllFinite(out);
    expect(evidence(get(out, "commercial-activity"), "rd_crm.win_rate")).toBeUndefined();
    expect(evidence(get(out, "metric-not-computable"), "rd_crm.win_rate")?.value).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/NaN|Infinity/);
  });

  it("população de atribuição vazia não gera cobertura (0/0) — a coorte vazia é descrita como tal", () => {
    // só perdidos: nenhum criado e nenhum ganho no período
    const out = buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm([lost(), lost()]) }));
    const q = get(out, "attribution-quality");
    expect(textOf(q, "fact")).toEqual([
      "Nenhum negócio criado ou ganho no período: a cobertura de origem e de campanha não pôde ser avaliada.",
    ]);
    expect(q.evidence.some((e) => e.metric.endsWith("_coverage"))).toBe(false);
    assertAllFinite(out);
  });

  it("contexto escrito à mão com RD/CRM zerados também não quebra", () => {
    const ctx = scenario({ rdMarketing: rdWith(0, 0) });
    expect(() => buildCrossSourceInsights(ctx)).not.toThrow();
  });
});

describe("cenário 14 — todo insight possui evidência (travado também nas invariantes)", () => {
  it("em cada cenário nomeado nenhum insight sai sem evidência", () => {
    for (const build of Object.values(SCENARIOS)) {
      for (const i of buildCrossSourceInsights(build())) {
        expect(i.evidence.length, i.type).toBeGreaterThan(0);
      }
    }
  });

  it("o formato é {source, metric, period, value} com fonte e período explícitos", () => {
    const e = evidence(
      get(buildCrossSourceInsights(pilotLikeContext()), "commercial-activity"),
      "rd_crm.won_deals",
    );
    expect(e).toEqual({
      id: "rd_crm.won_deals",
      source: "rd_crm",
      metric: "won_deals",
      label: "Negócios ganhos",
      period: WINDOW,
      value: 5,
      format: "count",
    });
  });
});

describe("cenário 15 — execução idempotente", () => {
  it("mesmo contexto → mesma saída, byte a byte, em execuções repetidas", () => {
    for (const build of Object.values(SCENARIOS)) {
      const ctx = build();
      const first = JSON.stringify(buildCrossSourceInsights(ctx));
      expect(JSON.stringify(buildCrossSourceInsights(ctx))).toBe(first);
      expect(JSON.stringify(buildCrossSourceInsights(structuredClone(ctx)))).toBe(first);
    }
  });

  it("não muta o contexto (funciona sobre um contexto congelado em profundidade)", () => {
    for (const build of Object.values(SCENARIOS)) {
      const ctx = deepFreeze(build());
      expect(() => buildCrossSourceInsights(ctx)).not.toThrow();
    }
  });

  it("a ordem dos insights é fixa", () => {
    const types = buildCrossSourceInsights(pilotLikeContext()).map((i) => i.type);
    expect(types).toEqual([
      "data-coverage",
      "acquisition-coverage",
      "traffic-and-rd-conversions",
      "commercial-activity",
      "commercial-vs-acquisition",
      "attribution-quality",
      "population-not-comparable",
      "metric-not-computable",
    ]);
  });

  it("a saída é JSON puro: sobrevive a um round-trip sem perda", () => {
    const out = buildCrossSourceInsights(pilotLikeContext());
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cobertura de dados, integridade e atribuição — regras específicas
// ═════════════════════════════════════════════════════════════════════════════

describe("cobertura temporal e período parcial", () => {
  it("janelas idênticas → afirma que as fontes cobrem o mesmo período e não emite 'não equivalentes'", () => {
    const out = buildCrossSourceInsights(pilotLikeContext());
    expect(find(out, "period-mismatch")).toBeUndefined();
    const rel = textOf(get(out, "data-coverage"), "observable_relationship");
    expect(rel).toEqual([
      "As fontes com dados (GA4, RD Marketing e RD CRM) cobrem exatamente o mesmo período (01/08/2026 a 28/08/2026).",
    ]);
  });

  it("dias faltando no GA4 → período parcial, com os dias reais", () => {
    const out = buildCrossSourceInsights(SCENARIOS["períodos parciais"]!());
    const p = get(out, "partial-period");
    expect(codes(p)).toEqual(["ga4_partial_days", "rd_marketing_partial_days"]);
    expect(evidence(p, "ga4.days_with_data")?.value).toBe(20);
    expect(evidence(p, "rd_marketing.days_with_data")?.value).toBe(20);
    expect(textOf(p, "limitation")[0]).toContain("20 de 28 dias");
  });

  it("janela completa → nenhum insight de período parcial", () => {
    expect(find(buildCrossSourceInsights(pilotLikeContext()), "partial-period")).toBeUndefined();
  });

  it("GA4 atrasado num período explícito → diz até quando há dados e que ele cobre só parte do período", () => {
    // o período pedido (01–28/08) vai além do último dia do GA4 (21/08): a janela é a
    // PEDIDA e é o GA4 que cobre só parte dela
    const out = buildCrossSourceInsights(SCENARIOS["GA4 atrasado"]!());
    const p = get(out, "partial-period");
    expect(codes(p)).toEqual(["ga4_partial_days", "ga4_data_lag"]);
    expect(evidence(p, "ga4.days_with_data")?.value).toBe(21);
    expect(evidence(p, "ga4.data_lag_days")).toMatchObject({
      value: 7,
      period: { start: "2026-08-21", end: "2026-08-28" },
    });
    const text = p.statements.find((s) => s.code === "ga4_data_lag")!.text;
    expect(text).toContain("só tem dados até 21/08/2026");
    expect(text).toContain("7 dias antes do fim do período solicitado (28/08/2026)");
    expect(text).toContain("cobrem só parte do período");
    // e, como o GA4 não cobre o período inteiro, nada de "no mesmo período"
    expect(find(buildCrossSourceInsights(SCENARIOS["GA4 atrasado"]!()), "traffic-and-rd-conversions")).toBeUndefined();
  });

  it("GA4 atrasado no modo padrão (janela encurtada até o último dia do GA4) → diz que as outras fontes ficaram de fora", () => {
    // modo padrão: o fim da janela É o último dia do GA4 (21/08); o esperado era 28/08
    const periodStart = "2026-07-25";
    const ctx = scenario({
      period: { start: periodStart, end: "2026-08-21" },
      ga4LastDate: "2026-08-21",
      expectedLastDate: "2026-08-28",
      ga4InPeriod: { daysWithData: 28, firstDate: periodStart, lastDate: "2026-08-21" },
      rdMarketing: makeRdMarketing([{ assetId: "a1", visits: 10, conversions: 0 }], {
        window: { start: periodStart, end: "2026-08-21" },
      }),
    });
    const p = get(buildCrossSourceInsights(ctx), "partial-period");
    expect(codes(p)).toEqual(["ga4_data_lag"]);
    const text = p.statements.find((s) => s.code === "ga4_data_lag")!.text;
    expect(text).toContain("7 dias antes do último dia esperado (28/08/2026)");
    expect(text).toContain("a janela de análise termina no último dia com dados do GA4");
    expect(text).toContain("dados posteriores das outras fontes não entram na comparação");
  });

  it("GA4 em dia → sem alerta de atraso", () => {
    const out = buildCrossSourceInsights(scenario({ rdMarketing: rdWith(10, 0) }));
    expect(find(out, "partial-period")).toBeUndefined();
  });
});

describe("integridade: populações não comparáveis", () => {
  const relationCodes = (out: CrossSourceInsight[]) =>
    codes(get(out, "population-not-comparable")).filter((c) => c?.startsWith("not_computed:"));

  it("com as três fontes lista TODAS as relações não calculadas, cada uma com o motivo", () => {
    const out = buildCrossSourceInsights(pilotLikeContext());
    expect(relationCodes(out)).toEqual([
      "not_computed:ga4_to_rd_rate",
      "not_computed:rd_to_crm_rate",
      "not_computed:traffic_to_sales_conversion",
      "not_computed:sales_attribution",
      "not_computed:cac",
      "not_computed:roas",
    ]);
    for (const text of textOf(get(out, "population-not-comparable"), "limitation").slice(1)) {
      expect(text).toMatch(/^Não calculado: .+ — .+\.$/);
    }
  });

  it("só lista relações entre fontes que existem (GA4 + CRM, sem RD Marketing)", () => {
    const out = buildCrossSourceInsights(scenario({ rdCrm: makeRdCrm([...deals(2), won()]) }));
    expect(relationCodes(out)).toEqual([
      "not_computed:traffic_to_sales_conversion",
      "not_computed:sales_attribution",
      "not_computed:cac",
      "not_computed:roas",
    ]);
  });

  it("GA4 + RD Marketing (sem CRM) → só a taxa GA4 → RD", () => {
    const out = buildCrossSourceInsights(scenario({ rdMarketing: rdWith(10, 1) }));
    expect(relationCodes(out)).toEqual(["not_computed:ga4_to_rd_rate"]);
  });

  it("uma fonte só → nada a comparar, o insight não existe", () => {
    expect(find(buildCrossSourceInsights(scenario()), "population-not-comparable")).toBeUndefined();
  });

  it("descreve a população de cada fonte e traz o tamanho de cada uma no próprio período", () => {
    const p = get(buildCrossSourceInsights(pilotLikeContext()), "population-not-comparable");
    expect(textOf(p, "limitation")[0]).toBe(
      "As fontes com dados medem populações e eventos diferentes: sessões de visitantes do site (GA4), visitas e conversões em ativos de conversão do RD (RD Marketing) e negócios do CRM (RD CRM).",
    );
    expect(evidence(p, "ga4.sessions")?.value).toBe(5377);
    expect(evidence(p, "rd_marketing.visits")?.value).toBe(6);
    expect(evidence(p, "rd_crm.created_deals")?.value).toBe(9);
  });
});

describe("atribuição: cobertura e limiar", () => {
  const quality = (sourceFilled: number, total = 10) =>
    get(
      buildCrossSourceInsights(
        scenario({
          rdCrm: makeRdCrm(
            Array.from({ length: total }, (_, i) =>
              deal({ sourceId: i < sourceFilled ? "src-1" : "", campaignId: "camp-1" }),
            ),
          ),
        }),
      ),
      "attribution-quality",
    );

  it(`exatamente ${MIN_ATTRIBUTION_COVERAGE * 100}% de cobertura já é suficiente`, () => {
    expect(codes(quality(8))).not.toContain("source_id_insufficient");
  });

  it("logo abaixo do limiar é insuficiente", () => {
    expect(codes(quality(7))).toContain("source_id_insufficient");
  });

  it("os contadores batem: preenchidos, ausentes e valores distintos de source_id", () => {
    const q = get(
      buildCrossSourceInsights(
        scenario({
          rdCrm: makeRdCrm([
            deal({ sourceId: "a" }),
            deal({ sourceId: "b" }),
            deal({ sourceId: "a" }),
            deal({ sourceId: "" }),
          ]),
        }),
      ),
      "attribution-quality",
    );
    expect(evidence(q, "rd_crm.created_deals")?.value).toBe(4);
    expect(evidence(q, "rd_crm.created_with_source_id")?.value).toBe(3);
    expect(evidence(q, "rd_crm.created_distinct_source_ids")?.value).toBe(2);
    expect(textOf(q, "fact")[0]).toContain(
      "3 (75,0%) com origem (source_id) preenchida e 0 (0,0%) com campanha (campaign_id) preenchida — 1 sem origem e 4 sem campanha",
    );
  });

  it("avalia também a população de ganhos, separada da de criados", () => {
    const q = get(
      buildCrossSourceInsights(
        scenario({
          rdCrm: makeRdCrm([
            deal({ sourceId: "src-1" }),
            won({ sourceId: "", campaignId: "" }),
            won({ sourceId: "src-1", campaignId: "camp-1" }),
          ]),
        }),
      ),
      "attribution-quality",
    );
    expect(evidence(q, "rd_crm.won_deals")?.value).toBe(2);
    expect(evidence(q, "rd_crm.won_source_id_coverage")?.value).toBe(0.5);
    expect(evidence(q, "rd_crm.won_campaign_id_coverage")?.value).toBe(0.5);
    expect(evidence(q, "rd_crm.created_source_id_coverage")?.value).toBe(1);
  });

  it("no piloto: origem alta, campanha zero → só a campanha é insuficiente; atribuição segue não suportada", () => {
    const q = get(buildCrossSourceInsights(pilotLikeContext()), "attribution-quality");
    expect(codes(q)).toEqual([
      "campaign_id_insufficient",
      "no_origin_mapping",
      "attribution_not_supported",
    ]);
  });
});

describe("coexistência entre atividade comercial e aquisição", () => {
  const rel = (ctx: AnalysisContext) =>
    find(buildCrossSourceInsights(ctx), "commercial-vs-acquisition");

  it("CRM ativo + RD com conversões → coexistem; o texto não afirma que os negócios vêm das conversões", () => {
    const i = rel(scenario({ rdMarketing: rdWith(50, 4), rdCrm: makeRdCrm([...deals(2), won()]) }))!;
    const text = textOf(i, "observable_relationship")[0]!;
    expect(text).toContain("o RD Marketing registrou 4 conversões");
    expect(text).toContain("coexistem no tempo");
    expect(text).toContain("No mesmo período, o GA4 registrou 5.377 sessões");
    expect(text).not.toContain("sem conversões");
  });

  it("CRM ativo + RD sem dados (GA4 com tráfego) → diz que o RD Marketing não tem dados", () => {
    const i = rel(scenario({ rdCrm: makeRdCrm([...deals(2), won()]) }))!;
    expect(textOf(i, "observable_relationship")[0]).toContain(
      "o GA4 registrou 5.377 sessões e o CRM registrou atividade comercial; não há dados do RD Marketing no período",
    );
  });

  it("CRM ativo + RD presente + GA4 sem tráfego → ainda relaciona CRM e RD", () => {
    const i = rel(
      scenario({ sessions: 0, rdMarketing: rdWith(10, 0), rdCrm: makeRdCrm([...deals(2), won()]) }),
    )!;
    expect(i.sources).toEqual(["rd_marketing", "rd_crm"]);
    expect(textOf(i, "observable_relationship")[0]).not.toContain("GA4");
  });

  it("sem nenhum sinal de aquisição (GA4 vazio e RD ausente) → nada a relacionar", () => {
    expect(rel(scenario({ sessions: 0, rdCrm: makeRdCrm([...deals(2), won()]) }))).toBeUndefined();
  });

  it("sem CRM → não existe", () => {
    expect(rel(scenario({ rdMarketing: rdWith(10, 0) }))).toBeUndefined();
  });

  it("a hipótese só aparece quando houve atividade comercial", () => {
    const withActivity = rel(scenario({ rdMarketing: rdWith(10, 0), rdCrm: makeRdCrm(deals(2)) }))!;
    expect(textOf(withActivity, "hypothesis")).toHaveLength(1);
  });
});

describe("limitações de escopo do RD Marketing e do CRM", () => {
  it("RD Marketing sem conversões é descrito como limitado, com a frase do escopo", () => {
    const cov = get(buildCrossSourceInsights(pilotLikeContext()), "acquisition-coverage");
    const limited = cov.statements.find((s) => s.code === "rd_marketing_no_conversions")!;
    expect(limited.text).toBe(
      "Os dados de conversão disponíveis no RD Marketing são limitados: nenhuma conversão registrada no período.",
    );
    expect(textOf(cov, "fact").join(" ")).toContain(
      "6 visitas e 0 conversões em 2 ativos de conversão (landing pages)",
    );
  });

  it("o CRM declara que os números são o estado atual e que o estoque em aberto não é avaliado", () => {
    const a = get(buildCrossSourceInsights(pilotLikeContext()), "commercial-activity");
    const snapshot = a.statements.find((s) => s.code === "deal_state_snapshot")!;
    expect(snapshot.text).toContain("estado atual dos negócios na última sincronização");
    expect(snapshot.text).toContain("o estoque total em aberto não é avaliado");
  });

  it("vários funis são somados e isso é declarado (só ID, sem separar por funil)", () => {
    const a = get(
      buildCrossSourceInsights(
        scenario({
          rdCrm: makeRdCrm([deal({ pipelineId: "p1" }), deal({ pipelineId: "p2" })]),
        }),
      ),
      "commercial-activity",
    );
    expect(codes(a)).toContain("pipelines_aggregated");
    expect(evidence(a, "rd_crm.pipelines")?.value).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Pureza e fronteira de arquitetura
// ═════════════════════════════════════════════════════════════════════════════

describe("cenário 16 — nenhum acesso ao banco (nem à rede) dentro do Cross-source", () => {
  const SRC_ROOT = join(import.meta.dirname, "..", "..", "..");
  const read = (rel: string) => readFileSync(join(SRC_ROOT, rel), "utf8");
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const dir = join(SRC_ROOT, "server/analysis/cross-source");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("em execução: com `db` armadilhado e `fetch` espionado, todos os cenários rodam sem tocar em nenhum", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const build of Object.values(SCENARIOS)) {
      expect(() => buildCrossSourceInsights(build())).not.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no código: nenhum arquivo da camada importa banco, env, conectores, sync, engine/detectores nem usa rede/relógio/aleatório/LLM", () => {
    expect(files.length).toBeGreaterThanOrEqual(7); // sanity: a pasta foi lida
    const FORBIDDEN: [string, RegExp][] = [
      ["banco (@/server/db)", /@\/server\/db/],
      ["drizzle", /drizzle-orm/],
      ["postgres", /\bpostgres\b/],
      ["env", /@\/env\b|process\.env/],
      ["conectores", /server\/connectors/],
      ["sync", /server\/sync/],
      [
        "engine/context/detectores/gates/scoring/enriquecimento",
        /from\s+["']\.\.\/(context|engine|detectors|gates|scoring|enrichment|contribution|stats|templates)["']/,
      ],
      ["rede", /\bfetch\s*\(|node:(http|https|net|child_process|fs)/],
      ["relógio", /Date\.now\s*\(|new Date\s*\(\s*\)|performance\.now/],
      ["aleatório", /Math\.random|crypto\.random/],
      ["LLM", /anthropic|openai|@ai-sdk|\bllm\b/i],
    ];
    for (const file of files) {
      const code = stripComments(readFileSync(join(dir, file), "utf8"));
      for (const [label, re] of FORBIDDEN) {
        expect(code, `${file} referencia ${label}`).not.toMatch(re);
      }
    }
  });

  it("só importa tipos do contexto — nunca valores de `../types` que o acoplem ao motor", () => {
    for (const file of files) {
      const code = stripComments(readFileSync(join(dir, file), "utf8"));
      const valueImports = code.match(/^import\s+(?!type\b)[^;]*from\s+["']\.\.\/types["']/gm) ?? [];
      expect(valueImports, file).toEqual([]);
    }
  });

  it("a camada NÃO está ligada ao engine, aos detectores, ao sync nem à tela (INV-4: não altera insights existentes)", () => {
    const wired = /from\s+["'][^"']*cross-source[^"']*["']|buildCrossSourceInsights/;
    for (const path of [
      "server/analysis/engine.ts",
      "server/analysis/detectors.ts",
      "server/analysis/gates.ts",
      "server/analysis/scoring.ts",
      "server/analysis/enrichment.ts",
      "server/analysis/context.ts",
      "server/sync/run-sync.ts",
      "app/(app)/diagnostico/data.ts",
    ]) {
      expect(stripComments(read(path)), path).not.toMatch(wired);
    }
  });
});
