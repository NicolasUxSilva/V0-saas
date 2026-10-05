/**
 * `buildAdvisorContext` — monta o `AdvisorContext` de um workspace e um período.
 *
 *   getCrossSourceInsights(ws, período)  ─┐   (Cross-source PERSISTIDO — só lê)
 *   insights do diagnóstico (readers.ts) ─┴─▶ composeAdvisorContext (pura) ─▶ AdvisorContext
 *
 * É uma camada de COMPOSIÇÃO, não um segundo motor analítico: não consulta fact
 * tables, não recalcula métrica, não gera Cross-source. Se o período nunca teve o
 * Cross-source gerado, o contexto diz isso (`crossSource.status = "not_generated"`
 * + limitação bloqueante) em vez de fabricar números. Gerar o Cross-source é uma
 * chamada explícita à parte (`generateCrossSourceInsights`, INV-16) — o Advisor
 * nunca a dispara.
 *
 * Com `comparePeriod`, lê também o Cross-source do período-base e anexa a
 * comparação determinística (`comparison.ts`) — o modelo recebe a variação pronta.
 */
import {
  getCrossSourceInsights,
  type StoredCrossSourceInsights,
} from "../analysis/cross-source-store";

import { compareAdvisorContexts } from "./comparison";
import { composeAdvisorContext, periodOf } from "./compose";
import { defaultReaders } from "./readers";
import type { AdvisorContext, AdvisorDiagnosticItem, AdvisorPeriodInput } from "./types";

export type CrossSourceReader = (
  workspaceId: string,
  period: AdvisorPeriodInput,
) => Promise<StoredCrossSourceInsights>;

export type DiagnosticsReader = (workspaceId: string) => Promise<AdvisorDiagnosticItem[]>;

/** Dependências injetáveis — os padrões são os de produção; os testes trocam por fontes em memória. */
export interface AdvisorContextDeps {
  readCrossSource?: CrossSourceReader;
  readDiagnostics?: DiagnosticsReader;
  now?: () => Date;
}

export async function buildAdvisorContext(
  workspaceId: string,
  period: AdvisorPeriodInput,
  options: { comparePeriod?: AdvisorPeriodInput } = {},
  deps: AdvisorContextDeps = {},
): Promise<AdvisorContext> {
  const readCrossSource: CrossSourceReader =
    deps.readCrossSource ?? ((ws, p) => getCrossSourceInsights(ws, p));
  const readDiagnostics: DiagnosticsReader =
    deps.readDiagnostics ?? ((ws) => defaultReaders.diagnostics(ws));
  const now = deps.now ?? (() => new Date());

  // períodos inválidos falham antes de qualquer leitura
  periodOf(period);
  if (options.comparePeriod) periodOf(options.comparePeriod);

  const [crossSource, diagnostics] = await Promise.all([
    readCrossSource(workspaceId, period),
    readDiagnostics(workspaceId),
  ]);
  const generatedAt = now().toISOString();

  const context = composeAdvisorContext({ workspaceId, period, crossSource, diagnostics, generatedAt });
  if (!options.comparePeriod) return context;

  const baselineStored = await readCrossSource(workspaceId, options.comparePeriod);
  const baseline = composeAdvisorContext({
    workspaceId,
    period: options.comparePeriod,
    crossSource: baselineStored,
    // o diagnóstico é do workspace, não de um período: o do período-base não entra na comparação
    diagnostics: [],
    generatedAt,
  });
  return { ...context, comparison: compareAdvisorContexts(context, baseline) };
}
