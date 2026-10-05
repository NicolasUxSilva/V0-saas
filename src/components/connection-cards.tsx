/**
 * Cards da tela Conexões.
 *
 * GA4: "não conectado" (botão que inicia o OAuth — B1) ou "conectado" (conta,
 * seletor de propriedade, "Atualizar dados", histórico de sync, reconectar,
 * desconectar).
 *
 * Google Ads (G2/G3): "não conectado" / "conectado" (conta, contas descobertas,
 * seletor de conta, "Importar dados" — sync campanha × dia do G3 —, histórico
 * de sync, reconectar, desconectar).
 *
 * RD Station Marketing / RD Station CRM (RD-1): "não conectado" / "conectado"
 * (conta única e implícita — sem seletor, ver o discovery.ts de cada conector RD
 * —, "Importar dados", histórico de sync, reconectar, desconectar). Os dois
 * compartilham o mesmo layout simples via `RdSingleAccountCard`.
 *
 * Meta Ads: apenas estrutura visível ("Em breve").
 */
import { BarChart3, Megaphone, Share2, Target, Users2 } from "lucide-react";
import type { ComponentType } from "react";

import {
  desconectar,
  desconectarGoogleAds,
  desconectarRdStationCrm,
  desconectarRdStationMarketing,
  importarDadosRdStationCrm,
  importarDadosRdStationMarketing,
} from "@/app/(app)/conexoes/actions";
import { GoogleAdsAccountPicker } from "@/components/google-ads-account-picker";
import { GoogleAdsSyncButton } from "@/components/google-ads-sync-button";
import { PropertyPicker } from "@/components/property-picker";
import { RdStationSyncButton } from "@/components/rd-station-sync-button";
import { PartialState } from "@/components/states";
import { SyncButton } from "@/components/sync-button";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import type { Ga4ConnectionView } from "@/server/connectors/ga4/connection";
import type { ConnectionView } from "@/server/connectors/shared/connection";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: Ga4ConnectionView["connection"]["status"] }) {
  if (status === "connected") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/30 bg-emerald-50 text-emerald-700"
      >
        Conectado
      </Badge>
    );
  }
  if (status === "reauth_required") {
    return (
      <Badge
        variant="outline"
        className="border-amber-600/30 bg-amber-50 text-amber-800"
      >
        Reautorização necessária
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-red-600/30 bg-red-50 text-red-700"
    >
      Erro
    </Badge>
  );
}

export function Ga4ConnectionCard({ state }: { state: Ga4ConnectionView | null }) {
  if (!state) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <BarChart3 className="size-5 text-muted-foreground" aria-hidden />
            <CardTitle className="flex-1">Google Analytics 4</CardTitle>
            <Badge variant="outline">Não conectado</Badge>
          </div>
          <CardDescription>
            Importa sessões, usuários, engajamento e key events por canal /
            origem / campanha, dos últimos 180 dias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* navegação de página inteira para a rota que redireciona ao Google */}
          <a
            href="/api/oauth/ga4/start"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Conectar GA4
          </a>
        </CardContent>
      </Card>
    );
  }

  const { connection, properties, recentSyncRuns } = state;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <BarChart3 className="size-5 text-muted-foreground" aria-hidden />
          <CardTitle className="flex-1">Google Analytics 4</CardTitle>
          <StatusBadge status={connection.status} />
        </div>
        <CardDescription>
          Conta: {connection.externalAccountEmail ?? "—"} ·{" "}
          {properties.length}{" "}
          {properties.length === 1 ? "propriedade" : "propriedades"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {connection.status === "reauth_required" ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            O acesso ao GA4 expirou ou foi revogado. Reconecte a conta.
          </div>
        ) : null}
        {connection.lastError ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-muted-foreground">
            Último erro: {connection.lastError}
          </div>
        ) : null}
        {recentSyncRuns[0]?.status === "partial" ? (
          <PartialState description="A última sincronização atingiu o limite de linhas e ficou parcial. Rode 'Atualizar dados' de novo para completar o período." />
        ) : null}

        <PropertyPicker properties={properties} />

        <div className="space-y-2">
          <SyncButton disabled={!properties.some((p) => p.isSelected)} />
          <p className="text-xs text-muted-foreground">
            Última sincronização:{" "}
            {connection.lastSyncedAt
              ? formatRelativeTime(connection.lastSyncedAt.toISOString())
              : "nunca"}
          </p>
        </div>

        {recentSyncRuns.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Histórico
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {recentSyncRuns.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  <span
                    className={cn(
                      "inline-block size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                      run.status === "success" && "bg-emerald-500",
                      run.status === "partial" && "bg-amber-500",
                      run.status === "failed" && "bg-red-500",
                      run.status === "running" && "bg-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span>{formatRelativeTime(run.startedAt.toISOString())}</span>
                  <span>· {run.trigger === "initial" ? "1ª carga" : "manual"}</span>
                  {run.periodStart && run.periodEnd ? (
                    <span>
                      · {run.periodStart} a {run.periodEnd}
                    </span>
                  ) : null}
                  {run.status === "success" || run.status === "partial" ? (
                    <span>
                      · {run.rowsWritten ?? 0} gravada(s) / {run.rowsIn ?? 0}{" "}
                      lida(s)
                    </span>
                  ) : null}
                  {run.status === "failed" && run.error ? (
                    <span className="text-red-700">
                      · {run.error.slice(0, 120)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        <a
          href="/api/oauth/ga4/start"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Reconectar
        </a>
        <form action={desconectar}>
          <Button type="submit" variant="ghost" size="sm">
            Desconectar
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          Remove a conexão e as propriedades. É possível reconectar depois.
        </span>
      </CardFooter>
    </Card>
  );
}

export function GoogleAdsConnectionCard({
  state,
}: {
  state: ConnectionView | null;
}) {
  if (!state) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Megaphone className="size-5 text-muted-foreground" aria-hidden />
            <CardTitle className="flex-1">Google Ads</CardTitle>
            <Badge variant="outline">Não conectado</Badge>
          </div>
          <CardDescription>
            Conecta a conta do Google Ads para, mais adiante, cruzar
            investimento, impressões e status de campanha com a queda de tráfego
            pago do GA4.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* navegação de página inteira para a rota que redireciona ao Google */}
          <a
            href="/api/oauth/google_ads/start"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Conectar Google Ads
          </a>
        </CardContent>
      </Card>
    );
  }

  const { connection, properties: accounts, recentSyncRuns } = state;
  const selected = accounts.find((a) => a.isSelected);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Megaphone className="size-5 text-muted-foreground" aria-hidden />
          <CardTitle className="flex-1">Google Ads</CardTitle>
          <StatusBadge status={connection.status} />
        </div>
        <CardDescription>
          Conta: {connection.externalAccountEmail ?? "—"} · {accounts.length}{" "}
          {accounts.length === 1 ? "conta" : "contas"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {connection.status === "reauth_required" ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            O acesso ao Google Ads expirou ou foi revogado. Reconecte a conta.
          </div>
        ) : null}
        {connection.lastError ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-muted-foreground">
            Último erro: {connection.lastError}
          </div>
        ) : null}
        {recentSyncRuns[0]?.status === "partial" ? (
          <PartialState description="A última importação atingiu o limite de linhas e ficou parcial. Rode 'Importar dados' de novo para completar o período." />
        ) : null}

        <GoogleAdsAccountPicker accounts={accounts} />

        <div className="space-y-2">
          <GoogleAdsSyncButton disabled={!accounts.some((a) => a.isSelected)} />
          <p className="text-xs text-muted-foreground">
            {selected
              ? `Conta selecionada: ${selected.displayName} (${selected.externalId}).`
              : "Selecione a conta a analisar."}{" "}
            Importa investimento, impressões e status de campanha (campanha × dia,
            180 dias). Última importação:{" "}
            {connection.lastSyncedAt
              ? formatRelativeTime(connection.lastSyncedAt.toISOString())
              : "nunca"}
          </p>
        </div>

        {recentSyncRuns.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Histórico
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {recentSyncRuns.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  <span
                    className={cn(
                      "inline-block size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                      run.status === "success" && "bg-emerald-500",
                      run.status === "partial" && "bg-amber-500",
                      run.status === "failed" && "bg-red-500",
                      run.status === "running" && "bg-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span>{formatRelativeTime(run.startedAt.toISOString())}</span>
                  <span>· {run.trigger === "initial" ? "1ª carga" : "manual"}</span>
                  {run.periodStart && run.periodEnd ? (
                    <span>
                      · {run.periodStart} a {run.periodEnd}
                    </span>
                  ) : null}
                  {run.status === "success" || run.status === "partial" ? (
                    <span>
                      · {run.rowsWritten ?? 0} gravada(s) / {run.rowsIn ?? 0}{" "}
                      lida(s)
                    </span>
                  ) : null}
                  {run.status === "failed" && run.error ? (
                    <span className="text-red-700">
                      · {run.error.slice(0, 120)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        <a
          href="/api/oauth/google_ads/start"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Reconectar
        </a>
        <form action={desconectarGoogleAds}>
          <Button type="submit" variant="ghost" size="sm">
            Desconectar
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          Remove a conexão e as contas. É possível reconectar depois.
        </span>
      </CardFooter>
    </Card>
  );
}

/**
 * Layout compartilhado pelos dois produtos RD Station (bloco RD-1): nenhum
 * dos dois tem conceito de "escolher conta" — uma autorização OAuth já aponta
 * para exatamente uma conta, auto-selecionada pelo callback genérico (ver
 * o discovery.ts de cada conector RD). Por isso não há account picker aqui,
 * ao contrário do GA4/Google Ads.
 */
function RdSingleAccountCard({
  icon: Icon,
  title,
  description,
  connectHref,
  state,
  runImport,
  disconnect,
  importDescription,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  connectHref: string;
  state: ConnectionView | null;
  runImport: () => ReturnType<typeof importarDadosRdStationMarketing>;
  disconnect: () => Promise<void>;
  importDescription: string;
}) {
  if (!state) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Icon className="size-5 text-muted-foreground" aria-hidden />
            <CardTitle className="flex-1">{title}</CardTitle>
            <Badge variant="outline">Não conectado</Badge>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* navegação de página inteira para a rota que redireciona ao RD Station */}
          <a href={connectHref} className={cn(buttonVariants({ size: "sm" }))}>
            Conectar {title}
          </a>
        </CardContent>
      </Card>
    );
  }

  const { connection, recentSyncRuns } = state;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-muted-foreground" aria-hidden />
          <CardTitle className="flex-1">{title}</CardTitle>
          <StatusBadge status={connection.status} />
        </div>
        <CardDescription>
          Conta: {connection.externalAccountEmail ?? "—"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {connection.status === "reauth_required" ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            O acesso ao {title} expirou ou foi revogado. Reconecte a conta.
          </div>
        ) : null}
        {connection.lastError ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-muted-foreground">
            Último erro: {connection.lastError}
          </div>
        ) : null}
        {recentSyncRuns[0]?.status === "partial" ? (
          <PartialState description="A última importação atingiu o limite de linhas e ficou parcial. Rode 'Importar dados' de novo para completar o período." />
        ) : null}

        <div className="space-y-2">
          <RdStationSyncButton
            runImport={runImport}
            productLabel={title}
            disabled={connection.status !== "connected"}
          />
          <p className="text-xs text-muted-foreground">
            {importDescription} Última importação:{" "}
            {connection.lastSyncedAt
              ? formatRelativeTime(connection.lastSyncedAt.toISOString())
              : "nunca"}
          </p>
        </div>

        {recentSyncRuns.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Histórico
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {recentSyncRuns.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  <span
                    className={cn(
                      "inline-block size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                      run.status === "success" && "bg-emerald-500",
                      run.status === "partial" && "bg-amber-500",
                      run.status === "failed" && "bg-red-500",
                      run.status === "running" && "bg-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span>{formatRelativeTime(run.startedAt.toISOString())}</span>
                  <span>· {run.trigger === "initial" ? "1ª carga" : "manual"}</span>
                  {run.periodStart && run.periodEnd ? (
                    <span>
                      · {run.periodStart} a {run.periodEnd}
                    </span>
                  ) : null}
                  {run.status === "success" || run.status === "partial" ? (
                    <span>
                      · {run.rowsWritten ?? 0} gravada(s) / {run.rowsIn ?? 0}{" "}
                      lida(s)
                    </span>
                  ) : null}
                  {run.status === "failed" && run.error ? (
                    <span className="text-red-700">
                      · {run.error.slice(0, 120)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        <a
          href={connectHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Reconectar
        </a>
        <form action={disconnect}>
          <Button type="submit" variant="ghost" size="sm">
            Desconectar
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          Remove a conexão. É possível reconectar depois.
        </span>
      </CardFooter>
    </Card>
  );
}

export function RdStationMarketingConnectionCard({
  state,
}: {
  state: ConnectionView | null;
}) {
  return (
    <RdSingleAccountCard
      icon={Target}
      title="RD Station Marketing"
      description="Importa estatísticas de conversão de landing pages, formulários e pop-ups (plano Pro) — sem dados pessoais de leads."
      connectHref="/api/oauth/rd_station_marketing/start"
      state={state}
      runImport={importarDadosRdStationMarketing}
      disconnect={desconectarRdStationMarketing}
      importDescription="Importa visitas, conversões e taxa de conversão por ativo (dia a dia, últimos 45 dias — limite do plano Pro)."
    />
  );
}

export function RdStationCrmConnectionCard({
  state,
}: {
  state: ConnectionView | null;
}) {
  return (
    <RdSingleAccountCard
      icon={Users2}
      title="RD Station CRM"
      description="Importa negociações (status, valor, funil, etapa, fonte, campanha) — sem nome ou dados de contato."
      connectHref="/api/oauth/rd_station_crm/start"
      state={state}
      runImport={importarDadosRdStationCrm}
      disconnect={desconectarRdStationCrm}
      importDescription="Importa negociações criadas/atualizadas no período (incremental)."
    />
  );
}

const SOON = [{ name: "Meta Ads", icon: Share2 }] as const;

export function ComingSoonConnections() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {SOON.map(({ name, icon: Icon }) => (
        <Card key={name} className="opacity-60">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Icon className="size-5 text-muted-foreground" aria-hidden />
              <CardTitle className="flex-1 text-sm">{name}</CardTitle>
              <Badge variant="outline">Em breve</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Estrutura preparada — implementação pós-V0.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
