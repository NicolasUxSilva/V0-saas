import { describe, expect, it } from "vitest";

import { CRM_API_BASE, resolveCrmUrl } from "@/server/connectors/rd_station_crm/http";

import { internalPageLink, publicPageLink } from "./fixtures";

describe("rd_station_crm resolveCrmUrl — a raiz pública é /crm/v2", () => {
  it("a raiz pública é exatamente https://api.rd.services/crm/v2", () => {
    expect(CRM_API_BASE).toBe("https://api.rd.services/crm/v2");
  });

  it("caminho relativo → colado na raiz pública (nunca /api/v2/)", () => {
    expect(resolveCrmUrl("/deals?filter=x")).toBe(
      "https://api.rd.services/crm/v2/deals?filter=x",
    );
    expect(resolveCrmUrl("/pipelines")).toBe("https://api.rd.services/crm/v2/pipelines");
  });

  it("link REAL da API (prefixo interno /api/v2/) → reancorado em /crm/v2/, query preservada byte a byte", () => {
    const resolved = resolveCrmUrl(internalPageLink(2));
    expect(resolved).toBe(publicPageLink(2));
    expect(resolved).not.toContain("/api/v2/");
    // a codificação da query (`+` nos espaços, `%5B`/`%5D` nos colchetes) não pode mudar
    expect(resolved).toContain("page%5Bnumber%5D=2&page%5Bsize%5D=25");
    expect(resolved).toContain("2026-04-07+00%3A00%3A00");
  });

  it("link que já está em /crm/v2/ → inalterado", () => {
    expect(resolveCrmUrl(publicPageLink(7))).toBe(publicPageLink(7));
  });

  it("nenhuma entrada aceita jamais resulta em uma URL com /api/v2/", () => {
    for (const input of [
      "/deals",
      internalPageLink(1),
      internalPageLink(30),
      publicPageLink(1),
      "https://api.rd.services/api/v2/pipelines",
    ]) {
      expect(resolveCrmUrl(input)).not.toContain("/api/v2/");
    }
  });

  it("outro host → lança (o Bearer nunca vai para terceiros)", () => {
    expect(() => resolveCrmUrl("https://evil.example.com/crm/v2/deals")).toThrow(
      /outro destino/,
    );
    // host parecido, mas não o mesmo
    expect(() => resolveCrmUrl("https://api.rd.services.evil.example.com/crm/v2/deals")).toThrow(
      /outro destino/,
    );
  });

  it("downgrade para http:// → lança", () => {
    expect(() => resolveCrmUrl("http://api.rd.services/crm/v2/deals")).toThrow(
      /outro destino/,
    );
  });

  it("caminho fora de /crm/v2 e /api/v2 → lança (fail-closed)", () => {
    expect(() => resolveCrmUrl("https://api.rd.services/platform/contacts")).toThrow(
      /caminho inesperado/,
    );
    expect(() => resolveCrmUrl("https://api.rd.services/v2/deals")).toThrow(
      /caminho inesperado/,
    );
  });
});
