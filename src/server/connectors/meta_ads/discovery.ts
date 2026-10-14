/**
 * Descoberta das contas de anúncios do Meta Ads: `GET /me/adaccounts` (as contas a que o
 * usuário que autorizou tem acesso), paginado por cursor.
 *
 * `externalId` é o id COM o prefixo `act_` (é o que a Marketing API pede no caminho de
 * `/insights`). Conta que não está ativa aparece com o motivo no nome — o usuário a vê,
 * mas a escolha continua dele.
 */
import type { AccessContext, DiscoveredAccount } from "@/server/connectors/types";

import { metaFetch } from "./http";
import { adAccountsPageSchema } from "./schema";

const FIELDS = "id,account_id,name,currency,timezone_name,account_status";
const PAGE_LIMIT = 100;
/** Teto de segurança contra paginação infinita (100 × 20 = 2.000 contas). */
const MAX_PAGES = 20;

/** `account_status` da Marketing API → sufixo legível. Ativa (1) não leva sufixo. */
const STATUS_SUFFIX: Record<number, string> = {
  2: "desativada",
  3: "pagamento pendente",
  7: "em análise de risco",
  8: "liquidação pendente",
  9: "em carência de pagamento",
  100: "encerramento pendente",
  101: "encerrada",
};

export function actAccountId(id: string, accountId?: string): string {
  if (id.startsWith("act_")) return id;
  return `act_${accountId ?? id}`;
}

export async function listAccounts(access: AccessContext): Promise<DiscoveredAccount[]> {
  const out: DiscoveredAccount[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const parsed = adAccountsPageSchema.parse(
      await metaFetch("/me/adaccounts", {
        accessToken: access.accessToken,
        params: { fields: FIELDS, limit: String(PAGE_LIMIT), ...(after ? { after } : {}) },
      }),
    );

    for (const a of parsed.data) {
      const externalId = actAccountId(a.id, a.account_id);
      const name = a.name?.trim() || externalId;
      const suffix = a.account_status !== undefined ? STATUS_SUFFIX[a.account_status] : undefined;
      out.push({
        externalId,
        displayName: suffix ? `${name} (${suffix})` : name,
        timezone: a.timezone_name ?? null,
        currency: a.currency ?? null,
      });
    }

    // a próxima página é pedida pelo CURSOR, nunca pela URL `paging.next` (ela carrega o token)
    after = parsed.paging?.next ? parsed.paging.cursors?.after : undefined;
    if (!after) break;
  }

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
}
