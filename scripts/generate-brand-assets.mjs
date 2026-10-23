// Gera os arquivos de uso da logo The Seed a partir do SVG original.
//
// Regra: nada é recolorido nem redesenhado. Cada variante é o próprio original
// (mesmos caminhos, mesmas classes e cores) com outro enquadramento (`viewBox`).
// A variante compacta só omite o wordmark; o símbolo e o fundo verde são os
// originais.
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

// Recorte do campo verde em volta do wordmark + símbolo (margem uniforme de
// 56 unidades sobre a caixa medida 108,5–1011,9 × 300,6–443,3).
const LOCKUP_VIEWBOX = "52 244 1016 256";
// Quadrado centrado no símbolo (851,1–1011,9 × 304–441,4), sem o wordmark.
const MARK_VIEWBOX = "810.95 252 241 241";

const withViewBox = (source, viewBox) =>
  source
    .replace(ORIGINAL_VIEWBOX, `viewBox="${viewBox}"`)
    .replace("<title>Design sem nome.svg</title>", "<title>The Seed</title>");

// 1) Lockup: o original inteiro, só recortado.
fs.writeFileSync(
  path.join(root, "public/brand/theseed-logo.svg"),
  withViewBox(svg, LOCKUP_VIEWBOX),
);

// 2) Marca compacta: o original recortado no símbolo, sem o grupo do wordmark.
const WORDMARK_GROUP = /\s*<g clip-path="url\(#clip-path-4\)">[\s\S]*?<\/g>/;
if (!WORDMARK_GROUP.test(svg)) throw new Error("grupo do wordmark não encontrado");
const mark = withViewBox(svg.replace(WORDMARK_GROUP, ""), MARK_VIEWBOX);
fs.writeFileSync(path.join(root, "public/brand/theseed-mark.svg"), mark);
fs.writeFileSync(path.join(root, "src/app/icon.svg"), mark);

console.log("ok", { lockup: LOCKUP_VIEWBOX, mark: MARK_VIEWBOX });
