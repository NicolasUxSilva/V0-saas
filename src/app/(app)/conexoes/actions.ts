"use server";

/**
 * Server actions da tela Conexões.
 *  - selecionarPropriedade / desconectar / atualizarDados → GA4 (B2/B3)
 *  - selecionarContaGoogleAds / desconectarGoogleAds → Google Ads (G2)
 *  - importarDadosGoogleAds → Google Ads (G3 — sync campanha × dia)
 *  - desconectarRdStationMarketing / importarDadosRdStationMarketing → RD-1
 *  - desconectarRdStationCrm / importarDadosRdStationCrm → RD-1
 *
 * RD Station (Marketing e CRM) não tem seleção de conta: uma autorização
 * aponta para exatamente uma conta (ver o discovery.ts de cada conector RD),
 * já auto-selecionada pelo callback genérico — por isso não existe
 * `selecionarContaRdStation*` aqui, ao contrário do GA4/Google Ads.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/server/auth";
import { revokeToken } from "@/server/connectors/ga4/auth";
import { getGa4ConnectionForWorkspace } from "@/server/connectors/ga4/connection";
import { fetchPropertyDetails } from "@/server/connectors/ga4/discovery";
import { getValidGa4AccessToken } from "@/server/connectors/ga4/token";
import { revokeToken as revokeRdCrmToken } from "@/server/connectors/rd_station_crm/oauth";
import { revokeToken as revokeRdMarketingToken } from "@/server/connectors/rd_station_marketing/oauth";
import { getConnectionForWorkspace } from "@/server/connectors/shared/connection";
import { decryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import { connectionProperties, connections } from "@/server/db/schema";
import { runSync, type SyncResult } from "@/server/sync/run-sync";

export async function selecionarPropriedade(externalId: string): Promise<void> {
  const { workspaceId } = await requireWorkspace();
  const state = await getGa4ConnectionForWorkspace(workspaceId);
  if (!state) throw new Error("Nenhuma conexão GA4 neste workspace.");

  const target = state.properties.find((p) => p.externalId === externalId);
  if (!target) throw new Error("Propriedade não encontrada nesta conexão.");

  await db.transaction(async (tx) => {
    await tx
      .update(connectionProperties)
      .set({ isSelected: false })
      .where(eq(connectionProperties.connectionId, state.connection.id));
    await tx
      .update(connectionProperties)
      .set({ isSelected: true })
      .where(eq(connectionProperties.id, target.id));
  });

  // best-effort: preenche fuso/moeda da propriedade escolhida
  try {
    const accessToken = await getValidGa4AccessToken(state.connection.id);
    const details = await fetchPropertyDetails({ accessToken }, externalId);
    await db
      .update(connectionProperties)
      .set({ timezone: details.timezone, currency: details.currency })
      .where(eq(connectionProperties.id, target.id));
  } catch {
    // não bloqueia a seleção — o B3 preenche no 1º sync
  }

  revalidatePath("/conexoes");
}

export async function desconectar(): Promise<void> {
  const { workspaceId } = await requireWorkspace();

  const [conn] = await db
    .select({
      id: connections.id,
      refreshTokenEnc: connections.refreshTokenEnc,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "ga4"),
      ),
    )
    .limit(1);
  if (!conn) return;

  if (conn.refreshTokenEnc) {
    try {
      await revokeToken(decryptSecret(conn.refreshTokenEnc));
    } catch {
      // best-effort
    }
  }

  await db.delete(connections).where(eq(connections.id, conn.id)); // cascade -> connection_properties
  revalidatePath("/conexoes");
}

// ── Google Ads (G2 — conexão + seleção de conta; sem sync ainda) ─────

export async function selecionarContaGoogleAds(externalId: string): Promise<void> {
  const { workspaceId } = await requireWorkspace();
  const state = await getConnectionForWorkspace(workspaceId, "google_ads");
  if (!state) throw new Error("Nenhuma conexão Google Ads neste workspace.");

  const target = state.properties.find((p) => p.externalId === externalId);
  if (!target) throw new Error("Conta não encontrada nesta conexão.");

  // fuso/moeda já vieram da discovery — só marca a seleção (exatamente 1).
  await db.transaction(async (tx) => {
    await tx
      .update(connectionProperties)
      .set({ isSelected: false })
      .where(eq(connectionProperties.connectionId, state.connection.id));
    await tx
      .update(connectionProperties)
      .set({ isSelected: true })
      .where(eq(connectionProperties.id, target.id));
  });

  revalidatePath("/conexoes");
}

export async function importarDadosGoogleAds(): Promise<SyncResult> {
  const { workspaceId } = await requireWorkspace();
  const state = await getConnectionForWorkspace(workspaceId, "google_ads");
  if (!state) throw new Error("Nenhuma conexão Google Ads neste workspace.");
  if (!state.properties.some((p) => p.isSelected)) {
    throw new Error("Selecione uma conta do Google Ads antes de importar.");
  }

  const result = await runSync({ connectionId: state.connection.id });

  // `runSync` já dispara o motor de análise no fim (inalterado no G3 — o
  // desacoplamento p/ nível-workspace é o G4). Reflete nas duas telas.
  revalidatePath("/conexoes");
  revalidatePath("/diagnostico");
  return result;
}

export async function desconectarGoogleAds(): Promise<void> {
  const { workspaceId } = await requireWorkspace();

  const [conn] = await db
    .select({
      id: connections.id,
      refreshTokenEnc: connections.refreshTokenEnc,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "google_ads"),
      ),
    )
    .limit(1);
  if (!conn) return;

  if (conn.refreshTokenEnc) {
    try {
      await revokeToken(decryptSecret(conn.refreshTokenEnc));
    } catch {
      // best-effort
    }
  }

  await db.delete(connections).where(eq(connections.id, conn.id)); // cascade -> connection_properties
  revalidatePath("/conexoes");
}

export async function atualizarDados(): Promise<SyncResult> {
  const { workspaceId } = await requireWorkspace();
  const state = await getGa4ConnectionForWorkspace(workspaceId);
  if (!state) throw new Error("Nenhuma conexão GA4 neste workspace.");
  if (!state.properties.some((p) => p.isSelected)) {
    throw new Error("Selecione uma propriedade GA4 antes de sincronizar.");
  }

  const result = await runSync({ connectionId: state.connection.id });

  // o sync já rodou o motor de análise (C5) — reflete nas duas telas
  revalidatePath("/conexoes");
  revalidatePath("/diagnostico");
  return result;
}

// ── RD Station Marketing (RD-1 — conexão sem seletor de conta + sync) ────

export async function importarDadosRdStationMarketing(): Promise<SyncResult> {
  const { workspaceId } = await requireWorkspace();
  const state = await getConnectionForWorkspace(workspaceId, "rd_station_marketing");
  if (!state) throw new Error("Nenhuma conexão RD Station Marketing neste workspace.");

  const result = await runSync({ connectionId: state.connection.id });

  revalidatePath("/conexoes");
  revalidatePath("/diagnostico");
  return result;
}

export async function desconectarRdStationMarketing(): Promise<void> {
  const { workspaceId } = await requireWorkspace();

  const [conn] = await db
    .select({
      id: connections.id,
      refreshTokenEnc: connections.refreshTokenEnc,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "rd_station_marketing"),
      ),
    )
    .limit(1);
  if (!conn) return;

  if (conn.refreshTokenEnc) {
    try {
      await revokeRdMarketingToken(decryptSecret(conn.refreshTokenEnc), "refresh_token");
    } catch {
      // best-effort
    }
  }

  await db.delete(connections).where(eq(connections.id, conn.id)); // cascade -> connection_properties
  revalidatePath("/conexoes");
}

// ── RD Station CRM (RD-1 — conexão sem seletor de conta + sync) ─────────

export async function importarDadosRdStationCrm(): Promise<SyncResult> {
  const { workspaceId } = await requireWorkspace();
  const state = await getConnectionForWorkspace(workspaceId, "rd_station_crm");
  if (!state) throw new Error("Nenhuma conexão RD Station CRM neste workspace.");

  const result = await runSync({ connectionId: state.connection.id });

  revalidatePath("/conexoes");
  revalidatePath("/diagnostico");
  return result;
}

export async function desconectarRdStationCrm(): Promise<void> {
  const { workspaceId } = await requireWorkspace();

  const [conn] = await db
    .select({
      id: connections.id,
      refreshTokenEnc: connections.refreshTokenEnc,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "rd_station_crm"),
      ),
    )
    .limit(1);
  if (!conn) return;

  if (conn.refreshTokenEnc) {
    // best-effort: não há endpoint de revogação documentado para o CRM v2
    // (ver connectors/rd_station_crm/oauth.ts) — `revokeRdCrmToken` é um no-op.
    try {
      await revokeRdCrmToken(decryptSecret(conn.refreshTokenEnc));
    } catch {
      // best-effort
    }
  }

  await db.delete(connections).where(eq(connections.id, conn.id)); // cascade -> connection_properties
  revalidatePath("/conexoes");
}
