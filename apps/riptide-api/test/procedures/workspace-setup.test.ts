import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import type {
	WorkspaceSetupError,
	WorkspaceSetupStage,
	WorkspaceSetupState,
} from '@humanlayer/schemas/effect/workspace'
import { call, isDefinedError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { retryWorkspaceSetupStepProcedure as liveRetryWorkspaceSetupStepProcedure } from '../../src/orpc/api/workspace-setup/retry-step'
import { skipWorkspaceSetupStepProcedure as liveSkipWorkspaceSetupStepProcedure } from '../../src/orpc/api/workspace-setup/skip-step'
import { updateWorkspaceSetupRepositoryDirectoryProcedure as liveUpdateWorkspaceSetupRepositoryDirectoryProcedure } from '../../src/orpc/api/workspace-setup/update-repository-directory'
import { updateDaemonWorkspaceSetupProcedure as liveUpdateDaemonWorkspaceSetupProcedure } from '../../src/orpc/daemon/workspace-setup/update'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('workspace setup procedures', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let organizationId: string
	let taskId: string

	const ownerUserId = 'workspace-setup-owner'
	const workosOrganizationId = `workos-workspace-setup-${randomUUID()}`
	const workspaceSpec = {
		specVersion: 1,
		directory: '/creator/team-a/app',
		workspaceBaseDirectory: '/workspaces/task',
		setupBlocksFirstSession: false,
		repos: [
			{
				localPath: '.',
				targetPath: '/workspaces/task/app',
				branch: 'task',
				sourceRef: 'main',
				copyGlobs: [],
				primary: true,
			},
			{
				localPath: '../../team-b/api',
				targetPath: '/workspaces/task/api',
				branch: 'task',
				sourceRef: 'main',
				copyGlobs: [],
				primary: false,
			},
		],
	}

	beforeAll(async () => {
		const testDb = await createTestDb('workspace_setup_procedures')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		runtime = createRuntimeWithTestPostgresLayer(db)

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Workspace Setup Procedures', workos_organization_id: workosOrganizationId })
			.returning()
		if (!organization) throw new Error('Failed to seed workspace setup procedure organization')
		organizationId = organization.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Workspace setup procedure task',
				created_by: ownerUserId,
				resource_owner_user_id: ownerUserId,
				workspace_spec: workspaceSpec,
			})
			.returning()
		if (!task) throw new Error('Failed to seed workspace setup procedure task')
		taskId = task.id
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30_000)

	const retryProcedure = () => bindProcedureToRuntime(liveRetryWorkspaceSetupStepProcedure, runtime)
	const skipProcedure = () => bindProcedureToRuntime(liveSkipWorkspaceSetupStepProcedure, runtime)
	const daemonUpdateProcedure = () => bindProcedureToRuntime(liveUpdateDaemonWorkspaceSetupProcedure, runtime)
	const updateRepositoryDirectoryProcedure = () =>
		bindProcedureToRuntime(liveUpdateWorkspaceSetupRepositoryDirectoryProcedure, runtime)

	const apiContext = () => ({
		auth: {
			userId: ownerUserId,
			organizationId,
			workosOrganizationId,
			role: '',
			roles: [],
			permissions: [],
			entitlements: [],
			sessionId: `session-${ownerUserId}`,
		},
	})

	const daemonContext = (hostId: string) => ({
		auth: { userId: ownerUserId, organizationId, hostId },
	})

	const seedSetupRow = async (input: {
		readonly hostId: string
		readonly stage: WorkspaceSetupStage
		readonly error?: WorkspaceSetupError | null
		readonly secondRepoStage?: WorkspaceSetupStage
	}) => {
		const state: WorkspaceSetupState = {
			specVersion: 1,
			startedAt: Date.now(),
			repos: [
				{ localPath: '.', status: input.stage },
				...(input.secondRepoStage ? [{ localPath: '../api', status: input.secondRepoStage }] : []),
			],
		}
		const [row] = await db
			.insert(taskWorkspaceSetupForHost)
			.values({
				organization_id: organizationId,
				task_id: taskId,
				host_id: input.hostId,
				status: input.stage,
				workspace_setup_state: state,
				error: input.error ?? null,
			})
			.returning()
		if (!row) throw new Error('Failed to seed workspace setup procedure row')
		return row
	}

	const expectDefinedProcedureError = (error: unknown, code: string) => {
		expect(isDefinedError(error)).toBe(true)
		if (typeof error !== 'object' || error === null || !('code' in error)) throw error
		expect(error.code).toBe(code)
	}

	it.effect('retries the current failure without advancing the repository', () => {
		const hostId = `host-retry-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* Effect.promise(() =>
				seedSetupRow({
					hostId,
					stage: 'setup_command',
					error: { localPath: '.', stage: 'setup_command', message: 'bun install failed' },
				}),
			)

			const result = yield* Effect.promise(() =>
				call(
					retryProcedure(),
					{ taskId, hostId, localPath: '.', stage: 'setup_command' },
					{ context: apiContext() },
				),
			)
			expect(result.transactionId).toMatch(/^\d+$/)

			const [persisted] = yield* Effect.promise(() =>
				db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.id, row.id)).limit(1),
			)
			expect(persisted?.error).toBeNull()
			expect(persisted?.status).toBe('setup_command')
			expect(persisted?.workspace_setup_state.repos[0]?.status).toBe('setup_command')
		})
	})

	it.effect('replaces a completed repository mapping and resets the full setup ledger', () => {
		const hostId = `host-repository-location-${randomUUID()}`
		return Effect.gen(function* () {
			yield* Effect.promise(() =>
				db.insert(onlineHosts).values({
					host_id: hostId,
					organization_id: organizationId,
					user_id: ownerUserId,
				}),
			)
			const row = yield* Effect.promise(() =>
				seedSetupRow({
					hostId,
					stage: 'done',
					secondRepoStage: 'done',
				}),
			)

			const result = yield* Effect.promise(() =>
				call(
					updateRepositoryDirectoryProcedure(),
					{
						taskId,
						hostId,
						repositoryDirectory: '/new/repos',
						expectedUpdatedAt: row.updated_at.toString(),
					},
					{ context: apiContext() },
				),
			)
			expect(result.transactionId).toMatch(/^\d+$/)

			const [persisted] = yield* Effect.promise(() =>
				db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.id, row.id)).limit(1),
			)
			expect(persisted?.error).toBeNull()
			expect(persisted?.status).toBe('setup_requested')
			expect(persisted?.updated_at).toBeGreaterThan(row.updated_at)
			expect(persisted?.workspace_setup_state).toEqual({
				specVersion: 1,
				repos: [
					{ localPath: '.', status: 'setup_requested' },
					{ localPath: '../../team-b/api', status: 'setup_requested' },
				],
			})
			expect(persisted?.resolved_workspace_spec).toMatchObject({
				directory: '/new/repos/team-a/app',
				repos: [{ localPath: '.' }, { localPath: '../../team-b/api' }],
			})
		})
	})

	it.effect('serializes concurrent retry intents so only one stale client succeeds', () => {
		const hostId = `host-concurrent-retry-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* Effect.promise(() =>
				seedSetupRow({
					hostId,
					stage: 'copy_globs',
					error: { localPath: '.', stage: 'copy_globs', message: 'copy failed' },
				}),
			)
			const invokeRetry = () =>
				call(
					retryProcedure(),
					{ taskId, hostId, localPath: '.', stage: 'copy_globs' },
					{ context: apiContext() },
				)
			const outcomes = yield* Effect.promise(() => Promise.allSettled([invokeRetry(), invokeRetry()]))

			expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
			const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
			expect(rejected).toBeDefined()
			if (rejected?.status === 'rejected') expectDefinedProcedureError(rejected.reason, 'BAD_REQUEST')

			const [persisted] = yield* Effect.promise(() =>
				db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.id, row.id)).limit(1),
			)
			expect(persisted?.error).toBeNull()
			expect(persisted?.workspace_setup_state.repos[0]?.status).toBe('copy_globs')
		})
	})

	it.effect('skips an allowed failure, records attribution, and recomputes status', () => {
		const hostId = `host-skip-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* Effect.promise(() =>
				seedSetupRow({
					hostId,
					stage: 'copy_globs',
					secondRepoStage: 'done',
					error: { localPath: '.', stage: 'copy_globs', message: 'optional file missing' },
				}),
			)

			yield* Effect.promise(() =>
				call(
					skipProcedure(),
					{ taskId, hostId, localPath: '.', stage: 'copy_globs' },
					{ context: apiContext() },
				),
			)

			const [persisted] = yield* Effect.promise(() =>
				db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.id, row.id)).limit(1),
			)
			expect(persisted?.status).toBe('setup_command')
			expect(persisted?.error).toBeNull()
			expect(persisted?.workspace_setup_state.repos).toEqual([
				expect.objectContaining({ localPath: '.', status: 'setup_command' }),
				expect.objectContaining({ localPath: '../api', status: 'done' }),
			])
			expect(persisted?.workspace_setup_state.acceptedSkips?.[0]).toMatchObject({
				localPath: '.',
				stage: 'copy_globs',
				skippedByUserId: ownerUserId,
				errorMessage: 'optional file missing',
			})
		})
	})

	it.effect('rejects a stale retry without clearing the current daemon error', () => {
		const hostId = `host-stale-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* Effect.promise(() =>
				seedSetupRow({
					hostId,
					stage: 'setup_command',
					error: { localPath: '.', stage: 'setup_command', message: 'new daemon failure' },
				}),
			)
			const error = yield* Effect.tryPromise({
				try: () =>
					call(
						retryProcedure(),
						{ taskId, hostId, localPath: '.', stage: 'copy_globs' },
						{ context: apiContext() },
					),
				catch: (cause) => cause,
			}).pipe(Effect.flip)
			expectDefinedProcedureError(error, 'BAD_REQUEST')

			const [persisted] = yield* Effect.promise(() =>
				db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.id, row.id)).limit(1),
			)
			expect(persisted?.error?.message).toBe('new daemon failure')
			expect(persisted?.workspace_setup_state.repos[0]?.status).toBe('setup_command')
		})
	})

	it.effect('authorizes daemon updates from the token host and rejects stale progress', () => {
		const hostId = `host-daemon-${randomUUID()}`
		return Effect.gen(function* () {
			const row = yield* Effect.promise(() => seedSetupRow({ hostId, stage: 'preflight' }))
			const updateInput = {
				rowId: row.id,
				taskId,
				repo: { localPath: '.', status: 'worktree' as const, preflight: { resolvedSourceCommit: 'abc123' } },
				error: null,
			}

			const unauthorized = yield* Effect.tryPromise({
				try: () => call(daemonUpdateProcedure(), updateInput, { context: daemonContext('different-host') }),
				catch: (cause) => cause,
			}).pipe(Effect.flip)
			expectDefinedProcedureError(unauthorized, 'NOT_FOUND')

			const result = yield* Effect.promise(() =>
				call(daemonUpdateProcedure(), updateInput, { context: daemonContext(hostId) }),
			)
			expect(result.transactionId).toMatch(/^\d+$/)

			const stale = yield* Effect.tryPromise({
				try: () =>
					call(
						daemonUpdateProcedure(),
						{ rowId: row.id, taskId, repo: { localPath: '.', status: 'preflight' } },
						{ context: daemonContext(hostId) },
					),
				catch: (cause) => cause,
			}).pipe(Effect.flip)
			expectDefinedProcedureError(stale, 'BAD_REQUEST')

			const [persisted] = yield* Effect.promise(() =>
				db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.id, row.id)).limit(1),
			)
			expect(persisted?.status).toBe('worktree')
			expect(persisted?.workspace_setup_state.repos[0]).toMatchObject({
				localPath: '.',
				status: 'worktree',
				preflight: { resolvedSourceCommit: 'abc123' },
			})
		})
	})
})
