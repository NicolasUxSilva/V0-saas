/**
 * Descoberta de contas do Google Ads (bloco G2).
 *
 * Duas etapas, ambas na Google Ads API (REST — ver `./http`):
 *   1. `customers:listAccessibleCustomers` → resource names das contas visíveis
 *      pela credencial (NÃO usa `login-customer-id`).
 *   2. para cada uma, `GoogleAdsService.search` com GAQL `FROM customer` →
 *      descriptive name / currency / time zone / manager.
 *
 * O cliente HTTP (versão da API, headers, `developer-token`, retry) vive em
 * `./http` e é compartilhado com a extração do G3. Sem
 * `GOOGLE_ADS_DEVELOPER_TOKEN`, `listAccounts` lança `DeveloperTokenMissingError`.
 */
import { z } from "zod";

import type {
  AccessContext,
  DiscoveredAccount,
} from "@/server/connectors/types";

import { adsFetch } from "./http";

// Re-export: o callback OAuth e os testes tratam este erro por nome.
export { DeveloperTokenMissingError, GOOGLE_ADS_API_VERSION } from "./http";

const CUSTOMER_FIELDS =
  "customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager";

const listAccessibleSchema = z.object({
  resourceNames: z.array(z.string()).optional(), // ["customers/1234567890", ...]
});

const customerRowSchema = z.object({
  customer: z.object({
    id: z.string().optional(),
    descriptiveName: z.string().optional(),
    currencyCode: z.string().optional(),
    timeZone: z.string().optional(),
    manager: z.boolean().optional(),
  }),
});
const searchResponseSchema = z.object({
  results: z.array(customerRowSchema).optional(),
});

/** Lista as contas do Google Ads visíveis para a credencial. */
export async function listAccounts(
  access: AccessContext,
): Promise<DiscoveredAccount[]> {
  const loginCustomerId =
    typeof access.meta?.loginCustomerId === "string"
      ? access.meta.loginCustomerId
      : undefined;

  // 1) contas acessíveis pela credencial
  const listed = listAccessibleSchema.parse(
    await adsFetch(
      "/customers:listAccessibleCustomers",
      { method: "GET" },
      access.accessToken,
      loginCustomerId,
    ),
  );
  const ids = (listed.resourceNames ?? [])
    .map((rn) => rn.split("/")[1])
    .filter((v): v is string => Boolean(v));

  // 2) detalhes de cada conta (best-effort — se uma falhar, lista pelo id)
  const out: DiscoveredAccount[] = [];
  for (const id of ids) {
    try {
      const detail = searchResponseSchema.parse(
        await adsFetch(
          `/customers/${id}/googleAds:search`,
          {
            method: "POST",
            body: JSON.stringify({
              query: `SELECT ${CUSTOMER_FIELDS} FROM customer`,
            }),
          },
          access.accessToken,
          loginCustomerId,
        ),
      );
      const c = detail.results?.[0]?.customer;
      const name = c?.descriptiveName?.trim();
      out.push({
        externalId: `customers/${id}`,
        displayName: name
          ? `${name}${c?.manager ? " (Manager)" : ""}`
          : `customers/${id}`,
        timezone: c?.timeZone ?? null,
        currency: c?.currencyCode ?? null,
      });
    } catch {
      out.push({
        externalId: `customers/${id}`,
        displayName: `customers/${id}`,
        timezone: null,
        currency: null,
      });
    }
  }

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
}
