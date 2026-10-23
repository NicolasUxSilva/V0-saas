import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(resolve(import.meta.dirname, "../../..", relative), "utf8");

const ORIGINAL = read("public/brand/theseed-logo-original.svg");

/** Remove o que pode legitimamente variar: viewBox e título. */
const normalize = (svg: string) =>
  svg
    .replace(/viewBox="[^"]+"/, "viewBox")
    .replace(/<title>[^<]*<\/title>/, "<title/>");

const fills = (svg: string) =>
  [...svg.matchAll(/fill:\s*(#[0-9a-f]{3,6})/gi)].map((m) => m[1]!.toLowerCase());

describe("logo The Seed", () => {
  const withoutBackground = normalize(ORIGINAL).replace(
    /\s*<g clip-path="url\(#clip-path-2\)">[\s\S]*?<\/g>/,
    "",
  );

  it("lockup do claro: original sem fundo, wordmark em verde", () => {
    const lockup = read("public/brand/theseed-logo-light.svg");
    expect(normalize(lockup)).toBe(
      withoutBackground.replace(".cls-3{fill:#ffffff}", ".cls-3{fill:#00bf63}"),
    );
    expect(lockup).not.toContain('class="cls-1"');
  });

  it("lockup do escuro: original sem fundo, cores originais", () => {
    const lockup = read("public/brand/theseed-logo-dark.svg");
    expect(normalize(lockup)).toBe(withoutBackground);
    expect(lockup).not.toContain('class="cls-1"');
  });

  it.each(["public/brand/theseed-mark.svg", "src/app/icon.svg"])(
    "%s só remove o wordmark do original",
    (file) => {
      const svg = read(file);
      const originalPaths = new Set([...ORIGINAL.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]));
      const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) expect(originalPaths.has(d)).toBe(true);
      expect(svg).not.toContain('class="cls-3"');
    },
  );

  it.each(["public/brand/theseed-mark.svg"])(
    "%s mantém exatamente as cores originais",
    (file) => {
      expect(fills(read(file))).toEqual(fills(ORIGINAL));
      expect(fills(ORIGINAL)).toEqual(["#00bf63", "#ffde59", "#ffffff"]);
    },
  );
});
