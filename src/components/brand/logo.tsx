import { cn } from "@/lib/utils";

/**
 * Logo oficial The Seed (Design System v1.0).
 *
 * Usa os arquivos de `public/brand/`, que são o SVG original (Asset-1.svg)
 * apenas recortado (outro `viewBox`): mesmas formas, mesmas cores — verde
 * #00BF63, branco e amarelo #FFDE59. Por ser `<img>`, nenhum CSS da página
 * alcança as cores internas, e a logo é idêntica nos temas claro e escuro.
 *
 * Não aplicar filtro, opacidade, blend ou recoloração. A altura vem do
 * `className` (ex.: `h-7`); a largura acompanha a proporção do arquivo.
 */

const LOCKUP = { src: "/brand/theseed-logo.svg", width: 1016, height: 256 };
const MARK = { src: "/brand/theseed-mark.svg", width: 241, height: 241 };

export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG estático da marca; next/image não agrega aqui.
    <img
      src={LOCKUP.src}
      width={LOCKUP.width}
      height={LOCKUP.height}
      alt="The Seed"
      draggable={false}
      className={cn("h-7 w-auto shrink-0 rounded-sm select-none", className)}
    />
  );
}

/** Marca compacta: o símbolo original sobre o campo verde original. */
export function LogoMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG estático da marca; next/image não agrega aqui.
    <img
      src={MARK.src}
      width={MARK.width}
      height={MARK.height}
      alt="The Seed"
      draggable={false}
      className={cn("size-7 shrink-0 rounded-sm select-none", className)}
    />
  );
}
