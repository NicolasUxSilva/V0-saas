import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PullArgs } from "@/server/connectors/types";

import { fakePage, fakeRow } from "./fixtures";

/**
 * `src/env.ts` valida `process.env` uma única vez no import e congela o objeto
 * `env`. Para alternar a presença do developer token por teste, mockamos `@/env`
 * com um getter ligado a um holder mutável (`h.devToken`).
 *
 * Além do `pull`, este arquivo cobre o cliente HTTP compartilhado (`./http`, usado
 * também pela discovery): o developer token é OPCIONAL (a Google o desativou em
 * 09/09/2026) e o diagnóstico de erro HTTP.
 */
const h = vi.hoisted(() => ({ devToken: undefined as string | undefined }));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://user:pass@localhost:5432/test",
    AUTH_SECRET: "test-secret",
    AUTH_URL: "http://localhost:3000",
    GA4_REDIRECT_URI: "http://localhost:3000/api/oauth/ga4/callback",
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
    APP_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    USE_MOCK: false,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined,
    get GOOGLE_ADS_DEVELOPER_TOKEN() {
      return h.devToken;
    },
  },
}));

// import DEPOIS do vi.mock (hoisted, mas deixa a intenção clara)
const { pull } = await import("@/server/connectors/google_ads/extract");
const { adsFetch, GOOGLE_ADS_API_VERSION } = await import(
  "@/server/connectors/google_ads/http"
);

/** Headers que o `fetch` recebeu (o cliente HTTP passa um objeto simples). */
function sentHeaders(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

/** Nomes dos headers enviados, em minúsculas — para afirmar ausência. */
function headerNames(init: RequestInit): string[] {
  return Object.keys(sentHeaders(init)).map((k) => k.toLowerCase());
}

function args(overrides: Partial<PullArgs> = {}): PullArgs {
  return {
    access: { accessToken: "access-token-abc" },
    account: {
      externalId: "customers/1234567890",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
    },
    stream: "campaign_daily",
    since: "2026-03-15",
    until: "2026-09-11",
    ...overrides,
  };
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

beforeEach(() => {
  h.devToken = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("google_ads — developer token é opcional (desativado pela Google em 09/09/2026)", () => {
  it("pull sem developer token: NÃO lança e NÃO envia o header developer-token", async () => {
    h.devToken = undefined;
    const seen: RequestInit[] = [];
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify(fakePage([fakeRow()])), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const records = await drain(pull(args()));

    expect(records).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(headerNames(seen[0]!)).not.toContain("developer-token");
    expect(sentHeaders(seen[0]!)).toMatchObject({
      authorization: "Bearer access-token-abc",
    });
  });

  it("listAccessibleCustomers (caminho da discovery) sem developer token: GET sem developer-token e sem login-customer-id", async () => {
    h.devToken = undefined;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({ resourceNames: ["customers/7124699154"] }),
          { status: 200 },
        );
      }),
    );

    const json = await adsFetch(
      "/customers:listAccessibleCustomers",
      { method: "GET" },
      "access-token-abc",
      undefined,
    );

    expect(json).toEqual({ resourceNames: ["customers/7124699154"] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
    );
    expect(calls[0]!.init.method).toBe("GET");
    expect(headerNames(calls[0]!.init)).not.toContain("developer-token");
    expect(headerNames(calls[0]!.init)).not.toContain("login-customer-id");
  });

  it("com developer token configurado (legado): o header continua sendo enviado", async () => {
    h.devToken = "dev-token-xyz";
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init);
        return new Response(JSON.stringify(fakePage([fakeRow()])), { status: 200 });
      }),
    );

    await drain(pull(args()));

    expect(sentHeaders(seen[0]!)).toMatchObject({
      "developer-token": "dev-token-xyz",
    });
  });
});

describe("google_ads pull — conta selecionada inválida", () => {
  it("externalId sem customer id numérico → erro explícito, sem HTTP", async () => {
    h.devToken = "dev-token-xyz";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      drain(
        pull(
          args({
            account: { externalId: "customers/", timezone: null, currency: null },
          }),
        ),
      ),
    ).rejects.toThrow(/customer id numérico/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stream desconhecido → erro explícito", async () => {
    h.devToken = "dev-token-xyz";
    await expect(drain(pull(args({ stream: "keyword_daily" })))).rejects.toThrow(
      /Stream desconhecido/,
    );
  });
});

describe("google_ads pull — paginação", () => {
  it("segue nextPageToken: 2 páginas → 2 RawRecords com externalId distinto", async () => {
    h.devToken = "dev-token-xyz";

    const page1 = fakePage(
      [fakeRow({ campaignId: "111", date: "2026-09-01" })],
      "TOKEN-2",
    );
    const page2 = fakePage([fakeRow({ campaignId: "222", date: "2026-09-01" })]);

    const bodies: string[] = [];
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      const payload = bodies.length === 1 ? page1 : page2;
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const records = (await drain(pull(args()))) as Array<{
      externalId: string;
      sourceHash: string;
    }>;

    expect(records).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(records[0]!.externalId).toMatch(/:0$/);
    expect(records[1]!.externalId).toMatch(/:1$/);
    expect(bodies[1]).toContain("TOKEN-2");
    expect(bodies[0]).not.toContain("pageToken");
    expect(records[0]!.sourceHash).not.toBe(records[1]!.sourceHash);
  });

  it("resposta única sem nextPageToken → 1 RawRecord, 1 requisição", async () => {
    h.devToken = "dev-token-xyz";
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify(fakePage([fakeRow()])), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const records = await drain(pull(args()));
    expect(records).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a GAQL enviada é campanha × dia na janela, sem ad_group/keyword", async () => {
    h.devToken = "dev-token-xyz";
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = String(init.body);
        return new Response(JSON.stringify(fakePage([fakeRow()])), {
          status: 200,
        });
      }),
    );

    await drain(pull(args({ since: "2026-03-15", until: "2026-09-11" })));

    expect(sentBody).toContain("FROM campaign");
    expect(sentBody).toContain(
      "segments.date BETWEEN '2026-03-15' AND '2026-09-11'",
    );
    expect(sentBody).toContain("metrics.cost_micros");
    expect(sentBody).toContain("metrics.search_impression_share");
    expect(sentBody).not.toMatch(/ad_group|keyword|search_term/);
  });

  it("o corpo do request NÃO envia pageSize (a API devolve PAGE_SIZE_NOT_SUPPORTED se vier) — nem na 1ª nem nas páginas seguintes", async () => {
    const page1 = fakePage([fakeRow({ campaignId: "111" })], "TOKEN-2");
    const page2 = fakePage([fakeRow({ campaignId: "222" })]);

    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify(bodies.length === 1 ? page1 : page2), {
          status: 200,
        });
      }),
    );

    await drain(pull(args()));

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(Object.keys(body)).not.toContain("pageSize");
      expect(Object.keys(body)).not.toContain("page_size");
      expect(String(body.query)).toContain("FROM campaign");
    }
    expect(bodies[1]!.pageToken).toBe("TOKEN-2");
  });
});

describe("google_ads adsFetch — diagnóstico de erro HTTP", () => {
  const call = () =>
    adsFetch(
      "/customers:listAccessibleCustomers",
      { method: "GET" },
      "access-token-abc",
      undefined,
    ).catch((e: unknown) => e);

  it("403: o hint cita o nível de acesso do projeto Cloud (sem culpar o developer token) e a mensagem preserva request-id e o errorCode, mesmo além dos 300 primeiros caracteres", async () => {
    const longMessage =
      "User doesn't have permission to access customer. Note: If you're " +
      "accessing a client customer, the manager's customer id must be set in " +
      "the 'login-customer-id' header.";
    // indentado como a API responde; o `errorCode` do 2º erro fica bem além do char 300
    const errorBody = JSON.stringify(
      {
        error: {
          code: 403,
          message: "The caller does not have permission",
          status: "PERMISSION_DENIED",
          details: [
            {
              "@type":
                "type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
              errors: [
                {
                  errorCode: { authorizationError: "USER_PERMISSION_DENIED" },
                  message: longMessage,
                },
                {
                  errorCode: {
                    authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
                  },
                  message: longMessage,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(errorBody, {
            status: 403,
            headers: { "request-id": "req-abc123" },
          }),
      ),
    );

    const err = await call();

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("Google Ads API 403");
    expect(message).toContain("req-abc123");
    expect(message).toMatch(/projeto Google Cloud/);
    expect(message).not.toMatch(/developer token/i);
    expect(message).toContain("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION");
  });

  it("resposta sem header request-id: a mensagem não inventa um request-id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"code":401}}', { status: 401 })),
    );

    const message = ((await call()) as Error).message;

    expect(message).toContain("Google Ads API 401");
    expect(message).toContain("token inválido/expirado");
    expect(message).not.toContain("request-id");
  });

  it("corpo de erro gigante: vai além dos 300 caracteres antigos, mas continua limitado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("A".repeat(5000), { status: 400 })),
    );

    const message = ((await call()) as Error).message;

    expect(message.length).toBeGreaterThan(1000);
    expect(message.length).toBeLessThan(1500);
  });
});
