/**
 * "Descoberta" do RD Station CRM (bloco RD-1B/RD-1D).
 *
 * Mesma situação do RD Station Marketing (ver
 * `connectors/rd_station_marketing/discovery.ts`): uma autorização OAuth do
 * CRM aponta para exatamente uma conta; não há um recurso equivalente ao
 * `ListAccessibleCustomers` do Google Ads para listar contas do CRM.
 *
 * `listAccounts` faz uma chamada real e leve — `GET /crm/v2/pipelines` — para
 * confirmar que o token funciona (é um recurso sempre disponível, não
 * dependente de plano, ao contrário dos endpoints de Análise do Marketing) e
 * devolve uma única "conta" sintética representando a conexão.
 */
import { z } from "zod";

import type { AccessContext, DiscoveredAccount } from "@/server/connectors/types";

import { rdCrmFetch } from "./http";

const pipelinesPingSchema = z.object({
  data: z.array(z.unknown()).optional(),
});

export const SINGLE_ACCOUNT_EXTERNAL_ID = "account";

export async function listAccounts(
  access: AccessContext,
): Promise<DiscoveredAccount[]> {
  pipelinesPingSchema.parse(
    await rdCrmFetch("/pipelines", { method: "GET" }, access.accessToken),
  );

  return [
    {
      externalId: SINGLE_ACCOUNT_EXTERNAL_ID,
      displayName: "RD Station CRM",
      // Timezone/moeda: `deals` não traz nenhum dos dois (ver mapping.ts) —
      // `null` é o valor honesto.
      timezone: null,
      currency: null,
    },
  ];
}
