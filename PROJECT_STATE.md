# PROJECT_STATE — v0-saas

> Estado e registro de desenvolvimento do projeto. **Comece por "Estado atual (2026-10-05)" logo abaixo.**
> O restante do documento tem duas partes: o **checkpoint original da V0** (§1–§13, de 2026-09-02, com
> atualizações pontuais de 2026-10-05) e o **registro do ciclo V1, por bloco** (§14–§17). Seções marcadas como
> "V0" ou "histórico" são registro — o estado atual está no bloco abaixo e em §14–§17.

## Estado atual (2026-10-05)

**Entrega.** O Advisor V1 está entregue em modo determinístico. A integração com o modelo de linguagem (Anthropic, via
`fetch`, sem SDK) está **implementada e desligada** (`ADVISOR_LLM_ENABLED=false`) e **nunca foi validada com geração
real** (a conta do provedor estava sem crédito); o fallback determinístico funciona. Nenhuma chamada paga à Anthropic
foi feita. Validação: `pnpm test` → **1072 passam, 32 opt-in pulados**; `typecheck`, `lint` e `build` limpos;
`db:generate` → "No schema changes". Código no GitHub (repositório privado, branch `main`); até esta atualização de
documentação, `main` era o commit único `4a36c36 feat: finalize advisor v1`, igual ao `origin/main`, com a árvore limpa.

**Fontes (dados reais do piloto).**

| Fonte | Estado | Observações |
|---|---|---|
| GA4 | conectado, dados reais | 2026-03-03 → 2026-10-05, sem buracos; 0 eventos-chave; OAuth em modo Testing |
| RD Station Marketing | conectado, dados reais | 2 landing pages; guarda 2026-08-21 → 2026-10-04; a API só devolve 45 dias |
| RD Station CRM | conectado, dados reais | 736 negociações; `importedHistoryStartDate` = 2026-04-07; sem moeda; `campaign_id` em 0% |
| Google Ads | código pronto, **sem conexão nem sync real** | falta o `GOOGLE_ADS_DEVELOPER_TOKEN`; `fact_ad_performance_daily` = 0 |
| Meta Ads | stub | — |

**Cross-source persistido** (`cross_source_insights`: 16 linhas = 2 snapshots).
- **Fechamento oficial: 2026-09-01 → 2026-10-04** (34 dias) — 8 insights, gerado em 2026-10-05T13:51:56Z (geração
  explícita, só em `cross_source_insights`, já com o gerador corrigido). GA4 6.443 sessões (34/34 dias) · RD Marketing
  12 visitas e 0 conversões (34/34 dias) · RD CRM 110 criados, 11 ganhos e 104 perdidos · valor dos ganhos 61.399,00
  (soma de 5 de 11 ganhos com valor; moeda não informada). O Advisor determinístico responde sobre este período.
- **2026-10-01 → 2026-10-04 — snapshot anterior** (histórico etiquetado): 8 insights, gerado em 2026-10-04T20:10Z,
  **defasado no GA4** (487 sessões no snapshot × 541 hoje: o dia 04/10 foi reescrito por um sync posterior) e ainda com
  o formato antigo de `rd_crm.lost_deals_with_value`. Fica no banco; não é o fechamento oficial.
- O 04/10 do GA4 pode estar provisório (o GA4 consolida em até ~48h): o fechamento pode ser regenerado depois de
  ressincronizar (idempotente; só atualiza o que mudar).
- **Não há política automática de regeneração**, nem botão ou job: gerar é sempre uma chamada explícita (INV-16) —
  decisão em aberto.

**Limites operacionais.** (i) RD Marketing: a API só alcança 45 dias — o sync precisa rodar ao menos a cada 45 dias
(01/09 é alcançável até 15/10/2026; já está guardado). (ii) GA4 em modo Testing: o refresh token expira em ~7 dias
(falhas de renovação em 10/09, 17/09, 22/09 e 04/10; reconexão mais recente em 2026-10-04 18:43; próxima expiração
estimada ~11/10). (iii) CRM sem moeda, `campaign_id` em 0% e só o estado atual dos negócios. (iv) GA4, RD Marketing e
RD CRM medem populações diferentes — não se comparam diretamente (sem taxa, CAC, ROAS nem atribuição entre fontes).

**Fora do escopo atual / em aberto.** Validação de produto da V0 com o Márcio (rating cego, P2/P3 — D1):
**fora do escopo atual** (decisão de 2026-10-05); a calibração da severidade (#5) segue adiada; política de
regeneração do Cross-source; leitura ao vivo do `AnalysisContext`; limite de uso e `maxDuration` do LLM; avaliação ao
vivo do LLM antes de ligá-lo. Próximos passos: §12.

**Leitura.** §14–§17 = registro por bloco (histórico válido). §1–§13 = checkpoint da V0 (2026-09-02), com atualizações
de 2026-10-05 em §2, §6–§9 e §11–§13; §3–§5 e §10 permanecem como registro da V0.

---

### Checkpoint original da V0 (2026-09-02) — histórico

> Estado do projeto **v0-saas** em 2026-09-02, após **C5** (motor plugado ao
> sync + `/diagnostico` real), **D0** (`docs/ga4-setup.md`, 4 estados + topbar) e
> **D1** (validação com a MS Server + correções #1/#2/#3/#4/#6/#7: feedback
> preservado no re-sync, identidade por `dedupe_key`, título por canal,
> z deseasonalizado, evidência do `data_quality`).
> Documento de recuperação: retome pela seção [Onde retomar](#13-onde-retomar).
>
> **Próximo:** com o Marcio — rating cego do piloto (P2/P3). Depois: calibrar a
> severidade (#5), usando `gate_trace.severityInputs`. Nada mais no motor muda
> sem aprovação. *(Superado em 2026-10-05: o D1 de produto está fora do escopo atual — ver "Estado atual".)*

> **Atualização (2026-09-24):** o checkpoint acima descreve o fim da V0. Desde
> então o ciclo **V1** avançou até o bloco **G6** (Google Ads OAuth/discovery/
> extração histórica, orquestração da análise em nível de workspace, contexto
> composto de Ads e enriquecimento cross-source determinístico) — ver
> **§14 (Ciclo V1)**, ao final deste documento, para o resumo completo e o
> estado real mais recente (inclui a reconexão do GA4 em 2026-09-22 e a
> regressão real de 2026-09-24). As decisões de V0 registradas abaixo
> **continuam em vigor**; nada neste documento foi apagado. *(Em 2026-10-05, §2, §6–§9 e §11–§13 receberam
> atualizações pontuais — ver "Estado atual".)*

> **Atualização (2026-10-04):** depois do G6 entraram, fora da sequência G, o
> **RD-1** (RD Station Marketing e RD CRM como fontes reais) e o **Cross-source
> V1/V1.1** — camada própria e determinística, persistida em
> `cross_source_insights`, com período explícito no `AnalysisContext` e a regra
> definitiva "linha com valor 0 ≠ ausência de dado". O primeiro conjunto real
> (workspace piloto × 01–04/10/2026, 8 insights) está persistido. Ver **§15**.

> **Atualização (2026-10-04 — Advisor):** a **fundação do Advisor (G7) foi
> implementada, sem LLM**: `AdvisorContext` (composição pura sobre `insights` +
> `cross_source_insights` persistidos), `AdvisorQuery`, `AdvisorResponse`,
> `AdvisorModel` + `DeterministicAdvisorModel`, serviço, guard de saída e a tela
> `/advisor`. É somente leitura, sem migração e sem chamada externa. **Nenhum LLM
> está conectado.** Ver **§16**, ao final deste documento.

> **Atualização (2026-10-04 — Advisor LLM):** o **modelo de linguagem foi
> conectado** à fundação, **atrás de `ADVISOR_LLM_ENABLED` (padrão `false`)**:
> Anthropic via `fetch` (sem SDK, nenhuma dependência nova) por trás de
> `AdvisorModel`/`LlmTransport`, com projeção do contexto sem PII, schema Zod,
> guard estrito e fallback determinístico. Sem migração, sem escrita, sem
> ferramentas, sem acesso do LLM ao banco. Ver **§17**.

> **Atualização (2026-10-05 — fechamento do Advisor V1):** estado de entrega —
> **Advisor determinístico pronto; LLM/Anthropic implementado e desligado
> (`ADVISOR_LLM_ENABLED=false`); fallback e dados reais funcionando; nenhuma
> chamada paga à Anthropic.** Duas correções já identificadas: o formato das
> contagens `*_deals_with_value` no Cross-source (`metric-not-computable`) e a
> pergunta livre com o LLM desligado (resumo determinístico dito como tal). **A
> pendência de regenerar o conjunto de 01–04/10 foi superada no mesmo dia:** o fechamento oficial é
> 01/09→04/10 (gerado em 2026-10-05) e o conjunto de 01–04/10 ficou como histórico etiquetado. Ver "Estado atual"
> e **§17**.

> **Atualização (2026-10-05 — fechamento oficial do Cross-source):** o período **2026-09-01 → 2026-10-04** foi gerado
> e persistido (8 insights; `generated_at` 2026-10-05T13:51:56Z), com dry-run prévio e escrita só em
> `cross_source_insights`. Ver **"Estado atual"** e **§17**.

---

## 1. O que é

*(Descrição da V0, de 2026-09-02. O escopo atual — três fontes reais, Cross-source e Advisor — está em "Estado atual", no topo.)*

Motor de análise e diagnóstico de marketing — **V0 de validação**. Objetivo:
conectar um GA4 real, importar dados, e produzir **diagnósticos acionáveis**
(determinísticos, sem LLM) mais úteis do que olhar métricas cruas.

Plano completo e decisões de escopo: [`docs/v0-plan.md`](docs/v0-plan.md).
Espinha da V0: **Login → OAuth GA4 → seleção de propriedade → sync 180d →
normalização → motor determinístico → tela Diagnóstico**.

---

## 2. Arquitetura atual

*(Atualizada em 2026-10-05. Desenho, decisões e invariantes: `docs/v1-architecture.md`.)*

```
Next.js 16.3.3 (App Router) · 1 app · 1 processo · sync manual inline
│
├─ UI (Server Components + ilhas "use client")
│   /login · (app)/{diagnostico, advisor, conexoes, dev/states} + loading.tsx/error.tsx
│   shell (sidebar: Diagnóstico · Advisor · Conexões; topbar com "Atualizado há X" real)
│   estados: Loading/Empty/Error/Partial (src/components/states.tsx) integrados
│   componentes: shell, states, insight-card, connection-cards, property-picker,
│               google-ads-account-picker, sync-button, google-ads-sync-button,
│               rd-station-sync-button, diagnostico-summary, support-metrics,
│               advisor/{advisor-workspace, response-view}, ui/* (shadcn)
│
├─ Route handlers
│   /api/auth/[...nextauth]                  Auth.js v5 (Google, sessão JWT)
│   /api/oauth/[provider]/{start,callback}   OAuth genérico por conector (state HMAC)
│   /api/health
│
├─ src/proxy.ts               portão de rota (Next 16: "middleware" → "proxy")
│
├─ CONECTORES  src/server/connectors/
│   types.ts (contrato Connector) · registry.ts (provider→Connector) · stubs.ts
│   shared/ (oauth-state · token · connection) · google/oauth.ts (OAuth Google compartilhado)
│   ga4/ · google_ads/ · rd_station_marketing/ · rd_station_crm/  → REAIS e registrados (implemented: true)
│   meta_ads (e o legado rd_station) → stubs (NotImplementedError)
│   Google Ads: código pronto, sem conexão nem sync real (falta o developer token)
│
├─ SYNC  src/server/sync/
│   run-sync.ts   runSync({connectionId}): janela → sync_run → token → pull → raw → normalize → runWorkspaceAnalysis
│   normalize.ts  upserts idempotentes por source_hash (traffic · ad_performance · conversion_assets · deals)
│
├─ MOTOR DE ANÁLISE  src/server/analysis/  (determinístico, sem LLM)
│   context → gates → detectors → contribution → templates → scoring → engine → enrichment (Google Ads: só evidência)
│   (só context.ts lê as fontes; só engine.ts escreve `insights`; o resto é puro)
│
├─ CROSS-SOURCE  src/server/analysis/cross-source/ + cross-source-store.ts  (camada própria, pura)
│   buildCrossSourceInsights(ctx) → fatos · relações observáveis · hipóteses · limitações
│   generateCrossSourceInsights (a ÚNICA que escreve `cross_source_insights`; chamada explícita) · getCrossSourceInsights (só lê)
│
├─ ADVISOR  src/server/advisor/  (somente leitura: `insights` + `cross_source_insights`)
│   contexto → serviço → guard → AdvisorResponse; modelo determinístico (padrão) e llm/ (Anthropic, atrás de ADVISOR_LLM_ENABLED=false)
│
├─ crypto.ts   AES-256-GCM (tokens OAuth em repouso, coluna bytea, key_version)
│
└─ BANCO  PostgreSQL (Neon) + Drizzle ORM
    13 tabelas · 8 enums · 5 migrações (0000–0004) · sem RLS/MV/partição
```

**Stack:** Next 16.3.3 · React 19.2 · TypeScript strict (`noUncheckedIndexedAccess`)
· pnpm 11.24 (Corepack) · Tailwind v4 + shadcn/ui (preset `base-nova` → **Base UI**,
não Radix) · Drizzle 0.45 + `postgres` (postgres.js) · Auth.js `next-auth@5.0.0-beta.32`
· `google-auth-library@11` · Zod 4 · Vitest 4 (`src/server/**`).

**Convenções relevantes do Next 16** (já absorvidas): `middleware` → arquivo/export
`proxy`; Request APIs (`cookies`/`headers`/`params`/`searchParams`) assíncronas;
Turbopack padrão; `next lint` removido (usa `eslint`).

---

## 3. Blocos concluídos

| Bloco | Entrega | Status |
|---|---|---|
| **A0** | Esqueleto: Next+TS+pnpm, `env.ts`, `.env.example`, drizzle config, `/api/health`, docs | ✅ |
| **A1** | Schema Drizzle (9 tabelas) + 1ª migração aplicada no Neon | ✅ |
| **A2** | Auth.js (Google, JWT) + `proxy.ts` + `/login` + criação de workspace no 1º login | ✅ (login real testado pelo usuário) |
| **A3** | Shell (sidebar/topbar) + sistema de estados + shadcn/ui | ✅ (+ correção do Console Error do Base UI) |
| **A4** | `/diagnostico` (Resumo + 4 seções + InsightCard) e `/conexoes` (shell) com `src/mock.ts` | ✅ (aprovado visualmente) |
| **B0** | `crypto.ts` + `connectors/types.ts` + `registry.ts` + `stubs.ts` | ✅ (round-trip de cifra + registry validados) |
| **B1** | OAuth GA4 real: `start` + `callback` + `ga4/auth.ts` + `ga4/discovery.ts` | ✅ (connect real testado pelo usuário) |
| **B2** | Tela Conexões (estado conectado) + seleção de propriedade + desconectar | ✅ (seleção real testada; tz/moeda buscados da Admin API) |
| **B3** | `ga4` extract `runReport` + `sync.ts` normalize → `fact_traffic_daily` + "Atualizar dados" + `sync_runs` | ✅ (import real de 180d; idempotência validada) |
| **C (C0–C4)** | Motor determinístico: types, stats, gates, context, contribution, templates, scoring, detectors, engine + 31 testes | ✅ (rodado contra os 2340 registros reais) |
| **C5** | `runAnalysis` plugado ao fim do sync · `/diagnostico` lê `insights` reais (`USE_MOCK=false`) · seam `diagnostico/data.ts` · feedback (reconhecer/reabrir/descartar/👍👎) persiste em `insights.status`/`rating` | ✅ (sync real do usuário gerou `data-quality` + `traffic-volume-drop` reais) |
| **D0** | `docs/ga4-setup.md` · 4 estados (`Loading/Empty/Error/Partial`) integrados às telas + `loading.tsx`/`error.tsx` no `(app)` · aviso de sync `partial` · topbar reflete `last_synced_at` real · auditoria F1–F9 | ✅ |

**Pendente (V0):** **D1 de produto** — validação com a MS Server (rating cego do Marcio, P2/P3; plano §11–12).
**Fora do escopo atual** (decisão de 2026-10-05); o D1 técnico foi concluído (§12). Ver [Onde retomar](#13-onde-retomar).

---

## 4. Arquivos por bloco

> "criado" = novo neste bloco; "alterado" = já existia e foi editado.
> Scaffold do `create-next-app` (layout/page/globals/AGENTS.md/CLAUDE.md/configs) veio no A0.

### A0 — esqueleto
- **criados:** `src/env.ts`, `src/load-env.ts`, `drizzle.config.ts`, `src/server/db/schema.ts` (placeholder), `src/app/api/health/route.ts`, `.env.example`, `.env.local`, `docs/v0-plan.md`, `README.md`
- **alterados:** `package.json` (scripts `typecheck`/`db:*`), `tsconfig.json` (`noUncheckedIndexedAccess`), `src/app/layout.tsx` (metadata, `lang=pt-BR`), `src/app/page.tsx` (placeholder mínimo), `.gitignore` (`!.env.example`), `pnpm-workspace.yaml` (libera build do `esbuild`)
- **outros:** pasta renomeada `V0 SAAS` → `v0-saas`; `git init` em `main`; telemetria do Next desativada. **Next 16.3.3**, não 15 (`@latest`).

### A1 — schema
- **criados:** `src/server/db/schema.ts` (9 tabelas + 8 enums, substituiu o placeholder), `src/server/db/index.ts` (cliente Drizzle + postgres.js), `src/server/db/migrations/0000_fast_catseye.sql` + `meta/{_journal,0000_snapshot}.json`
- Migração `0000` gerada e aplicada; `db:push` "No changes".

### A2 — autenticação
- **criados:** `src/server/auth/{config,index,provision,types}.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/proxy.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(app)/{layout,page}.tsx`, `src/app/(app)/diagnostico/page.tsx` (placeholder)
- **alterados:** `src/env.ts` (+`AUTH_SECRET`, `AUTH_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`), `.env.local`, `package.json` (+`next-auth`)
- **removido:** `src/app/page.tsx` (substituído por `(app)/page.tsx` → redirect `/diagnostico`)

### A3 — shell + estados + shadcn
- **criados:** `src/components/shell.tsx`, `src/components/states.tsx`, `src/components/ui/{button,avatar,dropdown-menu,skeleton,separator}.tsx`, `src/lib/utils.ts`, `components.json`, `src/app/(app)/conexoes/page.tsx` (stub), `src/app/(app)/dev/states/page.tsx`
- **alterados:** `src/app/(app)/layout.tsx` (envolve no `AppShell`), `src/app/(app)/diagnostico/page.tsx` (EmptyState), `src/app/layout.tsx` (fonte Geist + `cn`), `src/app/globals.css` (tema shadcn), `src/server/auth/index.ts` (`requireWorkspace` passa a retornar `workspaceName`), `package.json` (+`@base-ui/react`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`; +`shadcn` devDep)
- **correção pós-review (A3-fix):** `src/app/(app)/diagnostico/page.tsx` e `src/app/(app)/dev/states/page.tsx` — `<Button render={<Link/>}>` → `<Link className={cn(buttonVariants(...))}>` (Console Error do Base UI `nativeButton`)

### A4 — Diagnóstico + Conexões com mock
- **criados:** `src/lib/insight.ts` (tipos de Insight p/ a UI), `src/lib/format.ts` (formatação pt-BR), `src/mock.ts` (7 insights + 4 métricas), `src/components/{insight-card,diagnostico-summary,support-metrics,connection-cards}.tsx`
- **alterados:** `src/app/(app)/diagnostico/page.tsx` (Resumo + 4 seções + Métricas de apoio), `src/app/(app)/conexoes/page.tsx` (cards GA4 + "Em breve")
- shadcn add: `card`, `badge`. Ajustes de review: cor do delta segue o `kind` do insight; datas via `formatDateRange`.

### B0 — crypto + contrato de conectores
- **criados:** `src/server/crypto.ts` (AES-256-GCM), `src/server/connectors/types.ts` (interface `Connector` + `NotImplementedError`), `src/server/connectors/stubs.ts`, `src/server/connectors/registry.ts`
- **alterados:** `src/env.ts` (+`APP_ENCRYPTION_KEY`), `.env.local`

### B1 — OAuth GA4 real
- **criados:** `src/server/connectors/ga4/auth.ts` (buildAuthUrl/exchangeCode/refreshTokens + `signOAuthState`/`verifyOAuthState` HMAC + `emailFromIdToken`), `src/server/connectors/ga4/discovery.ts` (`listAccounts`, `fetchPropertyDetails`), `src/app/api/oauth/ga4/start/route.ts`, `src/app/api/oauth/ga4/callback/route.ts`
- **alterados:** `src/env.ts` (+`GA4_REDIRECT_URI`), `src/server/connectors/types.ts` (`TokenSet` +`idToken`), `src/components/connection-cards.tsx` (botão "Conectar GA4" → `<a href="/api/oauth/ga4/start">`), `package.json` (+`google-auth-library`)
- **B1-creds:** `.env.local` linhas 18–19 — troca do OAuth Client do Google (o antigo não tinha o consent screen certo). (identificador do client omitido).

### B2 — Conexões: estado + seleção + desconectar
- **criados:** `src/server/connectors/ga4/connection.ts` (`getGa4ConnectionForWorkspace` — colunas seguras + `recentSyncRuns`), `src/server/connectors/ga4/token.ts` (`getValidGa4AccessToken` — decifra / renova / re-cifra / persiste), `src/app/(app)/conexoes/actions.ts` (`selecionarPropriedade`, `desconectar`), `src/components/property-picker.tsx`
- **alterados:** `src/server/connectors/ga4/auth.ts` (+`revokeToken`), `src/components/connection-cards.tsx` (estado conectado: conta, seletor, reconectar, desconectar), `src/app/(app)/conexoes/page.tsx` (lê o estado + banner de `?ga4_connected`/`?ga4_error`)

### B3 — extract + normalize + sync
- **criados:** `src/lib/dates.ts` (`todayInTimeZone`, `addDays`, `maxDate`), `src/server/connectors/ga4/schema.ts` (Zod do `runReport`), `src/server/connectors/ga4/extract.ts` (`pull` paginado + retry), `src/server/connectors/ga4/mapping.ts` (`mapToCanonical` + `source_hash`), `src/server/connectors/ga4/index.ts` (monta `ga4Connector`), `src/server/sync/normalize.ts` (`upsertFactTraffic`), `src/server/sync/run-sync.ts` (`runGa4Sync`), `src/components/sync-button.tsx`
- **alterados:** `src/server/connectors/registry.ts` (`ga4` → conector real, `implemented: true`), `src/server/connectors/ga4/connection.ts` (+`recentSyncRuns` na view), `src/app/(app)/conexoes/actions.ts` (+`atualizarDados`), `src/components/connection-cards.tsx` (botão "Atualizar dados" + histórico de `sync_runs`)

### C — motor determinístico (C0–C4)
- **criados:** `src/server/analysis/{types,stats,contribution,gates,context,templates,scoring,detectors,engine}.ts`, `src/server/analysis/__tests__/{fixtures,stats,gates,contribution,detectors}.test.ts`, `vitest.config.mts`
- **alterados:** `package.json` (+`vitest` devDep, +`"test": "vitest run"`)
- Schema **não tocado**.

### C5 — motor no fluxo real
- **criados:** `src/app/(app)/diagnostico/data.ts` (`getDiagnostico(workspaceId)` — seam mock↔real), `src/app/(app)/diagnostico/actions.ts` (`acknowledgeInsight`/`reopenInsight`/`dismissInsight`/`rateInsight`, escopadas por workspace)
- **alterados:** `src/server/sync/run-sync.ts` (chama `runAnalysis` no fim do sync bem-sucedido, em try/catch → `connections.last_error`), `src/app/(app)/conexoes/actions.ts` (`atualizarDados` faz `revalidatePath("/diagnostico")`), `src/app/(app)/diagnostico/page.tsx` (lê `getDiagnostico`; painel "estado honesto"; seção "Descartados"), `src/components/insight-card.tsx` (feedback via `useOptimistic` + `useTransition`; `RatingButton` com `disabled`), `src/lib/insight.ts` (+`AnalysisMeta` + campo `analysis`), `src/mock.ts` (+`analysis: null`), `.env.local` (`USE_MOCK=false`)
- Schema **não tocado**. Sem migração, sem dependência nova.

### D0 — setup doc + estados + topbar
- **criados:** `docs/ga4-setup.md` (checklist de conexão real — Google Cloud, env, pré-qualificação, fluxo, troubleshooting), `src/app/(app)/loading.tsx` (`LoadingState`), `src/app/(app)/error.tsx` (`ErrorState` + `reset()`)
- **alterados:** `src/app/(app)/layout.tsx` (busca `connections.last_synced_at` e passa `lastSyncLabel` ao shell), `src/app/(app)/diagnostico/page.tsx` (`EmptyState` sem dados; `PartialState` quando o último sync foi `partial`; `PageHeader` hoisted), `src/app/(app)/diagnostico/data.ts` (+`lastSyncStatus` no retorno), `src/components/connection-cards.tsx` (`PartialState` quando `recentSyncRuns[0].status === "partial"`), `src/lib/insight.ts` (+`SyncStatus` + campo `lastSyncStatus`), `src/mock.ts` (+`lastSyncStatus`)
- Schema **não tocado**. Sem threshold/detector/motor/modelo de dados alterados.

---

## 5. Decisões técnicas importantes

**Infra / plataforma**
- **Next 16** (não 15) — `create-next-app@latest`. `proxy.ts` no lugar de `middleware.ts` (runtime nodejs). `noUncheckedIndexedAccess` ligado.
- **Banco:** Postgres gerenciado (Neon), conexão direta (sem `-pooler`). Cliente com `{ prepare: false }`. `src/load-env.ts` carrega `.env.local` para o `drizzle-kit` (o Next carrega sozinho).
- **Fonte da verdade do schema:** migração versionada (`db:generate` → `db:migrate`); `db:push` só como verificação ("No changes detected").
- **shadcn preset `base-nova`** → componentes sobre **`@base-ui/react`** (não Radix). Polimorfismo via prop `render`, não `asChild`. Link estilizado de botão = `<Link className={cn(buttonVariants(...))}>`.
- **Testes:** Vitest. Na V0 (D15) só em `src/server/analysis/**`; hoje em `src/server/**` (1072 passam, 32 opt-in pulados em 2026-10-05). Sem CI. `vitest.config.mts` (evita warning de ESM-em-CJS).

**Modelo de dados da V0 (9 tabelas, migração `0000`; hoje 13 tabelas e 5 migrações — ver §8)**
- IDs `uuid` (`gen_random_uuid()`); timestamps `timestamptz` UTC; datas `date` em modo string `YYYY-MM-DD`.
- Conjuntos fechados → `pgEnum` (8). `provider` já com os 4 valores.
- `workspace_members.role` = `text` default `'owner'` (não enum — papéis são V1).
- Tokens cifrados → coluna `bytea` (blob `[1B versão][12B IV][16B tag][ciphertext]`, AES-256-GCM, chave em `APP_ENCRYPTION_KEY`, `key_version` para rotação futura).
- `fact_traffic_daily`: `channel/source/medium/campaign` `NOT NULL DEFAULT ''`; `UNIQUE (connection_id, date, channel, source, medium, campaign)`; `avg_engagement_time`/`key_events`/`conversion_value` sem `DEFAULT` (o normalizador sempre grava).
- FKs `ON DELETE CASCADE` na direção "dono" (workspace/connection).
- `raw_records` **append-only** (uma linha por página de `runReport`); `fact_traffic_daily` idempotente por `source_hash`.

**Auth / OAuth**
- Auth.js v5 **JWT puro** (sem adapter, sem tabela de sessão). Google provider. `provision.ts` faz upsert de user + cria workspace `owner` no 1º login (no callback `jwt`).
- **1 OAuth Client do Google** para login **e** dados GA4, fluxos separados: login pede `openid email profile`; dados GA4 pedem `openid email https://www.googleapis.com/auth/analytics.readonly` (o `email`/`openid` são para identificar a conta — desvio consciente do "só analytics.readonly" do plano; escopos não-sensíveis).
- `state` do OAuth GA4 = HMAC-SHA256 sobre `base64url({workspaceId, nonce, exp})` com `AUTH_SECRET`, TTL 10 min; o callback confere `state.workspaceId === session.workspaceId`.
- `access_type=offline&prompt=consent` (garante refresh token). Sem refresh token → erro `no_refresh_token`.
- **Token manager** (`ga4/token.ts`): decifra; se faltar < 2 min p/ expirar, renova via `refreshTokens`, re-cifra e persiste; falha no refresh → `status='reauth_required'`.
- `desconectar` = revoke best-effort no Google + `DELETE` da `connections` (cascade apaga propriedades).

**Sync (B3)**
- Roda **inline** no server action (sem fila). Janela: 1º sync = 180 dias no fuso da propriedade; incremental = `max(hoje−180d, last_synced−3d)` até hoje (3d = retificação de atribuição).
- `runReport`: dims `date, sessionDefaultChannelGroup, sessionSource, sessionMedium, sessionCampaignName` × metrics `sessions, totalUsers, newUsers, engagedSessions, userEngagementDuration, keyEvents, totalRevenue`. `avgEngagementTime = userEngagementDuration/sessions`. `keyEvents→key_events`, `totalRevenue→conversion_value`.
- Retry 429/5xx com backoff; teto `MAX_TOTAL_ROWS = 500k` → `status='partial'`.
- `sync_runs` registra `running→success|partial|failed`, `rows_in`, `rows_written`, período.

**Motor de análise (C0–C4)**
- Determinístico, **sem LLM**. `dados → gates → detectores → contribution → templates → scoring → insights`.
- **`key_events = 0` = ausência de dados de conversão, NÃO erro** (orientação do usuário). G4 detecta `totalKeyEvents === 0` → suprime a família `conversion` + emite `data_quality` (`severity=attention`).
- Gates: **G0** (cobertura ≥ 150/180 dias; janelas atual/anterior ≥ 26/28 dias) · **G1** volume mínimo (tráfego ≥ 500 sessões/janela; conversão ≥ 100 sessões e ≥ 25 key events) · **G2** significância (`z robusto ≤ −2,5` p/ tráfego; `|z 2 proporções| ≥ 1,96` p/ conversão) · **G3** materialidade (`|Δ%| ≥ 10%` + piso absoluto) · **G4** veto de qualidade (`(not set)/(direct) > 40%` → suprime `attribution`; buraco de coleta; sem key events).
- Confiança `alta` exige `|z| ≥ 3` + completude ≥ 95% + volume ≥ 2× mínimo (+ efeito estável nas 2 metades p/ tráfego); senão `média`; abaixo não emite.
- `changePoint` (onset) com **detrending linear** — declínio gradual NÃO vira onset (usa "no período"); só degrau real. `minT = 4`.
- Só `context.ts` (leitura) e `engine.ts` (persistência) tocam o banco; o resto é puro.
- **Ciclo de vida (D12):** `runAnalysis` deleta insights `status='open'` do workspace e insere os novos; `onConflictDoNothing (workspace_id, dedupe_key)` preserva reconhecidos/descartados.
- `DetectorInsight.type` (ex.: `sessions_drop`) é interno — o schema só tem `detector`.

**Integração do motor (C5)**
- `runAnalysis` roda **dentro** de `runGa4Sync`, após o `update` de `sync_runs`/`connections`, em `try/catch`: falha da análise **não** derruba o sync (dados já gravados) — registra em `connections.last_error`. `revalidatePath("/diagnostico")` fica na server action `atualizarDados` (camada certa).
- `getDiagnostico` reusa `buildAnalysisContext` + `evaluateGates` para as Métricas de apoio **e** os números do "estado honesto" — mesma janela do motor, sem drift. Custo: recomputa o contexto a cada carga de `/diagnostico` (ok no volume da V0).
- `data_quality` tem `impact: null` **por design** (decisão do usuário no D0) — não se inventa impacto só para preencher campo.
- Feedback: `useOptimistic` + `useTransition` no `InsightCard`; a página usa `key={dedupeKey:status:rating}` para o card remontar com o estado reconciliado após `revalidatePath`. `dismissed` continuam buscados (seção "Descartados" com "Desfazer").

**Ciclo de vida e identidade dos insights (ajustes D1 #1/#2/#6)**
- Identidade estável = **`dedupe_key`** (não `insights.id`). As server actions de feedback (`acknowledge/reopen/dismiss/rate`) filtram por `(workspace_id, dedupe_key)`; a UI carrega `dedupeKey` e o usa como React key.
- `runAnalysis` faz **UPSERT** por `(workspace_id, dedupe_key)`: atualiza o conteúdo (título, evidência, prioridade, trace, `sync_run_id`) mas **preserva `status`, `rating` e `created_at`** — 👍/👎 e reconhecido/descartado sobrevivem ao re-sync, inclusive em insights `open`. Como efeito, o `insights.id` também passou a ser estável.
- Insight `open` que deixa de ser detectado numa análise é **removido** (resolvido); `acknowledged`/`dismissed` permanecem como histórico e têm o conteúdo atualizado se voltarem a disparar.
- Evidência de `data_quality` sem série numérica (`no_key_events`, `collection_gap`): o `EvidenceBlock` mostra o texto explicativo (`evidence.test`) em vez de `0 → 0 +0,0%`.

**`traffic-volume-drop` — #3 (título por canal) + #4 (deseasonalização) [D1]**
- **#3**: quando há canal responsável, o **título, o impacto e a linha principal da evidência são do CANAL** (ex.: "Sessões de Paid Search caíram 12,8%"); a queda do site entra como contexto no `evidence.test` e na explicação ("representa 80% da queda de −10,0% do site"). Sem canal dominante → texto no nível do site.
- **#4**: o teste de significância (z robusto) roda sobre a série **deseasonalizada por dia da semana** (`weekdayProfile` + `deseasonalize` em `stats.ts`, funções puras). `gate_trace` guarda `g2_zRobust_raw`, `g2_zRobust_deseasonalized`, `weekdayProfile`, `deseasonalized`. Baseline < 21 dias → perfil neutro (sem ajuste).
- **Thresholds e regra de severidade INALTERADOS.** `severity` continua `|siteDeltaPct| ≥ 0,25 || |z| ≥ 4` (com o z já deseasonalizado). O `gate_trace.severityInputs` registra siteDeltaPct, channelDeltaPct, zRaw, zDeseasonalized, siteImpact, channelImpact para calibrar o **#5** depois do rating cego do piloto.
- **Observado nos dados reais (2026-09-02):** a deseasonalização **aumentou** o |z| (raw −4,6 → deseason −5,8; σ 70 → 38) — a sazonalidade de fim de semana é extrema (fator sáb 0,205 / dom 0,625: campanhas B2B pausadas no fim de semana) e removê-la revela que a queda de ~10% é um sinal consistente. **#4 não ameniza a severidade** — reforça a significância. A decisão de #5 continua necessária.

**Estados e shell (D0)**
- Os 4 estados de `src/components/states.tsx` estão integrados: `loading.tsx`/`error.tsx` no segmento `(app)` (o shell continua visível; `reset()` = "tentar de novo"); `EmptyState` em `/diagnostico` quando não há métricas nem insights; `PartialState` em `/diagnostico` e no card de Conexões quando o último `sync_run` é `partial`.
- Topbar do shell: `(app)/layout.tsx` busca `connections.last_synced_at` e passa `lastSyncLabel` (`"Atualizado há X"`, via `formatRelativeTime`) — mesmo valor/formato de Diagnóstico e Conexões. Sem conexão → "Sem sincronização".
- `DiagnosticoData` (DTO de UI, não o modelo do banco) ganhou `analysis` (C5) e `lastSyncStatus` (D0). Schema do banco intocado.

---

## 6. Variáveis de ambiente

Arquivo local: `.env.local` (raiz do projeto, não versionado). Referência: `.env.example`. *(Tabela completa atualizada
em 2026-10-05; a coluna "Estado" descreve o ambiente do piloto. Identificadores de infraestrutura foram omitidos.)*

**Obrigatórias** (o app não sobe sem elas): `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET` e `APP_ENCRYPTION_KEY`. As demais têm valor padrão ou são opcionais.

| Variável | Bloco | Descrição | Estado |
|---|---|---|---|
| `DATABASE_URL` | A1 | Conexão Postgres do Neon (direta, `sslmode=require`) | ✅ preenchida (Neon, `sa-east-1`) |
| `USE_MOCK` | A0→C5 | `true` = UI com mock; `false` = `/diagnostico` lê insights reais do banco | **`false`** (desde C5) |
| `AUTH_SECRET` | A2 | Segredo da sessão JWT + assinatura do `state` do OAuth | ✅ (gerado localmente) |
| `AUTH_URL` | A2 | `http://localhost:3000` | ✅ |
| `GOOGLE_OAUTH_CLIENT_ID` | A2/B1 | OAuth Client (Web) do Google — login, dados GA4 **e** Google Ads | ✅ |
| `GOOGLE_OAUTH_CLIENT_SECRET` | A2/B1 | secret do mesmo client | ✅ |
| `GA4_REDIRECT_URI` | B1 | `http://localhost:3000/api/oauth/ga4/callback` | ✅ |
| `APP_ENCRYPTION_KEY` | B0 | AES-256-GCM, 32 bytes base64 — cifra dos tokens | ✅ (gerado localmente) — **trocar torna tokens ilegíveis; reconectar as fontes** |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | G2 | Developer token (Basic access) de uma conta MCC; opcional | ❌ **ausente** — bloqueia o sync real do Google Ads |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | G2 | id do MCC (só dígitos), usado no header `login-customer-id`; opcional | — |
| `RD_MARKETING_CLIENT_ID` · `RD_MARKETING_CLIENT_SECRET` | RD-1 | App do RD Station Marketing (App Publisher); opcionais | ✅ |
| `RD_CRM_CLIENT_ID` · `RD_CRM_CLIENT_SECRET` | RD-1 | App **separado** do RD Station CRM; opcionais | ✅ |
| `ADVISOR_ENABLED` | Advisor | Liga/desliga a tela e o server action do Advisor | padrão `true` |
| `ADVISOR_LLM_ENABLED` | Advisor LLM | Liga/desliga o **modelo de linguagem** (independente de `ADVISOR_ENABLED`) | padrão **`false`** (não definida no `.env.local`) |
| `ANTHROPIC_API_KEY` | Advisor LLM | Credencial da API da Anthropic — só em `.env.local`, nunca em log; vazio = ausente (o Advisor cai no determinístico) | presente no `.env.local`; a conta dona da chave está **sem crédito** |
| `ADVISOR_LLM_MODEL` · `ADVISOR_LLM_EFFORT` · `ADVISOR_LLM_TIMEOUT_MS` | Advisor LLM | Modelo (`claude-sonnet-5-5`), esforço (`low`/`medium`/`high`, padrão `medium`) e tempo limite (5000–300000 ms, padrão 90000) | opcionais |

`AUTH_SECRET` e `APP_ENCRYPTION_KEY` foram gerados localmente pelo assistente (chaves de dev). Para deploy, o usuário gera as suas.

`env.ts` valida tudo por Zod no boot; falta ou formato errado → erro claro com aponte para `.env.example`.

---

## 7. Integrações configuradas

*(Atualizado em 2026-10-05. Identificadores pessoais e de infraestrutura — e-mail, nome, IDs de propriedade, host do
banco, prefixo do Client ID — foram omitidos.)*

**Neon (PostgreSQL)** — projeto `v0-saas` na conta pessoal do usuário. Região `sa-east-1` (São Paulo). 5 migrações aplicadas (§8). Sem RLS.

**Google Cloud — OAuth Client (Web)** — um client para login, dados GA4 e (quando conectado) Google Ads:
- Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` (login Auth.js) e
  `http://localhost:3000/api/oauth/ga4/callback` (dados GA4). O redirect do Google Ads
  (`.../api/oauth/google_ads/callback`) está previsto no `.env.example`, mas não há conexão Google Ads no ambiente do piloto.
- OAuth consent screen: modo **Testing**; scope `analytics.readonly` adicionado; a conta Google do piloto é test user.
- APIs habilitadas: **Google Analytics Admin API** + **Google Analytics Data API**.
- ⚠️ Em modo Testing, o refresh token de escopo sensível **expira ~7 dias**: o GA4 teve falhas de renovação em 10/09,
  17/09, 22/09 e 04/10, resolvidas reconectando pela UI (reconexão mais recente: 2026-10-04 18:43; próxima expiração
  estimada ~11/10). Publicar/verificar o app OAuth remove o prazo.

**GA4 — propriedade do piloto (MS Server):**
- Conta autorizada: a conta Google do piloto.
- 2 propriedades descobertas; **selecionada:** a propriedade GA4 da empresa-piloto (fuso `America/Sao_Paulo`, moeda
  `BRL`); a outra não está selecionada (sem fuso/moeda).

**RD Station Marketing** — app privado no App Publisher (produto "RD Station Marketing"), plano **Pro**; redirect
`http://localhost:3000/api/oauth/rd_station_marketing/callback`. Conectado (`status=connected`); 2 landing pages; a API
só devolve os últimos **45 dias**.

**RD Station CRM** — app **separado** (produto "RD Station CRM"); redirect
`http://localhost:3000/api/oauth/rd_station_crm/callback`. Conectado; 736 negociações importadas por `updated_at`
(histórico importado desde 2026-04-07).

**Google Ads** — sem conexão: falta o `GOOGLE_ADS_DEVELOPER_TOKEN` (Basic access, conta MCC). Código de OAuth,
descoberta e extração pronto e testado offline (§14).

**Anthropic (LLM do Advisor)** — `ANTHROPIC_API_KEY` presente no `.env.local`, mas a conta dona da chave está
**sem crédito**; `ADVISOR_LLM_ENABLED` não está definido (padrão `false`): o LLM nunca foi chamado com geração real (§17).

---

## 8. Estado atual do banco (Neon)

Snapshot de **2026-10-05** (leitura somente-leitura): **13 tabelas** no schema `public`, 8 enums, 5 migrações.
*(Nomes, e-mails e IDs do piloto foram omitidos.)*

| Tabela | Colunas | Linhas | Conteúdo |
|---|---|---|---|
| `users` | 5 | 1 | O usuário-piloto |
| `workspaces` | 3 | 1 | O workspace do piloto |
| `workspace_members` | 5 | 1 | O usuário-piloto como `owner` |
| `connections` | 14 | 3 | GA4, RD Marketing e RD CRM — as três `connected`, tokens cifrados (bytea), `key_version=1`. Último sync: GA4 2026-10-05 12:44Z · RD Marketing 2026-10-04 18:21Z · RD CRM 2026-10-04 17:39Z |
| `connection_properties` | 8 | 4 | GA4: 2 propriedades (1 selecionada, fuso `America/Sao_Paulo`, moeda `BRL`; a outra sem fuso/moeda); RD Marketing e RD CRM: 1 selecionada cada |
| `sync_runs` | 11 | 26 | 20 `success` · 6 `failed` — GA4: 5 falhas de renovação do token (10/09, 17/09 ×2, 22/09, 04/10), resolvidas reconectando a conta; RD CRM: 1 falha de paginação na 1ª importação, corrigida |
| `raw_records` | 8 | 100 | 1 linha por página de resposta (append-only): GA4 16 · RD Marketing 53 · RD CRM 31 |
| `fact_traffic_daily` | 19 | 2.727 | GA4 (`platform='ga4'` em todas as linhas — coluna adicionada no bloco G1 do ciclo V1): `2026-03-03` a `2026-10-05`, 217 dias sem buracos; **0 key_events / 0 conversion_value** |
| `fact_ad_performance_daily` | 21 | 0 | **Nova (bloco G3 do ciclo V1, migração `0002`)**. Grão campanha × dia, forma "ad-performance" (Google Ads/Meta). Vazia — nenhum sync real do Google Ads rodou ainda (bloqueado por `GOOGLE_ADS_DEVELOPER_TOKEN`, credencial externa). Ver §14. |
| `fact_conversion_assets_daily` | 14 | 90 | **Nova (RD-1, migração `0003`).** RD Station Marketing — grão ativo de conversão (landing page / formulário / pop-up) × dia; chave natural `(connection_id, platform, date, asset_id)`. Sem PII, só contagens por ativo. Hoje: 2026-08-21 → 2026-10-04 (45 dias × 2 ativos). Ver §15. |
| `fact_deals` | 18 | 736 | **Nova (RD-1, migração `0003`).** RD CRM — uma linha por negociação (`deal_id`); `deal_created_at`/`deal_closed_at` são a data do fato, `deal_updated_at` só controla a sincronização. Sem PII (nem nome da negociação nem contatos). Ver §15. |
| `insights` | 25 | 1 | `[70] data-quality:no_key_events` (aberto; janela 2026-09-06 → 2026-10-03). Sem `traffic-volume-drop` no momento — o detector oscila "no fio da navalha" com a janela móvel (§11). `id`/`created_at`/`rating` estáveis entre análises (upsert por `dedupe_key`). |
| `cross_source_insights` | 18 | 16 | **Dois snapshots de 8 linhas:** o fechamento oficial 2026-09-01 → 2026-10-04 (gerado em 2026-10-05T13:51Z) e o snapshot anterior 2026-10-01 → 2026-10-04 (gerado em 2026-10-04T20:10Z, defasado no GA4). É a **única** tabela que `generateCrossSourceInsights` escreve. Não alimenta o `/diagnostico`. Ver §15 e "Estado atual". |

**Enums:** `provider` (ganhou `rd_station_marketing` e `rd_station_crm` na `0003`), `connection_status`, `sync_trigger`, `sync_status`, `insight_kind`, `insight_severity`, `insight_status`, `insight_confidence`.
**Migrações aplicadas:** `0000_fast_catseye` (id 1) · `0001_flashy_leper_queen` (id 2 — ciclo V1/G1: `fact_traffic_daily.platform`) · `0002_unusual_raza` (id 3 — ciclo V1/G3: `fact_ad_performance_daily`) · `0003_cheerful_spitfire` (id 4 — RD-1: enum `provider` + `fact_conversion_assets_daily` + `fact_deals`) · `0004_abandoned_jigsaw` (id 5 — Cross-source V1.1: `cross_source_insights`, aditiva).

---

## 9. Estado atual do OAuth / GA4

*(Atualizado em 2026-10-05; o estado de 2026-09-01 está no registro da V0, §10.)*

- **GA4: conexão ativa e funcional.** OAuth real feito pelo usuário; tokens (access + refresh) cifrados em `bytea` e
  decifráveis; refresh exercido em cada sync que precisou. Propriedade selecionada, com fuso/moeda preenchidos pela Admin API.
- **21 syncs do GA4** (16 `success`, 5 `failed` por falha de renovação do token — modo Testing). Reconexão mais recente em
  2026-10-04 18:43 (a de 2026-09-22 está em §14); último sync com sucesso em 2026-10-05 12:44Z. Cada sync bem-sucedido
  re-puxa a partir de `last_synced − 3 dias`, então as falhas não deixaram buracos: `fact_traffic_daily` tem 217 dias
  contíguos (03/03 → 05/10).
- **O motor está plugado ao sync (C5):** `runWorkspaceAnalysis` roda no fim de cada sync. Hoje há 1 insight
  (`data-quality:no_key_events`).
- **RD Station Marketing e RD CRM:** conectados (apps OAuth próprios) — 3 e 2 syncs, respectivamente (1 falha de
  paginação do CRM na 1ª importação, corrigida). Ver §15.

---

## 10. O que foi validado com dados reais

| Item | Como | Resultado |
|---|---|---|
| Login Google + provisionamento de workspace | usuário, no navegador | ✅ user/workspace/member criados, cai em `/diagnostico` |
| OAuth GA4 (start → consentimento → callback) | usuário, no navegador | ✅ `connections` com tokens cifrados, e-mail da conta, 2 propriedades descobertas |
| Cifra de tokens em repouso | inspeção do banco + decrypt | ✅ `bytea`, AES-256-GCM, decifra para `ya29.…` / `1//…`, não em claro, `key_version=1` |
| Seleção de propriedade | clique real no navegador | ✅ `is_selected` persiste (exatamente 1); tz/moeda buscados da Admin API (`America/Sao_Paulo`, `BRL`) |
| Token manager (decrypt + refresh) | sync real | ✅ decifra; refresh exercido (token renovado) |
| Sync `runReport` 180 dias | `runGa4Sync` contra a propriedade GA4 do piloto | ✅ 2340 linhas, 181 datas, ~40k sessões, ~5s |
| Idempotência do sync | 2º e 3º sync | ✅ `fact_traffic_daily` não duplica; `rows_written` só conta o que muda |
| `sync_runs` histórico | inspeção | ✅ trigger/status/período/contagens |
| Motor de análise contra dados reais | `runAnalysis` (verificação) | ✅ contexto (janelas D-2 corretas), G0 passa, G4 suprime `conversion` (0 key events, tratado como ausência), emite `data_quality`; idempotente |
| Testes do motor | `pnpm test` | ✅ 31/31 (stats, gates, contribution, detectors) |
| **C5 — motor no fluxo real** | "Atualizar dados" do usuário (2026-09-01 21:40) | ✅ sync → `runAnalysis` gravou `data-quality` (prio 70) + `traffic-volume-drop` "Paid Search −10,6%, z robusto −4,3, impacto ≈663 sessões" (prio 64,4, conf alta); `sync_run_id` e `created_at` batem com o sync |
| **C5 — `/diagnostico` real** | tela autenticada + `getDiagnostico` via rota dev | ✅ mostra os 2 insights reais + métricas de apoio da janela (sessões 5.575 vs 6.238, etc.); todos os campos do card preenchidos (F6) |
| **C5 — feedback persiste** | round-trip `UPDATE insights ... WHERE id AND workspace_id` | ✅ `open/null → acknowledged/−1 → restaurado` |
| **D0 — estados nas telas** | `/dev/states` + `/dev/boom` temporário | ✅ `LoadingState`/`EmptyState`/`ErrorState`/`PartialState` renderam; `error.tsx` do `(app)` captura erro e mantém o shell; `reset()` funciona |
| **D0 — topbar** | `/diagnostico` e `/conexoes` autenticados | ✅ topbar mostra "Atualizado há X" igual às telas (antes: sempre "Sem sincronização") |

---

## 11. Limitações conhecidas

- **A propriedade da MS Server (`306062786`) não tem key events (conversões) configurados.** Todas as linhas têm `key_events = 0`. Decisão do usuário: **aceitar** nesta V0; a propriedade **continua elegível para o piloto** (o motor emite o `data_quality` explicando a supressão). `conversion-efficiency-drop` nunca dispara aqui → o piloto exercita 2 dos 3 detectores.
- **#3 e #4 implementados** (título por canal; z deseasonalizado por dia da semana). **#5 (regra de severidade) NÃO implementado** por decisão do usuário — preservar flexibilidade para calibrar depois do rating cego do piloto. Regra atual mantida; `gate_trace.severityInputs` registra os componentes (siteDeltaPct, channelDeltaPct, zRaw, zDeseasonalized, impactos) para essa calibração.
- **`traffic-volume-drop` não está disparando agora** (2026-09-02): a queda do site é −9,96%, logo abaixo do piso de materialidade de 10% (G3). Era −10,6% no D1 (janela deslocou 1–2 dias com a virada do mês). Comportamento correto ("no fio da navalha", já sinalizado) — a UI mostra o estado honesto. O `data_quality` "sem key events" continua. Volta a disparar quando a janela cruzar 10% de novo. *(Atualização 2026-09-24: voltou a disparar com a janela 26/08–22/09, site ≈ −10,8% — mesma oscilação "no fio da navalha"; ver §14.)*
- **`getDiagnostico` recomputa `buildAnalysisContext` a cada carga de `/diagnostico`** (~8–10 queries agregadas). Ok no volume da V0; V1 persistiria um resumo de análise.
- **Refresh token de escopo sensível expira ~7 dias** (Google, modo Testing). Reconectar a fonte quando isso acontecer — vale também para o fechamento (falhas de renovação em 10/09, 17/09, 22/09 e 04/10; reconexão mais recente em 2026-10-04 18:43; próxima expiração estimada ~11/10). Documentado em `docs/ga4-setup.md`.
- **`raw_records` é append-only sem poda** — cresce ~1 linha por sync. Poda fica para V1.
- **Sync roda inline** no server action — sem fila, sem agendamento (V0). Propriedade muito grande pode aproximar o teto de 500k linhas → `partial` (a UI já avisa: `PartialState` em `/diagnostico` e no card de Conexões).
- **Multi-tenancy é mínima** — 1 workspace, sem RLS, sem convites, sem papéis reais. Multi-tenant real é V2 (`docs/v1-architecture.md` §11).
- **Git/GitHub (2026-10-05):** repositório **privado** no GitHub (remote `origin`, branch `main`). Até a atualização de documentação de 2026-10-05, `main` tinha 1 commit (`4a36c36 feat: finalize advisor v1`, 221 arquivos), igual ao `origin/main`, com a árvore limpa. Commits e push só quando o usuário pedir.
- **Google Ads deixou de ser stub** (ciclo V1, blocos G1–G6): OAuth + discovery de contas + seleção **reais** (G2); extração campanha × dia via GAQL paginada, canonicalização e `fact_ad_performance_daily` **implementadas e testadas offline** (G3); `ctx.ads` no contexto de análise (G5) e `enrichWithAds` (G6) prontos — **mas nunca rodaram com dado real de Ads** (`fact_ad_performance_daily = 0`). **Sync real bloqueado** — falta `GOOGLE_ADS_DEVELOPER_TOKEN` (Basic access, MCC — credencial externa, fora do controle do assistente). Sem o token, `pull`/discovery lançam `DeveloperTokenMissingError` sem nenhum HTTP; o app sobe e o GA4 funciona normal. Ver `docs/v1-architecture.md` e §14 abaixo.
- **A UI não renderiza `supportingEvidence`** (G6): `insight-card.tsx` só lê `metricLabel`/`current`/`previous`/`baseline`/`test`/`breakdown`. A evidência complementar do Google Ads é persistida em `evidence_json`, mas hoje só a frase acrescentada a `hypothesis` aparece no card. Renderizar o campo é uma decisão de UI futura.
- **Variação temporal do Google Ads fora do escopo** (G6): o `AdsContext` só tem a janela `current` — sem janela anterior não há Δ% de investimento/impressões, tendência de perda de impressão nem onset de status de campanha. A evidência do G6 usa só valores **absolutos**; isso permanece assim até existir uma janela anterior no `AdsContext`.
- **O Advisor só responde com fatos para períodos cujo Cross-source foi gerado.** Ele lê só saídas persistidas (`insights` + `cross_source_insights`, INV-5) e **nunca gera** nada (INV-20): período sem conjunto ⇒ resposta `no_data` com limitação bloqueante. Gerar o Cross-source segue sendo uma chamada explícita; a tela só oferece os períodos que já têm conjunto. Ler o `AnalysisContext` ao vivo (para responder qualquer período) exige emenda explícita de INV-5/D-N — decisão em aberto (§16). Hoje existem 2 períodos com Cross-source gerado: 01/09→04/10 (fechamento oficial) e 01–04/10 (snapshot anterior).
- **O diagnóstico do motor é da janela padrão de 28 dias, não do período pedido.** O Advisor o mostra com a janela dele (em 2026-10-05: 06/09→03/10/2026; a janela avança a cada análise) e a limitação `diagnostics_period_differs`; nunca o apresenta como se fosse do período pedido.
- **A pergunta livre só é interpretada com o modelo de linguagem** (`ADVISOR_LLM_ENABLED=true` + `ANTHROPIC_API_KEY`). Com o LLM desligado — o estado de entrega — o campo de pergunta responde com o **resumo determinístico do período**, dito como tal ("O modelo de linguagem do Advisor não está ativo neste ambiente, então a pergunta livre não foi interpretada; segue o resumo determinístico…", com a limitação `llm_not_connected`); a pergunta não é ecoada nem respondida. Habilitado sem credencial, ou se o modelo falhar/for recusado, o Advisor responde com o mesmo resumo e diz por quê (§17).
- **O guard não prova uma frase qualitativa sem número.** Ele prova número, data, moeda, referência, conta implícita, plataforma, ancoragem de hipótese e ausência ≠ zero (§17); uma afirmação em prosa sem número ("o marketing teve baixo desempenho") só é contida pelo prompt, pela separação em camadas (a hipótese nunca vira fato) e pela avaliação ao vivo com o modelo real.
- **Sem limite de uso nem orçamento por workspace para o LLM**, e `maxDuration` não definido: cada pergunta é uma chamada paga de dezenas de segundos. Em hospedagem serverless com limite curto, defina `export const maxDuration` na página conforme o plano ao publicar.
- **Os modelos Claude 5 rejeitam `temperature`/`top_p`/`top_k`:** a "baixa criatividade" vem do prompt, do schema e do guard (`ADVISOR_LLM_EFFORT` só regula quanto o modelo pensa).
- **A comparação entre períodos só vale entre períodos comparáveis:** os dois com Cross-source gerado, sem sobreposição, com o **mesmo número de dias** e com a fonte coberta nos dois (o Advisor não normaliza por dia). Outubro parcial (4 dias) × setembro inteiro ⇒ "não computável".
- **O valor ganho cobre só parte dos negócios ganhos e o CRM não informa a moeda.** No fechamento oficial (01/09→04/10): 61.399,00, soma de 5 de 11 ganhos com valor registrado; no snapshot 01–04/10: 23.399,00, soma de 1 de 5. O Advisor mostra sempre essa ressalva e **nunca** como "R$ … de valor ganho" (o guard recusa `R$`/BRL quando nenhuma fonte informa a moeda).
- **Defeito do Cross-source em `metric-not-computable` — corrigido no gerador (2026-10-05).** O helper de evidência marcava como `currency` todo ponto cujo id terminava em `_value`, inclusive as **contagens** `rd_crm.lost_deals_with_value`/`won_deals_with_value` (no painel de evidências do Advisor — e no `display` que o modelo receberia — um `0` saía como "0,00"). Agora o formato vem de uma lista explícita (`won_value`, `lost_value`, `average_ticket` = dinheiro). O **fechamento oficial** (01/09→04/10) já nasceu corrigido (`rd_crm.lost_deals_with_value` = contagem, "0"); o **snapshot anterior** (01–04/10) ainda tem a linha no formato antigo (painel com "0,00" nesse ponto) e fica como histórico etiquetado — não será regenerado. Narrativa, figuras e números do Advisor não são afetados (§17, "Fechamento").
- **Meta Ads segue stub** (`NotImplementedError`); só a estrutura existe. **RD Station Marketing e RD CRM deixaram de ser stubs** no RD-1 (§15): conectores com OAuth próprio, extração, mapper e `fact_conversion_assets_daily`/`fact_deals` com dado real no workspace piloto.
- **O Cross-source persistido envelhece.** `cross_source_insights` é uma foto do que o banco tinha quando `generateCrossSourceInsights` rodou: depois de um sync (GA4, RD Marketing ou RD CRM) o conjunto salvo pode divergir do que seria gerado agora. Não há gatilho de regeneração — gerar é sempre uma chamada explícita (INV-16) — e `generated_at`/`schema_version` são o único sinal. A política de regeneração (e a superfície de geração: botão, job ou pós-sync) continua **decisão em aberto** — o Advisor foi entregue sem ela. Exemplo real: o snapshot 01–04/10 já divergia do banco no GA4 (487 × 541 sessões) no dia seguinte à geração, porque o dia 04/10 foi reescrito por um sync posterior.
- **O histórico do CRM é só o importado.** `rdCrm.coverage.importedHistoryStartDate` é o menor `period_start` entre os syncs bem-sucedidos do RD CRM — o histórico disponível **no SaaS**, não o início do histórico real do CRM (que não é conhecido). Período que começa antes dele sai como a limitação `rd_crm_partial_imported_history`, nunca como histórico completo.
- **Os dados do RD limitam o que se afirma entre fontes.** A API do RD CRM não devolve `campaign_id` (0% das negociações) e `source_id` é um ID opaco, sem nomes nem dicionário de origens importado; sem isso não há atribuição, CAC, ROAS nem taxa entre GA4 × RD Marketing × RD CRM, e o Cross-source declara isso como limitação (INV-18). O RD Marketing do plano Pro só traz ativos de conversão nativos e no máximo 45 dias de histórico: a API só alcança os últimos 45 dias a partir do dia do sync, então o sync precisa rodar ao menos a cada 45 dias para não perder dias (em 2026-10-05, 01/09 ainda é alcançável, até 15/10/2026; os dias já importados ficam guardados).
- **O dia mais recente do GA4 pode estar provisório** (o GA4 consolida em até ~48h; a análise padrão termina em hoje − 2 por isso). Um período explícito que termina em D−1 — como o fechamento oficial, que termina em 04/10 e foi gerado em 05/10 — pode conter 1–2 dias ainda incompletos: o 04/10 tinha ~4 sessões quando o snapshot 01–04/10 foi gerado e 58 depois de um sync posterior (domingos normais: 92–119). Para um fechamento final, ressincronizar depois do período + 48h e regenerar (idempotente).
- **`MIN_ATTRIBUTION_COVERAGE = 0,8` não foi aprovado como regra de produto.** É o limiar de preenchimento de `source_id`/`campaign_id` abaixo do qual a atribuição é tratada como não confiável (`attribution-quality`); foi adotado como padrão conservador e precisa de decisão do produto.
- **Regra de zero × ausência (GA4).** Linha existente com `sessions = 0` é dado válido (zero registrado); ausência de linha é ausência de dado — nunca zero, nunca atraso. Atraso do GA4, período parcial e períodos não equivalentes dependem da cobertura por existência de linha, não do valor da métrica (INV-17). `WindowAgg.daysWithData` (dias com sessões > 0) segue sendo o que gates e detectors usam e não mudou.
- Rota `/dev/states` é de revisão (dev-only) e deve sair antes de qualquer deploy.

---

## 12. Próximos blocos do plano

*(Atualizado em 2026-10-05. A tabela abaixo é o registro do D1 da V0; os próximos passos reais vêm depois dela.)*

| Bloco | Escopo | Status |
|---|---|---|
| **C5** | motor plugado ao sync · `/diagnostico` real · feedback persistente · `USE_MOCK=false` | ✅ concluído |
| **D0** | `docs/ga4-setup.md` · 4 estados integrados · topbar · auditoria F1–F9 | ✅ concluído |
| **D1 — validação** | fluxo completo na MS Server, determinismo, auditoria numérica interna, P1–P4 | ✅ técnico feito · **P2/P3 (rating cego do Marcio): fora do escopo atual** (decisão de 2026-10-05) |
| **D1 — correções** | #1 rating/status preservados · #2 identidade por `dedupe_key` · #6 evidência do `data_quality` · #7 elegibilidade sem key events · #3 título por canal · #4 z deseasonalizado por dia da semana | ✅ concluído |
| **D1 — #5 severidade** | regra `critical` (magnitude + impacto + significância) | ⏸️ **adiado** — calibrar só se o rating cego do piloto for retomado; `gate_trace` já registra os componentes |

**F1–F9:** F1–F7 e F9 ✅ · F8 ✅ no ramo "sem key events". **P1** parcial (2
insights); **P2/P3** (rating cego do Marcio) estão **fora do escopo atual** (o feedback
sobrevive ao re-sync, então o rating poderá ser retomado). Critérios e método: `docs/v0-plan.md` §11–12.

### Próximos passos (2026-10-05)

1. **Fechamento final 01/09 → 04/10:** ressincronizar GA4, RD Marketing e RD CRM a partir de 07/10 (o 04/10 do GA4 pode estar
   provisório) e regenerar o período (`generateCrossSourceInsights`: escrita explícita, idempotente, só em `cross_source_insights`).
2. **Reconectar o GA4 antes de ~11/10** (modo Testing) — ou publicar/verificar o app OAuth.
3. **Decisões em aberto** (nada é feito sem aprovação): política e superfície de geração do Cross-source (botão, job,
   pós-sync); leitura ao vivo do `AnalysisContext` (emenda de INV-5); normalizar a comparação por dia; `advisor_outputs`;
   tela "Visão geral"; limite de uso e `maxDuration` do LLM; `MIN_ATTRIBUTION_COVERAGE`.
4. **Antes de ligar o LLM:** crédito na conta do provedor e avaliação ao vivo (§17); só então `ADVISOR_LLM_ENABLED`.
5. **Google Ads real:** o developer token (Basic access, conta MCC) destrava o sync.
6. **Antes de qualquer deploy:** remover `/dev/states`, definir `maxDuration` e decidir a hospedagem.

---

## 13. Onde retomar

**Estado (2026-10-05):** ver **"Estado atual"** no topo. Em resumo: a V0 (A0–D1 técnico) e o ciclo V1 (G1–G7b, RD-1,
Cross-source) estão concluídos; o Advisor determinístico está entregue e o LLM está implementado e desligado; o
fechamento oficial 01/09 → 04/10 está persistido. O motor está plugado ao sync; `/diagnostico` mostra insights reais
(`USE_MOCK=false`); o feedback 👍/👎 e o status sobrevivem ao re-sync (upsert por `dedupe_key`).

**#5 (regra de severidade) segue adiado** por decisão do usuário — calibrar só se o rating cego do piloto for retomado,
usando `gate_trace.severityInputs`. Nada mais no motor muda sem aprovação.

**Próximos passos:** ver §12 ("Próximos passos").

**Registro do D1 de produto (V0) — hoje fora do escopo atual** (decisão de 2026-10-05; precisa do Marcio, não do assistente):

1. **Reconectar** se o refresh token expirou (modo Testing, ~7 dias) — card de
   Conexões mostra "Reautorização necessária".
2. **Auditoria numérica** (plano §12-A) — reproduzir os números do `evidence_json`
   na UI do GA4 (Explorações). *A auditoria interna (motor vs. `fact_traffic_daily`)
   já passou no D1.*
3. **Rating cego** (§12-B) — 👍/👎 + 1 linha de porquê **antes** de abrir o GA4.
   Meta P2 ≥ 50%. Agora o rating persiste entre syncs.
4. **Bater a linha de base** (§12-C) — 20 min no GA4 listando "as 3 coisas para
   agir"; comparar com o top do motor.
5. **Registrar** P1–P4 e categorizar cada 👎 para o backlog V1.

**Comandos de contexto rápido ao retomar:**
```bash
cd <raiz do projeto>
pnpm install
pnpm test && pnpm typecheck && pnpm lint && pnpm build   # deve passar tudo
pnpm db:generate                                          # deve responder "No schema changes"
pnpm dev                                                   # http://localhost:3000
```
Login real: abrir `http://localhost:3000`, entrar com Google (conta test user).
Inspecionar o banco: `pnpm db:studio`.

**Não fazer sem pedir:** commits e push; gerar ou regenerar o Cross-source e sincronizar fontes (INV-16); configurar/alterar
key events no GA4; trocar a propriedade selecionada; **alterar thresholds / regra de severidade (#5) / metodologia do motor /
modelo de dados** sem aprovação; ligar `ADVISOR_LLM_ENABLED` sem a avaliação ao vivo; novos detectores, conectores,
billing, cron, exportação.

---

## 14. Ciclo V1 — Google Ads, orquestração, contexto composto e enriquecimento (G1–G6, concluídos)

Arquitetura completa em [`docs/v1-architecture.md`](docs/v1-architecture.md)
(decisões D-A…D-X, invariantes INV-1…INV-25, ordem G0→G7). Resumo do avanço
(o que entrou depois do G6 — RD-1 e Cross-source V1/V1.1 em §15, a fundação do
Advisor em §16 e o modelo de linguagem e o fechamento em §17):

- **G1** — Refactor de infraestrutura: `connectors/shared/{oauth-state,token,connection}.ts`,
  OAuth Google compartilhado (`connectors/google/oauth.ts`), rotas dinâmicas
  `/api/oauth/[provider]/{start,callback}`, `mapToCanonical` → `CanonicalBatch`
  discriminado por `target`, `normalize` roteado por `target`, `runGa4Sync` →
  `runSync({connectionId})` genérico. Migração: `fact_traffic_daily.platform`
  (`NOT NULL DEFAULT 'ga4'`, na chave `UNIQUE`). GA4 byte-idêntico antes/depois.
- **G2** — Google Ads: OAuth real (scope `adwords`), discovery de contas
  (`customers:listAccessibleCustomers` + GAQL `FROM customer`), seleção de conta
  em `/conexoes`. Sem extração ainda.
- **G3** — Extração histórica campanha × dia: `fact_ad_performance_daily`
  (migração `0002_unusual_raza`), `connectors/google_ads/{http,schema,mapping,extract}.ts`,
  `upsertFactAdPerformance` isolada em `sync/normalize.ts`,
  `CanonicalBatch{target:"ad_performance"}`, botão "Importar dados" no card.
  - **Grão:** campanha × dia. **Métricas:** impressions, clicks, cost
    (`cost_micros ÷ 1e6`, 4 casas, `numeric` — nunca float), conversions,
    conversion_value, search_impression_share/budget_lost_is/rank_lost_is
    (`null` quando a API não reporta — nunca `0`). `advertising_channel_type` e
    `campaign_budget` ficam em `dims` (não promovidos a coluna no V1).
  - **Chave natural:** `(connection_id, platform, date, campaign_id, ad_network)`
    — `ad_network=''` (GAQL do V1 não segmenta por rede). Upsert por
    `source_hash` — re-sync do mesmo período não duplica.
  - **Período:** 180 dias no 1º sync; incremental
    `max(hoje−180, last_synced−14)` — `restatementWindowDays: 14`, mecanismo
    genérico do `run-sync` reaproveitado, sem scheduler novo.
  - **Versão da API:** `v25` (a `v18` fixada no G2 já estava aposentada;
    confirmada nas release notes em 2026-09; centralizada em
    `connectors/google_ads/http.ts`, reconfirmar antes do 1º sync real).
  - **Testes:** 24 testes neste bloco (mapper determinístico/idempotente, zeros,
    campos opcionais, impression share ausente→`null`, status, `CanonicalBatch`
    target, conta inválida, `DeveloperTokenMissingError` sem HTTP, paginação por
    `nextPageToken`) — offline, sem tocar banco. 60/60 testes verdes no total.
  - **`src/server/analysis/**` não foi tocado** — a existência de dados de Ads
    não muda nenhum insight ainda (isso é G5/G6). `runAnalysis` continuava
    disparado de dentro do `runSync` (desacoplado no G4 — ver abaixo).
- **G4** — Orquestração da análise passou a ser explicitamente workspace-level:
  `runAnalysis` foi **renomeado para `runWorkspaceAnalysis`** em
  `analysis/engine.ts` (mesma assinatura `{workspaceId, syncRunId}` de antes —
  já não recebia `provider`/`connector`); `sync/run-sync.ts` passou a chamar
  `runWorkspaceAnalysis` por esse nome, sem nenhum branch por provider decidindo
  se a análise roda. Nenhuma linha de `context.ts`/`detectors.ts`/`gates.ts`/
  `scoring.ts`/`stats.ts`/`templates.ts`/`types.ts` foi alterada. 6 testes-guarda
  de arquitetura novos (`analysis/__tests__/orchestration.test.ts`) travam:
  o nome antigo `runAnalysis` não pode voltar a existir; a assinatura de
  `runWorkspaceAnalysis` não pode passar a exigir `provider`; `run-sync.ts` não
  pode ganhar um `if (provider === ...)` em volta da chamada; `engine.ts`/
  `context.ts`/`types.ts` não podem referenciar `factAdPerformanceDaily`/
  `google_ads` *(guarda reformulada no G5 — `context.ts` agora DEVE ler
  `fact_ad_performance_daily`; o que permanece é que detectors/gates/scoring
  nunca referenciam Ads)*. **G4 não integra Google Ads ao `AnalysisContext`** —
  `fact_ad_performance_daily` continua invisível para o motor (isso é G5).
  66/66 testes verdes (60 de antes + 6 novos).
- **G5** — Contexto composto: `AnalysisContext` ganhou `ads: AdsContext | null`
  (os campos de tráfego continuam achatados no topo — nada foi renomeado nos
  detectores). `buildAdsContext(workspaceId, window)` — dentro de `context.ts`,
  INV-2 preservada — lê `fact_ad_performance_daily` na **mesma janela `current`**
  do tráfego (mesmo `analysisEnd`); a fusão é a função pura `composeAdsContext`.
  `AdsContext` = `{window, currency, totals, campaignCount, campaigns[]}`:
  métricas cumulativas = soma na janela; `status`/canal = snapshot do dia mais
  recente; impression share/budget lost/rank lost = média dos dias que
  reportaram (`null` se nunca reportado — nunca `0`). `ads = null` quando não há
  linha de Ads na janela (não conectado **ou** conectado sem dados). Sem série
  diária nem janela anterior de Ads. Nenhum detector/gate/scoring lê `ctx.ads`.
  Sem schema/migration. 76/76 testes (66 de antes + 9 em `ads-context.test.ts` +
  1 pela guarda do G4 reescrita). Regressão real (2026-09-22): com
  `fact_ad_performance_daily` vazio, `ctx.ads === null` e o insight
  `data-quality` saiu idêntico.
- **G6** — Enriquecimento cross-source determinístico: `enrichWithAds(insights, ads)`
  (`analysis/enrichment.ts`, pura; recebe só `ctx.ads`). O Google Ads atua
  **somente como evidência complementar** — nunca como causa nem atribuição.
  Escopo inicial: **só** `traffic-volume-drop` cujo canal responsável é
  `Paid Search` → campanhas `advertisingChannelType = SEARCH` (allowlist
  explícita). **Fail-closed**: exige `ads !== null`, janela do Ads == janela do
  insight, campanhas SEARCH confirmadas e atividade objetiva; qualquer falha →
  insight intacto. Com `ads === null` é no-op (mesma referência) — comportamento
  anterior preservado. Acrescenta apenas (1) `evidence.supportingEvidence[]` —
  campo opcional novo dentro do `evidence_json` já existente — com métricas
  **absolutas** da janela atual (campanhas, impressões, cliques, custo na moeda
  da conta, conversões, conversion value; `impressionShare` só com 1 campanha
  compatível) e (2) uma frase conservadora em `hypothesis` (sem causalidade;
  avisa que sem período anterior do Ads não se sabe se houve queda nos
  anúncios). `dedupeKey`, `severity`, `confidence`, `priorityScore`, `title`,
  `explanation` e `recommendedAction` ficam idênticos.
  - **Não alterado:** detectors, gates, scoring, severity, thresholds,
    confidence, `context.ts`, schema/migrations, OAuth/connectors/sync, UI;
    nenhuma IA/LLM.
  - **Testes:** 116/116 (76 de antes + 40 em `enrichment.test.ts`: Ads ausente,
    compatível, canal incompatível, período incompatível, dados insuficientes,
    preservação do insight, outro detector e guardas de arquitetura); 10
    mutações temporárias das guardas, todas detectadas. `typecheck`, `lint` e
    `build` verdes.
  - **Validação real (workspace MS Server, 2026-09-24):**
    `fact_ad_performance_daily = 0` → `ctx.ads === null`. O persistido é
    idêntico à saída do pipeline sem enriquecimento (título, hipótese,
    evidência, severity, confidence, priority, período, gate trace) e nada de
    Ads foi gravado; reexecução → mesmas 2 linhas, só `updated_at` muda;
    `status`/`rating`/`created_at`/`sync_run_id` preservados; a estrutura nova
    sobrevive ao round-trip em `jsonb`. Sobre o insight real, com Ads
    **fixture** só em memória, apenas `traffic-volume-drop:Paid Search` é
    enriquecido. **O enriquecimento ainda não rodou com dado real de Ads.**
  - **Pendências:** a UI **não** renderiza `supportingEvidence` (só a frase em
    `hypothesis` aparece no card); a variação temporal do Ads permanece fora do
    escopo até existir janela anterior no `AdsContext`.
- **Bloqueio ativo:** `GOOGLE_ADS_DEVELOPER_TOKEN` (Basic access, MCC) não está
  no ambiente. Sync real do Google Ads permanece bloqueado até essa credencial
  externa existir; código e testes offline estão prontos para quando ela chegar.
  **`fact_ad_performance_daily` segue com 0 linhas** (confirmado em auditoria
  read-only de 2026-09-22 e reconfirmado na regressão real de 2026-09-24, com
  `ctx.ads = null`) — nenhum sync real de Ads rodou até agora.
- **GA4 reconectado em 2026-09-22.** O refresh token havia expirado (modo OAuth
  "Testing" do Google, ~7 dias — mesmo risco documentado desde a V0/`docs/ga4-setup.md`
  §7); o usuário reconectou pela UI e um sync real rodou com sucesso
  (`sync_run` `f4951064-…`, período 2026-09-07→2026-09-22, 157 linhas lidas /
  129 gravadas). `connections.status` voltou a `connected`, `last_error=null`.
  `fact_traffic_daily` chegou a 2581 linhas (204 datas, `2026-03-03`→`2026-09-22`,
  `platform='ga4'` em 100%). O motor rodou de novo (`runWorkspaceAnalysis`) e o
  insight `traffic-volume-drop:Paid Search` **deixou de disparar** — não é bug:
  reconstrução read-only da janela mostra a queda do site em ≈ −7,5% (era ≈
  −16% no G3), abaixo do piso de materialidade de ~10%; o mesmo padrão
  ("no fio da navalha") já tinha sido observado no checkpoint original de
  2026-09-02 (§11 abaixo). O único insight ativo agora é
  `data-quality:no_key_events` *(situação de 22/09; em 24/09 o insight voltou a
  disparar — ver o bullet da regressão real abaixo)*.
- **Regressão real de 2026-09-24 e o `traffic-volume-drop`.** Com o GA4 até
  22/09 e o relógio em 24/09, o `analysisEnd` avançou de 20/09 para 22/09
  (janela `current` 26/08–22/09): a queda do site ficou em ≈ −10,8%,
  **acima** do piso de materialidade de ~10%, e o
  `traffic-volume-drop:Paid Search` (−15,9% em Paid Search) **voltou a
  disparar** — a execução criou essa linha em `insights` (`created_at`
  2026-09-24) e o `data-quality` teve `period_start`/`period_end`/
  `gate_trace_json` atualizados junto com a janela (o conteúdo analítico ficou
  idêntico). **É comportamento pré-existente do detector reagindo à janela
  móvel ("no fio da navalha", §11) — NÃO é uma mudança introduzida pelo G6:** o
  conteúdo persistido é idêntico à saída do pipeline sem o enriquecimento e,
  com `ads = null`, `enrichWithAds` é no-op. Estado do banco após a execução: 2
  insights — `data-quality:no_key_events` (prio 70) e
  `traffic-volume-drop:Paid Search` (prio 66,1, `critical`, `alta`).
- **Próximo bloco na ordem oficial (§12): G7** — contrato do Advisor, sem LLM.
  **Não iniciado** — aguarda aprovação explícita. Pendências conhecidas fora do
  escopo do G6: renderizar `supportingEvidence` na UI e uma janela anterior de
  Ads no `AdsContext` (pré-requisito para qualquer variação temporal do Google
  Ads). A análise cross-source já existe no nível de enriquecimento (G6), mas
  ainda sem dado real de Ads no banco. *(Atualização 2026-10-04: antes do G7
  entraram o RD-1 e o Cross-source V1/V1.1 — §15; depois, a fundação do G7 — o
  Advisor determinístico, sem LLM — foi entregue: §16.)*

---

## 15. Ciclo V1 (continuação) — RD Station + Cross-source V1/V1.1 (2026-10-04)

Fora da sequência G0→G7 do `docs/v1-architecture.md` (§12): entrou **depois do
G6 e antes do G7** (Advisor). Desenho e como foi construído: `docs/v1-architecture.md`
§7.5 (RD-1 e período explícito) e §8.5 (Cross-source), decisão D-V, invariantes
INV-2/4/5 revisadas e INV-16…18 novas.

```
AnalysisContext → Cross-source → cross_source_insights → (futuro) Advisor
```

- **RD-1 — RD Station Marketing e RD CRM como fontes.** Conectores com OAuth
  próprio (`connectors/rd_station_marketing`, `connectors/rd_station_crm`),
  migração `0003_cheerful_spitfire` (enum `provider` + `fact_conversion_assets_daily`
  + `fact_deals`), `ctx.rdMarketing` e `ctx.rdCrm` no `AnalysisContext` — mesma
  janela `current` do tráfego, `null` quando a fonte não tem linha —, montados por
  `composeRdMarketingContext`/`composeRdCrmContext` (puras, dentro de `context.ts`).
  Nenhum detector lê RD. Dados reais do piloto (2026-10-04): RD Marketing = 2 ativos
  de conversão, 90 linhas (2026-08-21→2026-10-04), 14 visitas e 0 conversões; RD CRM
  = 736 negociações (`campaign_id` preenchido em 0, `source_id` em 718).
- **Correção do mapper do RD Marketing + re-normalização.** A API real devolve
  `assets_type` e `conversion_count` (a documentação oficial diz outro) e o mapper
  lia os nomes errados; corrigido — inclusive o validador Zod, que descartava as
  chaves desconhecidas — e o histórico foi **re-normalizado a partir dos
  `raw_records`**, sem chamar a API, sem apagar linha, na mesma chave natural e de
  forma idempotente. Hoje nenhuma linha tem `asset_type` vazio.
- **Período explícito no `AnalysisContext`.** `buildAnalysisContext(workspaceId,
  { startDate, endDate }?)`: sem período = o comportamento de sempre (janela de 28
  dias encolhida até o último dia do GA4); com período = a janela exata (anterior =
  mesmo tamanho antes; baseline = 120 dias antes da anterior), validada por
  `AnalysisPeriodError` (datas reais, início ≤ fim, ≤ 366 dias, fim não no futuro).
  Campos aditivos: `ctx.period` (o pedido) × `ctx.coverage.inPeriod` (cobertura real
  do GA4), `rdMarketing.coverage` e `rdCrm.coverage.importedHistoryStartDate`. GA4
  atrasado vira cobertura parcial, nunca uma janela menor. Contexto padrão, gates e
  detectors saíram **idênticos** antes/depois (comparação com dado real).
- **Cross-source — camada própria** (`src/server/analysis/cross-source/`,
  `buildCrossSourceInsights(ctx)`, **pura**): 11 tipos (`data-coverage`,
  `acquisition-coverage`, `traffic-and-rd-conversions`, `commercial-activity`,
  `commercial-vs-acquisition`, `attribution-quality` e os de integridade
  `source-unavailable`, `partial-period`, `period-mismatch`,
  `population-not-comparable`, `metric-not-computable`). Cada afirmação é `fact`,
  `observable_relationship`, `hypothesis` ou `limitation` (com código estável) e
  aponta para evidência estruturada `{source, metric, period, value}`. Sem
  `severity` nem score; **sem causalidade, atribuição, CAC, ROAS nem taxa entre
  fontes sem prova nos dados**; só compara fontes que cobrem exatamente o período.
- **Persistência e interface.** Tabela `cross_source_insights` (migração
  `0004_abandoned_jigsaw`, aditiva) e `src/server/analysis/cross-source-store.ts`:
  `generateCrossSourceInsights(workspaceId, período)` — a única que escreve;
  substitui o conjunto `(workspace, período analisado)` numa transação,
  idempotente, com `id`/`created_at` estáveis e `generated_at` renovado — e
  `getCrossSourceInsights(workspaceId, período)`, que **só lê** a tabela e é a porta
  do futuro Advisor (INV-5).
- **Regra definitiva do GA4: zero ≠ ausência.** Linha existente com `sessions = 0`
  é dado válido com valor zero; ausência de linha é ausência de dado, com evidência
  `null` e texto próprio. `ga4_data_lag`, `partial-period` e `period-mismatch`
  dependem da cobertura real (existência de linha), nunca do valor da métrica.
  `WindowAgg.daysWithData` (sessões > 0) não mudou — gates e detectors seguem
  idênticos.
- **Semântica do histórico do CRM.** O campo é `importedHistoryStartDate` — o
  início do histórico de CRM **atualmente importado no SaaS** (menor `period_start`
  entre os syncs bem-sucedidos; hoje 2026-04-07) —, e os textos dizem que **não** é
  o início do histórico real do CRM. A ingestão do CRM não foi alterada.
- **Primeira geração real (2026-10-04).** Workspace piloto × 2026-10-01→2026-10-04,
  só com o que já estava no banco (sem sync, sem OAuth, sem chamada externa): 1ª
  geração `inserted 8 · updated 0 · unchanged 0 · removed 0`; 2ª geração
  `inserted 0 · updated 0 · unchanged 8 · removed 0`, com os mesmos `id` e
  `created_at`. `getCrossSourceInsights` devolveu o mesmo conjunto lógico do smoke
  anterior à persistência. As tabelas de fonte (GA4, RD Marketing, RD CRM, Ads,
  `raw_records`, `insights`, `sync_runs`, `connections`) têm fingerprint idêntico
  antes e depois — a única escrita foi em `cross_source_insights`. Os 8 insights:
  `data-coverage`, `acquisition-coverage`, `traffic-and-rd-conversions`,
  `commercial-activity`, `commercial-vs-acquisition`, `attribution-quality`,
  `population-not-comparable`, `metric-not-computable`.
- **Não ligado a nada.** Engine, sync, detectors, gates, scoring, enrichment e
  `/diagnostico` não referenciam o Cross-source — travado por testes-guarda.
  Gerar é sempre explícito (INV-16).
- **Testes.** `pnpm test` verde (450 testes) + 7 de integração opt-in contra o
  Postgres real (6 somente-leitura + 1 do store). Mutações temporárias de período,
  cobertura (incluindo a regra de zero), persistência e arquitetura foram todas
  detectadas pelos testes. Os testes de integração só rodam com opt-in — nunca leem
  `.env.local` sozinhos:
  ```bash
  env CROSS_SOURCE_DB_URL="$(node --env-file=.env.local -p 'process.env.DATABASE_URL')" \
    pnpm exec vitest run src/server/analysis/__tests__/cross-source-integration.test.ts
  ```
  Só com essa variável rodam os 6 testes somente-leitura (01–04/10 com os dados
  reais). `CROSS_SOURCE_DB_WRITE_TEST=1` acrescenta o teste do store, que insere
  dados de teste numa transação que **sempre dá rollback**. A conexão somente-leitura
  exige `connection: { options: "-c default_transaction_read_only=on" }` — o
  parâmetro de startup simples é **ignorado** por este endpoint do Neon, e o teste
  confere com `show` + um `CREATE` recusado (SQLSTATE 25006).
- **Decisões pendentes (nada disso foi feito sem aprovação):** política de
  regeneração do conjunto persistido (§11); aprovar ou ajustar
  `MIN_ATTRIBUTION_COVERAGE = 0,8`; ligar as origens do CRM a canais/ativos
  (`campaign_id` ausente + dicionário de origens) — pré-requisito de qualquer
  atribuição; quando/onde gerar (manual, após sync ou agendado); renderizar o
  Cross-source em alguma tela.
- **G7 (Advisor):** a **fundação foi entregue na sequência** — ver **§16** (sem LLM;
  lê só `insights` + `getCrossSourceInsights`, INV-5). Para retomar: `pnpm test &&
  pnpm typecheck && pnpm lint && pnpm build` e `pnpm db:generate` (deve responder
  "No schema changes").

---

## 16. Advisor V1 — fundação determinística (2026-10-04)

Depois do Cross-source (§15) e **antes de qualquer LLM** *(o modelo de linguagem foi conectado em seguida — §17; esta seção descreve a fundação como ficou antes dele)*. Desenho, decisão D-W e
invariantes INV-19…22: `docs/v1-architecture.md` §9.7. **Sem LLM, sem migração, sem
escrita em tabela alguma, sem sync, sem OAuth, sem chamada externa.**

```
insights + cross_source_insights (persistidos) → AdvisorContext → AdvisorModel → guard → AdvisorResponse
```

**A regra: a IA interpreta; o sistema calcula.** O Advisor não calcula métrica, não
inventa número, não cria evidência, não trata hipótese como fato, não junta
populações incompatíveis e não substitui o motor nem o Cross-source.

- **Arquivos** (`src/server/advisor/`): `types.ts` (contratos) · `intents.ts` ·
  `compose.ts` (`composeAdvisorContext`, pura) · `context.ts` (`buildAdvisorContext`)
  · `readers.ts` (**único** arquivo que fala com o banco — só SELECT em `insights` e
  nos períodos de `cross_source_insights`) · `comparison.ts` · `limitations.ts`
  (gravidade por código) · `format.ts` · `query.ts` · `guard.ts` ·
  `llm-contract.ts` · `deterministic-model.ts` · `service.ts`
  (`answerAdvisorQuery`) · `flag.ts` · `index.ts`. UI: `src/app/(app)/advisor/`
  (`page.tsx`, `actions.ts`, `types.ts`), `src/components/advisor/`
  (`advisor-workspace.tsx`, `response-view.tsx`), `src/lib/advisor-period.ts`. Itens
  existentes tocados: `src/env.ts` (`ADVISOR_ENABLED`), `.env.example` e o menu em
  `src/components/shell.tsx`. Motor, detectors, gates, scoring, Cross-source, sync,
  conectores e `/diagnostico` **não foram alterados**.
- **Decisão de fronteira:** o briefing pedia que o builder consumisse o
  `AnalysisContext`; D-N/INV-5 dizem que o Advisor nunca o lê. Foi seguido o caminho
  conservador **sem emendar invariante**: o `AdvisorContext` é composto só por saídas
  persistidas — o `AnalysisContext` entra indiretamente (origem do diagnóstico e do
  Cross-source). Consequência: só há fatos para períodos com Cross-source gerado.
- **`AdvisorContext`:** período (com `days`), `sources[3]` (`covered` · `partial` ·
  `unavailable` · `unknown`), estado do Cross-source (`generatedAt` = único sinal de
  frescor), `diagnostics` (itens verbatim do motor + `alignedWithPeriod`), as quatro
  camadas **separadas** — `facts`, `observations`, `hypotheses` (do Cross-source e do
  motor, com origem), `limitations` (com `severity` `blocking`/`warning`/`info`) — e o
  registro único de `evidence` (`{ref, source, metric, label, period, value, display,
  format, currency?, note?}`). Evidência e limitações são **preservadas sem
  reescrita**; `null` continua `null`; ausência ≠ zero.
- **`AdvisorQuery`:** `{workspaceId, period, comparePeriod?, intent, question?}`, Zod
  `strictObject`; na tela o workspace vem **sempre da sessão**. Intenções:
  `period_summary` · `closing_report` · `problems` · `diagnostic_explanation` ·
  `acquisition_analysis` · `commercial_analysis` · `opportunities` · `comparison` ·
  `free_question`.
- **`AdvisorResponse`:** `status` (`answered` · `partial` · `not_computable` ·
  `no_data` · `needs_model`), seções com `figures` (copiadas do contexto) e itens com
  a **camada** de cada um (fato · relação observável · hipótese · limitação ·
  diagnóstico · comparação), **todas** as limitações do contexto, evidências citadas
  (autocontida) e proveniência (`producer`, `fellBack`…).
- **`AdvisorModel`** (interface do LLM futuro) + `DeterministicAdvisorModel` (hoje).
  O serviço valida a saída (**guard**: número/data ∈ contexto, referências existem,
  fato cita evidência, moeda não assumida), completa figuras/evidência/limitações e
  faz **fallback determinístico registrado** se o modelo mentir ou falhar.
  `llm-contract.ts` guarda as regras para o prompt futuro (`advisor-prompt-v1`) e
  `buildAdvisorModelInput` (determinístico, sem o `workspaceId`).
- **Comparação** (única aritmética do Advisor, feita pelo sistema): só entre períodos
  comparáveis (ambos com Cross-source, sem sobreposição, **mesma duração**, fonte
  coberta nos dois); variação sobre base zero é `null`.
- **Tela `/advisor`** (menu "Advisor"): período (chips dos períodos com Cross-source
  gerado), comparação, sugestões, pergunta livre, estados de carregamento/vazio/erro,
  resposta estruturada com limitações por gravidade e evidências. `ADVISOR_ENABLED`
  (padrão `true`) esconde a tela; o resto do produto não depende dela (INV-8).
- **Primeiro caso real (01–04/10/2026, só leitura, dados do piloto):** "GA4: 487
  sessões em 4 de 4 dias; RD Marketing: 6 visitas e 0 conversões em 4 de 4 dias; RD
  CRM: 9 negócios criados, 5 ganhos e 14 perdidos; valor dos ganhos 23.399,00 (soma de
  1 de 5 ganhos com valor registrado; moeda não informada pelo CRM)" — todos os
  números idênticos à evidência persistida, sem hardcode. O diagnóstico do motor
  (`data-quality:no_key_events`) vem com a janela dele (05/09→02/10) e a limitação de
  janela diferente. Outubro × setembro inteiro: **não computável por duração**.
- **Validação:** `pnpm test` verde — **728 testes** (450 de antes + **278 do Advisor**:
  contexto, comparação, serviço por intenção, segurança semântica em matriz cenário ×
  intenção, guard, interface de modelo, completude das limitações, arquitetura, UI) +
  19 opt-in contra o Postgres real (12 do Advisor, só leitura); 48 mutações
  temporárias (14 de arquitetura, 34 de comportamento) todas detectadas;
  `typecheck`, `lint` e `build` verdes. Teste real:
  ```bash
  env ADVISOR_DB_URL="$(node --env-file=.env.local -p 'process.env.DATABASE_URL')" \
    pnpm exec vitest run src/server/advisor/__tests__/advisor-integration.test.ts
  ```
  (conexão com `default_transaction_read_only = on`; as tabelas lidas têm o mesmo
  fingerprint antes e depois.)
- **Decisões em aberto** (nada foi decidido sem aprovação): ler o `AnalysisContext` ao
  vivo (emenda de INV-5/D-N); gerar o Cross-source sob demanda ou após o sync e a
  política de regeneração; normalizar a comparação por dia; persistir respostas
  (`advisor_outputs`); a tela "Visão geral" (não existe); o defeito do Cross-source em
  `metric-not-computable` (§11); e, depois, o provedor de LLM (chave própria, padrão
  `false`, avaliação antes de ligar).
- **Para retomar:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`. A tela
  exige o login do Google (sessão real) em `http://localhost:3000/advisor`.

---

## 17. Advisor V1 — modelo de linguagem (2026-10-04)

Segunda etapa do Advisor: o `AdvisorModel` ganhou um **modelo de linguagem** além do
determinístico. Desenho, decisão **D-X** e invariantes **INV-23…25**:
`docs/v1-architecture.md` §9.8. **Sem migração, sem escrita em tabela alguma, sem
dependência nova, sem ferramentas e sem acesso do LLM ao banco.** Motor, detectors,
gates, scoring, Cross-source, sync, conectores, `AnalysisContext`, fact tables e
`/diagnostico` **não foram alterados**.

```
AdvisorQuery → AdvisorContext (completo, no servidor) → projeção sem PII + varredura de PII
  → AdvisorService → AdvisorModel → LlmAdvisorModel → LlmTransport → Anthropic (fetch)
  → schema (Zod) → guard estrito → AdvisorResponse     (qualquer falha → DeterministicAdvisorModel)
```

**A regra: a IA interpreta; o sistema calcula.** O modelo recebe dados já calculados e
não pode calcular, somar, criar taxa/média, inventar número, data, evidência, fonte,
moeda ou atribuição, transformar hipótese em fato nem ausência em zero.

- **Provedor:** não havia nenhum (sem SDK, sem chave). Decisão do usuário:
  **Anthropic via `fetch`, sem SDK** — igual aos conectores. Modelo padrão
  `claude-sonnet-5-5`. Os modelos Claude 5 **rejeitam `temperature`**: baixa criatividade
  vem do prompt, do schema e do guard. Saída estruturada nativa (`output_config.format`
  = JSON Schema derivado do mesmo schema Zod; sem `minLength`/`maxLength`/`maxItems`).
- **Arquivos novos** (`src/server/advisor/`): `llm/transport.ts` (fronteira + erro) ·
  `llm/anthropic.ts` (**o único que conhece o provedor**) · `llm/model.ts` ·
  `llm/config.ts` · `llm/privacy.ts` (projeção + varredura de PII) · `llm/prompt.ts` ·
  `llm/schema.ts` · `log.ts`. **Editados:** `guard.ts` (`validateLlmDraft`, moeda por
  tabela), `service.ts`, `llm-contract.ts` (regras e prompt v2), `deterministic-model.ts`
  (fallback da pergunta livre), `limitations.ts`, `types.ts` (`promptVersion`
  opcional), `flag.ts`, `index.ts`; UI mínima (`page.tsx`, `actions.ts`,
  `advisor-workspace.tsx`, `response-view.tsx`); `src/env.ts` e `.env.example`.
- **Prompt `advisor-prompt-v2`:** papel (analista sênior de dados e marketing), regra
  central, **hierarquia da verdade** (contexto → evidências → fatos/relações →
  hipóteses → limitações → linguagem), camadas com exemplos (marcadores, nunca número
  real), regras (uma única fonte, `ADVISOR_INTERPRETATION_RULES`), instrução por
  intenção e a **pergunta como dado não confiável** (JSON, só em `query.question`; nunca
  toca o prompt do sistema; premissas tratadas como não verificadas).
- **Saída:** `{title, summary, sections[{title, content, figureIds, items[{layer, text,
  evidenceIds, limitationCode}]}], insightRefs}`. O sistema deriva `status`,
  acompanhamentos e ids de seção, copia o **texto e a gravidade das limitações** do
  contexto e anexa **todas** as limitações; o modelo não cria limitação. Os **ids das
  evidências são preservados** (E1… → referências reais).
- **Guard estrito:** número só de evidência **citada** (ausência `display: null` não
  sustenta número — nunca vira zero), sem número por extenso/magnitude fora do contexto,
  sem **conta implícita** ("N cada", "por negócio", "em média"), sem plataforma (Google
  Ads, Facebook…) ou moeda (R$/reais/BRL, US$, €, £) que o contexto não tem, hipótese
  ancorada, `comparison` só com comparação calculada. Recusa ⇒ resposta determinística
  + `model_output_rejected`.
- **Privacidade:** projeção por lista de campos (campo novo não vai ao provedor sem
  decisão) + varredura fail-closed de PII (inclui a pergunta digitada). Auditoria do
  contexto real de 01–04/10: **sem PII** (12 strings pessoais/de conta do banco
  procuradas: nenhuma no payload). Log só de metadados (`advisor.llm`, `advisor.answer`).
- **Fallback:** credencial ausente · tempo limite · erro da API · **conta sem crédito**
  (a API a devolve como HTTP 400; classificada como `billing`) · recusa · saída
  truncada/inválida · PII · guard ⇒ determinístico + `model_failed`/`model_output_rejected`
  com o motivo em português. Pergunta livre em fallback recebe o **resumo determinístico**
  do período. Sem Cross-source gerado, ou comparação não computável, o LLM **nem é chamado**.
- **Flags:** `ADVISOR_ENABLED` (padrão `true`) e `ADVISOR_LLM_ENABLED` (padrão **`false`**),
  independentes. `ANTHROPIC_API_KEY` opcional (vazio = ausente). Opcionais:
  `ADVISOR_LLM_MODEL`, `ADVISOR_LLM_EFFORT`, `ADVISOR_LLM_TIMEOUT_MS`.
- **Testes:** além dos 728 anteriores, a suíte do LLM — provider em nível HTTP, schema,
  privacidade, guard estrito (uma violação provada por regra aplicada), serviço, semântica
  das camadas, prompts adversariais, configuração, arquitetura e UI — e o teste **ao vivo**
  opt-in (banco real somente leitura + API real):
  ```bash
  env ADVISOR_DB_URL="$(node --env-file=.env.local -p 'process.env.DATABASE_URL')" \
      ANTHROPIC_API_KEY="$(node --env-file=.env.local -p 'process.env.ANTHROPIC_API_KEY')" \
      ADVISOR_LLM_LIVE=1 ADVISOR_LIVE_BUDGET=small ADVISOR_LIVE_OUT=/tmp/advisor-live.json \
    pnpm exec vitest run src/server/advisor/__tests__/advisor-llm-integration.test.ts
  ```
  (`ADVISOR_LIVE_BUDGET=small` = só a pergunta de fechamento e um ataque; sem ele rodam
  todas as intenções e os quatro ataques. Uma **chamada-sonda** mínima abre o teste e o
  aborta, com a mensagem do provedor, se a conta/credencial não funcionar. Não use `-t`:
  o título da suíte casa com quase tudo.)
- **Teste ao vivo — estado em 2026-10-04:** comprovado contra o ambiente real: conexão
  somente leitura, fingerprints iguais antes/depois, **payload enviado sem PII** (sistema
  ≈10,4 mil + dados ≈17,3 mil caracteres, ≈8 mil tokens) e **fallback contra a API real**.
  A conta dona da `ANTHROPIC_API_KEY` está **sem crédito** ("Your credit balance is too
  low…", HTTP 400): o Advisor respondeu de forma determinística em todas as tentativas e
  nenhuma requisição foi processada (nenhum token consumido). **Não comprovado:** a
  resposta do modelo real (pergunta de fechamento, prompts adversariais, taxa de
  aceitação do guard estrito, latência e custo) — **pendente de crédito na conta do
  provedor**, ação de cobrança do usuário.
- **Decisões em aberto** (nada decidido sem aprovação): quando ligar `ADVISOR_LLM_ENABLED`
  para o usuário (a avaliação ao vivo antes de cada mudança de prompt/modelo/esforço);
  limite de uso/orçamento por workspace; `maxDuration` ao publicar; as decisões da §16.
- **Fechamento do Advisor V1 (2026-10-05) — estado de entrega:** **Advisor determinístico = pronto · Advisor LLM/Anthropic = implementado e desligado (`ADVISOR_LLM_ENABLED=false`) · fallback = funcionando · dados reais = funcionando · testes, typecheck, lint e build verdes · nenhuma chamada paga à Anthropic** (nem teste ao vivo, nem sonda, nem consulta de saldo; os processos que leram o banco real receberam só a URL do banco, nunca a chave da API). Detalhes e números em `docs/v1-architecture.md` §9.8, "Fechamento".
  - **Corrigido (só o já identificado):** (1) o formato das contagens `rd_crm.lost_deals_with_value`/`won_deals_with_value` em `metric-not-computable` — `cross-source/integrity.ts` deixou de inferir "dinheiro" pelo sufixo `_value` e usa uma lista explícita (`won_value`, `lost_value`, `average_ticket`); 5 testes novos que falham sem a correção (provado por mutação); (2) a pergunta livre com o LLM desligado agora recebe o **resumo determinístico do período, dito como tal** (antes só `needs_model`); os 4 testes que fixavam o comportamento antigo foram reescritos (um deles virou cinco) e travam o novo (4 mutações detectadas).
  - **Validado sobre os dados reais de 01–04/10/2026** (somente leitura; fingerprints iguais antes e depois): resumo, fechamento, comercial, problemas, aquisição e pergunta livre respondem sem `fellBack`; números conferidos com SQL direto: GA4 **487** sessões · 0 eventos-chave · 4/4 dias; RD Marketing **6** visitas · 0 conversões · 4/4 dias · 2 ativos; CRM **9** criados · **5** ganhos · **14** perdidos · valor ganho **23.399,00** em **1 de 5** ganhos, moeda **não informada** (nunca "R$").
  - **Pendência original (superada em 2026-10-05):** regenerar o conjunto de 01–04/10 para a linha corrigida chegar ao banco. Em vez disso foi gerado o **fechamento oficial 2026-09-01→2026-10-04** (bullet abaixo), já com o gerador corrigido; o conjunto de 01–04/10 ficou como **snapshot anterior (histórico etiquetado)**, defasado no GA4 e ainda com o formato antigo dessa linha; narrativa, figuras e números do Advisor não são afetados.
  - **Testes ao fim do fechamento:** `pnpm test` → 41 arquivos passam + 3 opt-in pulados; **1072 passam, 32 opt-in pulados, 0 falham** (eram 1063: +9); pasta do Advisor 618 passam + 25 pulados. `typecheck`, `lint` e `build` verdes (rota `/advisor` presente); `db:generate` → "No schema changes" (5 migrações; nenhuma criada).
- **Fechamento oficial do Cross-source (2026-10-05, 13:51:56Z) — 2026-09-01 → 2026-10-04.** Geração autorizada e explícita (`generateCrossSourceInsights`), só para este período, depois de um dry-run: plano real `inserted 8 · updated 0 · unchanged 0 · removed 0`; a escrita foi **só** em `cross_source_insights` (1 INSERT numa transação; o contexto foi lido por uma conexão somente-leitura e só o store recebeu a conexão de escrita). Retrato de contagem e hash das 13 tabelas antes × depois: só `cross_source_insights` mudou (8 → 16); fact tables, `raw_records`, `sync_runs` e `connections` idênticos; o snapshot 01–04/10 ficou intacto. Sem sync, sem reconexão, sem alteração de código, migração, schema, Advisor ou `AnalysisContext`. Persistidos 8 insights (`data-coverage`, `acquisition-coverage`, `traffic-and-rd-conversions`, `commercial-activity`, `commercial-vs-acquisition`, `attribution-quality`, `population-not-comparable`, `metric-not-computable`), sem duplicados (índice único `(workspace_id, period_start, period_end, dedupe_key)`); `getCrossSourceInsights` devolve exatamente essas 8 linhas e uma regeneração hipotética daria `unchanged 8`. Números: GA4 **6.443** sessões (34/34 dias, 0 eventos-chave) · RD Marketing **12** visitas e **0** conversões (34/34 dias, 2 landing pages) · RD CRM **110** criados, **11** ganhos, **104** perdidos (taxa de ganho 9,6%), valor dos ganhos **61.399,00** em **5 de 11** ganhos (moeda não informada), 0 de 104 perdidos com valor. O Advisor determinístico responde resumo, fechamento e pergunta livre (sem LLM, dita como tal) sobre este período, sem "R$" e sem fallback. **Ressalva:** o 04/10 do GA4 pode estar provisório (58 sessões; domingos normais 92–119) — para o fechamento final, ressincronizar depois de 07/10 e regenerar (idempotente).
- **Para retomar:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`.
