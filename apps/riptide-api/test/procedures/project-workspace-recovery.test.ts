import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { createFilesystemWorkspaceActorFixture } from '@humanlayer/test-fixtures/project-workspaces'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getProjectWorkspaceStatusProcedure as liveGetStatus } from '../../src/orpc/api/project-workspaces/get-status.effect'
import { retryProjectWorkspaceRepositorySetupProcedure as liveRetry } from '../../src/orpc/api/project-workspaces/retry-repository-setup.effect'
import { skipProjectWorkspaceRepositorySetupStepProcedure as liveSkip } from '../../src/orpc/api/project-workspaces/skip-repository-setup-step.effect'
import { createMockApiContext, createMockStripeService, createMockWorkosService } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('project workspace setup status and recovery', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let getStatus: typeof liveGetStatus
	let retry: typeof liveRetry
	let skip: typeof liveSkip

	beforeAll(async () => {
		const testDb = await createTestDb('project-workspace-recovery')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		getStatus = bindProcedureToRuntime(liveGetStatus, runtime)
		retry = bindProcedureToRuntime(liveRetry, runtime)
		skip = bindProcedureToRuntime(liveSkip, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	async function setup(status: 'copying_files' | 'checking_source') {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/project-workspace-recovery',
			status,
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/syncopate.git',
					repositoryIdentity: 'github.com/humanlayer/syncopate',
					sourcePath: '/tmp/source',
				},
			],
		})
		const taskId = uuidv7()
		await db.insert(tasks).values({
			id: taskId,
			organization_id: fixture.organizationId,
			project_id: fixture.projectId,
			workspace_id: fixture.workspaceId,
			name: 'Recovery task',
			created_by: fixture.userId,
			resource_owner_user_id: fixture.userId,
		})
		await db.insert(onlineHosts).values({
			organization_id: fixture.organizationId,
			user_id: fixture.userId,
			host_id: fixture.hostId,
			status: 'online',
		})
		await db.insert(userSettings).values({
			organization_id: fixture.organizationId,
			user_id: fixture.userId,
			projects_v2_enabled: true,
		})
		await db
			.update(workspaceRepositoryStatusForUserForHost)
			.set({ error: { stage: status, message: `${status} failed` } })
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))
		const auth = {
			userId: fixture.userId,
			organizationId: fixture.organizationId,
			workosOrganizationId: `workos-${fixture.organizationId}`,
			role: '',
			roles: [] as string[],
			permissions: [] as string[],
			entitlements: [] as string[],
			sessionId: 'session',
		}
		const context = createMockApiContext({
			auth,
			services: { db, dbReadReplica: db, workos: createMockWorkosService(), stripe: createMockStripeService() },
		})
		return { fixture, taskId, context }
	}

	test('reads repository setup status and skips an allowed failed step', async () => {
		const { fixture, taskId, context } = await setup('copying_files')
		const before = await call(getStatus, { taskId }, { context })
		expect(before.materializations).toHaveLength(1)
		const repository = before.materializations[0]!.repositories[0]!
		expect(repository.status.error?.message).toBe('copying_files failed')

		const result = await call(
			skip,
			{
				taskId,
				hostId: fixture.hostId,
				repositoryIdentity: repository.status.repositoryIdentity,
				expectedUpdatedAt: repository.status.updatedAt,
			},
			{ context },
		)
		expect(result.repository.status).toMatchObject({
			status: 'running_setup_command',
			error: null,
			acceptedSkips: [{ stage: 'copying_files', skippedByUserId: fixture.userId }],
		})
	})

	test('groups repository setup status by owner and host', async () => {
		const { fixture, taskId, context } = await setup('copying_files')
		const secondHostId = `second-${fixture.hostId}`
		const [firstStatus] = await db
			.select()
			.from(workspaceRepositoryStatusForUserForHost)
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))
		if (!firstStatus) throw new Error('Expected fixture repository status')
		await db.insert(onlineHosts).values({
			organization_id: fixture.organizationId,
			user_id: fixture.userId,
			host_id: secondHostId,
			host_name: 'Second computer',
			status: 'online',
		})
		await db.insert(workspaceLocationsForUserForHost).values({
			organization_id: fixture.organizationId,
			project_id: fixture.projectId,
			workspace_id: fixture.workspaceId,
			user_id: fixture.userId,
			host_id: secondHostId,
			file_path: '/tmp/project-workspace-recovery-second-host',
		})
		await db.insert(workspaceRepositoryStatusForUserForHost).values({
			...firstStatus,
			host_id: secondHostId,
			materialization: {
				kind: 'worktree',
				path: '/tmp/project-workspace-recovery-second-host',
				branch: firstStatus.materialization?.branch ?? 'workspace-test',
			},
		})

		const result = await call(getStatus, { taskId }, { context })
		expect(result.materializations).toHaveLength(2)
		expect(result.materializations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ hostId: fixture.hostId, userId: fixture.userId }),
				expect.objectContaining({
					hostId: secondHostId,
					hostName: 'Second computer',
					userId: fixture.userId,
				}),
			]),
		)
		expect(result.materializations.every((materialization) => materialization.repositories.length === 1)).toBe(true)
	})

	test('retries the same stage and rejects stale recovery actions', async () => {
		const { fixture, taskId, context } = await setup('checking_source')
		const before = await call(getStatus, { taskId }, { context })
		const repository = before.materializations[0]!.repositories[0]!
		const input = {
			taskId,
			hostId: fixture.hostId,
			repositoryIdentity: repository.status.repositoryIdentity,
			expectedUpdatedAt: repository.status.updatedAt,
		}
		const result = await call(retry, input, { context })
		expect(result.repository.status).toMatchObject({ status: 'checking_source', error: null })
		await expect(call(retry, input, { context })).rejects.toMatchObject({ code: 'STATUS_CHANGED' })
		await expect(
			call(retry, { ...input, expectedUpdatedAt: result.repository.status.updatedAt }, { context }),
		).rejects.toMatchObject({ code: 'NOTHING_TO_RETRY' })
	})

	test('does not allow source failures to be skipped', async () => {
		const { fixture, taskId, context } = await setup('checking_source')
		const before = await call(getStatus, { taskId }, { context })
		const repository = before.materializations[0]!.repositories[0]!
		await expect(
			call(
				skip,
				{
					taskId,
					hostId: fixture.hostId,
					repositoryIdentity: repository.status.repositoryIdentity,
					expectedUpdatedAt: repository.status.updatedAt,
				},
				{ context },
			),
		).rejects.toMatchObject({ code: 'SKIP_NOT_ALLOWED' })
	})
})
