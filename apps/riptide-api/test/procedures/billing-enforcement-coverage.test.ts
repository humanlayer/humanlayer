import { tmpdir } from 'node:os'

import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call, isDefinedError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createLaunchTokenProcedure } from '../../src/orpc/api/auth/daemon/launch-token-create'
import { createDaemonTokenProcedure } from '../../src/orpc/api/auth/daemon/token-create'
import { continueSessionProcedure } from '../../src/orpc/api/sessions/continue'
import { createSessionProcedure } from '../../src/orpc/api/sessions/create'
import { forkSessionProcedure, forkSessionV2Procedure } from '../../src/orpc/api/sessions/fork'
import { interruptSessionProcedure } from '../../src/orpc/api/sessions/interrupt'
import { launchSessionProcedure } from '../../src/orpc/api/sessions/launch'
import { listSessionsEffectProcedure as liveListSessionsProcedure } from '../../src/orpc/api/sessions/list.effect'
import {
	createQueuedMessageEffectProcedure,
	deleteQueuedMessageEffectProcedure,
} from '../../src/orpc/api/sessions/queued-messages.effect'
import { updateQueuedMessageEffectProcedure as updateQueuedMessageProcedure } from '../../src/orpc/api/sessions/queued-messages.update.effect'
import { updateSessionApiProcedure } from '../../src/orpc/api/sessions/update'
import { upsertTaskUserSettingsProcedure } from '../../src/orpc/api/task-user-settings/upsert.effect'
import { archiveTaskProcedure } from '../../src/orpc/api/tasks/archive'
import { createTaskProcedure } from '../../src/orpc/api/tasks/create'
import { listTasksProcedure as liveListTasksProcedure } from '../../src/orpc/api/tasks/list.effect'
import { updateTaskProcedure } from '../../src/orpc/api/tasks/update'
import type { Services } from '../../src/orpc/base'
import { researchProcedure } from '../../src/orpc/daemon/agents/research'
import { createApprovalProcedure } from '../../src/orpc/daemon/approvals/create'
import { daemonCreateUploadProcedure } from '../../src/orpc/daemon/artifacts/create-upload'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { getCodelayerStateEffectProcedure as getCodelayerStateProcedure } from '../../src/orpc/daemon/codelayer-state/get.effect'
import { upsertCodelayerStateEffectProcedure as liveUpsertCodelayerStateProcedure } from '../../src/orpc/daemon/codelayer-state/upsert.effect'
import { getCommentsProcedure } from '../../src/orpc/daemon/comments/get'
import { replyCommentProcedure } from '../../src/orpc/daemon/comments/reply'
import { updateCommentProcedure } from '../../src/orpc/daemon/comments/update'
import { heartbeatEffectProcedure as liveHeartbeatProcedure } from '../../src/orpc/daemon/hosts/heartbeat.effect'
import { shutdownEffectProcedure as liveShutdownProcedure } from '../../src/orpc/daemon/hosts/shutdown.effect'
import { createJiraRemoteLinkProcedure } from '../../src/orpc/daemon/integrations/jira/create-remote-link'
import { createLinearAttachmentProcedure } from '../../src/orpc/daemon/integrations/linear/create-attachment'
import { updateLinearIssueStatusProcedure } from '../../src/orpc/daemon/integrations/linear/update-issue-status'
import { ensureStreamHydratedProcedure } from '../../src/orpc/daemon/sessions/ensure-stream-hydrated'
import { createEventProcedure } from '../../src/orpc/daemon/sessions/events/create'
import { updateSessionProcedure } from '../../src/orpc/daemon/sessions/update'
import { daemonGetSettingsEffectProcedure as liveDaemonGetSettingsProcedure } from '../../src/orpc/daemon/settings/get.effect'
import {
	createMockApiAuth,
	createMockApiContext,
	billingAccessLayer,
	createMockDaemonAuth,
	createMockDaemonContext,
} from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const originalBillingEnforcement = process.env.IS_BILLING_ENFORCEMENT_ENABLED ?? 'false'

/**
 * Billing enforcement route coverage tests.
 *
 * Uses call() to invoke procedures directly, verifying that
 * billing middleware is applied to routes that require billing and not to read/recovery routes.
 *
 * When billing is blocked and enforcement is enabled:
 * - Billing-required routes should throw BILLING_REQUIRED
 * - Read/sync/recovery routes should NOT throw BILLING_REQUIRED
 */
describe('billing enforcement route coverage', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let listTasksProcedure: typeof liveListTasksProcedure
	let listSessionsProcedure: typeof liveListSessionsProcedure
	let daemonGetSettingsProcedure: typeof liveDaemonGetSettingsProcedure
	let shutdownProcedure: typeof liveShutdownProcedure
	let upsertCodelayerStateProcedure: typeof liveUpsertCodelayerStateProcedure
	let heartbeatProcedure: typeof liveHeartbeatProcedure
	let organizationId: string
	const userId = 'user_billing_coverage'
	const hostId = uuidv7()

	beforeAll(async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'

		const testDb = await createTestDb('billing_coverage')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		listTasksProcedure = bindProcedureToRuntime(liveListTasksProcedure, effectRuntime)
		listSessionsProcedure = bindProcedureToRuntime(liveListSessionsProcedure, effectRuntime)
		daemonGetSettingsProcedure = bindProcedureToRuntime(liveDaemonGetSettingsProcedure, effectRuntime)
		shutdownProcedure = bindProcedureToRuntime(liveShutdownProcedure, effectRuntime)
		upsertCodelayerStateProcedure = bindProcedureToRuntime(liveUpsertCodelayerStateProcedure, effectRuntime)
		heartbeatProcedure = bindProcedureToRuntime(liveHeartbeatProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Billing Coverage Org', workos_organization_id: `workos-org-${uuidv7()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		// Register a host for the user
		await db.insert(onlineHosts).values({
			host_id: hostId,
			user_id: userId,
			organization_id: organizationId,
			host_name: 'test-host',
		})
	}, 30000)

	afterAll(async () => {
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = originalBillingEnforcement
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	function blockedApiContext(serviceOverrides?: Partial<Services>) {
		return {
			context: createMockApiContext({
				auth: createMockApiAuth({ userId, organizationId }),
				services: {
					db,
					dbReadReplica: db,
					...serviceOverrides,
				},
				billingAccess: billingAccessLayer({ decision: 'blocked' }),
			}),
		}
	}

	function blockedDaemonContext(serviceOverrides?: Partial<Services>) {
		return {
			context: createMockDaemonContext({
				auth: createMockDaemonAuth({ userId, organizationId, hostId }),
				services: {
					db,
					dbReadReplica: db,
					...serviceOverrides,
				},
				billingAccess: billingAccessLayer({ decision: 'blocked' }),
			}),
		}
	}

	/**
	 * Helper to verify a procedure throws BILLING_REQUIRED.
	 */
	async function expectBillingRequired(fn: () => Promise<unknown>) {
		try {
			await fn()
			expect.unreachable('Should have thrown BILLING_REQUIRED')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('BILLING_REQUIRED')
		}
	}

	/**
	 * Helper to verify a procedure does NOT throw BILLING_REQUIRED.
	 * It may throw other errors (NOT_FOUND, etc.) which is fine.
	 */
	async function expectNotBillingRequired(fn: () => Promise<unknown>) {
		try {
			await fn()
			// Success means no billing error
		} catch (err) {
			const error = err as any
			if (isDefinedError(error)) {
				expect(error.code).not.toBe('BILLING_REQUIRED')
			}
			// Non-oRPC errors are also fine (e.g., db errors, not-found)
		}
	}

	describe('API billing-required routes throw BILLING_REQUIRED when blocked', () => {
		test('sessions.create', async () => {
			await expectBillingRequired(() =>
				call(
					createSessionProcedure,
					{
						prompt: 'test',
						workingDirectory: tmpdir(),
						hostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'default',
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.launch', async () => {
			await expectBillingRequired(() =>
				call(
					launchSessionProcedure,
					{
						text: 'test',
						workingDirectory: tmpdir(),
						hostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'default',
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.continue', async () => {
			await expectBillingRequired(() =>
				call(
					continueSessionProcedure,
					{
						sessionId: uuidv7(),
						text: 'test',
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.update', async () => {
			await expectBillingRequired(() =>
				call(
					updateSessionApiProcedure,
					{
						sessionId: uuidv7(),
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.fork', async () => {
			await expectBillingRequired(() =>
				call(
					forkSessionProcedure,
					{
						sourceSessionId: uuidv7(),
						forkAtEventId: uuidv7(),
						text: 'test fork prompt',
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.v2.fork', async () => {
			await expectBillingRequired(() =>
				call(
					forkSessionV2Procedure,
					{
						sourceSessionId: uuidv7(),
						forkAtEventId: uuidv7(),
						text: 'test fork prompt',
						codingAgent: 'claude',
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.queuedMessages.create', async () => {
			await expectBillingRequired(() =>
				call(
					createQueuedMessageEffectProcedure,
					{
						sessionId: uuidv7(),
						text: 'test',
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.queuedMessages.update', async () => {
			await expectBillingRequired(() =>
				call(
					updateQueuedMessageProcedure,
					{
						sessionId: uuidv7(),
						queuedMessageId: uuidv7(),
						text: 'test',
					},
					blockedApiContext(),
				),
			)
		})

		test('sessions.queuedMessages.delete', async () => {
			await expectBillingRequired(() =>
				call(
					deleteQueuedMessageEffectProcedure,
					{
						sessionId: uuidv7(),
						queuedMessageId: uuidv7(),
					},
					blockedApiContext(),
				),
			)
		})

		test('tasks.create', async () => {
			await expectBillingRequired(() =>
				call(
					createTaskProcedure,
					{
						name: 'test task',
					},
					blockedApiContext(),
				),
			)
		})

		test('tasks.update', async () => {
			await expectBillingRequired(() =>
				call(
					updateTaskProcedure,
					{
						taskId: uuidv7(),
					},
					blockedApiContext(),
				),
			)
		})

		test('tasks.archive', async () => {
			await expectBillingRequired(() =>
				call(
					archiveTaskProcedure,
					{
						taskId: uuidv7(),
						archived: true,
						cascadeToSessions: false,
					},
					blockedApiContext(),
				),
			)
		})

		test('taskUserSettings.upsert', async () => {
			await expectBillingRequired(() =>
				call(
					upsertTaskUserSettingsProcedure,
					{
						taskId: uuidv7(),
					},
					blockedApiContext(),
				),
			)
		})

		test('auth.daemon.token.create', async () => {
			await expectBillingRequired(() =>
				call(
					createDaemonTokenProcedure,
					{
						hostId,
					},
					blockedApiContext(),
				),
			)
		})

		test('auth.daemon.launchToken.create', async () => {
			await expectBillingRequired(() => call(createLaunchTokenProcedure, {}, blockedApiContext()))
		})
	})

	describe('Daemon billing-required routes throw BILLING_REQUIRED when blocked', () => {
		test('daemon.sessions.update', async () => {
			await expectBillingRequired(() =>
				call(
					updateSessionProcedure,
					{
						sessionId: uuidv7(),
						status: 'running',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.sessions.events.create', async () => {
			await expectBillingRequired(() =>
				call(
					createEventProcedure,
					{
						sessionId: uuidv7(),
						codingAgentSessionId: 'test-coding-session',
						eventType: 'message',
						role: 'assistant',
						content: 'test',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.sessions.ensureStreamHydrated', async () => {
			await expectBillingRequired(() =>
				call(
					ensureStreamHydratedProcedure,
					{
						sessionId: uuidv7(),
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.approvals.create', async () => {
			await expectBillingRequired(() =>
				call(
					createApprovalProcedure,
					{
						sessionId: uuidv7(),
						toolName: 'test-tool',
						toolInput: '{}',
						toolUseId: uuidv7(),
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.agents.research', async () => {
			await expectBillingRequired(() =>
				call(
					researchProcedure,
					{
						question: 'test question',
						packageName: 'test-pkg',
						language: 'typescript',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.codelayerState.upsert', async () => {
			await expectBillingRequired(() =>
				call(
					upsertCodelayerStateProcedure,
					{
						sessionId: uuidv7(),
						state: {},
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.artifacts.upsert', async () => {
			await expectBillingRequired(() =>
				call(
					upsertArtifactProcedure,
					{
						taskId: uuidv7(),
						fileName: 'test.md',
						content: 'test content',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.artifacts.createUpload', async () => {
			await expectBillingRequired(() =>
				call(
					daemonCreateUploadProcedure,
					{
						taskId: uuidv7(),
						fileName: 'test.png',
						contentType: 'image/png',
						contentHash: 'abc123',
						fileSizeBytes: 1024,
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.comments.update', async () => {
			await expectBillingRequired(() =>
				call(
					updateCommentProcedure,
					{
						taskId: uuidv7(),
						artifactFilename: 'test.md',
						truncatedCommentIds: ['abcd1234'],
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.comments.reply', async () => {
			await expectBillingRequired(() =>
				call(
					replyCommentProcedure,
					{
						taskId: uuidv7(),
						artifactFilename: 'test.md',
						truncatedCommentId: 'abcd1234',
						contentText: 'test reply',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.hosts.shutdown', async () => {
			await expectBillingRequired(() =>
				call(
					shutdownProcedure,
					{
						hostId,
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.integrations.jira.createRemoteLink', async () => {
			await expectBillingRequired(() =>
				call(
					createJiraRemoteLinkProcedure,
					{
						issueKey: 'TEST-1',
						url: 'https://example.com',
						title: 'Test Link',
						globalId: 'test-global-id',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.integrations.linear.updateIssueStatus', async () => {
			await expectBillingRequired(() =>
				call(
					updateLinearIssueStatusProcedure,
					{
						issueId: 'test-issue',
						statusName: 'Done',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.integrations.linear.createAttachment', async () => {
			await expectBillingRequired(() =>
				call(
					createLinearAttachmentProcedure,
					{
						issueId: 'test-issue',
						url: 'https://example.com',
						title: 'Test Attachment',
					},
					blockedDaemonContext(),
				),
			)
		})
	})

	describe('Ungated routes do NOT throw BILLING_REQUIRED when blocked', () => {
		test('sessions.list does not throw BILLING_REQUIRED', async () => {
			await expectNotBillingRequired(() => call(listSessionsProcedure, {}, blockedApiContext()))
		})

		test('tasks.list does not throw BILLING_REQUIRED', async () => {
			await expectNotBillingRequired(() => call(listTasksProcedure, {}, blockedApiContext()))
		})

		test('sessions.interrupt does not throw BILLING_REQUIRED', async () => {
			await expectNotBillingRequired(() =>
				call(
					interruptSessionProcedure,
					{
						sessionId: uuidv7(),
					},
					blockedApiContext(),
				),
			)
		})

		test('daemon.settings.get does not throw BILLING_REQUIRED', async () => {
			await expectNotBillingRequired(() => call(daemonGetSettingsProcedure, {}, blockedDaemonContext()))
		})

		test('daemon.comments.get does not throw BILLING_REQUIRED', async () => {
			await expectNotBillingRequired(() =>
				call(
					getCommentsProcedure,
					{
						taskId: uuidv7(),
						artifactFilename: 'test.md',
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.codelayerState.get does not throw BILLING_REQUIRED', async () => {
			await expectNotBillingRequired(() =>
				call(
					getCodelayerStateProcedure,
					{
						sessionId: uuidv7(),
					},
					blockedDaemonContext(),
				),
			)
		})

		test('daemon.hosts.heartbeat does not throw BILLING_REQUIRED', async () => {
			await expectNotBillingRequired(() =>
				call(
					heartbeatProcedure,
					{
						hostId,
						hostName: 'test-host',
					},
					blockedDaemonContext(),
				),
			)
		})
	})

	describe('Billing service allowed lets billing-required routes through', () => {
		test('sessions.create succeeds when billing is allowed', async () => {
			const allowedApiCtx = {
				context: createMockApiContext({
					auth: createMockApiAuth({ userId, organizationId }),
					services: {
						db,
						dbReadReplica: db,
					},
					billingAccess: billingAccessLayer({ decision: 'allowed' }),
				}),
			}
			// Should not throw BILLING_REQUIRED - may throw other errors (e.g., host not found)
			await expectNotBillingRequired(() =>
				call(
					createSessionProcedure,
					{
						prompt: 'test',
						workingDirectory: tmpdir(),
						hostId,
						codingAgent: 'claude',
						provider: 'anthropic',
						model: 'claude-sonnet-4-5',
						permissionsMode: 'default',
					},
					allowedApiCtx,
				),
			)
		})

		test('daemon.sessions.update succeeds when billing is allowed', async () => {
			// Create a real session to update
			const [session] = await db
				.insert(sessions)
				.values({
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					title: 'billing allowed test',
					working_directory: tmpdir(),
					coding_agent: 'claude',
					provider: 'anthropic',
					model: 'claude-sonnet-4-5',
					permissions_mode: 'default',
					status: 'running',
				})
				.returning()

			if (!session) throw new Error('Failed to create test session')

			await expectNotBillingRequired(() =>
				call(
					updateSessionProcedure,
					{
						sessionId: session.id,
						status: 'ready_for_input',
					},
					{
						context: createMockDaemonContext({
							auth: createMockDaemonAuth({ userId, organizationId, hostId }),
							services: {
								db,
								dbReadReplica: db,
							},
							billingAccess: billingAccessLayer({ decision: 'allowed' }),
						}),
					},
				),
			)
		})
	})
})
