/**
 * Cliente HTTP da Meta Graph API / Marketing API (`fetch` cru — mesmo padrão do GA4 e
 * do Google Ads). Compartilhado por `oauth.ts`, `discovery.ts` e `extract.ts`: mesma
 * versão de API, mesmo tratamento de erro, mesmo retry.
 *
 * Segurança: o token de acesso vai no parâmetro `access_token` (a forma documentada
 * pela Meta) e NUNCA entra em mensagem de erro, log ou resposta — as mensagens usam só
 * o caminho (`path`), sem a query. As credenciais do app (`META_APP_ID` /
 * `META_APP_SECRET`) idem.
 */
import { env } from "@/env";

/**
 * Versão da Graph API / Marketing API. v25.0 (18/02/2026) e v26.0 (29/07/2026) estão
 * vigentes; a Meta mantém cada versão por ~2 anos. Ponto único de verdade da versão
 * (não espalhar a string pelo código): subir de versão é trocar esta linha e rodar os
 * testes — as mudanças da v26 (comércio, posicionamentos, enquetes) não tocam em
 * Insights nem em contas de anúncios.
 */
export const META_GRAPH_VERSION = "v25.0";
export const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const DIALOG_BASE = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

/** Retry em 429 / 5xx e nos erros de limite de taxa da Meta (transientes). */
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Códigos de limite de taxa da Graph API: 4, 17, 32, 613 e a faixa 80000–80014 (casos de uso de negócio). */
const isRateLimitCode = (code: number | null): boolean =>
  code !== null && (code === 4 || code === 17 || code === 32 || code === 613 || (code >= 80000 && code <= 80014));

export class MetaCredentialsMissingError extends Error {
  constructor() {
    super(
      "META_APP_ID / META_APP_SECRET não configurados. Crie um app no Meta for " +
        "Developers (produto Marketing API + Facebook Login), cadastre o redirect " +
        "URI e preencha as duas envs. Ver .env.example.",
    );
    this.name = "MetaCredentialsMissingError";
  }
}

export function requireMetaApp(): { appId: string; appSecret: string } {
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  if (!appId || !appSecret) throw new MetaCredentialsMissingError();
  return { appId, appSecret };
}

/** Erro devolvido pela Graph API (`{ error: { message, type, code, error_subcode, fbtrace_id } }`). */
export class MetaApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly fbtraceId: string | null;

  constructor(init: {
    message: string;
    status: number;
    code: number | null;
    subcode: number | null;
    fbtraceId: string | null;
  }) {
    super(init.message);
    this.name = "MetaApiError";
    this.status = init.status;
    this.code = init.code;
    this.subcode = init.subcode;
    this.fbtraceId = init.fbtraceId;
  }

  /** O token é inválido, expirou ou foi revogado — só reautorizar resolve. */
  get isAuthError(): boolean {
    return this.code === 190 || this.status === 401;
  }
}

interface GraphErrorBody {
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
    error_subcode?: unknown;
    fbtrace_id?: unknown;
  };
}

const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asString = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function hintFor(status: number, code: number | null, subcode: number | null): string {
  if (code === 190 || status === 401) return "token inválido, expirado ou revogado — reconecte a conta";
  if (code === 200 || code === 10 || code === 299 || code === 294) {
    return "permissão ads_read ausente ou sem acesso a esta conta de anúncios — confira as permissões concedidas e o acesso do app";
  }
  if (code === 100 && subcode === 1487534) {
    return "volume de dados acima do limite da API — reduza o período por chamada";
  }
  if (isRateLimitCode(code)) return "limite de requisições da Meta atingido — tente de novo em alguns minutos";
  return "";
}

export interface MetaFetchOptions {
  method?: "GET" | "POST" | "DELETE";
  /** query string; valores já como texto (JSON onde a API pede objeto) */
  params?: Record<string, string>;
  accessToken?: string;
}

/**
 * `fetch` contra a Graph API. `path` começa com `/` (ex.: `/me/adaccounts`). Devolve o
 * JSON já parseado (ainda cru — a validação Zod é de quem chama). Retry com backoff em
 * 429, 5xx e limite de taxa; qualquer outro erro é lançado como `MetaApiError`.
 */
export async function metaFetch(path: string, opts: MetaFetchOptions = {}): Promise<unknown> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  if (opts.accessToken) url.searchParams.set("access_token", opts.accessToken);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { method: opts.method ?? "GET", cache: "no-store" });
    const body = await res.text().catch(() => "");

    if (res.ok) {
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new Error(`Meta Graph API ${res.status} em ${path}: resposta que não é JSON`);
      }
    }

    let parsed: GraphErrorBody = {};
    try {
      parsed = JSON.parse(body) as GraphErrorBody;
    } catch {
      // corpo que não é JSON (ex.: página de erro do gateway) — segue com o status
    }
    const code = asNumber(parsed.error?.code);
    const subcode = asNumber(parsed.error?.error_subcode);

    const transient = res.status === 429 || res.status >= 500 || isRateLimitCode(code);
    if (transient && attempt < MAX_ATTEMPTS - 1) {
      await sleep(2 ** attempt * 1000 + Math.random() * 400);
      continue;
    }

    const message = asString(parsed.error?.message) ?? body.replace(/\s+/g, " ").trim().slice(0, 300);
    const fbtraceId = asString(parsed.error?.fbtrace_id);
    const hint = hintFor(res.status, code, subcode);
    throw new MetaApiError({
      message:
        `Meta Graph API ${res.status} em ${path}` +
        `${code !== null ? ` [code ${code}${subcode !== null ? `/${subcode}` : ""}]` : ""}` +
        `${fbtraceId ? ` [fbtrace_id: ${fbtraceId}]` : ""}` +
        `${hint ? ` — ${hint}` : ""}${message ? `: ${message}` : ""}`,
      status: res.status,
      code,
      subcode,
      fbtraceId,
    });
  }
  throw new Error("Meta Graph API: falhou após retries");
}
