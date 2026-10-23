import { sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

export async function getTxid(tx: PgDatabase<PostgresJsQueryResultHKT>): Promise<string> {
	const result = await tx.execute(sql`SELECT pg_current_xact_id()::text as txid`)
	return (result[0] as { txid: string }).txid
}
