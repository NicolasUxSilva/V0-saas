# The Seed — Design System v1.0

Fundação visual do produto: tokens, temas, logo, tipografia, ícones, movimento e
componentes compartilhados, e a sua aplicação ao shell e às telas Diagnóstico,
Conexões, Advisor e login.

Revisão visual: `/dev/design-system` — uma tela-modelo montada só com os
componentes compartilhados. Exige login, como `/dev/states`.

## Direção

Referência de linguagem: **trysoro.com** (decisão de 2026-10-23), aplicada com as
regras já aprovadas de contenção de cor.

- **Do Soro:**
  - títulos em fonte display geométrica (Cal Sans);
  - superfícies brancas com cinza claríssimo;
  - cantos generosos (12–16 px);
  - botões, badges e filtros em pílula;
  - cabeçalho flutuante;
  - sidebar clara com item ativo em cinza;
  - uma única ação colorida por tela.
- **Do Soro, rejeitado:** o brilho colorido no CTA e o desfoque; continuam proibidos.
- **Mantido:** a interface é neutra e os dados são o centro. O verde aparece em
  poucas funções, cada uma bem definida (abaixo).

### Funções do verde

| Função | Cor | Onde |
|---|---|---|
| Marca | `#00BF63` | Logo (wordmark no claro), favicon, `chart-1` no escuro |
| Ação | `#008A49` | Botão `default`, uma ação principal por tela |
| Sucesso | `success` (verde-sálvia de baixa saturação) | Estados de sucesso e conexão, nunca como marca |
| Seleção | — | Neutra: fundo cinza (`accent` / `sidebar-accent`), sem verde |

## Onde ficam as coisas

| O quê | Arquivo |
|---|---|
| Tokens (cores, tipografia, raios, sombras, movimento) | `src/app/globals.css` |
| Fontes e script de tema | `src/app/layout.tsx` |
| Lógica de tema (pura, testada) | `src/lib/theme.ts` |
| Provedor e seletores de tema | `src/components/theme-provider.tsx`, `src/components/theme-switcher.tsx` |
| Logo | `src/components/brand/logo.tsx`, `public/brand/*.svg` |
| Favicon / ícone iOS | `src/app/icon.svg`, `src/app/apple-icon.png` |
| Gerador da logo | `scripts/generate-brand-assets.mjs` |
| Cabeçalho de página | `src/components/page-header.tsx` |
| Primitivos de UI (inclui `Alert`) | `src/components/ui/*` (shadcn `base-nova` sobre Base UI) |
| Estados (vazio, carregando, erro, parcial) | `src/components/states.tsx` |

Regra: componentes usam **tokens semânticos** (`bg-card`, `text-muted-foreground`,
`bg-primary`, `text-success`, `bg-warning-subtle`, `border-destructive-border`…).
Hex solto e paletas do Tailwind (`amber-500`, `emerald-50`…) não entram em código.
Fora de Campanhas, não restam classes de paleta fixa.

## Cores

### Neutros

| Token | Claro | Escuro | Papel |
|---|---|---|---|
| `background` | `#FFFFFF` | `#0B0C0B` | Fundo da página |
| `sidebar` | `#FAFBFA` | `#101210` | Sidebar |
| `card` | `#FFFFFF` | `#151715` | Cards |
| `popover` | `#FFFFFF` | `#1B1E1B` | Superfícies elevadas: menus, modais, painéis, tooltips |
| `secondary` / `accent` | `#F3F4F3` | `#1B1E1B` / `#1F221F` | Superfícies secundárias, hover, seleção |
| `muted` | `#F6F7F6` | `#181A18` | Fundos neutros discretos |
| `sidebar-accent` | `#ECEEEC` | `#1B1E1B` | Item ativo da navegação |
| `foreground` | `#202522` | `#F2F4F2` | Texto principal |
| `muted-foreground` | `#5C635D` | `#A0A69F` | Texto secundário |
| `subtle-foreground` | `#6A716B` | `#858D85` | Texto auxiliar |
| `border` | `#E6E8E6` | `#2B302C` | Bordas principais |
| `border-subtle` | `#EFF1EF` | `#222622` | Bordas secundárias |
| `input` | `#D3D8D3` | `#3A403B` | Borda de campo |
| `ring` | `#858C86` | `#787F79` | Foco (neutro) |

No escuro, as superfícies sobem em degraus pequenos de luminosidade (fundo → sidebar
→ card → elevada), sempre neutras. A separação vem do degrau mais a borda, nunca de
sombra.

### Ação e marca

| Token | Valor | Uso |
|---|---|---|
| `primary` / `-foreground` | `#008A49` / `#FFFFFF` | Botão principal (exceção de contraste aprovada, abaixo) |
| `primary-hover` | `#007A41` | Hover do botão principal |
| `brand` | `#00BF63` | Acento pontual de marca |
| `seed-green` / `seed-yellow` | `#00BF63` / `#FFDE59` | Cores da logo; não usar em componentes |

### Estados

Uma família: no escuro, mesma luminosidade e saturação baixa, variando só o matiz.
Cada estado tem três tokens. O fundo e a borda são derivados da cor por uma única
regra (`color-mix` sobre o `card`: 8 % / 30 % no claro, 12 % / 35 % no escuro).

| Estado | Cor (texto/ícone) claro · escuro | Classes |
|---|---|---|
| Sucesso | `#337344` · `#7CBD89` | `text-success` `bg-success-subtle` `border-success-border` |
| Atenção | `#875800` · `#D3A056` | `text-warning` `bg-warning-subtle` `border-warning-border` |
| Erro | `#A03F3C` · `#E47C75` | `text-destructive` `bg-destructive-subtle` `border-destructive-border` |
| Informação | `#386695` · `#7FAFE2` | `text-info` `bg-info-subtle` `border-info-border` |

São usados por `Badge` (variantes `success`/`warning`/`destructive`/`info`), `Alert`,
`PartialState`/`ErrorState`, avisos de Conexões, acentos dos insights e das camadas
do Advisor. Camadas sem significado de estado (fato, comparação, hipótese) ficam
neutras. O roxo que existia no Advisor foi removido.

### Gráficos

`chart-1…5`: claro `#008A49` `#5B635D` `#386695` `#875800` `#8C938D`; escuro
`#00BF63` `#B5BCB6` `#7FAFE2` `#D3A056` `#6C746E`.

### Contrastes medidos (WCAG 2.x)

Texto (mínimo 4,5:1):

| Par | Claro | Escuro |
|---|---|---|
| foreground / background | 15,6 | 17,73 |
| muted-foreground / fundo · card · elevada | 6,2 · 6,2 · 6,2 | 7,88 · 7,25 · 6,77 |
| subtle-foreground / fundo · card · elevada | 5,02 | 5,74 · 5,27 · 4,92 |
| primary-foreground / primary | **4,44** | **4,44** |
| primary-foreground / primary-hover | 5,44 | 5,44 |
| estado / fundo suave do estado (sucesso · atenção · erro · info) | 5,13 · 5,48 · 5,71 · 5,38 | 6,62 · 6,31 · 5,40 · 6,41 |

Não texto (mínimo 3:1): `ring` ≥ 3,45 no claro e ≥ 4,39 no escuro.

Limites deliberados: `border` (1,23:1 no claro; 1,34:1 sobre o card no escuro) e
`input` ficam abaixo de 3:1 para manter bordas finas.

### Exceção de contraste aprovada

| Data | Decisão |
|---|---|
| 2026-10-23 | `#008A49` permanece como verde de ação (`primary`) nos dois temas, por decisão de marca do responsável pelo produto. |

- **Medição:** branco sobre `#008A49` = **4,44:1**, 0,06 abaixo do AA para texto
  normal (4,5:1). Passa o AA para texto grande e para componente (3:1).
- **Onde se aplica:** só no rótulo dos botões `default` (14 px, peso 500). No hover
  (`#007A41`), o contraste sobe para 5,44:1.
- **Mitigação:** uma ação verde por tela, rótulo curto, nenhum texto verde sobre
  fundo claro. Em Conexões, os botões "Conectar" são neutros (`outline`).
- **Para cumprir o AA estrito no futuro:** `--primary: #007F41` (5,11:1).

## Temas

Três opções: **Claro**, **Escuro**, **Sistema** (padrão).

- **Persistência:** `localStorage["theseed-theme"]`.
- **Sem flash:** script inline no `<head>` aplica `.dark` antes da primeira pintura
  (guia `preventing-flash-before-hydration.md` do Next 16). Sem `next-themes`.
- **Sistema:** acompanha `prefers-color-scheme` ao vivo.
- **Troca:** instantânea, com as transições congeladas no instante da troca.
- **Outras abas:** sincronizadas pelo evento `storage`.
- **Onde trocar:** menu do usuário e controle no login.

## Logo

Fonte: `Asset-1.svg`, preservado byte a byte em
`public/brand/theseed-logo-original.svg`. O original tem a prancheta inteira em
verde, com o wordmark branco e o símbolo amarelo.

**Decisões (2026-10-23):** no produto a logo **não tem fundo**. O símbolo fica sempre
no amarelo original. O wordmark é **verde `#00BF63` no tema claro** e **branco
(original) no tema escuro**.

| Arquivo | O que é | Uso |
|---|---|---|
| `theseed-logo-original.svg` | Original intacto | Referência |
| `theseed-logo-light.svg` | Original sem o grupo do fundo, `.cls-3` (wordmark) em `#00bf63`, `viewBox="104 296 912 152"` | Tema claro |
| `theseed-logo-dark.svg` | Original sem o grupo do fundo, cores originais, mesmo `viewBox` | Tema escuro |
| `theseed-mark.svg` = `src/app/icon.svg` | Original recortado no símbolo, sem o wordmark (símbolo amarelo sobre o verde original) | Favicon |
| `src/app/apple-icon.png` | `theseed-mark.svg` rasterizado a 180 px | Ícone iOS |

- As formas nunca mudam; os testes conferem que cada arquivo só difere do original
  no que foi decidido.
- `<Logo />` renderiza os dois `<img>` e mostra um por tema (`dark:hidden` /
  `hidden dark:block`). Por serem `<img>`, nenhum CSS alcança as cores internas.
  Proibido: filtro, opacidade, blend.
- No claro, o broto amarelo tem 1,3:1 sobre o branco (sutil; logos são isentos de
  WCAG). No escuro, o branco tem 18:1 e o amarelo, 14,9:1.
- Para regerar: `node scripts/generate-brand-assets.mjs`; o PNG do iOS à parte
  (`qlmanage -t -s 180 public/brand/theseed-mark.svg`).

## Tipografia

- **Títulos** (`font-heading`): Cal Sans, só peso 400, sem serifa, por `next/font`.
  Usar em títulos de página, de seção e de card. Nunca com `font-semibold`.
- **Interface:** Geist Sans. **Dados técnicos:** Geist Mono.
- Toda a pilha tem fallback sem serifa.

| Classe | Fonte | Tamanho / altura | Peso | Uso |
|---|---|---|---|---|
| `font-heading text-title` | Cal Sans | 28 / 36 | 400 | Título de página (`PageHeader`) |
| `font-heading text-heading` | Cal Sans | 18 / 26 | 400 | Título de seção, `CardTitle`, título de estado |
| `text-body` | Geist | 14 / 20 | 400 | Texto de interface |
| `text-caption` | Geist | 12 / 16 | 400 | Legenda |
| `text-label` | Geist | 12 / 16 | 500 | Rótulo (sem caixa-alta) |
| `text-metric` | Geist | 24 / 32 | 600 | Métrica, com `tabular-nums` |

Rótulos e seções deixaram a caixa-alta e o espaçamento largo (estilo Soro).

## Formas e componentes

- **Raios:** base 12 px (`--radius: 0.75rem`). Cards, avisos, listas e estados usam
  `rounded-2xl`; campos usam `rounded-lg`; botões, badges, seletor de tema e status
  usam `rounded-full`.
- **Sombras:** só `shadow-xs` no cabeçalho flutuante e `shadow-md`/`shadow-lg` em
  sobreposições. Cards não têm sombra.

| Componente | Regra |
|---|---|
| `Button` | Pílula (`h-9`). `default` = verde, uma por tela; desabilitado neutro. `outline`/`secondary`/`ghost` neutros. `destructive` em `destructive-subtle`. |
| `Badge` | Pílula. Padrão neutro translúcido; variantes de estado com os tokens de estado. |
| `Alert` | Faixa com borda, fundo suave e ícone do estado; o texto fica na cor normal. |
| `Card` | `rounded-2xl`, borda fina, sem sombra, `p-5`; `CardTitle` em Cal Sans. |
| `Input`, `Select` | `h-9`, `rounded-lg`, foco neutro, erro com borda vermelha cheia. |
| `Table` | Cabeçalho `text-label` cinza; seleção em cinza. |
| `PageHeader` | Título Cal Sans + descrição cinza + selo opcional + ações. |
| Shell | Sidebar clara (`sidebar`), itens `rounded-xl` com ativo em `sidebar-accent`; cabeçalho flutuante `rounded-2xl` com borda, sobre faixa de fundo sólido. |

## Telas aplicadas

- **Login, shell, Diagnóstico, Conexões, Advisor** (página e `response-view`) e
  estados.
- **Campanhas fica de fora** por decisão de 2026-10-23: a Fase 3 está em andamento em
  outra sessão. Campanhas herda os tokens, o shell e os componentes compartilhados,
  mas suas telas e `components/campaigns/*` não foram editados e ainda têm classes de
  paleta fixa.
- **`advisor-workspace.tsx` não foi editado**, porque tem trabalho não commitado (a
  exportação em PDF) no checkout principal.

## Movimento

Transições de 150–200 ms (`ease-standard`). Sem animação decorativa.
`prefers-reduced-motion` zera animações e transições.
