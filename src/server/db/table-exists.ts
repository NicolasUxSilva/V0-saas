/**
 * A tabela existe neste banco? Para código que precisa conviver com uma migração
 * aditiva ainda não aplicada (ex.: `fact_ad_entity_daily`, migração 0005) sem quebrar.
 */
import { sql } from "drizzle-orm";

import { db } from "@/server/db";

export async function tableExists(table: string): Promise<boolean> {
  const rows = await db.execute<{ t: string | null }>(
    sql`select to_regclass(${`public.${table}`})::text as t`,
  );
  return Boolean(rows[0]?.t);
}
