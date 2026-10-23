import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { createFilesystemWorkspaceActorFixture } from '@humanlayer/test-fixtures/project-workspaces'
import { ORPCError } from '@orpc/server'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getTaskWorkspaceContextProcedure as liveGetContext } from '../../src/orpc/daemon/project-workspaces/get-task-workspace-context.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon task workspace context', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let getContext: typeof liveGetContext

	beforeAll(async () => {
		const testDb = await createTestDb('task-workspace-context')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		getContext = bindProcedureToRuntime(liveGetContext, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	async function setup() {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/task-workspace-context',
			status: 'done',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/api.git',
					repositoryIdentity: 'github.com/humanlayer/api',
					sourcePath: '/tmp/source-api',
					default: true,
				},
				{
					remoteUrl: 'https://github.com/humanlayer/ui.git',
					repositoryIdentity: 'github.com/humanlayer/ui',
					sourcePath: '/tmp/source-ui',
				},
			],
		})
		const taskId = uuidv7()
		await db.insert(tasks).values({
			id: taskId,
			organization_id: fixture.organizationId,
			project_id: fixture.projectId,
			workspace_id: fixture.workspaceId,
			name: 'Context task',
			created_by: fixture.userId,
			resource_owner_user_id: fixture.userId,
		})
		const materializedPath = `${fixture.targetRoot}/api`
		await db
			.update(workspaceRepositoryStatusForUserForHost)
			.set({ materialization: { kind: 'worktree', path: materializedPath, branch: 'workspace-branch' } })
			.where(
				and(
					eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId),
					eq(workspaceRepositoryStatusForUserForHost.repository_identity, 'github.com/humanlayer/api'),
				),
			)
		const contextFor = (auth: Parameters<typeof createMockDaemonAuth>[0]) =>
			createMockDaemonContext({ auth: createMockDaemonAuth(auth), services: { db, dbReadReplica: db } })
		const ownerContext = contextFor({
			userId: fixture.userId,
			organizationId: fixture.organizationId,
			hostId: fixture.hostId,
		})
		return { fixture, taskId, materializedPath, contextFor, ownerContext }
	}

	test('returns the snapshot with this user/host materialization for every session of the task', async () => {
		const { fixture, taskId, materializedPath, ownerContext } = await setup()

		// First, later, and recovered sessions all read the same task-scoped context.
		const first = await call(getContext, { taskId }, { context: ownerContext })
		const later = await call(getContext, { taskId }, { context: ownerContext })
		expect(later).toEqual(first)

		expect(first.taskId).toBe(taskId)
		expect(first.workspace.id).toBe(fixture.workspaceId)
		expect(first.workspace.repositories.map((repository) => repository.repositoryIdentity)).toEqual([
			'github.com/humanlayer/api',
			'github.com/humanlayer/ui',
		])
		expect(first.materialization).not.toBeNull()
		expect(first.materialization?.location).toMatchObject({
			userId: fixture.userId,
			hostId: fixture.hostId,
			filePath: fixture.targetRoot,
			setupGeneration: 1,
		})
		expect(
			first.materialization?.repositories.map((status) => [
				status.repositoryIdentity,
				status.materialization?.path,
			]),
		).toEqual([
			['github.com/humanlayer/api', materializedPath],
			['github.com/humanlayer/ui', undefined],
		])

		// The read never fills legacy workspace JSON or the legacy per-host ledger.
		const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
		expect(task?.workspace_spec).toBeNull()
		expect(task?.workspace_state).toBeNull()
		expect(
			await db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.task_id, taskId)),
		).toEqual([])
	})

	test('another host of the same user sees the snapshot but no materialization', async () => {
		const { fixture, taskId, contextFor } = await setup()
		const elsewhere = await call(
			getContext,
			{ taskId },
			{
				context: contextFor({
					userId: fixture.userId,
					organizationId: fixture.organizationId,
					hostId: 'other-host',
				}),
			},
		)
		expect(elsewhere.workspace.id).toBe(fixture.workspaceId)
		expect(elsewhere.materialization).toBeNull()
	})

	test('another user never receives the owner placement and cannot read a task they lack access to', async () => {
		const { fixture, taskId, contextFor } = await setup()
		await expect(
			call(
				getContext,
				{ taskId },
				{
					context: contextFor({
						userId: 'someone-else',
						organizationId: fixture.organizationId,
						hostId: fixture.hostId,
					}),
				},
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('a task without a project workspace is not found', async () => {
		const { fixture, ownerContext } = await setup()
		const legacyTaskId = uuidv7()
		await db.insert(tasks).values({
			id: legacyTaskId,
			organization_id: fixture.organizationId,
			name: 'Legacy task',
			created_by: fixture.userId,
			resource_owner_user_id: fixture.userId,
		})
		const error = await call(getContext, { taskId: legacyTaskId }, { context: ownerContext }).catch(
			(caught: unknown) => caught,
		)
		expect(error).toBeInstanceOf(ORPCError)
		expect(error).toMatchObject({ code: 'NOT_FOUND' })
	})

	test('only current-generation status rows describe the materialization', async () => {
		const { fixture, taskId, ownerContext } = await setup()
		await db
			.update(workspaceLocationsForUserForHost)
			.set({ setup_generation: 2n })
			.where(eq(workspaceLocationsForUserForHost.workspace_id, fixture.workspaceId))
		const stale = await call(getContext, { taskId }, { context: ownerContext })
		expect(stale.materialization?.location.setupGeneration).toBe(2)
		expect(stale.materialization?.repositories).toEqual([])
	})
})
