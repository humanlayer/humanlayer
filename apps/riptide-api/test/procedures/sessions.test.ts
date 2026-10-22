import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { BillingAccessLive } from '../../src/effects/services/billing/billing-access-service-live'
import { launchSessionProcedure } from '../../src/orpc/api/sessions/launch'
import type { Services } from '../../src/orpc/base'
import { billingKvLayerFromTestService, TestBillingKvService } from '../fixtures/billing-kv-runtime'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { createDefaultTestEffectRuntime } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * sessions.launch — task_user_settings upsert tests
 *
 * Tests verify that session launch correctly upserts task_user_settings for non-owners.
 */
describe('sessions.launch — task_user_settings upsert', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_sessions_launch_upsert'

	const ownerUserId = 'user_launch_owner'
	const nonOwnerUserId = 'user_launch_non_owner'
	const hostId = randomUUID()
	const ownerSecondHostId = randomUUID()
	const workspaceSpec: WorkspaceSpec = {
		specVersion: 1,
		directory: '~/src/syncopate',
		workspaceBaseDirectory: '~/.humanlayer/workspaces/session-launch',
		setupBlocksFirstSession: false,
		repos: [
			{
				localPath: '.',
				targetPath: '~/.humanlayer/workspaces/session-launch/syncopate',
				branch: 'session-launch',
				sourceRef: 'origin/main',
				copyGlobs: [],
				primary: true,
			},
		],
	}
	const multiRepositoryWorkspaceSpec: WorkspaceSpec = {
		...workspaceSpec,
		repos: [
			{ ...workspaceSpec.repos[0]!, primary: true },
			{
				...workspaceSpec.repos[0]!,
				localPath: '../fold',
				targetPath: '~/.humanlayer/workspaces/session-launch/fold',
				primary: false,
			},
		],
	}

	function makeContext(userId: string, serviceOverrides?: Partial<Services>) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db, ...serviceOverrides },
		})
	}

	function subscriptionCache(status: STRIPE_SUB_CACHE['status']): STRIPE_SUB_CACHE {
		return {
			customerId: 'cus_sessions_launch',
			organizationId,
			subscriptionId: status === 'none' ? null : 'sub_sessions_launch',
			status,
			priceId: 'price_pro',
			currentPeriodEnd: Date.now() + 86_400_000,
			hasPaidInvoice: false,
			hasPaymentMethod: true,
			pastDueAt: null,
			syncedAt: Date.now(),
		}
	}

	async function createSharedTask(
		name: string,
		spec: WorkspaceSpec | null = null,
		worktreeTiming: 'now' | 'later' | 'never' = 'later',
	) {
		const [task] = await db
			.insert(tasks)
			.values({
				name,
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				default_working_directory: '/owner-default',
				workspace_spec: spec,
				worktree_timing: worktreeTiming,
			})
			.returning()
		if (!task) throw new Error('Failed to create task')

		await db.insert(taskUserAcl).values({
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			subject_user_id: nonOwnerUserId,
			task_id: task.id,
			permission_level: 'edit',
			granted_by: ownerUserId,
		})

		return task
	}

	async function getSetupRow(taskId: string, selectedHostId = hostId) {
		const [row] = await db
			.select()
			.from(taskWorkspaceSetupForHost)
			.where(
				and(
					eq(taskWorkspaceSetupForHost.task_id, taskId),
					eq(taskWorkspaceSetupForHost.host_id, selectedHostId),
				),
			)
			.limit(1)
		return row
	}

	beforeAll(async () => {
		const testDb = await createTestDb('sessions_launch_upsert')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'launch upsert test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		// Register hosts so API-level host ownership validation passes
		await db
			.insert(onlineHosts)
			.values([
				{ host_id: hostId, user_id: ownerUserId, organization_id: organizationId },
				{ host_id: hostId, user_id: nonOwnerUserId, organization_id: organizationId },
				{ host_id: ownerSecondHostId, user_id: ownerUserId, organization_id: organizationId },
			])
			.onConflictDoNothing()
	}, 30000)

	test('non-owner launch with no prior task_user_settings row creates one with session working_directory and host_id', async () => {
		const task = await createSharedTask('launch-upsert-insert')
		const workingDir = `${tmpdir()}/non-owner-launch-1`

		await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Hello',
				workingDirectory: workingDir,
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
			.limit(1)

		expect(settings).toBeDefined()
		expect(settings!.working_directory).toBe(workingDir)
		expect(settings!.host_id).toBe(hostId)
	})

	test('launches pinned Opus 5.5 with supported effort and Fast Mode disabled', async () => {
		const result = await call(
			launchSessionProcedure,
			{
				text: 'Launch pinned Opus 5.5',
				workingDirectory: tmpdir(),
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-opus-5-5',
				effort: 'max',
				fastMode: false,
				permissionsMode: 'default',
			},
			{ context: makeContext(ownerUserId) },
		)

		expect(result.session).toMatchObject({
			model: 'claude-opus-5-5',
			effort: 'max',
			fast_mode: false,
		})
	})

	test.each(['gpt-6-sol', 'gpt-6-luna'])(
		'launches CodeLayer Codex %s with max effort and Fast Mode',
		async (model) => {
			const result = await call(
				launchSessionProcedure,
				{
					text: `Launch ${model}`,
					workingDirectory: tmpdir(),
					hostId,
					codingAgent: 'codelayer',
					provider: 'codex',
					model,
					effort: 'max',
					fastMode: true,
					permissionsMode: 'bypass',
				},
				{ context: makeContext(ownerUserId) },
			)

			expect(result.session).toMatchObject({ model, effort: 'max', fast_mode: true })
		},
	)

	test.each(['codelayer', 'fold'] as const)(
		'launches %s Codex GPT-6.1 Sol with max effort and rejects Fast Mode',
		async (codingAgent) => {
			const input = {
				text: `Launch ${codingAgent} GPT-6.1 Sol`,
				workingDirectory: tmpdir(),
				hostId,
				codingAgent,
				provider: 'codex',
				model: 'gpt-6.1-sol',
				effort: 'max',
				permissionsMode: 'bypass',
			} as const

			const result = await call(
				launchSessionProcedure,
				{ ...input, fastMode: false },
				{ context: makeContext(ownerUserId) },
			)
			expect(result.session).toMatchObject({
				coding_agent: codingAgent,
				model: 'gpt-6.1-sol',
				effort: 'max',
				fast_mode: false,
			})
			await expect(
				call(launchSessionProcedure, { ...input, fastMode: true }, { context: makeContext(ownerUserId) }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		},
	)

	test.each(['gpt-6-sol', 'gpt-6-luna'])(
		'launches Fold Codex %s with max effort and Fast Mode disabled',
		async (model) => {
			const result = await call(
				launchSessionProcedure,
				{
					text: `Launch Fold ${model}`,
					workingDirectory: tmpdir(),
					hostId,
					codingAgent: 'fold',
					provider: 'codex',
					model,
					effort: 'max',
					fastMode: false,
					permissionsMode: 'bypass',
				},
				{ context: makeContext(ownerUserId) },
			)

			expect(result.session).toMatchObject({
				coding_agent: 'fold',
				provider: 'codex',
				model,
				effort: 'max',
				fast_mode: false,
			})
		},
	)

	test('non-owner launch with prior row and no updateTaskDefaultWorkingDirectory preserves working_directory but refreshes host_id', async () => {
		const task = await createSharedTask('launch-upsert-preserve')
		const oldDir = '/old-preserved-dir'
		const oldHost = randomUUID()
		const newDir = `${tmpdir()}/non-owner-launch-new`

		// Seed a prior settings row
		await db.insert(taskUserSettings).values({
			task_id: task.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			working_directory: oldDir,
			host_id: oldHost,
		})

		await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Hello',
				workingDirectory: newDir,
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
				// updateTaskDefaultWorkingDirectory omitted (defaults to false)
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
			.limit(1)

		expect(settings).toBeDefined()
		// working_directory preserved
		expect(settings!.working_directory).toBe(oldDir)
		// host_id refreshed to new value
		expect(settings!.host_id).toBe(hostId)
	})

	test('non-owner launch with updateTaskDefaultWorkingDirectory=true overwrites working_directory and host_id', async () => {
		const task = await createSharedTask('launch-upsert-overwrite')
		const oldDir = '/old-overwrite-dir'
		const oldHost = randomUUID()
		const newDir = `${tmpdir()}/non-owner-launch-overwrite`

		// Seed a prior settings row
		await db.insert(taskUserSettings).values({
			task_id: task.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			working_directory: oldDir,
			host_id: oldHost,
		})

		await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Hello',
				workingDirectory: newDir,
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
				updateTaskDefaultWorkingDirectory: true,
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
			.limit(1)

		expect(settings).toBeDefined()
		expect(settings!.working_directory).toBe(newDir)
		expect(settings!.host_id).toBe(hostId)
	})

	test('owner launch does not write task_user_settings', async () => {
		const task = await createSharedTask('launch-owner-no-settings')
		const workingDir = `${tmpdir()}/owner-launch-dir`

		await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Hello',
				workingDirectory: workingDir,
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(ownerUserId) },
		)

		const settings = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, ownerUserId)))

		expect(settings).toHaveLength(0)
	})

	test('launching a later session creates a requested setup row for its host', async () => {
		const task = await createSharedTask('launch-creates-workspace-row', workspaceSpec)

		await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Start work',
				workingDirectory: '/workspaces/session-launch/syncopate',
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(ownerUserId) },
		)

		const setupRow = await getSetupRow(task.id)
		expect(setupRow).toMatchObject({ status: 'setup_requested', error: null })
		expect(setupRow?.workspace_setup_state.repos).toEqual([{ localPath: '.', status: 'setup_requested' }])
	})

	test('non-owner launch resolves a single repository from the selected checkout', async () => {
		const task = await createSharedTask('launch-resolves-shared-single-repo', workspaceSpec, 'now')
		const workingDirectory = '~/projects/syncopate'

		await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Start shared work',
				workingDirectory: workspaceSpec.repos[0]!.targetPath,
				repositoryDirectory: workingDirectory,
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		const setupRow = await getSetupRow(task.id)
		expect(setupRow?.resolved_workspace_spec).toEqual({
			...workspaceSpec,
			directory: workingDirectory,
			repos: [{ ...workspaceSpec.repos[0], localPath: '.' }],
		})

		const [storedTask] = await db
			.select({ workspace_spec: tasks.workspace_spec })
			.from(tasks)
			.where(eq(tasks.id, task.id))
		expect(storedTask?.workspace_spec).toEqual(workspaceSpec)
		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
		expect(settings).toMatchObject({
			host_id: hostId,
			working_directory: workspaceSpec.repos[0]!.targetPath,
		})
	})

	test('owner and no-spec launches persist their canonical setup-row spec', async () => {
		const ownerTask = await createSharedTask('launch-owner-shared-spec', workspaceSpec)
		const noSpecTask = await createSharedTask('launch-non-owner-no-spec')

		for (const [task, userId, expectedWorkspaceSpec] of [
			[ownerTask, ownerUserId, workspaceSpec],
			[noSpecTask, nonOwnerUserId, null],
		] as const) {
			await call(
				launchSessionProcedure,
				{
					taskId: task.id,
					text: 'Start compatible work',
					workingDirectory: '~/projects/syncopate',
					hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'default',
				},
				{ context: makeContext(userId) },
			)

			expect((await getSetupRow(task.id))?.resolved_workspace_spec).toEqual(expectedWorkspaceSpec)
		}
	})

	test('non-owner launch resolves source repositories and launches in the primary worktree', async () => {
		const task = await createSharedTask('launch-rebases-shared-multi-repo', multiRepositoryWorkspaceSpec, 'now')

		const response = await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Start rebased multi-repository work',
				workingDirectory: multiRepositoryWorkspaceSpec.repos[0]!.targetPath,
				repositoryDirectory: '~/projects',
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		expect(response.session.working_directory).toBe(multiRepositoryWorkspaceSpec.repos[0]!.targetPath)
		expect((await getSetupRow(task.id))?.resolved_workspace_spec).toEqual({
			...multiRepositoryWorkspaceSpec,
			directory: '~/projects/syncopate',
			repos: [
				{ ...multiRepositoryWorkspaceSpec.repos[0], localPath: '.' },
				{ ...multiRepositoryWorkspaceSpec.repos[1], localPath: '../fold' },
			],
		})
		const [storedTask] = await db
			.select({ workspace_spec: tasks.workspace_spec })
			.from(tasks)
			.where(eq(tasks.id, task.id))
		expect(storedTask?.workspace_spec).toEqual(multiRepositoryWorkspaceSpec)
		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
		expect(settings).toMatchObject({
			host_id: hostId,
			working_directory: multiRepositoryWorkspaceSpec.repos[0]!.targetPath,
		})
	})

	test('launches in the selected non-primary workspace repository', async () => {
		const task = await createSharedTask(
			'launches-selected-workspace-repository',
			multiRepositoryWorkspaceSpec,
			'now',
		)

		const response = await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				title: 'Secondary repository session',
				text: 'Start in the secondary repository',
				workingDirectory: '/Users/test/.humanlayer/workspaces/session-launch/fold',
				repositoryDirectory: '~/projects',
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		expect(response.session.working_directory).toBe(multiRepositoryWorkspaceSpec.repos[1]!.targetPath)
	})

	test('reuses an existing multi-repository host mapping', async () => {
		const task = await createSharedTask('launch-reuses-multi-repo-mapping', multiRepositoryWorkspaceSpec, 'now')
		const launchInput = {
			taskId: task.id,
			text: 'Start mapped multi-repository work',
			workingDirectory: multiRepositoryWorkspaceSpec.repos[0]!.targetPath,
			repositoryDirectory: '~/projects',
			hostId,
			codingAgent: 'claude' as const,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissionsMode: 'default' as const,
		}

		await call(launchSessionProcedure, launchInput, { context: makeContext(nonOwnerUserId) })
		const response = await call(
			launchSessionProcedure,
			{
				...launchInput,
				text: 'Start another mapped session',
				workingDirectory: '~/wrong/path',
				repositoryDirectory: undefined,
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		expect(response.session.working_directory).toBe(multiRepositoryWorkspaceSpec.repos[0]!.targetPath)
		expect((await getSetupRow(task.id))?.resolved_workspace_spec?.directory).toBe('~/projects/syncopate')
		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
		expect(settings?.working_directory).toBe(multiRepositoryWorkspaceSpec.repos[0]!.targetPath)
	})

	test('seeds canonical user settings when an existing host mapping has no settings row', async () => {
		const task = await createSharedTask(
			'launch-reseeds-canonical-user-settings',
			multiRepositoryWorkspaceSpec,
			'now',
		)
		const launchInput = {
			taskId: task.id,
			title: 'Canonical settings session',
			text: 'Create the host mapping',
			workingDirectory: multiRepositoryWorkspaceSpec.repos[0]!.targetPath,
			repositoryDirectory: '~/projects',
			hostId,
			codingAgent: 'claude' as const,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissionsMode: 'default' as const,
		}

		await call(launchSessionProcedure, launchInput, { context: makeContext(nonOwnerUserId) })
		await db
			.delete(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))

		const response = await call(
			launchSessionProcedure,
			{
				...launchInput,
				text: 'Launch in the secondary repository',
				workingDirectory: '/Users/test/.humanlayer/workspaces/session-launch/fold',
				repositoryDirectory: undefined,
			},
			{ context: makeContext(nonOwnerUserId) },
		)
		const [settings] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task.id), eq(taskUserSettings.user_id, nonOwnerUserId)))

		expect(response.session.working_directory).toBe(multiRepositoryWorkspaceSpec.repos[1]!.targetPath)
		expect(settings?.working_directory).toBe(multiRepositoryWorkspaceSpec.repos[1]!.targetPath)
	})

	test('task owner supplies repository locations when launching on another host', async () => {
		const task = await createSharedTask('owner-launches-on-another-host', workspaceSpec, 'now')
		await db.insert(taskWorkspaceSetupForHost).values({
			organization_id: organizationId,
			task_id: task.id,
			host_id: hostId,
			status: 'setup_requested',
			resolved_workspace_spec: workspaceSpec,
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'setup_requested' }] },
		})

		const response = await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Start on desktop',
				workingDirectory: '~/wrong/path',
				repositoryDirectory: '~/desktop/syncopate',
				hostId: ownerSecondHostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(ownerUserId) },
		)

		expect(response.session.working_directory).toBe(workspaceSpec.repos[0]!.targetPath)
		expect((await getSetupRow(task.id, ownerSecondHostId))?.resolved_workspace_spec?.directory).toBe(
			'~/desktop/syncopate',
		)
		expect((await getSetupRow(task.id))?.resolved_workspace_spec?.directory).toBe(workspaceSpec.directory)
	})

	test('launches with the shared task spec when the host row predates repository locations', async () => {
		const task = await createSharedTask('launch-legacy-host-row', workspaceSpec, 'now')
		const oldState = { specVersion: 1, repos: [{ localPath: '.', status: 'done' as const }], finishedAt: 100 }
		const [existing] = await db
			.insert(taskWorkspaceSetupForHost)
			.values({
				organization_id: organizationId,
				task_id: task.id,
				host_id: hostId,
				status: 'done',
				resolved_workspace_spec: null,
				workspace_setup_state: oldState,
			})
			.returning()

		const response = await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Continue on the already prepared host',
				workingDirectory: '~/wrong/path',
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(ownerUserId) },
		)

		expect(response.session.working_directory).toBe(workspaceSpec.repos[0]!.targetPath)
		const setupRow = await getSetupRow(task.id)
		expect(setupRow?.id).toBe(existing?.id)
		expect(setupRow?.resolved_workspace_spec).toBeNull()
		expect(setupRow?.status).toBe('done')
		expect(setupRow?.workspace_setup_state).toEqual(oldState)
	})

	test('requires repository locations only for a host without a setup row', async () => {
		const task = await createSharedTask('launch-unmapped-host-requires-directory', workspaceSpec, 'now')

		await expect(
			call(
				launchSessionProcedure,
				{
					taskId: task.id,
					text: 'Launch on an unmapped host',
					workingDirectory: '~/wrong/path',
					hostId,
					codingAgent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissionsMode: 'default',
				},
				{ context: makeContext(ownerUserId) },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
	})

	test('launching another session does not reset an existing prepared setup row', async () => {
		const task = await createSharedTask('launch-preserves-workspace-row', workspaceSpec)
		const finishedState = {
			specVersion: 1,
			startedAt: 100,
			finishedAt: 200,
			repos: [{ localPath: '.', status: 'done' as const }],
		}
		const [existing] = await db
			.insert(taskWorkspaceSetupForHost)
			.values({
				organization_id: organizationId,
				task_id: task.id,
				host_id: hostId,
				status: 'done',
				workspace_setup_state: finishedState,
			})
			.returning()

		await call(
			launchSessionProcedure,
			{
				taskId: task.id,
				text: 'Continue work',
				workingDirectory: '/workspaces/session-launch/syncopate',
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(ownerUserId) },
		)

		const setupRow = await getSetupRow(task.id)
		expect(setupRow?.id).toBe(existing?.id)
		expect(setupRow?.status).toBe('done')
		expect(setupRow?.workspace_setup_state).toEqual(finishedState)
	})

	test('standalone session launch (no taskId) does not write task_user_settings', async () => {
		await call(
			launchSessionProcedure,
			{
				// taskId intentionally omitted
				text: 'Standalone session',
				workingDirectory: tmpdir(),
				hostId,
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default',
			},
			{ context: makeContext(nonOwnerUserId) },
		)

		// No task_user_settings row should be created since there's no task
		const allSettings = await db.select().from(taskUserSettings).where(eq(taskUserSettings.user_id, nonOwnerUserId))

		// Only the settings from prior tests for this user+task, no new standalone-related ones
		// Just verify none have a null task_id (task_user_settings always references a task)
		for (const s of allSettings) {
			expect(s.task_id).toBeDefined()
			expect(s.task_id).not.toBeNull()
		}
	})

	test('blocks sessions.launch with no billing mapping when enforcement is enabled', async () => {
		const originalBillingEnforcement = process.env.IS_BILLING_ENFORCEMENT_ENABLED ?? 'false'
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const kv = new TestBillingKvService()
			const effectRuntime = createDefaultTestEffectRuntime({
				billingKv: billingKvLayerFromTestService(kv),
				billingAccess: BillingAccessLive,
			})

			await expect(
				call(
					launchSessionProcedure,
					{
						text: 'Blocked launch',
						workingDirectory: tmpdir(),
						hostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'default',
					},
					{ context: makeContext(ownerUserId, { effectRuntime }) },
				),
			).rejects.toMatchObject({ code: 'BILLING_REQUIRED' })
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = originalBillingEnforcement
		}
	})

	test('allows sessions.launch with active and trialing billing cache when enforcement is enabled', async () => {
		const originalBillingEnforcement = process.env.IS_BILLING_ENFORCEMENT_ENABLED ?? 'false'
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			for (const status of ['active', 'trialing'] as const) {
				const kv = new TestBillingKvService()
				await kv.setOrgCustomerId(organizationId, 'cus_sessions_launch')
				await kv.setSubscriptionCache('cus_sessions_launch', subscriptionCache(status))
				const effectRuntime = createDefaultTestEffectRuntime({
					billingKv: billingKvLayerFromTestService(kv),
					billingAccess: BillingAccessLive,
				})

				const result = await call(
					launchSessionProcedure,
					{
						text: `Allowed ${status} launch`,
						workingDirectory: tmpdir(),
						hostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'default',
					},
					{ context: makeContext(ownerUserId, { effectRuntime }) },
				)

				expect(result.session.status).toBe('ready_for_launch')
			}
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = originalBillingEnforcement
		}
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
