import { it } from '@effect/vitest'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { projects } from '@humanlayer/db/tables/projects'
import { repositoryLocationsForUserForHost } from '@humanlayer/db/tables/repository-locations-for-user-for-host'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { CreateTaskV2InputSchema } from '@humanlayer/riptide-api-contract/api/tasks/v2/create'
import type {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupResult,
} from '@humanlayer/schemas/effect/project-workspace'
import { and, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Clock, Crypto, Effect, Layer, Logger, PlatformError } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, describe, expect } from 'vitest'

import { createTaskV2 } from '../../src/effects/project-workspace/create-task-v2'
import {
	archiveProject,
	createProject,
	getProjectRepositorySources,
	getProject,
	listProjects,
	updateProject,
	upsertProjectRepositorySources,
	upsertProjectLocation,
} from '../../src/effects/project-workspace/project-operations'
import {
	readRepositoryLocations,
	readRepositoryLocationsWithExecutor,
	selectRepositoryLocationsWithExecutor,
	selectRepositoryLocations,
	type RepositoryLocationScope,
} from '../../src/effects/project-workspace/repository-locations'
import { advanceRepositorySetupStage } from '../../src/effects/project-workspace/repository-progress'
import {
	recoverProjectWorkspaceRepositorySource,
	retryProjectWorkspaceRepositorySetup,
} from '../../src/effects/project-workspace/repository-recovery'
import {
	getWorkspaceRepositoryStatusForUserForHost,
	readWorkspaceRepositoryActorSnapshotWithExecutor,
} from '../../src/effects/project-workspace/workspace-reads'
import {
	getProjectWorkspaceRepositorySources,
	upsertProjectWorkspaceRepositorySources,
} from '../../src/effects/project-workspace/workspace-repository-sources'
import { PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { SessionTitleGeneration } from '../../src/effects/services/session-title-generation/session-title-generation.service'
import { TaskIntentClassifier } from '../../src/effects/services/task-intent-classifier/task-intent-classifier.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

let sequence = 0
const testCryptoLayer = Layer.sync(Crypto.Crypto, () => {
	return Crypto.make({
		randomBytes: (size) => {
			const bytes = new Uint8Array(size)
			new DataView(bytes.buffer).setUint32(size - 4, ++sequence)
			return bytes
		},
		digest: () => Effect.die('digest is not used by repository location tests'),
	})
})

const repository = {
	remoteUrl: 'git@github.com:humanlayer/syncopate.git',
	repositoryIdentity: 'github.com/humanlayer/syncopate',
	defaultBranch: 'main',
	default: true,
	autoPushBranch: false,
	copyGlobs: [],
}

const seedActor = Effect.fn('test.repository_locations.seed_actor')(function* () {
	const db = yield* PostgresDb
	const crypto = yield* Crypto.Crypto
	const actor = {
		organizationId: yield* crypto.randomUUIDv7,
		userId: `user-${yield* crypto.randomUUIDv7}`,
		hostId: `host-${yield* crypto.randomUUIDv7}`,
	}
	yield* db.query(
		db.client.insert(organizations).values({
			id: actor.organizationId,
			name: 'Locations test',
			workos_organization_id: yield* crypto.randomUUIDv7,
		}),
	)
	yield* db.query(
		db.client
			.insert(userSettings)
			.values({ organization_id: actor.organizationId, user_id: actor.userId, projects_v2_enabled: true }),
	)
	yield* db.query(
		db.client.insert(onlineHosts).values({
			organization_id: actor.organizationId,
			user_id: actor.userId,
			host_id: actor.hostId,
			status: 'online',
		}),
	)
	return actor
})

const makeProject = (actor: RepositoryLocationScope) =>
	createProject({ actor, project: { name: 'Shared repository', private: false, repositories: [repository] } })

const makeTask = Effect.fn('test.repository_locations.make_task')(function* (
	actor: RepositoryLocationScope,
	projectId: string,
	taskRepository = repository,
) {
	const crypto = yield* Crypto.Crypto
	const taskId = yield* crypto.randomUUIDv7
	const configuredSources = yield* readRepositoryLocations({
		...actor,
		repositoryIdentities: [taskRepository.repositoryIdentity],
	})
	const temporaryManagedPreference = configuredSources.length === 0
	if (temporaryManagedPreference) {
		yield* upsertProjectRepositorySources({
			actor,
			projectId,
			hostId: actor.hostId,
			sources: { [taskRepository.repositoryIdentity]: { kind: 'managed_clone' } },
		})
	}
	const input = CreateTaskV2InputSchema.parse({
		taskId,
		workspaceId: yield* crypto.randomUUIDv7,
		projectId,
		name: 'Repository source task',
		slug: `repository-source-task-${taskId.slice(-6)}`,
		repositories: [{ ...taskRepository, branch: 'workspace-source-test' }],
		firstSession: { hostId: actor.hostId, text: 'Implement', codingAgent: 'claude', permissionsMode: 'default' },
	})
	yield* createTaskV2({ ...input, actor })
	if (temporaryManagedPreference) {
		yield* upsertProjectRepositorySources({
			actor,
			projectId,
			hostId: actor.hostId,
			sources: { [taskRepository.repositoryIdentity]: { kind: 'unknown' } },
		})
	}
	const snapshot = yield* getWorkspaceRepositoryStatusForUserForHost({
		...actor,
		projectId,
		workspaceId: input.workspaceId,
		repositoryIdentity: taskRepository.repositoryIdentity,
	})
	return { input, snapshot }
})

const report = (snapshot: WorkspaceRepositoryActorSnapshot, result: WorkspaceRepositorySetupResult) =>
	advanceRepositorySetupStage({
		actor: snapshot.status,
		projectId: snapshot.status.projectId,
		workspaceId: snapshot.status.workspaceId,
		repositoryIdentity: snapshot.status.repositoryIdentity,
		generation: snapshot.status.generation,
		expectedUpdatedAt: snapshot.status.updatedAt,
		result,
	})

const selectPath = (actor: RepositoryLocationScope, projectId: string, path: string) =>
	upsertProjectLocation({
		actor,
		projectId,
		hostId: actor.hostId,
		repositoryPaths: { [repository.repositoryIdentity]: path },
	})

const storedLocations = Effect.fn('test.repository_locations.stored_locations')(function* (
	actor: RepositoryLocationScope,
) {
	const db = yield* PostgresDb
	const locations = repositoryLocationsForUserForHost
	return yield* db.query(
		db.client
			.select()
			.from(locations)
			.where(
				and(
					eq(locations.organization_id, actor.organizationId),
					eq(locations.user_id, actor.userId),
					eq(locations.host_id, actor.hostId),
				),
			),
	)
})

describe('repository-scoped configured locations', () => {
	let database: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	const repositoryLocationTestLayer = () =>
		Layer.mergeAll(
			PostgresDbLive(database),
			testCryptoLayer,
			Layer.succeed(TaskIntentClassifier, { classify: () => Effect.succeed('implementation') }),
			Layer.succeed(SessionTitleGeneration, { scheduleGeneration: () => Effect.void }),
		)
	beforeAll(async () => {
		const testDb = await createTestDb('repository-locations')
		database = testDb.db
		cleanup = testDb.cleanup
	}, 60_000)
	afterAll(async () => {
		await cleanup?.()
	}, 30_000)

	it.effect('creates an initial configured path atomically and uses the Effect clock for updates', () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_700_000_000_000)
			const actor = yield* seedActor()
			const created = yield* createProject({
				actor,
				project: { name: 'Initial', private: false, repositories: [repository] },
				initialLocation: {
					hostId: actor.hostId,
					repositoryPaths: { [repository.repositoryIdentity]: '/initial' },
				},
			})
			expect(created.project.id.split('-')[2]?.startsWith('7')).toBe(true)
			expect(Number.parseInt(created.project.id.replaceAll('-', '').slice(0, 12), 16)).toBe(
				yield* Clock.currentTimeMillis,
			)
			expect(created.location?.repositoryPaths).toEqual({ [repository.repositoryIdentity]: '/initial' })
			expect(yield* storedLocations(actor)).toHaveLength(1)
			yield* TestClock.setTime(1_700_000_001_000)
			const updated = yield* updateProject({ actor, projectId: created.project.id, changes: { name: 'Updated' } })
			expect(updated.updatedAt).toBe(yield* Clock.currentTimeMillis)
			const archived = yield* archiveProject({ actor, projectId: created.project.id, archived: true })
			expect(archived.updatedAt).toBe(yield* Clock.currentTimeMillis)
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('reads unknown sources and supports filesystem, managed, and forgotten transitions', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			const read = () =>
				getProjectRepositorySources({ actor, projectId: project.project.id, hostId: actor.hostId })
			expect((yield* read()).sources).toEqual({ [repository.repositoryIdentity]: { kind: 'unknown' } })

			expect(
				(yield* upsertProjectRepositorySources({
					actor,
					projectId: project.project.id,
					hostId: actor.hostId,
					sources: { [repository.repositoryIdentity]: { kind: 'filesystem', path: '/checkout' } },
				})).sources,
			).toEqual({ [repository.repositoryIdentity]: { kind: 'filesystem', path: '/checkout' } })

			yield* upsertProjectRepositorySources({
				actor,
				projectId: project.project.id,
				hostId: actor.hostId,
				sources: { [repository.repositoryIdentity]: { kind: 'managed_clone' } },
			})
			expect((yield* storedLocations(actor))[0]).toMatchObject({
				source_kind: 'managed_clone',
				source_path: null,
			})

			yield* upsertProjectRepositorySources({
				actor,
				projectId: project.project.id,
				hostId: actor.hostId,
				sources: { [repository.repositoryIdentity]: { kind: 'unknown' } },
			})
			expect((yield* read()).sources).toEqual({ [repository.repositoryIdentity]: { kind: 'unknown' } })
			expect(yield* storedLocations(actor)).toEqual([])
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('rolls back the project and all configured path changes if initial persistence fails', () =>
		Effect.gen(function* () {
			const db = yield* PostgresDb
			const actor = yield* seedActor()
			const error = yield* createProject({
				actor,
				project: { name: 'Rollback', private: false, repositories: [repository] },
				initialLocation: { hostId: actor.hostId, repositoryPaths: { [repository.repositoryIdentity]: '' } },
			}).pipe(Effect.flip)
			expect(error).toMatchObject({ _tag: 'PostgresDbQueryError' })
			expect(yield* storedLocations(actor)).toEqual([])
			expect(
				yield* db.query(
					db.client.select().from(projects).where(eq(projects.organization_id, actor.organizationId)),
				),
			).toEqual([])
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('rolls back earlier mapping writes and preserves the existing mapping when a later write fails', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			yield* selectPath(actor, project.project.id, '/original')
			const before = yield* storedLocations(actor)
			const error = yield* selectRepositoryLocations({
				...actor,
				repositoryPaths: {
					'github.com/humanlayer/aaa': '/new',
					[repository.repositoryIdentity]: '',
				},
			}).pipe(Effect.flip)
			expect(error).toMatchObject({ _tag: 'PostgresDbQueryError' })
			expect(yield* storedLocations(actor)).toEqual(before)
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('captures and narrows Crypto failure before creating any project rows', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const db = yield* PostgresDb
			const crypto = yield* Crypto.Crypto
			const error = yield* makeProject(actor).pipe(
				Effect.provide(
					Layer.succeed(Crypto.Crypto, {
						...crypto,
						randomUUIDv7: Effect.fail(
							PlatformError.badArgument({
								module: 'Crypto',
								method: 'randomUUIDv7',
								description: 'Test failure',
							}),
						),
					}),
				),
				Effect.flip,
			)
			expect(error).toMatchObject({ _tag: 'ProjectPersistenceUnavailable', operation: 'generate_id' })
			expect(
				yield* db.query(
					db.client.select().from(projects).where(eq(projects.organization_id, actor.organizationId)),
				),
			).toEqual([])
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('narrows corrupt stored recipes without changing projects or shared selections', () =>
		Effect.gen(function* () {
			const db = yield* PostgresDb
			const actor = yield* seedActor()
			const created = yield* makeProject(actor)
			const projectId = created.project.id
			yield* selectPath(actor, projectId, '/checkout/original')
			const locationsBefore = yield* storedLocations(actor)
			yield* db.query(
				db.client
					.update(projects)
					.set({ repositories: sql`'{}'::jsonb` })
					.where(eq(projects.id, projectId)),
			)
			const rowsBefore = yield* db.query(db.client.select().from(projects).where(eq(projects.id, projectId)))
			const failures = [
				yield* Effect.flip(listProjects({ actor, archived: false })),
				yield* Effect.flip(getProject({ actor, projectId })),
				yield* Effect.flip(getProject({ actor, projectId, hostId: actor.hostId })),
				yield* Effect.flip(selectPath(actor, projectId, '/checkout/replacement')),
				yield* Effect.flip(makeTask(actor, projectId)),
				yield* Effect.flip(updateProject({ actor, projectId, changes: { name: 'Changed' } })),
				yield* Effect.flip(archiveProject({ actor, projectId, archived: true })),
			]
			for (const failure of failures) {
				expect(failure).toMatchObject({ _tag: 'ProjectPersistenceUnavailable', operation: 'parse_project' })
			}
			expect(yield* storedLocations(actor)).toEqual(locationsBefore)
			expect(yield* db.query(db.client.select().from(projects).where(eq(projects.id, projectId)))).toEqual(
				rowsBefore,
			)
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('replaces the single configured path across projects and leaves omitted mappings unchanged', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const first = yield* makeProject(actor)
			const second = yield* makeProject(actor)
			yield* selectPath(actor, first.project.id, '/checkout/first')
			yield* selectPath(actor, second.project.id, '/checkout/second')
			for (const project of [first, second]) {
				const result = yield* getProject({ actor, projectId: project.project.id, hostId: actor.hostId })
				expect(result.location?.repositoryPaths).toEqual({
					[repository.repositoryIdentity]: '/checkout/second',
				})
			}
			const { snapshot } = yield* makeTask(actor, first.project.id)
			expect(snapshot.status.sourcePath).toBe('/checkout/second')
			expect(snapshot.sourceCandidates.map((candidate) => candidate.sourcePath)).toEqual(['/checkout/second'])
			const before = yield* storedLocations(actor)
			yield* upsertProjectLocation({
				actor,
				projectId: first.project.id,
				hostId: actor.hostId,
				repositoryPaths: {},
			})
			expect(yield* storedLocations(actor)).toEqual(before)
			yield* selectPath(actor, first.project.id, '/checkout/first')
			const changed = yield* getProject({ actor, projectId: second.project.id, hostId: actor.hostId })
			expect(changed.location?.repositoryPaths[repository.repositoryIdentity]).toBe('/checkout/first')
			const checking = yield* report(snapshot, { _tag: 'SetupStarted' })
			expect(checking.sourceCandidates[0]?.sourcePath).toBe('/checkout/second')
			expect(checking.status.sourcePath).toBe('/checkout/second')
			const db = yield* PostgresDb
			yield* db.query(db.client.delete(projects).where(eq(projects.id, first.project.id)))
			expect(yield* storedLocations(actor)).toHaveLength(1)
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('uses explicit database helpers for read-your-writes and rolls changes back', () =>
		Effect.gen(function* () {
			const db = yield* PostgresDb
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			yield* selectPath(actor, project.project.id, '/initial')
			const task = yield* makeTask(actor, project.project.id)
			yield* db.query(
				db.client
					.delete(repositoryLocationsForUserForHost)
					.where(eq(repositoryLocationsForUserForHost.organization_id, actor.organizationId)),
			)
			const failure = yield* db
				.transaction((transaction) =>
					Effect.gen(function* () {
						yield* selectRepositoryLocationsWithExecutor(transaction, {
							...actor,
							repositoryPaths: { [repository.repositoryIdentity]: '/transaction-only' },
						})
						const locations = yield* readRepositoryLocationsWithExecutor(transaction, {
							...actor,
							repositoryIdentities: [repository.repositoryIdentity],
						})
						expect(locations.map((location) => location.sourcePath)).toEqual(['/transaction-only'])
						const snapshot = yield* readWorkspaceRepositoryActorSnapshotWithExecutor(
							transaction,
							task.snapshot.status,
						)
						expect(snapshot.sourceCandidates).toEqual([
							{ sourceKind: 'filesystem', sourcePath: '/initial' },
						])
						// Public reads remain on the ordinary database and cannot see the uncommitted selection.
						expect(
							yield* readRepositoryLocations({
								...actor,
								repositoryIdentities: [repository.repositoryIdentity],
							}),
						).toEqual([])
						return yield* Effect.fail('abort-test-transaction' as const)
					}),
				)
				.pipe(Effect.flip)
			expect(failure).toBe('abort-test-transaction')
			expect(yield* storedLocations(actor)).toEqual([])
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('rejects daemon fallback that contradicts a frozen filesystem policy', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			yield* selectPath(actor, project.project.id, '/required/source')
			const task = yield* makeTask(actor, project.project.id)
			expect(task.snapshot.status.sourcePolicy).toBe('filesystem_required')
			const checking = yield* report(task.snapshot, { _tag: 'SetupStarted' })
			const failure = yield* report(checking, {
				_tag: 'ManagedCloneRequested',
				sourcePath: '/managed/fallback',
			}).pipe(Effect.flip)
			expect(failure).toMatchObject({
				_tag: 'WorkspaceRepositoryProgressInvalid',
				message: expect.stringContaining('forbidden by the frozen filesystem source policy'),
			})
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('reads and updates launch sources from immutable workspace membership', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			const task = yield* makeTask(actor, project.project.id)
			const replacementRepository = {
				...repository,
				remoteUrl: 'https://github.com/humanlayer/other.git',
				repositoryIdentity: 'github.com/humanlayer/other',
			}
			yield* updateProject({
				actor,
				projectId: project.project.id,
				changes: { repositories: [replacementRepository] },
			})
			const before = yield* getProjectWorkspaceRepositorySources({
				actor,
				taskId: task.input.taskId,
				hostId: actor.hostId,
			})
			expect(before.repositories.map((candidate) => candidate.repositoryIdentity)).toEqual([
				repository.repositoryIdentity,
			])
			expect(before.placementExists).toBe(true)
			expect(before.sessionDirectory).toBe(`~/.humanlayer/workspaces/${task.input.slug}`)
			const updated = yield* upsertProjectWorkspaceRepositorySources({
				actor,
				taskId: task.input.taskId,
				hostId: actor.hostId,
				sources: { [repository.repositoryIdentity]: { kind: 'filesystem', path: '  ~/code/syncopate  ' } },
			})
			expect(updated.sources[repository.repositoryIdentity]).toEqual({
				kind: 'filesystem',
				path: '~/code/syncopate',
			})
			const invalid = yield* upsertProjectWorkspaceRepositorySources({
				actor,
				taskId: task.input.taskId,
				hostId: actor.hostId,
				sources: { [replacementRepository.repositoryIdentity]: { kind: 'managed_clone' } },
			}).pipe(Effect.flip)
			expect(invalid).toMatchObject({ _tag: 'RepositorySourcesInvalid' })
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('replaces a failed required filesystem source and retries managed setup atomically', () =>
		Effect.gen(function* () {
			const db = yield* PostgresDb
			const crypto = yield* Crypto.Crypto
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			yield* updateProject({ actor, projectId: project.project.id, changes: { private: true } })
			yield* selectPath(actor, project.project.id, '/missing/source')
			const task = yield* makeTask(actor, project.project.id)
			yield* db.query(
				db.client
					.update(taskOrganizationAcl)
					.set({ permission_level: 'read' })
					.where(eq(taskOrganizationAcl.task_id, task.input.taskId)),
			)
			const checking = yield* report(task.snapshot, { _tag: 'SetupStarted' })
			const failed = yield* report(checking, {
				_tag: 'StageFailed',
				stage: 'checking_source',
				error: { stage: 'checking_source', message: 'Configured checkout does not exist' },
			})
			const reader = { ...actor, userId: `reader-${yield* crypto.randomUUIDv7}`, hostId: actor.hostId }
			yield* db.query(
				db.client.insert(userSettings).values({
					organization_id: actor.organizationId,
					user_id: reader.userId,
					projects_v2_enabled: true,
				}),
			)
			yield* db.query(
				db.client.insert(taskUserAcl).values({
					task_id: task.input.taskId,
					subject_user_id: reader.userId,
					organization_id: actor.organizationId,
					resource_owner_user_id: actor.userId,
					permission_level: 'read',
					granted_by: actor.userId,
				}),
			)
			const unauthorized = yield* recoverProjectWorkspaceRepositorySource({
				actor: reader,
				taskId: task.input.taskId,
				hostId: reader.hostId,
				repositoryIdentity: repository.repositoryIdentity,
				expectedUpdatedAt: failed.status.updatedAt,
				source: { kind: 'managed_clone' },
			}).pipe(Effect.flip)
			expect(unauthorized).toMatchObject({ _tag: 'TaskPermissionDeniedError', required: 'edit' })
			const recovered = yield* recoverProjectWorkspaceRepositorySource({
				actor,
				taskId: task.input.taskId,
				hostId: actor.hostId,
				repositoryIdentity: repository.repositoryIdentity,
				expectedUpdatedAt: failed.status.updatedAt,
				source: { kind: 'managed_clone' },
			})
			expect(recovered.status).toMatchObject({
				status: 'checking_source',
				error: null,
				sourcePolicy: 'managed_clone',
				sourceKind: null,
				sourcePath: null,
			})
			expect(yield* storedLocations(actor)).toEqual([
				expect.objectContaining({ source_kind: 'managed_clone', source_path: null }),
			])
			const cloning = yield* report(recovered, {
				_tag: 'ManagedCloneRequested',
				sourcePath: '/managed/syncopate',
			})
			expect(cloning.status).toMatchObject({ status: 'cloning_source', sourcePath: '/managed/syncopate' })
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect(
		'captures malformed stored recipes and status JSON before returning a typed failure without advancing setup',
		() =>
			Effect.gen(function* () {
				const db = yield* PostgresDb
				for (const malformedField of ['repositories', 'materialization', 'accepted_skips']) {
					const actor = yield* seedActor()
					const project = yield* makeProject(actor)
					const task = yield* makeTask(actor, project.project.id)
					if (malformedField === 'repositories') {
						yield* db.query(
							db.client.execute(
								sql`UPDATE workspaces SET repositories = '{"invalid":true}'::jsonb WHERE id = ${task.input.workspaceId}`,
							),
						)
					} else if (malformedField === 'materialization') {
						yield* db.query(
							db.client.execute(
								sql`UPDATE workspace_repository_status_for_user_for_host SET materialization = '{"kind":"worktree","path":42}'::jsonb WHERE workspace_id = ${task.input.workspaceId}`,
							),
						)
					} else {
						yield* db.query(
							db.client.execute(
								sql`UPDATE workspace_repository_status_for_user_for_host SET accepted_skips = '{"invalid":true}'::jsonb WHERE workspace_id = ${task.input.workspaceId}`,
							),
						)
					}
					const errorLogs: unknown[] = []
					const logger = Logger.make<unknown, void>((options) => {
						if (options.logLevel === 'Error') errorLogs.push(options.message)
					})
					const before = yield* db.query(
						db.client
							.select()
							.from(workspaceRepositoryStatusForUserForHost)
							.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, task.input.workspaceId)),
					)
					const errors = yield* Effect.gen(function* () {
						const single = yield* getWorkspaceRepositoryStatusForUserForHost(task.snapshot.status).pipe(
							Effect.flip,
						)
						const progress = yield* report(task.snapshot, { _tag: 'SetupStarted' }).pipe(Effect.flip)
						return [single, progress]
					}).pipe(Effect.provide(Logger.layer([logger])))
					for (const error of errors)
						expect(error).toMatchObject({
							_tag: 'WorkspaceRepositoryProgressInvalid',
							message: 'Stored workspace repository snapshot is invalid',
						})
					expect(errorLogs).toHaveLength(2)
					for (const message of errorLogs)
						expect(message).toEqual([
							expect.objectContaining({ name: 'ZodError', issues: expect.any(Array) }),
						])
					expect(
						yield* db.query(
							db.client
								.select()
								.from(workspaceRepositoryStatusForUserForHost)
								.where(
									eq(workspaceRepositoryStatusForUserForHost.workspace_id, task.input.workspaceId),
								),
						),
					).toEqual(before)
					expect(yield* storedLocations(actor)).toEqual([])
				}
			}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect(
		'keeps targets independent of disconnected or unwritable candidate parents and preserves pinned roots on replay',
		() =>
			Effect.gen(function* () {
				const db = yield* PostgresDb
				const actor = yield* seedActor()
				const project = yield* makeProject(actor)
				for (const stalePath of ['/Volumes/DisconnectedDisk/repository', '/proc/unwritable/repository']) {
					yield* selectPath(actor, project.project.id, stalePath)
					const task = yield* makeTask(actor, project.project.id)
					const stableRoot = `~/.humanlayer/workspaces/${task.input.slug}`
					expect(task.snapshot.location.filePath).toBe(stableRoot)
					expect(task.snapshot.status.sourcePath).toBe(stalePath)
					// Null policy models a placement created before source preferences were frozen.
					yield* db.query(
						db.client
							.update(workspaceRepositoryStatusForUserForHost)
							.set({ source_policy: null })
							.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, task.input.workspaceId)),
					)
					const legacySnapshot = yield* getWorkspaceRepositoryStatusForUserForHost(task.snapshot.status)
					const checking = yield* report(legacySnapshot, { _tag: 'SetupStarted' })
					const cloning = yield* report(checking, {
						_tag: 'ManagedCloneRequested',
						sourcePath: '/managed/fallback',
					})
					const ready = yield* report(cloning, { _tag: 'ManagedCloneReady', sourcePath: '/managed/fallback' })
					expect(ready.location.filePath).toBe(stableRoot)
					yield* db.query(
						db.client
							.update(workspaceLocationsForUserForHost)
							.set({ file_path: '/existing/pinned/workspace' })
							.where(eq(workspaceLocationsForUserForHost.workspace_id, task.input.workspaceId)),
					)
					yield* createTaskV2({ ...task.input, actor })
					const pinned = yield* getWorkspaceRepositoryStatusForUserForHost(task.snapshot.status)
					expect(pinned.location.filePath).toBe('/existing/pinned/workspace')
				}
			}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('rejects credential-bearing recipes before persistence with generic errors', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const error = yield* createProject({
				actor,
				project: {
					name: 'Unsafe URL',
					private: false,
					repositories: [
						{ ...repository, remoteUrl: 'https://user:secret-token@github.com/humanlayer/syncopate.git' },
					],
				},
			}).pipe(Effect.flip)
			expect(error).toMatchObject({
				_tag: 'ProjectLocationInvalid',
				message: 'Repository URLs must not contain embedded credentials',
			})
			expect(String(error)).not.toContain('secret-token')
			const db = yield* PostgresDb
			expect(
				yield* db.query(
					db.client.select().from(projects).where(eq(projects.organization_id, actor.organizationId)),
				),
			).toEqual([])
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect(
		'isolates organization, user, host, and repository identities and projects only recipe repositories',
		() =>
			Effect.gen(function* () {
				const actor = yield* seedActor()
				const other = yield* seedActor()
				const project = yield* makeProject(actor)
				const db = yield* PostgresDb
				for (const scope of [
					actor,
					{ ...actor, organizationId: other.organizationId },
					{ ...actor, userId: other.userId },
					{ ...actor, hostId: other.hostId },
				]) {
					yield* db.transaction((tx) =>
						selectRepositoryLocationsWithExecutor(tx, {
							...scope,
							repositoryPaths: {
								[repository.repositoryIdentity]: `/${scope.organizationId}/${scope.userId}/${scope.hostId}`,
							},
						}),
					)
				}
				yield* db.transaction((tx) =>
					selectRepositoryLocationsWithExecutor(tx, {
						...actor,
						repositoryPaths: { 'github.com/humanlayer/another': '/another' },
					}),
				)
				const candidates = yield* readRepositoryLocations({
					...actor,
					repositoryIdentities: [repository.repositoryIdentity],
				})
				expect(candidates.map((candidate) => candidate.sourcePath)).toEqual([
					`/${actor.organizationId}/${actor.userId}/${actor.hostId}`,
				])
				const projection = yield* getProject({ actor, projectId: project.project.id, hostId: actor.hostId })
				expect(Object.keys(projection.location?.repositoryPaths ?? {})).toEqual([repository.repositoryIdentity])
			}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('late clone completion updates workspace status without changing the configured user path', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const first = yield* makeProject(actor)
			const second = yield* makeProject(actor)
			const task = yield* makeTask(actor, first.project.id)
			expect(task.snapshot.sourceCandidates).toEqual([])
			expect(task.snapshot.status.sourceKind).toBeNull()
			const checking = yield* report(task.snapshot, { _tag: 'SetupStarted' })
			const cloning = yield* report(checking, {
				_tag: 'ManagedCloneRequested',
				sourcePath: '/managed/repository',
			})
			expect(yield* storedLocations(actor)).toEqual([])
			yield* selectPath(actor, second.project.id, '/explicit/new')
			const selected = (yield* storedLocations(actor))[0]
			const ready = yield* report(cloning, { _tag: 'ManagedCloneReady', sourcePath: '/managed/repository' })
			expect(ready.status).toMatchObject({ sourceKind: 'managed_clone', sourcePath: '/managed/repository' })
			expect(ready.sourceCandidates).toEqual([])
			expect(
				(yield* storedLocations(actor)).find((location) => location.source_path === '/explicit/new'),
			).toEqual(selected)
			const replay = yield* report(cloning, {
				_tag: 'ManagedCloneReady',
				sourcePath: '/managed/incorrect-replay',
			}).pipe(Effect.flip)
			expect(replay).toMatchObject({
				_tag: 'WorkspaceRepositoryStatusChanged',
				snapshot: { status: { sourcePath: '/managed/repository' } },
			})
			expect(yield* storedLocations(actor)).toHaveLength(1)
			const next = yield* makeTask(actor, second.project.id)
			expect(next.snapshot.status.sourcePath).toBe('/explicit/new')
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect(
		'does not configure automatic sources for other projects and keeps workspace sources pinned through retry and replay',
		() =>
			Effect.gen(function* () {
				const actor = yield* seedActor()
				const first = yield* makeProject(actor)
				const second = yield* makeProject(actor)
				const task = yield* makeTask(actor, first.project.id)
				const checking = yield* report(task.snapshot, { _tag: 'SetupStarted' })
				const cloning = yield* report(checking, { _tag: 'ManagedCloneRequested', sourcePath: '/managed/reuse' })
				const ready = yield* report(cloning, { _tag: 'ManagedCloneReady', sourcePath: '/managed/reuse' })
				const sibling = yield* makeTask(actor, second.project.id)
				expect(sibling.snapshot.status).toMatchObject({
					sourceKind: null,
					sourcePath: null,
				})
				const failed = yield* report(ready, {
					_tag: 'StageFailed',
					stage: 'refreshing_source',
					error: { stage: 'refreshing_source', message: 'Temporary fetch failure' },
				})
				yield* selectPath(actor, second.project.id, '/explicit/later')
				const retried = yield* retryProjectWorkspaceRepositorySetup({
					actor,
					taskId: task.input.taskId,
					hostId: actor.hostId,
					repositoryIdentity: repository.repositoryIdentity,
					expectedUpdatedAt: failed.status.updatedAt,
				})
				expect(retried.status).toMatchObject({
					status: 'refreshing_source',
					sourceKind: 'managed_clone',
					sourcePath: '/managed/reuse',
					error: null,
				})
				const replay = yield* createTaskV2({ ...task.input, actor })
				expect(replay.result).toBe('already-exists')
				const refreshed = yield* report(retried, {
					_tag: 'SourceRefreshed',
					sourceKind: 'managed_clone',
					sourcePath: '/managed/reuse',
				})
				expect(refreshed.status.sourcePath).toBe('/managed/reuse')
				expect(refreshed.sourceCandidates).toEqual([])
				expect(yield* storedLocations(actor)).toHaveLength(1)
			}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('rejects stale generations and timestamps without remembering uncommitted sources', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			yield* selectPath(actor, project.project.id, '/configured')
			const task = yield* makeTask(actor, project.project.id)
			const db = yield* PostgresDb
			yield* db.query(
				db.client
					.delete(repositoryLocationsForUserForHost)
					.where(eq(repositoryLocationsForUserForHost.organization_id, actor.organizationId)),
			)
			const checking = yield* report(task.snapshot, { _tag: 'SetupStarted' })
			for (const stale of [
				{ ...checking, status: { ...checking.status, generation: checking.status.generation + 1 } },
				{ ...checking, status: { ...checking.status, updatedAt: checking.status.updatedAt - 1 } },
			]) {
				const error = yield* report(stale, {
					_tag: 'SourceChecked',
					sourceKind: 'filesystem',
					sourcePath: '/must-not-persist',
					repoAvailable: true,
				}).pipe(Effect.flip)
				expect(error).toMatchObject({ _tag: 'WorkspaceRepositoryStatusChanged' })
			}
			const invalid = yield* report(checking, {
				_tag: 'SourceChecked',
				sourceKind: 'filesystem',
				sourcePath: '/unavailable',
				repoAvailable: false,
			}).pipe(Effect.flip)
			expect(invalid).toMatchObject({ _tag: 'WorkspaceRepositoryProgressInvalid' })
			expect(yield* storedLocations(actor)).toEqual([])
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('persists only the winning status transition without configuring automatic sources', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			yield* selectPath(actor, project.project.id, '/configured')
			const task = yield* makeTask(actor, project.project.id)
			const db = yield* PostgresDb
			yield* db.query(
				db.client
					.delete(repositoryLocationsForUserForHost)
					.where(eq(repositoryLocationsForUserForHost.organization_id, actor.organizationId)),
			)
			const checking = yield* report(task.snapshot, { _tag: 'SetupStarted' })
			const results = yield* Effect.all(
				['/winner/a', '/winner/b'].map((sourcePath) =>
					report(checking, {
						_tag: 'SourceChecked',
						repoAvailable: true,
						sourceKind: 'filesystem',
						sourcePath,
					}).pipe(
						Effect.map((snapshot) => ({ accepted: true, snapshot })),
						Effect.catchTag('WorkspaceRepositoryStatusChanged', ({ snapshot }) =>
							Effect.succeed({ accepted: false, snapshot }),
						),
					),
				),
				{ concurrency: 2 },
			)
			expect(results.filter((result) => result.accepted)).toHaveLength(1)
			expect(yield* storedLocations(actor)).toEqual([])
			const persisted = yield* getWorkspaceRepositoryStatusForUserForHost(checking.status)
			expect(results.every((result) => result.snapshot.status.sourcePath === persisted.status.sourcePath)).toBe(
				true,
			)
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)

	it.effect('keeps old in-flight sources on workspace status and never changes configured paths on completion', () =>
		Effect.gen(function* () {
			const actor = yield* seedActor()
			const project = yield* makeProject(actor)
			const task = yield* makeTask(actor, project.project.id)
			const db = yield* PostgresDb
			yield* db.query(
				db.client
					.update(workspaceRepositoryStatusForUserForHost)
					.set({
						status: 'refreshing_source',
						repo_available: true,
						source_kind: 'filesystem',
						source_path: '/old/in-flight',
					})
					.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, task.input.workspaceId)),
			)
			const snapshot = yield* getWorkspaceRepositoryStatusForUserForHost({
				...actor,
				projectId: project.project.id,
				workspaceId: task.input.workspaceId,
				repositoryIdentity: repository.repositoryIdentity,
			})
			yield* report(snapshot, {
				_tag: 'SourceRefreshed',
				sourceKind: 'filesystem',
				sourcePath: '/old/in-flight',
			})
			expect(yield* storedLocations(actor)).toEqual([])
			yield* selectPath(actor, project.project.id, '/old/in-flight')
			const before = yield* storedLocations(actor)
			const next = yield* makeTask(actor, project.project.id)
			const checking = yield* report(next.snapshot, { _tag: 'SetupStarted' })
			yield* report(checking, {
				_tag: 'SourceChecked',
				repoAvailable: true,
				sourceKind: 'filesystem',
				sourcePath: '/old/in-flight',
			})
			expect(yield* storedLocations(actor)).toEqual(before)
		}).pipe(Effect.provide(repositoryLocationTestLayer())),
	)
})
