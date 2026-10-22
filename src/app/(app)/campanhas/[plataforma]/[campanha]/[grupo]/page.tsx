import Link from "next/link";
import { notFound } from "next/navigation";

import { CampaignDetailView } from "@/components/campaigns/detail";
import { DiagnosticsDigest } from "@/components/campaigns/diagnostics-digest";
import { CampaignFiltersForm } from "@/components/campaigns/filters";
import type { AdPlatform } from "@/lib/campaigns";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspace } from "@/server/auth";
import { REFERENCE_TIMEZONE } from "@/server/campaigns/compose";
import { GROUP_LEVEL_LABEL, PLATFORM_LABEL } from "@/server/campaigns/metrics";
import { diagnosticsForCampaign } from "@/server/campaigns/diagnostics/view";
import { filtersToQuery, parseFilters } from "@/server/campaigns/period";
import { readAdGroupDetail, readCampaignDiagnostics } from "@/server/campaigns/read";

export const metadata = { title: "Grupo ou conjunto — v0-saas" };

const isPlatform = (v: string): v is AdPlatform => v === "google_ads" || v === "meta_ads";

export default async function GrupoPage(props: PageProps<"/campanhas/[plataforma]/[campanha]/[grupo]">) {
  const { workspaceId } = await requireWorkspace();
  const { plataforma, campanha, grupo } = await props.params;
  if (!isPlatform(plataforma)) notFound();

  const { filters, warnings } = parseFilters(await props.searchParams, todayInTimeZone(REFERENCE_TIMEZONE));
  // autorização no servidor: a leitura é escopada pelo workspace da sessão
  const now = new Date();
  const [detail, diagnostics] = await Promise.all([
    readAdGroupDetail({
      workspaceId,
      platform: plataforma,
      campaignId: campanha,
      adGroupId: grupo,
      filters,
      filterWarnings: warnings,
      now,
    }),
    readCampaignDiagnostics({ workspaceId, filters: { ...filters, platform: plataforma }, now }),
  ]);
  if (!detail || !detail.group) notFound();

  const query = filtersToQuery(filters, { page: 1, platform: "all" });
  const levelLabel = GROUP_LEVEL_LABEL[plataforma].one;
  const diagnosticsQuery = new URLSearchParams(
    filtersToQuery(filters, { page: 1, status: null, onlyCostWithoutResult: false, sort: "cost", platform: plataforma }).slice(1),
  );
  diagnosticsQuery.set("campanha", campanha);
  const diagnosticsHref = `/campanhas/diagnosticos?${diagnosticsQuery.toString()}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <nav className="text-xs text-muted-foreground" aria-label="Navegação">
          <Link href={`/campanhas${filtersToQuery(filters, { page: 1 })}`} className="hover:underline">
            Campanhas
          </Link>{" "}
          ›{" "}
          <Link href={`/campanhas/${plataforma}/${encodeURIComponent(campanha)}${query}`} className="hover:underline">
            {detail.campaign.name}
          </Link>{" "}
          › {levelLabel}
        </nav>
        <h1 className="text-xl font-semibold tracking-tight">{detail.group.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[PLATFORM_LABEL[plataforma], levelLabel, detail.group.statusLabel, detail.group.typeLabel, `ID ${detail.group.id}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <CampaignFiltersForm
        action={`/campanhas/${plataforma}/${encodeURIComponent(campanha)}/${encodeURIComponent(grupo)}`}
        filters={detail.filters}
        statusOptions={[]}
        showPlatform={false}
        showListOptions={false}
      />

      <DiagnosticsDigest
        title="Diagnóstico deste item"
        diagnostics={diagnosticsForCampaign(diagnostics, plataforma, campanha, grupo)}
        href={diagnosticsHref}
        limit={5}
        compact={false}
      />

      <CampaignDetailView detail={detail} />
    </div>
  );
}
