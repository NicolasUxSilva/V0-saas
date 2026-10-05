import { defineConfig } from "drizzle-kit";

import "./src/load-env";
import { env } from "./src/env";

/**
 * Configuração do drizzle-kit (migrações / push / studio).
 *
 * O schema real (9 tabelas da V0) é preenchido no bloco A1. No A0 o arquivo
 * `src/server/db/schema.ts` existe apenas para que esta config seja válida.
 *
 * A conectividade com o Neon é verificada com `pnpm db:push` no início do A1,
 * depois que a DATABASE_URL real for fornecida.
 */
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_URL },
  strict: true,
  verbose: true,
});
