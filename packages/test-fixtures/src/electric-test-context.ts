/**
 * Electric Test Context Factory
 *
 * Provides a shared DB + Electric infrastructure that can support multiple proxy servers
 * for different users/orgs. This enables testing ACL scenarios where:
 * - User A creates a resource
 * - User B (same org) should/shouldn't see it based on ACL
 * - User C (different org) should never see it
 *
 * The proxy app creation is injected via `createProxyApp` to avoid a circular
 * dependency on @humanlayer/riptide-electric-proxy.
 */
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { applicationTables } from '@humanlayer/db/schema'
import { approvals, type NewApproval } from '@humanlayer/db/tables/approvals'
import { artifactComments, type NewArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { artifacts, type NewArtifact } from '@humanlayer/db/tables/artifacts'
import { conversationEvents, type NewConversationEvent } from '@humanlayer/db/tables/conversation-events'
import { diffComments, type NewDiffComment } from '@humanlayer/db/tables/diff-comments'
import { type NewOnlineHost, onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { type NewOrganization, organizations } from '@humanlayer/db/tables/organizations'
import { type NewSession, sessions } from '@humanlayer/db/tables/sessions'
import { type NewTaskOrganizationAcl, taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { type NewTaskUserAcl, taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { type NewTaskUserSettings, taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import {
	type NewTaskWorkspaceSetupForHost,
	taskWorkspaceSetupForHost,
} from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { type NewTask, tasks } from '@humanlayer/db/tables/tasks'
import type { DiffCommentAnchor } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import { and, eq, getTableName, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { hash } from 'ohash'
import postgres from 'postgres'

import { setupLiveQuery, waitForItem, type WaitOptions } from './collection-assertions'
import {
	createApprovalsCollection,
	createApprovalsV2Collection,
	createArtifactCommentsCollection,
	createArtifactCommentsV2Collection,
	createArtifactsCollection,
	createArtifactsMetadataCollection,
	createArtifactsMetadataV2Collection,
	createArtifactsV2Collection,
	createDaemonApprovalsCollection,
	createDaemonWorkspaceSetupCollection,
	createDiffCommentsV2Collection,
	createEventsCollection,
	createEventsV2Collection,
	createHostsCollection,
	createHostsV2Collection,
	createHostsV3Collection,
	createSessionsByHostCollection,
	createSessionsCollection,
	createSessionsV2Collection,
	createSharedArtifactCollection,
	createSharedArtifactCommentsCollection,
	createTaskArtifactsCollection,
	createTaskArtifactsV2Collection,
	createTaskOrgAclCollection,
	createTaskOrgAclV2Collection,
	createTasksCollection,
	createTasksV2Collection,
	createTaskUserAclCollection,
	createTaskUserAclV2Collection,
	createTaskUserSettingsCollection,
	createTaskUserSettingsV2Collection,
	createTaskWorkspaceSetupForHostV2Collection,
	type LiveQueryWrapped,
	wrapWithLiveQuery,
} from './collection-factories'
import { shutdownContainers, startContainers } from './docker'
import {
	type ExternalTestServicesConfig,
	formatPostgresDatabaseUrl,
	getExternalTestServicesConfig,
	getExternalTestServicesElectricShapeUrl,
	verifyExternalTestServices,
} from './external-test-services'
import { migrationsFolder } from './postgres'

// =============================================================================
// Types
// =============================================================================

export type TestUser = {
	userId: string
	displayName?: string
}

export type TestOrganization = {
	id: string
	workosOrganizationId: string
	name: string
}

/**
 * Auth context shape expected by proxy servers.
 * Matches SimpleAuthContext from riptide-electric-proxy.
 */
export type SimpleAuthContext = {
	userId: string
	organizationId: string
	hostId?: string
}

export type TestAuthContext = SimpleAuthContext & {
	displayName?: string
}

export type ProxyServer = {
	server: { port: number; stop: () => void }
	port: number
	authContext: TestAuthContext
	stop: () => void
}

export type ContainerConfig = {
	postgres: { port: number; password: string }
	electric: { port: number; secret: string }
}

export type TestServiceMode = 'external' | 'docker'

export type ElectricTestContextOptions = {
	/** Factory that creates and starts a proxy server. Required. */
	createProxyApp: CreateProxyAppFn
	serviceMode?: TestServiceMode
	resetDatabase?: boolean
	ports?: { postgres?: number; electric?: number }
	/** Skip container startup (for testing the fixtures themselves) */
	skipContainers?: boolean
}

type DockerServiceRuntime = {
	mode: 'docker'
	containerConfig: ContainerConfig
	postgresContainerId: string
	electricContainerId: string
	networkName: string
	postgresDatabaseUrl: string
	electricShapeUrl: string
	electricSecret: string
}

type ExternalServiceRuntime = {
	mode: 'external'
	config: ExternalTestServicesConfig
	postgresDatabaseUrl: string
	electricShapeUrl: string
	electricSecret: string
	containerConfig: ContainerConfig
	postgresContainerId: null
	electricContainerId: null
	networkName: null
}

type TestServiceRuntime = DockerServiceRuntime | ExternalServiceRuntime

/**
 * Factory function that creates and starts a proxy server.
 * Injected by consumers to avoid circular dependency on riptide-electric-proxy.
 */
export type CreateProxyAppFn = (config: {
	electricShapeUrl: string
	electricSecret: string
	testAuthContext: SimpleAuthContext
	db: PostgresJsDatabase
}) => { port: number | undefined; stop: () => void | Promise<void> }

export type ElectricSentinelResult<T> = {
	result: T
	sentinelId: string
}

type ElectricTransaction = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0]

/**
 * Commits a mutation and its visible sentinel atomically, then waits until
 * Electric has observed that commit before returning the mutation result.
 */
export async function withElectricSentinel<T>(
	db: PostgresJsDatabase,
	collection: LiveQueryWrapped,
	callback: (tx: ElectricTransaction) => Promise<ElectricSentinelResult<T>>,
	opts?: WaitOptions,
): Promise<T> {
	const { result, sentinelId } = await db.transaction(callback)
	await waitForItem(collection, sentinelId, opts)
	return result
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Pick a random port in the ephemeral range (49152-65535) to avoid collisions
 * when tests run in parallel.
 */
function getRandomPort(): number {
	return 49152 + Math.floor(Math.random() * 16383)
}

function createDefaultOrganization(seed: {
	id: string
	workos_organization_id: string
	name: string
}): TestOrganization {
	return {
		id: seed.id,
		workosOrganizationId: seed.workos_organization_id,
		name: seed.name,
	}
}

export async function resetElectricTestDatabase(db: PostgresJsDatabase): Promise<TestOrganization> {
	const tableNames = applicationTables.map((table) => getTableName(table))
	const truncateTargets = tableNames.map((name) => sql.raw(`"public"."${name}"`))

	if (truncateTargets.length > 0) {
		await db.execute(sql`TRUNCATE TABLE ${sql.join(truncateTargets, sql`, `)} RESTART IDENTITY CASCADE`)
	}

	const [defaultOrg] = await db
		.insert(organizations)
		.values({
			name: 'Default Test Org',
			workos_organization_id: `org_default_${randomUUID().slice(0, 8)}`,
		})
		.returning()

	if (!defaultOrg) throw new Error('Failed to create default organization')

	return createDefaultOrganization(defaultOrg)
}

async function createTestServiceRuntime(opts: ElectricTestContextOptions): Promise<TestServiceRuntime> {
	const serviceMode = opts.serviceMode ?? 'external'

	if (serviceMode === 'external') {
		const config = getExternalTestServicesConfig()
		await verifyExternalTestServices(config)

		const postgresDatabaseUrl = formatPostgresDatabaseUrl(config, 'electric')
		const electricShapeUrl = getExternalTestServicesElectricShapeUrl(config)
		const postgresUrl = new URL(postgresDatabaseUrl)
		const electricShape = new URL(electricShapeUrl)

		return {
			mode: 'external',
			config,
			postgresDatabaseUrl,
			electricShapeUrl,
			electricSecret: config.electricSecret,
			containerConfig: {
				postgres: {
					port: Number(postgresUrl.port || 5432),
					password: postgresUrl.password,
				},
				electric: {
					port: Number(electricShape.port || 80),
					secret: config.electricSecret,
				},
			},
			postgresContainerId: null,
			electricContainerId: null,
			networkName: null,
		}
	}

	const containerConfig: ContainerConfig = {
		postgres: {
			port: opts?.ports?.postgres ?? getRandomPort(),
			password: randomUUID(),
		},
		electric: {
			port: opts?.ports?.electric ?? getRandomPort(),
			secret: randomUUID(),
		},
	}

	let postgresContainerId = ''
	let electricContainerId = ''
	let networkName = ''

	if (!opts?.skipContainers) {
		const result = await startContainers(containerConfig)
		postgresContainerId = result.postgresContainerId
		electricContainerId = result.electricContainerId
		networkName = result.networkName
		containerConfig.postgres.port = result.postgresPort
		containerConfig.electric.port = result.electricPort
	}

	return {
		mode: 'docker',
		containerConfig,
		postgresContainerId,
		electricContainerId,
		networkName,
		postgresDatabaseUrl: `postgresql://postgres:${containerConfig.postgres.password}@127.0.0.1:${containerConfig.postgres.port}/electric`,
		electricShapeUrl: `http://127.0.0.1:${containerConfig.electric.port}/v1/shape`,
		electricSecret: containerConfig.electric.secret,
	}
}

export async function createElectricTestContext(opts: ElectricTestContextOptions) {
	const { createProxyApp } = opts
	const serviceRuntime = await createTestServiceRuntime(opts)

	// Connect to database using actual port
	const client = postgres(serviceRuntime.postgresDatabaseUrl, { max: 5 })
	const db = drizzle(client)

	await db.execute('CREATE SCHEMA IF NOT EXISTS "drizzle";')
	await migrate(db, { migrationsFolder })

	const defaultOrganization =
		opts.resetDatabase === false
			? await (async () => {
					const [defaultOrg] = await db.select().from(organizations).limit(1)
					if (!defaultOrg) {
						throw new Error('Expected a default test organization to exist when resetDatabase is false.')
					}
					return createDefaultOrganization(defaultOrg)
				})()
			: await resetElectricTestDatabase(db)

	// Server tracking
	const servers = new Map<string, ProxyServer>()

	// Collection tracking for cleanup
	const sourceCollections: Array<{ cleanup: () => Promise<void> }> = []
	const liveQueryCollections: Array<{ cleanup: () => Promise<void> }> = []

	// =============================================================================
	// Context Object
	// =============================================================================

	const context = {
		db,
		tables: {
			approvals,
			artifacts,
			onlineHosts,
			sessions,
			tasks,
			taskOrganizationAcl,
			taskUserAcl,
			taskUserSettings,
			diffComments,
		},
		withElectricSentinel: <T>(
			collection: LiveQueryWrapped,
			callback: (tx: ElectricTransaction) => Promise<ElectricSentinelResult<T>>,
			opts?: WaitOptions,
		) => withElectricSentinel(db, collection, callback, opts),
		serviceMode: serviceRuntime.mode,
		containerConfig: serviceRuntime.containerConfig,
		postgresContainerId: serviceRuntime.postgresContainerId,
		electricContainerId: serviceRuntime.electricContainerId,
		networkName: serviceRuntime.networkName,
		defaultOrganization,
		servers,

		// -------------------------------------------------------------------------
		// Server Management
		// -------------------------------------------------------------------------

		createProxyServer: ({
			user,
			organization,
			hostId,
			key,
		}: {
			user: TestUser
			organization: TestOrganization
			hostId?: string
			key?: string
		}) => {
			const serverKey = key ?? `${user.userId}:${organization.id}`

			const existing = servers.get(serverKey)
			if (existing) {
				return existing
			}

			const authContext: TestAuthContext = {
				userId: user.userId,
				organizationId: organization.id,
				hostId,
				displayName: user.displayName,
			}

			const server = createProxyApp({
				electricShapeUrl: serviceRuntime.electricShapeUrl,
				electricSecret: serviceRuntime.electricSecret,
				testAuthContext: authContext,
				db,
			})

			const port = server.port
			if (port === undefined) throw new Error('Failed to get assigned port from server')

			const proxyServer: ProxyServer = {
				server: { port, stop: () => server.stop() },
				port,
				authContext,
				stop: () => {
					void server.stop()
					servers.delete(serverKey)
				},
			}

			servers.set(serverKey, proxyServer)
			return proxyServer
		},

		getServer: (key: string) => servers.get(key),

		stopServer: (key: string) => {
			const server = servers.get(key)
			if (server) {
				server.stop()
			}
		},

		stopAllServers: () => {
			for (const [key, server] of servers) {
				server.server.stop()
				servers.delete(key)
			}
		},

		// -------------------------------------------------------------------------
		// Collection Factories (with automatic tracking for cleanup)
		// -------------------------------------------------------------------------

		createSessionsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createSessionsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createSessionsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createSessionsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createSessionsByHostCollection: async ({
			server,
			hostId,
			onError,
		}: {
			server: ProxyServer
			hostId: string
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createSessionsByHostCollection({ server, hostId, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTasksCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTasksCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTasksV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTasksV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createEventsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createEventsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createEventsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createEventsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createApprovalsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createApprovalsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createApprovalsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createApprovalsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createArtifactCommentsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createArtifactCommentsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createArtifactCommentsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createArtifactCommentsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createDiffCommentsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createDiffCommentsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createDaemonApprovalsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createDaemonApprovalsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createHostsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createHostsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection, (item) => item.host_id)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createArtifactsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createArtifactsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createArtifactsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createArtifactsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createArtifactsMetadataCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createArtifactsMetadataCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createArtifactsMetadataV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createArtifactsMetadataV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskArtifactsCollection: async ({
			server,
			taskId,
			onError,
		}: {
			server: ProxyServer
			taskId: string
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskArtifactsCollection({ server, taskId, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskArtifactsV2Collection: async ({
			server,
			taskId,
			onError,
		}: {
			server: ProxyServer
			taskId: string
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskArtifactsV2Collection({ server, taskId, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskUserSettingsCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskUserSettingsCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskUserSettingsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskUserSettingsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskWorkspaceSetupForHostV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskWorkspaceSetupForHostV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createDaemonWorkspaceSetupCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createDaemonWorkspaceSetupCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskOrgAclCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskOrgAclCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskOrgAclV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskOrgAclV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskUserAclCollection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskUserAclCollection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createTaskUserAclV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createTaskUserAclV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createHostsV2Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createHostsV2Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection, (item) => item.host_id)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createHostsV3Collection: async ({
			server,
			onError,
		}: {
			server: ProxyServer
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createHostsV3Collection({ server, onError })
			const liveQueryCollection = wrapWithLiveQuery(electricCollection, (item) =>
				JSON.stringify([item.host_id, item.organization_id, item.user_id]),
			)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createSharedArtifactCollection: async ({
			server,
			artifactId,
			shareKey,
			onError,
		}: {
			server: ProxyServer
			artifactId: string
			shareKey: string
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createSharedArtifactCollection({
				proxyPort: server.port,
				artifactId,
				shareKey,
				onError,
			})
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		createSharedArtifactCommentsCollection: async ({
			server,
			artifactId,
			shareKey,
			onError,
		}: {
			server: ProxyServer
			artifactId: string
			shareKey: string
			onError?: (err: unknown) => void
		}): Promise<LiveQueryWrapped> => {
			const electricCollection = createSharedArtifactCommentsCollection({
				proxyPort: server.port,
				artifactId,
				shareKey,
				onError,
			})
			const liveQueryCollection = wrapWithLiveQuery(electricCollection)
			await setupLiveQuery(electricCollection, liveQueryCollection)
			sourceCollections.push(electricCollection)
			liveQueryCollections.push(liveQueryCollection)
			return liveQueryCollection
		},

		// -------------------------------------------------------------------------
		// Organization Management
		// -------------------------------------------------------------------------

		seedOrganization: async (seedOpts: Partial<NewOrganization>) => {
			const [org] = await db
				.insert(organizations)
				.values({
					name: seedOpts?.name ?? `Test Org ${randomUUID().slice(0, 8)}`,
					workos_organization_id: seedOpts?.workos_organization_id ?? `org_${randomUUID().slice(0, 8)}`,
				})
				.returning()

			if (!org) throw new Error('Failed to create organization')

			return {
				id: org.id,
				workosOrganizationId: org.workos_organization_id,
				name: org.name,
			}
		},

		// -------------------------------------------------------------------------
		// Data Seeding
		// -------------------------------------------------------------------------

		seedTask: async (seedOpts: NewTask & { id?: string }) => {
			const [task] = await db
				.insert(tasks)
				.values({
					...(seedOpts.id ? { id: seedOpts.id } : {}),
					organization_id: seedOpts.organization_id,
					resource_owner_user_id: seedOpts.resource_owner_user_id,
					created_by: seedOpts.created_by ?? seedOpts.resource_owner_user_id,
					default_working_directory: seedOpts.default_working_directory ?? tmpdir(),
					setup_status: seedOpts.setup_status ?? 'completed',
					slug: seedOpts.slug,
					name: seedOpts.name ?? `Test Task ${randomUUID().slice(0, 8)}`,
					archived: seedOpts.archived ?? false,
				})
				.returning()

			if (!task) throw new Error('Failed to create task')
			return task
		},

		seedSession: async (seedOpts: NewSession) => {
			const [session] = await db.insert(sessions).values(seedOpts).returning()

			if (!session) throw new Error('Failed to create session')
			return session
		},

		seedConversationEvent: async (seedOpts: NewConversationEvent) => {
			const [event] = await db
				.insert(conversationEvents)
				.values({
					...seedOpts,
					event_type: seedOpts.event_type ?? 'message',
					role: seedOpts.role ?? 'user',
					content: seedOpts.content ?? 'Test event content',
				})
				.returning()

			if (!event) throw new Error('Failed to create conversation event')
			return event
		},

		seedArtifact: async (
			seedOpts: Omit<NewArtifact, 'created_by' | 'content_hash'> & {
				task_id: string
				task_slug: string | null
				file_name: string
				content: string
				resource_owner_user_id: string
				organization_id: string
			},
		) => {
			const contentHash = hash(seedOpts.content)

			const [artifact] = await db
				.insert(artifacts)
				.values({
					task_id: seedOpts.task_id,
					file_name: seedOpts.file_name,
					content: seedOpts.content,
					content_hash: contentHash,
					content_type: seedOpts.content_type,
					resource_owner_user_id: seedOpts.resource_owner_user_id,
					organization_id: seedOpts.organization_id,
					created_by: seedOpts.resource_owner_user_id,
					task_slug: seedOpts.task_slug,
					share_key: seedOpts.share_key,
					share_enabled: seedOpts.share_enabled,
					public_permission: seedOpts.public_permission,
				})
				.returning()

			if (!artifact) throw new Error('Failed to create artifact')
			return artifact
		},

		seedTaskUserAcl: async (seedOpts: NewTaskUserAcl) => {
			const [acl] = await db
				.insert(taskUserAcl)
				.values({
					task_id: seedOpts.task_id,
					subject_user_id: seedOpts.subject_user_id,
					organization_id: seedOpts.organization_id,
					resource_owner_user_id: seedOpts.resource_owner_user_id,
					permission_level: seedOpts.permission_level ?? 'read',
					granted_by: seedOpts.resource_owner_user_id,
				})
				.returning()

			if (!acl) throw new Error('Failed to create task user ACL')
			return acl
		},

		seedTaskUserSettings: async (seedOpts: NewTaskUserSettings) => {
			const [settings] = await db
				.insert(taskUserSettings)
				.values({
					task_id: seedOpts.task_id,
					user_id: seedOpts.user_id,
					organization_id: seedOpts.organization_id,
					working_directory: seedOpts.working_directory ?? null,
					host_id: seedOpts.host_id ?? null,
					auto_advance_questions_to_research: seedOpts.auto_advance_questions_to_research ?? false,
					auto_advance_research_to_design: seedOpts.auto_advance_research_to_design ?? false,
					auto_advance_plan_to_worktree: seedOpts.auto_advance_plan_to_worktree ?? false,
					auto_advance_worktree_to_implementation: seedOpts.auto_advance_worktree_to_implementation ?? false,
					auto_advance_implementation_to_pr: seedOpts.auto_advance_implementation_to_pr ?? false,
				})
				.returning()

			if (!settings) throw new Error('Failed to create task user settings')
			return settings
		},

		seedTaskWorkspaceSetupForHost: async (seedOpts: NewTaskWorkspaceSetupForHost) => {
			const [setup] = await db.insert(taskWorkspaceSetupForHost).values(seedOpts).returning()
			if (!setup) throw new Error('Failed to create task workspace setup row')
			return setup
		},

		seedTaskOrganizationAcl: async (seedOpts: NewTaskOrganizationAcl) => {
			const [acl] = await db
				.insert(taskOrganizationAcl)
				.values({
					task_id: seedOpts.task_id,
					organization_id: seedOpts.organization_id,
					resource_owner_user_id: seedOpts.resource_owner_user_id,
					permission_level: seedOpts.permission_level ?? 'read',
					granted_by: seedOpts.resource_owner_user_id,
				})
				.returning()

			if (!acl) throw new Error('Failed to create task organization ACL')
			return acl
		},

		seedApproval: async (seedOpts: NewApproval & { id?: string }) => {
			const [approval] = await db
				.insert(approvals)
				.values({
					...(seedOpts.id ? { id: seedOpts.id } : {}),
					session_id: seedOpts.session_id,
					organization_id: seedOpts.organization_id,
					user_id: seedOpts.user_id,
					host_id: seedOpts.host_id,
					resource_owner_user_id: seedOpts.resource_owner_user_id,
					task_id: seedOpts.task_id ?? null,
					tool_use_id: seedOpts.tool_use_id,
					status: seedOpts.status ?? 'pending',
					tool_name: seedOpts.tool_name,
					tool_input: seedOpts.tool_input,
				})
				.returning()

			if (!approval) throw new Error('Failed to create approval')
			return approval
		},

		seedArtifactComment: async (
			seedOpts: Pick<
				NewArtifactComment,
				| 'artifact_id'
				| 'task_id'
				| 'organization_id'
				| 'resource_owner_user_id'
				| 'created_by_user_id'
				| 'content_text'
			> & {
				reply_to_comment_id?: string | null
				commented_upon_block_text?: string | null
				previous_block_text?: string | null
				next_block_text?: string | null
				is_resolved?: boolean
				is_deleted?: boolean
			},
		) => {
			const [comment] = await db
				.insert(artifactComments)
				.values({
					artifact_id: seedOpts.artifact_id,
					task_id: seedOpts.task_id,
					organization_id: seedOpts.organization_id,
					resource_owner_user_id: seedOpts.resource_owner_user_id,
					created_by_user_id: seedOpts.created_by_user_id,
					content_text: seedOpts.content_text,
					reply_to_comment_id: seedOpts.reply_to_comment_id ?? null,
					commented_upon_block_text: seedOpts.commented_upon_block_text ?? null,
					previous_block_text: seedOpts.previous_block_text ?? null,
					next_block_text: seedOpts.next_block_text ?? null,
					is_resolved: seedOpts.is_resolved ?? false,
					is_deleted: seedOpts.is_deleted ?? false,
				})
				.returning()

			if (!comment) throw new Error('Failed to create artifact comment')
			return comment
		},

		seedDiffComment: async (seedOpts: NewDiffComment & { id?: string }) => {
			const [comment] = await db
				.insert(diffComments)
				.values({
					...seedOpts,
					reply_to_comment_id: seedOpts.reply_to_comment_id ?? null,
					anchor_json: seedOpts.anchor_json ?? null,
					is_resolved: seedOpts.is_resolved ?? false,
					is_deleted: seedOpts.is_deleted ?? false,
					created_by_agent: seedOpts.created_by_agent ?? false,
				})
				.returning()

			if (!comment) throw new Error('Failed to create diff comment')
			return comment
		},

		seedRepresentativeDiffComments: async (seedOpts: {
			task_id: string
			organization_id: string
			resource_owner_user_id: string
			created_by_user_id: string
			repoId?: string
		}) => {
			const base = {
				task_id: seedOpts.task_id,
				organization_id: seedOpts.organization_id,
				resource_owner_user_id: seedOpts.resource_owner_user_id,
				created_by_user_id: seedOpts.created_by_user_id,
			}
			const anchor = (overrides: Partial<DiffCommentAnchor> = {}): DiffCommentAnchor => ({
				v: 1,
				repoId: seedOpts.repoId ?? 'syncopate',
				path: 'src/current.ts',
				patchHash: 'current-patch',
				start: { side: 'old', line: 10 },
				end: { side: 'new', line: 14 },
				...overrides,
			})

			const root = await context.seedDiffComment({
				...base,
				content_text: 'Cross-side range root',
				anchor_json: anchor(),
			})
			const reply = await context.seedDiffComment({
				...base,
				content_text: 'Direct reply',
				reply_to_comment_id: root.id,
				created_by_agent: true,
			})
			const resolved = await context.seedDiffComment({
				...base,
				content_text: 'Resolved root',
				anchor_json: anchor({ patchHash: 'stale-patch' }),
				is_resolved: true,
			})
			const deleted = await context.seedDiffComment({
				...base,
				content_text: 'Deleted root',
				anchor_json: anchor({ path: 'src/renamed-before.ts' }),
				is_deleted: true,
			})
			const missing = await context.seedDiffComment({
				...base,
				content_text: 'Missing file root',
				anchor_json: anchor({ path: 'src/missing.ts' }),
			})

			return { root, reply, resolved, deleted, missing }
		},

		updateArtifactComment: async (commentId: string, updates: Partial<NewArtifactComment>) => {
			const [updated] = await db
				.update(artifactComments)
				.set(updates)
				.where(eq(artifactComments.id, commentId))
				.returning()
			if (!updated) throw new Error('Failed to update artifact comment')
			return updated
		},

		seedOnlineHost: async (seedOpts: NewOnlineHost) => {
			const [host] = await db
				.insert(onlineHosts)
				.values({
					host_id: seedOpts.host_id,
					user_id: seedOpts.user_id,
					organization_id: seedOpts.organization_id,
					host_name: seedOpts.host_name,
					last_seen: seedOpts.last_seen,
				})
				.returning()

			if (!host) throw new Error('Failed to create online host')
			return host
		},

		// -------------------------------------------------------------------------
		// Data Mutation
		// -------------------------------------------------------------------------

		updateSession: async (sessionId: string, updates: Partial<NewSession>) => {
			const [updated] = await db.update(sessions).set(updates).where(eq(sessions.id, sessionId)).returning()

			if (!updated) throw new Error('Failed to update session')
			return updated
		},

		updateApproval: async (approvalId: string, updates: Partial<NewApproval>) => {
			const [updated] = await db.update(approvals).set(updates).where(eq(approvals.id, approvalId)).returning()

			if (!updated) throw new Error('Failed to update approval')
			return updated
		},

		updateEvent: async (eventId: string, updates: Partial<NewConversationEvent>) => {
			const [updated] = await db
				.update(conversationEvents)
				.set(updates)
				.where(eq(conversationEvents.id, eventId))
				.returning()

			if (!updated) throw new Error('Failed to update event')
			return updated
		},

		deleteConversationEvent: async (eventId: string) => {
			await db.delete(conversationEvents).where(eq(conversationEvents.id, eventId))
		},

		deleteTaskUserAcl: async (aclId: string) => {
			await db.delete(taskUserAcl).where(eq(taskUserAcl.id, aclId))
		},

		deleteTaskUserSettings: async (settingsId: string) => {
			await db.delete(taskUserSettings).where(eq(taskUserSettings.id, settingsId))
		},

		deleteTaskOrganizationAcl: async (aclId: string) => {
			await db.delete(taskOrganizationAcl).where(eq(taskOrganizationAcl.id, aclId))
		},

		updateArtifact: async (artifactId: string, updates: Partial<NewArtifact>) => {
			const [updated] = await db.update(artifacts).set(updates).where(eq(artifacts.id, artifactId)).returning()
			if (!updated) throw new Error('Failed to update artifact')
			return updated
		},

		deleteArtifact: async (artifactId: string) => {
			await db.delete(artifacts).where(eq(artifacts.id, artifactId))
		},

		updateTask: async (taskId: string, updates: Partial<NewTask>) => {
			const [updated] = await db.update(tasks).set(updates).where(eq(tasks.id, taskId)).returning()
			if (!updated) throw new Error('Failed to update task')
			return updated
		},

		updateTaskWorkspaceSetupForHost: async (setupId: string, updates: Partial<NewTaskWorkspaceSetupForHost>) => {
			const [updated] = await db
				.update(taskWorkspaceSetupForHost)
				.set(updates)
				.where(eq(taskWorkspaceSetupForHost.id, setupId))
				.returning()
			if (!updated) throw new Error('Failed to update task workspace setup row')
			return updated
		},

		deleteSession: async (sessionId: string) => {
			await db.delete(sessions).where(eq(sessions.id, sessionId))
		},

		deleteTask: async (taskId: string) => {
			await db.delete(tasks).where(eq(tasks.id, taskId))
		},

		deleteOnlineHost: async (hostId: string, userId: string, organizationId: string) => {
			await db
				.delete(onlineHosts)
				.where(
					and(
						eq(onlineHosts.host_id, hostId),
						eq(onlineHosts.user_id, userId),
						eq(onlineHosts.organization_id, organizationId),
					),
				)
		},

		// -------------------------------------------------------------------------
		// Cleanup
		// -------------------------------------------------------------------------

		shutdown: async () => {
			context.stopAllServers()

			await Promise.allSettled(liveQueryCollections.map((c) => c.cleanup()))
			await Promise.allSettled(sourceCollections.map((c) => c.cleanup()))
			await client.end({ timeout: 1 })

			if (serviceRuntime.mode === 'docker' && !opts?.skipContainers) {
				await shutdownContainers({
					postgresContainerId: serviceRuntime.postgresContainerId,
					electricContainerId: serviceRuntime.electricContainerId,
					networkName: serviceRuntime.networkName,
				})
			}
		},
	}

	return context
}

// =============================================================================
// Test User Helpers
// =============================================================================

/** Create a test user with a unique ID */
export function createTestUser(name?: string): TestUser {
	const id = randomUUID().slice(0, 8)
	return {
		userId: `user_${name ?? id}`,
		displayName: name ?? `Test User ${id}`,
	}
}

/** Predefined test users for common scenarios */
export const TestUsers = {
	owner: createTestUser('owner'),
	sharedUser: createTestUser('shared'),
	unrelatedUser: createTestUser('unrelated'),
	orgMember: createTestUser('org_member'),
} as const

export type ElectricTestContext = Awaited<ReturnType<typeof createElectricTestContext>>
