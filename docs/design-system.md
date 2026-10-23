# The Seed — Design System v1.0

Fundação visual do produto: tokens, temas, logo, tipografia, ícones, movimento e
componentes compartilhados. Esta etapa **não** redesenha as páginas; ela define o
que o redesign global vai aplicar.

Revisão visual: `/dev/design-system` — uma tela-modelo (cabeçalho, filtros,
métricas, tabela, estados) montada só com os componentes compartilhados. Exige
login, como `/dev/states`.

## Direção

Interface silenciosa: neutra, com hierarquia feita por tipografia, espaço e
alinhamento. A identidade do The Seed aparece na logo e em poucos detalhes; os
dados são o centro.

- **Menos cor.** A interface é branca/cinza (claro) ou preta/carvão (escuro).
- **Verde só onde importa:** a ação principal da tela. Seleção, foco, hover, item
  ativo e badges padrão são neutros.
- **Amarelo:** só dentro da logo.
- **Estados** (sucesso, alerta, erro, informação) usam cor semântica de baixa
  intensidade: texto na cor do estado sobre fundo a 8 % (12 % no escuro).
- **Sem decoração:** cards sem sombra; sem brilho, gradiente, desfoque ou filtro.
- **Na dúvida, neutro.**

Referência estudada (princípios, não layout): ratosdeia.com.br/skills — uma cor de
acento, superfícies neutras, cards só com borda fina, uma CTA cheia e o resto em
contorno, números grandes como hierarquia.

### Correções em relação à primeira versão

| Problema | Causa | Correção |
|---|---|---|
| Serifa aparecendo na interface | `--font-sans: var(--font-geist-sans)` sem fallback: sem a variável, a pilha ficava inválida e o navegador usava a serifa padrão | Pilha com fallback sem serifa em `--font-sans` e `--font-mono` |
| Verde saturado em tudo | `primary`, `ring`, item ativo, linha selecionada e badge "brand" em verde | Verde só em `primary`; foco, ativo e seleção neutros; badge "brand" removido |
| Logo recolorida por tema | Variantes "claro" (floresta + verde) e "escuro" geradas por mim | Removidas; a logo é o arquivo original recortado, igual nos dois temas |
| Componentes pesados | Sombras em card, foco verde de 3 px, badge padrão verde, desabilitado verde apagado, desfoque em overlays | Sem sombra em card; foco cinza de 2 px; badge neutro; desabilitado neutro; sem desfoque |
| Claro esverdeado | Fundo `#F5F8F5` e sidebar `#EDF3EE` | Fundo `#F7F8F7`; sidebar igual ao fundo, separada por borda |
| Página "catálogo" | `/dev/design-system` era uma vitrine de amostras | Virou uma tela-modelo de produto |

## Onde ficam as coisas

| O quê | Arquivo |
|---|---|
| Tokens (cores, tipografia, raios, sombras, movimento) | `src/app/globals.css` |
| Fontes e script de tema | `src/app/layout.tsx` |
| Lógica de tema (pura, testada) | `src/lib/theme.ts` |
| Provedor e seletores de tema | `src/components/theme-provider.tsx`, `src/components/theme-switcher.tsx` |
| Logo | `src/components/brand/logo.tsx`, `public/brand/*.svg` |
| Favicon / ícone iOS | `src/app/icon.svg`, `src/app/apple-icon.png` |
| Gerador dos recortes da logo | `scripts/generate-brand-assets.mjs` |
| Primitivos de UI | `src/components/ui/*` (shadcn `base-nova` sobre Base UI) |
| Estados (vazio, carregando, erro, parcial) | `src/components/states.tsx` |

Regra: componentes usam **tokens semânticos** (`bg-card`, `text-muted-foreground`,
`bg-primary`, `text-success`, `border-border`…). Hex solto e paletas do Tailwind
(`amber-500`, `emerald-600`…) não entram em código novo. As páginas atuais ainda
têm essas classes; a migração é do redesign.

## Cores

### Marca (fixas)

| Token | Valor | Uso |
|---|---|---|
| `seed-green` | `#00BF63` | Assinatura. Só na logo (e `chart-1` no escuro). Nunca alterado. |
| `seed-yellow` | `#FFDE59` | Só na logo. |
| `action-green` | `#008A49` | Ação principal (`primary`) nos dois temas. |

### Semânticas

| Token | Claro | Escuro | Papel |
|---|---|---|---|
| `background` | `#F7F8F7` | `#090B09` | Fundo |
| `sidebar` | `#F7F8F7` | `#0D100D` | Sidebar (no claro, igual ao fundo + borda) |
| `card` | `#FFFFFF` | `#121512` | Cards e superfícies |
| `popover` | `#FFFFFF` | `#191D19` | Menus, modais, painéis, tooltips |
| `secondary` / `muted` / `accent` | `#F1F3F1` | `#191D19` / `#161916` / `#1D221E` | Superfícies secundárias, hover, seleção |
| `sidebar-accent` | `#ECEEEC` | `#191D19` | Item ativo da navegação |
| `foreground` | `#202522` | `#F5F7F5` | Texto principal |
| `muted-foreground` | `#6A716B` ⚠︎ | `#929A93` | Texto secundário |
| `border` | `#E5E8E5` | `#282D29` | Bordas |
| `input` | `#D5D9D5` | `#333934` | Borda de campo |
| `ring` | `#858C86` | `#6B726C` | Foco (neutro) |
| `primary` / `-foreground` | `#008A49` / `#FFFFFF` | idem | Ação principal |
| `primary-hover` | `#007A41` | `#007A41` | Hover da ação |
| `success` | `#2E7D53` | `#6CC495` | Sucesso |
| `warning` | `#8F6200` | `#D9AE55` | Alerta |
| `destructive` | `#B3382F` | `#E58378` | Erro / ação destrutiva |
| `info` | `#2F63A6` | `#86A9DE` | Informação |
| `chart-1…5` | `#008A49` `#5B635D` `#2F63A6` `#8F6200` `#8C938D` | `#00BF63` `#B5BCB6` `#86A9DE` `#D9AE55` `#6C746E` | Séries (marca + neutros + 2 semânticas suaves) |

⚠︎ Ajustes em relação à paleta pedida, só por contraste:

| Pedido | Usado | Motivo |
|---|---|---|
| Texto secundário `#707771` | `#6A716B` | `#707771` dá 4,32:1 no fundo e 4,12:1 na superfície secundária (mínimo 4,5:1). `#6A716B` dá 4,71 / 4,50 / 5,02 (fundo / secundária / card). |
| Ação `#008A49` | **mantido** | Exceção de contraste aprovada (ver abaixo). |

### Exceção de contraste aprovada

| Data | Decisão |
|---|---|
| 2026-10-23 | `#008A49` permanece como verde de ação (`primary`) nos dois temas, por decisão de marca do responsável pelo produto. |

- **Medição:** texto branco sobre `#008A49` = **4,44:1**. Fica 0,06 abaixo do WCAG 2.x AA para texto normal (4,5:1). Passa o AA para texto grande (3:1) e o contraste de componente (3:1).
- **Onde se aplica:** só no rótulo dos botões `default` (`primary-foreground` sobre `primary`), em 14 px e peso 500. No hover (`#007A41`), o contraste sobe para 5,44:1.
- **Mitigação:** o verde aparece em uma ação por tela, sempre com rótulo curto e sem texto longo sobre ele. Texto verde sobre fundo claro não é usado.
- **Para cumprir o AA estrito no futuro:** trocar `--primary` para `#007F41` (5,11:1) em `src/app/globals.css`. É uma linha por tema.

### Contrastes medidos (WCAG 2.x)

Texto (mínimo 4,5:1):

| Par | Claro | Escuro |
|---|---|---|
| foreground / background | 14,62 | 18,34 |
| muted-foreground / background | 4,71 | 6,83 |
| muted-foreground / card | 5,02 | 6,36 |
| muted-foreground / popover | 5,02 | 5,90 |
| primary-foreground / primary | **4,44** | **4,44** |
| primary-foreground / primary-hover | 5,44 | 5,44 |
| badge neutro | 13,90 | 13,12 |
| badge sucesso / alerta / erro / info | 4,54 / 4,81 / 5,28 / 5,44 | 7,09 / 7,22 / 5,81 / 6,31 |
| botão desabilitado (texto / fundo) | 4,50 | 6,13 |

Não texto (mínimo 3:1): `ring` 3,24 no fundo e 3,45 no card (claro), 4,00 (escuro);
`chart-*` ≥ 3,15 (claro) e ≥ 3,82 (escuro).

Limites conhecidos, deliberados: `border` (1,23:1) e `input` (1,43:1 claro; 1,56:1
escuro) ficam abaixo de 3:1 para manter bordas finas e discretas. Campos continuam
identificáveis pelo rótulo, pelo placeholder e pelo foco; erro aparece com borda
vermelha cheia.

## Temas

Três opções: **Claro**, **Escuro**, **Sistema** (padrão).

- **Persistência:** `localStorage["theseed-theme"]` (`light` | `dark`; ausência = sistema).
  Só neste navegador.
- **Sem flash:** script inline no `<head>` (`THEME_INIT_SCRIPT`) aplica `.dark` e
  `color-scheme` em `<html>` antes da primeira pintura (guia
  `preventing-flash-before-hydration.md` do Next 16). Sem `next-themes`.
- **Sistema ao vivo:** o `ThemeProvider` escuta `prefers-color-scheme`.
- **Troca:** instantânea, com transições congeladas no instante da troca (classe
  `theme-switching`), para a página mudar inteira no mesmo quadro.
- **Outras abas:** sincronizadas pelo evento `storage`.
- **Onde trocar:** menu do usuário (topbar) e controle no login.
- O tema muda só tokens de interface. A logo é `<img>` de arquivo fixo e não é
  afetada.

## Logo

Fonte: `Asset-1.svg`, preservado byte a byte em
`public/brand/theseed-logo-original.svg` (teste confere).

Estrutura do original: prancheta 1122,667 × 793,333 inteira em verde `#00BF63`, com
o wordmark branco e o símbolo amarelo numa faixa central. O fundo verde faz parte
da arte, então a solução fiel é **recortar**, não remover nem recolorir:

| Arquivo | O que é | Uso |
|---|---|---|
| `theseed-logo-original.svg` | Original intacto | Referência |
| `theseed-logo.svg` | O original com `viewBox="52 244 1016 256"` (margem uniforme de 56 unidades em volta da marca). Única outra diferença: o `<title>`. | Sidebar, login, qualquer lugar |
| `theseed-mark.svg` = `src/app/icon.svg` | O original com `viewBox` quadrado no símbolo e sem o grupo do wordmark | Favicon, espaços compactos |
| `src/app/apple-icon.png` | `theseed-mark.svg` rasterizado a 180 px (Quick Look do macOS) | Ícone iOS |

- Mesmas cores (verde, branco, amarelo) nos dois temas; os testes conferem que os
  recortes têm exatamente as cores e os caminhos do original.
- No código: `<Logo />` e `<LogoMark />` renderizam `<img>`, então nenhum CSS da
  página alcança as cores internas. Proibido: filtro, opacidade, blend, recolorir.
- Cantos: `rounded-sm` (≈5 px) no elemento `<img>`. É apresentação, não muda a arte;
  remover a classe deixa o recorte reto como no original.
- Para regerar: `node scripts/generate-brand-assets.mjs`. O PNG do iOS é refeito à
  parte (`qlmanage -t -s 180 public/brand/theseed-mark.svg`).

## Tipografia

Geist Sans em toda a interface; Geist Mono só para detalhes técnicos pequenos
(ex.: identificadores). Ambas por `next/font`, com fallback sem serifa. Nenhuma
serifa no produto.

| Classe | Tamanho / altura | Peso | Uso |
|---|---|---|---|
| `text-title` | 22 / 28 | 600 | Título de página |
| `text-heading` | 16 / 24 | 600 | Título de seção ou card |
| `text-body` | 14 / 20 | 400 | Texto de interface |
| `text-caption` | 12 / 16 | 400 | Legenda, nota |
| `text-label` | 12 / 16 | 500 | Rótulo, cabeçalho de tabela |
| `text-metric` | 24 / 32 | 600, −0,02em | Métrica; sempre com `tabular-nums` |

Pesos: 400 e 500 na maior parte; 600 só em títulos e métricas. Sem itálico. Tabelas
têm `tabular-nums` por padrão.

## Ícones

Lucide, única biblioteca. `size-4` em navegação, botões, menus e tabelas; `size-3.5`
em botões `sm`; `size-3` em badges; `size-6` em estados vazios/erro. Cor neutra por
padrão (`text-muted-foreground` ou herdada). Decorativo: `aria-hidden`; botão só
com ícone: `aria-label`.

## Componentes

| Componente | Regra |
|---|---|
| `Button` | `default` = verde, **uma por tela**; desabilitado vira neutro. `outline`/`secondary`/`ghost` neutros. `destructive` em vermelho suave, só para ação destrutiva. `link` neutro sublinhado. Foco: anel cinza de 2 px com afastamento. |
| `Badge` | Padrão neutro translúcido; `success`/`warning`/`destructive`/`info` em baixa intensidade; `outline`. Cantos `rounded-md`, não pílula. Usar só quando o estado ajuda a ler. |
| `Card` | Fundo `card`, borda fina, **sem sombra**. |
| `Input`, `Textarea`, `Select`, `Label` | Fundo neutro, borda fina; foco = borda `ring` + halo cinza de 20 %; erro = borda vermelha cheia, sem brilho. |
| `Table` | Cabeçalho `text-label` em cinza; separadores finos; hover cinza leve; selecionado = `accent` (cinza). |
| `Tooltip`, `DropdownMenu` | Superfície `popover`, borda, `shadow-md`. |
| `Dialog`, `Sheet` | `popover` + `shadow-lg`; véu `black/25` (claro) e `black/60` (escuro), sem desfoque. |
| Estados | `EmptyState`/`ErrorState` com borda tracejada; `PartialState` em `warning`. |
| Shell | Sidebar neutra; item ativo em `sidebar-accent` (cinza) com ícone na cor do texto; logo oficial no topo. |

Estados cobertos: hover, foco, selecionado (`aria-current`, `data-state=selected`,
`aria-checked`), erro (`aria-invalid`), desabilitado.

## Raios, sombras, movimento

- Raio base 8 px (`--radius: 0.5rem`): botões e campos `rounded-lg`; cards e modais
  `rounded-xl`; badges e itens de menu `rounded-md`.
- Sombras só em sobreposições (`shadow-md` menus/tooltips, `shadow-lg` modal/painel).
- Transições de 150 ms (padrão) a 200 ms, `ease-standard`. Hover = troca de cor;
  botão afunda 1 px ao clicar. Sem animação decorativa ou contínua (o `Skeleton`
  pulsa só enquanto carrega). `prefers-reduced-motion` zera animações e transições.

## Para o redesign global

- Migrar `diagnostico`, `campanhas`, `conexoes` e `advisor` das classes
  `amber/emerald/red/sky/violet-*` para os tokens.
- Aplicar a escala tipográfica e `text-metric` nas telas.
- Títulos de página que ainda dizem "v0-saas".
- `SelectValue` do Base UI mostra o *valor* (não o rótulo) até hidratar; ao usar
  `Select` nas telas, passar `items` ao `Select` para renderizar o rótulo no servidor.
