/**
 * Estado das fontes de dados para a tela Diagnóstico — PURO (sem banco, relógio nem rede).
 *
 * A tela precisa dizer, para cada fonte, o que de fato existe e o que fazer a seguir:
 * conectada ou não, com conta escolhida ou não, importou ou não, até que dia vão os
 * dados. Tudo aqui é derivado de fatos (a conexão, a última importação e o período dos
 * dados já gravados) — nada é inventado e nada depende de `USE_MOCK`.
 *
 * Ausência ≠ zero: fonte sem linha NÃO tem "0 sessões"; tem `coverage: null`.
 */
import type {
  DiagnosticoEmpty,
  SourceHealth,
  SourceKey,
  SourceStatus,
} from "@/lib/insight";

/** Em que ordem as fontes aparecem na tela. */
export const SOURCE_ORDER: readonly SourceKey[] = [
  "ga4",
  "google_ads",
  "meta_ads",
  "rd_station_marketing",
  "rd_station_crm",
];

/** Dias sem dado novo a partir dos quais uma fonte DIÁRIA é avisada como defasada. */
export const STALE_AFTER_DAYS = 3;
/** Faltando tantos dias, o acesso que expira (Meta Ads) vira aviso. */
export const EXPIRY_WARNING_DAYS = 7;

interface CatalogEntry {
  label: string;
  /** a fonte tem seletor de conta/propriedade? (RD Station: uma autorização = uma conta) */
  needsAccount: boolean;
  /** dado diário (vale o aviso de defasagem); o CRM é evento a evento */
  daily: boolean;
  /** o acesso expira e NÃO se renova sozinho (sem refresh token) */
  expiringAccess: boolean;
  feeds: string;
}

const CATALOG: Record<SourceKey, CatalogEntry> = {
  ga4: {
    label: "Google Analytics 4",
    needsAccount: true,
    daily: true,
    expiringAccess: false,
    feeds: "o diagnóstico de tráfego e conversões",
  },
  google_ads: {
    label: "Google Ads",
    needsAccount: true,
    daily: true,
    expiringAccess: false,
    feeds: "investimento, cliques e conversões de campanhas do Google, e a mídia paga no Cross-source e no Advisor",
  },
  meta_ads: {
    label: "Meta Ads",
    needsAccount: true,
    daily: true,
    expiringAccess: true,
    feeds: "investimento, cliques e leads de campanhas do Facebook e Instagram, e a mídia paga no Cross-source e no Advisor",
  },
  rd_station_marketing: {
    label: "RD Station Marketing",
    needsAccount: false,
    daily: true,
    expiringAccess: false,
    feeds: "visitas e conversões de landing pages, formulários e pop-ups",
  },
  rd_station_crm: {
    label: "RD Station CRM",
    needsAccount: false,
    daily: false,
    expiringAccess: false,
    feeds: "negócios criados, ganhos e perdidos",
  },
};

export interface ConnectionSnapshot {
  provider: SourceKey;
  status: "connected" | "reauth_required" | "error";
  lastSyncedAt: Date | null;
  lastError: string | null;
  tokenExpiresAt: Date | null;
  /** há conta/propriedade escolhida? (ignorado nas fontes sem seletor) */
  hasSelectedAccount: boolean;
  lastRun: {
    status: "running" | "success" | "partial" | "failed";
    error: string | null;
    startedAt: Date;
  } | null;
}

/** O período dos dados já gravados de uma fonte. */
export interface DataFootprint {
  firstDate: string; // "YYYY-MM-DD"
  lastDate: string;
}

export interface SourceStatusInput {
  connections: ConnectionSnapshot[];
  footprints: Partial<Record<SourceKey, DataFootprint | null>>;
  /** hoje, "YYYY-MM-DD" — entra como argumento porque esta função não olha o relógio */
  today: string;
  /** agora — idem (cálculo de dias até o acesso expirar) */
  now: Date;
}

const DAY_MS = 86_400_000;

const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

const brDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

const clip = (s: string, n = 140): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

const CONEXOES = "/conexoes";

function action(label: string): { label: string; href: string } {
  return { label, href: CONEXOES };
}

function statusFor(key: SourceKey, input: SourceStatusInput): SourceStatus {
  const entry = CATALOG[key];
  const conn = input.connections.find((c) => c.provider === key) ?? null;
  const footprint = input.footprints[key] ?? null;

  const base = {
    key,
    label: entry.label,
    feeds: entry.feeds,
    notice: null as string | null,
    lastSyncedAt: conn?.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null,
    coverage: footprint ? { first: footprint.firstDate, last: footprint.lastDate } : null,
  };
  const out = (
    health: SourceHealth,
    summary: string,
    act: SourceStatus["action"],
    notice: string | null = null,
  ): SourceStatus => ({ ...base, health, summary, action: act, notice });

  if (!conn) {
    return out("not_connected", "Não conectada.", action(`Conectar ${entry.label}`));
  }
  if (conn.status === "reauth_required") {
    return out(
      "needs_reauth",
      "O acesso expirou ou foi revogado.",
      action("Reconectar"),
      footprint ? `Os dados já importados vão até ${brDate(footprint.lastDate)}.` : null,
    );
  }
  if (conn.status === "error") {
    return out(
      "error",
      conn.lastError ? `Erro na conexão: ${clip(conn.lastError)}` : "A conexão está com erro.",
      action("Ver em Conexões"),
    );
  }
  if (entry.needsAccount && !conn.hasSelectedAccount) {
    return out(
      "no_account",
      key === "ga4" ? "Conectada, mas nenhuma propriedade foi escolhida." : "Conectada, mas nenhuma conta foi escolhida.",
      action(key === "ga4" ? "Escolher a propriedade" : "Escolher a conta"),
    );
  }
  // a última importação falhou e não há dado mais novo que ela: o que está gravado é de antes
  if (conn.lastRun?.status === "failed" && (!conn.lastSyncedAt || conn.lastRun.startedAt > conn.lastSyncedAt)) {
    return out(
      "sync_failed",
      conn.lastRun.error ? `A última importação falhou: ${clip(conn.lastRun.error)}` : "A última importação falhou.",
      action("Importar de novo"),
      footprint ? `Os dados já importados vão até ${brDate(footprint.lastDate)}.` : null,
    );
  }
  if (!conn.lastSyncedAt && !footprint) {
    return out("never_synced", "Conectada, ainda sem nenhuma importação.", action("Importar dados"));
  }
  if (!footprint) {
    return out(
      "no_data",
      "A importação terminou, mas não trouxe nenhuma linha.",
      action("Ver em Conexões"),
    );
  }

  // há dado: avisos opcionais (defasagem e acesso perto de expirar)
  const notices: string[] = [];
  let act: SourceStatus["action"] = null;
  if (entry.daily) {
    const behind = daysBetween(footprint.lastDate, input.today);
    if (behind > STALE_AFTER_DAYS) {
      notices.push(`Os dados vão até ${brDate(footprint.lastDate)} (${behind} dias atrás).`);
      act = action("Importar de novo");
    }
  }
  if (entry.expiringAccess && conn.tokenExpiresAt) {
    const left = Math.ceil((conn.tokenExpiresAt.getTime() - input.now.getTime()) / DAY_MS);
    if (left <= EXPIRY_WARNING_DAYS) {
      notices.push(
        left <= 0
          ? "O acesso expira hoje."
          : `O acesso expira em ${left} ${left === 1 ? "dia" : "dias"}; reconecte antes disso.`,
      );
      act = action("Reconectar");
    }
  }
  return out(
    "synced",
    `Dados de ${brDate(footprint.firstDate)} a ${brDate(footprint.lastDate)}.`,
    act,
    notices.length > 0 ? notices.join(" ") : null,
  );
}

/** O estado das cinco fontes, na ordem fixa da tela. */
export function buildSourceStatuses(input: SourceStatusInput): SourceStatus[] {
  return SOURCE_ORDER.map((key) => statusFor(key, input));
}

/** `true` quando alguma fonte precisa de uma ação do usuário (exclui "não conectada"). */
export function needsAttention(s: SourceStatus): boolean {
  return (
    s.health === "needs_reauth" ||
    s.health === "error" ||
    s.health === "sync_failed" ||
    s.health === "no_account" ||
    s.health === "no_data"
  );
}

/**
 * Por que o Diagnóstico está vazio e o que fazer. O diagnóstico parte do GA4: o motivo
 * é o estado do GA4. Sempre devolve algo útil — título, explicação e a ação recomendada.
 */
export function emptyReason(sources: SourceStatus[]): DiagnosticoEmpty {
  const ga4 = sources.find((s) => s.key === "ga4");
  const others = sources.filter((s) => s.key !== "ga4" && s.health === "synced");
  const meanwhile =
    others.length > 0
      ? ` Enquanto isso, já há dados de ${others.map((s) => s.label).join(", ")} — veja abaixo.`
      : "";

  switch (ga4?.health) {
    case "not_connected":
      return {
        title: "O diagnóstico ainda não tem dados do GA4",
        description: `Ele analisa o tráfego e as conversões do GA4, e o GA4 ainda não está conectado. Conecte uma propriedade e rode a primeira importação.${meanwhile}`,
        action: ga4.action,
      };
    case "needs_reauth":
      return {
        title: "O acesso ao GA4 expirou",
        description: `Sem o acesso, o diagnóstico não consegue importar nem analisar o GA4. Reconecte a conta em Conexões.${meanwhile}`,
        action: ga4.action,
      };
    case "error":
      return {
        title: "A conexão com o GA4 está com erro",
        description: `${ga4.summary} Corrija em Conexões para o diagnóstico voltar a ser gerado.${meanwhile}`,
        action: ga4.action,
      };
    case "no_account":
      return {
        title: "Falta escolher a propriedade do GA4",
        description: `O GA4 está conectado, mas o diagnóstico só analisa a propriedade escolhida. Escolha uma em Conexões e importe os dados.${meanwhile}`,
        action: ga4.action,
      };
    case "sync_failed":
      return {
        title: "A última importação do GA4 falhou",
        description: `${ga4.summary} Tente importar de novo em Conexões.${meanwhile}`,
        action: ga4.action,
      };
    case "never_synced":
      return {
        title: "O GA4 está conectado, mas ainda não importou dados",
        description: `Rode a primeira importação em Conexões: depois dela o diagnóstico é gerado automaticamente.${meanwhile}`,
        action: ga4.action,
      };
    case "no_data":
      return {
        title: "A importação do GA4 não trouxe nenhuma linha",
        description: `Confirme em Conexões se a propriedade escolhida tem tráfego e importe de novo.${meanwhile}`,
        action: ga4.action,
      };
    default:
      return {
        title: "Ainda não há diagnóstico gerado",
        description: `Há dados do GA4, mas nenhum diagnóstico foi calculado. Rode "Atualizar dados" em Conexões para gerá-lo.${meanwhile}`,
        action: action("Atualizar dados"),
      };
  }
}
