# v0-saas

Motor de análise e diagnóstico de marketing — **ciclo V1 entregue** (estado em 2026-10-05).

> **Estado em uma frase:** três fontes reais conectadas (GA4, RD Station Marketing e RD Station CRM), um motor
> determinístico de diagnóstico, uma camada Cross-source persistida e um Advisor determinístico que responde sobre o
> fechamento oficial **01/09/2026 → 04/10/2026**. O modelo de linguagem (Anthropic) está implementado, **desligado** e
> ainda **não foi validado com geração real**. O Google Ads está preparado, mas sem conexão nem sync real.

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
está o problema. A tese da V0 foi validar se um motor determinístico consegue olhar
dados reais de uma empresa e apontar, com evidência suficiente, o que merece
investigação — de forma mais útil do que abrir o GA direto. A V1 acrescentou mais
fontes (RD Station), a camada Cross-source e o Advisor.

## O que existe hoje

### Fontes de dados

| Fonte | Estado | Dados reais do piloto |
|---|---|---|
| GA4 | Conector real (OAuth, descoberta de propriedades, `runReport`, sync) | Sim — histórico desde 2026-03-03, sem buracos |
| RD Station Marketing | Conector real (OAuth próprio; ativos de conversão) | Sim — 2 landing pages; a API só devolve os últimos **45 dias** (plano Pro) |
| RD Station CRM | Conector real (OAuth próprio; negociações por `updated_at`) | Sim — 736 negociações; histórico importado desde 2026-04-07; o CRM não informa moeda |
| Google Ads | Código pronto (OAuth, descoberta, extração, `AdsContext`, enriquecimento) | **Não** — sem conexão nem sync real (falta o developer token) |
| Meta Ads | Stub (`NotImplementedError`) | Não |

### Camadas

1. **Diagnóstico** (`/diagnostico`) — motor determinístico, sem LLM:
   `context → gates → detectores → contribution → templates → scoring → insights`.
   3 detectores (`conversion-efficiency-drop`, `traffic-volume-drop`, `data-quality`) sobre o GA4, janela de 28 dias.
   O Google Ads só acrescentaria evidência complementar (não há dado real hoje).
2. **Cross-source** (sem tela) — `buildCrossSourceInsights` relaciona GA4 × RD Marketing × RD CRM em um **período
   explícito**, separando **fatos, relações observáveis, hipóteses e limitações**; nunca afirma causalidade, atribuição,
   CAC, ROAS nem taxa entre fontes (as populações são diferentes). É persistido em `cross_source_insights` por uma
   **geração explícita** (`generateCrossSourceInsights`): não há botão, job nem política automática de regeneração
   (decisão em aberto).
3. **Advisor** (`/advisor`) — lê só `insights` e `cross_source_insights` já persistidos e responde a 9 intenções
   (resumo, fechamento, comercial, aquisição, problemas, comparação…). Toda resposta passa por um guard (número, data,
   evidência e moeda existem no contexto) e leva todas as limitações. **A IA interpreta; o sistema calcula.** O modelo
   de linguagem (Anthropic via `fetch`, sem SDK) fica atrás de `ADVISOR_LLM_ENABLED` (padrão `false`); sem ele, a
   pergunta livre devolve o resumo determinístico do período, dito como tal.

### Fechamento persistido (2026-10-05)

- **Oficial: 2026-09-01 → 2026-10-04** — 8 insights, gerado em 2026-10-05. GA4 6.443 sessões (34/34 dias) · RD Marketing
  12 visitas e 0 conversões · RD CRM 110 criados, 11 ganhos e 104 perdidos · valor dos ganhos 61.399,00 em 5 de 11 ganhos
  (moeda não informada pelo CRM). O último dia do GA4 pode estar provisório: o fechamento pode ser regenerado depois de
  ressincronizar.
- 2026-10-01 → 2026-10-04 — snapshot anterior, **defasado no GA4**; fica no banco só como histórico.

### Entrega

`pnpm test`: **1072 passam**, 32 opt-in pulados · `typecheck`, `lint` e `build` limpos · `db:generate` sem mudanças ·
código no GitHub (repositório privado), branch `main`.

## Limites operacionais

- **GA4 em modo Testing (OAuth):** o refresh token expira em ~7 dias — é preciso reconectar (a tela de Conexões mostra
  "Reautorização necessária"). Publicar/verificar o app OAuth remove o prazo.
- **Últimos dias do GA4:** o GA4 consolida em até ~48h; um fechamento que termina em D−1 pode ter o último dia
  provisório — ressincronize e regenere.
- **RD Marketing (plano Pro):** a API só alcança os últimos 45 dias — o sync precisa rodar ao menos a cada 45 dias.
- **RD CRM:** reflete o estado atual dos negócios (sem histórico de status), não informa moeda e não traz `campaign_id`
  — não há atribuição de negócios a campanhas.
- **Populações diferentes:** sessões (GA4), visitas e conversões (RD Marketing) e negócios (CRM) não são diretamente
  comparáveis — não há taxa, CAC, ROAS nem atribuição entre fontes.
- **LLM:** nunca validado com geração real (a conta do provedor estava sem crédito); sem limite de uso nem orçamento por
  workspace.
- **Antes de publicar:** remover a rota de revisão `/dev/states` e definir `maxDuration` da página do Advisor.

**Fora do escopo atual:** billing, cron/worker/sync agendado, multi-tenant real (V2), notificações, relatórios PDF,
Meta Ads e Search Console, chat/histórico/memória/RAG no Advisor, rate limit do LLM e deploy. Detalhes em
[`docs/v1-architecture.md`](docs/v1-architecture.md) §11.

## Arquitetura resumida

- **Next.js 16** (App Router), TypeScript strict, 1 app / 1 processo, sync manual inline (sem fila).
- **PostgreSQL** (Neon) + **Drizzle ORM**: 13 tabelas, 5 migrações, sem RLS / materialized view.
- **Auth.js v5** — login Google, sessão JWT pura (sem adapter). Tokens de terceiros cifrados em repouso (AES-256-GCM).
- **Camadas de dados:** `raw_records` (JSONB imutável, replayável) → fact tables canônicas, uma por forma de dado
  (`fact_traffic_daily`, `fact_ad_performance_daily`, `fact_conversion_assets_daily`, `fact_deals`) → `insights`
  (diagnóstico) e `cross_source_insights` (Cross-source).
- **Conectores** por trás de uma interface + registry: GA4, RD Marketing, RD CRM e Google Ads implementados; Meta Ads
  é stub.
- **Fluxo:**

```
fontes (GA4 · RD Marketing · RD CRM · Google Ads*)
  → connector.pull → raw_records → fact_* (canônico)
  → buildAnalysisContext (único ponto que lê as fontes)
        ├─ motor determinístico → insights → /diagnostico
        └─ Cross-source (puro) → cross_source_insights      (geração explícita)
                                        │ (só leitura)
                                        ▼
                      Advisor (determinístico; LLM desligado) → /advisor
* sem conexão nem dado real hoje
```

```
src/
  app/                 rotas (App Router): /login, (app)/{diagnostico, advisor, conexoes, dev/states},
                       /api/{auth, health, oauth/[provider]}
  components/          UI (shell, states, insight-card, conexões, advisor/, ui/)
  lib/                 dates, format, insight, advisor-period, utils
  env.ts               validação das variáveis de ambiente (Zod)
  proxy.ts             portão de rota (Next 16: middleware → proxy)
  server/
    db/                cliente Drizzle, schema e migrações (0000–0004)
    auth/              Auth.js v5 (Google, JWT)
    crypto.ts          AES-256-GCM dos tokens OAuth
    connectors/        contrato + registry + shared/ + google/ + ga4/ + google_ads/ + rd_station_marketing/
                       + rd_station_crm/ (+ stubs)
    sync/              run-sync (pull → raw → normalize → análise) + normalize
    analysis/          motor (context, gates, detectors, contribution, templates, scoring, engine, enrichment,
                       period) + cross-source/ + cross-source-store
    advisor/           Advisor (contexto, serviço, guard, modelo determinístico) + llm/ (Anthropic, atrás de flag)
  mock.ts              fixtures da UI (USE_MOCK=true)
docs/                  v1-architecture (arquitetura), ga4-setup (guia operacional), v0-plan (histórico da V0)
PROJECT_STATE.md       estado atual e registro de desenvolvimento
```

## Como rodar localmente

Pré-requisitos: Node 24+, Corepack habilitado (`corepack enable`; o projeto usa pnpm 11).

```bash
pnpm install
cp .env.example .env.local   # e preencher (ver seção abaixo)
pnpm dev                      # http://localhost:3000
```

Verificações:

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # Vitest — src/server/**
pnpm build       # build de produção (Turbopack)
```

Health check: <http://localhost:3000/api/health>

Banco (com a `DATABASE_URL` do Neon preenchida). A fonte da verdade do schema são as **migrações** versionadas:

```bash
pnpm db:generate   # gera a migração a partir do schema (deve responder "No schema changes" se nada mudou)
pnpm db:migrate    # aplica as migrações no Neon
pnpm db:push       # só para verificar ("No changes detected")
pnpm db:studio     # inspeciona os dados
```

Testes: `pnpm test` roda offline (1072 passam, 32 opt-in são pulados). Os testes opt-in — integração com o Postgres real
(somente leitura) e avaliação ao vivo do LLM — só rodam com variáveis explícitas; os comandos estão em
[`PROJECT_STATE.md`](PROJECT_STATE.md) (§15–§17).

## Variáveis de ambiente

Definidas e documentadas em `.env.example`. Copie para `.env.local` (não versionado). O app **não sobe** sem as
variáveis obrigatórias (`src/env.ts` valida tudo por Zod no boot).

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `DATABASE_URL` | sim | — | Conexão Postgres do Neon (usar a conexão direta, sem `-pooler`). |
| `AUTH_SECRET` | sim | — | Segredo da sessão JWT e do `state` do OAuth. `openssl rand -base64 32`. |
| `AUTH_URL` | não | `http://localhost:3000` | URL base da app. |
| `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_OAUTH_CLIENT_SECRET` | sim | — | OAuth Client (Web) do Google Cloud — login, dados GA4 e Google Ads. |
| `GA4_REDIRECT_URI` | não | `http://localhost:3000/api/oauth/ga4/callback` | Redirect do fluxo de dados GA4 (separado do de login). |
| `APP_ENCRYPTION_KEY` | sim | — | Chave AES-256-GCM p/ cifrar tokens de terceiros (32 bytes em base64). `openssl rand -base64 32`. |
| `USE_MOCK` | não | `true` | `true` = UI com dados mockados; `false` = dados reais. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` · `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | não | — | Google Ads (token Basic access de uma conta MCC; id do MCC). Sem o token não há descoberta nem sync real. |
| `RD_MARKETING_CLIENT_ID` · `RD_MARKETING_CLIENT_SECRET` | não | — | App do RD Station Marketing (App Publisher). |
| `RD_CRM_CLIENT_ID` · `RD_CRM_CLIENT_SECRET` | não | — | App **separado** do RD Station CRM. |
| `ADVISOR_ENABLED` | não | `true` | Liga a tela `/advisor` e o server action. |
| `ADVISOR_LLM_ENABLED` | não | `false` | Liga o modelo de linguagem do Advisor (independente de `ADVISOR_ENABLED`). |
| `ANTHROPIC_API_KEY` | não | — | Credencial da API da Anthropic; vazio = ausente (o Advisor responde só de forma determinística). |
| `ADVISOR_LLM_MODEL` · `ADVISOR_LLM_EFFORT` · `ADVISOR_LLM_TIMEOUT_MS` | não | `claude-sonnet-5-5` · `medium` · `90000` | Modelo, esforço (`low`/`medium`/`high`) e tempo limite (5000–300000 ms). |

## Documentação

- [`PROJECT_STATE.md`](PROJECT_STATE.md) — estado atual e registro de desenvolvimento (comece pelo bloco "Estado atual").
- [`docs/v1-architecture.md`](docs/v1-architecture.md) — arquitetura V1: decisões, invariantes, pipeline, Cross-source e Advisor.
- [`docs/ga4-setup.md`](docs/ga4-setup.md) — guia operacional para conectar um GA4 real.
- [`docs/v0-plan.md`](docs/v0-plan.md) — plano e tese da V0 (histórico).
- `.env.example` — referência das variáveis de ambiente.

## Histórico dos blocos

A implementação seguiu bloco a bloco; ao fim de cada bloco os checks rodaram e o trabalho pausou para confirmação.

### V0 (GA4 + motor determinístico)

| Bloco | Entrega |
|---|---|
| **A0** | Esqueleto: Next + TS strict + pnpm, `env.ts`, `.env.example`, `drizzle.config.ts`, `/api/health`, `docs/v0-plan.md`, `README.md`. |
| **A1** | Schema Drizzle (9 tabelas na época) + conexão verificada com o Neon. |
| **A2** | Auth.js (Google) + `proxy.ts` + `/login` + criação de workspace no 1º login. |
| **A3** | Shell (sidebar, topbar) + sistema de estados (loading/error/empty/partial). |
| **A4** | Telas `/diagnostico` e `/conexoes` com dados mockados — revisão de layout. |
| **B0** | `crypto` + interface `Connector` + `registry` + stubs. |
| **B1** | OAuth GA4 real (start/callback) + descoberta de propriedades. |
| **B2** | Tela de conexões + seleção de propriedade. |
| **B3** | Extração `runReport` (180d) + normalização → `fact_traffic_daily` + "Atualizar dados". |
| **C0–C4** | Motor de análise: `stats`, `gates`, `context`, `contribution`, `detectors`, `engine` (+ testes Vitest). |
| **C5** | Motor plugado ao sync; `/diagnostico` com insights reais; feedback 👍/👎; `USE_MOCK=false`. |
| **D0** | `docs/ga4-setup.md` + verificação dos critérios funcionais (F1–F9). |
| **D1** | Teste com o GA4 real do piloto (**MS Server**): validação técnica e correções concluídas; a validação de produto (rating cego, P1–P4) está **fora do escopo atual**. |

### V1 (mais fontes, Cross-source e Advisor)

| Bloco | Entrega |
|---|---|
| **G1** | Refactor de conectores: `connectors/shared/`, OAuth Google compartilhado, rotas `/api/oauth/[provider]/*`, `runSync` genérico, `platform` em `fact_traffic_daily`. |
| **G2–G3** | Google Ads: OAuth, descoberta de contas, extração campanha × dia → `fact_ad_performance_daily` (sync real bloqueado pelo developer token). |
| **G4–G6** | Análise em nível de workspace (`runWorkspaceAnalysis`), `AdsContext` no `AnalysisContext` e enriquecimento determinístico com Google Ads (só evidência). |
| **RD-1** | RD Station Marketing e CRM: conectores, `fact_conversion_assets_daily`, `fact_deals`, período explícito no `AnalysisContext`. |
| **Cross-source V1/V1.1** | Camada própria + `cross_source_insights` + `generateCrossSourceInsights` / `getCrossSourceInsights`. |
| **G7 / G7b** | Advisor determinístico (`/advisor`) e modelo de linguagem atrás de flag (desligado). |
| **Fechamento V1** | Pergunta livre sem LLM = resumo determinístico dito como tal; correção de `*_deals_with_value`; fechamento oficial 01/09→04/10 gerado (2026-10-05). |

Registro completo por bloco: [`PROJECT_STATE.md`](PROJECT_STATE.md) §14–§17 e [`docs/v1-architecture.md`](docs/v1-architecture.md) §12.
