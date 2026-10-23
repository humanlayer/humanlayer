import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import type {
	WorkspaceSetupError,
	WorkspaceSetupStage,
	WorkspaceSetupState,
	WorkspaceSpec,
} from '@humanlayer/schemas/effect/workspace'
import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Clock, Effect, Layer } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { WorkspaceSetupServiceLive } from '../../src/effects/services/workspace-setup/workspace-setup.live'
import { WorkspaceSetupPersistenceLive } from '../../src/effects/services/workspace-setup/workspace-setup.persistence'
import { WorkspaceSetupService } from '../../src/effects/services/workspace-setup/workspace-setup.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const workspaceSpec: WorkspaceSpec = {
	specVersion: 1,
	directory: '~/projects/syncopate',
	workspaceBaseDirectory: '~/.humanlayer/workspaces/task',
	setupBlocksFirstSession: false,
	repos: [
		{
			localPath: '.',
			targetPath: '~/.humanlayer/workspaces/task/syncopate',
			branch: 'task',
			sourceRef: 'origin/main',
			copyGlobs: [],
			primary: true,
		},
	],
}

describe('WorkspaceSetupService', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let taskId: string

	beforeAll(async () => {
		const testDb = await createTestDb('workspace_setup_service_effect')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Workspace Setup Effect Tests', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to seed workspace setup test organization')
		organizationId = organization.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Workspace setup service test task',
				created_by: 'owner-user',
				resource_owner_user_id: 'owner-user',
				workspace_spec: workspaceSpec,
			})
			.returning()
		if (!task) throw new Error('Failed to seed workspace setup test task')
		taskId = task.id
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30_000)

	const makeLayer = () =>
		Layer.mergeAll(
			PostgresDbLive(db),
			WorkspaceSetupServiceLive.pipe(
				Layer.provide(WorkspaceSetupPersistenceLive),
				Layer.provide(PostgresDbLive(db)),
			),
		)

	const seedSetupRow = (input: {
		readonly hostId: string
		readonly taskId?: string
		readonly stage: WorkspaceSetupStage
		readonly error?: WorkspaceSetupError | null
		readonly secondRepoStage?: WorkspaceSetupStage
	}) => {
		return Effect.gen(function* () {
			const postgres = yield* PostgresDb
			const targetTaskId = input.taskId ?? taskId
			const state: WorkspaceSetupState = {
				specVersion: 1,
				startedAt: yield* Clock.currentTimeMillis,
				repos: [
					{ localPath: '.', status: input.stage },
					...(input.secondRepoStage ? [{ localPath: '../api', status: input.secondRepoStage }] : []),
				],
			}
			const [row] = yield* postgres.query(
				postgres.client
					.insert(taskWorkspaceSetupForHost)
					.values({
						organization_id: organizationId,
						task_id: targetTaskId,
						host_id: input.hostId,
						status: input.stage,
						workspace_setup_state: state,
						error: input.error ?? null,
					})
					.returning(),
			)
			if (!row) return yield* Effect.die('Failed to seed workspace setup row')
			return row
		})
	}

	const loadSetupRow = (rowId: string) =>
		Effect.gen(function* () {
			const postgres = yield* PostgresDb
			const [row] = yield* postgres.query(
				postgres.client
					.select()
					.from(taskWorkspaceSetupForHost)
					.where(eq(taskWorkspaceSetupForHost.id, rowId))
					.limit(1),
			)
			return row
		})

	const loadTask = (targetTaskId = taskId) =>
		Effect.gen(function* () {
			const postgres = yield* PostgresDb
			const [task] = yield* postgres.query(
				postgres.client.select().from(tasks).where(eq(tasks.id, targetTaskId)).limit(1),
			)
			return task
		})

	const createWorkspaceTask = (name: string) =>
		Effect.gen(function* () {
			const postgres = yield* PostgresDb
			const [task] = yield* postgres.query(
				postgres.client
					.insert(tasks)
					.values({
						organization_id: organizationId,
						name,
						created_by: 'owner-user',
						resource_owner_user_id: 'owner-user',
						workspace_spec: workspaceSpec,
					})
					.returning({ id: tasks.id }),
			)
			if (!task) return yield* Effect.die('Failed to create workspace setup test task')
			return task.id
		})

	it.effect('clears a matching retry error without advancing the repository', () => {
		const hostId = `host-retry-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* seedSetupRow({
				hostId,
				stage: 'setup_command',
				error: {
					localPath: '.',
					stage: 'setup_command',
					message: 'bun install failed',
					command: 'bun install',
					exitCode: 1,
				},
			})
			const service = yield* WorkspaceSetupService
			const result = yield* service.applyRetryIntent({
				organizationId,
				taskId,
				hostId,
				localPath: '.',
				stage: 'setup_command',
			})

			expect(result.row.error).toBeNull()
			expect(result.row.state.repos[0]?.status).toBe('setup_command')
			expect(result.transactionId).toMatch(/^\d+$/)

			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.error).toBeNull()
			expect(persisted?.workspace_setup_state.repos[0]?.status).toBe('setup_command')
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('rejects a stale retry and preserves the newer persisted error', () => {
		const hostId = `host-stale-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* seedSetupRow({
				hostId,
				stage: 'setup_command',
				error: { localPath: '.', stage: 'setup_command', message: 'newer failure' },
			})
			const service = yield* WorkspaceSetupService
			const error = yield* Effect.flip(
				service.applyRetryIntent({
					organizationId,
					taskId,
					hostId,
					localPath: '.',
					stage: 'copy_globs',
				}),
			)

			expect(error).toMatchObject({
				_tag: 'WorkspaceSetupIntentRejectedError',
				reason: 'retry_conflict',
			})

			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.error?.message).toBe('newer failure')
			expect(persisted?.workspace_setup_state.repos[0]?.status).toBe('setup_command')
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('records skip attribution, advances only the failed repo, and recomputes status', () => {
		const hostId = `host-skip-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* seedSetupRow({
				hostId,
				stage: 'copy_globs',
				secondRepoStage: 'done',
				error: { localPath: '.', stage: 'copy_globs', message: 'optional file missing' },
			})
			const service = yield* WorkspaceSetupService
			const result = yield* service.applySkipIntent({
				organizationId,
				taskId,
				hostId,
				localPath: '.',
				stage: 'copy_globs',
				userId: 'skipping-user',
			})

			expect(result.row.status).toBe('setup_command')
			expect(result.row.state.repos.find((repo) => repo.localPath === '.')?.status).toBe('setup_command')
			expect(result.row.state.repos.find((repo) => repo.localPath === '../api')?.status).toBe('done')
			expect(result.row.state.acceptedSkips?.[0]).toMatchObject({
				localPath: '.',
				stage: 'copy_globs',
				skippedByUserId: 'skipping-user',
				errorMessage: 'optional file missing',
			})

			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.status).toBe('setup_command')
			expect(persisted?.error).toBeNull()
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('rejects non-skippable preflight failures without changing persisted state', () => {
		const hostId = `host-nonskip-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* seedSetupRow({
				hostId,
				stage: 'preflight',
				error: { localPath: '.', stage: 'preflight', message: 'branch exists' },
			})
			const service = yield* WorkspaceSetupService
			const error = yield* Effect.flip(
				service.applySkipIntent({
					organizationId,
					taskId,
					hostId,
					localPath: '.',
					stage: 'preflight',
					userId: 'skipping-user',
				}),
			)

			expect(error).toMatchObject({
				_tag: 'WorkspaceSetupIntentRejectedError',
				reason: 'skip_not_allowed',
			})

			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.error?.stage).toBe('preflight')
			expect(persisted?.workspace_setup_state.acceptedSkips).toBeUndefined()
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('authorizes daemon progress by the row host and preserves state on mismatch', () => {
		const hostId = `host-daemon-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* seedSetupRow({ hostId, stage: 'preflight' })
			const service = yield* WorkspaceSetupService
			const error = yield* Effect.flip(
				service.applyDaemonProgressUpdate({
					organizationId,
					authenticatedHostId: `other-${randomUUID()}`,
					rowId: row.id,
					taskId,
					repo: { localPath: '.', status: 'worktree', preflight: { resolvedSourceCommit: 'abc123' } },
				}),
			)

			expect(error).toMatchObject({ _tag: 'WorkspaceSetupNotFoundError' })

			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.status).toBe('preflight')
			expect(persisted?.workspace_setup_state.repos[0]?.preflight).toBeUndefined()
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('merges daemon repo facts and derives the next summary status', () => {
		const hostId = `host-progress-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* seedSetupRow({ hostId, stage: 'preflight' })
			const service = yield* WorkspaceSetupService
			const result = yield* service.applyDaemonProgressUpdate({
				organizationId,
				authenticatedHostId: hostId,
				rowId: row.id,
				taskId,
				repo: { localPath: '.', status: 'worktree', preflight: { resolvedSourceCommit: 'abc123' } },
				error: null,
			})

			expect(result.row.status).toBe('worktree')
			expect(result.row.state.repos[0]).toMatchObject({
				localPath: '.',
				status: 'worktree',
				preflight: { resolvedSourceCommit: 'abc123' },
			})

			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.status).toBe('worktree')
			expect(persisted?.workspace_setup_state.repos[0]?.preflight?.resolvedSourceCommit).toBe('abc123')
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('pins the first preflight source commit on the task', () => {
		const hostId = `host-source-pin-${randomUUID()}`
		const sourceCommit = 'a'.repeat(40)
		return Effect.gen(function* () {
			const pinnedTaskId = yield* createWorkspaceTask('Workspace source commit pin test')
			const row = yield* seedSetupRow({ hostId, taskId: pinnedTaskId, stage: 'preflight' })
			const service = yield* WorkspaceSetupService
			yield* service.applyDaemonProgressUpdate({
				organizationId,
				authenticatedHostId: hostId,
				rowId: row.id,
				taskId: pinnedTaskId,
				repo: { localPath: '.', status: 'worktree', preflight: { resolvedSourceCommit: sourceCommit } },
			})

			const task = yield* loadTask(pinnedTaskId)
			expect(task?.workspace_spec?.repos[0]?.sourceCommit).toBe(sourceCommit)
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('advances setup without pinning when the persisted task workspace spec is malformed', () => {
		const hostId = `host-invalid-workspace-spec-${randomUUID()}`
		return Effect.gen(function* () {
			const invalidTaskId = yield* createWorkspaceTask('Invalid persisted workspace spec test')
			const row = yield* seedSetupRow({ hostId, taskId: invalidTaskId, stage: 'preflight' })
			const postgres = yield* PostgresDb
			yield* postgres.query(
				postgres.client.execute(
					sql`UPDATE ${tasks} SET workspace_spec = '{}'::jsonb WHERE id = ${invalidTaskId}`,
				),
			)

			const service = yield* WorkspaceSetupService
			const result = yield* service.applyDaemonProgressUpdate({
				organizationId,
				authenticatedHostId: hostId,
				rowId: row.id,
				taskId: invalidTaskId,
				repo: {
					localPath: '.',
					status: 'worktree',
					preflight: { resolvedSourceCommit: 'a'.repeat(40) },
				},
			})

			expect(result.row.status).toBe('worktree')
			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.status).toBe('worktree')
			expect(persisted?.workspace_setup_state.repos[0]?.preflight?.resolvedSourceCommit).toBe('a'.repeat(40))
			const task = yield* loadTask(invalidTaskId)
			expect(task?.workspace_spec).toEqual({})
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('does not pin preflight facts until the repository advances to worktree', () => {
		const hostId = `host-source-pending-${randomUUID()}`
		return Effect.gen(function* () {
			const pinnedTaskId = yield* createWorkspaceTask('Workspace pending source commit test')
			const row = yield* seedSetupRow({ hostId, taskId: pinnedTaskId, stage: 'setup_requested' })
			const service = yield* WorkspaceSetupService
			yield* service.applyDaemonProgressUpdate({
				organizationId,
				authenticatedHostId: hostId,
				rowId: row.id,
				taskId: pinnedTaskId,
				repo: { localPath: '.', status: 'preflight', preflight: { resolvedSourceCommit: 'a'.repeat(40) } },
			})

			const task = yield* loadTask(pinnedTaskId)
			expect(task?.workspace_spec?.repos[0]?.sourceCommit).toBeUndefined()
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('preserves the task source commit when a later host reports a different existing worktree commit', () => {
		const initialHostId = `host-source-first-${randomUUID()}`
		const conflictingHostId = `host-source-conflict-${randomUUID()}`
		const recordedSourceCommit = 'a'.repeat(40)
		return Effect.gen(function* () {
			const pinnedTaskId = yield* createWorkspaceTask('Workspace source commit conflict test')
			const initialRow = yield* seedSetupRow({
				hostId: initialHostId,
				taskId: pinnedTaskId,
				stage: 'preflight',
			})
			const conflictingRow = yield* seedSetupRow({
				hostId: conflictingHostId,
				taskId: pinnedTaskId,
				stage: 'preflight',
			})
			const service = yield* WorkspaceSetupService
			yield* service.applyDaemonProgressUpdate({
				organizationId,
				authenticatedHostId: initialHostId,
				rowId: initialRow.id,
				taskId: pinnedTaskId,
				repo: { localPath: '.', status: 'worktree', preflight: { resolvedSourceCommit: recordedSourceCommit } },
			})
			yield* service.applyDaemonProgressUpdate({
				organizationId,
				authenticatedHostId: conflictingHostId,
				rowId: conflictingRow.id,
				taskId: pinnedTaskId,
				repo: { localPath: '.', status: 'worktree', preflight: { resolvedSourceCommit: 'b'.repeat(40) } },
			})
			const task = yield* loadTask(pinnedTaskId)
			expect(task?.workspace_spec?.repos[0]?.sourceCommit).toBe(recordedSourceCommit)
		}).pipe(Effect.provide(makeLayer()))
	})

	it.effect('parses string-encoded JSONB before applying a retry transition', () => {
		const hostId = `host-jsonb-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* seedSetupRow({
				hostId,
				stage: 'setup_command',
				error: { localPath: '.', stage: 'setup_command', message: 'install failed' },
			})
			const encodedState = JSON.stringify(row.workspace_setup_state)
			const postgres = yield* PostgresDb
			yield* postgres.query(
				postgres.client.execute(
					sql`UPDATE ${taskWorkspaceSetupForHost} SET workspace_setup_state = to_jsonb(${encodedState}::text) WHERE id = ${row.id}`,
				),
			)

			const service = yield* WorkspaceSetupService
			const result = yield* service.applyRetryIntent({
				organizationId,
				taskId,
				hostId,
				localPath: '.',
				stage: 'setup_command',
			})

			expect(result.row.state.repos[0]?.status).toBe('setup_command')
			expect(result.row.error).toBeNull()
			const persisted = yield* loadSetupRow(row.id)
			expect(persisted?.workspace_setup_state).toMatchObject({
				repos: [{ localPath: '.', status: 'setup_command' }],
			})
		}).pipe(Effect.provide(makeLayer()))
	})
})
