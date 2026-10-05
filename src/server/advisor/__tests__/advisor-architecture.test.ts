/**
 * Arquitetura do Advisor — travada por teste.
 *
 *  INV-2  só `readers.ts` fala com o banco; as outras camadas do Advisor são puras;
 *  INV-5  o Advisor nunca lê `fact_*`, `raw_records` nem o `AnalysisContext`, e nunca
 *         gera nem recalcula Cross-source: só LÊ o persistido;
 *  INV-6  nenhuma escrita em lugar nenhum — o Advisor é somente leitura;
 *  INV-8  o produto funciona sem ele: nada do motor/diagnóstico o referencia;
 *  INV-9  dependência unidirecional: o motor, o sync e os conectores nunca importam o Advisor;
 *  e: sem rede e sem relógio nas camadas puras;
 *  INV-23 o provedor de LLM mora atrás de `AdvisorModel`: o serviço, o guard e o contexto
 *         não conhecem SDK, URL nem credencial; UM arquivo (`llm/anthropic.ts`) fala com
 *         a rede e conhece o provedor; nenhum SDK entra no `package.json`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** Código sem comentários — as proibições valem para o que executa, não para a prosa. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function files(dir: string, ext: RegExp = /\.tsx?$/): string[] {
  const abs = join(SRC, dir);
  return readdirSync(abs).flatMap((name) => {
    const full = join(abs, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" ? [] : files(relative(SRC, full), ext);
    }
    return ext.test(name) ? [relative(SRC, full)] : [];
  });
}

const ADVISOR_SERVER = files("server/advisor");
const ADVISOR_UI = [
  ...files("components/advisor"),
  ...files("app/(app)/advisor"),
  "lib/advisor-period.ts",
];
const ALL_ADVISOR = [...ADVISOR_SERVER, ...ADVISOR_UI];

describe("INV-2 — só `readers.ts` fala com o banco", () => {
  it("o Advisor tem os arquivos esperados", () => {
    expect([...ADVISOR_SERVER].sort()).toEqual(
      [
        "comparison.ts",
        "compose.ts",
        "context.ts",
        "deterministic-model.ts",
        "flag.ts",
        "format.ts",
        "guard.ts",
        "index.ts",
        "intents.ts",
        "limitations.ts",
        "llm-contract.ts",
        "llm/anthropic.ts",
        "llm/config.ts",
        "llm/model.ts",
        "llm/privacy.ts",
        "llm/prompt.ts",
        "llm/schema.ts",
        "llm/transport.ts",
        "log.ts",
        "query.ts",
        "readers.ts",
        "service.ts",
        "types.ts",
      ]
        .map((f) => `server/advisor/${f}`)
        .sort(),
    );
  });

  it("nenhum outro arquivo do Advisor importa o banco, o drizzle ou o driver", () => {
    for (const f of ALL_ADVISOR) {
      if (f === "server/advisor/readers.ts") continue;
      expect(code(f), f).not.toMatch(/@\/server\/db|drizzle-orm|from\s+["']postgres["']/);
    }
    expect(code("server/advisor/readers.ts")).toMatch(/@\/server\/db/);
  });

  it("`readers.ts` importa do schema SÓ `insights` e `cross_source_insights`", () => {
    const m = code("server/advisor/readers.ts").match(/import\s*\{([^}]*)\}\s*from\s*["']@\/server\/db\/schema["']/);
    expect(m).not.toBeNull();
    expect(m![1]!.split(",").map((s) => s.trim()).filter(Boolean).sort()).toEqual(["crossSourceInsights", "insights"]);
  });

  it("as camadas puras não usam banco, env, rede, relógio nem aleatoriedade", () => {
    const pure = [
      "compose",
      "comparison",
      "limitations",
      "format",
      "guard",
      "deterministic-model",
      "query",
      "llm-contract",
      "intents",
      "types",
      "llm/privacy",
      "llm/prompt",
      "llm/schema",
      "llm/transport",
    ];
    for (const name of pure) {
      const f = `server/advisor/${name}.ts`;
      for (const re of [
        /@\/server\/db|drizzle-orm|\bpostgres\b/,
        /@\/env\b|process\.env/,
        /\bfetch\s*\(|XMLHttpRequest|WebSocket/,
        /Date\.now\s*\(|new Date\s*\(|performance\.now/,
        /Math\.random|crypto\.random/,
      ]) {
        expect(code(f), `${f} ${re}`).not.toMatch(re);
      }
    }
  });

  it("o relógio só entra por `context.ts` (padrão do `now` injetável)", () => {
    expect(code("server/advisor/context.ts")).toMatch(/new Date\(\)/);
    for (const f of ADVISOR_SERVER.filter((x) => !x.endsWith("context.ts"))) {
      expect(code(f), f).not.toMatch(/new Date\s*\(\s*\)|Date\.now/);
    }
  });
});

describe("INV-5 — só LÊ saídas já calculadas e persistidas", () => {
  it("nenhuma fact table, `raw_records` nem tabelas de sync/conexão no Advisor", () => {
    for (const f of ALL_ADVISOR) {
      expect(code(f), f).not.toMatch(
        /\b(factTrafficDaily|factAdPerformanceDaily|factConversionAssetsDaily|factDeals|rawRecords|syncRuns|connectionProperties|connections)\b/,
      );
    }
  });

  it("nunca lê o `AnalysisContext` nem chama quem o constrói", () => {
    for (const f of ALL_ADVISOR) {
      expect(code(f), f).not.toMatch(/\bAnalysisContext\b|buildAnalysisContext|assembleAnalysisContext/);
    }
  });

  it("nunca GERA nem RECALCULA Cross-source: só `getCrossSourceInsights`, e só em `context.ts`", () => {
    for (const f of ALL_ADVISOR) {
      expect(code(f), f).not.toMatch(/generateCrossSourceInsights|buildCrossSourceInsights|createCrossSourceStore|\.replaceSet\b/);
    }
    const users = ALL_ADVISOR.filter((f) => /getCrossSourceInsights/.test(code(f)));
    expect(users).toEqual(["server/advisor/context.ts"]);
  });

  it("nunca roda o motor: sem detectores, gates, scoring, enriquecimento nem engine", () => {
    for (const f of ALL_ADVISOR) {
      expect(code(f), f).not.toMatch(
        /from\s+["'][^"']*analysis\/(detectors|gates|scoring|enrichment|engine|contribution|stats|templates|context)["']|runWorkspaceAnalysis/,
      );
    }
  });
});

describe("INV-6 — somente leitura: nenhuma escrita em lugar nenhum", () => {
  it("nenhum insert/update/delete/transaction/execute nem SQL de escrita no Advisor e na sua UI", () => {
    for (const f of ALL_ADVISOR) {
      const c = code(f);
      expect(c, f).not.toMatch(/\.(insert|update|delete|transaction|execute)\s*\(/);
      expect(c, f).not.toMatch(/\b(insert\s+into|delete\s+from|update\s+\w+\s+set|truncate\s|drop\s+table|alter\s+table)\b/i);
    }
  });

  it("a action do Advisor não revalida cache nem dispara nada além da leitura", () => {
    const action = code("app/(app)/advisor/actions.ts");
    expect(action).not.toMatch(/revalidatePath|revalidateTag|updateTag|refresh\s*\(|redirect\s*\(|cookies\s*\(/);
    expect(action).not.toMatch(/runSync|runWorkspaceAnalysis|generateCrossSourceInsights/);
  });
});

describe("INV-23 — o provedor de LLM mora atrás de `AdvisorModel`", () => {
  const SDK =
    /from\s+["'](@anthropic-ai\/[^"']+|openai|@ai-sdk\/[^"']+|ai|@google\/generative-ai|@google\/genai|cohere-ai|@mistralai\/[^"']+)["']/;
  const ADAPTER = "server/advisor/llm/anthropic.ts";

  it("nenhum SDK de IA é importado em lugar nenhum do Advisor", () => {
    for (const f of ALL_ADVISOR) expect(code(f), f).not.toMatch(SDK);
  });

  it("o `package.json` não ganhou nenhuma dependência de IA (o adaptador usa `fetch`)", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /anthropic|openai|ai-sdk|langchain|llama|gemini|cohere|mistral/i.test(n) || n === "ai")).toEqual([]);
  });

  it("só o adaptador fala com a rede e conhece o provedor, o endereço e o formato do pedido", () => {
    expect(code(ADAPTER)).toMatch(/fetchImpl\s*\(/);
    // texto bruto: o removedor de comentários do teste confunde `https://` dentro de string com um comentário
    expect(read(ADAPTER)).toMatch(/api\.anthropic\.com/);
    for (const f of ALL_ADVISOR.filter((x) => x !== ADAPTER)) {
      expect(code(f), f).not.toMatch(/\bfetch\s*\(|fetchImpl|XMLHttpRequest|WebSocket|node:https?|undici/);
      expect(read(f), f).not.toMatch(/api\.anthropic\.com|x-api-key|anthropic-version|output_config|max_tokens/);
    }
  });

  it("o serviço, o guard, o contexto e o determinístico não importam NADA de `llm/` nem citam o provedor", () => {
    for (const name of ["service", "guard", "context", "compose", "comparison", "deterministic-model", "readers", "query", "limitations", "format"]) {
      const f = `server/advisor/${name}.ts`;
      expect(code(f), f).not.toMatch(/from\s+["']\.\/llm\//);
      expect(code(f), f).not.toMatch(/anthropic|openai/i);
    }
  });

  it("o adaptador só é importado pela configuração; o modelo só conhece o transporte", () => {
    const importers = ALL_ADVISOR.filter((f) => /from\s+["'](?:\.\/|\.\.\/llm\/)anthropic["']/.test(code(f)));
    expect(importers).toEqual(["server/advisor/llm/config.ts"]);
    expect(code("server/advisor/llm/model.ts")).not.toMatch(/anthropic/i);
    expect(code("server/advisor/llm/model.ts")).toMatch(/from\s+["']\.\/transport["']/);
  });

  it("a credencial: lida só em `src/env.ts`, repassada por `llm/config.ts`, nunca lida do ambiente nem registrada no adaptador", () => {
    for (const f of ALL_ADVISOR) {
      expect(code(f), f).not.toMatch(/process\.env/);
    }
    const users = ALL_ADVISOR.filter((f) => /ANTHROPIC_API_KEY/.test(code(f)));
    expect(users).toEqual(["server/advisor/llm/config.ts"]);
    expect(code("env.ts")).toMatch(/ANTHROPIC_API_KEY/);
    expect(code(ADAPTER)).not.toMatch(/console\./);
  });

  it("o adaptador não envia `temperature`, `top_p`, `top_k`, ferramentas nem identificação do usuário", () => {
    const c = code(ADAPTER);
    expect(c).not.toMatch(/\b(temperature|top_p|top_k|tool_choice|tools|metadata|user_id)\b/);
  });

  it("log: só `log.ts` escreve no console, e o serviço, o modelo e o adaptador só registram metadados", () => {
    for (const f of ALL_ADVISOR) {
      if (f === "server/advisor/log.ts" || f === "app/(app)/advisor/actions.ts") continue;
      expect(code(f), f).not.toMatch(/console\./);
    }
  });

  it("o LLM não consulta o banco nem usa ferramentas: nenhum arquivo de `llm/` importa banco, drizzle ou o schema", () => {
    for (const f of ALL_ADVISOR.filter((x) => x.startsWith("server/advisor/llm/"))) {
      expect(code(f), f).not.toMatch(/@\/server\/db|drizzle-orm|readers/);
    }
  });

  it("a action usa só a fábrica de modelo (`getConfiguredAdvisorModel`), nunca o adaptador nem o provedor", () => {
    const action = code("app/(app)/advisor/actions.ts");
    expect(action).toMatch(/getConfiguredAdvisorModel\(\)/);
    expect(action).not.toMatch(/anthropic|createAnthropicTransport|LlmAdvisorModel/i);
  });
});

describe("INV-8 / INV-9 — dependência unidirecional e o produto funciona sem o Advisor", () => {
  const importsAdvisor = /from\s+["'][^"']*\/advisor(?:[/"'][^"']*)?["']|import\(\s*["'][^"']*\/advisor/;

  it("motor, Cross-source, sync, conectores e Diagnóstico nunca importam o Advisor", () => {
    const guarded = [
      ...files("server/analysis"),
      ...files("server/sync"),
      ...files("server/connectors"),
      ...files("server/auth"),
      ...files("app/(app)/diagnostico"),
      ...files("app/(app)/conexoes"),
      "components/insight-card.tsx",
      "components/diagnostico-summary.tsx",
      "components/support-metrics.tsx",
    ];
    expect(guarded.length).toBeGreaterThan(60);
    for (const f of guarded) expect(code(f), f).not.toMatch(importsAdvisor);
  });

  it("o diagnóstico não conhece o Advisor nem pelo nome (nem na UI de Diagnóstico)", () => {
    for (const f of [...files("app/(app)/diagnostico"), "server/analysis/engine.ts", "server/sync/run-sync.ts"]) {
      expect(code(f), f).not.toMatch(/advisor/i);
    }
  });

  it("só a navegação e o layout da própria rota apontam para o Advisor", () => {
    expect(code("components/shell.tsx")).toMatch(/href:\s*"\/advisor"/);
    const page = code("app/(app)/advisor/page.tsx");
    expect(page).toMatch(/isAdvisorEnabled\(\)/); // desligado, só esta tela muda
    expect(page).toMatch(/requireWorkspace\(\)/);
  });
});

describe("a UI do Advisor", () => {
  it("o client component importa do servidor SÓ tipos e constantes puras", () => {
    for (const f of ADVISOR_UI.filter((x) => x.startsWith("components/advisor/"))) {
      const imports = [...code(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const spec of imports.filter((s) => s.startsWith("@/server/") || s.startsWith("@/app/"))) {
        expect(
          ["@/server/advisor/types", "@/server/advisor/intents", "@/app/(app)/advisor/actions", "@/app/(app)/advisor/types"],
          `${f} importa ${spec}`,
        ).toContain(spec);
      }
      expect(code(f), f).not.toMatch(/@\/server\/db|@\/env|@\/server\/advisor["']|readers|\/service|\/flag|\/context["']/);
    }
  });

  it("as importações de `@/server/advisor/types` na UI são só de tipo", () => {
    for (const f of ADVISOR_UI) {
      for (const m of code(f).matchAll(/import\s+(type\s+)?\{[^}]*\}\s*from\s*["']@\/server\/advisor\/types["']/g)) {
        expect(m[1], `${f}: ${m[0]}`).toBeTruthy();
      }
    }
  });

  it("o visualizador da resposta é puro: sem hooks nem estado (renderiza igual no servidor e no cliente)", () => {
    expect(code("components/advisor/response-view.tsx")).not.toMatch(/\buse(State|Effect|Transition|Reducer|Optimistic|ActionState|Router)\b|"use client"/);
  });

  it("o workspace é o único client component e usa o server action — com a sessão, não com o cliente, como identidade", () => {
    expect(read("components/advisor/advisor-workspace.tsx").startsWith('"use client"')).toBe(true);
    const action = read("app/(app)/advisor/actions.ts");
    expect(action.startsWith('"use server"')).toBe(true);
    const c = code("app/(app)/advisor/actions.ts");
    expect(c).toMatch(/requireWorkspace\(\)/);
    expect(c.indexOf("requireWorkspace()")).toBeLessThan(c.indexOf("answerAdvisorQuery("));
    // o schema de entrada é estrito e NÃO tem `workspaceId`
    expect(c).toMatch(/z\.strictObject\(/);
    const schema = c.match(/z\.strictObject\(\{([\s\S]*?)\}\)/)![1]!;
    expect(schema).not.toMatch(/workspace/i);
  });

  it("um arquivo 'use server' só exporta funções assíncronas (regra do Next)", () => {
    const exported = [...code("app/(app)/advisor/actions.ts").matchAll(/^export\s+(?:async\s+)?(\w+)\s+(\w+)/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(exported).toEqual(["function askAdvisor"]);
    expect(code("app/(app)/advisor/actions.ts")).toMatch(/export async function askAdvisor/);
  });
});
