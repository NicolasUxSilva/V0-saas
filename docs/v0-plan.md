# v0-saas — Plano da V0

> Documento de referência da V0. Consolidado após 4 rodadas de refinamento de escopo.
> Status: **aprovado**. Implementação em andamento, bloco a bloco, com pausa para
> confirmação ao fim de cada bloco.

---

## 1. Tese do produto

> "Não quero construir outro dashboard de marketing.
> Quero um sistema que olha os dados e diz, **com evidência suficiente**,
> onde está o gargalo e o que merece investigação."

O dashboard/métricas é **camada de apoio**. A experiência principal é:

```
DADO → ANÁLISE → PROBLEMA/OPORTUNIDADE → EVIDÊNCIA → HIPÓTESE → AÇÃO
```

Todo insight responde, nesta ordem:

1. **O QUE** aconteceu?
2. **QUANTO** mudou?
3. **ONDE** está concentrado?
4. **POR QUE** os dados sustentam essa hipótese?
5. **O QUE** investigar / fazer agora?

### Padrão de qualidade esperado

> "Conversões caíram 27% nos últimos 28 dias."
>
> "Organic Search responde por 71% da queda porque sua taxa de conversão caiu de
> 3,4% para 2,1%, enquanto o volume de sessões permaneceu relativamente estável."
>
> "Ação: investigar as landing pages orgânicas e alterações de conteúdo ocorridas
> no período."

### O que a V0 deve impedir

- "Seu tráfego caiu. Considere revisar suas campanhas." (genérico, sem evidência)
- Insight sem número, sem comparação temporal, sem dimensão responsável.
- Correlação apresentada como causalidade.
- Esconder incerteza.
- Usar LLM para decidir se existe um problema.

Quando os dados não sustentam uma conclusão, o produto **diz isso** (insight de
`data_quality`) ou **não gera diagnóstico**.

---

## 2. Objetivo da V0 (a espinha)

```
Login → conexão OAuth com GA4 → seleção da propriedade → sincronização (180d)
      → normalização → motor determinístico de análise → tela Diagnóstico
      → validação manual (útil? / não útil?)
```

| # | Passo | "Pronto" significa |
|---|---|---|
| 1 | Login | Google OAuth → `users` + `workspaces` + `workspace_members` no 1º acesso; sessão JWT |
| 2 | Conectar GA4 | OAuth `analytics.readonly` (offline); tokens cifrados em `connections`; `status='connected'` |
| 3 | Selecionar propriedade | `accountSummaries.list` → `connection_properties`; 1 marcada `is_selected` |
| 4 | Sincronizar | "Atualizar dados" → `runReport` 180d → `raw_records`; `sync_runs.status='success'` |
| 5 | Normalizar | `raw_records` → `fact_traffic_daily` (upsert idempotente por `source_hash`) |
| 6 | Analisar (determinístico) | `analysis.engine` pós-sync: context → gates → 3 detectores → `insights` |
| 7 | Tela Diagnóstico | Resumo + seções + `InsightCard` com evidência numérica + reconhecer/descartar/👍👎 |

---

## 3. Escopo — dentro / fora

### Dentro da V0

- 1 conector real: **GA4**.
- Motor de análise **determinístico** (regras + estatística), 3 detectores.
- Tela **Diagnóstico** (centro do produto) + bloco "Métricas de apoio".
- Login Google, 1 workspace, sync manual.

### Fora da V0 (removido temporariamente)

| Item | Volta em |
|---|---|
| Conectores Google Ads / Meta Ads / RD Station (implementação) | V1+ |
| LLM / IA generativa / narrativa | V1+ |
| Billing, planos, limites de uso | V1+ |
| Cron / worker / fila / sync automático | V1 |
| Multi-tenant avançado: RLS, papéis, convites, troca de workspace, SSO | V1 |
| Audit log, notificações, alertas, e-mail, relatórios PDF | V1+ |
| Página `/metricas` autônoma (vira bloco dentro de `/diagnostico`) | V1 |
| Página `/configuracoes` (desconectar vai para `/conexoes`; sair, para o topo) | V1 |
| Detectores 4–6 (`conversion-volume-drop`, `emerging-growth`, 2º de canal) | Assim que o 1º teste validar os 3 |
| Dedupe histórico de insights / auto-resolução | V1 (na V0, cada análise substitui os insights abertos) |
| Onset/changepoint sofisticado | V0 usa versão simples (máx-t); se fraco, usa "no período" |
| `landing_page` / `device` como dimensões | V1 (exigem scrub de PII) |
| Testes E2E, CI, cobertura de UI | V1 (na V0, só `analysis/` com Vitest) |
| Identidade visual, dark mode, landing page, animações | V1+ |
| Deploy (Vercel) | Quando necessário — a V0 roda em `localhost` |

### O que permanece preparado para V1 (costuras anti-retrabalho)

| Costura | Estado na V0 | Por quê evita retrabalho |
|---|---|---|
| Interface `Connector` + `registry` | GA4 implementa 100%; Ads/Meta/RD são stubs registrados que lançam `NotImplemented` | Novo conector = 1 arquivo + trocar o stub. UI e motor não mudam. |
| Camada RAW (`raw_records`, append-only, JSONB) | GA4 grava cru antes de transformar | Reprocessa mudança de mapeamento sem re-bater na API. Vale para qualquer fonte. |
| Canônico agnóstico de fonte (`fact_traffic_daily` com `platform`, `dims jsonb`) | Só GA4 escreve hoje | Ads/Meta caem na mesma tabela. Detectores nunca sabem a origem. |
| `provider` enum já com os 4 | `ga4 \| google_ads \| meta_ads \| rd_station` | Sem migração de enum depois. |
| Motor lê só o canônico | Detectores recebem `AnalysisContext`, nunca JSON do GA4 | Adicionar Ads = mais linhas no contexto; zero mudança nos detectores. |
| `insights` estruturado | `kind`, `severity`, `evidence_json`, `hypothesis`, `recommended_action` etc. | Camada LLM em V1 só **lê** `insights` e escreve prosa — nunca entra na decisão. |
| `metrics/dictionary` | Fórmulas canônicas num lugar só | Cada plataforma nova adiciona seu mapeamento ali. |
| Token cifrado + `key_version` | AES-256-GCM com versão de chave | Rotação de chave sem downtime. |
| `workspace_id` em toda tabela + helper de escopo | Sem RLS, mas escopo obrigatório em toda query | Ligar RLS / multi-tenant real em V1 é aditivo. |

---

## 4. Arquitetura

```
┌──────────────────────────────────────────────────────────────────────┐
│  Next.js 16 · 1 app · 1 processo · sync manual inline                 │
│                                                                      │
│  UI                       Route Handlers        Server Actions        │
│  /diagnostico ★           /api/auth/*           conectarGA4()         │
│  (Resumo + seções)        /api/oauth/ga4/*      selecionarPropriedade()│
│  /conexoes                /api/health           atualizarDados()      │
│                                                 reconhecer/avaliar()  │
├──────────────────────────────────────────────────────────────────────┤
│  ★★ MOTOR DE ANÁLISE (determinístico — o produto) ★★                  │
│  context ─► gates ─► detectores ─► contribution ─► templates ─►       │
│  (janelas)  (confia-  (regras +     (mix vs        (o quê / quanto /   │
│             bilidade)  cálculos)    eficiência,    onde / porquê /     │
│                                     onset)         ação — SEM LLM)     │
│                          └─► scoring ─► insights (priorizados)        │
├──────────────────────────────────────────────────────────────────────┤
│  MÉTRICAS: dictionary (fórmulas) + queries tipadas                    │
├──────────────────────────────────────────────────────────────────────┤
│  CANÔNICO: fact_traffic_daily (denormalizada, agnóstica de fonte)     │
├──────────────────────────────────────────────────────────────────────┤
│  SYNC: run-sync (extract → raw → normalize → analyze) · crypto        │
├──────────────────────────────────────────────────────────────────────┤
│  CONECTORES: types (contrato) + registry                              │
│  · ga4/          → REAL                                               │
│  · google-ads/ meta-ads/ rd-station/ → ESTRUTURA (lançam NotImplemented)│
├──────────────────────────────────────────────────────────────────────┤
│  RAW: raw_records (JSONB, append-only, replayável)                    │
├──────────────────────────────────────────────────────────────────────┤
│  PostgreSQL (Neon) + Drizzle · 9 tabelas · sem RLS/MV/partição        │
└──────────────────────────────────────────────────────────────────────┘
```

### Stack

| Camada | Escolha |
|---|---|
| Runtime / linguagem | Node 24 · TypeScript strict |
| Framework | Next.js 16 (App Router) — 1 processo, sync inline |
| Package manager | pnpm (via Corepack) |
| Banco | PostgreSQL (Neon, conexão direta) + Drizzle ORM |
| Auth app | Auth.js v5 — Google, sessão **JWT pura** (sem adapter, sem tabela de sessão); upsert de user/workspace no callback |
| Cliente GA4 | `google-auth-library` (OAuth + refresh) + `fetch` cru nos 2 endpoints (Admin `accountSummaries.list`, Data `runReport`) |
| Cifra de tokens | Node `crypto` — AES-256-GCM, IV por registro, `key_version` |
| Validação | Zod (env, fronteiras de API, respostas do GA4) |
| UI | Tailwind + shadcn/ui + Recharts (uso mínimo) |
| Testes | Vitest — **apenas `src/server/analysis/`** |

> Nota: o plano falava em "Next.js 15"; `create-next-app@latest` entregou **Next 16**.
> Mudanças relevantes já absorvidas: `middleware` → arquivo `proxy.ts` (runtime nodejs,
> sem edge); Request APIs (`cookies`, `headers`, `params`, `searchParams`) são
> assíncronas; Turbopack é o bundler padrão em dev e build; `next lint` foi removido
> (usa-se `eslint` direto). Arquitetura da V0 inalterada.

---

## 5. Modelo de dados (9 tabelas)

Postgres. IDs `uuid`. Timestamps UTC. Sem RLS, sem materialized view, sem partição.
Toda tabela de negócio carrega `workspace_id` e é acessada por um helper que força o escopo.

### 5.1 Identidade
```
users              (id, email UNIQUE, name, image, created_at)
workspaces         (id, name, created_at)
workspace_members  (workspace_id → workspaces, user_id → users,
                    role DEFAULT 'owner', created_at,
                    PK (workspace_id, user_id))
```
Auth.js em modo JWT → sem tabelas de sessão/account.

### 5.2 Conexão com fonte externa
```
connections        (id, workspace_id → workspaces,
                    provider,            -- 'ga4' | 'google_ads' | 'meta_ads' | 'rd_station'
                    status,              -- 'connected' | 'reauth_required' | 'error'
                    external_account_email,
                    access_token_enc bytea, refresh_token_enc bytea,
                    token_expires_at, scopes text[], key_version int,
                    created_by → users, created_at, last_synced_at, last_error text)

connection_properties (id, connection_id → connections,
                    external_id,         -- "properties/123456789"
                    display_name, timezone, currency,
                    is_selected bool DEFAULT false, created_at)
```

### 5.3 Sincronização
```
sync_runs          (id, connection_id → connections,
                    trigger,             -- 'manual' | 'initial'
                    status,              -- 'running' | 'success' | 'partial' | 'failed'
                    period_start date, period_end date,
                    rows_in int, rows_written int, error text,
                    started_at, finished_at)
```

### 5.4 RAW (imutável, replayável)
```
raw_records        (id, connection_id → connections, provider, stream,
                    occurred_on date, payload jsonb, source_hash text, fetched_at,
                    INDEX (connection_id, stream, occurred_on))
```

### 5.5 Canônico (agnóstico de fonte)
```
fact_traffic_daily (id, workspace_id → workspaces, connection_id → connections,
                    date date,
                    channel text,        -- GA4 sessionDefaultChannelGroup
                    source text, medium text, campaign text,
                    sessions bigint, total_users bigint, new_users bigint,
                    engaged_sessions bigint, avg_engagement_time numeric,
                    key_events numeric, conversion_value numeric,
                    dims jsonb,          -- landing_page/device (V1) sem migração
                    source_hash text, updated_at,
                    UNIQUE (connection_id, date, channel, source, medium, campaign))
```
Removidos do plano por serem "métrica fácil, não acionável": `bounce_rate`,
`avg_session_duration`.

### 5.6 Inteligência (saída do produto)
```
insights (
  id, workspace_id → workspaces, sync_run_id → sync_runs,
  detector,
  kind,               -- 'problem' | 'opportunity' | 'data_quality'
  severity,           -- 'critical' | 'attention'   (sem 'info')
  status,             -- 'open' | 'acknowledged' | 'dismissed'
  title,
  impact_json,        -- { value, unit:'conversions'|'sessions'|'BRL', basis, isEstimate:true }
  explanation,        -- o QUE (métrica, Δ%, atual vs anterior, janela)
  hypothesis,         -- o PORQUÊ (contribution + onset, via template)
  evidence_json,      -- { current, previous, baseline, deltaPct, zScore, test, breakdown[] }
  period_start, period_end, compared_to,
  responsible_dimension_json,   -- { name:'channel', value:'Organic Search', share:0.71 }
  confidence,         -- 'alta' | 'media'   (abaixo disso não cria o insight)
  confidence_basis_json,        -- { zScore, sampleSize, completeness, stableAcrossHalves }
  recommended_action,
  priority_score numeric,
  dedupe_key text,
  rating smallint,    -- +1 / -1 / null  (feedback de validação)
  gate_trace_json,    -- G0..G4: valores medidos (auditável, não exibido)
  created_at, updated_at,
  UNIQUE (workspace_id, dedupe_key)
)
```

---

## 6. Fluxo completo

```
Usuário → /login (Entrar com Google) → Auth.js callback → upsert user → JWT
   1º acesso: cria workspace + member(owner) → /diagnostico

/conexoes → "Conectar GA4"
   → GET /api/oauth/ga4/start
       scope analytics.readonly · access_type=offline · prompt=consent
       state = JWT curto assinado { workspace_id, nonce, exp }
   → consentimento Google
   → GET /api/oauth/ga4/callback
       valida state → troca code → cifra tokens (AES-256-GCM) → INSERT connections
   → discovery: accountSummaries.list → connection_properties
   → /conexoes/ga4 → escolher propriedade → is_selected = true

"Atualizar dados"  (server action, inline)
   1. sync_runs (running); janela: 1º = 180d / depois = desde last_synced_at − 3d
   2. TokenManager: decifra / refresh se expirado
        refresh falhou → connections.status='reauth_required' → ErrorState (Reconectar)
   3. ga4.extract → runReport paginado
        dims:    date, sessionDefaultChannelGroup, sessionSource,
                 sessionMedium, sessionCampaignName
        metrics: sessions, totalUsers, newUsers, engagedSessions,
                 userEngagementDuration, keyEvents, totalRevenue
        429 → backoff exponencial (3x) → senão status='partial'
   4. store raw → raw_records
   5. normalize → UPSERT fact_traffic_daily (idempotente por source_hash)
   6. sync_runs = success | partial ; connections.last_synced_at = now
   7. analysis.engine.run(workspaceId, syncRunId)
        context → gates(G0..G4) → detectores → contribution → templates → scoring
        → substitui os insights abertos do workspace (V0: sem histórico)
   8. revalidatePath('/diagnostico')

Usuário lê o Diagnóstico → por card: Reconhecer / Descartar / 👍 / 👎
   → insights.status / insights.rating
```

Corte temporal: a janela de análise termina em **D-2** (fuso da propriedade),
porque as últimas ~48h de dados do GA4 são incompletas.

---

## 7. Motor de análise determinístico

`dados → regras → cálculos → evidência → insight estruturado`. Sem LLM.

### 7.1 Contexto (`analysis/context.ts`)
- **Janela atual**: 28 dias, terminando em D-2.
- **Janela anterior**: 28 dias imediatamente antes.
- **Baseline**: ~120 dias anteriores → série diária, mediana + MAD por métrica.
- **Recortes**: agregados por dia, por `channel`, por `source/medium`, por `campaign`.

### 7.2 Gates de confiabilidade (rodam ANTES de qualquer detector emitir)

| Gate | Verifica | Reprova ⇒ |
|---|---|---|
| **G0 — Disponibilidade** | ≥ 150/180 dias com dados; janela atual e anterior com ≥ 26/28 dias cada; corte D-2 | Só `data_quality` "histórico insuficiente"; nada comparativo |
| **G1 — Volume mínimo** | Tráfego: ≥ 500 sessões/janela (segmento ≥ 200). Taxa: ≥ 100 sessões **e** ≥ 25 key events no segmento (`np ≥ 10`) | Segmento ignorado; global falha ⇒ `data_quality` "volume insuficiente" |
| **G2 — Significância** | Taxas: **z de duas proporções**, `\|z\| ≥ 1,96`. Volumes: **z robusto** vs baseline (mediana + MAD), `\|z_robust\| ≥ 2,5` | Sem insight (não especula) |
| **G3 — Materialidade** | `\|Δ%\| ≥ 10%` **e** impacto absoluto ≥ piso (≥ 300 sessões ou ≥ 10 key events na janela) | Sem insight (significativo mas irrelevante) |
| **G4 — Qualidade (veto)** | `(not set)+(direct)` > 40% das sessões; dia zerado entre dias não-zerados; zero key events em 180d; queda permanente a ~zero; fuso propriedade ≠ workspace | Emite `data_quality` **e suprime** os insights dependentes |

**Banda de confiança** (determinística):
- **Alta**: `\|z\| ≥ 3,0` · completude ≥ 95% · volume ≥ 2× mínimo · efeito com mesmo sinal nas 2 metades da janela.
- **Média**: `\|z\| ≥ 1,96` · completude ≥ 90% · volume ≥ mínimo.
- Abaixo disso ⇒ **o insight não é criado**.

### 7.3 Análise de contribuição (`analysis/contribution.ts`) — o "porquê"

Decomposição de fórmula fechada (não geração de texto):
```
Δ key_events ≈ Σ_seg [ (sessões_atual − sessões_ant) · taxa_ant ]     ← efeito VOLUME/MIX
            +  Σ_seg [ sessões_atual · (taxa_atual − taxa_ant) ]       ← efeito EFICIÊNCIA
```
- Ranqueia segmentos por contribuição; reporta os que somam ≥ 70% da variação.
- **Onset** (versão simples): sobre a série diária do segmento responsável, ponto
  de quebra que maximiza a estatística t (antes/depois). Retorna a data, ou
  "no período" se não houver degrau claro — **nunca inventar precisão**.

### 7.4 Templates (`analysis/templates.ts`) — 100% determinístico

Frases montadas por preenchimento de lacunas com valores calculados. Chave =
`(detector, efeito dominante, tipo de dimensão)`. Nenhuma string é gerada por modelo.

### 7.5 Detectores da V0 (3)

| Detector | `kind` | Pergunta | Lógica |
|---|---|---|---|
| `conversion-efficiency-drop` | problem | O que aconteceu? Onde está o gargalo? | Total de key events caiu; efeito **eficiência** dominante na decomposição. Aponta o segmento responsável e a queda de taxa. |
| `traffic-volume-drop` | problem | O que aconteceu? | Sessões/usuários caíram vs baseline (z robusto). Efeito **volume** dominante. Aponta canal/fonte responsável e o onset. |
| `data-quality` | data_quality | O que investigar primeiro? | Checks do G4 como insight. Roda primeiro; pode vetar os outros. |

(+2 depois, se o 1º teste pedir: `channel-underperformance`, `channel-opportunity`.)

### 7.6 Scoring
```
priority_score =  w1·severity  +  w2·magnitude(|Δ%|)  +  w3·volume_impact
               +  w4·confidence  +  w5·recency(onset)
```
`data_quality` recebe piso alto (aparece no topo quando veta algo).

### 7.7 Ciclo de vida (V0)
Cada análise **substitui** os insights `open` do workspace. Sem histórico, sem
dedupe sofisticado (V1).

---

## 8. UI

Prioridades (nesta ordem): **legibilidade · hierarquia da informação ·
compreensão do diagnóstico · evidência · confiança · velocidade**.
Sem identidade visual definitiva, sem gráficos decorativos, sem animação.

### Telas

| Tela | Rota | Conteúdo |
|---|---|---|
| Login | `/login` | "Entrar com Google". Loading/erro. |
| Shell + Sidebar | `(app)/layout` | Sidebar (Diagnóstico, Conexões), topbar com workspace + menu do usuário + "último sync há X". |
| **Diagnóstico** ★ | `/diagnostico` | **Resumo**: nº de problemas críticos, pontos de atenção, oportunidades, qualidade dos dados, última atualização. Depois, em ordem: **1. Problemas críticos · 2. Pontos de atenção · 3. Oportunidades · 4. Métricas de apoio** (bloco compacto: sessões / usuários / key events / taxa — atual vs anterior vs Δ%). |
| Conexões | `/conexoes` | Card **GA4** (status, conta, propriedade, último sync, "Atualizar dados", histórico de `sync_runs`, reconectar/desconectar). Cards **Google Ads / Meta Ads / RD Station** desabilitados, selo "Em breve". |
| Conexão GA4 | `/conexoes/ga4` | Lista de propriedades (radio) pós-OAuth; confirmar seleção; disparar 1º sync. |

### InsightCard — campos obrigatórios (todos)

título direto · impacto (quantificado) · o que está acontecendo · por que
provavelmente · evidências numéricas · período analisado · dimensão responsável ·
nível de confiança · ação recomendada · reconhecer/descartar · 👍/👎

### Estados (sistema reutilizável)

`LoadingState` (skeleton) · `ErrorState` (com retry) · `EmptyState` (com CTA) ·
`PartialState` (dados incompletos).

Quando nenhum insight é emitido: estado honesto — *"Nenhuma variação
estatisticamente relevante no período. Gates aplicados: [lista com os números]."*

---

## 9. Blocos de implementação (ordem exata)

Cada passo: implementar só o necessário → rodar checks → verificar TypeScript →
verificar boot → relatar → **parar e aguardar confirmação**.

### Bloco A — esqueleto + UI com mock (sem GA4)
| Passo | Entrega | Verificável quando |
|---|---|---|
| **A0** | Repo, Next, TS strict, pnpm, `env.ts`, `.env.example`, `drizzle.config.ts`, `/api/health`, `docs/v0-plan.md`, `README.md` | `pnpm dev` sobe; `/api/health` 200; typecheck/lint/build OK. `db:push` fica para o A1 (precisa da DATABASE_URL) |
| A1 | `schema.ts` (9 tabelas) + 1ª migração | `pnpm db:push` conecta no Neon; tabelas existem |
| A2 | Auth.js Google + `proxy.ts` + `/login` + criação de workspace no 1º login | login → linhas em `users`/`workspaces`/`workspace_members` → cai em `/diagnostico` |
| A3 | Shell (`layout`, sidebar), `states.tsx`, shadcn instalado | navego entre telas vazias; os 4 estados renderizam |
| A4 | `/diagnostico` (Resumo + 4 seções + `InsightCard`) + `/conexoes` (shell) lendo `src/mock.ts` | **revisão e aprovação do layout do card e das seções** |

### Bloco B — GA4 real + dados
| Passo | Entrega | Verificável quando |
|---|---|---|
| B0 | `crypto.ts` + `connectors/types.ts` + `registry.ts` + `stubs.ts` | round-trip de cifra; registry lista 4 providers (3 lançam `NotImplemented`) |
| B1 | `api/oauth/ga4/start` + `callback` + OAuth do `ga4.ts` + `discovery` | OAuth real contra o **seu** GA4 → `connections` com tokens cifrados + propriedades listadas |
| B2 | `conexoes/page.tsx` + `conexoes/actions.ts` (conectar, escolher, desconectar) | seleciono propriedade; `is_selected` persiste |
| B3 | `ga4.ts` (extract `runReport`) + `sync.ts` (raw + normalize) + ação "Atualizar dados" + `sync_runs` | import real de 180d do seu GA4; linhas em `fact_traffic_daily`; 2º run **não duplica**; histórico mostra contagem |
| B4 | `metrics.ts` (queries) + bloco "Métricas de apoio" com dados reais | números batem com o GA4 (arredondamento/amostragem) |

### Bloco C — motor determinístico
| Passo | Entrega | Verificável quando |
|---|---|---|
| C0 | `analysis/types.ts` + `stats.ts` (z 2 proporções, z robusto, máx-t) + testes | `pnpm test` verde em `stats` |
| C1 | `gates.ts` (G0–G4 + banda de confiança) + testes | gates barram ruído nos `fixtures.ts` |
| C2 | `context.ts` (janelas 28/28/~120, corte D-2, agregados) | contexto correto sobre dados reais |
| C3 | `contribution.ts` (mix vs eficiência + onset simples) + testes | decomposição soma ~100% da variação |
| C4 | `detectors.ts` (3) + `engine.ts` (roda → gates → templates → scoring → grava) + testes | fixtures com problemas plantados → insights esperados, na prioridade esperada |
| C5 | `engine.run()` plugado no fim do `sync.ts`; `/diagnostico` lê `insights` reais; `actions.ts` (ack/dismiss/rate); `USE_MOCK=false` | sync real no seu GA4 → insights reais na tela; feedback grava no banco |

### Bloco D — teste com empresa real
| Passo | Entrega | Verificável quando |
|---|---|---|
| D0 | `docs/ga4-setup.md` + revisão dos 4 estados | F1–F9 (§11) verdes no seu ambiente |
| D1 | Conectar o GA4 da **MS Server** (após verificar critérios mínimos); sessão de validação | P1–P4 (§11) medidos |

---

## 10. Decisões técnicas (registro)

| # | Decisão | Definição |
|---|---|---|
| — | Pasta | `V0 SAAS` → **`v0-saas`** (feito no A0) |
| — | Banco | Neon provisionado pelo usuário; DATABASE_URL fornecida no A1. Não assumir string real antes disso. |
| — | Empresa-piloto | **MS Server**. Verificar volume e key events **antes** do teste real. Não assumir que atende. |
| D4 | Cliente GA4 | `google-auth-library` + `fetch` |
| D5 | Auth.js | JWT puro + upsert de user/workspace no callback. Sem adapter Drizzle. |
| D6 | OAuth | 1 client Google para login e dados, com fluxos e scopes **claramente separados**; sem permissões desnecessárias. |
| D7 | Deploy | `localhost` na 1ª fase. Sem Vercel agora. |
| D8 | Janela | 28d atual / 28d anterior / baseline ~120d / corte D-2 |
| D9 | Detectores | 3: `conversion-efficiency-drop`, `traffic-volume-drop`, `data-quality`. Não adicionar outros ainda. |
| D10 | Import | 180 dias |
| D11 | Onset | versão simples; sem inventar precisão ("no período" quando fraco) |
| D12 | Ciclo de vida | cada análise substitui os insights abertos. Sem histórico/dedupe sofisticado. |
| D13 | Moeda/fuso | fuso + moeda da propriedade. Sem conversão. |
| D14 | Package manager | pnpm via Corepack |
| D15 | Testes | Vitest apenas para `analysis`. Sem CI. |

---

## 11. Critérios de sucesso do 1º teste

### Funcionais — todos precisam passar
| # | Critério |
|---|---|
| F1 | Login Google cria workspace sem passo manual no banco |
| F2 | OAuth GA4 conecta; ≥ 1 propriedade listada; seleção persiste |
| F3 | "Atualizar dados" importa ≥ 150/180 dias; `fact_traffic_daily` populada; run com contagem |
| F4 | 2º "Atualizar dados" **não** duplica linhas |
| F5 | Motor roda automaticamente após o sync, sem erro |
| F6 | Cada insight tem **todos** os campos do card preenchidos |
| F7 | Todo insight emitido passou pelos gates (`gate_trace_json` auditável) |
| F8 | Sem key events **ou** `(not set)+(direct) > 40%` ⇒ `data_quality` + supressão dos dependentes |
| F9 | Os 4 estados (loading / empty / error com retry / partial) aparecem corretos |

### De produto — o que valida a V0
| # | Critério | Meta |
|---|---|---|
| P1 | No GA4 real da MS Server, o motor emite **≥ 3 insights** OU o estado honesto "sem variação relevante" + trace dos gates | — |
| P2 | Marcação de **👍 em ≥ 50%** dos insights | `insights.rating` |
| P3 | **≥ 2 insights** nomeados como mais úteis que abrir o GA4 direto | anotação |
| P4 | **Zero** insights vagos / sem evidência numérica | inspeção do conjunto |

**V0 funcional = F1–F9 + P1 + P2 + P4.**

---

## 12. Como validar os diagnósticos com dados reais

Planilha: `insight_id · detector · auditoria · rating · porquê · categoria`.

| Teste | O que fazer | Passa se |
|---|---|---|
| **A. Auditoria numérica** | Reproduzir os números do `evidence_json` no GA4 (Explorações), mesmo período e dimensão | Batem dentro de arredondamento/amostragem |
| **B. Rating cego de utilidade** | Ler cada card **antes** de olhar o GA4; 👍/👎 + 1 linha de porquê | ≥ 50% 👍 |
| **C. Bater a linha de base** | 20 min no GA4 para listar "as 3 coisas para agir neste mês"; comparar com o top 3 do motor | Sobreposição **ou** o motor aponta algo válido não encontrado |
| **D. Falso-positivo** | Todo 👎 categorizado: (a) número errado = bug; (b) certo mas não acionável = ajuste de threshold; (c) já conhecido = falta "motivo do descarte" | Categorização feita → backlog V1 |
| **E. Sanidade dos gates** | Apontar de propósito para propriedade de baixo tráfego / com buraco de tag | Motor fica em silêncio ou só emite `data_quality` |
| **F. Determinismo** | Rodar o sync de novo no dia seguinte | Insights não mudam de forma errática para o mesmo dado |

Veredito da V0 = resultado de **B + C**.

---

## 13. Riscos técnicos que podem bloquear o teste GA4 real

### Bloqueadores a resolver ANTES do teste (fora do código)
| Risco | Mitigação |
|---|---|
| App OAuth não verificado + escopo sensível (`analytics.readonly`) — refresh token de test user expira em **7 dias** | Cadastrar a conta Google da MS Server como test user; reautorizar semanalmente durante a V0, ou submeter verificação antes de ampliar |
| Propriedade-piloto pequena demais → gates suprimem tudo | Pré-qualificar: ≥ ~2–3k sessões/mês |
| Key events não configurados | Pré-qualificar: ≥ 1 key event ativo há ≥ 60 dias |
| APIs não habilitadas no projeto certo (Data API + Admin API) | Checklist em `docs/ga4-setup.md`; `/api/health` valida no B1 |
| Conta só tem Universal Analytics | EmptyState explicando que é preciso propriedade GA4 |
| Redirect URI / ambiente | V0 em `localhost`; piloto autoriza em call compartilhada |

### Tratados no código
| Risco | Tratamento |
|---|---|
| Refresh token não retornado | `access_type=offline&prompt=consent`; se vier sem, forçar reconsent |
| Dados incompletos das últimas 48h | Janela termina em D-2; incremental re-puxa 3 dias |
| `(not set)`/`(direct)` alto, thresholding do GA4 | Poucas dimensões; G4 veta insights de atribuição |
| Tag quebrada → queda a ~zero | Detectada como `data_quality`, não como "queda de tráfego" |
| Quota 429 | Backoff exponencial (3x); senão `sync_runs.status='partial'` |
| Mudança de nomenclatura da API (`conversions` → `keyEvents`) | Nomes fixados; respostas validadas por Zod; falha explícita |
| PII em URL de landing page / campanha | `landing_page` é V1; se habilitado, remove query string antes de gravar |

### Risco de produto
Gates rígidos + meses estáveis → poucos/zero insights. Mitigação: estado honesto
com o trace dos gates. Um "nada estatisticamente relevante" é resultado válido do
experimento — e mais honesto que um GA4, que sempre mostra "algo".
