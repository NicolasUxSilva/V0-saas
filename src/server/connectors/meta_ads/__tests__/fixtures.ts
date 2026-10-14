/**
 * Fixtures do conector Meta Ads. Formas copiadas da Graph API: números como STRING,
 * campos zerados OMITIDOS, `paging.next` com o `access_token` ecoado na query.
 */

export const TOKEN = "EAAB-token-secreto-de-teste";

export function insightRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    campaign_id: "120001",
    campaign_name: "Leads — servidores",
    objective: "OUTCOME_LEADS",
    date_start: "2026-10-01",
    date_stop: "2026-10-01",
    account_currency: "BRL",
    impressions: "1000",
    reach: "800",
    frequency: "1.25",
    clicks: "40",
    inline_link_clicks: "25",
    spend: "123.45",
    actions: [
      { action_type: "link_click", value: "25" },
      { action_type: "lead", value: "3" },
      // sub-tipos do MESMO evento: não podem ser somados ao agregado `lead`
      { action_type: "offsite_conversion.fb_pixel_lead", value: "3" },
      { action_type: "onsite_conversion.lead_grouped", value: "3" },
    ],
    ...over,
  };
}

export function page(
  rows: Record<string, unknown>[],
  paging?: { after?: string; next?: boolean },
): Record<string, unknown> {
  return {
    data: rows,
    ...(paging
      ? {
          paging: {
            cursors: { before: "BEF", after: paging.after ?? "AFT" },
            // a Graph API ecoa o token na URL da próxima página
            ...(paging.next ? { next: `https://graph.facebook.com/v25.0/act_1/insights?access_token=${TOKEN}&after=${paging.after ?? "AFT"}` } : {}),
          },
        }
      : {}),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function graphError(
  code: number,
  message: string,
  extra: { subcode?: number; status?: number } = {},
): Response {
  return jsonResponse(
    {
      error: {
        message,
        type: "OAuthException",
        code,
        ...(extra.subcode !== undefined ? { error_subcode: extra.subcode } : {}),
        fbtrace_id: "FBTRACE123",
      },
    },
    extra.status ?? 400,
  );
}
