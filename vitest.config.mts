import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Testes de unidade do servidor: motor de análise (D15) + conectores (G3).
 * Os módulos testados são puros ou dependem só de `@/env` — nenhum toca o
 * banco. `test.env` fornece valores dummy para o schema de `src/env.ts` (que
 * valida no import), como rede de segurança para qualquer teste de servidor
 * futuro; os testes do conector Google Ads mockam `@/env` diretamente para
 * alternar a presença do developer token por caso.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/server/**/*.test.ts"],
    environment: "node",
    env: {
      DATABASE_URL: "postgres://user:pass@localhost:5432/test",
      AUTH_SECRET: "test-auth-secret",
      GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
      APP_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  },
});
