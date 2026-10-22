import { NodeCrypto } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { projects } from '@humanlayer/db/tables/projects'
import { repositoryLocationsForUserForHost } from '@humanlayer/db/tables/repository-locations-for-user-for-host'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import { CreateSessionV2InputSchema } from '@humanlayer/riptide-api-contract/api/sessions/v2/create'
import { CreateTaskV2InputSchema } from '@humanlayer/riptide-api-contract/api/tasks/v2/create'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, expect } from 'vitest'

import { createSessionV2 } from '../../src/effects/project-workspace/create-session-v2'
import { createTaskV2 } from '../../src/effects/project-workspace/create-task-v2'
import { PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { SessionTitleGeneration } from '../../src/effects/services/session-title-generation/session-title-generation.service'
import { TaskIntentClassifier } from '../../src/effects/services/task-intent-classifier/task-intent-classifier.service'
import { createSessionV2Procedure } from '../../src/orpc/api/sessions/v2/create.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const repositories = ['primary', 'context'].map((name, index) => ({
	remoteUrl: `https://github.com/example/${name}.git`,
	repositoryIdentity: `github.com/example/${name}`,
	defaultBranch: 'main',
	branch: 'portable-workspace-branch',
	baseCommit: 'a'.repeat(40),
	default: index === 0,
	autoPushBranch: false,
	copyGlobs: [],
}))

describe('V2 workspace placements', () => {
	let db: PostgresJsDatabase
	let cleanup: () => Promise<void>
	beforeAll(async () => {
		const testDb = await createTestDb('workspace_placements')
		db = testDb.db
		cleanup = testDb.cleanup
	}, 60_000)
	afterAll(async () => cleanup(), 30_000)
	const testLayer = () =>
		Layer.mergeAll(
			PostgresDbLive(db),
			NodeCrypto.layer,
			Layer.succeed(SessionTitleGeneration, { scheduleGeneration: () => Effect.void }),
			Layer.succeed(TaskIntentClassifier, { classify: () => Effect.succeed('implementation') }),
		)

	const seed = Effect.fn(function* () {
		const postgres = yield* PostgresDb
		const organizationId = uuidv7()
		const owner = `owner-${uuidv7()}`
		const userId = `collaborator-${uuidv7()}`
		const hostId = `host-${uuidv7()}`
		const projectId = uuidv7()
		const workspaceId = uuidv7()
		const taskId = uuidv7()
		yield* postgres.query(
			postgres.client
				.insert(organizations)
				.values({ id: organizationId, name: 'Placement tests', workos_organization_id: organizationId }),
		)
		yield* postgres.query(
			postgres.client.insert(userSettings).values(
				[owner, userId].map((user) => ({
					organization_id: organizationId,
					user_id: user,
					projects_v2_enabled: true,
				})),
			),
		)
		yield* postgres.query(
			postgres.client.insert(onlineHosts).values(
				[owner, userId].map((user) => ({
					organization_id: organizationId,
					user_id: user,
					host_id: hostId,
				})),
			),
		)
		yield* postgres.query(
			postgres.client.insert(projects).values({
				id: projectId,
				organization_id: organizationId,
				name: 'Recipe',
				created_by: owner,
				resource_owner_user_id: owner,
				repositories,
			}),
		)
		yield* postgres.query(
			postgres.client.insert(repositoryLocationsForUserForHost).values(
				repositories.map((repository) => ({
					organization_id: organizationId,
					user_id: owner,
					host_id: hostId,
					repository_identity: repository.repositoryIdentity,
					source_kind: 'filesystem' as const,
					source_path: `/home/owner/${repository.repositoryIdentity}`,
				})),
			),
		)
		yield* createTaskV2({
			...CreateTaskV2InputSchema.parse({
				taskId,
				workspaceId,
				projectId,
				name: 'Portable task',
				slug: 'portable-task',
				repositories,
				firstSession: { hostId, text: 'start', codingAgent: 'claude', permissionsMode: 'default' },
				sessionId: uuidv7(),
				eventId: uuidv7(),
			}),
			actor: { organizationId, userId: owner },
		})
		return { organizationId, owner, userId, hostId, projectId, workspaceId, taskId }
	})
	type Fixture = Effect.Success<ReturnType<typeof seed>>
	const request = (
		fixture: Fixture,
		overrides: Partial<ReturnType<typeof CreateSessionV2InputSchema.parse>> = {},
	) => ({
		...CreateSessionV2InputSchema.parse({
			taskId: fixture.taskId,
			workspaceId: fixture.workspaceId,
			hostId: fixture.hostId,
			text: 'continue',
			codingAgent: 'fold',
			permissionsMode: 'default',
			sessionId: uuidv7(),
			eventId: uuidv7(),
			...overrides,
		}),
		actor: { organizationId: fixture.organizationId, userId: fixture.userId },
	})
	const placements = (fixture: Fixture) =>
		Effect.gen(function* () {
			const postgres = yield* PostgresDb
			return yield* postgres.query(
				postgres.client
					.select()
					.from(workspaceLocationsForUserForHost)
					.where(
						and(
							eq(workspaceLocationsForUserForHost.workspace_id, fixture.workspaceId),
							eq(workspaceLocationsForUserForHost.user_id, fixture.userId),
						),
					),
			)
		})
	const statuses = (fixture: Fixture) =>
		Effect.gen(function* () {
			const postgres = yield* PostgresDb
			return yield* postgres.query(
				postgres.client
					.select()
					.from(workspaceRepositoryStatusForUserForHost)
					.where(
						and(
							eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId),
							eq(workspaceRepositoryStatusForUserForHost.user_id, fixture.userId),
						),
					),
			)
		})
	const selectManagedSources = (fixture: Fixture, hostId = fixture.hostId) =>
		Effect.gen(function* () {
			const postgres = yield* PostgresDb
			yield* postgres.query(
				postgres.client.insert(repositoryLocationsForUserForHost).values(
					repositories.map((repository) => ({
						organization_id: fixture.organizationId,
						user_id: fixture.userId,
						host_id: hostId,
						repository_identity: repository.repositoryIdentity,
						source_kind: 'managed_clone' as const,
						source_path: null,
					})),
				),
			)
		})

	it.effect('creates an isolated same-host collaborator placement without copying owner paths or progress', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			const postgres = yield* PostgresDb
			const input = request(fixture)
			yield* selectManagedSources(fixture)
			yield* createSessionV2(input)
			expect(yield* placements(fixture)).toEqual([
				expect.objectContaining({
					file_path: '~/.humanlayer/workspaces/portable-task',
					setup_generation: 1n,
				}),
			])
			const rows = yield* statuses(fixture)
			expect(rows).toHaveLength(2)
			for (const row of rows)
				expect(row).toMatchObject({
					status: 'setup_requested',
					source_policy: 'managed_clone',
					source_kind: null,
					source_path: null,
					materialization: null,
					resolved_commit: 'a'.repeat(40),
					generation: 1n,
				})
			const [session] = yield* postgres.query(
				postgres.client
					.select()
					.from(sessions)
					.where(eq(sessions.id, input.sessionId ?? '')),
			)
			expect(session).toMatchObject({
				created_by: fixture.userId,
				resource_owner_user_id: fixture.owner,
				working_directory: '~/.humanlayer/workspaces/portable-task/primary',
			})
			const [task] = yield* postgres.query(
				postgres.client.select().from(tasks).where(eq(tasks.id, fixture.taskId)),
			)
			expect(task).toMatchObject({ workspace_spec: null, workspace_state: null })
			expect(
				yield* postgres.query(
					postgres.client
						.select()
						.from(taskWorkspaceSetupForHost)
						.where(eq(taskWorkspaceSetupForHost.task_id, fixture.taskId)),
				),
			).toHaveLength(0)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('requires every repository source before creating a placement', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			const postgres = yield* PostgresDb
			const hostId = `other-${uuidv7()}`
			yield* postgres.query(
				postgres.client
					.insert(onlineHosts)
					.values({ organization_id: fixture.organizationId, user_id: fixture.userId, host_id: hostId }),
			)
			yield* postgres.query(
				postgres.client.insert(repositoryLocationsForUserForHost).values({
					organization_id: fixture.organizationId,
					user_id: fixture.userId,
					host_id: hostId,
					repository_identity: 'github.com/example/context',
					source_kind: 'filesystem',
					source_path: '/home/collaborator/context',
				}),
			)
			const failure = yield* createSessionV2(request(fixture, { hostId })).pipe(Effect.flip)
			expect(failure).toMatchObject({
				_tag: 'RepositorySourcesRequired',
				projectId: fixture.projectId,
				workspaceId: fixture.workspaceId,
				hostId,
				missingRepositoryIdentities: ['github.com/example/primary'],
			})
			expect(yield* placements(fixture)).toHaveLength(0)
			expect(yield* statuses(fixture)).toHaveLength(0)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('concurrent sessions create one complete placement and replays preserve parked progress', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			const postgres = yield* PostgresDb
			const input = request(fixture)
			yield* selectManagedSources(fixture)
			const results = yield* Effect.all([createSessionV2(input), createSessionV2(input)], { concurrency: 2 })
			expect(results.map((result) => result.result).sort()).toEqual(['already-exists', 'created'])
			expect(yield* placements(fixture)).toHaveLength(1)
			expect(yield* statuses(fixture)).toHaveLength(2)
			yield* postgres.query(
				postgres.client
					.update(workspaceRepositoryStatusForUserForHost)
					.set({ error: { stage: 'setup_requested', message: 'parked' } })
					.where(
						and(
							eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId),
							eq(workspaceRepositoryStatusForUserForHost.user_id, fixture.userId),
						),
					),
			)
			const before = yield* statuses(fixture)
			yield* createSessionV2(request(fixture))
			expect(yield* statuses(fixture)).toEqual(before)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('rolls back a newly created placement if the first event cannot be inserted', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			yield* selectManagedSources(fixture)
			const postgres = yield* PostgresDb
			const [event] = yield* postgres.query(
				postgres.client.select().from(conversationEvents).where(eq(conversationEvents.task_id, fixture.taskId)),
			)
			if (event === undefined) return yield* Effect.die('Missing fixture event')
			const result = yield* createSessionV2(request(fixture, { eventId: event.id })).pipe(Effect.flip)
			expect(result).toMatchObject({ _tag: 'PostgresDbQueryError' })
			expect(yield* placements(fixture)).toHaveLength(0)
			expect(yield* statuses(fixture)).toHaveLength(0)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('requires edit permission, rollout opt-in and a caller-owned host before writing placement', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			const postgres = yield* PostgresDb
			yield* postgres.query(
				postgres.client
					.update(taskOrganizationAcl)
					.set({ permission_level: 'read' })
					.where(eq(taskOrganizationAcl.task_id, fixture.taskId)),
			)
			expect(yield* createSessionV2(request(fixture)).pipe(Effect.flip)).toMatchObject({
				_tag: 'ProjectMutationForbidden',
			})
			yield* postgres.query(
				postgres.client.delete(taskOrganizationAcl).where(eq(taskOrganizationAcl.task_id, fixture.taskId)),
			)
			expect(yield* createSessionV2(request(fixture)).pipe(Effect.flip)).toMatchObject({
				_tag: 'ProjectNotFound',
			})
			yield* postgres.query(
				postgres.client
					.update(userSettings)
					.set({ projects_v2_enabled: false })
					.where(
						and(
							eq(userSettings.organization_id, fixture.organizationId),
							eq(userSettings.user_id, fixture.userId),
						),
					),
			)
			expect(yield* createSessionV2(request(fixture)).pipe(Effect.flip)).toMatchObject({
				_tag: 'ProjectsV2Disabled',
			})
			expect(yield* placements(fixture)).toHaveLength(0)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('rejects other-organization tasks and other-user host registrations', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			const other = yield* seed()
			expect(
				yield* createSessionV2(
					request(other, { taskId: fixture.taskId, workspaceId: fixture.workspaceId }),
				).pipe(Effect.flip),
			).toMatchObject({ _tag: 'ProjectNotFound' })
			const postgres = yield* PostgresDb
			yield* postgres.query(
				postgres.client
					.delete(onlineHosts)
					.where(
						and(
							eq(onlineHosts.organization_id, fixture.organizationId),
							eq(onlineHosts.user_id, fixture.userId),
						),
					),
			)
			expect(yield* createSessionV2(request(fixture)).pipe(Effect.flip)).toMatchObject({
				_tag: 'ProjectLocationInvalid',
			})
			expect(yield* placements(fixture)).toHaveLength(0)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('rejects replaying another creator session identity and leaves the new placement absent', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			yield* selectManagedSources(fixture)
			const postgres = yield* PostgresDb
			const [ownerSession] = yield* postgres.query(
				postgres.client.select().from(sessions).where(eq(sessions.task_id, fixture.taskId)),
			)
			if (ownerSession === undefined) return yield* Effect.die('Missing fixture session')
			expect(
				yield* createSessionV2(request(fixture, { sessionId: ownerSession.id })).pipe(Effect.flip),
			).toMatchObject({ _tag: 'ProjectPersistenceUnavailable' })
			expect(yield* placements(fixture)).toHaveLength(0)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('promotes a caller-owned draft atomically and does not duplicate its event on replay', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			yield* selectManagedSources(fixture)
			const postgres = yield* PostgresDb
			const draftId = uuidv7()
			yield* postgres.query(
				postgres.client.insert(sessions).values({
					id: draftId,
					organization_id: fixture.organizationId,
					created_by: fixture.userId,
					resource_owner_user_id: fixture.userId,
					status: 'draft',
					working_directory: '/old/directory',
					host_id: fixture.hostId,
				}),
			)
			const input = request(fixture, { draftId, sessionId: draftId })
			// Exercise the procedure boundary too: dropping draftId here leaves the draft unlaunched.
			const result = yield* Effect.promise(async () => {
				const runtime = createRuntimeWithTestPostgresLayer(db)
				try {
					return await call(bindProcedureToRuntime(createSessionV2Procedure, runtime), input, {
						context: createMockApiContext({
							auth: createMockApiAuth({ organizationId: fixture.organizationId, userId: fixture.userId }),
							services: { db, dbReadReplica: db },
						}),
					})
				} finally {
					await runtime.dispose()
				}
			})
			expect(result.result).toBe('created')
			expect((yield* createSessionV2(input)).result).toBe('already-exists')
			const [session] = yield* postgres.query(
				postgres.client.select().from(sessions).where(eq(sessions.id, draftId)),
			)
			expect(session).toMatchObject({
				status: 'ready_for_launch',
				task_id: fixture.taskId,
				created_by: fixture.userId,
				resource_owner_user_id: fixture.owner,
				working_directory: '~/.humanlayer/workspaces/portable-task/primary',
			})
			expect(yield* placements(fixture)).toHaveLength(1)
			expect(
				yield* postgres.query(
					postgres.client.select().from(conversationEvents).where(eq(conversationEvents.session_id, draftId)),
				),
			).toHaveLength(1)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('cannot promote another creator draft or bypass source-task edit permission', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			const postgres = yield* PostgresDb
			const draftId = uuidv7()
			yield* postgres.query(
				postgres.client.insert(sessions).values({
					id: draftId,
					organization_id: fixture.organizationId,
					task_id: fixture.taskId,
					created_by: fixture.owner,
					resource_owner_user_id: fixture.owner,
					status: 'draft',
					working_directory: '/home/owner',
					host_id: fixture.hostId,
				}),
			)
			expect(
				yield* createSessionV2(request(fixture, { draftId, sessionId: draftId })).pipe(Effect.flip),
			).toMatchObject({ _tag: 'ProjectMutationForbidden' })
			expect(yield* placements(fixture)).toHaveLength(0)
			const source = yield* seed()
			yield* postgres.query(
				postgres.client
					.update(sessions)
					.set({ created_by: fixture.userId, task_id: source.taskId })
					.where(eq(sessions.id, draftId)),
			)
			expect(
				yield* createSessionV2(request(fixture, { draftId, sessionId: draftId })).pipe(Effect.flip),
			).toMatchObject({ _tag: 'ProjectMutationForbidden' })
			expect(yield* placements(fixture)).toHaveLength(0)
		}).pipe(Effect.provide(testLayer())),
	)

	it.effect('preserves immutable recipe/default when another host or user creates a session', () =>
		Effect.gen(function* () {
			const fixture = yield* seed()
			yield* selectManagedSources(fixture)
			const postgres = yield* PostgresDb
			expect(
				yield* createSessionV2(
					request(fixture, { defaultRepositoryIdentity: 'github.com/example/context' }),
				).pipe(Effect.flip),
			).toMatchObject({ _tag: 'ProjectLocationInvalid' })
			yield* createSessionV2(request(fixture))
			const [workspace] = yield* postgres.query(
				postgres.client.select().from(workspaces).where(eq(workspaces.id, fixture.workspaceId)),
			)
			expect(workspace?.repositories).toEqual(repositories)
		}).pipe(Effect.provide(testLayer())),
	)
})
