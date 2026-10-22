import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call, isDefinedError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { updateSessionApiProcedure } from '../../src/orpc/api/sessions/update'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

/**
 * sessions/update - permissions_mode cascade behavior
 *
 * Verifies that changing permissions_mode to 'auto' does NOT
 * trigger the auto-approve cascade that fires for 'bypass' and 'accept_edits'.
 */
describe('api/sessions/update - permissions_mode auto-approve behavior', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_sessions_update'
	const userId = 'user_sessions_update'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('sessions_update')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'sessions update test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		// Register host for ownership validation
		await db.insert(onlineHosts).values({
			host_id: hostId,
			user_id: userId,
			organization_id: organizationId,
		})
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	/**
	 * Helper: create a session in 'needs_approval' status with a pending approval
	 * for the given tool, then return both IDs.
	 */
	async function seedSessionWithPendingApproval(toolName: string) {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				title: `test session for ${toolName}`,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'needs_approval',
			})
			.returning()

		if (!session) throw new Error('Failed to create session')

		const [approval] = await db
			.insert(approvals)
			.values({
				session_id: session.id,
				organization_id: organizationId,
				user_id: userId,
				host_id: hostId,
				resource_owner_user_id: userId,
				task_id: null,
				status: 'pending',
				tool_name: toolName,
				tool_input: { command: 'ls' },
			})
			.returning()

		if (!approval) throw new Error('Failed to create approval')

		return { sessionId: session.id, approvalId: approval.id }
	}

	function makeContext() {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	describe('draft prompt/body updates persist', () => {
		async function seedDraftSession() {
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					title: 'draft title A',
					prompt: 'draft body A',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'draft',
				})
				.returning()

			if (!session) throw new Error('Failed to create draft session')
			return session.id
		}

		test('updating prompt persists the new body', async () => {
			const sessionId = await seedDraftSession()

			await call(
				updateSessionApiProcedure,
				{ sessionId, title: 'draft title B', prompt: 'draft body B' },
				{ context: makeContext() },
			)

			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)

			expect(session?.title).toBe('draft title B')
			expect(session?.prompt).toBe('draft body B')
		})

		test('omitting prompt leaves the existing body untouched', async () => {
			const sessionId = await seedDraftSession()

			await call(updateSessionApiProcedure, { sessionId, title: 'draft title B' }, { context: makeContext() })

			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)

			expect(session?.title).toBe('draft title B')
			expect(session?.prompt).toBe('draft body A')
		})

		test('updating agent/provider/model/working directory persists those fields', async () => {
			const sessionId = await seedDraftSession()

			await call(
				updateSessionApiProcedure,
				{
					sessionId,
					codingAgent: 'opencode',
					provider: 'openai',
					model: 'gpt-5',
					workingDirectory: '/tmp/new-dir',
					hostId,
				},
				{ context: makeContext() },
			)

			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)

			expect(session?.coding_agent).toBe('opencode')
			expect(session?.provider).toBe('openai')
			expect(session?.model).toBe('gpt-5')
			expect(session?.working_directory).toBe('/tmp/new-dir')
			expect(session?.host_id).toBe(hostId)
		})

		test('accepts Opus 5.5 effort updates and rejects Fast Mode', async () => {
			const sessionId = await seedDraftSession()

			await call(
				updateSessionApiProcedure,
				{ sessionId, model: 'claude-opus-5-5', effort: 'max', fastMode: false },
				{ context: makeContext() },
			)

			const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
			expect(updated).toMatchObject({ model: 'claude-opus-5-5', effort: 'max', fast_mode: false })

			await expect(
				call(updateSessionApiProcedure, { sessionId, fastMode: true }, { context: makeContext() }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		})

		test.each(['gpt-6-sol', 'gpt-6-luna'])(
			'accepts CodeLayer Codex %s effort and Fast Mode updates',
			async (model) => {
				const sessionId = await seedDraftSession()

				await call(
					updateSessionApiProcedure,
					{
						sessionId,
						codingAgent: 'codelayer',
						provider: 'codex',
						model,
						effort: 'max',
						fastMode: true,
					},
					{ context: makeContext() },
				)

				const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
				expect(updated).toMatchObject({
					coding_agent: 'codelayer',
					provider: 'codex',
					model,
					effort: 'max',
					fast_mode: true,
				})
			},
		)

		test('accepts CodeLayer Codex GPT-6.1 Sol effort updates and rejects Fast Mode', async () => {
			const sessionId = await seedDraftSession()

			await call(
				updateSessionApiProcedure,
				{
					sessionId,
					codingAgent: 'codelayer',
					provider: 'codex',
					model: 'gpt-6.1-sol',
					effort: 'max',
					fastMode: false,
				},
				{ context: makeContext() },
			)

			const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
			expect(updated).toMatchObject({ model: 'gpt-6.1-sol', effort: 'max', fast_mode: false })
			await expect(
				call(updateSessionApiProcedure, { sessionId, fastMode: true }, { context: makeContext() }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		})

		test.each(['gpt-6-sol', 'gpt-6-luna'])(
			'accepts Fold Codex %s effort updates and rejects Fast Mode',
			async (model) => {
				const sessionId = await seedDraftSession()

				await call(
					updateSessionApiProcedure,
					{
						sessionId,
						codingAgent: 'fold',
						provider: 'codex',
						model,
						effort: 'max',
						fastMode: false,
					},
					{ context: makeContext() },
				)

				const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
				expect(updated).toMatchObject({
					coding_agent: 'fold',
					provider: 'codex',
					model,
					effort: 'max',
					fast_mode: false,
				})
				await expect(
					call(updateSessionApiProcedure, { sessionId, fastMode: true }, { context: makeContext() }),
				).rejects.toMatchObject({ code: 'BAD_REQUEST' })
			},
		)

		test('rejects a hostId not owned by the user with a 404', async () => {
			const sessionId = await seedDraftSession()

			try {
				await call(updateSessionApiProcedure, { sessionId, hostId: randomUUID() }, { context: makeContext() })
				expect.unreachable('Should have thrown NOT_FOUND')
			} catch (err) {
				const error = err as any
				expect(isDefinedError(error)).toBe(true)
				expect(error.code).toBe('NOT_FOUND')
				expect(error.data.message).toBe('Host not found or not owned by user')
			}

			// The session's host assignment is left untouched
			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
			expect(session?.host_id).toBe(hostId)
		})

		test('rejects working directory / coding agent / provider changes on a non-draft session', async () => {
			const sessionId = await seedDraftSession()
			await db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, sessionId))

			const cases: Array<{ field: Record<string, unknown>; label: string }> = [
				{ field: { workingDirectory: '/tmp/new-dir' }, label: 'workingDirectory' },
				{ field: { codingAgent: 'opencode' }, label: 'codingAgent' },
				{ field: { provider: 'openai' }, label: 'provider' },
			]
			for (const { field, label } of cases) {
				try {
					await call(updateSessionApiProcedure, { sessionId, ...field }, { context: makeContext() })
					expect.unreachable('Should have thrown BAD_REQUEST')
				} catch (err) {
					const error = err as any
					expect(isDefinedError(error)).toBe(true)
					expect(error.code).toBe('BAD_REQUEST')
					expect(error.data.message).toBe(`Cannot change ${label} on a session that is not a draft`)
				}
			}

			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
			expect(session?.working_directory).toBe(tmpdir())
			expect(session?.coding_agent).toBe('claude')
			expect(session?.provider).toBe('anthropic')
		})

		test('still allows title/prompt changes on a non-draft session', async () => {
			const sessionId = await seedDraftSession()
			await db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, sessionId))

			await call(
				updateSessionApiProcedure,
				{ sessionId, title: 'renamed', prompt: 'new body' },
				{ context: makeContext() },
			)

			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
			expect(session?.title).toBe('renamed')
			expect(session?.prompt).toBe('new body')
		})
	})

	describe("'auto' mode does not auto-approve pending approvals", () => {
		test('pending Edit approval remains pending after switching to auto', async () => {
			const { sessionId, approvalId } = await seedSessionWithPendingApproval('Edit')

			await call(updateSessionApiProcedure, { sessionId, permissionsMode: 'auto' }, { context: makeContext() })

			const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1)

			expect(approval?.status).toBe('pending')
		})

		test('pending Bash approval remains pending after switching to auto', async () => {
			const { sessionId, approvalId } = await seedSessionWithPendingApproval('Bash')

			await call(updateSessionApiProcedure, { sessionId, permissionsMode: 'auto' }, { context: makeContext() })

			const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1)

			expect(approval?.status).toBe('pending')
		})

		test('session status stays needs_approval after switching to auto', async () => {
			const { sessionId } = await seedSessionWithPendingApproval('Edit')

			await call(updateSessionApiProcedure, { sessionId, permissionsMode: 'auto' }, { context: makeContext() })

			const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)

			expect(session?.status).toBe('needs_approval')
		})
	})

	describe('contrast: bypass and accept_edits still auto-approve as expected', () => {
		test('bypass auto-approves all pending approvals including Bash', async () => {
			const { sessionId, approvalId } = await seedSessionWithPendingApproval('Bash')

			// Give session status that allows auto-update
			await db.update(sessions).set({ status: 'needs_approval' }).where(eq(sessions.id, sessionId))

			await call(updateSessionApiProcedure, { sessionId, permissionsMode: 'bypass' }, { context: makeContext() })

			const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1)

			expect(approval?.status).toBe('approved')
		})

		test('accept_edits auto-approves Edit approvals', async () => {
			const { sessionId, approvalId } = await seedSessionWithPendingApproval('Edit')

			await call(
				updateSessionApiProcedure,
				{ sessionId, permissionsMode: 'accept_edits' },
				{ context: makeContext() },
			)

			const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1)

			expect(approval?.status).toBe('approved')
		})

		test('accept_edits does NOT auto-approve non-edit approvals (Bash)', async () => {
			const { sessionId, approvalId } = await seedSessionWithPendingApproval('Bash')

			await call(
				updateSessionApiProcedure,
				{ sessionId, permissionsMode: 'accept_edits' },
				{ context: makeContext() },
			)

			const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1)

			expect(approval?.status).toBe('pending')
		})
	})

	describe('moving a session to another task', () => {
		async function createTask(name: string) {
			const [task] = await db
				.insert(tasks)
				.values({ organization_id: organizationId, resource_owner_user_id: userId, created_by: userId, name })
				.returning()
			if (!task) throw new Error('Failed to create task')
			return task.id
		}

		test('takes its observed branches and pull requests along, so the task-keyed panel keeps them', async () => {
			const fromTaskId = await createTask('from')
			const toTaskId = await createTask('to')
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					task_id: fromTaskId,
					title: 'moving session',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'draft',
				})
				.returning()
			if (!session) throw new Error('Failed to create session')
			await db.insert(sessionRepositories).values({
				organization_id: organizationId,
				session_id: session.id,
				task_id: fromTaskId,
				host_id: hostId,
				local_path: '/repos/syncopate',
				remote_url: 'git@github.com:humanlayer/syncopate.git',
				repo_full_name: 'humanlayer/syncopate',
				branch: 'feat/moved',
			})
			await db.insert(pullRequests).values({
				organization_id: organizationId,
				task_id: fromTaskId,
				session_id: session.id,
				resource_owner_user_id: userId,
				repo_full_name: 'humanlayer/syncopate',
				number: 1,
				url: 'https://github.com/humanlayer/syncopate/pull/1',
				title: 'moved',
				state: 'open',
				head_ref: 'feat/moved',
			})

			await call(
				updateSessionApiProcedure,
				{ sessionId: session.id, taskId: toTaskId },
				{ context: makeContext() },
			)

			const [repository] = await db
				.select({ task_id: sessionRepositories.task_id })
				.from(sessionRepositories)
				.where(eq(sessionRepositories.session_id, session.id))
			const [pullRequest] = await db
				.select({ task_id: pullRequests.task_id })
				.from(pullRequests)
				.where(eq(pullRequests.session_id, session.id))
			expect(repository?.task_id).toBe(toTaskId)
			expect(pullRequest?.task_id).toBe(toTaskId)
		})
	})
})
