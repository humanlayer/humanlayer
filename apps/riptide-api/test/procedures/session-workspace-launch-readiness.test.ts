import { describe, it } from '@effect/vitest'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import { WORKSPACE_REPOSITORY_SETUP_STAGES } from '@humanlayer/schemas/zod/project-workspace'
import { createFilesystemWorkspaceActorFixture } from '@humanlayer/test-fixtures/project-workspaces'
import { call } from '@orpc/server'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, expect } from 'vitest'

import { getSessionWorkspaceSetupProcedure as liveGetSetup } from '../../src/orpc/daemon/project-workspaces/get-session-workspace-setup.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('session workspace launch readiness', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let getSetup: typeof liveGetSetup

	beforeAll(async () => {
		const testDb = await createTestDb('session-workspace-launch-readiness')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		getSetup = bindProcedureToRuntime(liveGetSetup, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	async function setup() {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/launch-readiness',
			status: 'done',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/api.git',
					repositoryIdentity: 'github.com/humanlayer/api',
					sourcePath: '/tmp/source-api',
				},
				{
					remoteUrl: 'https://github.com/humanlayer/ui.git',
					repositoryIdentity: 'github.com/humanlayer/ui',
					sourcePath: '/tmp/source-ui',
					default: true,
				},
			],
		})
		const taskId = uuidv7()
		const sessionId = uuidv7()
		await db.insert(tasks).values({
			id: taskId,
			organization_id: fixture.organizationId,
			project_id: fixture.projectId,
			workspace_id: fixture.workspaceId,
			name: 'Launch readiness task',
			created_by: fixture.userId,
			resource_owner_user_id: fixture.userId,
		})
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: fixture.organizationId,
			task_id: taskId,
			resource_owner_user_id: fixture.userId,
			created_by: fixture.userId,
			host_id: fixture.hostId,
			title: 'Launch readiness session',
			working_directory: fixture.targetRoot,
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'waiting_for_workspace',
		})
		const statusScope = eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId)
		for (const repository of fixture.repositories) {
			await db
				.update(workspaceRepositoryStatusForUserForHost)
				.set({
					materialization: {
						kind: 'worktree',
						path: `${fixture.targetRoot}/${repository.repositoryIdentity}`,
						branch: repository.branch,
					},
				})
				.where(
					and(
						statusScope,
						eq(workspaceRepositoryStatusForUserForHost.repository_identity, repository.repositoryIdentity),
					),
				)
		}
		const context = createMockDaemonContext({
			auth: createMockDaemonAuth(fixture),
			services: { db, dbReadReplica: db },
		})
		const input = { sessionId, workspaceId: fixture.workspaceId }
		const statusRows = () =>
			db
				.select()
				.from(workspaceRepositoryStatusForUserForHost)
				.where(statusScope)
				.orderBy(asc(workspaceRepositoryStatusForUserForHost.repository_identity))
		const read = async () => {
			const before = await statusRows()
			try {
				return await call(getSetup, input, { context })
			} finally {
				expect(await statusRows()).toEqual(before)
			}
		}
		const updateStatus = (values: Partial<typeof workspaceRepositoryStatusForUserForHost.$inferInsert>) =>
			db
				.update(workspaceRepositoryStatusForUserForHost)
				.set(values)
				.where(
					and(
						statusScope,
						eq(workspaceRepositoryStatusForUserForHost.repository_identity, 'github.com/humanlayer/api'),
					),
				)
		return { ...fixture, taskId, sessionId, statusScope, statusRows, updateStatus, read, context, input }
	}

	it.effect('launches the materialized snapshot and uses its designated default repository path', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			const result = await fixture.read()
			expect(result.ready).toBe(true)
			expect(result.sessionStatus).toBe('waiting_for_workspace')
			expect(result.defaultWorkingDirectory).toBe('/tmp/launch-readiness/github.com/humanlayer/ui')
			expect(result.repositories).toEqual([
				{
					repositoryIdentity: 'github.com/humanlayer/api',
					default: false,
					status: 'done',
					worktreePath: '/tmp/launch-readiness/github.com/humanlayer/api',
				},
				{
					repositoryIdentity: 'github.com/humanlayer/ui',
					default: true,
					status: 'done',
					worktreePath: '/tmp/launch-readiness/github.com/humanlayer/ui',
				},
			])
		}),
	)

	for (const status of WORKSPACE_REPOSITORY_SETUP_STAGES.filter((stage) => stage !== 'done')) {
		it.effect(`launches a persisted materialized repository without waiting for ${status}`, () =>
			Effect.promise(async () => {
				const fixture = await setup()
				await fixture.updateStatus({ status })
				expect((await fixture.read()).ready).toBe(true)
			}),
		)
	}

	it.effect('allows setup failures and publication warnings without requiring accepted skips', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await fixture.updateStatus({ error: { stage: 'running_setup_command', message: 'setup failed' } })
			expect((await fixture.read()).ready).toBe(true)
			await fixture.updateStatus({
				error: null,
				branch_publish_status: 'warning',
				accepted_skips: [
					{ stage: 'copying_files', message: 'copy skipped', skippedByUserId: fixture.userId, skippedAt: 1 },
					{
						stage: 'running_setup_command',
						message: 'setup skipped',
						skippedByUserId: fixture.userId,
						skippedAt: 2,
					},
				],
			})
			expect((await fixture.read()).ready).toBe(true)
			await fixture.updateStatus({ status: 'running_setup_command' })
			expect((await fixture.read()).ready).toBe(true)
		}),
	)

	for (const status of ['publishing_branch', 'copying_files', 'running_setup_command'] as const) {
		it.effect(
			`launches mixed materialized stages even when ${status} fails, but waits for one missing worktree`,
			() =>
				Effect.promise(async () => {
					const fixture = await setup()
					await db
						.update(workspaceRepositoryStatusForUserForHost)
						.set({ status: 'running_setup_command' })
						.where(fixture.statusScope)
					await fixture.updateStatus({ status })
					expect((await fixture.read()).ready).toBe(true)
					await fixture.updateStatus({ error: { stage: status, message: 'post-materialization failure' } })
					expect((await fixture.read()).ready).toBe(true)
					await fixture.updateStatus({ materialization: null })
					expect((await fixture.read()).ready).toBe(false)
				}),
		)
	}

	it.effect('blocks pre-materialization failures even with an inconsistent persisted path', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await fixture.updateStatus({
				status: 'materializing',
				error: { stage: 'materializing', message: 'worktree creation failed' },
			})
			expect((await fixture.read()).ready).toBe(false)
			await fixture.updateStatus({ materialization: null })
			expect((await fixture.read()).ready).toBe(false)
		}),
	)

	it.effect('blocks old generations, hides their paths, and becomes ready after current completion', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await db
				.update(workspaceLocationsForUserForHost)
				.set({ setup_generation: 2n })
				.where(eq(workspaceLocationsForUserForHost.workspace_id, fixture.workspaceId))
			const stale = await fixture.read()
			expect(stale.ready).toBe(false)
			expect(stale.defaultWorkingDirectory).toBe(fixture.targetRoot)
			expect(
				stale.repositories.every(
					(repository) => repository.worktreePath === null && repository.status === 'setup_requested',
				),
			).toBe(true)
			await db.update(workspaceRepositoryStatusForUserForHost).set({ generation: 2n }).where(fixture.statusScope)
			expect((await fixture.read()).ready).toBe(true)
			await fixture.updateStatus({ generation: 3n })
			expect((await fixture.read()).ready).toBe(false)
		}),
	)

	it.effect('requires exact identity coverage rather than just matching row counts', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await fixture.updateStatus({ repository_identity: 'github.com/humanlayer/unexpected' })
			expect((await fixture.read()).ready).toBe(false)
			await db.delete(workspaceRepositoryStatusForUserForHost).where(fixture.statusScope)
			const missing = await fixture.read()
			expect(missing.ready).toBe(false)
			expect(missing.repositories).toHaveLength(2)
		}),
	)

	it.effect('does not launch with extra repository rows', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			const [status] = await fixture.statusRows()
			if (!status) throw new Error('Expected fixture status')
			await db
				.insert(workspaceRepositoryStatusForUserForHost)
				.values({ ...status, repository_identity: 'github.com/humanlayer/extra' })
			expect((await fixture.read()).ready).toBe(false)
		}),
	)

	it.effect('does not borrow another owner or host materialization', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await fixture.updateStatus({ host_id: 'other-host' })
			expect((await fixture.read()).ready).toBe(false)
			await db
				.update(workspaceRepositoryStatusForUserForHost)
				.set({ host_id: fixture.hostId, user_id: 'other-user' })
				.where(
					and(
						fixture.statusScope,
						eq(workspaceRepositoryStatusForUserForHost.repository_identity, 'github.com/humanlayer/api'),
					),
				)
			expect((await fixture.read()).ready).toBe(false)
		}),
	)

	it.effect('blocks archived workspaces and missing materialization including the default', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await db.update(workspaces).set({ archived: true }).where(eq(workspaces.id, fixture.workspaceId))
			expect((await fixture.read()).ready).toBe(false)
			await db.update(workspaces).set({ archived: false }).where(eq(workspaces.id, fixture.workspaceId))
			await db
				.update(workspaceRepositoryStatusForUserForHost)
				.set({ materialization: null })
				.where(fixture.statusScope)
			const missing = await fixture.read()
			expect(missing.ready).toBe(false)
			expect(missing.defaultWorkingDirectory).toBe(fixture.targetRoot)
		}),
	)

	for (const materialization of [
		{ path: '/tmp/path-only' },
		{ kind: 'worktree', path: '', branch: 'main' },
		{ kind: 'worktree', path: 42, branch: 'main' },
	]) {
		it.effect(`rejects malformed materialization JSON ${JSON.stringify(materialization)}`, () =>
			Effect.promise(async () => {
				const fixture = await setup()
				await db
					.update(workspaceRepositoryStatusForUserForHost)
					.set({ materialization: sql`${JSON.stringify(materialization)}::jsonb` })
					.where(fixture.statusScope)
				await expect(fixture.read()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
			}),
		)
	}

	it.effect('blocks blank paths and rejects an invalid default fallback directory', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await fixture.updateStatus({ materialization: { kind: 'worktree', path: '   ', branch: 'main' } })
			expect((await fixture.read()).ready).toBe(false)
			await db
				.update(workspaceRepositoryStatusForUserForHost)
				.set({ materialization: null })
				.where(fixture.statusScope)
			await db
				.update(workspaceLocationsForUserForHost)
				.set({ file_path: '' })
				.where(eq(workspaceLocationsForUserForHost.workspace_id, fixture.workspaceId))
			await expect(fixture.read()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
		}),
	)

	it.effect('parses stored errors and accepted skips instead of trusting JSONB types', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await db
				.update(workspaceRepositoryStatusForUserForHost)
				.set({ error: sql`'{"message": 42}'::jsonb` })
				.where(fixture.statusScope)
			await expect(fixture.read()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
			await db
				.update(workspaceRepositoryStatusForUserForHost)
				.set({ error: null, accepted_skips: sql`'[{"stage":"checking_source"}]'::jsonb` })
				.where(fixture.statusScope)
			await expect(fixture.read()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
		}),
	)

	it.effect('rejects malformed or empty snapshot JSON rather than vacuously launching', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			for (const repositories of [
				[],
				{},
				fixture.repositories.map((repository) => ({ ...repository, default: false })),
				[fixture.repositories[0], fixture.repositories[0]],
			]) {
				await db
					.update(workspaces)
					.set({ repositories: sql`${JSON.stringify(repositories)}::jsonb` })
					.where(eq(workspaces.id, fixture.workspaceId))
				await expect(fixture.read()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
			}
		}),
	)

	// The daemon tuple that owns the launch is (created_by, host_id): the same check the daemon
	// session update procedure applies.
	for (const field of ['created_by', 'host_id'] as const) {
		it.effect(`requires the session ${field} even when caller materializations exist`, () =>
			Effect.promise(async () => {
				const fixture = await setup()
				await db
					.update(sessions)
					.set({ [field]: 'another-identity' })
					.where(eq(sessions.id, fixture.sessionId))
				await expect(fixture.read()).rejects.toMatchObject({ code: 'NOT_FOUND' })
			}),
		)
	}

	it.effect('serves collaborator sessions the daemon user created on a task and workspace owned by others', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await db
				.update(sessions)
				.set({ resource_owner_user_id: 'task-owner' })
				.where(eq(sessions.id, fixture.sessionId))
			await db.update(tasks).set({ resource_owner_user_id: 'task-owner' }).where(eq(tasks.id, fixture.taskId))
			await db
				.update(workspaces)
				.set({ resource_owner_user_id: 'workspace-owner', created_by: 'workspace-owner' })
				.where(eq(workspaces.id, fixture.workspaceId))
			const result = await fixture.read()
			expect(result.ready).toBe(true)
			expect(result.sessionStatus).toBe('waiting_for_workspace')
			// Readiness still comes only from the calling user/host placement, never the owners'.
			await db
				.update(workspaceRepositoryStatusForUserForHost)
				.set({ user_id: 'workspace-owner' })
				.where(fixture.statusScope)
			expect((await fixture.read()).ready).toBe(false)
		}),
	)

	it.effect('reports the authoritative session status alongside readiness', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			for (const status of ['ready_for_launch', 'launching', 'running', 'failed'] as const) {
				await db.update(sessions).set({ status }).where(eq(sessions.id, fixture.sessionId))
				const result = await fixture.read()
				expect(result.sessionStatus).toBe(status)
				expect(result.ready).toBe(true)
			}
		}),
	)

	it.effect('requires the workspace association and organization', () =>
		Effect.promise(async () => {
			const fixture = await setup()
			await expect(
				call(getSetup, { ...fixture.input, workspaceId: uuidv7() }, { context: fixture.context }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			const foreignContext = createMockDaemonContext({
				auth: createMockDaemonAuth({ ...fixture, organizationId: uuidv7() }),
				services: { db, dbReadReplica: db },
			})
			await expect(call(getSetup, fixture.input, { context: foreignContext })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			})
		}),
	)
})
