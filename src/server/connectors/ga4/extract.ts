/**
 * Extração do GA4 via Data API `runReport` (bloco B3).
 *
 * Um `RawRecord` = uma página da resposta do `runReport` (JSON inteiro). Poucas
 * páginas por sync — barato de guardar e replayável. Paginação por `offset`;
 * retry com backoff em 429 / 5xx; teto de linhas de segurança.
 */
import { createHash } from "node:crypto";

import type { PullArgs, RawRecord } from "@/server/connectors/types";

import { ga4RunReportPageSchema } from "./schema";

const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const PAGE_LIMIT = 100_000;
/** Teto de segurança: acima disto o sync é marcado como `partial`. */
export const MAX_TOTAL_ROWS = 500_000;

const DIMENSIONS = [
  "date",
  "sessionDefaultChannelGroup",
  "sessionSource",
  "sessionMedium",
  "sessionCampaignName",
] as const;

const METRICS = [
  "sessions",
  "totalUsers",
  "newUsers",
  "engagedSessions",
  "userEngagementDuration",
  "keyEvents",
  "totalRevenue",
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runReport(
  property: string,
  accessToken: string,
  body: unknown,
): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${DATA_BASE}/${property}:runReport`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(2 ** attempt * 1000 + Math.random() * 400);
      continue;
    }
    const text = await res.text().catch(() => "");
    const hint =
      res.status === 403
        ? " — Data API não habilitada no projeto, ou a conta não tem acesso a esta propriedade"
        : res.status === 401
          ? " — token inválido/expirado"
          : "";
    throw new Error(
      `GA4 Data API ${res.status} em runReport${hint}: ${text.slice(0, 400)}`,
    );
  }
  throw new Error("GA4 Data API: falhou após retries");
}

export async function* pull(args: PullArgs): AsyncIterable<RawRecord> {
  if (args.stream !== "report_daily") {
    throw new Error(`Stream desconhecido no conector GA4: ${args.stream}`);
  }
  const property = args.account.externalId;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let fetched = 0;

  while (offset < total && fetched < MAX_TOTAL_ROWS) {
    const payload = await runReport(property, args.access.accessToken, {
      dateRanges: [{ startDate: args.since, endDate: args.until }],
      dimensions: DIMENSIONS.map((name) => ({ name })),
      metrics: METRICS.map((name) => ({ name })),
      limit: PAGE_LIMIT,
      offset,
      keepEmptyRows: false,
    });

    const page = ga4RunReportPageSchema.parse(payload);
    const n = page.rows?.length ?? 0;
    total = page.rowCount ?? n;
    fetched += n;

    yield {
      stream: "report_daily",
      externalId: `${property}:${args.since}:${args.until}:${offset}`,
      occurredOn: null,
      payload,
      sourceHash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
    };

    if (n < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
}
