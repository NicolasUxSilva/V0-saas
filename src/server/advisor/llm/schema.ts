/**
 * O que o modelo de linguagem devolve — o schema de saída, a validação e a conversão
 * para o contrato do Advisor. PURO.
 *
 *   texto do modelo ─▶ JSON.parse ─▶ Zod (schema) ─▶ `toModelResponse` ─▶ AdvisorModelResponse
 *                                                                              │
 *                                          guard (validateLlmDraft) ◀──────────┘
 *
 * O JSON do modelo NUNCA é confiado: é parseado, validado com Zod (campos, tipos,
 * enums, tamanhos) e só então convertido. O DTO é de propósito mais ESTREITO que o
 * `AdvisorModelResponse`: o modelo não escolhe o `status` (o sistema o deriva do
 * contexto), nem os `followUps`, nem o `id` das seções, nem o texto de uma
 * limitação (o sistema copia o texto do contexto pelo código) e não pode criar
 * limitações próprias. O que ele escolhe é o que só um analista escolhe: o título,
 * o resumo, a ordem, o texto das afirmações e quais evidências cada uma cita.
 *
 * O JSON Schema que o provedor recebe (saída estruturada nativa) é DERIVADO deste
 * mesmo schema Zod — uma única fonte —, sem as palavras-chave que o provedor não
 * aceita (`minLength`, `maxLength`, `maxItems`…); esses limites continuam valendo
 * aqui, na validação.
 */
import { z } from "zod";

import { completeness, followUps } from "../deterministic-model";
import { findLimitation } from "../limitations";
import type {
  AdvisorContext,
  AdvisorDraftSection,
  AdvisorItem,
  AdvisorModelResponse,
  AdvisorQuery,
  AdvisorResponseStatus,
} from "../types";

import { AdvisorLlmError } from "./transport";

export const LLM_LAYERS = [
  "fact",
  "observable_relationship",
  "hypothesis",
  "limitation",
  "diagnostic",
  "comparison",
] as const;

const itemSchema = z
  .strictObject({
    layer: z.enum(LLM_LAYERS),
    text: z.string().max(900),
    /** ids curtos (E1, E2…) das evidências que sustentam o item */
    evidenceIds: z.array(z.string().max(16)).max(12),
    /** só em `limitation`: o código da limitação do contexto; nos outros, null */
    limitationCode: z.string().max(120).nullable(),
  })
  .superRefine((item, ctx) => {
    if (item.layer !== "limitation" && item.text.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["text"], message: "texto vazio fora de limitation" });
    }
  });

const sectionSchema = z.strictObject({
  title: z.string().min(1).max(120),
  content: z.string().max(700),
  /** ids das evidências que viram a tabela de números da seção */
  figureIds: z.array(z.string().max(16)).max(12),
  items: z.array(itemSchema).max(12),
});

export const advisorLlmOutputSchema = z.strictObject({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1800),
  sections: z.array(sectionSchema).min(1).max(8),
  insightRefs: z
    .array(z.strictObject({ origin: z.enum(["diagnostics", "cross_source"]), key: z.string().max(160) }))
    .max(12),
});

export type AdvisorLlmOutput = z.infer<typeof advisorLlmOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// JSON Schema para o provedor
// ─────────────────────────────────────────────────────────────────────

/** Palavras-chave que a saída estruturada do provedor recusa (400): ficam só na validação Zod. */
const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "pattern",
  "format",
  "default",
]);

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Remove as palavras-chave não suportadas. Atenção: dentro de `properties` as chaves são
 * NOMES de campo (o DTO tem um campo `title`), não palavras-chave — só se desce neles.
 */
function sanitize(node: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "minItems" && typeof value === "number" && value > 1) continue;
    if (key === "properties" && isObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, isObject(sub) ? sanitize(sub) : sub]),
      );
    } else if (key === "items" && isObject(value)) {
      out[key] = sanitize(value);
    } else if ((key === "anyOf" || key === "allOf" || key === "oneOf") && Array.isArray(value)) {
      out[key] = value.map((v) => (isObject(v) ? sanitize(v) : v));
    } else if ((key === "$defs" || key === "definitions") && isObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, isObject(sub) ? sanitize(sub) : sub]),
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** O JSON Schema da saída, no subconjunto que o provedor aceita. */
export function advisorLlmJsonSchema(): JsonObject {
  return sanitize(z.toJSONSchema(advisorLlmOutputSchema) as JsonObject);
}

// ─────────────────────────────────────────────────────────────────────
// Parse + validação
// ─────────────────────────────────────────────────────────────────────

/** O provedor não garante a caixa de valores de enum: normaliza só a caixa, nada além. */
function normalizeEnumCase(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((s) =>
        isObject(s) && Array.isArray(s.items)
          ? {
              ...s,
              items: s.items.map((i) =>
                isObject(i) && typeof i.layer === "string" ? { ...i, layer: i.layer.toLowerCase() } : i,
              ),
            }
          : s,
      )
    : raw.sections;
  const insightRefs = Array.isArray(raw.insightRefs)
    ? raw.insightRefs.map((r) =>
        isObject(r) && typeof r.origin === "string" ? { ...r, origin: r.origin.toLowerCase() } : r,
      )
    : raw.insightRefs;
  return { ...raw, sections, insightRefs };
}

/** Texto do modelo → saída validada. JSON inválido e schema inválido viram `invalid_output`. */
export function parseLlmOutput(text: string): AdvisorLlmOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AdvisorLlmError("invalid_output", { debugDetail: "a saída não é JSON válido" });
  }
  const parsed = advisorLlmOutputSchema.safeParse(normalizeEnumCase(raw));
  if (!parsed.success) {
    // só os CAMINHOS dos campos inválidos — nunca os valores
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(raiz)"))];
    throw new AdvisorLlmError("invalid_output", { debugDetail: `schema inválido em: ${paths.join(", ")}` });
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────
// Conversão para o contrato do Advisor
// ─────────────────────────────────────────────────────────────────────

/**
 * O `status` não é do modelo: é do sistema, derivado do contexto.
 *  - comparação não computável ⇒ `not_computable`;
 *  - sem Cross-source gerado ⇒ `no_data`;
 *  - senão `partial` se alguma fonte não cobre o período inteiro (ou há limitação bloqueante), ou `answered`.
 */
export function deriveResponseStatus(context: AdvisorContext, query: AdvisorQuery): AdvisorResponseStatus {
  if (query.intent === "comparison") {
    return context.comparison?.status === "computed" ? completeness(context) : "not_computable";
  }
  if (context.crossSource.status === "not_generated") return "no_data";
  return completeness(context);
}

export interface ConvertInput {
  context: AdvisorContext;
  query: AdvisorQuery;
  /** id curto → referência real; um id desconhecido passa como está e o guard o recusa */
  aliasToRef: ReadonlyMap<string, string>;
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

export function toModelResponse(output: AdvisorLlmOutput, input: ConvertInput): AdvisorModelResponse {
  const { context, query, aliasToRef } = input;
  const real = (id: string) => aliasToRef.get(id) ?? id;

  const toItem = (item: AdvisorLlmOutput["sections"][number]["items"][number]): AdvisorItem => {
    if (item.layer === "limitation") {
      const known = item.limitationCode ? findLimitation(context, item.limitationCode) : undefined;
      // o TEXTO de uma limitação é sempre o do contexto (sem paráfrase); o modelo escolhe só ONDE ela aparece
      if (known) {
        return {
          layer: "limitation",
          text: known.message,
          evidenceRefs: known.evidenceRefs,
          code: known.code,
          severity: known.severity,
        };
      }
      // código inexistente (ou ausente): mantém como veio, e o guard recusa
      return {
        layer: "limitation",
        text: item.text,
        evidenceRefs: item.evidenceIds.map(real),
        ...(item.limitationCode ? { code: item.limitationCode } : {}),
      };
    }
    return { layer: item.layer, text: item.text.trim(), evidenceRefs: unique(item.evidenceIds.map(real)) };
  };

  const sections = output.sections.map(
    (section, i): AdvisorDraftSection => ({
      id: `llm-${i + 1}`,
      title: section.title.trim(),
      content: section.content.trim(),
      figureRefs: unique(section.figureIds.map(real)),
      items: section.items.map(toItem),
    }),
  );

  return {
    status: deriveResponseStatus(context, query),
    title: output.title.trim(),
    summary: output.summary.trim(),
    sections,
    insightRefs: output.insightRefs,
    followUps: followUps(query.intent),
  };
}
