import { z } from "zod";

/**
 * Validação de variáveis de ambiente.
 *
 * Qualquer módulo que importe `env` falha imediatamente, com mensagem clara,
 * se uma variável obrigatória estiver ausente ou malformada.
 *
 * As chaves são adicionadas a este schema no bloco em que passam a ser usadas —
 * nunca antes (regra: nada fora do escopo do bloco atual). A referência completa
 * fica em `.env.example`.
 */

const isPostgresUrl = (v: string) =>
  v.startsWith("postgres://") || v.startsWith("postgresql://");

/** `VAR=` (vazio) no `.env.local` vale como ausente — só para as chaves do Advisor LLM. */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // [A1] String de conexão Postgres (Neon). Usada por drizzle-kit e pelo
  // cliente do banco. Ex.: postgresql://user:pass@host/db?sslmode=require
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL é obrigatória")
    .refine(
      isPostgresUrl,
      "DATABASE_URL deve começar com postgres:// ou postgresql://",
    ),

  // [A2] Auth.js — segredo de assinatura da sessão JWT. openssl rand -base64 32
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET é obrigatória (openssl rand -base64 32)"),

  // [A2] URL base da aplicação — usada pelo Auth.js para montar os callbacks.
  AUTH_URL: z.string().url().default("http://localhost:3000"),

  // [B1] Redirect do fluxo de dados GA4 (separado do redirect de login do Auth.js).
  // Precisa estar cadastrado como Authorized redirect URI no mesmo OAuth Client.
  GA4_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/api/oauth/ga4/callback"),

  // [A2] OAuth Client (Web) do Google Cloud. O MESMO client é reutilizado no
  // bloco B1 para o fluxo de dados do GA4 e no G2 para o Google Ads, com scopes
  // distintos e separados.
  GOOGLE_OAUTH_CLIENT_ID: z
    .string()
    .min(1, "GOOGLE_OAUTH_CLIENT_ID é obrigatória (Google Cloud Console)"),
  GOOGLE_OAUTH_CLIENT_SECRET: z
    .string()
    .min(1, "GOOGLE_OAUTH_CLIENT_SECRET é obrigatória (Google Cloud Console)"),

  // [G2] Google Ads API — developer token (Basic access) de uma conta Manager
  // (MCC). Necessário em TODA chamada à Google Ads API, inclusive a descoberta
  // de contas. OPCIONAL: sem ele o app sobe e o GA4 funciona normal; a conexão
  // do Google Ads existe mas a discovery falha com mensagem clara. Ver
  // docs/v1-architecture.md §10.1 / §13.
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(1).optional(),

  // [G2] `login-customer-id` (id do MCC, só dígitos) usado no header ao acessar
  // uma conta-cliente via Manager. OPCIONAL: sem ele a discovery tenta acesso
  // direto. Pode ser sobrescrito por `AccessContext.meta.loginCustomerId`.
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z
    .string()
    .regex(/^\d{6,}$/, "GOOGLE_ADS_LOGIN_CUSTOMER_ID deve conter só dígitos")
    .optional(),

  // [B0] Chave AES-256-GCM para cifrar tokens OAuth de terceiros em repouso.
  // 32 bytes em base64. openssl rand -base64 32
  APP_ENCRYPTION_KEY: z
    .string()
    .min(1, "APP_ENCRYPTION_KEY é obrigatória (openssl rand -base64 32)")
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "APP_ENCRYPTION_KEY deve decodificar para exatamente 32 bytes",
    ),

  // [A4 → C5] Alterna a UI entre dados mockados (true) e dados reais (false).
  USE_MOCK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // [RD-1] RD Station Marketing — credenciais do app criado no App Publisher
  // (produto "RD Station Marketing"). OPCIONAL: sem elas o app sobe normal;
  // só conectar/sincronizar o Marketing falha, com mensagem clara. O redirect
  // URI é o padrão genérico `${AUTH_URL}/api/oauth/rd_station_marketing/callback`
  // (mesmo mecanismo do Google Ads — sem env dedicada). Ver
  // docs/v1-architecture.md §10 (RD Station) e o relatório do RD-1.
  RD_MARKETING_CLIENT_ID: z.string().min(1).optional(),
  RD_MARKETING_CLIENT_SECRET: z.string().min(1).optional(),

  // [RD-1] RD Station CRM — credenciais de um app SEPARADO (produto "RD
  // Station CRM"; OAuth/host/token diferentes do Marketing). OPCIONAL, mesma
  // semântica acima. Redirect URI padrão:
  // `${AUTH_URL}/api/oauth/rd_station_crm/callback`.
  RD_CRM_CLIENT_ID: z.string().min(1).optional(),
  RD_CRM_CLIENT_SECRET: z.string().min(1).optional(),

  // [Advisor] Liga/desliga o Advisor (INV-8: o produto funciona 100% sem ele).
  // Padrão `true` porque o Advisor desta fase é determinístico e só lê dados já
  // calculados — não chama nenhum LLM nem escreve nada. Quando um modelo de
  // linguagem for conectado ele terá uma chave PRÓPRIA (padrão `false`).
  ADVISOR_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // [Advisor LLM] Liga/desliga o MODELO DE LINGUAGEM do Advisor — chave PRÓPRIA,
  // separada de `ADVISOR_ENABLED`, com padrão `false`: ligar o Advisor não liga o
  // LLM. Desligado (ou sem credencial) o Advisor responde só com o modelo
  // determinístico — o produto nunca depende do provedor. O contexto calculado
  // (sem PII) é a ÚNICA coisa que sai para o provedor; ver docs/v1-architecture.md §9.8.
  ADVISOR_LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // [Advisor LLM] Credencial do provedor (Anthropic). OPCIONAL: ausente, o Advisor
  // cai no modelo determinístico e diz isso na resposta — nunca derruba o app.
  // Vazio (`ANTHROPIC_API_KEY=`) vale como ausente.
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // [Advisor LLM] Modelo, esforço de raciocínio e tempo limite da chamada. Os
  // modelos Claude 5 rejeitam `temperature`/`top_p`/`top_k`; o comportamento
  // analítico (baixa criatividade) vem do prompt, do schema e do guard, e o
  // `effort` só regula quanto o modelo pensa (latência × custo).
  ADVISOR_LLM_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default("claude-sonnet-5-5")),
  ADVISOR_LLM_EFFORT: z.preprocess(emptyToUndefined, z.enum(["low", "medium", "high"]).default("medium")),
  ADVISOR_LLM_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(5_000).max(300_000).default(90_000),
  ),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Variáveis de ambiente inválidas ou ausentes:\n${issues}\n\n` +
      `Copie .env.example para .env.local e preencha os valores.`,
  );
}

export const env = parsed.data;
