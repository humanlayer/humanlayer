import { createHash } from 'node:crypto'

export type WorkOSResourceKind = 'redirectUri' | 'corsOrigin'

export type WorkOSOwnedResource = {
	id: string
	value: string
	ownershipFingerprint: string
	source: 'created' | 'reused'
}

export type WorkOSResourceState = {
	callbackUri: string
	corsOrigin: string
	appRedirectUri: string
	appCorsOrigin: string
	redirectUri?: WorkOSOwnedResource
	corsOriginResource?: WorkOSOwnedResource
	appRedirectUriResource?: WorkOSOwnedResource
	appCorsOriginResource?: WorkOSOwnedResource
	status: 'unconfigured' | 'missing' | 'healthy' | 'duplicate' | 'foreign' | 'stale' | 'partial'
	lastReconciledAt?: string
	details?: string[]
}

export type PostgresManifest = {
	composeProject: string
	postgresPort: number
	postgresPassword: string
	postgresVolume: string
	databaseUrl: string
	readReplicaDatabaseUrl: string
}

export type ApiManifest = {
	port: number
	route: string
	backend: string
}

export type ElectricManifest = {
	electricPort: number
	electricProxyPort: number
	electricSecret: string
	electricReplicationStreamId: string
	shapeUrl: string
	syncRoute: string
	proxyBackend: string
}

export type RivetManifest = {
	/** Legacy allocation retained to avoid a registry-wide port migration. */
	enginePort: number
	/** Port used by the local durable-streams-server. */
	servicesPort: number
	/** Legacy field name; stores the durable-streams-server data volume. */
	engineVolume: string
	durableStreamsOrigin: string
}

export type MinioManifest = {
	apiPort: number
	consolePort: number
	volume: string
	bucket: string
	accessKeyId: string
	secretAccessKey: string
	endpoint: string
}

export type RedisManifest = {
	port: number
	volume: string
	url: string
}

export type TestServicesManifest = {
	composeProject: string
	postgresPort: number
	postgresPassword: string
	postgresVolume: string
	electricPort: number
	electricSecret: string
	electricReplicationStreamId: string
	rivetEnginePort: number
	rivetServicesPort: number
	rivetEngineVolume: string
	redis: RedisManifest
}

export function createTestServicesManifest(input: {
	stackId: string
	composeProject: string
	postgresPort: number
	electricPort: number
	rivetEnginePort: number
	rivetServicesPort: number
	redisPort: number
	existing?: TestServicesManifest
}): TestServicesManifest {
	const project = `${input.composeProject}-test`
	return {
		composeProject: project,
		postgresPort: input.postgresPort,
		postgresPassword: input.existing?.postgresPassword ?? crypto.randomUUID(),
		postgresVolume: input.existing?.postgresVolume ?? `${project}-postgres`,
		electricPort: input.electricPort,
		electricSecret: input.existing?.electricSecret ?? crypto.randomUUID(),
		electricReplicationStreamId: createElectricReplicationStreamId(input.stackId, '_test'),
		rivetEnginePort: input.rivetEnginePort,
		rivetServicesPort: input.rivetServicesPort,
		// Do not reuse the former Rivet volume: its contents are not a Durable Streams store.
		rivetEngineVolume: `${project}-durable-streams`,
		redis: createRedisManifest({
			composeProject: project,
			port: input.redisPort,
			volume: redisVolumeFromManifest(input.existing?.redis),
		}),
	}
}

export function createRedisManifest(input: { composeProject: string; port: number; volume?: string }): RedisManifest {
	return {
		port: input.port,
		volume: input.volume ?? `${input.composeProject}-redis`,
		url: `redis://127.0.0.1:${input.port}`,
	}
}

export function redisPortFromManifest(redis: unknown): number | undefined {
	if (!redis || typeof redis !== 'object') return undefined
	const candidate = redis as { port?: unknown; dataPorts?: unknown }
	if (typeof candidate.port === 'number') return candidate.port
	if (Array.isArray(candidate.dataPorts) && typeof candidate.dataPorts[0] === 'number') return candidate.dataPorts[0]
	return undefined
}

export function redisVolumeFromManifest(redis: unknown): string | undefined {
	if (!redis || typeof redis !== 'object') return undefined
	const candidate = redis as { volume?: unknown; volumes?: unknown }
	if (typeof candidate.volume === 'string') return candidate.volume
	if (Array.isArray(candidate.volumes) && typeof candidate.volumes[0] === 'string') return candidate.volumes[0]
	return undefined
}

export function createMinioManifest(input: {
	composeProject: string
	apiPort: number
	consolePort: number
	volume?: string
	bucket?: string
	accessKeyId?: string
	secretAccessKey?: string
}): MinioManifest {
	return {
		apiPort: input.apiPort,
		consolePort: input.consolePort,
		volume: input.volume ?? `${input.composeProject}-minio`,
		bucket: input.bucket ?? 'riptide-artifacts',
		accessKeyId: input.accessKeyId ?? 'minioadmin',
		secretAccessKey: input.secretAccessKey ?? 'minioadmin',
		endpoint: `http://127.0.0.1:${input.apiPort}`,
	}
}

export function createRivetManifest(input: {
	composeProject: string
	enginePort: number
	servicesPort: number
	engineVolume?: string
}): RivetManifest {
	return {
		enginePort: input.enginePort,
		servicesPort: input.servicesPort,
		// Deterministically migrate existing stacks away from their incompatible Rivet volume.
		engineVolume: `${input.composeProject}-durable-streams`,
		durableStreamsOrigin: `http://127.0.0.1:${input.servicesPort}`,
	}
}

const MAX_ELECTRIC_REPLICATION_STREAM_ID_LENGTH = 42

export function createElectricReplicationStreamId(stackId: string, suffix = ''): string {
	const normalized = `${stackId.replaceAll('-', '_')}${suffix}`
	if (normalized.length <= MAX_ELECTRIC_REPLICATION_STREAM_ID_LENGTH) return normalized
	const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8)
	const prefixLength = MAX_ELECTRIC_REPLICATION_STREAM_ID_LENGTH - hash.length - 1
	return `${normalized.slice(0, prefixLength)}_${hash}`
}

export function createElectricManifest(input: {
	stackId: string
	electricPort: number
	electricProxyPort: number
	electricSecret?: string
}): ElectricManifest {
	return {
		electricPort: input.electricPort,
		electricProxyPort: input.electricProxyPort,
		electricSecret: input.electricSecret ?? crypto.randomUUID(),
		electricReplicationStreamId: createElectricReplicationStreamId(input.stackId),
		shapeUrl: `http://127.0.0.1:${input.electricPort}/v1/shape`,
		syncRoute: `https://sync.${input.stackId}.localhost`,
		proxyBackend: `127.0.0.1:${input.electricProxyPort}`,
	}
}

export function createApiManifest(apiPort: number, apiRoute: string): ApiManifest {
	return { port: apiPort, route: apiRoute, backend: `127.0.0.1:${apiPort}` }
}

export type OrganizationSeedDefaults = {
	id: string
	workosOrganizationId: string
	name: string
}

export function createPostgresManifest(input: {
	composeProject: string
	postgresPort: number
	postgresPassword?: string
	postgresVolume?: string
}): PostgresManifest {
	const postgresPassword = input.postgresPassword ?? crypto.randomUUID()
	const postgresVolume = input.postgresVolume ?? `${input.composeProject}-postgres`
	const encodedPassword = encodeURIComponent(postgresPassword)
	const databaseUrl = `postgresql://postgres:${encodedPassword}@127.0.0.1:${input.postgresPort}/electric`
	return {
		composeProject: input.composeProject,
		postgresPort: input.postgresPort,
		postgresPassword,
		postgresVolume,
		databaseUrl,
		readReplicaDatabaseUrl: databaseUrl,
	}
}

export function createWorkOSResourceState(stackId: string): WorkOSResourceState {
	const corsOrigin = `https://cloud.${stackId}.localhost`
	const appCorsOrigin = `https://app.${stackId}.localhost`
	return {
		callbackUri: `${corsOrigin}/auth/callback`,
		corsOrigin,
		appRedirectUri: appCorsOrigin,
		appCorsOrigin,
		status: 'unconfigured',
	}
}
