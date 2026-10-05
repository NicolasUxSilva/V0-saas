/**
 * Cliente HTTP da API v2 do RD Station CRM (bloco RD-1D).
 *
 * Domínio `https://api.rd.services/crm/v2`, `Authorization: Bearer
 * <access_token>`, JSON em tudo. Envelope de sucesso `{"data":...,"links":...}`,
 * de erro `{"errors":[...]}` (ver developers.rdstation.com/reference/
 * crm-v2-introduction). Rate limit FLAT — 120 req/min em todos os planos, com
 * `429` + header `Retry-After` (diferente da tabela por-recurso do Marketing).
 *
 * Compartilhado por `discovery.ts` e `extract.ts`. NÃO reaproveita o `http.ts`
 * do RD Station Marketing — hosts, auth e envelope de erro são diferentes.
 */
/** Raiz PÚBLICA da API v2 do CRM — o único prefixo que o gateway roteia. */
export const CRM_API_BASE = "https://api.rd.services/crm/v2";
const CRM_API_ORIGIN = new URL(CRM_API_BASE).origin;

/**
 * Resolve o argumento de `rdCrmFetch` para a URL que de fato será chamada.
 *
 *  - caminho relativo (`/deals?...`) → colado na raiz pública `CRM_API_BASE`;
 *  - URL absoluta (um `links.next` devolvido pela API) → REANCORADA na raiz
 *    pública. Motivo (descoberto na 1ª importação real, 2026-10-04): as
 *    respostas de `GET /crm/v2/deals` trazem `links.{first,self,next,last}`
 *    com o prefixo INTERNO `https://api.rd.services/api/v2/deals?...`, que o
 *    gateway público recusa com 404 `{"message":"no Route matched with those
 *    values"}` — só `/crm/v2/...` é roteado. A 1ª página (URL montada por nós)
 *    funcionava; a 2ª (link cru da API) quebrava.
 *
 * Fail-closed: o Bearer só vai para o host da API do RD (https) e só para
 * caminhos `/crm/v2/...` (ou o `/api/v2/...` acima, que é reescrito). Qualquer
 * outra coisa lança em vez de ser chamada — um link vindo de uma resposta nunca
 * deve decidir para onde o token é enviado.
 */
export function resolveCrmUrl(pathOrUrl: string): string {
  if (!/^https?:\/\//i.test(pathOrUrl)) return `${CRM_API_BASE}${pathOrUrl}`;

  const url = new URL(pathOrUrl);
  if (url.origin !== CRM_API_ORIGIN) {
    throw new Error(
      `RD Station CRM: link de paginação aponta para outro destino (${url.origin}) — ` +
        "recusado para não enviar o token a terceiros.",
    );
  }
  const m = url.pathname.match(/^\/(?:api|crm)\/v2(\/.*)?$/);
  if (!m) {
    throw new Error(
      `RD Station CRM: link de paginação com caminho inesperado (${url.pathname}) — ` +
        "esperado /crm/v2/... (ou /api/v2/..., prefixo interno que é reescrito).",
    );
  }
  return `${CRM_API_BASE}${m[1] ?? ""}${url.search}`;
}

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RdCrmErrorBody {
  errors?: unknown[];
}

function summarizeErrors(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const errors = (body as RdCrmErrorBody).errors;
  if (!Array.isArray(errors) || errors.length === 0) return "";
  return JSON.stringify(errors).slice(0, 500);
}

/**
 * `fetch` autenticado contra a API do RD Station CRM. `path` pode ser um
 * caminho relativo (`/deals`) OU uma URL absoluta já pronta (usada para seguir
 * `links.next` da paginação — ver `extract.ts`), para não precisarmos
 * reconstruir os parâmetros de página nós mesmos. Em ambos os casos a URL
 * efetivamente chamada passa por `resolveCrmUrl` (raiz pública `/crm/v2`).
 */
export async function rdCrmFetch(
  path: string,
  init: RequestInit,
  accessToken: string,
): Promise<unknown> {
  const url = resolveCrmUrl(path);
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { ...init, headers, cache: "no-store" });
    if (res.ok) return res.json();

    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_ATTEMPTS - 1) {
        // A API v2 do CRM documenta `Retry-After` explícito em segundos — usa
        // quando vier; senão cai no backoff exponencial padrão.
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Number(retryAfterHeader) * 1000
          : NaN;
        const waitMs = Number.isFinite(retryAfterMs)
          ? retryAfterMs
          : 2 ** attempt * 1000 + Math.random() * 400;
        await sleep(waitMs);
        continue;
      }
    }

    const bodyText = await res.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      parsed = undefined;
    }
    const detail = summarizeErrors(parsed) || bodyText.slice(0, 500);
    const hint =
      res.status === 401
        ? "access_token inválido/expirado"
        : res.status === 403
          ? "o token não tem permissão para este recurso"
          : res.status === 404
            ? "rota não encontrada no gateway (só /crm/v2/... é roteado)"
            : res.status === 422
              ? "entidade inválida (corpo ou filtro RDQL malformado?)"
              : res.status === 429
                ? "limite de requisições excedido (120 req/min por conta)"
                : "";
    // `url` = o que foi REALMENTE chamado (após `resolveCrmUrl`), não o link cru
    // recebido — um erro mostrando o link interno `/api/v2/` já enganou o
    // diagnóstico uma vez.
    throw new Error(
      `RD Station CRM API ${res.status} em ${url}${hint ? ` — ${hint}` : ""}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
  throw new Error("RD Station CRM API: falhou após retries");
}
