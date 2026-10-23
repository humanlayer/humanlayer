import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { projects } from '@humanlayer/db/tables/projects'
import { repositoryLocationsForUserForHost } from '@humanlayer/db/tables/repository-locations-for-user-for-host'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import { ORPCError } from '@orpc/client'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
	type GenerateSessionTitleInput,
	SessionTitleGeneration,
} from '../../src/effects/services/session-title-generation/session-title-generation.service'
import { getProjectWorkspaceRepositorySourcesProcedure as liveGetRepositorySources } from '../../src/orpc/api/project-workspaces/repository-sources-get.effect'
import { createSessionV2Procedure as liveCreateSessionV2 } from '../../src/orpc/api/sessions/v2/create.effect'
import { createMockApiContext, createMockStripeService, createMockWorkosService } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const repository = {
	remoteUrl: 'git@github.com:humanlayer/syncopate.git',
	repositoryIdentity: 'github.com/humanlayer/syncopate',
	defaultBranch: 'main',
	branch: 'workspace-test',
	default: true as const,
	autoPushBranch: false,
	copyGlobs: [] as string[],
}

describe('sessions v2 create', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let createSessionV2: typeof liveCreateSessionV2
	let getRepositorySources: typeof liveGetRepositorySources
	const scheduledTitleGenerations: GenerateSessionTitleInput[] = []

	const services = {
		workos: createMockWorkosService(),
		stripe: createMockStripeService(),
		get db() {
			return db
		},
		get dbReadReplica() {
			return db
		},
	}

	beforeAll(async () => {
		const testDb = await createTestDb('sessions-v2-create')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db, {
			sessionTitleGeneration: Layer.succeed(SessionTitleGeneration, {
				scheduleGeneration: (input) =>
					Effect.sync(() => {
						scheduledTitleGenerations.push(input)
					}),
			}),
		})
		createSessionV2 = bindProcedureToRuntime(liveCreateSessionV2, runtime)
		getRepositorySources = bindProcedureToRuntime(liveGetRepositorySources, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	beforeEach(() => {
		scheduledTitleGenerations.length = 0
	})

	async function setupTaskWithWorkspace(slug: string | null = null) {
		const organizationId = uuidv7()
		const userId = `user-${uuidv7()}`
		const hostId = `host-${uuidv7()}`
		const projectId = uuidv7()
		const workspaceId = uuidv7()
		const taskId = uuidv7()
		await db
			.insert(organizations)
			.values({ id: organizationId, name: 'Session V2 test', workos_organization_id: `workos-${organizationId}` })
		await db
			.insert(userSettings)
			.values({ organization_id: organizationId, user_id: userId, projects_v2_enabled: true })
		await db
			.insert(onlineHosts)
			.values({ organization_id: organizationId, user_id: userId, host_id: hostId, status: 'online' })
		await db.insert(projects).values({
			id: projectId,
			organization_id: organizationId,
			name: 'Test project',
			created_by: userId,
			resource_owner_user_id: userId,
			repositories: [repository],
		})
		await db.insert(repositoryLocationsForUserForHost).values({
			organization_id: organizationId,
			user_id: userId,
			host_id: hostId,
			repository_identity: repository.repositoryIdentity,
			source_kind: 'filesystem',
			source_path: '/home/user/projects/syncopate',
		})
		await db.insert(workspaces).values({
			id: workspaceId,
			organization_id: organizationId,
			project_id: projectId,
			name: 'Test workspace',
			created_by: userId,
			resource_owner_user_id: userId,
			repositories: [repository],
		})
		await db.insert(workspaceLocationsForUserForHost).values({
			organization_id: organizationId,
			project_id: projectId,
			workspace_id: workspaceId,
			user_id: userId,
			host_id: hostId,
			file_path: '/home/user/projects/syncopate',
			setup_generation: BigInt(1),
		})
		await db.insert(tasks).values({
			id: taskId,
			organization_id: organizationId,
			project_id: projectId,
			workspace_id: workspaceId,
			name: 'Existing V2 task',
			slug,
			created_by: userId,
			resource_owner_user_id: userId,
			is_draft: false,
			default_working_directory: '/home/user/projects/syncopate',
		})
		const auth = {
			userId,
			organizationId,
			workosOrganizationId: `workos-${organizationId}`,
			role: '',
			roles: [] as string[],
			permissions: [] as string[],
			entitlements: [] as string[],
			sessionId: 'session',
		}
		return {
			organizationId,
			userId,
			hostId,
			projectId,
			workspaceId,
			taskId,
			context: createMockApiContext({ auth, services }),
		}
	}

	async function selectManagedSourceForHost(
		actor: Awaited<ReturnType<typeof setupTaskWithWorkspace>>,
		hostId: string,
	) {
		await db.insert(repositoryLocationsForUserForHost).values({
			organization_id: actor.organizationId,
			user_id: actor.userId,
			host_id: hostId,
			repository_identity: repository.repositoryIdentity,
			source_kind: 'managed_clone',
			source_path: null,
		})
	}

	test('creates a second session without changing its existing persisted placement path', async () => {
		const actor = await setupTaskWithWorkspace()
		const result = await call(
			createSessionV2,
			{
				taskId: actor.taskId,
				workspaceId: actor.workspaceId,
				title: null,
				text: 'continue the work',
				hostId: actor.hostId,
				codingAgent: 'claude' as const,
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'default' as const,
			},
			{ context: actor.context },
		)

		expect(result.result).toBe('created')

		const sessionRows = await db.select().from(sessions).where(eq(sessions.task_id, actor.taskId))
		expect(sessionRows).toHaveLength(1)
		expect(sessionRows[0]!.status).toBe('ready_for_launch')
		expect(sessionRows[0]!.working_directory).toBe('/home/user/projects/syncopate')
		expect(scheduledTitleGenerations).toEqual([
			expect.objectContaining({
				sessionId: result.sessionId,
				organizationId: actor.organizationId,
				userId: actor.userId,
				prompt: 'continue the work',
				ticketId: null,
				taskName: 'Existing V2 task',
			}),
		])
	})

	test('does not generate a title when the launcher supplies one', async () => {
		const actor = await setupTaskWithWorkspace()
		await call(
			createSessionV2,
			{
				taskId: actor.taskId,
				workspaceId: actor.workspaceId,
				title: 'Keep This Title',
				text: 'continue the work',
				hostId: actor.hostId,
				codingAgent: 'claude' as const,
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'default' as const,
			},
			{ context: actor.context },
		)

		expect(scheduledTitleGenerations).toEqual([])
	})

	test('normalizes a blank launcher title and schedules generation', async () => {
		const actor = await setupTaskWithWorkspace()
		const result = await call(
			createSessionV2,
			{
				taskId: actor.taskId,
				workspaceId: actor.workspaceId,
				title: '   ',
				text: 'name this session',
				hostId: actor.hostId,
				codingAgent: 'claude' as const,
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'default' as const,
			},
			{ context: actor.context },
		)

		const [session] = await db.select().from(sessions).where(eq(sessions.id, result.sessionId))
		expect(session?.title).toBeNull()
		expect(scheduledTitleGenerations).toEqual([
			expect.objectContaining({ sessionId: result.sessionId, prompt: 'name this session' }),
		])
	})

	test('uses the stored safe task slug when creating a later placement', async () => {
		const actor = await setupTaskWithWorkspace('readable-task')
		const hostId = `host-${uuidv7()}`
		await db
			.insert(onlineHosts)
			.values({ organization_id: actor.organizationId, user_id: actor.userId, host_id: hostId, status: 'online' })
		await selectManagedSourceForHost(actor, hostId)

		await call(
			createSessionV2,
			{
				taskId: actor.taskId,
				workspaceId: actor.workspaceId,
				title: null,
				text: 'continue on another host',
				hostId,
				codingAgent: 'claude' as const,
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'default' as const,
			},
			{ context: actor.context },
		)

		const locations = await db
			.select()
			.from(workspaceLocationsForUserForHost)
			.where(eq(workspaceLocationsForUserForHost.workspace_id, actor.workspaceId))
		expect(locations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ host_id: actor.hostId, file_path: '/home/user/projects/syncopate' }),
				expect.objectContaining({ host_id: hostId, file_path: '~/.humanlayer/workspaces/readable-task' }),
			]),
		)
		const [session] = await db.select().from(sessions).where(eq(sessions.host_id, hostId))
		expect(session!.working_directory).toBe('~/.humanlayer/workspaces/readable-task')
	})

	test.each([null, '../historical-task'])('falls back to workspace ID for historical slug %j', async (slug) => {
		const actor = await setupTaskWithWorkspace(slug)
		const hostId = `host-${uuidv7()}`
		await db
			.insert(onlineHosts)
			.values({ organization_id: actor.organizationId, user_id: actor.userId, host_id: hostId, status: 'online' })
		await selectManagedSourceForHost(actor, hostId)

		await call(
			createSessionV2,
			{
				taskId: actor.taskId,
				workspaceId: actor.workspaceId,
				title: null,
				text: 'continue historical task',
				hostId,
				codingAgent: 'claude' as const,
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'default' as const,
			},
			{ context: actor.context },
		)

		const [location] = await db
			.select()
			.from(workspaceLocationsForUserForHost)
			.where(eq(workspaceLocationsForUserForHost.host_id, hostId))
		expect(location!.file_path).toBe(`~/.humanlayer/workspaces/${actor.workspaceId}`)
	})

	const secondRepository = {
		...repository,
		remoteUrl: 'git@github.com:Effect-TS/effect.git',
		repositoryIdentity: 'github.com/Effect-TS/effect',
		default: false as const,
	}
	const placementPath = '~/.humanlayer/workspaces/older-task'

	// A two-repo task placed on the actor's host, optionally with the daemon's saved worktree
	// for the default repository.
	async function setupTwoRepoTask(savedWorktreePath: string | null) {
		const actor = await setupTaskWithWorkspace('older-task')
		await db
			.update(workspaces)
			.set({ repositories: [secondRepository, repository] })
			.where(eq(workspaces.id, actor.workspaceId))
		await db
			.update(workspaceLocationsForUserForHost)
			.set({ file_path: placementPath })
			.where(eq(workspaceLocationsForUserForHost.workspace_id, actor.workspaceId))
		if (savedWorktreePath !== null) {
			await db.insert(workspaceRepositoryStatusForUserForHost).values({
				organization_id: actor.organizationId,
				project_id: actor.projectId,
				workspace_id: actor.workspaceId,
				user_id: actor.userId,
				host_id: actor.hostId,
				repository_identity: repository.repositoryIdentity,
				repository_remote_url: repository.remoteUrl,
				status: 'done',
				repo_available: true,
				materialization: { kind: 'worktree', path: savedWorktreePath, branch: repository.branch },
			})
		}
		return actor
	}

	async function createSessionOn(actor: Awaited<ReturnType<typeof setupTaskWithWorkspace>>, hostId: string) {
		const result = await call(
			createSessionV2,
			{
				taskId: actor.taskId,
				workspaceId: actor.workspaceId,
				title: 'Folder test',
				text: 'open the saved folder',
				hostId,
				codingAgent: 'claude' as const,
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'default' as const,
			},
			{ context: actor.context },
		)
		const [session] = await db.select().from(sessions).where(eq(sessions.id, result.sessionId))
		return session!
	}

	test('opens the saved worktree of a task placed under the older folder naming', async () => {
		const actor = await setupTwoRepoTask(
			'/Users/someone/.humanlayer/workspaces/older-task/github.com--humanlayer--syncopate',
		)
		const expected = `${placementPath}/github.com--humanlayer--syncopate`

		const sources = await call(
			getRepositorySources,
			{ taskId: actor.taskId, hostId: actor.hostId },
			{ context: actor.context },
		)
		expect(sources.sessionDirectory).toBe(expected)

		const session = await createSessionOn(actor, actor.hostId)
		expect(session.working_directory).toBe(expected)
	})

	test('names the default repository folder when the daemon has not created it yet', async () => {
		const actor = await setupTwoRepoTask(null)
		const expected = `${placementPath}/syncopate`

		const sources = await call(
			getRepositorySources,
			{ taskId: actor.taskId, hostId: actor.hostId },
			{ context: actor.context },
		)
		expect(sources.sessionDirectory).toBe(expected)

		const session = await createSessionOn(actor, actor.hostId)
		expect(session.working_directory).toBe(expected)
	})

	test('reports no session folder on a host where the task is not set up', async () => {
		const actor = await setupTwoRepoTask(null)
		const hostId = `host-${uuidv7()}`
		await db
			.insert(onlineHosts)
			.values({ organization_id: actor.organizationId, user_id: actor.userId, host_id: hostId, status: 'online' })

		const sources = await call(getRepositorySources, { taskId: actor.taskId, hostId }, { context: actor.context })
		expect(sources.placementExists).toBe(false)
		expect(sources.sessionDirectory).toBeNull()
	})

	test('returns already-exists on replay with the same session ID', async () => {
		const actor = await setupTaskWithWorkspace()
		const sessionId = uuidv7()
		const input = {
			sessionId,
			taskId: actor.taskId,
			workspaceId: actor.workspaceId,
			title: null as string | null,
			text: 'replayed session',
			hostId: actor.hostId,
			codingAgent: 'claude' as const,
			provider: 'anthropic',
			model: 'opus',
			permissionsMode: 'default' as const,
		}

		const first = await call(createSessionV2, input, { context: actor.context })
		expect(first.result).toBe('created')
		expect(first.sessionId).toBe(sessionId)
		expect(scheduledTitleGenerations).toHaveLength(1)

		scheduledTitleGenerations.length = 0
		const second = await call(createSessionV2, input, { context: actor.context })
		expect(second.result).toBe('already-exists')
		expect(second.sessionId).toBe(sessionId)
		expect(scheduledTitleGenerations).toEqual([expect.objectContaining({ sessionId, prompt: 'replayed session' })])
	})

	test('rejects when task does not match workspace', async () => {
		const actor = await setupTaskWithWorkspace()
		await expect(
			call(
				createSessionV2,
				{
					taskId: actor.taskId,
					workspaceId: uuidv7(),
					title: null,
					text: 'wrong workspace',
					hostId: actor.hostId,
					codingAgent: 'claude' as const,
					provider: 'anthropic',
					model: 'opus',
					permissionsMode: 'default' as const,
				},
				{ context: actor.context },
			),
		).rejects.toThrow(ORPCError)
	})

	test('rejects when host is not registered', async () => {
		const actor = await setupTaskWithWorkspace()
		await expect(
			call(
				createSessionV2,
				{
					taskId: actor.taskId,
					workspaceId: actor.workspaceId,
					title: null,
					text: 'wrong host',
					hostId: 'unknown-host',
					codingAgent: 'claude' as const,
					provider: 'anthropic',
					model: 'opus',
					permissionsMode: 'default' as const,
				},
				{ context: actor.context },
			),
		).rejects.toThrow(ORPCError)
	})
})
