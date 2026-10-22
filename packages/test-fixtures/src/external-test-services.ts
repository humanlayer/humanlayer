import Redis from 'ioredis'
import postgres from 'postgres'

export const TEST_SERVICE_COMPOSE_FILE = 'docker-compose.test.yml'
export const TEST_SERVICE_PROJECT_NAME = 'humanlayer-test'
export const TEST_POSTGRES_HOST = '127.0.0.1'
export const TEST_POSTGRES_PORT = 55432
export const TEST_POSTGRES_USER = 'postgres'
export const TEST_POSTGRES_PASSWORD = 'humanlayer_test_password'
export const TEST_POSTGRES_ADMIN_DATABASE = 'postgres'
export const TEST_ELECTRIC_PORT = 13030
export const TEST_ELECTRIC_SECRET = 'humanlayer_test_secret'
export const TEST_KV_PORT = 17000
export const TEST_DURABLE_STREAMS_PORT = 18642
export const TEST_POSTGRES_DATABASE_PLACEHOLDER = '{database}'

export type ExternalTestServicesConfig = {
	postgresAdminUrl: string
	postgresDatabaseUrlTemplate: string
	electricUrl: string
	electricSecret: string
	kvUrl: string
	durableStreamsOrigin: string
}

type EnvLike = Record<string, string | undefined>

export type ExternalTestServiceName = 'postgres' | 'electric' | 'redis' | 'durable-streams'

type WaitForExternalTestServicesOptions = {
	timeoutMs?: number
	intervalMs?: number
	/**
	 * Called once per service the first time it becomes ready, with the elapsed
	 * time since the wait started. Useful for profiling which service is the long
	 * pole during startup.
	 */
	onReady?: (service: ExternalTestServiceName, elapsedMs: number) => void
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

const DEFAULT_EXTERNAL_TEST_SERVICES_CONFIG: ExternalTestServicesConfig = {
	postgresAdminUrl: `postgresql://${TEST_POSTGRES_USER}:${TEST_POSTGRES_PASSWORD}@${TEST_POSTGRES_HOST}:${TEST_POSTGRES_PORT}/${TEST_POSTGRES_ADMIN_DATABASE}`,
	postgresDatabaseUrlTemplate: `postgresql://${TEST_POSTGRES_USER}:${TEST_POSTGRES_PASSWORD}@${TEST_POSTGRES_HOST}:${TEST_POSTGRES_PORT}/${TEST_POSTGRES_DATABASE_PLACEHOLDER}`,
	electricUrl: `http://${TEST_POSTGRES_HOST}:${TEST_ELECTRIC_PORT}`,
	electricSecret: TEST_ELECTRIC_SECRET,
	kvUrl: `redis://${TEST_POSTGRES_HOST}:${TEST_KV_PORT}`,
	durableStreamsOrigin: `http://${TEST_POSTGRES_HOST}:${TEST_DURABLE_STREAMS_PORT}`,
}

export function getExternalTestServicesConfig(env: EnvLike = process.env): ExternalTestServicesConfig {
	const config: ExternalTestServicesConfig = {
		postgresAdminUrl:
			env.HUMANLAYER_TEST_POSTGRES_ADMIN_URL ?? DEFAULT_EXTERNAL_TEST_SERVICES_CONFIG.postgresAdminUrl,
		postgresDatabaseUrlTemplate:
			env.HUMANLAYER_TEST_POSTGRES_DATABASE_URL_TEMPLATE ??
			DEFAULT_EXTERNAL_TEST_SERVICES_CONFIG.postgresDatabaseUrlTemplate,
		electricUrl: env.HUMANLAYER_TEST_ELECTRIC_URL ?? DEFAULT_EXTERNAL_TEST_SERVICES_CONFIG.electricUrl,
		electricSecret: env.HUMANLAYER_TEST_ELECTRIC_SECRET ?? DEFAULT_EXTERNAL_TEST_SERVICES_CONFIG.electricSecret,
		kvUrl: env.HUMANLAYER_TEST_KV_URL ?? DEFAULT_EXTERNAL_TEST_SERVICES_CONFIG.kvUrl,
		durableStreamsOrigin:
			env.HUMANLAYER_TEST_DURABLE_STREAMS_ORIGIN ?? DEFAULT_EXTERNAL_TEST_SERVICES_CONFIG.durableStreamsOrigin,
	}

	validateExternalTestServicesConfig(config)

	return config
}

export function validateExternalTestServicesConfig(config: ExternalTestServicesConfig): void {
	assertValidUrl('HUMANLAYER_TEST_POSTGRES_ADMIN_URL', config.postgresAdminUrl)
	assertValidUrl('HUMANLAYER_TEST_ELECTRIC_URL', config.electricUrl)
	assertValidRedisUrl('HUMANLAYER_TEST_KV_URL', config.kvUrl)
	assertValidUrl('HUMANLAYER_TEST_DURABLE_STREAMS_ORIGIN', config.durableStreamsOrigin)

	if (!config.postgresDatabaseUrlTemplate.includes(TEST_POSTGRES_DATABASE_PLACEHOLDER)) {
		throw new Error('HUMANLAYER_TEST_POSTGRES_DATABASE_URL_TEMPLATE must include the {database} placeholder.')
	}

	if (!config.electricSecret) {
		throw new Error('HUMANLAYER_TEST_ELECTRIC_SECRET must not be empty.')
	}
}

function assertValidUrl(name: string, value: string): void {
	try {
		new URL(value)
	} catch (error) {
		throw new Error(`${name} must be a valid URL. ${(error as Error).message}`)
	}
}

function assertValidRedisUrl(name: string, value: string): void {
	let parsed: URL

	try {
		parsed = new URL(value)
	} catch (error) {
		throw new Error(`${name} must be a valid URL. ${(error as Error).message}`)
	}

	if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
		throw new Error(`${name} must use redis:// or rediss:// scheme.`)
	}
}

export function formatPostgresDatabaseUrl(config: ExternalTestServicesConfig, databaseName: string): string {
	return config.postgresDatabaseUrlTemplate.replace(TEST_POSTGRES_DATABASE_PLACEHOLDER, databaseName)
}

export function getExternalTestServicesElectricShapeUrl(config: ExternalTestServicesConfig): string {
	return new URL('/v1/shape', config.electricUrl).toString()
}

export function getExternalTestServicesComposeArgs(args: string[] = [], env: EnvLike = process.env): string[] {
	return [
		'docker',
		'compose',
		'--env-file',
		'/dev/null',
		'-f',
		TEST_SERVICE_COMPOSE_FILE,
		'-p',
		env.HUMANLAYER_TEST_COMPOSE_PROJECT ?? TEST_SERVICE_PROJECT_NAME,
		...args,
	]
}

export function getExternalTestServicesRecoveryCommands(): {
	up: string
	down: string
	logs: string
} {
	return {
		up: getExternalTestServicesComposeArgs(['up', '-d']).join(' '),
		down: getExternalTestServicesComposeArgs(['down', '-v']).join(' '),
		logs: getExternalTestServicesComposeArgs(['logs', '-f']).join(' '),
	}
}

export function formatExternalTestServicesError(
	message: string,
	config: ExternalTestServicesConfig = getExternalTestServicesConfig(),
): string {
	const commands = getExternalTestServicesRecoveryCommands()

	return [
		'External test services are unavailable.',
		message,
		'',
		'Expected configuration:',
		`- Postgres admin URL: ${config.postgresAdminUrl}`,
		`- Postgres database URL template: ${config.postgresDatabaseUrlTemplate}`,
		`- Electric URL: ${config.electricUrl}`,
		`- Redis URL: ${config.kvUrl}`,
		`- Durable Streams origin: ${config.durableStreamsOrigin}`,
		'',
		'Recovery commands:',
		`- ${commands.up}`,
		`- ${commands.down}`,
		`- ${commands.logs}`,
	].join('\n')
}

async function checkPostgresReady(config: ExternalTestServicesConfig): Promise<void> {
	const sql = postgres(config.postgresAdminUrl, {
		max: 1,
		connect_timeout: 3,
		idle_timeout: 1,
	})

	try {
		await sql`select 1`
	} catch (error) {
		throw new Error(
			formatExternalTestServicesError(
				`Postgres did not accept connections at ${config.postgresAdminUrl}. ${(error as Error).message}`,
				config,
			),
		)
	} finally {
		await sql.end({ timeout: 1 })
	}
}

async function checkElectricReady(config: ExternalTestServicesConfig): Promise<void> {
	let response: Response

	try {
		response = await fetch(`${config.electricUrl}/v1/health`, {
			signal: AbortSignal.timeout(3_000),
		})
	} catch (error) {
		throw new Error(
			formatExternalTestServicesError(
				`Electric did not respond at ${config.electricUrl}/v1/health. ${(error as Error).message}`,
				config,
			),
		)
	}

	if (response.status !== 200 && response.status !== 202) {
		const body = await response.text().catch(() => '')

		throw new Error(
			formatExternalTestServicesError(
				`Electric healthcheck returned ${response.status}${body ? `: ${body}` : ''}`,
				config,
			),
		)
	}
}

async function checkRedisReady(config: ExternalTestServicesConfig): Promise<void> {
	const redis = new Redis(config.kvUrl, {
		lazyConnect: true,
		connectTimeout: 2000,
		maxRetriesPerRequest: 1,
		enableOfflineQueue: false,
	})

	try {
		await redis.connect()
		await redis.set('test:standalone-ready', '1', 'EX', '10')
		await redis.get('test:standalone-ready')
		await redis.del('test:standalone-ready')
	} catch (error) {
		throw new Error(
			formatExternalTestServicesError(`Redis not ready at ${config.kvUrl}. ${(error as Error).message}`, config),
		)
	} finally {
		if (redis.status === 'ready') await redis.quit()
		else redis.disconnect()
	}
}

async function checkDurableStreamsReady(config: ExternalTestServicesConfig): Promise<void> {
	const readyUrl = `${config.durableStreamsOrigin}/readyz`
	try {
		const response = await fetch(readyUrl, { signal: AbortSignal.timeout(3_000) })
		if (response.ok) return
		throw new Error(`HTTP ${response.status}`)
	} catch (error) {
		throw new Error(
			formatExternalTestServicesError(
				`Durable Streams did not become ready at ${readyUrl}. ${(error as Error).message}`,
				config,
			),
		)
	}
}

const EXTERNAL_TEST_SERVICE_CHECKS: ReadonlyArray<{
	name: ExternalTestServiceName
	check: (config: ExternalTestServicesConfig) => Promise<void>
}> = [
	{ name: 'postgres', check: checkPostgresReady },
	{ name: 'electric', check: checkElectricReady },
	{ name: 'redis', check: checkRedisReady },
	{ name: 'durable-streams', check: checkDurableStreamsReady },
]

export async function verifyExternalTestServices(config: ExternalTestServicesConfig): Promise<void> {
	validateExternalTestServicesConfig(config)

	for (const { check } of EXTERNAL_TEST_SERVICE_CHECKS) {
		await check(config)
	}
}

export async function waitForExternalTestServices(
	config: ExternalTestServicesConfig,
	options: WaitForExternalTestServicesOptions = {},
): Promise<void> {
	// Electric boots in 1.5s locally but has taken 13s on a good CI runner and over 30s on a slow one.
	const timeoutMs = options.timeoutMs ?? 120_000
	const intervalMs = options.intervalMs ?? 500
	const startedAt = Date.now()
	let lastError: Error | null = null

	// Track which services are still pending so each can be reported ready
	// independently (helps profile which service is the long pole).
	const pending = new Map(EXTERNAL_TEST_SERVICE_CHECKS.map(({ name, check }) => [name, check]))

	validateExternalTestServicesConfig(config)

	while (Date.now() - startedAt < timeoutMs) {
		// Checks are ordered by dependency (electric needs postgres), so stop at
		// the first not-yet-ready service this round rather than waste time on
		// dependents that cannot be ready yet.
		for (const [name, check] of [...pending]) {
			try {
				await check(config)
				pending.delete(name)
				options.onReady?.(name, Date.now() - startedAt)
			} catch (error) {
				lastError = error as Error
				break
			}
		}

		if (pending.size === 0) {
			return
		}

		await delay(intervalMs)
	}

	throw new Error(lastError?.message ?? formatExternalTestServicesError('Timed out waiting for services.', config))
}
