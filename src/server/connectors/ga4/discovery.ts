/**
 * Descoberta de propriedades GA4 (bloco B1).
 *
 * Usa a Google Analytics Admin API (v1beta), `fetch` cru + Bearer token.
 * `listAccounts` lista todas as propriedades acessíveis pela credencial;
 * `fetchPropertyDetails` busca fuso/moeda de UMA propriedade (chamado pelo B2
 * só para a propriedade selecionada, evitando N chamadas no connect).
 */
import { z } from "zod";

import type {
  AccessContext,
  DiscoveredAccount,
} from "@/server/connectors/types";

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const PAGE_SIZE = 200;
const MAX_PAGES = 10;

async function adminGet(
  path: string,
  accessToken: string,
): Promise<unknown> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? "token inválido/expirado"
        : res.status === 403
          ? "Analytics Admin API não habilitada no projeto, ou a conta não tem acesso a nenhuma propriedade GA4"
          : "";
    throw new Error(
      `GA4 Admin API ${res.status} em ${path}${hint ? ` — ${hint}` : ""}${
        body ? `: ${body.slice(0, 300)}` : ""
      }`,
    );
  }
  return res.json();
}

const propertySummarySchema = z.object({
  property: z.string(), // "properties/123456789"
  displayName: z.string(),
  propertyType: z.string().optional(),
});
const accountSummarySchema = z.object({
  account: z.string().optional(),
  displayName: z.string().optional(),
  propertySummaries: z.array(propertySummarySchema).optional(),
});
const accountSummariesResponseSchema = z.object({
  accountSummaries: z.array(accountSummarySchema).optional(),
  nextPageToken: z.string().optional(),
});

/**
 * Lista as propriedades GA4 visíveis para a credencial. Uma `DiscoveredAccount`
 * por propriedade. `timezone`/`currency` vêm null aqui (preenchidos na seleção,
 * via `fetchPropertyDetails`).
 */
export async function listAccounts(
  access: AccessContext,
): Promise<DiscoveredAccount[]> {
  const out: DiscoveredAccount[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) qs.set("pageToken", pageToken);

    const parsed = accountSummariesResponseSchema.parse(
      await adminGet(`/accountSummaries?${qs.toString()}`, access.accessToken),
    );

    for (const acc of parsed.accountSummaries ?? []) {
      for (const prop of acc.propertySummaries ?? []) {
        if (seen.has(prop.property)) continue;
        seen.add(prop.property);
        out.push({
          externalId: prop.property,
          displayName: acc.displayName
            ? `${prop.displayName} — ${acc.displayName}`
            : prop.displayName,
          timezone: null,
          currency: null,
        });
      }
    }

    if (!parsed.nextPageToken) break;
    pageToken = parsed.nextPageToken;
  }

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
}

const propertyDetailsSchema = z.object({
  timeZone: z.string().optional(),
  currencyCode: z.string().optional(),
});

/** Busca fuso e moeda de uma propriedade. `externalId` = "properties/123456789". */
export async function fetchPropertyDetails(
  access: AccessContext,
  externalId: string,
): Promise<{ timezone: string | null; currency: string | null }> {
  const parsed = propertyDetailsSchema.parse(
    await adminGet(`/${externalId}`, access.accessToken),
  );
  return {
    timezone: parsed.timeZone ?? null,
    currency: parsed.currencyCode ?? null,
  };
}
