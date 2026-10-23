import {
  Ga4ConnectionCard,
  GoogleAdsConnectionCard,
  MetaAdsConnectionCard,
  RdStationCrmConnectionCard,
  RdStationMarketingConnectionCard,
} from "@/components/connection-cards";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/server/auth";
import { getGa4ConnectionForWorkspace } from "@/server/connectors/ga4/connection";
import { getConnectionForWorkspace } from "@/server/connectors/shared/connection";

export const metadata = { title: "Conexões — The Seed" };

/** Mensagens compartilhadas do fluxo OAuth (mesmos códigos p/ qualquer provider). */
const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Você recusou o acesso no Google.",
  missing_params: "Requisição inválida. Tente conectar de novo.",
  invalid_state: "Requisição inválida ou expirada. Tente conectar de novo.",
  workspace_mismatch: "A autorização não correspondeu a este workspace.",
  token_exchange_failed:
    "Falha ao trocar o código de autorização com o Google. Tente de novo.",
  no_refresh_token:
    "O Google não devolveu um refresh token. Revogue o acesso em myaccount.google.com/permissions e reconecte.",
  persist_failed: "Erro ao salvar a conexão.",
  not_configured:
    "Esta integração ainda não está configurada neste ambiente (faltam as credenciais do aplicativo).",
};

const GA4_ERROR_MESSAGES: Record<string, string> = {
  ...ERROR_MESSAGES,
  discovery_failed:
    "Conectado, mas a listagem de propriedades falhou. Verifique se a Google Analytics Admin API está habilitada e reconecte.",
};

const GOOGLE_ADS_ERROR_MESSAGES: Record<string, string> = {
  ...ERROR_MESSAGES,
  discovery_failed:
    "Conectado, mas a listagem de contas falhou. Veja o último erro no card do Google Ads (o acesso depende do nível de acesso do projeto Google Cloud e da permissão do usuário na conta) e reconecte.",
};

const META_ADS_ERROR_MESSAGES: Record<string, string> = {
  ...ERROR_MESSAGES,
  access_denied: "Você recusou o acesso na Meta.",
  token_exchange_failed:
    "Falha ao trocar o código de autorização com a Meta, ou a permissão ads_read não foi concedida. Tente de novo concedendo o acesso às contas de anúncios.",
  discovery_failed:
    "Conectado, mas a listagem das contas de anúncios falhou. Veja o último erro no card do Meta Ads (o usuário que autorizou precisa ter acesso a uma conta de anúncios e o app, a permissão ads_read) e reconecte.",
  not_configured:
    "O Meta Ads ainda não está configurado neste ambiente: faltam META_APP_ID e META_APP_SECRET (veja .env.example).",
};

// Mensagens de erro do OAuth genérico (`access_denied`, `missing_params`, ...)
// valem igual para os dois produtos RD Station; `discovery_failed` aqui só
// pode significar "o access_token não funcionou" (não há lista de contas a
// falhar — ver o discovery.ts de cada conector RD).
const RD_MARKETING_ERROR_MESSAGES: Record<string, string> = {
  ...ERROR_MESSAGES,
  discovery_failed:
    "Conectado, mas a confirmação da conta falhou. Veja o último erro no card do RD Station Marketing e reconecte.",
};

const RD_CRM_ERROR_MESSAGES: Record<string, string> = {
  ...ERROR_MESSAGES,
  discovery_failed:
    "Conectado, mas a confirmação da conta falhou. Veja o último erro no card do RD Station CRM e reconecte.",
};

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export default async function ConexoesPage(props: PageProps<"/conexoes">) {
  const { workspaceId } = await requireWorkspace();
  const searchParams = await props.searchParams;

  const [ga4State, adsState, metaState, rdMarketingState, rdCrmState] = await Promise.all([
    getGa4ConnectionForWorkspace(workspaceId),
    getConnectionForWorkspace(workspaceId, "google_ads"),
    getConnectionForWorkspace(workspaceId, "meta_ads"),
    getConnectionForWorkspace(workspaceId, "rd_station_marketing"),
    getConnectionForWorkspace(workspaceId, "rd_station_crm"),
  ]);

  // Banners de resultado do OAuth — o provider vem no prefixo do query param.
  const ga4Error = pickString(searchParams.ga4_error);
  const adsError = pickString(searchParams.google_ads_error);
  const metaError = pickString(searchParams.meta_ads_error);
  const rdMarketingError = pickString(searchParams.rd_station_marketing_error);
  const rdCrmError = pickString(searchParams.rd_station_crm_error);
  const count = pickString(searchParams.properties);
  const ga4Ok = pickString(searchParams.ga4_connected) !== null && count !== null;
  const adsOk =
    pickString(searchParams.google_ads_connected) !== null && count !== null;
  const metaOk = pickString(searchParams.meta_ads_connected) !== null && count !== null;
  const rdMarketingOk =
    pickString(searchParams.rd_station_marketing_connected) !== null;
  const rdCrmOk = pickString(searchParams.rd_station_crm_connected) !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Conexões" description="Fontes de dados do workspace." />

      {ga4Error ? (
        <div className="rounded-2xl border border-destructive-border bg-destructive-subtle px-5 py-4 text-sm">
          {GA4_ERROR_MESSAGES[ga4Error] ?? `Erro ao conectar o GA4: ${ga4Error}`}
        </div>
      ) : null}
      {adsError ? (
        <div className="rounded-2xl border border-destructive-border bg-destructive-subtle px-5 py-4 text-sm">
          {GOOGLE_ADS_ERROR_MESSAGES[adsError] ??
            `Erro ao conectar o Google Ads: ${adsError}`}
        </div>
      ) : null}
      {metaError ? (
        <div className="rounded-2xl border border-destructive-border bg-destructive-subtle px-5 py-4 text-sm">
          {META_ADS_ERROR_MESSAGES[metaError] ?? `Erro ao conectar o Meta Ads: ${metaError}`}
        </div>
      ) : null}
      {rdMarketingError ? (
        <div className="rounded-2xl border border-destructive-border bg-destructive-subtle px-5 py-4 text-sm">
          {RD_MARKETING_ERROR_MESSAGES[rdMarketingError] ??
            `Erro ao conectar o RD Station Marketing: ${rdMarketingError}`}
        </div>
      ) : null}
      {rdCrmError ? (
        <div className="rounded-2xl border border-destructive-border bg-destructive-subtle px-5 py-4 text-sm">
          {RD_CRM_ERROR_MESSAGES[rdCrmError] ??
            `Erro ao conectar o RD Station CRM: ${rdCrmError}`}
        </div>
      ) : null}
      {ga4Ok ? (
        <div className="rounded-2xl border border-success-border bg-success-subtle px-5 py-4 text-sm">
          GA4 conectado — {count}{" "}
          {count === "1" ? "propriedade encontrada" : "propriedades encontradas"}.
          Escolha qual analisar abaixo.
        </div>
      ) : null}
      {adsOk ? (
        <div className="rounded-2xl border border-success-border bg-success-subtle px-5 py-4 text-sm">
          Google Ads conectado — {count}{" "}
          {count === "1" ? "conta encontrada" : "contas encontradas"}. Escolha
          qual analisar abaixo.
        </div>
      ) : null}
      {metaOk ? (
        <div className="rounded-2xl border border-success-border bg-success-subtle px-5 py-4 text-sm">
          Meta Ads conectado — {count}{" "}
          {count === "1" ? "conta de anúncios encontrada" : "contas de anúncios encontradas"}.
          Escolha qual analisar abaixo.
        </div>
      ) : null}
      {rdMarketingOk ? (
        <div className="rounded-2xl border border-success-border bg-success-subtle px-5 py-4 text-sm">
          RD Station Marketing conectado.
        </div>
      ) : null}
      {rdCrmOk ? (
        <div className="rounded-2xl border border-success-border bg-success-subtle px-5 py-4 text-sm">
          RD Station CRM conectado.
        </div>
      ) : null}

      <div className="space-y-3">
        <Ga4ConnectionCard state={ga4State} />
        <GoogleAdsConnectionCard state={adsState} />
        <MetaAdsConnectionCard state={metaState} />
        <RdStationMarketingConnectionCard state={rdMarketingState} />
        <RdStationCrmConnectionCard state={rdCrmState} />
      </div>
    </div>
  );
}
