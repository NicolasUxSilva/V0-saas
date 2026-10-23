// Gera os arquivos de uso da logo The Seed a partir do SVG original.
//
// Regra: nada é redesenhado. Cada variante é o próprio original (mesmos
// caminhos) com outro enquadramento (`viewBox`).
//  - Lockup sem o fundo verde (decisões do usuário em 2026-10-23), símbolo no
//    amarelo original:
//      theseed-logo-light.svg → wordmark verde #00BF63, para o tema claro;
//      theseed-logo-dark.svg  → wordmark branco original, para o tema escuro.
//  - Marca compacta (favicon): símbolo amarelo sobre o fundo verde originais.
//
// Uso (na raiz do repositório):
//   node scripts/generate-brand-assets.mjs
// Fonte: public/brand/theseed-logo-original.svg (cópia exata de Asset-1.svg).
// O apple-icon.png é rasterizado à parte (ver docs/design-system.md § Logo).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const original = path.join(root, "public/brand/theseed-logo-original.svg");
const svg = fs.readFileSync(original, "utf8");

const ORIGINAL_VIEWBOX = 'viewBox="0 0 1122.667 793.333"';
if (!svg.includes(ORIGINAL_VIEWBOX)) throw new Error("viewBox original inesperado");

// Caixa medida do wordmark + símbolo (108,5–1011,9 × 300,6–443,3) com margem
// de ~4 unidades.
const LOCKUP_VIEWBOX = "104 296 912 152";
// Quadrado centrado no símbolo (851,1–1011,9 × 304–441,4), sem o wordmark.
const MARK_VIEWBOX = "810.95 252 241 241";

const withViewBox = (source, viewBox) =>
  source
    .replace(ORIGINAL_VIEWBOX, `viewBox="${viewBox}"`)
    .replace("<title>Design sem nome.svg</title>", "<title>The Seed</title>");

// 1) Lockups sem fundo: removem o grupo do fundo verde. No claro, o wordmark
//    (classe cls-3) passa de branco para o verde da marca; no escuro, fica
//    branco como no original.
const BACKGROUND_GROUP = /\s*<g clip-path="url\(#clip-path-2\)">[\s\S]*?<\/g>/;
const WORDMARK_FILL = ".cls-3{fill:#ffffff}";
if (!BACKGROUND_GROUP.test(svg)) throw new Error("grupo do fundo não encontrado");
if (!svg.includes(WORDMARK_FILL)) throw new Error("cor do wordmark inesperada");
const withoutBackground = svg.replace(BACKGROUND_GROUP, "");
fs.writeFileSync(
  path.join(root, "public/brand/theseed-logo-light.svg"),
  withViewBox(withoutBackground.replace(WORDMARK_FILL, ".cls-3{fill:#00bf63}"), LOCKUP_VIEWBOX),
);
fs.writeFileSync(
  path.join(root, "public/brand/theseed-logo-dark.svg"),
  withViewBox(withoutBackground, LOCKUP_VIEWBOX),
);

// 2) Marca compacta: o original recortado no símbolo, sem o grupo do wordmark.
const WORDMARK_GROUP = /\s*<g clip-path="url\(#clip-path-4\)">[\s\S]*?<\/g>/;
if (!WORDMARK_GROUP.test(svg)) throw new Error("grupo do wordmark não encontrado");
const mark = withViewBox(svg.replace(WORDMARK_GROUP, ""), MARK_VIEWBOX);
fs.writeFileSync(path.join(root, "public/brand/theseed-mark.svg"), mark);
fs.writeFileSync(path.join(root, "src/app/icon.svg"), mark);

console.log("ok", { lockup: LOCKUP_VIEWBOX, mark: MARK_VIEWBOX });
