import postgres from 'postgres'

export async function checkPostgres(databaseUrl: string): Promise<void> {
	const sql = postgres(databaseUrl, { max: 1 })
	try {
		await sql`select 1`
	} finally {
		await sql.end()
	}
}

export async function waitForPostgres(
	databaseUrl: string,
	options: { timeoutMs?: number; intervalMs?: number; check?: (url: string) => Promise<void> } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 30_000
	const intervalMs = options.intervalMs ?? 500
	const check = options.check ?? checkPostgres
	const startedAt = Date.now()
	let lastError: unknown
	while (Date.now() - startedAt < timeoutMs) {
		try {
			await check(databaseUrl)
			return
		} catch (error) {
			lastError = error
			await new Promise((resolve) => setTimeout(resolve, intervalMs))
		}
	}
	throw new Error(
		`Postgres did not become ready within ${timeoutMs}ms at ${redactDatabaseUrl(databaseUrl)}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	)
}

export function redactDatabaseUrl(databaseUrl: string): string {
	const url = new URL(databaseUrl)
	if (!url.password) return url.toString()
	return databaseUrl.replace(`:${url.password}@`, ':***@')
}
