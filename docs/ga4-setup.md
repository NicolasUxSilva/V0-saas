# Conectar uma propriedade GA4 real — checklist

> Guia operacional para ligar o v0-saas a um Google Analytics 4 real (bloco D0).
> Cobre o Google Cloud, as variáveis de ambiente, a pré-qualificação da
> propriedade-piloto e o passo a passo dentro da aplicação.
>
> Plano e decisões: [`v0-plan.md`](v0-plan.md). Estado atual: [`../PROJECT_STATE.md`](../PROJECT_STATE.md).

---

## 0. Quando usar este guia

- Primeira conexão de um GA4 (o seu, para o teste F1–F9, ou o da empresa-piloto).
- Depois que o **refresh token expirar** (modo Testing do Google: ~7 dias) — nesse
  caso, pule para a [Parte 4](#parte-4--fluxo-dentro-da-aplicação) e reconecte.

A V0 roda em `localhost:3000`. Não há deploy.

---

## 1. Pré-requisitos

| Requisito | Detalhe |
|---|---|
| Conta Google | Com acesso a **pelo menos uma propriedade GA4** (não Universal Analytics). |
| Papel na propriedade | **Viewer** basta para ler relatórios; **Editor/Administrador** ajuda a conferir/marcar key events. |
| Projeto no Google Cloud | Um projeto onde você possa habilitar APIs e criar credenciais OAuth. |
| Node 24+ e Corepack | `corepack enable` (o projeto usa pnpm via Corepack). |
| Banco Neon | `DATABASE_URL` já preenchida no `.env.local` (bloco A1). |

---

## 2. Parte 1 — Google Cloud

### 2.1 Projeto e APIs

1. Google Cloud Console → selecione (ou crie) um projeto.
2. **APIs & Services → Library** → habilite as **duas**:
   - **Google Analytics Data API** — relatórios (`runReport`).
   - **Google Analytics Admin API** — descoberta de propriedades (`accountSummaries.list`) e fuso/moeda.
3. Sem a Admin API, a conexão salva mas a listagem de propriedades falha
   (`ga4_error=discovery_failed`). Sem a Data API, o sync falha.

### 2.2 OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**. Publishing status: deixe em **Testing**.
3. Em **Test users**, adicione **todas** as contas Google que vão autorizar
   (a sua e a da empresa-piloto). Fora dessa lista o Google bloqueia o consentimento.
4. Em **Scopes**, adicione o escopo sensível:
   `https://www.googleapis.com/auth/analytics.readonly`.
   (`openid` e `email` são não-sensíveis e usados só para identificar a conta.)

> ⚠️ **Prazo do modo Testing:** o refresh token de um escopo sensível para test
> user **expira em ~7 dias**. Durante a V0, reconecte o GA4 quando isso acontecer
> (a tela de Conexões passa a mostrar "Reautorização necessária"). Publicar/
> verificar o app remove o prazo, mas não é necessário para a V0.

### 2.3 OAuth Client (Web)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — adicione as **duas** (um client, dois fluxos):

   | URI | Fluxo |
   |---|---|
   | `http://localhost:3000/api/auth/callback/google` | Login da aplicação (Auth.js) |
   | `http://localhost:3000/api/oauth/ga4/callback` | Conexão de dados do GA4 |

4. Copie o **Client ID** e o **Client secret**.

O mesmo client atende login e dados, com escopos separados: login pede
`openid email profile`; a conexão GA4 pede `openid email analytics.readonly`
com `access_type=offline` e `prompt=consent`.

---

## 3. Parte 2 — variáveis de ambiente

No `.env.local` (não versionado; referência em [`../.env.example`](../.env.example)):

| Variável | Valor | Origem |
|---|---|---|
| `DATABASE_URL` | string de conexão **direta** do Neon (sem `-pooler`) | painel do Neon |
| `AUTH_SECRET` | `openssl rand -base64 32` | gerado localmente |
| `AUTH_URL` | `http://localhost:3000` | fixo em dev |
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID do passo 2.3 | Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client secret do passo 2.3 | Google Cloud |
| `GA4_REDIRECT_URI` | `http://localhost:3000/api/oauth/ga4/callback` | tem de bater com o redirect URI cadastrado |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` (decodifica p/ 32 bytes) | gerado localmente |
| `USE_MOCK` | `false` para ver os insights reais; `true` volta ao mock da UI | — |

`src/env.ts` valida tudo por Zod no boot — falta ou formato errado derruba a app
com mensagem apontando o campo. Reinicie o `pnpm dev` após editar o `.env.local`.

> ⚠️ Trocar `APP_ENCRYPTION_KEY` torna ilegíveis os tokens já cifrados no banco —
> seria preciso reconectar o GA4. Não gere uma nova a menos que seja intencional.

---

## 4. Parte 3 — pré-qualificar a propriedade

O motor tem gates rígidos (plano §7.2). Uma propriedade pequena demais faz o
diagnóstico ficar em silêncio ou só com `data_quality` — resultado válido, mas
que não valida a tese. Antes do teste real, confira:

| Critério | Alvo | Por quê |
|---|---|---|
| Volume de sessões | ≳ **2–3 mil/mês** (ideal ≥ 500/janela de 28d, ≥ 200 por segmento) | G1 (volume mínimo) |
| Histórico coletado | ≥ **150 de 180 dias** com dados; janelas atual e anterior com ≥ 26/28 dias | G0 (disponibilidade) |
| Key events | **recomendado, não obrigatório**: ≥ 1 evento-chave ativo com ocorrências | sem eles, `conversion-efficiency-drop` fica suprimido e o diagnóstico se limita a volume + qualidade — a propriedade **continua elegível** e o motor emite um insight de qualidade explicando a limitação (a família de conversão foi suprimida) |
| Atribuição | `(not set)` + `(direct)` **< 40%** das sessões | acima disso, G4 suprime insights de canal/origem |

Onde olhar no GA4: **Relatórios → Aquisição** (volume por canal), **Admin →
Eventos / Conversões** (key events), **Explorações** para conferir os números
depois (auditoria numérica, plano §12-A).

> A propriedade-piloto atual (`properties/306062786`, MS Server) **não tem key
> events configurados** — decisão registrada de aceitar a ausência nesta V0. O
> motor a trata como "sem dados de conversão", não como erro.

---

## 5. Parte 4 — fluxo dentro da aplicação

```
pnpm install
pnpm dev            # http://localhost:3000
```

1. **Login** — abra `http://localhost:3000`, "Entrar com Google" com uma conta
   **test user**. No 1º acesso são criados `users` + `workspaces` +
   `workspace_members(owner)` e você cai em `/diagnostico`.
2. **Conexões** — menu lateral → **Conexões** → **Conectar GA4**.
3. **Consentimento Google** — aprove o acesso `analytics.readonly`. O callback
   cifra os tokens, faz upsert em `connections` e descobre as propriedades.
   Volta para `/conexoes` com um aviso de sucesso (`?ga4_connected=1`).
4. **Selecionar propriedade** — escolha a propriedade a analisar (radio). A
   seleção persiste (`connection_properties.is_selected`); fuso e moeda são
   buscados da Admin API. Se só houver 1 propriedade, ela já vem selecionada.
5. **Atualizar dados** — botão na tela de Conexões. Roda o sync inline:
   `runReport` dos últimos 180 dias → `raw_records` → `fact_traffic_daily`
   (upsert idempotente) → `sync_runs` com contagem. Pode levar até ~1 min.
   **No fim do sync, o motor de análise roda automaticamente** e grava `insights`.
6. **Diagnóstico** — menu lateral → **Diagnóstico**. Mostra os insights reais
   (ou o "estado honesto" com os números dos gates, se nada relevante) + as
   métricas de apoio da janela atual vs. anterior. Reconhecer / descartar /
   👍👎 por card persistem no banco.
7. **Reprocessar** — clicar "Atualizar dados" de novo é seguro: não duplica
   linhas (idempotência por `source_hash`) e cada análise substitui os insights
   `open` (os já reconhecidos/descartados são preservados).

---

## 6. Verificação rápida

| O quê | Como | Esperado |
|---|---|---|
| App sobe | `curl http://localhost:3000/api/health` | `{"status":"ok",...}` |
| Schema aplicado | `pnpm db:push` | `No changes detected` |
| Inspecionar dados | `pnpm db:studio` | ver tabelas abaixo |
| `connections` | 1 linha, `provider=ga4`, `status=connected`, `access_token_enc`/`refresh_token_enc` como `bytea`, `scopes` com `analytics.readonly` |
| `connection_properties` | ≥ 1 linha; exatamente 1 com `is_selected=true`, com `timezone`/`currency` |
| `sync_runs` | 1+ linhas; a inicial `success`, `rows_in`/`rows_written` preenchidos, `period_*` cobrindo ~180 dias |
| `fact_traffic_daily` | ~150–181 datas distintas; `sessions` > 0 |
| `insights` | 0+ linhas; se houver, todas com `evidence_json`, `confidence`, `gate_trace_json`, `priority_score` |

---

## 7. Limitações e prazos conhecidos

- **Refresh token de test user expira ~7 dias** (Google, modo Testing). Reconectar.
- **Janela de análise termina em D−2** (fuso da propriedade) — as últimas ~48h do
  GA4 são incompletas. O incremental re-puxa 3 dias para retificação de atribuição.
- **Sync inline, sem fila.** Uma propriedade muito grande pode chegar ao teto de
  `500.000` linhas por sync → `sync_runs.status='partial'`.
- **`raw_records` é append-only** (1 linha por página de `runReport`), sem poda na V0.
- **1 workspace, sem RLS.** Multi-tenant real é V1.
- **`/dev/states`** é uma rota de revisão (dev), não faz parte do produto.

---

## 8. Solução de problemas

### Códigos `ga4_error` (redirecionam para `/conexoes?ga4_error=...`)

| Código | Significado | Ação |
|---|---|---|
| `access_denied` | Você recusou o consentimento no Google. | Repetir e aprovar. |
| `missing_params` | Callback sem `code`/`state`. | Recomeçar pelo botão "Conectar GA4". |
| `invalid_state` | `state` inválido ou expirado (TTL 10 min). | Recomeçar; não deixar a aba parada no Google. |
| `workspace_mismatch` | O `state` não corresponde ao workspace da sessão. | Deslogar/relogar e reconectar. |
| `token_exchange_failed` | Falha ao trocar `code` por token. | Conferir `GOOGLE_OAUTH_CLIENT_SECRET` e o redirect URI cadastrado. |
| `no_refresh_token` | Google não devolveu refresh token. | Revogar o acesso em [myaccount.google.com/permissions](https://myaccount.google.com/permissions) e reconectar (força novo consentimento). |
| `persist_failed` | Erro ao gravar a conexão. | Ver logs; conferir `DATABASE_URL`. |
| `discovery_failed` | Conexão OK, listagem de propriedades falhou. | Habilitar a **Analytics Admin API** no projeto certo e reconectar. |

### Erros da Admin API / Data API (aparecem em `connections.last_error` ou no sync)

| Sintoma | Causa provável | Ação |
|---|---|---|
| `401 ... token inválido/expirado` | Access token venceu e o refresh falhou. | Reconectar (status vira `reauth_required`). |
| `403 ... API não habilitada, ou a conta não tem acesso a nenhuma propriedade GA4` | API desabilitada **ou** a conta não é de nenhuma propriedade GA4. | Habilitar a API; confirmar que a conta tem acesso a uma propriedade **GA4** (não UA). |
| `429` no sync | Quota da Data API. | O extractor faz backoff (3x); persistindo, o run fica `partial` — tentar de novo mais tarde. |
| Propriedades não listadas / lista vazia | Conta só tem Universal Analytics, ou sem acesso. | Criar/associar uma propriedade GA4. |
| Sync sem key events (tudo `0`) | A propriedade não tem eventos marcados como key event. | Marcar em **Admin → Eventos**; ou aceitar (o motor emite `data_quality`). |

### Sessão / login

- Loop de redirect para `/login`: `AUTH_SECRET` mudou (invalida sessões) ou
  `AUTH_URL` diferente de `http://localhost:3000`. Ajustar e relogar.
- "Entrar com Google" falha em `accounts.google.com`: `GOOGLE_OAUTH_CLIENT_ID`
  placeholder/errado, ou o redirect `/api/auth/callback/google` não cadastrado.
