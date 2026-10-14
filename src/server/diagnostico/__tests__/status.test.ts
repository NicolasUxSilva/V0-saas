import { describe, expect, it } from "vitest";

import type { SourceKey, SourceStatus } from "@/lib/insight";

import {
  EXPIRY_WARNING_DAYS,
  STALE_AFTER_DAYS,
  SOURCE_ORDER,
  buildSourceStatuses,
  emptyReason,
  needsAttention,
  type ConnectionSnapshot,
  type DataFootprint,
} from "../status";

const NOW = new Date("2026-10-14T12:00:00Z");
const TODAY = "2026-10-14";
const D = (first: string, last: string): DataFootprint => ({ firstDate: first, lastDate: last });

function conn(provider: SourceKey, over: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot {
  return {
    provider,
    status: "connected",
    lastSyncedAt: new Date("2026-10-14T09:00:00Z"),
    lastError: null,
    tokenExpiresAt: null,
    hasSelectedAccount: true,
    lastRun: { status: "success", error: null, startedAt: new Date("2026-10-14T09:00:00Z") },
    ...over,
  };
}

function statuses(
  connections: ConnectionSnapshot[],
  footprints: Partial<Record<SourceKey, DataFootprint | null>> = {},
): SourceStatus[] {
  return buildSourceStatuses({ connections, footprints, today: TODAY, now: NOW });
}
const of = (list: SourceStatus[], key: SourceKey) => list.find((s) => s.key === key)!;

describe("buildSourceStatuses", () => {
  it("devolve SEMPRE as cinco fontes, na ordem fixa", () => {
    const out = statuses([]);
    expect(out.map((s) => s.key)).toEqual([...SOURCE_ORDER]);
    expect(SOURCE_ORDER).toEqual(["ga4", "google_ads", "meta_ads", "rd_station_marketing", "rd_station_crm"]);
    for (const s of out) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.feeds.length).toBeGreaterThan(0);
    }
  });

  it("nenhuma conexão: tudo 'não conectada', com a ação de conectar e sem inventar período", () => {
    for (const s of statuses([])) {
      expect(s.health).toBe("not_connected");
      expect(s.summary).toBe("Não conectada.");
      expect(s.action).toEqual({ label: `Conectar ${s.label}`, href: "/conexoes" });
      expect(s.coverage).toBeNull();
      expect(s.lastSyncedAt).toBeNull();
    }
  });

  it("acesso expirado ou revogado → reconectar, e diz até quando vão os dados já importados", () => {
    const s = of(
      statuses([conn("ga4", { status: "reauth_required" })], { ga4: D("2026-04-10", "2026-10-04") }),
      "ga4",
    );
    expect(s.health).toBe("needs_reauth");
    expect(s.action?.label).toBe("Reconectar");
    expect(s.notice).toBe("Os dados já importados vão até 04/10/2026.");
    expect(needsAttention(s)).toBe(true);
  });

  it("conexão em erro mostra o erro (curto) e manda para Conexões", () => {
    const long = "x".repeat(400);
    const s = of(statuses([conn("google_ads", { status: "error", lastError: long })]), "google_ads");
    expect(s.health).toBe("error");
    expect(s.summary.startsWith("Erro na conexão: ")).toBe(true);
    expect(s.summary.length).toBeLessThan(200);
    expect(s.action).toEqual({ label: "Ver em Conexões", href: "/conexoes" });
  });

  it("conectada sem conta/propriedade escolhida (só onde há seletor)", () => {
    const ga4 = of(statuses([conn("ga4", { hasSelectedAccount: false })]), "ga4");
    expect(ga4).toMatchObject({ health: "no_account", summary: "Conectada, mas nenhuma propriedade foi escolhida." });
    expect(ga4.action?.label).toBe("Escolher a propriedade");
    const meta = of(statuses([conn("meta_ads", { hasSelectedAccount: false })]), "meta_ads");
    expect(meta.action?.label).toBe("Escolher a conta");
    // RD não tem seletor: `hasSelectedAccount` é ignorado
    const rd = of(
      statuses([conn("rd_station_crm", { hasSelectedAccount: false })], { rd_station_crm: D("2026-09-01", "2026-10-13") }),
      "rd_station_crm",
    );
    expect(rd.health).toBe("synced");
  });

  it("última importação falhou e não há dado mais novo → importar de novo", () => {
    const s = of(
      statuses(
        [
          conn("meta_ads", {
            lastSyncedAt: null,
            lastRun: { status: "failed", error: "Meta Graph API 400: token inválido", startedAt: new Date("2026-10-14T10:00:00Z") },
          }),
        ],
        {},
      ),
      "meta_ads",
    );
    expect(s.health).toBe("sync_failed");
    expect(s.summary).toMatch(/A última importação falhou: Meta Graph API 400/);
    expect(s.action?.label).toBe("Importar de novo");
  });

  it("falha ANTIGA, já superada por uma importação mais nova, não conta", () => {
    const s = of(
      statuses(
        [
          conn("ga4", {
            lastSyncedAt: new Date("2026-10-14T09:00:00Z"),
            lastRun: { status: "failed", error: "velho", startedAt: new Date("2026-10-13T09:00:00Z") },
          }),
        ],
        { ga4: D("2026-04-17", "2026-10-13") },
      ),
      "ga4",
    );
    expect(s.health).toBe("synced");
  });

  it("conectada e pronta, mas nunca importou", () => {
    const s = of(statuses([conn("google_ads", { lastSyncedAt: null, lastRun: null })]), "google_ads");
    expect(s).toMatchObject({ health: "never_synced", summary: "Conectada, ainda sem nenhuma importação." });
    expect(s.action?.label).toBe("Importar dados");
  });

  it("importou, mas não há nenhuma linha: 'sem dados' — nunca 'zero'", () => {
    const s = of(statuses([conn("ga4")], { ga4: null }), "ga4");
    expect(s.health).toBe("no_data");
    expect(s.coverage).toBeNull();
    expect(needsAttention(s)).toBe(true);
  });

  it("com dados: período, data da última importação e nenhuma ação quando está em dia", () => {
    const s = of(statuses([conn("ga4")], { ga4: D("2026-04-17", "2026-10-13") }), "ga4");
    expect(s).toMatchObject({
      health: "synced",
      summary: "Dados de 17/04/2026 a 13/10/2026.",
      notice: null,
      action: null,
      coverage: { first: "2026-04-17", last: "2026-10-13" },
      lastSyncedAt: "2026-10-14T09:00:00.000Z",
    });
    expect(needsAttention(s)).toBe(false);
  });

  it("fonte DIÁRIA defasada é avisada (e só ela); o CRM, que é evento a evento, não", () => {
    const stale = `2026-10-${String(14 - STALE_AFTER_DAYS - 1).padStart(2, "0")}`; // 4 dias atrás
    const ads = of(statuses([conn("google_ads")], { google_ads: D("2026-04-10", stale) }), "google_ads");
    expect(ads.health).toBe("synced");
    expect(ads.notice).toBe(`Os dados vão até 10/10/2026 (${STALE_AFTER_DAYS + 1} dias atrás).`);
    expect(ads.action?.label).toBe("Importar de novo");

    const crm = of(statuses([conn("rd_station_crm")], { rd_station_crm: D("2026-01-01", "2026-09-01") }), "rd_station_crm");
    expect(crm.notice).toBeNull();

    const fresh = `2026-10-${String(14 - STALE_AFTER_DAYS).padStart(2, "0")}`; // exatamente no limite
    expect(
      of(statuses([conn("google_ads")], { google_ads: D("2026-04-10", fresh) }), "google_ads").notice,
    ).toBeNull();
  });

  it("Meta Ads: acesso perto de expirar vira aviso e ação (as demais fontes renovam sozinhas)", () => {
    const soon = new Date(NOW.getTime() + 3 * 86_400_000);
    const meta = of(
      statuses([conn("meta_ads", { tokenExpiresAt: soon })], { meta_ads: D("2026-04-17", "2026-10-13") }),
      "meta_ads",
    );
    expect(meta.notice).toBe("O acesso expira em 3 dias; reconecte antes disso.");
    expect(meta.action?.label).toBe("Reconectar");

    const edge = new Date(NOW.getTime() + EXPIRY_WARNING_DAYS * 86_400_000);
    expect(
      of(statuses([conn("meta_ads", { tokenExpiresAt: edge })], { meta_ads: D("2026-04-17", "2026-10-13") }), "meta_ads").notice,
    ).toMatch(/expira em 7 dias/);
    const far = new Date(NOW.getTime() + (EXPIRY_WARNING_DAYS + 1) * 86_400_000);
    expect(
      of(statuses([conn("meta_ads", { tokenExpiresAt: far })], { meta_ads: D("2026-04-17", "2026-10-13") }), "meta_ads").notice,
    ).toBeNull();

    // o token do Google expira em 1 h e é renovado sozinho: nunca vira aviso
    expect(
      of(statuses([conn("ga4", { tokenExpiresAt: soon })], { ga4: D("2026-04-17", "2026-10-13") }), "ga4").notice,
    ).toBeNull();
  });

  it("expira hoje / expirou: texto próprio", () => {
    const today = new Date(NOW.getTime() + 3_600_000);
    expect(
      of(statuses([conn("meta_ads", { tokenExpiresAt: today })], { meta_ads: D("2026-04-17", "2026-10-13") }), "meta_ads")
        .notice,
    ).toBe("O acesso expira em 1 dia; reconecte antes disso.");
    const past = new Date(NOW.getTime() - 3_600_000);
    expect(
      of(statuses([conn("meta_ads", { tokenExpiresAt: past })], { meta_ads: D("2026-04-17", "2026-10-13") }), "meta_ads")
        .notice,
    ).toBe("O acesso expira hoje.");
  });

  it("é pura: mesma entrada, mesma saída, e a entrada não é alterada", () => {
    const input = {
      connections: [conn("ga4"), conn("meta_ads", { status: "reauth_required" })],
      footprints: { ga4: D("2026-04-17", "2026-10-13") },
      today: TODAY,
      now: NOW,
    };
    const frozen = structuredClone(input);
    expect(buildSourceStatuses(input)).toEqual(buildSourceStatuses(input));
    expect(input).toEqual(frozen);
  });
});

describe("emptyReason — o porquê e a ação, sempre", () => {
  const reason = (connections: ConnectionSnapshot[], footprints: Partial<Record<SourceKey, DataFootprint | null>> = {}) =>
    emptyReason(statuses(connections, footprints));

  it("GA4 não conectado: explica que o diagnóstico parte do GA4 e manda conectar", () => {
    const r = reason([]);
    expect(r.title).toBe("O diagnóstico ainda não tem dados do GA4");
    expect(r.description).toMatch(/analisa o tráfego e as conversões do GA4/);
    expect(r.action).toEqual({ label: "Conectar Google Analytics 4", href: "/conexoes" });
  });

  it("cada estado do GA4 tem título, explicação e ação próprios", () => {
    const cases: [Partial<ConnectionSnapshot>, string, string][] = [
      [{ status: "reauth_required" }, "O acesso ao GA4 expirou", "Reconectar"],
      [{ status: "error", lastError: "boom" }, "A conexão com o GA4 está com erro", "Ver em Conexões"],
      [{ hasSelectedAccount: false }, "Falta escolher a propriedade do GA4", "Escolher a propriedade"],
      [
        { lastSyncedAt: null, lastRun: { status: "failed", error: "falhou", startedAt: new Date("2026-10-14T10:00:00Z") } },
        "A última importação do GA4 falhou",
        "Importar de novo",
      ],
      [{ lastSyncedAt: null, lastRun: null }, "O GA4 está conectado, mas ainda não importou dados", "Importar dados"],
    ];
    for (const [over, title, label] of cases) {
      const r = reason([conn("ga4", over)]);
      expect(r.title, JSON.stringify(over)).toBe(title);
      expect(r.description.length).toBeGreaterThan(20);
      expect(r.action?.label).toBe(label);
      expect(r.action?.href).toBe("/conexoes");
    }
  });

  it("importou sem linhas: diz para conferir a propriedade", () => {
    const r = reason([conn("ga4")], { ga4: null });
    expect(r.title).toBe("A importação do GA4 não trouxe nenhuma linha");
  });

  it("GA4 com dados mas sem diagnóstico: manda atualizar (nunca fica sem ação)", () => {
    const r = reason([conn("ga4")], { ga4: D("2026-04-17", "2026-10-13") });
    expect(r.title).toBe("Ainda não há diagnóstico gerado");
    expect(r.action).toEqual({ label: "Atualizar dados", href: "/conexoes" });
  });

  it("menciona o que JÁ existe em outras fontes, para a tela não parecer vazia à toa", () => {
    const r = reason([conn("google_ads"), conn("rd_station_crm")], {
      google_ads: D("2026-04-10", "2026-10-13"),
      rd_station_crm: D("2026-01-01", "2026-10-13"),
    });
    expect(r.description).toContain("já há dados de Google Ads, RD Station CRM");
  });

  it("não menciona fonte sem dado", () => {
    const r = reason([conn("google_ads", { status: "reauth_required" })]);
    expect(r.description).not.toMatch(/Enquanto isso/);
  });
});
