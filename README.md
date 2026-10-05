# v0-saas

Motor de análise e diagnóstico de marketing — **versão V0 (validação)**.

## O que é o produto

Um sistema que conecta as fontes de dados de marketing de uma empresa, normaliza
esses dados numa camada comum e roda um **motor determinístico de análise** que
produz **diagnósticos acionáveis**: onde está o gargalo, o que mudou, por que
provavelmente mudou e o que investigar primeiro.

Não é um dashboard. O dashboard/métricas é apenas camada de apoio. A experiência
principal é:

```
DADO → ANÁLISE → PROBLEMA/OPORTUNIDADE → EVIDÊNCIA → HIPÓTESE → AÇÃO
```

Cada insight responde, nesta ordem: **o que** aconteceu, **quanto** mudou, **onde**
está concentrado, **por que** os dados sustentam a hipótese, **o que** fazer agora.
Todo insight carrega evidência quantitativa (número, comparação temporal, dimensão
responsável). Quando os dados não sustentam uma conclusão, o produto diz isso — não
inventa diagnóstico.

## Qual problema estamos resolvendo

Ferramentas como o Google Analytics mostram **métricas**; poucas transformam esses
dados em **diagnóstico**. O usuário precisa garimpar relatórios para descobrir onde
está o problema. A tese da V0 é validar se um motor determinístico consegue olhar
dados reais de uma empresa e apontar, com evidência suficiente, o que merece
investigação — de forma mais útil do que abrir o GA direto.

## Escopo da V0

Espinha única, ponta a ponta:

```
Login → conexão OAuth com GA4 → seleção da propriedade → sincronização (180 dias)
      → normalização → motor determinístico de análise → tela Diagnóstico
      → validação manual (útil / não útil)
```

**Dentro:** 1 conector real (GA4), motor determinístico com 3 detectores
(`conversion-efficiency-drop`, `traffic-volume-drop`, `data-quality`), tela
Diagnóstico, login Google, 1 workspace, sync manual.

**Fora (preparado, não implementado):** conectores Google Ads / Meta Ads / RD
Station, LLM / IA generativa, billing, cron/worker, multi-tenancy avançado,
notificações, relatórios PDF, identidade visual definitiva.

Detalhes completos: [`docs/v0-plan.md`](docs/v0-plan.md).

## Arquitetura resumida

- **Next.js 16** (App Router), TypeScript strict, 1 app / 1 processo, sync inline.
- **PostgreSQL** (Neon) + **Drizzle ORM**. 9 tabelas, sem RLS / materialized view.
- **Auth.js v5** — login Google, sessão JWT pura (sem adapter).
- **Camadas de dados:** `raw_records` (JSONB imutável, replayável) →
  `fact_traffic_daily` (canônico, agnóstico de fonte) → `insights` (saída estruturada).
- **Conectores** por trás de uma interface + registry: GA4 implementado; Google Ads
  / Meta Ads / RD Station registrados como stubs para V1.
- **Motor de análise** (`src/server/analysis/`): `context → gates → detectores →
  contribution → templates → scoring → insights`. Determinístico, sem LLM.
- Cliente GA4: `google-auth-library` + `fetch` (Admin API + Data API).

```
src/
  app/                 rotas (App Router) + route handlers + server actions
  env.ts               validação das variáveis de ambiente (Zod)
  server/
    db/                cliente Drizzle + schema
    connectors/        types + registry + ga4/ (real) + stubs
    sync/              extract → raw → normalize + crypto
    metrics/           dicionário de fórmulas + queries
    analysis/          o motor (context, gates, contribution, detectors, engine)
  components/           UI (shell, states, insight-card, charts)
  mock.ts              fixtures para validar a UI no bloco A
docs/v0-plan.md        plano completo da V0
```

## Como rodar localmente

Pré-requisitos: Node 24+, Corepack habilitado (`corepack enable`).

```bash
pnpm install
cp .env.example .env.local   # e preencher (ver seção abaixo)
pnpm dev                      # http://localhost:3000
```

Verificações:

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm build       # build de produção (Turbopack)
```

Health check: <http://localhost:3000/api/health>

Banco (a partir do bloco A1, com a `DATABASE_URL` do Neon preenchida):

```bash
pnpm db:push     # aplica o schema no Neon
pnpm db:studio   # inspeciona os dados
```

Testes (a partir do bloco C0):

```bash
pnpm test        # Vitest — apenas src/server/analysis/
```

## Variáveis de ambiente

Definidas e documentadas em `.env.example`. Copie para `.env.local` (não versionado).
A tag indica em qual bloco cada variável passa a ser usada.

| Variável | Bloco | Descrição |
|---|---|---|
| `DATABASE_URL` | A1 | Conexão Postgres do Neon (usar a conexão direta, sem `-pooler`). |
| `USE_MOCK` | A0→C5 | `true` = UI com dados mockados; vira `false` no C5. |
| `AUTH_SECRET` | A2 | Segredo da sessão JWT do Auth.js. `openssl rand -base64 32`. |
| `AUTH_URL` | A2 | URL base da app. Dev: `http://localhost:3000`. |
| `GOOGLE_OAUTH_CLIENT_ID` | B1 | OAuth Client (Web) do Google Cloud — login **e** dados GA4. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | B1 | Secret do mesmo client. |
| `GA4_REDIRECT_URI` | B1 | Redirect do fluxo de dados GA4 (separado do de login). |
| `APP_ENCRYPTION_KEY` | B0 | Chave AES-256-GCM p/ cifrar tokens de terceiros. `openssl rand -base64 32`. |

Nenhum serviço externo é necessário para os blocos A0. As instruções de criação de
conta Neon e do OAuth Client do Google são fornecidas nos blocos A1 e B1.

## Ordem dos blocos de implementação

A implementação segue bloco a bloco; ao fim de cada bloco os checks rodam e o
trabalho pausa para confirmação.

| Bloco | Entrega |
|---|---|
| **A0** | Esqueleto: Next + TS strict + pnpm, `env.ts`, `.env.example`, `drizzle.config.ts`, `/api/health`, `docs/v0-plan.md`, `README.md`. |
| **A1** | Schema Drizzle (9 tabelas) + conexão verificada com o Neon. |
| **A2** | Auth.js (Google) + `proxy.ts` + `/login` + criação de workspace no 1º login. |
| **A3** | Shell (sidebar, topbar) + sistema de estados (loading/error/empty/partial). |
| **A4** | Telas `/diagnostico` e `/conexoes` com dados mockados — revisão de layout. |
| **B0** | `crypto` + interface `Connector` + `registry` + stubs (Ads/Meta/RD). |
| **B1** | OAuth GA4 real (start/callback) + descoberta de propriedades. |
| **B2** | Tela de conexões + seleção de propriedade. |
| **B3** | Extração `runReport` (180d) + normalização → `fact_traffic_daily` + "Atualizar dados". |
| **B4** | Queries de métricas + bloco "Métricas de apoio" com dados reais. |
| **C0–C4** | Motor de análise: `stats`, `gates`, `context`, `contribution`, `detectors`, `engine` (+ testes Vitest). |
| **C5** | Motor plugado ao sync; `/diagnostico` com insights reais; feedback 👍/👎; `USE_MOCK=false`. |
| **D0** | `docs/ga4-setup.md` + verificação dos critérios funcionais (F1–F9). |
| **D1** | Teste com o GA4 real da **MS Server** + sessão de validação (P1–P4). |
