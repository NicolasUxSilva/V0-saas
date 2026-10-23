import { cn } from "@/lib/utils";

/**
 * Logo oficial The Seed (Design System v1.0).
 *
 * Usa os arquivos de `public/brand/`, gerados do SVG original (Asset-1.svg)
 * com as mesmas formas e sem o fundo verde. Símbolo sempre no amarelo original
 * #FFDE59; wordmark verde #00BF63 no tema claro e branco (original) no escuro
 * (decisões de 2026-10-23). São dois arquivos fixos trocados pela classe
 * `.dark`; por serem `<img>`, nenhum CSS alcança as cores internas.
 *
 * Não aplicar filtro, opacidade, blend ou recoloração. A altura vem do
 * `className` (ex.: `h-7`); a largura acompanha a proporção do arquivo.
 */

const LOCKUP = {
  light: "/brand/theseed-logo-light.svg",
  dark: "/brand/theseed-logo-dark.svg",
  width: 912,
  height: 152,
};
const MARK = { src: "/brand/theseed-mark.svg", width: 241, height: 241 };

export function Logo({ className }: { className?: string }) {
  const base = cn("h-6 w-auto shrink-0 select-none", className);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático da marca; next/image não agrega aqui. */}
      <img
        src={LOCKUP.light}
        width={LOCKUP.width}
        height={LOCKUP.height}
        alt="The Seed"
        draggable={false}
        className={cn(base, "dark:hidden")}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático da marca; next/image não agrega aqui. */}
      <img
        src={LOCKUP.dark}
        width={LOCKUP.width}
        height={LOCKUP.height}
        alt="The Seed"
        draggable={false}
        className={cn(base, "hidden dark:block")}
      />
    </>
  );
}

/** Marca compacta (como o favicon): símbolo e fundo verde originais. */
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
