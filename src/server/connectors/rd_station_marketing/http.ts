/**
 * Cliente HTTP da API v2 do RD Station Marketing (bloco RD-1).
 *
 * Tudo em `https://api.rd.services`, JSON em request e response, autenticação
 * por `Authorization: Bearer <access_token>` em toda chamada (ver
 * developers.rdstation.com/reference/autorizar-requisicoes). Erros vêm no
 * envelope `{"errors":[{"error_type","error_message"}]}` (ver
 * developers.rdstation.com/reference/mensagens-de-erro-rdsm).
 *
 * Diferente do Google Ads: não há developer-token nem login-customer-id aqui —
 * só o Bearer. Compartilhado por `discovery.ts` e `extract.ts`.
 */
const API_BASE = "https://api.rd.services";

/**
 * Rate limit do RD Station Marketing é por RECURSO e por PLANO, não um único
 * limite global (ver docs/v1-architecture.md §10 e o relatório da auditoria
 * RD). O endpoint de Análise usado no RD-1C tem o pior caso: 60 req/hora
 * (Pro/Advanced) — um 429 persistente normalmente significa "cota da hora
 * estourada", não um pico passageiro. Por isso o retry aqui é curto (poucas
 * tentativas, backoff modesto) em vez de insistir — se continuar 429, falha
 * com mensagem clara em vez de martelar a API por uma hora.
 */
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RdErrorBody {
  errors?: { error_type?: string; error_message?: string }[];
}

function summarizeRdErrors(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const errors = (body as RdErrorBody).errors;
  if (!Array.isArray(errors) || errors.length === 0) return "";
  return errors
    .map((e) => `${e.error_type ?? "?"}: ${e.error_message ?? "?"}`)
    .join("; ");
}

/**
 * `fetch` autenticado contra a API do RD Station Marketing. `path` começa com
 * `/` (ex.: `/platform/analytics/conversions`). Devolve o JSON já parseado —
 * ainda cru, a validação Zod é responsabilidade de quem chama.
 */
export async function rdMarketingFetch(
  path: string,
  init: RequestInit,
  accessToken: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (res.ok) return res.json();

    if (res.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
      await sleep(2 ** attempt * 1000 + Math.random() * 400);
      continue;
    }

    const bodyText = await res.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      parsed = undefined;
    }
    const detail = summarizeRdErrors(parsed) || bodyText.slice(0, 500);
    const hint =
      res.status === 401
        ? "access_token inválido/expirado"
        : res.status === 403
          ? "o token não tem permissão para este recurso (confira o plano da conta — alguns endpoints de Análise exigem Pro ou Advanced)"
          : res.status === 429
            ? "limite de requisições excedido (o RD Station Marketing limita por recurso/hora ou /minuto — aguarde antes de tentar de novo)"
            : "";
    throw new Error(
      `RD Station Marketing API ${res.status} em ${path}${hint ? ` — ${hint}` : ""}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
  throw new Error("RD Station Marketing API: falhou após retries");
}
