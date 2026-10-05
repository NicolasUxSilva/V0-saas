/**
 * Configuração do modelo de linguagem: o padrão é SEGURO (desligado), e nada depende do
 * provedor para o app subir.
 *
 *  - `ADVISOR_LLM_ENABLED=false` (padrão) ⇒ só o modelo determinístico;
 *  - habilitado e sem `ANTHROPIC_API_KEY` ⇒ determinístico, com aviso honesto;
 *  - habilitado com a chave ⇒ modelo de linguagem sobre o adaptador da Anthropic;
 *  - `ADVISOR_ENABLED` e `ADVISOR_LLM_ENABLED` são independentes.
 *
 * O ambiente real é lido de `src/env.ts` (validação Zod no import); aqui ele é
 * recarregado com variáveis controladas.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { advisorLlmStatus, getConfiguredAdvisorModel, type AdvisorLlmEnv } from "../llm/config";
import { LlmAdvisorModel, UnconfiguredLlmModel } from "../llm/model";
import { ADVISOR_PROMPT_VERSION } from "../llm-contract";
import { answerAdvisorQuery } from "../service";
import { QUERY, anthropicOk, fakeFetch, goodOutput, setup } from "./advisor-llm-fixtures";

const KEYS = [
  "ADVISOR_ENABLED",
  "ADVISOR_LLM_ENABLED",
  "ANTHROPIC_API_KEY",
  "ADVISOR_LLM_MODEL",
  "ADVISOR_LLM_EFFORT",
  "ADVISOR_LLM_TIMEOUT_MS",
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Recarrega `@/env` com exatamente estas variáveis do Advisor (as demais, do vitest, ficam). */
async function loadEnv(vars: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  vi.resetModules();
  return (await import("@/env")).env;
}

describe("variáveis de ambiente", () => {
  it("o padrão é SEGURO: LLM desligado, sem credencial, modelo e esforço padrão, tempo limite de 90 s", async () => {
    const env = await loadEnv({});
    expect(env.ADVISOR_ENABLED).toBe(true);
    expect(env.ADVISOR_LLM_ENABLED).toBe(false);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ADVISOR_LLM_MODEL).toBe("claude-sonnet-5-5");
    expect(env.ADVISOR_LLM_EFFORT).toBe("medium");
    expect(env.ADVISOR_LLM_TIMEOUT_MS).toBe(90_000);
  });

  it("valores válidos são lidos (e o tempo limite vira número)", async () => {
    const env = await loadEnv({
      ADVISOR_LLM_ENABLED: "true",
      ANTHROPIC_API_KEY: "chave-de-teste",
      ADVISOR_LLM_MODEL: "claude-opus-5-5",
      ADVISOR_LLM_EFFORT: "high",
      ADVISOR_LLM_TIMEOUT_MS: "30000",
    });
    expect(env).toMatchObject({
      ADVISOR_LLM_ENABLED: true,
      ANTHROPIC_API_KEY: "chave-de-teste",
      ADVISOR_LLM_MODEL: "claude-opus-5-5",
      ADVISOR_LLM_EFFORT: "high",
      ADVISOR_LLM_TIMEOUT_MS: 30_000,
    });
  });

  it("valor VAZIO (`VAR=` no .env.local) vale como ausente: o app sobe e usa os padrões", async () => {
    const env = await loadEnv({
      ANTHROPIC_API_KEY: "",
      ADVISOR_LLM_MODEL: "  ",
      ADVISOR_LLM_EFFORT: "",
      ADVISOR_LLM_TIMEOUT_MS: "",
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ADVISOR_LLM_MODEL).toBe("claude-sonnet-5-5");
    expect(env.ADVISOR_LLM_EFFORT).toBe("medium");
    expect(env.ADVISOR_LLM_TIMEOUT_MS).toBe(90_000);
  });

  it.each([
    ["ADVISOR_LLM_ENABLED", "yes"],
    ["ADVISOR_LLM_ENABLED", "1"],
    ["ADVISOR_LLM_EFFORT", "extreme"],
    ["ADVISOR_LLM_EFFORT", "max"],
    ["ADVISOR_LLM_TIMEOUT_MS", "100"],
    ["ADVISOR_LLM_TIMEOUT_MS", "abc"],
    ["ADVISOR_LLM_TIMEOUT_MS", "999999"],
  ] as const)("%s=%s é recusado na subida, com mensagem clara", async (key, value) => {
    await expect(loadEnv({ [key]: value })).rejects.toThrow("Variáveis de ambiente inválidas");
  });

  it("a credencial nunca aparece na mensagem de uma configuração inválida", async () => {
    const error = await loadEnv({ ANTHROPIC_API_KEY: "sk-ant-SEGREDO-QUE-NAO-PODE-VAZAR", ADVISOR_LLM_EFFORT: "extreme" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.includes("SEGREDO-QUE-NAO-PODE-VAZAR")).toBe(false);
  });

  it("`ADVISOR_ENABLED` e `ADVISOR_LLM_ENABLED` são independentes — um não liga nem desliga o outro", async () => {
    await loadEnv({ ADVISOR_ENABLED: "true", ADVISOR_LLM_ENABLED: "false" });
    const a = await import("../flag");
    expect([a.isAdvisorEnabled(), a.isAdvisorLlmEnabled()]).toEqual([true, false]);

    await loadEnv({ ADVISOR_ENABLED: "false", ADVISOR_LLM_ENABLED: "true" });
    const b = await import("../flag");
    expect([b.isAdvisorEnabled(), b.isAdvisorLlmEnabled()]).toEqual([false, true]);
  });
});

describe("qual modelo o Advisor usa", () => {
  const base: AdvisorLlmEnv = {
    ADVISOR_LLM_ENABLED: false,
    ANTHROPIC_API_KEY: undefined,
    ADVISOR_LLM_MODEL: "claude-sonnet-5-5",
    ADVISOR_LLM_EFFORT: "medium",
    ADVISOR_LLM_TIMEOUT_MS: 90_000,
  };

  it("desligado (padrão): nenhum modelo — o serviço usa o determinístico", () => {
    expect(advisorLlmStatus(base)).toBe("off");
    expect(getConfiguredAdvisorModel(base)).toBeUndefined();
    // mesmo com a chave presente: ligar a credencial não liga o LLM
    expect(advisorLlmStatus({ ...base, ANTHROPIC_API_KEY: "k" })).toBe("off");
    expect(getConfiguredAdvisorModel({ ...base, ANTHROPIC_API_KEY: "k" })).toBeUndefined();
  });

  it("habilitado SEM credencial: `not_configured` e um modelo que falha de forma explícita", () => {
    const env = { ...base, ADVISOR_LLM_ENABLED: true };
    expect(advisorLlmStatus(env)).toBe("not_configured");
    const model = getConfiguredAdvisorModel(env);
    expect(model).toBeInstanceOf(UnconfiguredLlmModel);
    expect(model?.id).toBe("anthropic:claude-sonnet-5-5");
  });

  it("habilitado COM credencial: o modelo de linguagem, identificado por provedor:modelo e com a versão do prompt", () => {
    const env = { ...base, ADVISOR_LLM_ENABLED: true, ANTHROPIC_API_KEY: "k", ADVISOR_LLM_MODEL: "claude-opus-5-5" };
    expect(advisorLlmStatus(env)).toBe("ready");
    const model = getConfiguredAdvisorModel(env);
    expect(model).toBeInstanceOf(LlmAdvisorModel);
    expect(model?.id).toBe("anthropic:claude-opus-5-5");
    expect(model?.promptVersion).toBe(ADVISOR_PROMPT_VERSION);
  });

  it("a configuração chega ao adaptador: modelo, esforço e credencial (só no cabeçalho) saem no pedido", async () => {
    const s = await setup();
    const http = fakeFetch(() => anthropicOk(JSON.stringify(goodOutput(s.context))));
    vi.stubGlobal("fetch", http.fetchImpl);
    const model = getConfiguredAdvisorModel({
      ...base,
      ADVISOR_LLM_ENABLED: true,
      ANTHROPIC_API_KEY: "sk-ant-credencial-de-teste",
      ADVISOR_LLM_MODEL: "claude-haiku-4-5-20251001",
      ADVISOR_LLM_EFFORT: "low",
    })!;
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance.producer).toBe("anthropic:claude-haiku-4-5-20251001");
    const call = http.calls[0]!;
    expect(call.body.model).toBe("claude-haiku-4-5-20251001");
    expect((call.body.output_config as { effort: string }).effort).toBe("low");
    expect((call.init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-credencial-de-teste");
    expect(JSON.stringify(call.body).includes("sk-ant-credencial-de-teste")).toBe(false);
    expect(JSON.stringify(response).includes("sk-ant-credencial-de-teste")).toBe(false);
  });

  it("habilitado sem credencial, o app continua respondendo: determinístico + aviso 'não está configurado'", async () => {
    const s = await setup();
    const model = getConfiguredAdvisorModel({ ...base, ADVISOR_LLM_ENABLED: true })!;
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: true });
    expect(response.limitations.find((l) => l.code === "model_failed")?.message).toContain("não está configurado neste ambiente");
  });
});

describe("segredos e documentação", () => {
  const ROOT = join(import.meta.dirname, "..", "..", "..", "..");

  function filesUnder(dir: string, skip: (path: string) => boolean): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (skip(relative(ROOT, full))) return [];
      return statSync(full).isDirectory() ? filesUnder(full, skip) : [full];
    });
  }

  it("`.env.example` documenta o LLM com o padrão desligado e a credencial EM BRANCO", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^ADVISOR_LLM_ENABLED=false$/m);
    expect(example).toMatch(/^ANTHROPIC_API_KEY=$/m);
    for (const name of ["ADVISOR_LLM_MODEL", "ADVISOR_LLM_EFFORT", "ADVISOR_LLM_TIMEOUT_MS"]) expect(example).toContain(name);
    expect(example).not.toMatch(/sk-ant-/);
  });

  it("nenhuma credencial aparece no repositório (código, docs, exemplo, estado do projeto)", () => {
    const targets = [
      ...filesUnder(join(ROOT, "src"), (p) => p.includes("__tests__")),
      ...filesUnder(join(ROOT, "docs"), () => false),
      join(ROOT, ".env.example"),
      join(ROOT, "PROJECT_STATE.md"),
      join(ROOT, "package.json"),
    ];
    expect(targets.length).toBeGreaterThan(50);
    for (const file of targets) {
      const text = readFileSync(file, "utf8");
      expect(/sk-ant-[A-Za-z0-9_-]{16,}/.test(text), `${relative(ROOT, file)}: parece uma chave da Anthropic`).toBe(false);
      expect(/ANTHROPIC_API_KEY\s*=\s*['"]?[A-Za-z0-9_-]{8,}/.test(text), `${relative(ROOT, file)}: ANTHROPIC_API_KEY com valor`).toBe(false);
    }
  });

  it("`.env.local` (onde mora a credencial) está fora do versionamento", () => {
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toMatch(/^\.env\*$/m);
  });
});
