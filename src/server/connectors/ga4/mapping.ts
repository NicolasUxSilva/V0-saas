/**
 * Mapeamento GA4 → camada canônica (bloco B3).
 *
 * Uma página do `runReport` → N `CanonicalTrafficRow` (uma por linha do
 * relatório). `source_hash` = hash da chave natural + valores de métrica, para
 * o upsert idempotente em `fact_traffic_daily`.
 */
import { createHash } from "node:crypto";

import type {
  CanonicalBatch,
  CanonicalTrafficRow,
  RawRecord,
} from "@/server/connectors/types";

import { ga4RunReportPageSchema } from "./schema";

function ga4DateToIso(v: string): string {
  // "20260829" -> "2026-08-29"
  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }
  return v;
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowHash(r: Omit<CanonicalTrafficRow, "sourceHash">): string {
  const key = [
    r.date,
    r.channel,
    r.source,
    r.medium,
    r.campaign,
    r.sessions,
    r.totalUsers,
    r.newUsers,
    r.engagedSessions,
    Math.round(r.avgEngagementTime * 100) / 100,
    r.keyEvents,
    r.conversionValue,
  ];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

export function mapToCanonical(
  stream: string,
  raw: RawRecord,
): CanonicalBatch {
  if (stream !== "report_daily") return { target: "traffic", rows: [] };

  const page = ga4RunReportPageSchema.parse(raw.payload);
  const dimIndex = new Map(page.dimensionHeaders.map((h, i) => [h.name, i]));
  const metIndex = new Map(page.metricHeaders.map((h, i) => [h.name, i]));

  const rows: CanonicalTrafficRow[] = (page.rows ?? []).map((row) => {
    const dim = (name: string) => {
      const i = dimIndex.get(name);
      return i === undefined ? "" : (row.dimensionValues[i]?.value ?? "");
    };
    const met = (name: string) => {
      const i = metIndex.get(name);
      return i === undefined ? 0 : num(row.metricValues[i]?.value);
    };

    const sessions = met("sessions");
    const engagementDuration = met("userEngagementDuration");

    const base = {
      date: ga4DateToIso(dim("date")),
      channel: dim("sessionDefaultChannelGroup") || "(other)",
      source: dim("sessionSource"),
      medium: dim("sessionMedium"),
      campaign: dim("sessionCampaignName"),
      sessions,
      totalUsers: met("totalUsers"),
      newUsers: met("newUsers"),
      engagedSessions: met("engagedSessions"),
      avgEngagementTime: sessions > 0 ? engagementDuration / sessions : 0,
      keyEvents: met("keyEvents"),
      conversionValue: met("totalRevenue"),
      dims: null as Record<string, unknown> | null,
    };

    return { ...base, sourceHash: rowHash(base) };
  });

  return { target: "traffic", rows };
}
