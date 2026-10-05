# v1-architecture — arquitetura aprovada do ciclo V1

> **Status: APROVADO** (2026-09-10). Este documento é a referência de arquitetura
> do ciclo V1. **Implementação: G0–G6 concluídos** (2026-09-24), a **fundação do
> G7 — o Advisor determinístico** (2026-10-04, §9.7), a **conexão do modelo de
> linguagem** a ela (2026-10-04, §9.8, atrás de uma flag desligada por padrão) e o
> **fechamento do Advisor V1** (2026-10-05, §9.8: determinístico pronto, LLM
> implementado e desligado); ver §12 (tabela) e §14. Depois do G6 entraram, fora da sequência G, o **RD-1** (RD Station Marketing
> e RD CRM como fontes — §7.5) e o **Cross-source V1/V1.1** (camada própria
> persistida em `cross_source_insights` — §8.5); em 2026-10-04 as invariantes
> INV-2/4/5 foram revisadas, entraram INV-16…18 (Cross-source), INV-19…22
> (Advisor) e INV-23…25 (modelo de linguagem). Onde o código diverge do desenho descrito aqui, as notas
> "Implementado no G5" (§7.4), "Implementado no G6" (§8.4) e as seções
> §7.5/§8.5/§9.7/§9.8 registram o que foi de fato construído; o texto de desenho
> original foi preservado.
>
> - Estado da V0 e decisões já tomadas: [`../PROJECT_STATE.md`](../PROJECT_STATE.md) — **continuam em vigor**.
> - Plano e tese do produto: [`v0-plan.md`](v0-plan.md).
> - Setup de conexão real: [`ga4-setup.md`](ga4-setup.md).
>
> **Regra de leitura:** onde este documento e o `PROJECT_STATE.md` divergirem sobre
> a V0, o `PROJECT_STATE.md` vence. Este documento só *estende* para a V1.

---

## 1. Objetivo do ciclo V1

1. Adicionar **Google Ads** como segunda fonte real de dados.
2. Preparar a arquitetura para conectores futuros (**Meta Ads, Search Console, CRM**).
3. Manter o **motor determinístico separado** da futura camada de **AI Advisor**.
4. **Não quebrar** nada que já funciona no GA4 — em especial o insight
   `traffic-volume-drop`, validado pela empresa-piloto (MS Server).

O produto validado da V0: o motor lê dados reais de GA4 e produz o diagnóstico
`traffic-volume-drop` ("Sessões de Paid Search caíram X%"). O Márcio confirmou
valor comercial. A V1 acrescenta o **porquê** que o GA4 não enxerga (investimento,
impressão perdida, status de campanha) e prepara a camada de interpretação por IA.

---

## 2. Decisões arquiteturais aprovadas

### 2.1 Camada de dados

| # | Decisão |
|---|---|
| D-A | `fact_traffic_daily` ganha a coluna **`platform`** (`text NOT NULL DEFAULT 'ga4'`), incluída no índice `UNIQUE`. Preenche a lacuna do plano (`v0-plan.md` §3) antes de existir um 2º writer. |
| D-B | Nova tabela canônica **irmã** `fact_ad_performance_daily` — grão *campanha × dia*, métricas de anúncio. **Google Ads e Meta Ads escrevem nela.** |
| D-C | **Uma fact table por FORMA de dado**, não uma tabela larga com colunas nullable, não EAV. Formas: `traffic` (web analytics), `ad_performance` (anúncios), `search` (Search Console — futuro), `crm` (futuro). |
| D-D | Correlação cross-source = `(workspace_id, date)` + match de nome de campanha + semântica canal↔plataforma. Sem FK rígida entre fontes. |

### 2.2 Conectores

| # | Decisão |
|---|---|
| D-E | `Connector.mapToCanonical` passa a devolver um **`CanonicalBatch` discriminado por `target`** (`'traffic' \| 'ad_performance' \| …`). O `normalize` roteia para a fact table correta. **Única mudança de interface do contrato.** |
| D-F | Camada **`connectors/shared/`**: `oauth-state` (HMAC `state`), `token` (`getValidAccessToken`), `connection` (`getConnectionForWorkspace`). Lógica genérica que hoje mora em `ga4/`. |
| D-G | **OAuth Google compartilhado** entre GA4 e Google Ads (`connectors/google/oauth.ts`): mesmo `OAuth2Client`, mesmo client secret. Muda só o **scope** e o **redirect URI**. |
| D-H | Rotas OAuth genéricas: **`/api/oauth/[provider]/{start,callback}`** — resolvem scopes/redirect/discovery pelo `registry`. |
| D-I | `connections` continua `UNIQUE (workspace_id, provider)` — **1 conta por fonte na V1**. `connection_properties` serve qualquer fonte (`external_id` opaco). |

### 2.3 Motor de análise

| # | Decisão |
|---|---|
| D-J | **`runAnalysis` vira nível-workspace** — disparado ao fim de *qualquer* sync (GA4, Ads, …), não mais de dentro de `runGa4Sync`. É recompute total + upsert por `dedupe_key`, idempotente. |
| D-K | **`AnalysisContext` composto**: `buildAnalysisContext` vira composição de `buildTrafficContext` (lógica atual, intocada) + `buildAdsContext` (novo; `null` se não houver conexão Ads). O struct ganha `ctx.ads`. |
| D-L | O **contrato de detector `(ctx, gates) => DetectorInsight[]` não muda**. O contexto cresce; a assinatura, não. |

### 2.4 AI Advisor

| # | Decisão |
|---|---|
| D-M | O AI Advisor entra **depois** de `insights`, nunca antes. |
| D-N | O Advisor **não acessa** `fact_*`, `raw_records` nem o `AnalysisContext`. Lê apenas linhas de `insights` e de `cross_source_insights` (D-V) + support metrics que o motor já calculou. *(Na V1 do Advisor as support metrics não são consumidas — ficam em `app/`, recomputam o contexto e o que têm de útil já está na evidência dos insights e do Cross-source; §9.7.)* |
| D-O | O Advisor **não calcula** métrica fundamental — todo número no output é cópia verbatim de um campo do input. |
| D-P | O Advisor **não inventa** evidência — input vazio → resposta "sem variação relevante". |
| D-Q | O Advisor é **desligável** (feature-flag) e **não é fonte de verdade**. `/diagnostico` (motor determinístico) funciona 100% sem ele. |
| **D-W** | **Advisor V1 (fundação, sem LLM):** o `AdvisorContext` é a **única entrada oficial** da camada de IA e é composto só por saídas já calculadas e persistidas (`insights` + `cross_source_insights`); o `AdvisorModel` é a interface do LLM futuro; toda saída passa por um guard determinístico e o serviço anexa TODAS as limitações. Hoje responde o `DeterministicAdvisorModel`. Detalhes e a decisão de fronteira em §9.7. |
| **D-X** | **Advisor V1 — modelo de linguagem (2026-10-04):** o `AdvisorModel` ganhou uma segunda implementação, o `LlmAdvisorModel`, sobre um `LlmTransport`. Provedor: **Anthropic (Messages API) via `fetch`, sem SDK e sem dependência nova** (o projeto não tinha nenhum provedor; segue o padrão `fetch` + Zod dos conectores). Chave **própria** `ADVISOR_LLM_ENABLED` (padrão `false`) e credencial `ANTHROPIC_API_KEY` opcional — ausente, o Advisor responde de forma determinística. O que sai para o provedor é só uma **projeção explícita** do `AdvisorContext` (sem PII), a saída passa por **schema Zod + guard estrito** e qualquer falha cai no determinístico. A IA interpreta; o sistema calcula. Detalhes em §9.8. |
| **D-R** | **O AI Advisor NÃO é arquitetado como "um chatbot".** Ele é primeiro uma **camada de decisão / interpretação / priorização** sobre insights estruturados. A interface conversacional/chat pode ser adicionada *depois*, como forma de interação com o Advisor — nunca como a arquitetura primária. |

### 2.5 Núcleo protegido

| # | Decisão |
|---|---|
| **D-S** | O insight **`traffic-volume-drop`** validado pelo Márcio é **núcleo protegido**. **Não alterar** detector, gates, thresholds, `severity`, `dedupe_key` nem comportamento de *firing*. As decisões D1 `#3` (título por canal) e `#4` (z deseasonalizado) ficam **congeladas**; `#5` (regra de severidade) **permanece adiado** (calibrar só após o rating cego do piloto — ver `PROJECT_STATE.md` §11). |
| **D-T** | **Cross-source entra primeiro como ENRIQUECIMENTO DETERMINÍSTICO de evidência** de insights já emitidos — nunca como um detector novo, nunca mudando se/quando um detector dispara. Detector autônomo de Ads só depois do piloto e com aprovação explícita. |
| **D-V** | **Cross-source V1.1 é uma camada PRÓPRIA, separada do enriquecimento (D-T)**: observações e limitações determinísticas sobre GA4 + RD Marketing + RD CRM, **sem `severity` nem score**, persistidas em `cross_source_insights` e lidas pelo futuro Advisor via `getCrossSourceInsights`. Não é detector, não entra em `insights` nem no `/diagnostico`, e não é chamada pelo engine nem pelo sync (§8.5, INV-4, INV-16). |

### 2.6 Google Ads

| # | Decisão |
|---|---|
| **D-U** | **Google Ads V1 = grão campanha × dia.** Não implementar `ad_group`, `keyword` nem análise em nível de `query` — deliberadamente adiado. |

---

## 3. Invariantes (não podem ser violadas na V1)

Regras de referência. Qualquer PR que viole uma destas precisa de aprovação explícita.

| ID | Invariante |
|---|---|
| **INV-1** | O motor determinístico **não usa LLM**. `gates`, `detectors`, `contribution`, `scoring`, `templates`, `stats` são funções puras, com testes unitários. |
| **INV-2** | Dentro do motor, **só três arquivos tocam o banco**: `analysis/context.ts` (**leitura** das fontes — o ÚNICO que lê `fact_*`/`raw_records`), `analysis/engine.ts` (**escrita** de `insights`) e `analysis/cross-source-store.ts` (leitura e escrita **só** de `cross_source_insights`, nenhuma outra tabela). Todo o resto é puro. O **Advisor** (fora do motor — INV-9) tem um único leitor próprio, **somente-leitura**: `advisor/readers.ts`, que lê só `insights` e os períodos já gerados de `cross_source_insights`; o Cross-source entra pela porta oficial `getCrossSourceInsights`. |
| **INV-3** | `traffic-volume-drop`: detector, gates, thresholds, `severity`, `dedupe_key`, comportamento de *firing* e as decisões D1 `#3`/`#4` estão **congelados**. `#5` permanece adiado. Mudança exige aprovação + rating cego do piloto. |
| **INV-4** | Cross-source **nunca altera o diagnóstico**. Como **enriquecimento** (G6, D-T): só acrescenta evidência a insights já emitidos — **nunca** altera se/quando um detector dispara, nem `dedupe_key`, nem `priority_score` de forma a mudar ordenação de forma não-determinística. Como **camada própria** (Cross-source V1.1, D-V): produz observações e limitações **fora de `insights`** — em `cross_source_insights` —, sem `severity`/score, e nunca entra nos detectores, no engine, no sync nem no `/diagnostico`. Detector autônomo continua exigindo rating cego + aprovação. |
| **INV-5** | O AI Advisor lê **apenas** linhas de `insights`, linhas de `cross_source_insights` (via `getCrossSourceInsights`, **sem recalcular**), support metrics já calculadas pelo motor e a janela. **Nunca** lê `fact_*`, `raw_records` ou `AnalysisContext`. Sem tool de query no banco de fatos. A entrada do Advisor é o `AdvisorContext` (§9.7), montado só dessas saídas. |
| **INV-6** | O AI Advisor **nunca calcula** uma métrica fundamental. Todo número no output é cópia verbatim de um campo do input (validável por teste). |
| **INV-7** | O AI Advisor **nunca inventa** evidência. `insights` vazio → output "sem variação estatisticamente relevante no período". |
| **INV-8** | O produto funciona **100% com o Advisor desligado**. `/diagnostico` (motor determinístico) é a fonte de verdade. |
| **INV-9** | Dependência **unidirecional**: o Advisor importa tipos de `insights`; o motor **nunca** importa nada do Advisor. |
| **INV-10** | Toda fact table canônica tem `workspace_id`, `date`, `platform` e **chave natural própria**. O conector declara para qual tabela mapeia (`CanonicalBatch.target`). |
| **INV-11** | Uma fonte nova = implementar `Connector` + entrada no `registry` + (se nova FORMA de dado) nova fact table + `buildXContext`. **UI e detectores existentes não mudam.** |
| **INV-12** | `connections` é `UNIQUE (workspace_id, provider)` — 1 conta por fonte na V1. O **workspace é a identidade da empresa**; não há entidade `business` entre `workspace` e `connection`. |
| **INV-13** | Google Ads V1 = grão **campanha × dia**. Sem `ad_group`/`keyword`/`query`. |
| **INV-14** | Tokens de terceiros sempre **cifrados em repouso** (AES-256-GCM, `key_version`). Nenhuma coluna de token trafega para a UI (helpers de leitura retornam só colunas seguras). |
| **INV-15** | `runAnalysis` é **idempotente e de nível workspace** — recompute total + upsert por `(workspace_id, dedupe_key)`, preservando `status`/`rating`/`created_at` (D1 `#1`). |
| **INV-16** | A camada Cross-source (`analysis/cross-source/`) é **pura e determinística** — sem banco, rede, env, relógio, aleatoriedade nem LLM — e recebe **só** o `AnalysisContext`; mesmo contexto ⇒ mesma saída. **Gerar e ler são operações separadas**: `generateCrossSourceInsights(workspace, período)` (a única que escreve) e `getCrossSourceInsights(workspace, período)` (só lê a tabela; nunca recalcula nem toca as fontes). Gerar **substitui** o conjunto `(workspace, período analisado)` numa transação — upsert do que foi produzido + remoção do que deixou de valer — e é **idempotente**, sem duplicata. Nada disso é chamado pelo engine, pelo sync nem pelo `/diagnostico`. |
| **INV-17** | O contexto separa **período solicitado** (`ctx.period`) de **cobertura real** de cada fonte (`coverage.inPeriod`, `rdMarketing.coverage`, `rdCrm.coverage`), e a cobertura é por **existência de linha**: linha com valor 0 é dado válido (zero registrado); dia sem linha é ausência de dado e **nunca vira zero**. Atraso do GA4, período parcial e períodos não equivalentes dependem da cobertura — **nunca** do valor da métrica. Duas fontes só se comparam "no mesmo período" quando ambas cobrem exatamente o período solicitado. O histórico de CRM disponível é o **importado** (`importedHistoryStartDate`), não o histórico real do CRM. |
| **INV-18** | O Cross-source **nunca afirma** causalidade, atribuição, CAC, ROAS nem taxa entre fontes (GA4 × RD Marketing × RD CRM) sem prova nos dados: populações diferentes não viram taxa, e coexistência no tempo não é causa. Cada afirmação é `fact`, `observable_relationship`, `hypothesis` (condicional, sem número) ou `limitation` (com código estável), sempre apoiada por evidência estruturada `{source, metric, period, value}`. Limitação é limite analítico dos dados, não erro técnico. |
| **INV-19** | O **`AdvisorContext` é a única entrada oficial da camada de IA** e é uma **composição**, não um segundo motor: `composeAdvisorContext` é pura, só reorganiza saídas já persistidas — separa as quatro camadas (fato · relação observável · hipótese · limitação), mantém a evidência num registro único e **preserva limitações e evidências sem reescrever o texto**. Não recalcula métrica nenhuma. **Ausência ≠ zero**: `null` continua `null`; fonte sem linha é `unavailable`; sem Cross-source gerado a fonte é `unknown` e nenhuma figura é inventada. Conjunto de outro workspace ou de outro período nunca entra. |
| **INV-20** | O **Advisor é somente leitura e nunca gera**: nenhuma escrita em lugar nenhum (nem em `cross_source_insights`), nenhum sync, nenhuma chamada externa, nenhum `generateCrossSourceInsights`/`buildCrossSourceInsights`. Gerar Cross-source continua sendo uma chamada explícita e separada (INV-16). Período sem Cross-source gerado ⇒ resposta `no_data`, com o motivo. |
| **INV-21** | **Toda saída do Advisor é validada** (`validateModelResponse` no rascunho, `validateAdvisorResponse` na resposta final): todo número e toda data existem no contexto, toda referência (evidência, insight, código de limitação) existe, fato e relação observável citam evidência, nenhuma moeda é assumida, e a resposta final traz **todas** as limitações do contexto, com figuras e evidências idênticas às dele. Uma resposta recusada é **substituída pela determinística**, e isso fica registrado (`provenance.fellBack` + limitação `model_output_rejected`) — nunca em silêncio. Para um modelo de linguagem a validação do rascunho é a **estrita** (`validateLlmDraft`, INV-25). |
| **INV-22** | A **única aritmética do Advisor é a comparação entre períodos**, feita pelo sistema **antes** do modelo (`comparison.ts`), nunca pela IA: só entre períodos **comparáveis** (os dois com Cross-source gerado, sem sobreposição, **mesma duração** em dias, fonte coberta nos dois lados) e só para métricas de contagem e valor permitidas. Variação sobre base zero é `null`. Não comparável ⇒ `not_computable`, com o motivo — nunca uma comparação inventada. |
| **INV-23** | O **provedor de LLM mora atrás de `AdvisorModel`**: o serviço, o guard, o contexto, o determinístico e a ação **não importam nada de `llm/`** nem citam o provedor (travado por teste); **um único arquivo** (`llm/anthropic.ts`) conhece a rede, o endereço, o formato do pedido e a credencial (que chega por parâmetro); **nenhum SDK de IA** entra no `package.json`. O LLM **não consulta o banco, não usa ferramentas e não tem memória** — recebe só a projeção do contexto. |
| **INV-24** | O que sai para o provedor é **só a projeção explícita do `AdvisorContext` mais a pergunta digitada, sem PII**: os campos são listados um a um (um campo novo do contexto **não** vai ao provedor até alguém decidir isso — travado por teste), ficam de fora o `workspaceId`, o instante de montagem, os ids técnicos, o valor numérico cru e a `supportingEvidence` do Google Ads, e as evidências viram ids curtos (E1…). Antes de cada envio uma **varredura fail-closed** (e-mail, telefone, CPF/CNPJ, UUID, URL, sequências longas de dígitos) bloqueia o envio — o Advisor responde de forma determinística. O **log** só tem metadados (workspace, intenção, período, provedor, modelo, versão do prompt, resultado, motivo, latência, tokens, id da requisição, tipo de PII — nunca o valor): nunca o prompt, o contexto, a pergunta, a resposta, o texto de erro do provedor nem a credencial. |
| **INV-25** | Toda resposta de modelo de linguagem passa por **schema (Zod) e guard estrito** (`validateLlmDraft`) antes de virar `AdvisorResponse`. O modelo **não escolhe** o `status`, os acompanhamentos, os ids das seções, nem o texto ou a gravidade de uma limitação, e **não cria** limitação (o schema não tem o campo); só escolhe o título, o resumo, a ordem, o texto das afirmações e quais evidências cada uma cita. Qualquer falha — credencial ausente, tempo limite, erro da API, recusa, saída truncada, formato inválido, PII, guard — cai no **modelo determinístico**, registrada na proveniência e numa limitação (`model_failed` / `model_output_rejected`), nunca em silêncio. Sem o que interpretar (sem Cross-source gerado; comparação não computável) o modelo **nem é chamado**. |

---

## 4. Pipeline e fronteiras

```
                       ┌─────────────────────────────────────────────────────────────┐
                       │  DETERMINÍSTICO — sem LLM, puro, testável (INV-1, INV-2)     │
                       └─────────────────────────────────────────────────────────────┘
 fontes externas
 (GA4 Data API,        ┌── connector.pull ──┐
  Google Ads API,  ───▶│  raw_records       │  imutável, append-only, replayável
  Meta, GSC, CRM)      │  (payload jsonb)   │  1 linha por página de resposta
                       └────────┬───────────┘
                                │  connector.mapToCanonical → CanonicalBatch{target, rows}   (F1)
                                ▼
                 ┌──────────────────────────────────────────────┐
                 │  CANÔNICO — uma fact table por FORMA          │
                 │  fact_traffic_daily        (+ platform)       │  GA4
                 │  fact_ad_performance_daily                    │  Google Ads, Meta
                 │  fact_search_daily / fact_crm_* (futuro)      │
                 └────────┬─────────────────────────────────────┘
                          │  buildAnalysisContext = buildTrafficContext + buildAdsContext   (F2)
                          │  ÚNICO ponto de leitura do banco no motor
                          ▼
                 ┌──────────────────────────────────────────────┐
                 │  AnalysisContext (struct puro)               │
                 │  { traffic:{current,previous,baseline,…},    │
                 │    ads: {…} | null,  coverage, gates flags }  │
                 └────────┬─────────────────────────────────────┘
                          │  gates → detectors → contribution → scoring   (F3, puro)
                          │  + enriquecimento determinístico cross-source (D-T)
                          ▼
                 ┌──────────────────────────────────────────────┐
                 │  DetectorInsight[]  →  tabela `insights`     │  estruturado:
                 │  title, evidence_json, impact_json,          │  gated, auditável,
                 │  gate_trace_json, confidence, dedupe_key     │  determinístico
                 └────────┬─────────────────────────────────────┘
                          │
   ═══════════════════════╪════════ FRONTEIRA CRÍTICA (F4) ════════════════════════════
                          │
                          ▼   AI Advisor — lê SÓ `insights` + `cross_source_insights` (+ support metrics)
                 ┌──────────────────────────────────────────────┐
                 │  AI ADVISOR (camada de decisão/priorização)  │  INV-5..INV-9
                 │  interpreta · prioriza · conecta insights ·  │  não calcula
                 │  "o que fazer esta semana"                   │  não inventa
                 │  → advisor_outputs (versionado, atribuível)  │  desligável
                 └──────────────────────────────────────────────┘
```

**Ramo Cross-source (V1.1)** — sai do MESMO `AnalysisContext`, não passa pelos detectores e chega ao Advisor por uma tabela própria:

```
 AnalysisContext   buildAnalysisContext(workspace, período?)                           (F2)
        │
        │  buildCrossSourceInsights(ctx)  — pura, sem banco, sem LLM                   (F3b)
        ▼
 CrossSourceInsight[]  — fato · relação observável · hipótese · limitação
        │               evidência estruturada {source, metric, period, value}
        │  generateCrossSourceInsights(workspace, período)  — substitui o conjunto, idempotente
        ▼
 tabela `cross_source_insights`     chave (workspace, período, dedupe_key)
        │
        │  getCrossSourceInsights(workspace, período)  — só lê; nunca recalcula
        ▼
 AdvisorContext    buildAdvisorContext(workspace, período) — compõe com `insights`; sem recalcular  (§9.7)
        │
        │  AdvisorModel (determinístico hoje · LLM depois) → guard (INV-21)
        ▼
 AdvisorResponse   estruturada: seções por camada, figuras, limitações, evidência, proveniência
```

### F1 — extração → canônico (determinística)
`connector.pull(args)` produz `RawRecord`s (uma linha em `raw_records` por página). `connector.mapToCanonical(stream, raw)` valida (Zod) e mapeia para um **`CanonicalBatch`** — objeto que **nomeia a tabela destino** (`target`) e traz as linhas tipadas. Sem LLM, sem heurística fuzzy que mude números.

### F2 — canônico → `AnalysisContext` (único read do motor)
`buildAnalysisContext(workspaceId)` agrega as fact tables em janelas (atual 28d terminando em D−2 · anterior 28d · baseline ~120d) e séries diárias. É a **única** função do motor que **lê as fontes** (INV-2). Aceita um **período explícito** opcional `{startDate, endDate}` (§7.5): sem ele, o comportamento é o de sempre. Vira composição: `buildTrafficContext` (atual, intocado) + `buildAdsContext` (novo, `null` sem Ads).

### F3 — motor determinístico (puro, sem LLM)
`gates → detectors → contribution → templates → scoring`. Funções puras sobre `AnalysisContext`, com testes. O **enriquecimento cross-source** (D-T) roda aqui, depois dos detectores, como passo determinístico que só **acrescenta linhas de evidência** a insights já emitidos.

### F3b — Cross-source (camada própria, pura)
`buildCrossSourceInsights(ctx)` relaciona GA4 + RD Marketing + RD CRM a partir do `AnalysisContext` e produz observações e limitações estruturadas — **não** passa por gates/detectors/scoring e **não** vira `DetectorInsight`. É persistida à parte, em `cross_source_insights`, por uma chamada explícita (`generateCrossSourceInsights`). Ver §8.5, INV-16…18.

### F4 — `insights` + `cross_source_insights` → AI Advisor (fronteira crítica)
`insights` e `cross_source_insights` são as saídas estáveis e estruturadas do motor. O Advisor consome **apenas** essas duas saídas (o `AdvisorContext` as compõe — §9.7; as support metrics não são usadas na V1). Nunca volta às fact tables. Nunca recalcula. Ver §9.

---

## 5. Arquitetura de múltiplos conectores

### 5.1 Contrato `Connector` (atual + a única mudança)

O contrato de [`src/server/connectors/types.ts`](../src/server/connectors/types.ts) já é agnóstico de fonte para **auth / discovery / extract / mapping**. **Uma** mudança na V1:

```ts
// HOJE:  mapToCanonical(stream, raw): CanonicalTrafficRow[]
// V1:    mapToCanonical(stream, raw): CanonicalBatch

type CanonicalBatch =
  | { target: "traffic";        rows: TrafficRow[] }        // GA4 (e GA4-like)
  | { target: "ad_performance"; rows: AdPerfRow[] };        // Google Ads, Meta
  // futuro: { target: "search"; rows: SearchRow[] } | { target: "crm"; rows: CrmRow[] }
```

- `TrafficRow` = o `CanonicalTrafficRow` de hoje (sem alteração de campos).
- `AdPerfRow` = ver §6.3.
- `normalize` roteia: `batch.target === "traffic"` → `upsertFactTraffic`; `=== "ad_performance"` → `upsertFactAdPerformance`.
- `AccessContext.meta` (já existe) carrega o `login-customer-id` do Google Ads.

Todo o resto do contrato (`buildAuthUrl`, `exchangeCode`, `refreshTokens`, `listAccounts`, `pull`, `schemas`, `meta`, `streams`) fica como está.

### 5.2 Camada `connectors/shared/`

Move-se — **sem reescrever** — a lógica genérica que hoje mora em `ga4/`:

| Novo módulo | Origem hoje | Conteúdo |
|---|---|---|
| `connectors/shared/oauth-state.ts` | `ga4/auth.ts` | `signOAuthState` / `verifyOAuthState` (HMAC-SHA256 sobre `{workspaceId, nonce, exp}`, TTL 10 min). |
| `connectors/shared/token.ts` | `ga4/token.ts` | `getValidAccessToken(connectionId)` — decifra; se `< skew` p/ expirar, resolve o conector por `connection.provider`, `refreshTokens`, re-cifra, persiste; erro → `status='reauth_required'`. |
| `connectors/shared/connection.ts` | `ga4/connection.ts` | `getConnectionForWorkspace(workspaceId, provider)` — colunas seguras + `accounts[]` (ex-`properties`) + `recentSyncRuns[5]`. |

### 5.3 OAuth Google compartilhado

`connectors/google/oauth.ts` — usado por **GA4 e Google Ads**:

- Mesmo `OAuth2Client` (`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`).
- `exchangeCode` / `refreshTokens` / `revokeToken` — idênticos para os dois.
- **Diferença por conector**: `meta.scopes` (`analytics.readonly` vs `adwords`) e o `redirectUri`.
- `access_type=offline&prompt=consent` mantido.

### 5.4 Rotas `/api/oauth/[provider]/*`

Uma rota dinâmica (`start` + `callback`) substitui `/api/oauth/ga4/*`:

- `start`: `requireWorkspace()` → resolve `connector = registry.get(provider)` → `signOAuthState` → `connector.buildAuthUrl({ state, redirectUri })` → redirect.
- `callback`: valida `state` (workspace match) → `connector.exchangeCode` → cifra tokens → upsert `connections` → `connector.listAccounts` → grava `connection_properties` → redirect para `/conexoes?<provider>_connected=…` ou `?<provider>_error=…`.
- Mensagens de erro por-provider ficam num mapa (como o `ERROR_MESSAGES` atual em `conexoes/page.tsx`).

### 5.5 `connections` / `connection_properties` — identidade

- `connections` `UNIQUE (workspace_id, provider)` — **inalterado**. 1 GA4 + 1 Google Ads + 1 Meta + 1 RD por workspace.
- `connection_properties`: `external_id` opaco serve `properties/123` (GA4), `customers/123` (Ads), `act_123` (Meta), `sc-domain:…` (GSC). `is_selected` single-select imposto na server action. **Sem constraint nova.**
- **Ligação entre fontes = só o `workspace_id`.** Não criar entidade `business`/`brand` (INV-12).
- **Adição barata e opcional** (pode entrar em G2/G3): campo nullable `domain` no `workspaces` ou `connection_properties`, capturado no connect (GA4: `dataStreams[].webStreamData.defaultUri`; Ads: final URLs). Uso: **checagem soft** para correlacionar GA4↔Ads e **avisar** se parecerem não-relacionados. Não é constraint.

### 5.6 `sync_runs` e `runSync` genérico

- `sync_runs` já é **connection-scoped** — cada fonte gera seus próprios runs. Nada a mudar no schema.
- `runGa4Sync` → `runSync({ connectionId })`: resolve o conector por `connection.provider`; janela = `since = max(hoje − HISTORY_DAYS, last_synced − connector.meta.restatementWindowDays)`; itera `connector.streams`; `connector.pull` → `raw_records` → `connector.mapToCanonical` → `normalize` roteia por `batch.target`.
- Se um conector tiver múltiplos streams (Ads pode ter `campaign_daily` + futuros), 1 `sync_run` cobre o sync inteiro; `stream` já está em `raw_records`. (Coluna `stream` em `sync_runs` fica como possível adição futura, não V1.)

### 5.7 `runAnalysis` em nível de workspace (D-J)

- Hoje: chamado de dentro de `runGa4Sync`, no fim.
- V1: `runSync` termina → dispara `runAnalysis({ workspaceId })` — **independente de qual fonte sincronizou**.
- `runAnalysis` já é recompute total + upsert por `dedupe_key` (INV-15), então rodar após cada sync é seguro (redundante se GA4 e Ads sincronizarem no mesmo minuto, sem efeito colateral).
- Mantém-se o `try/catch`: falha da análise não derruba o sync.

---

## 6. Camada de dados canônica

### 6.1 Princípio

**Uma fact table por FORMA de dado.** Não uma tabela larga com colunas nullable; não EAV `(metric_name, metric_value)`. Cada forma tem vocabulário e grão próprios; o tipo forte no Drizzle e as queries óbvias valem mais que "uma tabela só".

### 6.2 `fact_traffic_daily` + `platform`

- **Adicionar** `platform text NOT NULL DEFAULT 'ga4'` e incluí-la no `UNIQUE (connection_id, date, channel, source, medium, campaign)` → `UNIQUE (connection_id, platform, date, channel, source, medium, campaign)`.
- Migração feita **no G1**, antes de qualquer 2º writer. Backfill trivial (todas as linhas existentes = `'ga4'`).
- Semântica: `fact_traffic_daily` é a forma **web-analytics** (sessão por canal/origem/campanha/dia). GA4 hoje; GA4-like no futuro. **Google Ads NÃO escreve aqui.**

### 6.3 `fact_ad_performance_daily` (proposta — criada no G3, não no G0)

Forma **ad-performance** (métricas de leilão/investimento por campanha/dia). Google Ads e Meta Ads.

| Coluna | Tipo | Origem Google Ads |
|---|---|---|
| `id` | uuid PK | — |
| `workspace_id` | uuid FK → workspaces | — |
| `connection_id` | uuid FK → connections | — |
| `platform` | text NOT NULL | `'google_ads'` |
| `date` | date NOT NULL | `segments.date` (fuso da conta) |
| `campaign_id` | text NOT NULL | `campaign.id` |
| `campaign_name` | text NOT NULL DEFAULT '' | `campaign.name` |
| `campaign_status` | text NOT NULL DEFAULT '' | `campaign.status` (ENABLED/PAUSED/REMOVED) |
| `ad_network` | text NOT NULL DEFAULT '' | `segments.ad_network_type` (opcional) |
| `impressions` | bigint NOT NULL DEFAULT 0 | `metrics.impressions` |
| `clicks` | bigint NOT NULL DEFAULT 0 | `metrics.clicks` |
| `cost` | numeric(18,4) NOT NULL | `metrics.cost_micros` ÷ 1e6 |
| `conversions` | numeric(18,4) NOT NULL | `metrics.conversions` |
| `conversion_value` | numeric(18,4) NOT NULL | `metrics.conversions_value` |
| `impression_share` | numeric(9,6) | `metrics.search_impression_share` |
| `budget_lost_is` | numeric(9,6) | `metrics.search_budget_lost_impression_share` |
| `rank_lost_is` | numeric(9,6) | `metrics.search_rank_lost_impression_share` |
| `currency` | text | `customer.currency_code` |
| `dims` | jsonb | device / extras não promovidos a coluna |
| `source_hash` | text NOT NULL | hash da chave natural + métricas |
| `updated_at` | timestamptz NOT NULL | — |

- **Chave natural / `UNIQUE`**: `(connection_id, platform, date, campaign_id, ad_network)`.
- Upsert idempotente por `source_hash` (mesmo padrão do `normalize` atual).
- `cost` e derivados sempre `numeric` — **nunca float**.

**Ajustes na implementação (G3):**
- `ad_network` fica **`''`** — a GAQL do V1 não usa `segments.ad_network_type` (§10.3), então cada linha é o total da campanha no dia. A chave natural já acomoda segmentação por rede se um bloco futuro promover isso.
- `advertising_channel_type` e `campaign_budget.amount_micros` são trazidos na GAQL mas **guardados em `dims`** (`{ advertisingChannelType, budgetAmount }`) — não viram coluna no V1 (mantém o schema §6.3 como aprovado).
- `cost` = `cost_micros / 1e6` arredondado a 4 casas (grão da coluna `numeric(18,4)`), determinístico e sub-centavo. `impression_share`/`budget_lost_is`/`rank_lost_is` são **`null`** quando a fonte não reporta — nunca `0` (§12).

### 6.4 Tabelas futuras (não V1)

- `fact_search_daily` — Search Console: `(date, query, page)` × `clicks, impressions, ctr, position`.
- `fact_crm_*` — leads / deals.
- Cada uma entra com seu próprio grão; não forçar nas existentes.

### 6.5 Chave de correlação cross-source

O motor **não** liga fontes por FK. Correlaciona por:
1. `(workspace_id, date-range)` — mesma janela de análise (mesmo `analysisEnd`).
2. **Semântica**: GA4 `channel = 'Paid Search'` ↔ `fact_ad_performance_daily` (`platform IN ('google_ads','meta_ads')`).
3. **Match de campanha**: `fact_traffic_daily.campaign` ↔ `fact_ad_performance_daily.campaign_name` (normalização tolerante; usado só como detalhe de evidência, não para gating).

### 6.6 Identidade multi-fonte

- **Workspace = empresa.** Márcio conecta GA4 + Google Ads no mesmo workspace → "mesma empresa" por construção.
- Sem entidade intermediária (INV-12). Multi-tenant real (workspace ↔ N empresas, modo agência, RLS por conexão) é **V2**.

---

## 7. `AnalysisContext` composto

### 7.1 Composição

```ts
// forma proposta (não implementada no G0)
interface AnalysisContext {
  workspaceId: string;
  analysisEnd: string;            // D−2, comum às duas fontes
  coverage: {...};

  traffic: TrafficWindows;        // = os campos atuais (current/previous/baseline/dailySeries/…)
  ads: AdsWindows | null;         // null se não houver conexão Google Ads

  // flags de qualidade continuam no topo (totalKeyEvents, notSetDirectSessionShare, zeroDayGap, …)
}
```

- `buildTrafficContext(workspaceId)` = a lógica de [`analysis/context.ts`](../src/server/analysis/context.ts) atual, **movida sem alteração de comportamento**.
- `buildAdsContext(workspaceId)` = novo; lê `fact_ad_performance_daily`; alinha janelas ao mesmo `analysisEnd`; produz séries diárias por campanha + série de `campaign_status`. Retorna `null` se o workspace não tem conexão Google Ads.

### 7.2 Compatibilidade — `traffic-volume-drop` intacto

- **Não renomear** `ctx.current` → `ctx.traffic.current` nos detectores por estética (INV-3).
- Estratégia: os campos de tráfego atuais continuam acessíveis no topo do `AnalysisContext` (alias para `ctx.traffic.*`), **ou** o G5 faz a renomeação mecânica *apenas* dentro do escopo de G5, com critério de sucesso "os testes de detector passam sem alteração de asserção e `runAnalysis` produz `insights` idênticos".
- **Critério de sucesso do G1 e do G5**: rodar `runAnalysis` antes e depois; comparar as linhas de `insights` (`title`, `evidence_json`, `dedupe_key`, `priority_score`, `severity`, `confidence`). Devem ser idênticas para o mesmo estado de `fact_traffic_daily`.

### 7.3 Contrato de detector inalterado

`detectXxx(ctx: AnalysisContext, gates: GateReport): DetectorInsight[]` — assinatura congelada (D-L). Um detector cross-source (futuro, fora da V1) apenas leria `ctx.traffic` **e** `ctx.ads`.

### 7.4 Implementado no G5 (como construído — diferenças em relação a §7.1)

- `AnalysisContext` ganhou **um** campo novo: `ads: AdsContext | null`. Os campos de tráfego **continuam achatados no topo** (`ctx.current`, `ctx.previous`, `ctx.baseline`, …) — a 1ª opção de §7.2: não existe `ctx.traffic.*` e nada foi renomeado nos detectores.
- `AdsContext` = `{ window, currency, totals, campaignCount, campaigns[] }`. `totals` e cada campanha trazem impressions, clicks, cost, conversions e conversionValue (**soma** dos dias da janela); cada campanha traz também id, nome, `status` e `advertisingChannelType` (snapshot do dia mais recente na janela; o tipo vem de `dims`) e `impressionShare`/`budgetLostIs`/`rankLostIs` (**média** dos dias que reportaram; `null` se nunca reportado — nunca `0`).
- **Só a janela `current`.** Não há série diária por campanha nem janela anterior de Ads (o esboço de §7.1 previa série diária; ficou para um bloco que precise dela).
- `buildAdsContext(workspaceId, window)` recebe a janela `current` já calculada pelo tráfego (mesmo `analysisEnd`, §6.5) e vive **dentro de `analysis/context.ts`** — INV-2 continua valendo (só `context.ts` lê o banco). A fusão é a função pura `composeAdsContext`, testável sem banco.
- `ads = null` quando não há linha de `fact_ad_performance_daily` na janela — cobre "Google Ads não conectado" e "conectado, mas sem dados no período".
- Nenhum detector/gate/scoring lê `ctx.ads` (travado por teste). Sem schema, sem migration.

### 7.5 Implementado depois do G6 (RD-1 e período explícito — como construído)

- **RD-1.** `AnalysisContext` ganhou `rdMarketing: RdMarketingContext | null` (`fact_conversion_assets_daily`, grão ativo × dia) e `rdCrm: RdCrmContext | null` (`fact_deals`, grão negociação), ambos na **mesma janela `current`**, `null` quando a fonte não tem linha no período, montados por `composeRdMarketingContext`/`composeRdCrmContext` (puras) dentro de `context.ts`. `rdCrm` traz `totals`/`pipelines`, `detail` (criados ainda abertos, ganhos/perdidos com valor, valor perdido), `attribution` (preenchimento de `source_id`/`campaign_id` em criados e ganhos) e `coverage`. Nenhum detector lê RD.
- **Período explícito.** `buildAnalysisContext(workspaceId, { startDate, endDate }?)`. Sem período = comportamento histórico: janela de 28 dias **encolhida** até o último dia do GA4 (é o que os detectors veem, intocado). Com período, a janela `current` é **exatamente** o pedido (`previous` = mesmo tamanho na véspera; `baseline` = 120 dias antes) e **não** é encolhida quando o GA4 não tem dados até lá. Validação: datas reais, início ≤ fim, até 366 dias, fim não futuro (`AnalysisPeriodError`). A parte pura é `assembleAnalysisContext` (+ `period.ts`); as queries seguem em `context.ts`. Só a camada Cross-source usa um contexto de período explícito — os detectors rodam sempre sobre o padrão.
- **Período solicitado × cobertura real (INV-17).** `ctx.period` é o pedido. A cobertura real de cada fonte vem em `coverage.inPeriod` (GA4: dias **com linha**, inclusive linha com 0 sessões), `rdMarketing.coverage` (dias com linha) e `rdCrm.coverage.importedHistoryStartDate` — início do histórico de CRM **importado** (menor `period_start` entre os syncs bem-sucedidos); **não** é o início do histórico real do CRM. `coverage.expectedLastDate` é o último dia que o GA4 deveria ter (modo padrão: hoje − 2; período explícito: o `endDate`). `WindowAgg.daysWithData` segue contando só dias com sessões > 0 — é o que gates e detectors sempre usaram e não mudou.

---

## 8. Cross-source: enriquecimento determinístico (D-T)

> Esta seção descreve o **enriquecimento** (G6). A camada **Cross-source própria**
> (V1/V1.1) — observações e limitações, persistida em `cross_source_insights` —
> está em §8.5 (D-V, INV-16…18).

### 8.1 O que é / o que não é

| É | Não é |
|---|---|
| Um passo **determinístico** que acrescenta linhas de `evidence_json` e uma frase de `explanation` a um insight **já emitido** pelo motor. | Um detector novo. |
| Roda depois dos detectores, dentro de `engine.ts` (INV-2). | Não muda `if` de firing, threshold, `severity`, `dedupe_key`. |
| Lê só `ctx.ads` (que veio de `fact_ad_performance_daily`). | Não usa LLM (INV-1). |
| Testado com testes unitários próprios. | Não roda se `ctx.ads` é `null` — o insight fica idêntico ao de hoje. |

### 8.2 Onde roda

Em `analysis/engine.ts`, entre "detectores produziram" e "persistir". Um passo puro `enrichWithAds(insights, ctx)`:

- **Alvo na V1**: um insight `traffic-volume-drop` cujo `responsibleDimension.value === 'Paid Search'`, quando `ctx.ads` existe.
- **Acrescenta** ao `evidence_json.breakdown` / a um campo de evidência secundária:
  - Δ **investimento** (`cost`) na janela — "investimento no Google Ads −22%".
  - Δ **impressões** + `budget_lost_is` (8% → 31%) — "perdendo leilão por orçamento".
  - `rank_lost_is` subindo — "perdendo por lance/qualidade".
  - Mudança de `campaign_status` com **onset** (data em que a campanha foi pausada), reusando o `changePoint`/`detectOnset` já existente.
  - **Sanity-check**: `clicks` (Ads) vs `sessions` de Paid Search (GA4) — devem concordar dentro de ~10–20%.
- **Uma frase** na `explanation`: "No mesmo período, o investimento no Google Ads caiu 22% e a perda de impressão por orçamento subiu de 8% para 31%."

### 8.3 Regras (INV-3, INV-4)

- **Não** altera: `severity`, `priority_score` (a não ser de forma determinística e monotônica que não reordene de forma surpreendente — a decisão de *se* mexer no score fica para um bloco posterior, com aprovação), `dedupe_key`, `confidence`, nem se/quando o `traffic-volume-drop` dispara.
- **Desligar a conexão Google Ads** deixa o insight `traffic-volume-drop` **byte-idêntico** ao de hoje. Esse é o teste de aceite do G6.

### 8.4 Implementado no G6 (como construído — diferenças em relação a §8.2)

- **`enrichWithAds(insights, ads)`** em `analysis/enrichment.ts`. Pura. Recebe **só `ctx.ads`** — não o `ctx` inteiro, como sugeria §8.2 — logo é estruturalmente incapaz de ler ou recalcular dados de GA4. `engine.ts` a chama depois dos detectores e do `priorityScore`, antes de ordenar e persistir. Sem IA/LLM.
- **Google Ads atua somente como evidência complementar** — nunca causa nem atribuição. As camadas ficam separadas: (1) o fato do GA4 (`title`/`explanation`/`evidence`) **intocado**; (2) a evidência complementar em `evidence.supportingEvidence[]` — campo opcional novo de `InsightEvidence`, gravado dentro do `evidence_json` jsonb **já existente** (sem schema/migration); (3) uma frase conservadora acrescentada a **`hypothesis`** (não a `explanation`, como sugeria §8.2); (4) `recommendedAction` **intocada**.
- **Escopo inicial: somente `traffic-volume-drop` cujo canal responsável é `Paid Search` → campanhas com `advertisingChannelType = SEARCH`** (allowlist explícita, sem fuzzy match). Nenhum outro detector ou canal é enriquecido.
- **Fail-closed.** Só enriquece se: `ads !== null`; a janela do Ads é **igual** à do insight; há campanhas `SEARCH` confirmadas (tipo `null` não conta); há atividade objetiva (impressões, cliques ou custo > 0); o responsável é um canal da allowlist. Qualquer condição falha → o insight é devolvido intacto. **`ads === null` → no-op por referência: o comportamento anterior fica preservado** (o teste de aceite de §8.3, verificado por teste unitário e na regressão real). Idempotente.
- **Conteúdo:** só métricas **absolutas** da janela atual — nº de campanhas, impressões, cliques, custo (na moeda da conta, sem assumir BRL), conversões, conversion value; `impressionShare` só é repassado quando há exatamente 1 campanha compatível (não se agregam razões). O texto diz que é contexto do Google Ads, que não representa a totalidade do canal e que não estabelece causalidade.
- **Não implementado (fora do escopo do G6):** Δ% de investimento/impressões, tendência de `budget_lost_is`/`rank_lost_is`, onset de `campaign_status` e sanity-check cliques (Ads) × sessões (GA4) — tudo isso exige uma **janela anterior de Ads** que o `AdsContext` ainda não tem. **A variação temporal do Google Ads permanece fora do escopo até existir janela anterior no `AdsContext`.**
- **Inalterados:** detectors, gates, scoring, severity, thresholds, confidence, `dedupeKey`, `priorityScore`, `title`, `explanation`, `recommendedAction`; `context.ts`; schema/migrations; OAuth/connectors/sync.
- **UI:** `insight-card.tsx` **ainda não renderiza `supportingEvidence`** — o campo é persistido, mas só a frase acrescentada a `hypothesis` aparece no card.

### 8.5 Cross-source V1/V1.1 — camada própria (como construído)

- **O que é.** `analysis/cross-source/` — `buildCrossSourceInsights(ctx)`, **pura**, relaciona GA4 + RD Marketing + RD CRM a partir do `AnalysisContext` (INV-16). Não é enriquecimento nem detector (D-V): não tem `severity` nem `priorityScore` e **não** usa `DetectorInsight` (exigiria inventar deltas e score).
- **11 tipos de insight**, em ordem fixa: `data-coverage`, `acquisition-coverage`, `traffic-and-rd-conversions`, `commercial-activity`, `commercial-vs-acquisition`, `attribution-quality` e os de integridade `source-unavailable`, `partial-period`, `period-mismatch`, `population-not-comparable`, `metric-not-computable` (cada um só existe quando a condição se verifica). Toda afirmação é `fact`, `observable_relationship`, `hypothesis` ou `limitation` (INV-18) e aponta, por `evidenceIds`, para pontos de evidência `{source, metric, period, value, format, note?}`. O formato de evidência é **próprio**: o `InsightEvidence` exige comparação (`previous`/`deltaPct`) e o `CrossSourceEvidence` do G6 é específico do Ads.
- **Comparações só entre fontes alinhadas (INV-17).** "No mesmo período" exige que as duas fontes cubram exatamente o período solicitado; do contrário saem `partial-period`/`period-mismatch` em vez de uma comparação enganosa. Taxa de ganho = ganhos ÷ (ganhos + perdidos), com abertos fora do denominador; ticket médio só sobre ganhos com valor; razão com denominador 0 é `null`. Atribuição: cobertura de `source_id`/`campaign_id` medida em criados e ganhos (limiar `MIN_ATTRIBUTION_COVERAGE = 0,8` — decisão de produto), e a atribuição às fontes de aquisição é declarada **não suportada** enquanto o contexto não ligar as origens do CRM a canais/ativos.
- **Persistência.** Tabela **própria** `cross_source_insights` (migração `0004`), separada de `insights`: chave única `(workspace_id, period_start, period_end, dedupe_key)`; `statements_json` (as quatro camadas, com código estável nas limitações), `evidence_json`, `sources_json`, `content_hash` (sha256 do conteúdo em JSON canônico), `schema_version`, `generated_at` (igual para o conjunto todo) e `created_at` (1ª geração, preservado). `type`/`category` são `text`, não enum. Reaproveita os padrões vizinhos: identidade estável como `insights`, hash de conteúdo como as fact tables.
- **Interface.** `generateCrossSourceInsights(workspaceId, {startDate, endDate})` monta o contexto, roda a camada pura e **substitui** o conjunto numa transação (upsert + remoção do que deixou de valer; `id`/`created_at` estáveis; devolve `persisted: {inserted, updated, unchanged, removed}`). `getCrossSourceInsights(workspaceId, {startDate, endDate})` só lê a tabela, em ordem canônica, com `generatedAt` e `schemaVersion`; período nunca gerado → `insights: []` e `generatedAt: null`. O código está em `analysis/cross-source-store.ts`; a parte pura (linhas, hash, plano de substituição) em `cross-source/storage.ts`.
- **Não está ligado.** Engine, sync, detectors e `/diagnostico` não referenciam a camada nem o store (travado por teste); a geração é sempre uma chamada **explícita**. Primeiro conjunto real persistido em 2026-10-04: workspace piloto × 2026-10-01→2026-10-04, 8 insights.
- **Em aberto (decisão pendente):** a política de regeneração — o conjunto persistido envelhece depois de um sync, e `generated_at` é o único sinal de frescor — e como o `buildAdvisorInput` consome `getCrossSourceInsights`.

---

## 9. AI Advisor — arquitetura

### 9.1 Não é um chatbot (D-R)

O Advisor é, **primeiro**, uma **camada de decisão / interpretação / priorização** sobre `insights` estruturados. Sua saída é:

- **priorização narrativa** — qual insight olhar primeiro e por quê;
- **conexões entre insights** — "a queda de conversão e a queda de Paid Search têm a mesma causa provável";
- **"o que fazer esta semana"** — 1–3 ações concretas derivadas dos `recommended_action` já presentes nos insights;
- **síntese executiva** — 1 parágrafo que um decisor lê em 20 segundos.

Uma **interface conversacional/chat** pode ser adicionada *depois* como um cliente dessa camada (perguntar "por que Paid Search caiu?" e receber a interpretação já produzida, ou pedir um recorte). O chat **não** é a arquitetura primária e **não** ganha acesso a nada que o Advisor não tenha.

### 9.2 Posição no pipeline

Depois de `insights` (F4). Nunca antes. Nunca em paralelo ao motor.

### 9.3 Contrato (forma proposta — implementada como `AdvisorContext`/`AdvisorResponse`, ver §9.7)

```ts
interface AdvisorInput {
  workspaceId: string;
  window: { start: string; end: string; comparedTo: string };
  insights: InsightRow[];        // linhas da tabela `insights` (open + acknowledged)
  crossSource: StoredCrossSourceInsights; // getCrossSourceInsights(workspaceId, período) — já persistido, nunca recalculado
  supportMetrics: SupportMetric[]; // JÁ calculadas pelo motor (getDiagnostico)
  // NADA de fact_*, raw_records, AnalysisContext
}

interface AdvisorOutput {
  summary: string;               // síntese executiva
  priority: { dedupeKey: string; rank: number; why: string }[];
  connections: { insightDedupeKeys: string[]; note: string }[];
  weeklyActions: { text: string; fromInsight: string /* dedupeKey */ }[];
  // toda frase rastreável a 1+ dedupeKey de entrada
}
```

### 9.4 `advisor_outputs` (conceito reservado — **não criado**: na fundação a resposta é efêmera, §9.7)

Tabela futura: `(id, workspace_id, sync_run_id, model, prompt_version, input_insight_ids uuid[], output_json, created_at)`. Permite mostrar "esta frase veio do insight X" e reproduzir/auditar. **Não** é criada na V1 além do contrato; o Advisor real é o G7+ (fora deste ciclo executar o modelo).

### 9.5 Invariantes do Advisor

INV-5 (só lê `insights` e `cross_source_insights`) · INV-6 (não calcula número) · INV-7 (não inventa evidência) · INV-8 (desligável, não é fonte de verdade) · INV-9 (dependência unidirecional). Reforço prático:

- **Sem tool de banco.** O input é montado por `buildAdvisorInput(workspaceId)` (função determinística que lê `insights`, `cross_source_insights` + support metrics) e entregue pronto ao modelo.
- **Validação de saída**: um teste extrai todos os números do `AdvisorOutput` e confere que cada um aparece verbatim no `AdvisorInput`. Número novo = bug bloqueante.
- **Prompt versionado** (`prompt_version`) para reprodutibilidade.

### 9.6 Feature-flag

Duas chaves **independentes** em `src/env.ts` (INV-8: o produto funciona 100% com tudo desligado):

- `ADVISOR_ENABLED` — **padrão `true`**: a tela `/advisor` e o server action. `false` esconde a tela (e o action recusa); `/diagnostico` e o resto do produto não mudam.
- `ADVISOR_LLM_ENABLED` — **padrão `false`**: o modelo de linguagem (§9.8). Ligar o Advisor **não** liga o LLM, e ligar a credencial sozinha também não. Desligado, o Advisor responde só com o `DeterministicAdvisorModel`, exatamente como na fundação.

### 9.7 Advisor V1 — fundação determinística (como construído)

> **Status (2026-10-04):** a fundação do Advisor (G7) está implementada **sem LLM**. O desenho de §9.1–9.6 continua valendo; esta seção registra o que foi construído e onde o código diverge do contrato proposto em §9.3 (`AdvisorInput` virou `AdvisorContext`).

```
 insights (diagnóstico do motor) ──┐
 cross_source_insights (persistido)┴─▶ buildAdvisorContext ─▶ AdvisorContext ─┐
                                                                               ├─▶ AdvisorModel ─▶ guard ─▶ AdvisorResponse
 AdvisorQuery (workspace · período · intenção · [comparação | pergunta]) ───────┘   determinístico hoje · LLM depois
```

**A regra: a IA interpreta; o sistema calcula.** O Advisor não calcula métrica, não inventa número, não cria evidência, não trata hipótese como fato, não junta populações incompatíveis, não afirma ter dado que o sistema não tem e não substitui o motor nem o Cross-source (INV-1, INV-5…INV-9, INV-18…INV-22).

**Decisão de fronteira (registrada).** O briefing do G7 pedia que o builder consumisse o `AnalysisContext`; D-N e INV-5 dizem que o Advisor **nunca** o lê. Foi seguido o caminho conservador, **sem emendar nenhuma invariante**: o `AdvisorContext` é composto **só** por saídas já calculadas e persistidas — `insights` e `cross_source_insights` (via `getCrossSourceInsights`). O `AnalysisContext` entra *indiretamente*: é a origem dos dois. O Cross-source persistido já traz os fatos do fechamento (sessões, visitas, conversões, criados/ganhos/perdidos, valor ganho, cobertura, limitações), então nada é duplicado. **Consequência:** o Advisor só responde com fatos para períodos cujo Cross-source **foi gerado**; sem ele a resposta é `no_data` e diz o motivo. **Alternativa não adotada** (exige emenda explícita de INV-5/D-N): o builder ler o `AnalysisContext` ao vivo — responderia para qualquer período e compararia períodos sem gerar nada, ao custo de duplicar a extração de fatos de `cross-source/facts.ts` (ou de recalcular o Cross-source no caminho do Advisor). Fica como decisão em aberto.

#### Diagnóstico × Cross-source × Advisor

| | **Diagnóstico** (motor) | **Cross-source** | **Advisor** |
|---|---|---|---|
| O que é | problemas e oportunidades com variação, `severity` e score | observações e **limitações** entre GA4, RD Marketing e RD CRM — sem severity nem score | respostas estruturadas a um pedido (resumo, fechamento, problemas, comparação…) |
| Quem calcula | gates → detectors → scoring | `buildCrossSourceInsights` (pura) | ninguém novo: **compõe e organiza**; a única aritmética é a comparação entre períodos, feita pelo sistema antes do modelo (INV-22) |
| Lê | `AnalysisContext` | `AnalysisContext` | `insights` + `cross_source_insights` persistidos |
| Escreve | `insights` | `cross_source_insights` (só quando alguém gera) | **nada** (INV-20) |
| Período | janela padrão (28 dias) | o período pedido | o período pedido; o diagnóstico vem com a **janela dele**, e a diferença é dita |
| Tela | `/diagnostico` | nenhuma | `/advisor` |

#### `AdvisorContext` — a entrada oficial da camada de IA (`advisor/types.ts`, `compose.ts`, `context.ts`)

`buildAdvisorContext(workspaceId, {startDate, endDate}, {comparePeriod?}, deps?)` lê o Cross-source persistido do período, os insights do diagnóstico e monta, por `composeAdvisorContext` (pura):

- `period` (com `days`), `generatedAt` (relógio injetável), `workspaceId`, `schemaVersion`;
- `sources[3]` (GA4, RD Marketing, RD CRM): `status` — `covered` · `partial` · `unavailable` · `unknown` (derivado dos **códigos** de limitação do Cross-source, não de recontagem) — e `daysWithData`/`periodDays` quando o Cross-source os informa (o CRM é evento a evento: `null`, nunca 0);
- `crossSource`: `generated` | `not_generated`, `generatedAt` (o único sinal de frescor do persistido), `schemaVersion` e os insights presentes;
- `diagnostics`: `available` | `none`, `alignedWithPeriod` (`true` só se **todo** insight é da janela do período pedido; `false` gera a limitação `diagnostics_period_differs`; `null` sem insights) e os itens **verbatim** do motor — o diagnóstico não é reescrito;
- **as quatro camadas, separadas e nunca misturadas:** `facts` (frases `fact`), `observations` (`observable_relationship`), `hypotheses` (as do Cross-source **e** a `hypothesis` do motor, sempre com `origin`) e `limitations` (Cross-source, motor e o próprio Advisor, com `severity` `blocking` · `warning` · `info`, definida por uma **tabela explícita por código** — código novo sem classificação cai em `warning` e quebra o teste de completude);
- `evidence`: o **registro único deduplicado** de pontos `{ref, source, metric, label, period, value, display, format, currency?, note?}` — o formato de evidência que o projeto já tinha, mais `ref` (`<id>@<início>..<fim>`) e `display` (pt-BR). `value: null` continua `null`;
- `comparison`: só no pedido de comparação.

Regras da composição (travadas por teste): mesma entrada ⇒ mesma saída; a entrada nunca é mutada; o conjunto de **outro workspace ou de outro período é recusado**; uma frase que cita evidência inexistente **falha alto** em vez de montar meia verdade; a mesma limitação (mesmo código e texto) em dois insights vira uma só, com as evidências somadas; o texto de nenhuma limitação ou fato é reescrito.

**Ausência ≠ zero.** Um GA4 sem linha nenhuma tem `ga4.sessions = null` (nunca 0) e a fonte é `unavailable`; um GA4 com linhas zeradas é **dado** (`0`, `covered`). Fonte ausente nunca ganha métrica de atividade; sem Cross-source gerado todas as fontes são `unknown`, `evidence` é vazio e a limitação bloqueante `cross_source_not_generated` aparece. O valor perdido que o Cross-source não pôde calcular continua `null` — e a UI o mostra como "sem dado".

#### `AdvisorQuery` (`advisor/query.ts`, `intents.ts`)

`{ workspaceId, period, comparePeriod?, intent, question? }`, validado por Zod `strictObject` (campo desconhecido é recusado, período inválido vira `AdvisorQueryError` com mensagem para o usuário). Na tela o `workspaceId` vem **sempre da sessão**, nunca do cliente. Intenções: `period_summary` · `closing_report` · `problems` · `diagnostic_explanation` · `acquisition_analysis` · `commercial_analysis` · `opportunities` · `comparison` · `free_question`. `comparison` exige `comparePeriod`; `free_question` exige `question` (≤ 1000 caracteres).

#### `AdvisorResponse` e o serviço (`advisor/service.ts`)

`{ schemaVersion, intent, status, title, summary, period, comparePeriod?, sections, comparison?, insights, limitations, evidence, followUps, provenance }`. `status`: `answered` · `partial` · `not_computable` · `no_data` · `needs_model`. Cada **seção** tem `figures` (números estruturados, **copiados do contexto**, nunca digitados) e `items` com a **camada de cada item** (`fact` · `observable_relationship` · `hypothesis` · `limitation` · `diagnostic` · `comparison`) — a tela desenha a partir dos campos, não de texto livre. `limitations` traz **todas** as do contexto, da mais grave à menos; `evidence` é autocontida (todo `ref` citado resolve nela); `provenance` registra o produtor, o instante do contexto, o estado do Cross-source e do diagnóstico e se houve fallback.

`answerAdvisorQuery(pedido, deps?)`: valida o pedido → `buildAdvisorContext` → `AdvisorModel.generate` → guard → completa de forma **determinística** o que o modelo não controla (figuras, evidência, limitações, proveniência) → guard final. Modelo recusado pelo guard ou que falha ⇒ resposta determinística + limitação (`model_output_rejected` / `model_failed`). Se nem a resposta determinística passa na validação, é `AdvisorInternalError` (bug, nunca silencioso).

#### Intenções determinísticas (`advisor/deterministic-model.ts`)

| Intenção | Seções (só entram as que têm conteúdo) |
|---|---|
| `period_summary` | cobertura · aquisição · comercial · valores |
| `closing_report` | cobertura · aquisição · comercial · valores · origem (atribuição) · diagnóstico do motor · observações entre fontes · hipóteses · o que não é calculado entre fontes · métricas não calculáveis |
| `problems` | diagnóstico (sem oportunidades) · limitações que pedem atenção (`blocking`/`warning`) |
| `diagnostic_explanation` | cobertura · aquisição · comercial · diagnóstico · observações · "o que os dados não permitem afirmar" — sem hipóteses e sem causa |
| `acquisition_analysis` | cobertura · aquisição (GA4 e RD Marketing lado a lado, sem taxa conjunta) · o que não é calculado |
| `commercial_analysis` | cobertura · comercial · valores · origem · o que não é calculado · métricas não calculáveis |
| `opportunities` | hipóteses (marcadas) · oportunidades do diagnóstico |
| `comparison` | variação entre períodos (tabela calculada pelo sistema) · o que não foi comparado — ou os motivos do "não computável" |
| `free_question` | com o LLM desligado (o estado de entrega): o **resumo determinístico do período**, dito como tal — título "Pergunta livre — Resumo do período …", frase inicial "O modelo de linguagem do Advisor não está ativo neste ambiente, então a pergunta livre não foi interpretada; segue o resumo determinístico do período, calculado pelo sistema." e a limitação `llm_not_connected`; a pergunta não é ecoada nem respondida. O status `needs_model` segue no contrato, mas o serviço não o produz mais (fechamento de 2026-10-05, §9.8) |

Cada limitação e cada evidência aparece **uma vez** na resposta; o texto dos fatos é o do Cross-source, sem reescrita; o diagnóstico vem com a janela do motor e a limitação de janela diferente; sem insight do motor a resposta **não** diz "sem problemas" — diz que isso não prova nada.

#### Comparação (`advisor/comparison.ts`, INV-22)

Computável só quando: os dois períodos têm Cross-source gerado; o período-base termina **antes** do início do atual; ambos têm o **mesmo número de dias** (4 dias não se comparam com 30, e o Advisor não normaliza por dia — decisão de produto em aberto); a fonte da métrica está `covered` nos dois. Métricas: `ga4.sessions`, `ga4.key_events`, `rd_marketing.visits`/`conversions`, `rd_crm.created_deals`/`won_deals`/`lost_deals` e `rd_crm.won_value` — este **só** quando todos os ganhos dos dois períodos têm valor registrado; taxas não entram. Saída: diferença e variação % (`null` sobre base zero), com a evidência dos dois períodos e a lista do que foi pulado e por quê. Caso real: outubro (01–04/10, 4 dias) × setembro inteiro (30 dias) ⇒ **não computável por duração**.

#### Guard da saída (`advisor/guard.ts`, INV-21)

**Prova, mecanicamente:** todo número e toda data em texto existem no contexto (verbatim — a invariante "número do output ∈ input" de §9.5); toda referência de evidência/insight/código de limitação existe; fato e relação observável citam evidência; nenhuma moeda assumida (sem `R$`/BRL quando a fonte não informa a moeda — o CRM não informa); limitação própria de modelo só com origem `advisor`; na resposta final, nenhuma limitação do contexto omitida e figuras/evidências idênticas às dele. **Não consegue provar** (e por isso as `figures` estruturadas, vindas do contexto, são a fonte de verdade da tela): que um texto livre não afirma causalidade, que um "zero" em prosa não esconde uma ausência, ou que o número certo está na frase certa (9 criados ≠ 9 ganhos — ambos são "9"). Essas regras valem para o prompt e para a avaliação do modelo quando ele existir.

#### Regras e fluxo do futuro LLM (`advisor/llm-contract.ts`)

O modelo recebe **só** `buildAdvisorModelInput({context, query})`: as regras de interpretação (versionadas — `advisor-prompt-v1`), o `AdvisorContext` em JSON canônico **sem o `workspaceId`** e o pedido. O contexto traz só agregados e chaves de insight — nunca dado de contato nem os `source_id`/`campaign_id` do CRM (que aparecem apenas como contagens de cobertura).

- **Pode:** resumir, explicar, organizar, destacar evidências, comparar fatos **já calculados** (os itens de `comparison`), explicar limitações, escrever em linguagem executiva e formular hipóteses **marcadas** (`hypothesis`), em linguagem condicional e sem número novo.
- **Não pode:** recalcular métrica ou alterar número; inventar dado, fonte, período ou evidência; inferir causalidade como fato; criar evidência; preencher campo ausente; transformar ausência em zero; misturar sessões do GA4 com visitas do RD Marketing ou negócios do CRM como se fossem a mesma população, ou sugerir taxa/CAC/ROAS entre eles; transformar `source_id`/`campaign_id` em atribuição confiável; assumir moeda; omitir ou contradizer limitação; tratar hipótese como fato; apresentar o diagnóstico de outra janela como se fosse do período pedido. As regras que o guard consegue provar são marcadas `enforced`.
- **Fluxo:** um provedor implementa `AdvisorModel` (um adaptador fino sobre a API do fornecedor) → recebe `buildAdvisorModelInput` → devolve `AdvisorModelResponse` → guard → se recusado, fallback determinístico registrado. Sem tools, **sem tool de banco**, chave própria de liga/desliga (padrão `false`), `promptVersion` na proveniência e uma suíte de avaliação do modelo antes de ligar. **Construído em §9.8** (o formato de entrada passou a ser uma projeção do contexto, e a saída um DTO mais estreito, em vez de `figureRefs`).

#### Tela `/advisor` e flag

Item "Advisor" no menu. Período (com chips dos períodos que têm Cross-source gerado), período de comparação (padrão: o imediatamente anterior, de mesma duração), as sugestões do produto (Fechamento do período · Resumo executivo · Performance de aquisição · Performance comercial · Comparativo mensal · Principais problemas · Oportunidades · O que aconteceu?), o campo de pergunta livre, e os estados de carregamento, vazio, erro e resposta estruturada (limitações por gravidade, evidências recolhíveis). O visualizador da resposta é puro (renderiza igual no servidor e no cliente). O server action exige a sessão **dentro** dele e valida a entrada. `ADVISOR_ENABLED` (§9.6).

#### Decisões em aberto e defeito conhecido

- **Ler o `AnalysisContext` ao vivo?** (emenda de INV-5/D-N) — acima. **Gerar o Cross-source sob demanda** a partir da tela, ou após o sync, e a **política de regeneração** (o persistido envelhece, §8.5).
- **Normalizar a comparação por dia** (hoje só períodos de mesma duração) e se `won_value` deve poder ser comparado com cobertura de valor parcial.
- **`advisor_outputs`**: persistir as respostas (histórico, auditoria) ou manter efêmeras.
- **"Visão geral"**: o menu pedido no briefing a incluía; ela não existe hoje e não foi criada.
- **Defeito do Cross-source em `metric-not-computable` — corrigido no gerador (2026-10-05), falta regerar o conjunto persistido.** O helper de evidência marcava como `currency` todo ponto cujo id terminava em `_value` — inclusive as **contagens** `rd_crm.lost_deals_with_value` / `won_deals_with_value`, que no Advisor saíam como "0,00" no painel de evidências. O formato agora vem de uma **lista explícita** de métricas de dinheiro (`won_value`, `lost_value`, `average_ticket`); o resto é `count` e sem moeda (§9.8, "Fechamento"). A linha **já persistida** do conjunto real de 01–04/10 ainda tem o formato antigo até o conjunto ser regenerado — escrita explícita (INV-16), **pendente de decisão do usuário**.

### 9.8 Advisor V1 — modelo de linguagem (como construído)

> **Status (2026-10-04):** o `AdvisorModel` ganhou a segunda implementação prevista em §9.7: um **modelo de linguagem** (Anthropic, via `fetch`, sem SDK), atrás de `ADVISOR_LLM_ENABLED` (padrão `false`). O resto da arquitetura — motor, Cross-source, `AdvisorContext`, guard base, serviço, tela — **não mudou de papel**. **A IA interpreta; o sistema calcula.**

```
 AdvisorQuery ─▶ buildAdvisorContext ─▶ AdvisorContext   (completo; fica no servidor)
                                              │
                  projeção explícita ─────────┘   llm/privacy.ts — sem workspace, sem ids técnicos,
                          │                       sem valor cru, evidências como E1…En
                varredura de PII (fail-closed)
                          ▼
 AdvisorService ─▶ AdvisorModel ─▶ LlmAdvisorModel ─▶ LlmTransport ─▶ Anthropic (fetch)
        ▲                                  │
        │  fallback determinístico         ▼
        └──── guard estrito (validateLlmDraft) ◀── schema Zod ◀── JSON do modelo
```

#### Provedor (D-X)

Não havia provedor, SDK nem chave de LLM no projeto (auditado: `package.json`, `node_modules`, `.env.local` e `.env.example`, só os nomes). Escolha do usuário: **Anthropic, `fetch` direto, sem SDK** — nenhuma dependência nova, igual aos conectores (`fetch` + Zod); um SDK traria retry, log e telemetria próprios que teriam de ser desligados para nada do pedido vazar. Modelo padrão `claude-sonnet-5-5` (`ADVISOR_LLM_MODEL`). Particularidades da API, conferidas na documentação oficial em 2026-10-04:

- **Saída estruturada nativa**: `output_config.format = {type: "json_schema", schema}`. Exige `additionalProperties: false` em todo objeto, todos os campos em `required`, e **recusa** `minLength`/`maxLength`/`maxItems`/`pattern`/`format` e recursão — por isso o JSON Schema é **derivado do mesmo schema Zod** com essas palavras-chave removidas (`llm/schema.ts`), e os limites de tamanho continuam valendo na validação Zod.
- **Os modelos Claude 5 rejeitam `temperature`, `top_p` e `top_k`** (HTTP 400 para qualquer valor diferente do padrão). "Baixa criatividade" vem, portanto, do prompt, do schema e do guard; `ADVISOR_LLM_EFFORT` (`low`/`medium`/`high`, padrão `medium`) só regula quanto o modelo pensa (latência × custo). O pensamento adaptativo vem ligado e conta no `max_tokens`.
- `stop_reason: refusal` e `max_tokens` **não garantem o schema** → nunca se aproveita o texto. Os blocos de raciocínio (`thinking`) são ignorados; o JSON está no bloco `text`.
- Sem retry automático (dobraria latência e custo; o fallback cobre a indisponibilidade). Tempo limite `ADVISOR_LLM_TIMEOUT_MS` (padrão 90 s).

#### Camadas e arquivos (`src/server/advisor/`)

| Arquivo | Papel |
|---|---|
| `llm/transport.ts` | A fronteira: `LlmTransport` (`generate({system, user, jsonSchema}) → {text, usage, requestId}`) e `AdvisorLlmError` (código do vocabulário de falhas; a mensagem é **sempre genérica**, o texto do provedor fica só em `debugDetail`). |
| `llm/anthropic.ts` | **O único arquivo que conhece o provedor**: endereço, cabeçalhos, formato do pedido, credencial (por parâmetro), mapa de erros HTTP → código. |
| `llm/model.ts` | `LlmAdvisorModel` (projeção → varredura de PII → transporte → parse + schema → conversão) e `UnconfiguredLlmModel` (habilitado sem credencial: falha explícita, o serviço responde de forma determinística e diz por quê). |
| `llm/config.ts` | A única ponte com `@/env`: `advisorLlmStatus()` (`off`/`ready`/`not_configured`) e `getConfiguredAdvisorModel()`. |
| `llm/privacy.ts` | `projectContextForModel` (projeção explícita + ids curtos) e `scanForPii`. |
| `llm/prompt.ts` · `llm-contract.ts` | O prompt do sistema (renderizado a partir de `ADVISOR_INTERPRETATION_RULES`, `advisor-prompt-v2`), a mensagem de dados e as regras versionadas. |
| `llm/schema.ts` | O DTO de saída (Zod), o JSON Schema do provedor, o parse e a conversão para `AdvisorModelResponse`. |
| `guard.ts` | `validateLlmDraft` (estrita) por cima do guard base. |
| `service.ts` | Escolhe o caminho: modelo × determinístico, validação, fallback, log. |
| `log.ts` | Log de metadados com lista de campos permitidos. |

#### O prompt (`advisor-prompt-v2`)

Dois canais. O **sistema** (confiável) define o papel — *analista sênior de dados e marketing fundamentado nos dados fornecidos pelo sistema* —, a regra central, a **hierarquia da verdade** (contexto → evidências → fatos/relações → hipóteses → limitações → linguagem natural; contexto vence o conhecimento geral; sem conhecimento externo para preencher dado da empresa), as seis camadas com exemplos (marcadores `<N>`, nunca número real), as regras (o que pode, o que não pode, como responder — uma única fonte, a mesma que o guard e os testes usam), a instrução de cada intenção e o tratamento da pergunta. Os **dados** (não confiáveis) vão numa mensagem JSON `{query, context}`: a pergunta do usuário entra só como string em `query.question` — não fecha tag, não vira instrução fora do campo e nunca toca o prompt do sistema. A pergunta é tratada como **premissa não verificada**: o modelo só confirma o que o contexto sustenta e, se ela pede para ignorar os dados, assumir um valor ou completar lacunas, ele diz em uma frase que o contexto não traz o dado.

#### Saída: schema e o que é do sistema

O modelo devolve `{title, summary, sections[{title, content, figureIds, items[{layer, text, evidenceIds, limitationCode}]}], insightRefs}`. O **sistema** decide o resto: `status` (derivado do contexto), `followUps`, ids das seções, o **texto e a gravidade** de cada limitação (copiados do contexto pelo código — o modelo só escolhe *onde* ela aparece) e **todas** as limitações da resposta; o modelo **não pode criar limitação** (campo inexistente; campo extra é recusado). Os **ids das evidências são preservados**: o modelo cita `E1…En` e o sistema os traduz para as referências reais (`ga4.sessions@2026-10-01..2026-10-04`), que chegam em `evidenceRefs` e em `response.evidence`.

#### Guard estrito (INV-25) — o que prova e o que não prova

Além das regras do guard base (número e data ∈ contexto, referências existem, fato/relação citam evidência, moeda, limitações), `validateLlmDraft` exige, mecanicamente: **número sustentado por evidência CITADA** (por item e no resumo/seções; vale também o número escrito pelo sistema numa frase ligada à evidência citada, p.ex. "2 ativos de conversão"; **evidência ausente — `display: null` — não sustenta número nenhum**: é o que impede "ausência vira zero"); **sem número por extenso** que não bata com o contexto, **sem magnitude ou conta implícita** ("mil", "dobrou", "metade"); **sem conta implícita** por frase ("N cada", "por negócio", "em média", "vezes mais", razão) — o erro clássico do número certo na frase errada (*"os 5 ganhos valem 23.399,00 cada"*), a não ser que a frase seja uma que o próprio sistema escreveu; **sem plataforma** (Google Ads, Facebook, Instagram…) que o contexto não menciona; **moeda** (R$/reais/BRL, US$/USD/dólar, €, £) só se alguma fonte a informou — "dados reais" não é moeda; **hipótese com âncora** (evidência citada, ou a hipótese do próprio contexto repetida palavra por palavra); camada **`comparison` só com comparação calculada**; resposta não vazia. O que **não** prova: que uma **frase qualitativa sem número** é verdadeira (p.ex. o eco de uma premissa — "o marketing teve baixo desempenho"); essa defesa é o prompt, a separação em camadas (uma hipótese nunca vira fato e aparece tracejada), a evidência visível na tela e a avaliação ao vivo com o modelo real.

#### Privacidade (INV-24)

Auditoria, **antes de qualquer envio**, do contexto real de 01–04/10/2026 (dados do piloto, somente leitura; contexto completo, ≈35,8 mil caracteres por pergunta — 18 fatos, 4 relações, 3 hipóteses, 21 limitações, 28 evidências, 1 insight do motor): **nenhum e-mail, telefone, CPF/CNPJ, UUID ou URL**, o `workspaceId` não vai no payload, e nenhuma das 12 strings pessoais e de conta que o banco guarda (usuários, nome do workspace, propriedades conectadas, e-mails de conexão) aparece — o único acerto parcial foi a palavra "marketing", de "RD Marketing". A projeção, que veio depois, só reduz o que sai (menos campos, ids curtos). O CRM entra só como contagem e cobertura (`fact_deals` já nasce sem nome de negócio e sem contatos). A projeção é uma lista de campos; a varredura bloqueia o envio se um dado pessoal aparecer — **na pergunta digitada** ou numa dimensão externa de um insight futuro (nome de canal ou de campanha).

#### Fallback, quando o modelo nem é chamado e log

Qualquer falha cai no determinístico com a limitação `model_failed` e o **motivo em português** (modelo não configurado · tempo esgotado · serviço indisponível · pedido recusado pelo provedor · **conta do provedor sem crédito ou no limite de gasto** — a API a devolve como HTTP 400, e o adaptador a reconhece pela mensagem só para classificar · recusa do modelo · resposta incompleta · formato inesperado · pergunta com dado pessoal) ou `model_output_rejected` (com os códigos do guard). A **pergunta livre** em fallback recebe o **resumo determinístico do período**, dito como tal (não o "requer modelo"); com o LLM **desligado** (o estado de entrega) ela recebe o mesmo resumo, com a frase "O modelo de linguagem do Advisor não está ativo neste ambiente…" e a limitação `llm_not_connected` — sem `fellBack`, que só existe para falha (desligar é configuração, não falha). O modelo **não é chamado** quando não há o que interpretar: sem Cross-source gerado (resposta `no_data`) ou comparação não computável (resposta `not_computable`). O log (`advisor.llm` e `advisor.answer`) só tem metadados.

#### Tela

A mesma `/advisor`, sem redesenho: o estado de carregamento diz que o modelo pode levar até um minuto; uma linha sob o campo de pergunta diz o que responde a pergunta livre neste ambiente (`ready`/`off`/`not_configured`); o **aviso de fallback** no topo da resposta traz o motivo (sem duplicar a limitação na lista); a proveniência diz qual modelo, a versão do prompt e que o sistema validou.

#### Avaliação ao vivo (2026-10-04) — o que foi e o que não foi comprovado

`advisor-llm-integration.test.ts` (opt-in: banco real **somente leitura** + API real). Antes de qualquer teste pago, uma **chamada-sonda** mínima confere a conta e a credencial; se o provedor recusar, tudo aborta com a mensagem dele. `ADVISOR_LIVE_BUDGET=small` limita a execução à pergunta de fechamento e a um ataque adversarial.

- **Comprovado contra o ambiente real:** (a) a conexão é somente leitura (um `CREATE` é recusado pelo servidor) e as tabelas lidas têm o mesmo fingerprint antes e depois; (b) o **payload realmente enviado à API** — prompt do sistema ≈10,4 mil caracteres e mensagem de dados ≈17,3 mil (≈8 mil tokens) para o contexto real de 01–04/10 — **sem PII, sem `workspaceId`**, com a pergunta só em `query.question`; (c) o **fallback contra a API real**: a conta dona da chave estava **sem crédito** ("Your credit balance is too low…", HTTP 400 `invalid_request_error`) e o Advisor respondeu de forma determinística em todas as tentativas, com o motivo; a classificação `billing` nasceu desse achado. Nenhuma requisição foi processada (todas rejeitadas antes de gerar), então nenhum token foi consumido.
- **NÃO comprovado:** o comportamento do **modelo real** — a resposta à pergunta de fechamento e aos prompts adversariais, a taxa de aceitação pelo guard estrito, latência e custo reais. **Pendente de crédito na conta do provedor** (ação de cobrança do usuário). Nada neste documento afirma como o modelo real se comporta; a avaliação precisa rodar antes de ligar `ADVISOR_LLM_ENABLED` para o usuário.

#### Fechamento do Advisor V1 (2026-10-05) — estado de entrega

O Advisor V1 fecha **determinístico, com o modelo de linguagem implementado e desligado** (`ADVISOR_LLM_ENABLED=false`: o `.env.local` do piloto não define a flag, então vale o padrão). **Nenhuma chamada à Anthropic foi feita neste fechamento** — nem teste ao vivo, nem chamada-sonda, nem consulta de saldo; os processos que leram o banco real receberam só a URL do banco, nunca a chave da API (`next build` e `drizzle-kit` carregam o `.env.local` como sempre, mas nenhum caminho deles chama o provedor). Duas correções, ambas já identificadas, sem mexer em arquitetura, motor, detectors, gates, scoring, conectores, sync, `AnalysisContext` ou `/diagnostico`:

1. **Defeito do Cross-source em `metric-not-computable`** (§9.7). O formato dos pontos do CRM deixou de ser inferido pelo **sufixo** `_value` e vem de uma **lista explícita** (`won_value`, `lost_value`, `average_ticket` = dinheiro); `won_deals_with_value`/`lost_deals_with_value` são contagens (`count`, sem moeda). Só `cross-source/integrity.ts` mudou. A **forma** do JSON persistido é a mesma (`schema_version` continua 1; `count` já era um formato válido) — o que muda é o **conteúdo**, e portanto o `content_hash`, de uma linha. **Medido em dry-run contra o banco real** (somente leitura; o gerador corrigido rodou sobre as fact tables e o resultado ficou em memória): das 8 linhas de 01–04/10, **7 saem com o mesmo hash** e só `metric-not-computable` muda, apenas no ponto `rd_crm.lost_deals_with_value` (`currency` → `count`; mesmos ids, mesmas frases, mesmo título, período e fontes) — o plano de regeneração seria `{inserido 0, atualizado 1, igual 7, removido 0}`. Os números do Advisor não mudam; só esse rótulo no painel de evidências ("0,00" → "0"). **O conjunto persistido ainda tem a linha antiga** até ser regenerado: é uma escrita explícita (INV-16) em `cross_source_insights` (que também renova `generated_at` das 8 linhas) e **fica à decisão do usuário** — este fechamento não escreveu em tabela alguma.
2. **Pergunta livre com o LLM desligado** (critério de entrega: "resposta determinística útil e explícita"). Deixou de responder só `needs_model` e passou a entregar o **resumo determinístico do período**, dito como tal (tabela de §9.7). Não é fallback (`fellBack` segue `false`): é o modo configurado; a limitação `llm_not_connected` explica. `deterministicModel` (`service.ts`) é `new DeterministicAdvisorModel({ freeQuestion: "period_summary_llm_off" })`; `answerDeterministically` mantém `needs_model` como padrão da função pura.

**Validado sobre os dados reais persistidos de 01–04/10/2026** (somente leitura; `transaction_read_only=on`; fingerprints das tabelas lidas iguais antes e depois): resumo do período, fechamento, comercial, problemas, aquisição e pergunta livre respondem (`answered`, produtor determinístico, sem `fellBack`), cada resposta passa pelo guard, e os números conferem com **SQL direto nas fact tables**: GA4 487 sessões, 0 eventos-chave, 4 de 4 dias · RD Marketing 6 visitas, 0 conversões, 4 de 4 dias, 2 ativos · CRM 9 criados, 5 ganhos, 14 perdidos, 1 ganho com valor (23.399,00), 0 perdidos com valor. A moeda não é informada pelo CRM e nunca aparece "R$".

#### Fora do escopo e decisões em aberto

- **Não construído (pedido):** histórico persistido de conversas, memória, feedback, RAG, ferramentas, acesso do LLM ao banco, migração.
- **Sem limite de uso nem orçamento por workspace**: cada pergunta é uma chamada paga (estimativa: ≈8 mil tokens de entrada e alguns milhares de saída); a ação não tem rate limit. Decisão do usuário.
- **`maxDuration`**: não foi definido. Em hospedagem serverless com limite curto (p.ex. Vercel Hobby), uma chamada de dezenas de segundos estoura o limite da plataforma — defina `export const maxDuration` na página conforme o plano ao publicar.
- **Defeito do Cross-source** (§9.7, corrigido no gerador em 2026-10-05): enquanto o conjunto persistido não for regenerado, `rd_crm.lost_deals_with_value` ainda chega ao modelo como "0,00" no `display`; depois de regenerar passa a ser "0".
- **`supportingEvidence` do Google Ads** não é enviada ao modelo (o guard ainda não conhece esses números).
- **Avaliação contínua**: o teste ao vivo (`advisor-llm-integration.test.ts`, opt-in) roda a pergunta de fechamento e os prompts adversariais contra o modelo real; ele deve ser repetido a cada mudança de prompt, de modelo ou de `effort` **antes** de ligar `ADVISOR_LLM_ENABLED` para o usuário.

---

## 10. Escopo V1 do Google Ads

### 10.1 OAuth e credenciais

- **Scope**: `https://www.googleapis.com/auth/adwords` (único, sensível). Adicionar ao OAuth consent screen do client existente. Mesmo client de login/GA4.
- **Redirect**: `http://localhost:3000/api/oauth/google_ads/callback` (nova env `GOOGLE_ADS_REDIRECT_URI` ou derivada do `provider`).
- **⚠️ Developer token**: obrigatório no header `developer-token`. Vem de uma conta **Manager (MCC)**. Token novo = "Test account access" (inútil para dados reais) → **solicitar Basic access** (formulário + revisão da Google — ver §13). Nova env `GOOGLE_ADS_DEVELOPER_TOKEN`.
- **`login-customer-id`**: id do MCC no header ao acessar a conta-cliente. Vai em `AccessContext.meta` (já previsto no contrato). Nova env `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (ou por-conexão).
- Modo Testing → refresh token expira ~7 dias (mesmo problema do GA4).

### 10.2 APIs e discovery

- **Google Ads API** (a AdWords API está descontinuada). **Versão: `v25`** (confirmada vigente em 2026-09 nas release notes; v21–v25 suportadas; a `v18` fixada no G2 já foi aposentada). Ponto único de verdade: `GOOGLE_ADS_API_VERSION` em `connectors/google_ads/http.ts`. Google aposenta ~3 versões/ano — reconfirmar antes do 1º sync real. Habilitar "Google Ads API" no projeto do Google Cloud.
- **Lib vs REST (decisão G2/G3):** REST cru (`fetch` + Bearer + `developer-token`), sem a lib `google-ads-api` (gRPC). Consistente com o GA4, sem dependência nova. O cliente HTTP (versão, headers, retry 429/5xx, `DeveloperTokenMissingError`) vive em `connectors/google_ads/http.ts`, compartilhado por discovery (G2) e extract (G3).
- **Discovery** (`connector.listAccounts`):
  1. `GET https://googleads.googleapis.com/vXX/customers:listAccessibleCustomers` → resource names (`customers/123`) que a credencial enxerga.
  2. GAQL `SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer` para cada → `display_name` / `timezone` / `currency`.
- **Lib**: decidir em G2/G3 entre `google-ads-api` (npm, gRPC, tipada) e `fetch` cru no REST (`.../customers/{id}/googleAds:searchStream`). O plano D4 usou "google-auth-library + fetch" para o GA4; para o Ads, GAQL + streaming + shapes de erro pesam a favor da lib.

### 10.3 Extract — GAQL campanha × dia (INV-13)

```sql
-- GAQL efetivamente enviada no G3 (connectors/google_ads/extract.ts):
SELECT
  customer.id, customer.currency_code, customer.time_zone,
  campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
  campaign_budget.amount_micros,
  segments.date,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share
FROM campaign
WHERE segments.date BETWEEN '<since>' AND '<until>'
ORDER BY segments.date ASC, campaign.id ASC
```

- `customer.*` entra na SELECT para validar moeda/fuso/id por linha (§12) — o `raw_record` fica auto-contido e replayável.
- Janela: 180 dias no 1º sync; incremental = `max(hoje − 180, last_synced − 14)` (`restatementWindowDays: 14` no `meta` do conector). A janela reusa o mecanismo genérico do `run-sync` — sem novo scheduler.
- Paginado (`googleAds:search` + `nextPageToken`, `pageSize` 10 000); uma página = um `raw_record`; validado por Zod (`schema.ts`); mapeado para `CanonicalAdPerfRow` (`mapping.ts`).
- Teto de segurança **específico do conector**: `MAX_ADS_ROWS` em `extract.ts` (não herda o `MAX_TOTAL_ROWS`/500k do GA4 — §11). Dívida conhecida: `run-sync.ts` ainda usa a constante do GA4 para decidir `status = 'partial'`; inócuo nos volumes de Ads (campanha × dia), a limpar num bloco de infra, não no G3.
- **Sem** `ad_group`, `keyword`, `search_term` (INV-13).

### 10.4 Métricas e atributos

Ver a tabela de `fact_ad_performance_daily` em §6.3. Núcleo: `impressions`, `clicks`, `cost` (de `cost_micros`), `conversions`, `conversion_value`, `impression_share`, `budget_lost_is`, `rank_lost_is`, `campaign_status`.

### 10.5 Normalização

`connector.mapToCanonical` → `CanonicalBatch{ target: "ad_performance", rows: AdPerfRow[] }` → `normalize` → `upsertFactAdPerformance` (upsert por `source_hash`, chave natural `(connection_id, platform, date, campaign_id, ad_network)`).

### 10.6 Enriquecimento do insight de Paid Search

Ver §8. É a **única** forma como o Google Ads afeta o diagnóstico na V1: acrescenta o "porquê" (investimento, impressão perdida, status de campanha) ao `traffic-volume-drop` de Paid Search já emitido pelo motor. Detector e firing intocados (D-S, INV-3).

---

## 11. Fora do escopo da V1

- **Detectores novos** — `paid-spend-drop`, `conversion-volume-drop`, `emerging-growth`, 2º detector de canal. Só depois do rating cego do piloto e com aprovação.
- **`#5` (regra de severidade do `traffic-volume-drop`)** — permanece adiado (`PROJECT_STATE.md` §11).
- **Google Ads além de campanha × dia** — `ad_group`, `keyword`, `search_term`/query-level (INV-13).
- **Meta Ads, Search Console** — só a arquitetura fica preparada; nenhum é implementado na V1. *(RD Station Marketing e RD CRM foram implementados depois do G6 — §7.5.)*
- **AI Advisor com modelo real** — a fundação determinística (§9.7) e a conexão do modelo de linguagem (§9.8, atrás de `ADVISOR_LLM_ENABLED`, padrão `false`) foram implementadas. **Fora do escopo:** histórico persistido de conversas, memória, feedback, RAG, ferramentas para o LLM, acesso do LLM ao banco, rate limit/orçamento por workspace.
- **Interface de chat** — o Advisor não é chatbot na V1 (D-R): a tela `/advisor` é de análises sugeridas sobre um período; a pergunta livre é respondida pelo modelo de linguagem **sobre o contexto já calculado** (sem histórico, sem memória, sem conversa).
- **Fila / worker / cron / sync agendado** — sync continua inline (ver §13, risco).
- **Persistir um resumo de análise** (`analysis_runs`) para o `/diagnostico` não recomputar o contexto — otimização, V1.1.
- **RLS / multi-tenant real / modo agência / convites / papéis** — V2.
- **Deploy / infra de produção / observabilidade / billing / exportação PDF**.
- **Renomeações "por estética"** (`ctx.current` → `ctx.traffic.current` sem necessidade funcional; `getGa4ConnectionForWorkspace` → `getConnectionForWorkspace` só se o refactor de G1 exigir).
- **`raw_records` com poda** — segue append-only.

---

## 12. Ordem de implementação G0 → G7

Ordem oficial: **G0 → G0b (paralelo) → G1 → G2 → G3 → G4 → G5 → G6 → G7.**
Cada bloco: implementar só o necessário → `pnpm test` / `typecheck` / `lint` / `build` → verificar critério de sucesso → **parar e aguardar aprovação**.

| Bloco | Escopo | Critério de sucesso ("não quebrou nada") |
|---|---|---|
| **G0** | Este documento (`docs/v1-architecture.md`). **Sem código, sem schema, sem refactor.** | Documento aprovado. |
| **G0b** *(paralelo, externo)* | Iniciar solicitação de **developer token / Basic access** do Google Ads + MCC; adicionar scope `adwords` no consent screen. | Em andamento; não bloqueia G1; destrava G2. |
| **G1** | Refactor da abstração de conector — **sem nova fonte**. `connectors/shared/` + `connectors/google/oauth.ts`; rotas `/api/oauth/[provider]/*`; `getValidAccessToken` / `getConnectionForWorkspace` genéricos; `runSync({connectionId})`; `mapToCanonical → CanonicalBatch`; `normalize` roteia por `target`. Migração: `ADD COLUMN platform DEFAULT 'ga4'` em `fact_traffic_daily`. | `pnpm test` verde; **`runAnalysis` produz `insights` idênticos ao de antes** (mesmo `fact_traffic_daily`); `db:push` só a coluna `platform`; GA4 conecta/sincroniza/analisa como antes. |
| **G2** | Google Ads OAuth + discovery (mirror de B1/B2). `connectors/google_ads/{auth,discovery}.ts`; botão "Conectar Google Ads"; `connection_properties` para contas Ads. Decidir lib vs REST. | OAuth conecta; contas listadas; 1 selecionada; tokens cifrados; **GA4 intocado**. |
| **G3** ✅ | `fact_ad_performance_daily` (migração `0002`) + `connectors/google_ads/{http,schema,mapping,extract}.ts` (GAQL campanha × dia, paginado) + `upsertFactAdPerformance` isolada em `normalize.ts` + `CanonicalBatch{target:"ad_performance"}` + "Importar dados" no card. | `pnpm test/typecheck/lint/build` verde (60 testes); `db:push` sem mudanças; `runAnalysis` produz `insights` do GA4 byte-idênticos (regressão OK). **Sync real bloqueado por `GOOGLE_ADS_DEVELOPER_TOKEN` externo.** |
| **G4** ✅ | `runAnalysis` renomeado para **`runWorkspaceAnalysis`** em `analysis/engine.ts` — camada explícita de orquestração workspace-level (`{workspaceId, syncRunId}`, sem `provider`, sem `connector`). `run-sync.ts` passou a chamar `runWorkspaceAnalysis` (nenhum branch por provider decide se a análise roda); 6 testes-guarda de arquitetura (`analysis/__tests__/orchestration.test.ts`) travam INV-6/INV-8/INV-9. **Não integra Google Ads ao `AnalysisContext`** — `fact_ad_performance_daily` continua invisível para o motor; isso é G5. | `pnpm test/typecheck/lint/build` verde (66 testes); `runWorkspaceAnalysis` produz `insights` do GA4 idênticos em `dedupe_key`/`severity`/`confidence` (verificado com sync real pós-reconexão em 2026-09-22); `sync_run_id`/`updated_at` são as únicas diferenças aceitáveis. |
| **G5** ✅ | `buildAdsContext` → `ctx.ads` (`AdsContext` ou `null`) no `AnalysisContext`, aditivo; campos de tráfego intocados no topo; `composeAdsContext` pura; janela = a `current` do tráfego. Detectores **intocados** (§7.4). | `pnpm test/typecheck/lint/build` verde (76 testes); Ads vazio (`null`) produz `insights` idênticos (teste com detectores reais + regressão real); nenhuma alteração de schema. |
| **G6** ✅ | **`enrichWithAds(insights, ads)`** (`analysis/enrichment.ts`): evidência complementar do Google Ads em `traffic-volume-drop` de `Paid Search` (campanhas `SEARCH`), só métricas absolutas da janela atual, fail-closed, sem causalidade (§8.4). Detectors/gates/scoring/severity/thresholds/confidence **intocados**; sem schema/migration/IA. | `pnpm test/typecheck/lint/build` verde (**116 testes**); `ads === null` preserva o comportamento anterior (no-op por referência); `dedupeKey`/`severity`/`confidence`/`priorityScore` inalterados; regressão real no workspace MS Server (2026-09-24), sem Ads real (`fact_ad_performance_daily = 0`). UI ainda **não** renderiza `supportingEvidence`. |
| **RD-1** ✅ *(fora da sequência G)* | RD Station Marketing e RD CRM como fontes: conectores com OAuth próprios, `fact_conversion_assets_daily` e `fact_deals` (migração `0003`), `ctx.rdMarketing`/`ctx.rdCrm` (§7.5). Detectors **intocados**. | Dados reais do piloto importados; mapper do Marketing corrigido para os nomes reais da API (`assets_type`/`conversion_count`) e o histórico re-normalizado a partir dos `raw_records`; testes/typecheck/lint/build verdes. |
| **Cross-source V1/V1.1** ✅ *(fora da sequência G)* | Camada própria `analysis/cross-source/` (§8.5) + período explícito no `AnalysisContext` (§7.5) + persistência `cross_source_insights` (migração `0004`) + `generateCrossSourceInsights`/`getCrossSourceInsights`. INV-2/4/5 revistas; INV-16…18 novas. Engine, detectors, gates, scoring, enrichment, sync e `/diagnostico` **intocados**. | **450 testes** (+7 de integração opt-in contra o Postgres real: os 6 somente-leitura passam; o do store, numa transação que sempre dá rollback, só roda com `CROSS_SOURCE_DB_WRITE_TEST=1`); `pnpm typecheck/lint/build` verdes; contexto padrão, gates e detectors **idênticos** antes/depois (comparação com dado real); mutações temporárias de período, cobertura, persistência e arquitetura todas detectadas; 1º conjunto real persistido (01–04/10/2026, 8 insights) e 2ª geração idempotente (`unchanged: 8`). |
| **G7** ✅ *(fundação, sem LLM)* | Contrato do Advisor como construído (§9.7): `AdvisorContext` (`buildAdvisorContext` — composição pura sobre `insights` + `cross_source_insights`, no lugar de `buildAdvisorInput`), `AdvisorQuery`, `AdvisorResponse`, `AdvisorModel` + `DeterministicAdvisorModel`, `answerAdvisorQuery`, guard de saída ("número ∈ contexto"), comparação entre períodos, tela `/advisor`. `advisor_outputs` **não** criada (resposta efêmera). Flag `ADVISOR_ENABLED` (padrão `true`, §9.6). **Sem LLM.** Motor, detectors, gates, scoring, Cross-source, sync, `/diagnostico` e as fontes **intocados**. | **278 testes do Advisor** (contexto, comparação, serviço por intenção, segurança semântica em matriz cenário × intenção, guard, interface de modelo, arquitetura, UI); 48 mutações temporárias (14 de arquitetura, 34 de comportamento) todas detectadas; `typecheck`/`lint`/`build` verdes; **primeiro caso real** (01–04/10/2026) sobre os dados do piloto, só leitura, com os mesmos números do Cross-source persistido; as tabelas lidas com o mesmo fingerprint antes e depois. O LLM em si segue **não iniciado**. |
| **G7b** ✅ *(modelo de linguagem)* | `LlmAdvisorModel` sobre `LlmTransport` e o adaptador da Anthropic (`fetch`, **sem SDK**, §9.8); prompt `advisor-prompt-v2` (hierarquia da verdade, camadas, pergunta como dado não confiável); saída por **schema Zod** + JSON Schema nativo derivado dele; **guard estrito** (`validateLlmDraft`); projeção explícita do contexto + varredura de PII fail-closed; fallback determinístico com o motivo; log só de metadados; flag `ADVISOR_LLM_ENABLED` (padrão `false`) + `ANTHROPIC_API_KEY` opcional. Motor, detectors, gates, scoring, Cross-source, sync, `AnalysisContext`, fact tables, `/diagnostico`, schema e migrações **intocados**; nenhuma dependência nova. | Testes do Advisor + do LLM (provider em nível HTTP, schema, privacidade, guard estrito com uma violação provada por regra, serviço, semântica das camadas, prompts adversariais, configuração, arquitetura, UI); mutações temporárias todas detectadas; `typecheck`/`lint`/`build` verdes. Teste ao vivo (opt-in, banco real **somente leitura** + API real) em `advisor-llm-integration.test.ts`. |

---

## 13. Riscos críticos

| Risco | Severidade | Mitigação |
|---|---|---|
| **Developer token (Basic access) do Google Ads demora dias–semanas** e é externo | **Alta** — bloqueia G2+ | **G0b começa em paralelo ao G1.** Sem o token aprovado, G2/G3 não avançam. Enquanto isso, G1 (que não depende de Ads) roda. |
| **Forçar Google Ads em `fact_traffic_daily`** (dívida D-1 da análise) | **Alta** — estrutural | Travado: `platform` no G1, `fact_ad_performance_daily` no G3, `CanonicalBatch` no G1 (INV-10). |
| **Refactor do G1 quebrar o GA4** (núcleo validado pelo Márcio) | **Média** | Critério de sucesso do G1 = "output do GA4 byte-idêntico". Rodar `runAnalysis` antes/depois e comparar `insights`. INV-3. |
| **OAuth em modo Testing → refresh token expira ~7 dias** (GA4 **e** Ads no piloto) | **Média** | Publicar/verificar o app OAuth (remove o prazo) **ou** aceitar reconexão semanal documentada (`docs/ga4-setup.md` §7). Vale para as duas fontes. |
| **Sync inline sem fila** — 180d de Ads (`searchStream`) num único request pode aproximar timeout | **Média** | `searchStream` para 1 conta × 180d × dezenas de campanhas é rápido; se preciso, quebrar a janela em chunks (há precedente de paginação no GA4). **Fila/worker é V1.1**, não V1. |
| **`runAnalysis` acoplado a `runGa4Sync`** (dívida D-2) | ~~Média~~ **Resolvida no G4** | `runAnalysis` renomeado para `runWorkspaceAnalysis`; `run-sync.ts` chama por nome genérico, sem branch por provider (D-J, INV-15). |
| **Rotas OAuth `/api/oauth/ga4/*` hardcoded** (dívida D-3) | Baixa–média | G1 — rota dinâmica `/api/oauth/[provider]/*`, mecânico. |
| **Fuso/moeda GA4 ≠ Ads** para a mesma empresa | Baixa–média | Guardar por-fonte (`connection_properties`); alinhar janelas por data no fuso de cada conta; o enriquecimento compara Δ% **intra-fonte** — sem math cross-currency. |
| **`cost_micros` tratado como float** | Baixa | `numeric`, ÷ 1e6 explícito no mapping (§6.3). |
| **Correlação errada GA4-property ↔ Ads-account** (empresas diferentes no mesmo workspace) | Baixa (V1 single-tenant) | Campo `domain` soft-check + aviso; **não** constraint (INV-12). |
| **`getDiagnostico` recomputa contexto a cada page load** — mais caro com `ctx.ads` | Baixa | Aceito na V1; `analysis_runs` resumo é V1.1 (fora do escopo, §11). |
| **Detector novo de Ads entrar sem validação** | Média (produto) | INV-4 / D-T: cross-source na V1 é **só enriquecimento**. Detector autônomo → depois do rating cego + aprovação. |
| **IA calcular / inventar número** | Alta (produto) se mal feito | Fronteira física: INV-5..INV-9, `buildAdvisorInput` sem acesso a `fact_*`, teste "número ∈ input", feature-flag. |
| **Cross-source persistido envelhece** depois de um sync (não há gatilho de regeneração) | Média (produto) | `generated_at`/`schema_version` na tabela; decidir a política de regeneração antes do Advisor. Gerar é sempre explícito (INV-16). |
| **Advisor só responde com fatos para períodos com Cross-source gerado** (e o persistido pode estar velho) | Média (produto) | `no_data` + limitação bloqueante quando não há conjunto; `crossSource.generatedAt` em toda resposta; decidir a geração sob demanda e a política de regeneração (§9.7). |
| **LLM inventar número, moeda ou causa** (conectado em §9.8) | Alta (produto) se mal feito | Schema + guard **estrito** (INV-21/25): número só de evidência citada, sem número por extenso, sem conta implícita, sem plataforma ou moeda que o contexto não tem, hipótese ancorada; todas as limitações anexadas pelo serviço (o modelo não as cria nem as omite); fallback determinístico registrado; prompt versionado; chave própria (padrão `false`); avaliação ao vivo **antes** de ligar. **Limite conhecido:** o guard não prova uma frase qualitativa sem número — é a defesa do prompt, das camadas e da avaliação. |
| **Dado pessoal ou de cliente saindo para um terceiro (o provedor de LLM)** | Alta (privacidade) | Projeção explícita (campo novo não vai sem decisão), varredura de PII fail-closed (inclui a pergunta digitada), contexto só com agregados, log só de metadados, sem ferramentas nem acesso ao banco (INV-23/24). Custo/retenção dependem do plano do provedor — decisão do usuário. |
| **Custo e latência do LLM sem limite** | Média | Uma chamada por pergunta (≈8 mil tokens de entrada), sem retry, tempo limite configurável, o modelo nem é chamado sem dados. **Sem rate limit nem orçamento por workspace**; `maxDuration` não definido (hospedagem serverless com limite curto estoura). |
| **Histórico de CRM importado é parcial** (só negócios atualizados desde o 1º sync) | Baixa–média | `rdCrm.coverage.importedHistoryStartDate`; período que começa antes dele sai como `rd_crm_partial_imported_history` — nunca como histórico completo (INV-17). |

---

## 14. Rastreabilidade e onde retomar

- **G0–G6 concluídos.** G1 (infra multi-conector), G2 (OAuth + discovery Google Ads), G3 (extração campanha × dia + `fact_ad_performance_daily`), G4 (`runAnalysis` → `runWorkspaceAnalysis`, orquestração workspace-level explícita, `run-sync.ts` sem branch por provider, testes-guarda de arquitetura), G5 (`ctx.ads` no `AnalysisContext`, §7.4), G6 (`enrichWithAds`: Google Ads como evidência complementar em `traffic-volume-drop` de `Paid Search`, §8.4). Ver `PROJECT_STATE.md` §14.
- **Depois do G6 (fora da sequência G):** **RD-1** (RD Station Marketing e RD CRM como fontes, §7.5) e **Cross-source V1/V1.1** (período explícito no contexto, camada própria e persistência `cross_source_insights`, §8.5; INV-2/4/5 revistas e INV-16…18 novas em 2026-10-04). Primeiro conjunto real persistido: workspace piloto × 2026-10-01→2026-10-04 (8 insights; 2ª geração idempotente). Ver `PROJECT_STATE.md` §15.
- **G7 — fundação do Advisor concluída (2026-10-04, sem LLM):** `AdvisorContext`/`buildAdvisorContext` (composição pura sobre `insights` + `getCrossSourceInsights`, INV-5 preservada), `AdvisorQuery`, `AdvisorResponse`, `AdvisorModel` + `DeterministicAdvisorModel`, `answerAdvisorQuery`, guard de saída, comparação entre períodos e a tela `/advisor`. Ver §9.7 e `PROJECT_STATE.md` §16.
- **G7b — modelo de linguagem conectado (2026-10-04):** Anthropic via `fetch` (sem SDK) atrás de `AdvisorModel`/`LlmTransport`; `ADVISOR_LLM_ENABLED` (padrão `false`); projeção sem PII + varredura; schema Zod + guard estrito; fallback determinístico com o motivo; log de metadados. Ver §9.8 e `PROJECT_STATE.md` §17. **Falta:** a avaliação ao vivo repetida a cada mudança de prompt/modelo antes de ligar a flag para o usuário e as decisões em aberto de §9.7/§9.8.
- **Fechamento do Advisor V1 (2026-10-05):** **Advisor determinístico = pronto para entrega; Advisor LLM/Anthropic = implementado, desligado (`ADVISOR_LLM_ENABLED=false`); fallback e dados reais funcionando; nenhuma chamada paga à Anthropic.** Corrigidos: o formato de `*_deals_with_value` em `metric-not-computable` (`cross-source/integrity.ts`, lista explícita de métricas de dinheiro) e a pergunta livre com o LLM desligado (resumo determinístico dito como tal em vez de só `needs_model`). **Pendente de decisão do usuário:** regenerar o conjunto persistido de 01–04/10 para a linha corrigida chegar ao banco (1 linha muda, 7 iguais — medido em dry-run; escrita explícita, INV-16). Ver §9.8, "Fechamento".
- **Próximo:** decisões em aberto de §9.7 (geração/regeneração do Cross-source, leitura ao vivo do `AnalysisContext`, normalização da comparação, `advisor_outputs`, "Visão geral") e de §9.8 (limite de uso/orçamento, `maxDuration`, quando ligar a flag) — **não iniciados**, aguardam aprovação explícita. Pendências conhecidas, fora do escopo do G6: (a) renderizar `supportingEvidence` na UI (hoje só a frase acrescentada a `hypothesis` aparece no card); (b) uma janela anterior de Ads no `AdsContext`, pré-requisito para qualquer variação temporal do Google Ads.
- **Bloqueio externo ativo:** `GOOGLE_ADS_DEVELOPER_TOKEN` (Basic access, MCC) não está no ambiente — a extração real do Google Ads não roda até essa credencial existir. Código e testes offline prontos. **`fact_ad_performance_daily` segue com 0 linhas** → `ctx.ads = null` no ambiente real; o enriquecimento do G6 foi validado com fixtures e, em memória, sobre o insight real do GA4 — **ainda não com dado real de Ads**.
- **GA4 reconectado em 2026-09-22** após o refresh token expirar (modo OAuth Testing, ~7 dias) — sync real rodou com sucesso (129 linhas gravadas). Detalhes em `PROJECT_STATE.md` §14.
- **Regressão real de 2026-09-24 (workspace MS Server):** com o GA4 até 22/09 e o relógio em 24/09, o `analysisEnd` avançou de 20/09 para 22/09 (janela `current` 26/08–22/09); a queda do site ficou em ≈ −10,8%, **acima** do piso de materialidade de ~10%, e o `traffic-volume-drop:Paid Search` (−15,9% em Paid Search) **voltou a disparar**. **É comportamento pré-existente do detector reagindo à janela móvel ("no fio da navalha") — NÃO é mudança introduzida pelo G6:** o conteúdo persistido é idêntico à saída do pipeline sem enriquecimento e, com `ads = null`, `enrichWithAds` é no-op.
- Ao iniciar cada bloco Gn: reler §12 (critério de sucesso), §3 (invariantes) e o `PROJECT_STATE.md` (decisões da V0 em vigor).
- Quando um bloco Gn concluir, atualizar o `PROJECT_STATE.md` (§3 blocos, §11 limitações) e, se uma decisão mudar, este documento.

**Não fazer sem aprovação explícita:** alterar `traffic-volume-drop` (detector/gates/thresholds/severity/dedupe_key/firing); `#5`; detectores novos; `ad_group`/keyword/query no Google Ads; interface de chat; fila/cron; RLS; ligar a geração do Cross-source ao sync/engine sem decidir a política de regeneração; mudar o formato persistido de `cross_source_insights` sem subir `schema_version`; ligar `ADVISOR_LLM_ENABLED` para o usuário sem a avaliação ao vivo; mudar o prompt sem subir `ADVISOR_PROMPT_VERSION`; enfraquecer o guard estrito; enviar ao provedor qualquer campo fora da projeção; dar ao LLM ferramentas, memória, RAG ou acesso ao banco (INV-23); fazer o Advisor ler o `AnalysisContext`, gerar Cross-source ou escrever em qualquer tabela (INV-5, INV-20); alterar o formato do `AdvisorContext`/`AdvisorResponse` sem subir `ADVISOR_SCHEMA_VERSION`.
