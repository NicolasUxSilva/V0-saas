/**
 * Guard da SAÍDA do Advisor (INV-6 / INV-7) — PURO.
 *
 * O que ele prova, mecanicamente, sobre uma resposta (de um modelo ou da camada
 * determinística) em relação ao `AdvisorContext` que a originou:
 *
 *   1. todo NÚMERO e toda DATA que aparecem em texto existem, verbatim, no contexto
 *      (a invariante "número do output ∈ input" do `docs/v1-architecture.md` §9.5);
 *   2. toda referência de evidência/insight/limitação aponta para algo que existe;
 *   3. afirmação de FATO ou de RELAÇÃO OBSERVÁVEL cita evidência;
 *   4. nenhuma moeda é assumida (sem `R$`/BRL quando a fonte não informa moeda);
 *   5. limitação própria de um modelo só pode ser do Advisor;
 *   6. na resposta FINAL: nenhuma limitação do contexto foi omitida, e figuras e
 *      evidências são cópias exatas do contexto.
 *
 * O que ele NÃO consegue provar (e por isso a camada estruturada — `figures`, vinda
 * do contexto e nunca digitada — é a fonte de verdade da tela): que um texto livre
 * não afirma causalidade, que um "zero" em prosa não esconde uma ausência, ou que o
 * número certo está na frase certa (9 criados ≠ 9 ganhos — ambos são "9"). Essas
 * regras valem para o prompt (`llm-contract.ts`) e para a avaliação do modelo.
 *
 * `validateLlmDraft` = as regras acima + a VALIDAÇÃO ESTRITA que vale para todo
 * produtor que não seja o determinístico (um LLM): além de "o número existe no
 * contexto", ele exige que o número esteja numa evidência CITADA (por item e na
 * resposta), que hipótese e comparação tenham âncora, que não haja número por
 * extenso fora do contexto, nem plataforma que o contexto não menciona, nem moeda
 * que nenhuma fonte informou. Mais rígido de propósito: se for recusado, o serviço
 * responde de forma determinística — recusar custa uma resposta menos fluida, aceitar
 * errado custa a confiança no número.
 */
import { canonicalJson } from "../analysis/cross-source";

import { brDate, count, pct } from "./format";
import { ADVISOR_INTENTS } from "./intents";
import { findLimitation } from "./limitations";
import type {
  AdvisorContext,
  AdvisorEvidence,
  AdvisorItem,
  AdvisorLimitation,
  AdvisorModelResponse,
  AdvisorResponse,
} from "./types";

export type GuardViolationCode =
  | "number_not_in_context"
  | "date_not_in_context"
  | "currency_assumed"
  | "unknown_evidence_ref"
  | "unknown_insight_ref"
  | "unknown_limitation_code"
  | "limitation_without_code"
  | "fact_without_evidence"
  | "extra_limitation_origin"
  | "unknown_intent"
  | "limitation_dropped"
  | "figure_altered"
  | "evidence_altered"
  // validação estrita (LLM)
  | "number_not_supported_by_evidence"
  | "spelled_number"
  | "derived_calculation"
  | "unknown_entity"
  | "hypothesis_without_evidence"
  | "comparison_not_computed"
  | "empty_response";

export interface GuardViolation {
  code: GuardViolationCode;
  /** onde: `summary`, `sections[1].items[0]`… */
  where: string;
  detail: string;
}

// ─────────────────────────────────────────────────────────────────────
// Números e datas em texto
// ─────────────────────────────────────────────────────────────────────

// ISO ("2026-10-04", "2026-10-04T20:10:55.505Z") ou dd/mm/aaaa — numa regex só, para sair na ordem do texto
const DATE = /\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z?)?|\d{2}\/\d{2}\/\d{4}/g;
// "23.399,00" · "1.234" · "26,3%" · "487"
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?%?|\d+(?:,\d+)?%?/g;

const isoToBr = (iso: string) => brDate(iso.slice(0, 10));

/** Números e datas de um texto. As datas saem antes, para os seus dígitos não virarem "números". */
export function extractTokens(text: string): { numbers: string[]; dates: string[] } {
  const dates: string[] = [];
  let rest = text.replace(DATE, (m) => {
    dates.push(m.includes("/") ? m : isoToBr(m));
    return " ";
  });
  // "GA4" é o nome da fonte, não o número 4
  rest = rest.replace(/\bGA4\b/g, "GA");
  return { numbers: rest.match(NUMBER) ?? [], dates };
}

/** Textos, números e datas brutos do contexto — a base do que ele "autoriza" e do seu vocabulário. */
function collectContextTokens(context: AdvisorContext): { texts: string[]; numbers: string[]; dates: string[] } {
  const texts: string[] = [];
  const dates: string[] = [
    context.period.startDate,
    context.period.endDate,
    context.generatedAt,
    ...(context.crossSource.generatedAt ? [context.crossSource.generatedAt] : []),
  ];
  const numbers: string[] = [String(context.period.days)];

  for (const e of context.evidence) {
    texts.push(e.label, e.note ?? "", e.display ?? "");
    dates.push(e.period.start, e.period.end);
  }
  for (const s of [...context.facts, ...context.observations]) texts.push(s.text);
  for (const h of context.hypotheses) texts.push(h.text);
  for (const l of context.limitations) texts.push(l.message);
  for (const s of context.sources) {
    if (s.daysWithData !== null) numbers.push(count(s.daysWithData));
    if (s.periodDays !== null) numbers.push(count(s.periodDays));
  }

  for (const d of context.diagnostics.items) {
    texts.push(d.title, d.explanation, d.hypothesis, d.recommendedAction, d.confidenceBasis);
    if (d.comparedTo) texts.push(d.comparedTo);
    dates.push(d.period.start, d.period.end);
    const ev = d.evidence;
    for (const v of [ev?.current, ev?.previous, ev?.baseline]) {
      if (typeof v === "number") numbers.push(count(v));
    }
    if (typeof ev?.deltaPct === "number") {
      numbers.push(pct(ev.deltaPct), pct(Math.abs(ev.deltaPct)));
    }
    for (const row of ev?.breakdown ?? []) {
      texts.push(row.label, row.detail ?? "");
      numbers.push(pct(row.contributionPct));
    }
    if (d.impact) numbers.push(count(d.impact.value));
  }

  const cmp = context.comparison;
  if (cmp) {
    numbers.push(String(cmp.baselinePeriod.days));
    dates.push(cmp.baselinePeriod.startDate, cmp.baselinePeriod.endDate);
    for (const l of cmp.reasons) texts.push(l.message);
    for (const e of cmp.baselineEvidence) {
      texts.push(e.label, e.display ?? "");
      dates.push(e.period.start, e.period.end);
    }
    for (const i of cmp.items) {
      texts.push(i.label, i.currentDisplay, i.baselineDisplay, i.deltaDisplay, i.deltaPctDisplay ?? "");
    }
    for (const s of cmp.skipped) texts.push(s.label, s.reason);
  }
  return { texts, numbers, dates };
}

/** Tudo o que o contexto autoriza uma resposta a citar. */
export function allowedTokens(context: AdvisorContext): { numbers: Set<string>; dates: Set<string> } {
  const { texts, numbers, dates } = collectContextTokens(context);
  const allowedNumbers = new Set<string>(numbers);
  const allowedDates = new Set<string>();
  for (const text of texts) {
    const t = extractTokens(text);
    t.numbers.forEach((n) => allowedNumbers.add(n));
    t.dates.forEach((d) => allowedDates.add(d));
  }
  for (const d of dates) allowedDates.add(isoToBr(d));
  return { numbers: allowedNumbers, dates: allowedDates };
}

// ─────────────────────────────────────────────────────────────────────
// Texto de uma resposta (rascunho de modelo ou resposta final)
// ─────────────────────────────────────────────────────────────────────

interface TextRef {
  where: string;
  text: string;
}

function draftTexts(draft: AdvisorModelResponse | AdvisorResponse): TextRef[] {
  const out: TextRef[] = [
    { where: "title", text: draft.title },
    { where: "summary", text: draft.summary },
  ];
  draft.sections.forEach((section, i) => {
    out.push({ where: `sections[${i}].title`, text: section.title });
    out.push({ where: `sections[${i}].content`, text: section.content });
    section.items.forEach((item, j) => {
      out.push({ where: `sections[${i}].items[${j}]`, text: item.text });
    });
  });
  draft.followUps.forEach((f, i) => out.push({ where: `followUps[${i}]`, text: f.label }));
  const extra = "extraLimitations" in draft ? (draft.extraLimitations ?? []) : [];
  extra.forEach((l, i) => out.push({ where: `extraLimitations[${i}]`, text: l.message }));
  return out;
}

/**
 * Como uma moeda aparece em texto. Uma moeda só pode ser escrita se ALGUMA evidência do
 * contexto a informou (`currency`). "reais" só conta como moeda quando está ligado a um
 * valor ("em reais", "23.399 reais", "mil reais") — "dados reais" é adjetivo.
 */
const CURRENCY_TERMS: readonly { code: string; pattern: RegExp }[] = [
  {
    code: "BRL",
    pattern:
      /R\$|\bBRL\b|(?:\bem|\bde|\bmil|\bmilh(?:ão|ões)|\d[\d.,]*|\b(?:zero|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez))\s+reais\b|\breais\s+\d/i,
  },
  { code: "USD", pattern: /US\$|\bUSD\b|(?:^|[^A-Za-z])\$|\bd[óo]lar(?:es)?\b/i },
  { code: "EUR", pattern: /€|\bEUR\b|\beuros?\b/i },
  { code: "GBP", pattern: /£|\bGBP\b|\blibras?\s+esterlinas?\b/i },
];

function currencyViolations(text: string, context: AdvisorContext): string[] {
  const informed = new Set(
    [...context.evidence, ...(context.comparison?.baselineEvidence ?? [])]
      .map((e) => e.currency)
      .filter((c): c is string => typeof c === "string"),
  );
  return CURRENCY_TERMS.filter((t) => !informed.has(t.code) && t.pattern.test(text)).map((t) => t.code);
}

function checkTexts(texts: TextRef[], context: AdvisorContext): GuardViolation[] {
  const allowed = allowedTokens(context);
  const out: GuardViolation[] = [];

  for (const { where, text } of texts) {
    const tokens = extractTokens(text);
    for (const n of tokens.numbers) {
      if (!allowed.numbers.has(n)) {
        out.push({
          code: "number_not_in_context",
          where,
          detail: `O número “${n}” não existe no contexto.`,
        });
      }
    }
    for (const d of tokens.dates) {
      if (!allowed.dates.has(d)) {
        out.push({
          code: "date_not_in_context",
          where,
          detail: `A data “${d}” não existe no contexto.`,
        });
      }
    }
    for (const code of currencyViolations(text, context)) {
      out.push({
        code: "currency_assumed",
        where,
        detail: `O texto assume moeda (${code === "BRL" ? "R$/BRL" : code}), mas nenhuma fonte informou essa moeda.`,
      });
    }
  }
  return out;
}

const knownRefs = (context: AdvisorContext): Set<string> =>
  new Set([
    ...context.evidence.map((e) => e.ref),
    ...(context.comparison?.baselineEvidence ?? []).map((e) => e.ref),
  ]);

const knownLimitationCodes = (
  context: AdvisorContext,
  extra: AdvisorLimitation[] = [],
): Set<string> =>
  new Set([
    ...context.limitations.map((l) => l.code),
    ...(context.comparison?.reasons ?? []).map((l) => l.code),
    ...extra.map((l) => l.code),
  ]);

// ─────────────────────────────────────────────────────────────────────
// Validação
// ─────────────────────────────────────────────────────────────────────

/** Valida o rascunho que um modelo devolveu. Lista vazia = aceito. */
export function validateModelResponse(
  draft: AdvisorModelResponse,
  context: AdvisorContext,
): GuardViolation[] {
  const violations = checkTexts(draftTexts(draft), context);
  const refs = knownRefs(context);
  const codes = knownLimitationCodes(context, draft.extraLimitations);

  draft.sections.forEach((section, i) => {
    for (const ref of section.figureRefs) {
      if (!refs.has(ref)) {
        violations.push({
          code: "unknown_evidence_ref",
          where: `sections[${i}].figureRefs`,
          detail: `A evidência “${ref}” não existe no contexto.`,
        });
      }
    }
    section.items.forEach((item, j) => {
      const where = `sections[${i}].items[${j}]`;
      for (const ref of item.evidenceRefs) {
        if (!refs.has(ref)) {
          violations.push({
            code: "unknown_evidence_ref",
            where,
            detail: `A evidência “${ref}” não existe no contexto.`,
          });
        }
      }
      if (
        (item.layer === "fact" || item.layer === "observable_relationship") &&
        item.evidenceRefs.length === 0
      ) {
        violations.push({
          code: "fact_without_evidence",
          where,
          detail: `Um item de camada “${item.layer}” precisa citar evidência.`,
        });
      }
      if (item.layer === "limitation") {
        if (!item.code) {
          violations.push({
            code: "limitation_without_code",
            where,
            detail: "Uma limitação precisa apontar para o código estável da limitação do contexto.",
          });
        } else if (!codes.has(item.code)) {
          violations.push({
            code: "unknown_limitation_code",
            where,
            detail: `O código de limitação “${item.code}” não existe no contexto.`,
          });
        }
      }
    });
  });

  const diagnosticKeys = new Set(context.diagnostics.items.map((d) => d.dedupeKey));
  const crossTypes = new Set<string>(context.crossSource.insights.map((i) => i.type));
  draft.insightRefs.forEach((ref, i) => {
    const known = ref.origin === "diagnostics" ? diagnosticKeys.has(ref.key) : crossTypes.has(ref.key);
    if (!known) {
      violations.push({
        code: "unknown_insight_ref",
        where: `insightRefs[${i}]`,
        detail: `O insight “${ref.origin}:${ref.key}” não existe no contexto.`,
      });
    }
  });

  draft.extraLimitations?.forEach((l, i) => {
    if (l.origin !== "advisor") {
      violations.push({
        code: "extra_limitation_origin",
        where: `extraLimitations[${i}]`,
        detail: "Uma limitação própria do modelo só pode ter origem “advisor”.",
      });
    }
  });

  draft.followUps.forEach((f, i) => {
    if (!(ADVISOR_INTENTS as readonly string[]).includes(f.intent)) {
      violations.push({
        code: "unknown_intent",
        where: `followUps[${i}]`,
        detail: `A intenção “${f.intent}” não existe.`,
      });
    }
  });

  return violations;
}

/**
 * Valida a resposta FINAL (já completada pelo serviço): os mesmos testes de texto,
 * mais a integridade do que o serviço anexa — nenhuma limitação do contexto
 * omitida, e figuras e evidências idênticas às do contexto.
 */
export function validateAdvisorResponse(
  response: AdvisorResponse,
  context: AdvisorContext,
): GuardViolation[] {
  const violations = checkTexts(draftTexts(response), context);

  const present = new Set(response.limitations.map((l) => `${l.code}\u0000${l.message}`));
  const required = [...context.limitations, ...(context.comparison?.reasons ?? [])];
  for (const l of required) {
    if (!present.has(`${l.code}\u0000${l.message}`)) {
      violations.push({
        code: "limitation_dropped",
        where: "limitations",
        detail: `A limitação “${l.code}” do contexto não está na resposta.`,
      });
    }
  }

  const byRef = new Map(
    [...context.evidence, ...(context.comparison?.baselineEvidence ?? [])].map((e) => [e.ref, e] as const),
  );
  response.sections.forEach((section, i) => {
    for (const figure of section.figures) {
      const original = byRef.get(figure.ref);
      if (!original || canonicalJson(original) !== canonicalJson(figure)) {
        violations.push({
          code: "figure_altered",
          where: `sections[${i}].figures`,
          detail: `A figura “${figure.ref}” difere da evidência do contexto.`,
        });
      }
    }
  });
  for (const e of response.evidence) {
    const original = byRef.get(e.ref);
    if (!original || canonicalJson(original) !== canonicalJson(e)) {
      violations.push({
        code: "evidence_altered",
        where: "evidence",
        detail: `A evidência “${e.ref}” difere da do contexto.`,
      });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────
// Validação ESTRITA — todo produtor que não é o determinístico (um LLM)
// ─────────────────────────────────────────────────────────────────────

const WORD = /[a-z0-9áàâãäéèêëíìîïóòôõöúùûüçñ]+/g;
const words = (text: string): string[] => text.toLowerCase().match(WORD) ?? [];
const numbersOf = (text: string): string[] => extractTokens(text).numbers;

/** Número por extenso → o algarismo que ele representa. "um"/"uma" ficam de fora: são artigo. */
const NUMBER_WORDS: ReadonlyMap<string, string> = new Map([
  ["zero", "0"], ["dois", "2"], ["duas", "2"], ["três", "3"], ["tres", "3"], ["quatro", "4"],
  ["cinco", "5"], ["seis", "6"], ["sete", "7"], ["oito", "8"], ["nove", "9"], ["dez", "10"],
  ["onze", "11"], ["doze", "12"], ["treze", "13"], ["quatorze", "14"], ["catorze", "14"],
  ["quinze", "15"], ["dezesseis", "16"], ["dezessete", "17"], ["dezoito", "18"], ["dezenove", "19"],
  ["vinte", "20"], ["trinta", "30"], ["quarenta", "40"], ["cinquenta", "50"], ["sessenta", "60"],
  ["setenta", "70"], ["oitenta", "80"], ["noventa", "90"], ["cem", "100"], ["cento", "100"],
  ["duzentos", "200"], ["trezentos", "300"], ["quatrocentos", "400"], ["quinhentos", "500"],
  ["seiscentos", "600"], ["setecentos", "700"], ["oitocentos", "800"], ["novecentos", "900"],
]);

/** Magnitudes e aritmética implícita ("dobrou", "metade"): só valem se o próprio contexto usa a palavra. */
const MAGNITUDE_WORDS: ReadonlySet<string> = new Set([
  "mil", "milhão", "milhões", "milhao", "milhoes", "bilhão", "bilhões", "bilhao", "bilhoes",
  "dobro", "dobrou", "dobraram", "dobrar", "duplicou", "duplicaram", "duplo", "metade",
  "triplo", "triplicou", "triplicaram", "quádruplo", "quadruplo", "quadruplicou", "quadruplicaram",
]);

/**
 * Plataformas e ferramentas que um texto da resposta não pode citar se o contexto
 * não as menciona: uma afirmação sobre uma fonte que o sistema não tem é inventada.
 * (Lista fechada de propósito — não tenta reconhecer entidades em geral.)
 */
const PLATFORM_TERMS: readonly string[] = [
  "google ads", "adwords", "meta ads", "facebook", "instagram", "linkedin", "tiktok", "youtube",
  "twitter", "pinterest", "bing", "mailchimp", "hubspot", "salesforce", "pipedrive", "whatsapp",
  "semrush", "hotjar", "search console", "shopify",
];

/** O vocabulário do contexto: toda palavra dos textos que ele traz (e os nomes das fontes). */
function contextVocabulary(context: AdvisorContext): { words: Set<string>; joined: string } {
  const texts = [
    ...collectContextTokens(context).texts,
    ...context.sources.map((s) => s.label),
    ...context.crossSource.insights.map((i) => i.title),
  ];
  const tokens = texts.flatMap(words);
  return { words: new Set(tokens), joined: ` ${tokens.join(" ")} ` };
}

/**
 * Números que valem sem evidência citada: só os dias do período (aritmética de calendário).
 * A cobertura por fonte ("2 de 4 dias", "0 de 4 dias") NÃO entra aqui: é uma evidência
 * (`days_with_data`) e precisa ser citada — senão um "0" legítimo de cobertura liberaria
 * "0 sessões" para uma fonte sem dado.
 */
function baseSupport(context: AdvisorContext): Set<string> {
  const out = new Set<string>([String(context.period.days)]);
  if (context.comparison) out.add(String(context.comparison.baselinePeriod.days));
  return out;
}

function addEvidenceSupport(refs: Iterable<string>, byRef: Map<string, AdvisorEvidence>, into: Set<string>): void {
  for (const ref of refs) {
    const e = byRef.get(ref);
    if (!e) continue;
    for (const text of [e.display ?? "", e.note ?? "", e.label]) numbersOf(text).forEach((n) => into.add(n));
  }
}

/**
 * Números que o SISTEMA escreveu em uma frase do contexto (fato, relação, hipótese ou
 * limitação) ligada a uma evidência que o texto cita — "2 ativos de conversão", "19
 * negócios fechados": derivados pelo Cross-source, sem evidência própria no registro.
 * Continuam rastreáveis: o número está numa frase do sistema que cita a MESMA evidência.
 *
 * Só uma evidência COM dado liga: a ausência (`display: null`) não sustenta número
 * nenhum — nem o dela (não tem), nem o de uma frase que a cita. É o que impede
 * "ausência vira zero": "O GA4 registrou 0 sessões" para uma fonte sem dado cita a
 * evidência de sessões (nula), e o "0" de outra frase ("0 conversões") não a socorre.
 */
function addStatementSupport(
  refs: Set<string>,
  byRef: Map<string, AdvisorEvidence>,
  context: AdvisorContext,
  into: Set<string>,
): void {
  const live = new Set([...refs].filter((r) => byRef.get(r)?.display != null));
  const linked = (evidenceRefs: string[]) => evidenceRefs.some((r) => live.has(r));
  for (const s of [...context.facts, ...context.observations, ...context.hypotheses]) {
    if (linked(s.evidenceRefs)) numbersOf(s.text).forEach((n) => into.add(n));
  }
  for (const l of context.limitations) {
    if (linked(l.evidenceRefs)) numbersOf(l.message).forEach((n) => into.add(n));
  }
}

/** Os valores já calculados de um item da comparação valem quando a resposta cita a evidência dele. */
function addComparisonSupport(refs: Set<string>, context: AdvisorContext, into: Set<string>): void {
  for (const i of context.comparison?.items ?? []) {
    if (!refs.has(i.currentRef) && !refs.has(i.baselineRef)) continue;
    for (const text of [i.currentDisplay, i.baselineDisplay, i.deltaDisplay, i.deltaPctDisplay ?? ""]) {
      numbersOf(text).forEach((n) => into.add(n));
    }
  }
}

/** Os números do diagnóstico do motor (a coleta é a mesma do contexto, só da parte do diagnóstico). */
function addDiagnosticsSupport(context: AdvisorContext, into: Set<string>): void {
  const only = collectContextTokens({
    ...context,
    evidence: [],
    facts: [],
    observations: [],
    hypotheses: [],
    limitations: [],
    sources: [],
    comparison: null,
  });
  only.numbers.forEach((n) => into.add(n));
  for (const text of only.texts) numbersOf(text).forEach((n) => into.add(n));
}

interface Vocabulary {
  words: Set<string>;
  joined: string;
}

/**
 * Números de um texto: (a) um algarismo que EXISTE no contexto mas não está em nenhuma
 * evidência citada para este texto; (b) um número por extenso que não bate com nenhum
 * número do contexto, ou que bate mas não está numa evidência citada; (c) uma palavra
 * de magnitude/aritmética implícita que o contexto não usa. (Algarismo fora do contexto
 * já é `number_not_in_context`, do guard base.)
 */
function checkNumbers(
  where: string,
  text: string,
  support: Set<string>,
  global: Set<string>,
  vocab: Vocabulary,
  out: GuardViolation[],
): void {
  for (const n of numbersOf(text)) {
    if (global.has(n) && !support.has(n)) {
      out.push({
        code: "number_not_supported_by_evidence",
        where,
        detail: `O número “${n}” existe no contexto, mas não está em nenhuma evidência citada para este texto.`,
      });
    }
  }
  for (const w of words(text)) {
    const digit = NUMBER_WORDS.get(w);
    if (digit !== undefined && !vocab.words.has(w)) {
      if (!global.has(digit)) {
        out.push({
          code: "spelled_number",
          where,
          detail: `O número por extenso “${w}” não corresponde a nenhum número do contexto.`,
        });
      } else if (!support.has(digit)) {
        out.push({
          code: "number_not_supported_by_evidence",
          where,
          detail: `O número por extenso “${w}” não está em nenhuma evidência citada para este texto.`,
        });
      }
    } else if (MAGNITUDE_WORDS.has(w) && !vocab.words.has(w)) {
      out.push({
        code: "spelled_number",
        where,
        detail: `A palavra “${w}” expressa uma magnitude ou uma conta que o contexto não traz.`,
      });
    }
  }
}

/**
 * Conta implícita: uma frase com número que fala "por unidade", "cada", "em média", "vezes
 * mais", "razão"… está distribuindo, dividindo ou comparando por conta própria. O erro
 * clássico é o número CERTO na frase ERRADA — "os 5 ganhos valem 23.399,00 cada", quando
 * 23.399,00 é a soma de 1 de 5 ganhos: todos os números existem no contexto e a evidência
 * citada existe, então a checagem numérica não vê. Por isso a conta implícita é recusada pela
 * FRASE, a não ser que a frase seja uma que o próprio sistema escreveu (contida num texto do
 * contexto). Heurística de propósito estreita: só dispara com palavra de conta E número.
 */
const IMPLICIT_CALCULATION =
  /\bcada\b|\bpor\s+(?:negócio|negocio|venda|lead|sessão|sessao|visita|ganho|perdido|cliente|contato|dia|semana|mês|mes|campanha|canal|página|pagina)\b|\bem\s+média\b|\bna\s+média\b|\bmédia\s+de\b|\bvezes\s+(?:mais|menos|maior|menor)\b|\bproporção\b|\brazão\b/i;

const sentencesOf = (text: string): string[] =>
  text
    .split(/[.!?;]+\s+|[.!?;]+$/)
    .map((x) => x.trim())
    .filter((x) => x !== "");

function checkImplicitCalculation(where: string, text: string, contextTexts: string[], out: GuardViolation[]): void {
  for (const sentence of sentencesOf(text)) {
    if (!IMPLICIT_CALCULATION.test(sentence) || !/\d/.test(sentence)) continue;
    const normalized = words(sentence).join(" ");
    if (contextTexts.some((t) => t.includes(normalized))) continue; // é uma frase do próprio sistema
    out.push({
      code: "derived_calculation",
      where,
      detail: "A frase sugere uma conta (por unidade, média, razão) que o contexto não traz; o modelo não calcula.",
    });
    return;
  }
}

function checkEntities(where: string, text: string, vocab: Vocabulary, out: GuardViolation[]): void {
  const joined = ` ${words(text).join(" ")} `;
  for (const term of PLATFORM_TERMS) {
    if (joined.includes(` ${term} `) && !vocab.joined.includes(` ${term} `)) {
      out.push({ code: "unknown_entity", where, detail: `“${term}” não aparece no contexto.` });
    }
  }
}

function strictViolations(draft: AdvisorModelResponse, context: AdvisorContext): GuardViolation[] {
  const out: GuardViolation[] = [];
  const global = allowedTokens(context).numbers;
  const vocab = contextVocabulary(context);
  // os textos do contexto, normalizados: uma frase do próprio sistema não é "conta por conta própria"
  const contextTexts = [
    ...collectContextTokens(context).texts,
    ...context.comparison?.items.map((i) => `${i.label} ${i.currentDisplay} ${i.baselineDisplay}`) ?? [],
  ].map((t) => words(t).join(" "));
  const byRef = new Map(
    [...context.evidence, ...(context.comparison?.baselineEvidence ?? [])].map((e) => [e.ref, e] as const),
  );
  const base = baseSupport(context);

  // hipóteses que o próprio contexto traz (as do motor não têm evidência no registro): repeti-las palavra por palavra é seguro
  const normalized = (text: string) => words(text).join(" ");
  const contextHypotheses = new Set(context.hypotheses.map((h) => normalized(h.text)));

  const items = draft.sections.reduce((n, s) => n + s.items.length, 0);
  if (draft.sections.length === 0 || items === 0) {
    out.push({ code: "empty_response", where: "sections", detail: "A resposta não tem nenhum item." });
  }

  // o que a resposta cita, no total — apoio do resumo, dos títulos e do texto das seções
  const cited = new Set<string>();
  for (const section of draft.sections) {
    section.figureRefs.forEach((r) => cited.add(r));
    for (const item of section.items) item.evidenceRefs.forEach((r) => cited.add(r));
  }
  const usesDiagnostics =
    draft.insightRefs.some((r) => r.origin === "diagnostics") ||
    draft.sections.some((s) => s.items.some((i) => i.layer === "diagnostic"));

  const response = new Set(base);
  addEvidenceSupport(cited, byRef, response);
  addStatementSupport(cited, byRef, context, response);
  addComparisonSupport(cited, context, response);
  if (usesDiagnostics) addDiagnosticsSupport(context, response);
  for (const section of draft.sections) {
    for (const item of section.items) {
      const l = item.layer === "limitation" && item.code ? findLimitation(context, item.code) : undefined;
      if (l) numbersOf(l.message).forEach((n) => response.add(n));
    }
  }

  const frame = (where: string, text: string) => {
    checkNumbers(where, text, response, global, vocab, out);
    checkImplicitCalculation(where, text, contextTexts, out);
    checkEntities(where, text, vocab, out);
  };
  frame("title", draft.title);
  frame("summary", draft.summary);

  draft.sections.forEach((section, i) => {
    frame(`sections[${i}].title`, section.title);
    frame(`sections[${i}].content`, section.content);
    section.items.forEach((item: AdvisorItem, j) => {
      const where = `sections[${i}].items[${j}]`;
      if (item.layer === "limitation") return; // o texto vem do contexto, sem reescrita

      const refs = new Set(item.evidenceRefs);
      if (item.layer === "hypothesis" && refs.size === 0 && !contextHypotheses.has(normalized(item.text))) {
        out.push({
          code: "hypothesis_without_evidence",
          where,
          detail: "Uma hipótese precisa citar as evidências do contexto sobre as quais é levantada.",
        });
      }
      if (item.layer === "comparison") {
        if (context.comparison?.status !== "computed") {
          out.push({
            code: "comparison_not_computed",
            where,
            detail: "Não há comparação calculada no contexto; a camada “comparison” não pode ser usada.",
          });
        }
        if (refs.size === 0) {
          out.push({
            code: "fact_without_evidence",
            where,
            detail: "Um item de camada “comparison” precisa citar evidência.",
          });
        }
      }

      // o apoio de um item é a evidência QUE ELE cita (mais os dias do período e a cobertura das fontes)
      const support = new Set(base);
      addEvidenceSupport(refs, byRef, support);
      addStatementSupport(refs, byRef, context, support);
      if (item.layer === "comparison") addComparisonSupport(refs, context, support);
      if (item.layer === "diagnostic") addDiagnosticsSupport(context, support);
      checkNumbers(where, item.text, support, global, vocab, out);
      checkImplicitCalculation(where, item.text, contextTexts, out);
      checkEntities(where, item.text, vocab, out);
    });
  });
  return out;
}

/**
 * Valida o rascunho de um MODELO DE LINGUAGEM: as regras de `validateModelResponse` mais a
 * validação estrita. É a que o serviço aplica a todo produtor que não seja o determinístico.
 */
export function validateLlmDraft(draft: AdvisorModelResponse, context: AdvisorContext): GuardViolation[] {
  return [...validateModelResponse(draft, context), ...strictViolations(draft, context)];
}
