/**
 * Cliente do banco (runtime).
 *
 * Metade runtime da camada de dados — usada a partir do bloco A2 (Auth.js,
 * criação de workspace) e adiante. Os comandos drizzle-kit (db:push / generate /
 * migrate) NÃO usam este arquivo; usam `drizzle.config.ts`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";

import * as schema from "./schema";

// `prepare: false` mantém a compatibilidade caso a DATABASE_URL passe a apontar
// para a conexão *pooled* do Neon no futuro. Sem custo relevante no volume da V0.
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });

export { schema };
