/**
 * "Descoberta" do RD Station Marketing (bloco RD-1B).
 *
 * A API do RD Station Marketing NÃO tem um conceito equivalente ao
 * `ListAccessibleCustomers` do Google Ads ou às propriedades do GA4: uma
 * autorização OAuth sempre aponta para EXATAMENTE UMA conta (quem autoriza
 * escolhe a conta na tela de consentimento do RD; não há lista de contas para
 * escolher depois, nem um recurso REST "whoami"/"account" documentado em
 * developers.rdstation.com). Confirmado na auditoria — não é invenção.
 *
 * Por isso `listAccounts` aqui não lista nada: faz UMA chamada real e leve a
 * um endpoint que existe de fato (`GET /platform/segmentations` — não exige
 * plano específico, ao contrário dos endpoints de Análise do RD-1C) só para
 * confirmar que o access_token funciona, e devolve uma única "conta" sintética
 * que representa esta conexão. Isso reaproveita o mecanismo genérico de
 * `connection_properties` (1 linha, `isSelected: true` automático) sem precisar
 * de nenhum seletor de conta na UI.
 */
import { z } from "zod";

import type { AccessContext, DiscoveredAccount } from "@/server/connectors/types";

import { rdMarketingFetch } from "./http";

const segmentationsPingSchema = z.object({
  segmentations: z.array(z.unknown()).optional(),
});

/** Único "externalId" possível — não há conta real para identificar por id. */
export const SINGLE_ACCOUNT_EXTERNAL_ID = "account";

export async function listAccounts(
  access: AccessContext,
): Promise<DiscoveredAccount[]> {
  // Só confirma que o token é válido; o resultado em si não é usado — é o
  // próprio sucesso/falha da chamada que confirma a conexão (RD-1B).
  segmentationsPingSchema.parse(
    await rdMarketingFetch(
      "/platform/segmentations",
      { method: "GET" },
      access.accessToken,
    ),
  );

  return [
    {
      externalId: SINGLE_ACCOUNT_EXTERNAL_ID,
      displayName: "RD Station Marketing",
      // Timezone/moeda: a API não expõe isso em nenhum endpoint auditado —
      // `null` é o valor honesto (ausência ≠ inventar um fuso/moeda).
      timezone: null,
      currency: null,
    },
  ];
}
