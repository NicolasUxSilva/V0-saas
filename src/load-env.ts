/**
 * Carrega `.env.local` para `process.env`.
 *
 * O Next.js já faz isso sozinho em `next dev` / `next build`. Este módulo existe
 * para os comandos que rodam fora do Next — hoje, o `drizzle-kit` (db:push /
 * db:generate / db:studio), que executa `drizzle.config.ts` em Node puro.
 *
 * Importe-o ANTES de `./env` para que as variáveis existam quando o schema
 * de validação for avaliado.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
