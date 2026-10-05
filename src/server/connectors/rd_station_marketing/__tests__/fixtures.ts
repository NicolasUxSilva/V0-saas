/**
 * Fábricas de payload sintético da API do RD Station Marketing para os testes
 * do conector — shape de `GET /platform/analytics/conversions`.
 *
 * O shape é o da API REAL (chaves e tipos capturados da conta piloto em
 * 2026-10-04: 45 respostas diárias × 2 ativos), NÃO o da documentação oficial,
 * que publica `asset_type` e `conversions_count` por linha — nomes que a API não
 * devolve (ela devolve `assets_type` e `conversion_count`). As fixtures antigas
 * seguiam a doc, e foi assim que o mapper passou a ler campos inexistentes sem
 * que nenhum teste reclamasse. Só os VALORES aqui são sintéticos.
 */
export interface FakeAssetOpts {
  assetId?: string | number;
  assetIdentifier?: string;
  /** `assets_type` da linha — na API real: "LandingPage" | "Forms" | "Popup". */
  assetsType?: string;
  /** Na API real vem `number` quando 0 e `string` ("2", "6") quando > 0. */
  visitsCount?: string | number | null;
  /** `conversion_count` da linha (a doc diz `conversions_count`, mas a API não usa). */
  conversionCount?: string | number | null;
  conversionRate?: number | null;
  omitAssetId?: boolean;
}

export function fakeAssetRow(opts: FakeAssetOpts = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    asset_identifier: opts.assetIdentifier ?? "LP Black Friday",
    assets_type: opts.assetsType ?? "LandingPage",
    visits_count: opts.visitsCount === undefined ? "1000" : opts.visitsCount,
    conversion_count: opts.conversionCount === undefined ? 50 : opts.conversionCount,
    conversion_rate: opts.conversionRate === undefined ? 0.05 : opts.conversionRate,
    asset_created_at: "2026-07-14T12:32:13.944-03:00",
    asset_updated_at: "2026-08-03T16:50:54.470-03:00",
  };
  if (!opts.omitAssetId) row.asset_id = opts.assetId ?? "111";
  return row;
}

export function fakeConversionsResponse(
  day: string,
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    account_id: 123,
    query_date: { start_date: day, end_date: day },
    // No TOPO da resposta real `assets_type` é a LISTA dos tipos de ativo (array);
    // dentro de cada linha o mesmo nome é uma string. Reproduzido aqui de
    // propósito: os dois níveis com o mesmo nome e tipos diferentes têm que
    // coexistir no schema.
    assets_type: ["LandingPage", "Forms", "Popup"],
    conversions: rows,
  };
}
