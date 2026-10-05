/**
 * Cliente HTTP da Google Ads API (REST, `fetch` cru + Bearer — mesmo padrão do
 * GA4). Compartilhado por `discovery.ts` (G2) e `extract.ts` (G3): mesma versão
 * de API, mesmos headers, mesmo tratamento de erro. Ver docs/v1-architecture.md §10.
 *
 * Developer token: a Google desativou os developer tokens em 09/09/2026 — o nível
 * de acesso da API passou a ser do projeto Google Cloud dono do client OAuth, e o
 * header `developer-token` é opcional e ignorado pelos servidores
 * (https://developers.google.com/google-ads/api/docs/api-policy/developer-token).
 * Por isso `GOOGLE_ADS_DEVELOPER_TOKEN` NÃO é obrigatório: `adsHeaders` só envia
 * o header quando a env existe (legado) e nunca falha por sua ausência.
 */
import { env } from "@/env";

/**
 * Versão da Google Ads API. Confirmada vigente em 2026-09 nas release notes
 * (https://developers.google.com/google-ads/api/docs/release-notes): a major
 * atual é v25 (v25.1); v21–v25 suportadas; a v18 fixada no G2 já foi aposentada.
 * Google aposenta ~3 versões/ano — **reconfirmar antes do primeiro sync real**.
 * Ponto único de verdade da versão (não espalhar a string pelo código).
 */
export const GOOGLE_ADS_API_VERSION = "v25";
const ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

/** Retry em 429 / 5xx (transiente) — mesmo perfil do extract do GA4. */
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Máx. de caracteres do corpo de erro HTTP que vai na mensagem. O JSON de erro da
 * Google Ads API traz o `errorCode` (o dado que diagnostica) depois de `@type` /
 * `details`, então o corte antigo em 300 caracteres o escondia; o corpo é
 * compactado (sem indentação) antes do corte.
 */
const ERROR_BODY_MAX_CHARS = 1200;

/**
 * @deprecated Não é mais lançado — desde 09/09/2026 a Google Ads API não exige
 * developer token (ver o cabeçalho do arquivo). Mantido só porque `discovery.ts`
 * o reexporta; remover junto com essa reexportação.
 */
export class DeveloperTokenMissingError extends Error {
  constructor() {
    super(
      "GOOGLE_ADS_DEVELOPER_TOKEN não configurado. A Google Ads API exige um " +
        "developer token (Basic access) de uma conta Manager (MCC) em toda " +
        "chamada, inclusive descoberta e extração. Ver docs/v1-architecture.md §10.1 e §13.",
    );
    this.name = "DeveloperTokenMissingError";
  }
}

function adsHeaders(
  accessToken: string,
  loginCustomerId: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
  // Legado e opcional (ver o cabeçalho do arquivo): só é enviado se a env existir.
  const devToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (devToken) headers["developer-token"] = devToken;

  const lcid = (loginCustomerId ?? env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)?.replace(
    /\D/g,
    "",
  );
  if (lcid) headers["login-customer-id"] = lcid;
  return headers;
}

/**
 * `fetch` autenticado contra a Google Ads API. `path` começa com `/` (ex.:
 * `/customers/123/googleAds:search`). Devolve o JSON já parseado (ainda cru — a
 * validação Zod é responsabilidade de quem chama).
 */
export async function adsFetch(
  path: string,
  init: RequestInit,
  accessToken: string,
  loginCustomerId: string | undefined,
): Promise<unknown> {
  const headers = { ...adsHeaders(accessToken, loginCustomerId), ...init.headers };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${ADS_BASE}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (res.ok) return res.json();

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
      await sleep(2 ** attempt * 1000 + Math.random() * 400);
      continue;
    }

    const body = await res.text().catch(() => "");
    // id da requisição — é o que o suporte da Google pede para investigar uma falha
    const requestId =
      res.headers.get("request-id") ?? res.headers.get("google-ads-request-id");
    const hint =
      res.status === 401
        ? "token inválido/expirado"
        : res.status === 403
          ? "acesso negado — depende do nível de acesso do projeto Google Cloud " +
            "dono do client OAuth (conta de produção exige Explorer ou superior), " +
            "da permissão do usuário na conta e do scope adwords concedido"
          : res.status === 404
            ? `versão da API (${GOOGLE_ADS_API_VERSION}) possivelmente descontinuada`
            : "";
    const detail = body.replace(/\s+/g, " ").trim().slice(0, ERROR_BODY_MAX_CHARS);
    throw new Error(
      `Google Ads API ${res.status} em ${path}${
        requestId ? ` [request-id: ${requestId}]` : ""
      }${hint ? ` — ${hint}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  throw new Error("Google Ads API: falhou após retries");
}
