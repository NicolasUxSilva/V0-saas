/**
 * Integração com o Postgres REAL — OPT-IN e SOMENTE LEITURA. Sem `ADVISOR_DB_URL`
 * esta suíte é pulada e `pnpm test` continua offline.
 *
 *   ADVISOR_DB_URL=<url> pnpm exec vitest run \
 *     src/server/advisor/__tests__/advisor-integration.test.ts
 *
 * É o PRIMEIRO CASO REAL do Advisor: o fechamento parcial de 01–04/10/2026, com os
 * dados que já estão no banco — o Cross-source persistido e o diagnóstico do motor.
 * Nada de sync, OAuth, chamada externa ou escrita: a conexão é aberta com
 * `default_transaction_read_only = on` (o próprio servidor recusa qualquer escrita —
 * o teste prova isso com um CREATE recusado) e, no fim, as tabelas lidas têm o
 * mesmo número de linhas e o mesmo fingerprint de antes.
 *
 * Os números NÃO estão escritos aqui: cada um é comparado com a evidência que o
 * Cross-source persistiu — se o banco mudar, o teste acompanha; se o Advisor
 * divergir do que está persistido, o teste quebra.
 */
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  getCrossSourceInsights,
  type StoredCrossSourceInsights,
} from "@/server/analysis/cross-source-store";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";

import { buildAdvisorContext } from "../context";
import { displayValue } from "../format";
import { validateAdvisorResponse } from "../guard";
import { ADVISOR_INTENTS, type AdvisorIntent } from "../intents";
import { defaultReaders } from "../readers";
import { answerAdvisorQuery } from "../service";
import type { AdvisorResponse } from "../types";

const DB_URL = process.env.ADVISOR_DB_URL;

// O `db` do app aponta para o banco real SOMENTE em modo leitura (e para uma
// armadilha quando não há URL, para nada tocar o banco por engano).
vi.mock("@/server/db", async () => {
  const url = process.env.ADVISOR_DB_URL;
  if (!url) {
    return {
      db: new Proxy(
        {},
        {
          get() {
            throw new Error("ADVISOR_DB_URL ausente: nenhum acesso a banco é permitido");
          },
        },
      ),
    };
  }
  const { default: pg } = await import("postgres");
  const { drizzle: make } = await import("drizzle-orm/postgres-js");
  const schemaModule = await import("@/server/db/schema");
  const client = pg(url, {
    prepare: false,
    max: 1,
    // só `options` (-c) funciona neste endpoint do Neon; o parâmetro de startup simples é ignorado
    connection: { options: "-c default_transaction_read_only=on" },
  });
  return { db: make(client, { schema: schemaModule }), schema: schemaModule };
});

const PERIOD = { startDate: "2026-10-01", endDate: "2026-10-04" };

/** Código SQLSTATE de um erro do driver (o Drizzle embrulha o erro original em `cause`). */
const sqlState = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.cause?.code ?? err.code;
};

/** Linhas e fingerprint de uma tabela — para provar que a leitura não mudou nada. */
async function fingerprint(table: string): Promise<string> {
  const rows = await db.execute(
    sql.raw(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x.id)), '') as h from ${table} x`),
  );
  return `${rows[0]?.n} linhas · ${rows[0]?.h}`;
}

describe.skipIf(!DB_URL)("Advisor — primeiro caso real, 01–04/10/2026 (somente leitura)", () => {
  let workspaceId: string;
  let stored: StoredCrossSourceInsights;
  let before: Record<string, string>;

  const evidenceOf = (id: string) => stored.insights.flatMap((i) => i.evidence).find((e) => e.id === id);
  const shown = (id: string): string => {
    const e = evidenceOf(id);
    if (!e) throw new Error(`evidência ${id} ausente do Cross-source persistido`);
    return displayValue(e) ?? "";
  };

  beforeAll(async () => {
    const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
    if (!ws) throw new Error("nenhum workspace no banco");
    workspaceId = ws.id;
    stored = await getCrossSourceInsights(workspaceId, PERIOD);
    before = {
      cross_source_insights: await fingerprint("cross_source_insights"),
      insights: await fingerprint("insights"),
      fact_traffic_daily: await fingerprint("fact_traffic_daily"),
      fact_conversion_assets_daily: await fingerprint("fact_conversion_assets_daily"),
      fact_deals: await fingerprint("fact_deals"),
    };
  });

  const ask = (intent: AdvisorIntent, extra: Record<string, unknown> = {}): Promise<AdvisorResponse> =>
    answerAdvisorQuery({
      workspaceId,
      period: PERIOD,
      intent,
      ...(intent === "free_question" ? { question: "Como foi outubro?" } : {}),
      ...extra,
    });

  it("a conexão é SOMENTE LEITURA — o servidor recusa escrita", async () => {
    const rows = await db.execute(sql`show default_transaction_read_only`);
    expect(rows[0]?.default_transaction_read_only).toBe("on");
    await expect(db.execute(sql`create temp table _advisor_ro_probe (x int)`)).rejects.toSatisfy(
      (e: unknown) => sqlState(e) === "25006",
    );
  });

  it("pré-condição: o Cross-source de 01–04/10 JÁ está persistido (o Advisor nunca gera um)", () => {
    expect(stored.insights.length).toBeGreaterThan(0);
    expect(stored.generatedAt).not.toBeNull();
    expect(stored.period).toEqual({ start: PERIOD.startDate, end: PERIOD.endDate });
  });

  it("o leitor lista os períodos que têm Cross-source, com o mesmo conteúdo da porta oficial", async () => {
    const periods = await defaultReaders.crossSourcePeriods(workspaceId);
    const oct = periods.find((p) => p.start === PERIOD.startDate && p.end === PERIOD.endDate);
    expect(oct).toBeDefined();
    expect(oct?.insightCount).toBe(stored.insights.length);
    expect(oct?.generatedAt).toBe(stored.generatedAt);
    expect(periods.map((p) => p.end)).toEqual([...periods.map((p) => p.end)].sort().reverse());
  });

  it("o leitor do diagnóstico devolve só `open`/`acknowledged`, sem campos internos", async () => {
    const items = await defaultReaders.diagnostics(workspaceId);
    for (const d of items) {
      expect(["open", "acknowledged"]).toContain(d.status);
      expect(d.dedupeKey).toBeTruthy();
      expect(d.period.start <= d.period.end).toBe(true);
      expect(Object.keys(d)).not.toContain("rating");
      expect(Object.keys(d)).not.toContain("gateTraceJson");
    }
  });

  it("PRIMEIRO CASO REAL: o resumo traz exatamente os números do Cross-source persistido", async () => {
    const r = await ask("period_summary");
    expect(r.status === "answered" || r.status === "partial").toBe(true);
    expect(r.provenance.producer).toBe("deterministic");
    expect(r.provenance.crossSource).toEqual({ status: "generated", generatedAt: stored.generatedAt });

    for (const id of ["ga4.sessions", "rd_marketing.visits", "rd_marketing.conversions", "rd_crm.created_deals", "rd_crm.won_deals", "rd_crm.lost_deals"]) {
      expect(r.summary, id).toContain(shown(id));
    }
    // e as figuras estruturadas são as mesmas evidências, valor a valor
    const figures = r.sections.flatMap((s) => s.figures);
    for (const id of ["ga4.sessions", "rd_marketing.visits", "rd_crm.won_deals"]) {
      const [source, metric] = id.split(".") as [string, string];
      const f = figures.find((x) => x.source === source && x.metric === metric);
      expect(f?.value, id).toBe(evidenceOf(id)?.value);
      expect(f?.display, id).toBe(shown(id));
    }
  });

  it("o valor ganho sai com a ressalva: parte dos ganhos com valor e moeda NÃO informada", async () => {
    const r = await ask("period_summary");
    const value = evidenceOf("rd_crm.won_value");
    if (value?.value == null) return; // sem valor ganho no banco: nada a ressalvar
    expect(r.summary).toContain(shown("rd_crm.won_value"));
    expect(r.summary).toContain("moeda não informada pelo CRM");
    expect(r.summary).not.toMatch(/R\$/);
    expect(r.limitations.map((l) => l.code)).toContain("currency_not_informed");
  });

  it("toda intenção responde sobre os dados reais e passa na validação (número ∈ contexto, evidência, camadas)", async () => {
    const context = await buildAdvisorContext(workspaceId, PERIOD);
    for (const intent of ADVISOR_INTENTS.filter((i) => i !== "comparison")) {
      const r = await ask(intent);
      expect(r.provenance.fellBack, intent).toBe(false);
      expect(validateAdvisorResponse(r, { ...context, comparison: null }), intent).toEqual([]);
      // todas as limitações do contexto real estão na resposta
      const present = new Set(r.limitations.map((l) => `${l.code}\u0000${l.message}`));
      for (const l of context.limitations) expect(present.has(`${l.code}\u0000${l.message}`), `${intent}: ${l.code}`).toBe(true);
    }
  });

  it("período sem Cross-source gerado: `no_data` — nada inventado", async () => {
    const r = await answerAdvisorQuery({ workspaceId, period: { startDate: "2020-01-01", endDate: "2020-01-04" }, intent: "period_summary" });
    expect(r.status).toBe("no_data");
    expect(r.sections.flatMap((s) => s.figures)).toEqual([]);
    expect(r.limitations.find((l) => l.code === "cross_source_not_generated")?.severity).toBe("blocking");
  });

  it("comparação com os 4 dias anteriores: computável só se o Cross-source do outro período existe", async () => {
    const compare = { startDate: "2026-09-27", endDate: "2026-09-30" };
    const baseline = await getCrossSourceInsights(workspaceId, compare);
    const r = await ask("comparison", { comparePeriod: compare });
    if (baseline.insights.length === 0) {
      expect(r.status).toBe("not_computable");
      expect(r.limitations.map((l) => l.code)).toContain("comparison_not_computable:baseline_cross_source_missing");
      expect(r.comparison?.items).toEqual([]);
    } else {
      expect(["answered", "not_computable"]).toContain(r.status);
    }
  });

  it("outubro (4 dias) × setembro inteiro: não computável por duração, com os dados reais", async () => {
    const r = await ask("comparison", { comparePeriod: { startDate: "2026-09-01", endDate: "2026-09-30" } });
    expect(r.status).toBe("not_computable");
    expect(r.limitations.map((l) => l.code)).toContain("comparison_not_computable:different_duration");
  });

  it("a leitura NÃO alterou nada: mesmas linhas e mesmo fingerprint em todas as tabelas lidas", async () => {
    const after = {
      cross_source_insights: await fingerprint("cross_source_insights"),
      insights: await fingerprint("insights"),
      fact_traffic_daily: await fingerprint("fact_traffic_daily"),
      fact_conversion_assets_daily: await fingerprint("fact_conversion_assets_daily"),
      fact_deals: await fingerprint("fact_deals"),
    };
    expect(after).toEqual(before);
  });

  it("RELATÓRIO do primeiro caso real (01–04/10/2026)", async () => {
    const r = await ask("closing_report");
    const lines: string[] = [];
    lines.push(`\n${r.title} — status ${r.status} — produtor ${r.provenance.producer}`);
    lines.push(`Resumo: ${r.summary}`);
    for (const s of r.sections) {
      lines.push(`\n▸ ${s.title}`);
      for (const f of s.figures) lines.push(`    ${f.label}: ${f.display ?? "— (sem dado)"}`);
      for (const i of s.items) lines.push(`    [${i.layer}${i.code ? ":" + i.code : ""}] ${i.text}`);
    }
    lines.push(`\nLimitações: ${r.limitations.length} (${r.limitations.filter((l) => l.severity === "blocking").length} bloqueantes · ${r.limitations.filter((l) => l.severity === "warning").length} de atenção · ${r.limitations.filter((l) => l.severity === "info").length} definições)`);
    lines.push(`Evidências citadas: ${r.evidence.length} · Cross-source gerado em ${r.provenance.crossSource.generatedAt} · diagnóstico alinhado: ${r.provenance.diagnostics.alignedWithPeriod}`);
    console.log(lines.join("\n"));
    expect(r.sections.length).toBeGreaterThan(5);
  });
});
