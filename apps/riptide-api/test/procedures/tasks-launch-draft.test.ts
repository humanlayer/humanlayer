import { randomUUID } from 'node:crypto'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskLaunches } from '@humanlayer/db/tables/task-launches'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { hash } from 'ohash'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { GitHubService } from '../../src/effects/services/github/github.service'
import {
	type GenerateSessionTitleInput,
	SessionTitleGeneration,
} from '../../src/effects/services/session-title-generation/session-title-generation.service'
import { launchTaskDraftProcedure as unboundLaunchTaskDraftProcedure } from '../../src/orpc/api/tasks/launch-draft'
import { createMockApiAuth, createMockApiContext, createMockJiraService, createMockLinearService } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/tasks/launchDraft', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const workosOrganizationId = 'org_tasks_launch_draft'
	const ownerUserId = 'user_tasks_launch_draft'
	const hostId = randomUUID()
	const githubConnectionId = '019f536c-b021-763a-84b2-bbd8ee8e2914'
	const githubRepositoryId = '90071992547409931236'
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let launchTaskDraftProcedure: ReturnType<typeof unboundLaunchTaskDraftProcedure.withRuntime>
	const scheduledTitleGenerations: GenerateSessionTitleInput[] = []

	beforeAll(async () => {
		const testDb = await createTestDb('tasks_launch_draft')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		runtime = createRuntimeWithTestPostgresLayer(db, {
			github: makeGitHubServiceLayer(),
			sessionTitleGeneration: Layer.succeed(SessionTitleGeneration, {
				scheduleGeneration: (input) =>
					Effect.promise(async () => {
						const [session] = await db.select().from(sessions).where(eq(sessions.id, input.sessionId))
						expect(session).toMatchObject({ title: null, prompt: input.prompt })
						scheduledTitleGenerations.push(input)
					}),
			}),
		})
		launchTaskDraftProcedure = bindProcedureToRuntime(unboundLaunchTaskDraftProcedure, runtime)

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'task launch test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!organization) throw new Error('Unable to create task launch test organization')
		organizationId = organization.id
		await db.insert(onlineHosts).values({ host_id: hostId, user_id: ownerUserId, organization_id: organizationId })
	}, 60000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	beforeEach(() => {
		scheduledTitleGenerations.length = 0
	})

	function context(userId = ownerUserId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db, effectRuntime: runtime },
		})
	}

	function input(overrides: Record<string, unknown> = {}) {
		const draftId = uuidv7()
		return {
			draftId,
			name: 'Durable launch',
			slug: `durable-launch-${draftId}`,
			defaultWorkingDirectory: '/repo/syncopate',
			taskContent: 'Launch this task',
			workflowType: 'freeform' as const,
			worktreeTiming: 'never' as const,
			autoAdvanceQuestionsToResearch: false,
			autoAdvanceResearchToDesign: false,
			autoAdvancePlanToWorktree: false,
			autoAdvanceWorktreeToImplementation: false,
			autoAdvanceImplementationToPr: false,
			attachments: [],
			firstSession: {
				id: uuidv7(),
				eventId: uuidv7(),
				title: 'First session' as string | null,
				text: 'Start the task',
				workingDirectory: '/repo/syncopate',
				hostId,
				codingAgent: 'claude' as const,
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissionsMode: 'default' as const,
			},
			...overrides,
		}
	}

	async function countLaunchRows(taskId: string) {
		const [taskRows, sessionRows, launchRows, setupRows] = await Promise.all([
			db.select().from(tasks).where(eq(tasks.id, taskId)),
			db.select().from(sessions).where(eq(sessions.task_id, taskId)),
			db.select().from(taskLaunches).where(eq(taskLaunches.task_id, taskId)),
			db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.task_id, taskId)),
		])
		const sessionIds = sessionRows.map(({ id }) => id)
		const eventRows = sessionIds.length
			? await db.select().from(conversationEvents).where(eq(conversationEvents.session_id, sessionIds[0]!))
			: []
		return { taskRows, sessionRows, eventRows, launchRows, setupRows }
	}

	test('creates a local-only launch with one canonical task, first session, event, setup row, and launch record', async () => {
		const request = input()
		const result = await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await countLaunchRows(request.draftId)

		expect(result).toMatchObject({
			outcome: 'created',
			taskId: request.draftId,
			firstSessionId: request.firstSession.id,
		})
		expect(rows.taskRows).toEqual([expect.objectContaining({ id: request.draftId, is_draft: false })])
		expect(rows.sessionRows).toEqual([
			expect.objectContaining({
				id: request.firstSession.id,
				task_id: request.draftId,
				labels: [{ name: 'rpi:implementation', title: 'implementation' }],
			}),
		])
		expect(rows.eventRows).toEqual([expect.objectContaining({ id: request.firstSession.eventId })])
		expect(rows.launchRows).toEqual([
			expect.objectContaining({ task_id: request.draftId, first_session_id: request.firstSession.id }),
		])
		expect(rows.setupRows).toEqual([expect.objectContaining({ task_id: request.draftId, host_id: hostId })])
		expect(rows.sessionRows[0]?.title).toBe('First session')
		expect(scheduledTitleGenerations).toEqual([])
	})

	test.each([null, '', '   '])(
		'schedules a generated title after committing an untitled first session (%j)',
		async (title) => {
			const request = input({ ticketId: 'ENG-1234' })
			request.firstSession.title = title
			const result = await call(launchTaskDraftProcedure, request, { context: context() })

			expect(result.outcome).toBe('created')
			expect(scheduledTitleGenerations).toEqual([
				{
					sessionId: result.firstSessionId,
					organizationId,
					userId: ownerUserId,
					prompt: request.firstSession.text,
					ticketId: 'ENG-1234',
					taskName: request.name,
				},
			])
		},
	)

	test('does not schedule a generated title for a whitespace-only prompt', async () => {
		const request = input()
		request.firstSession.title = ''
		request.firstSession.text = '   '
		await call(launchTaskDraftProcedure, request, { context: context() })

		expect(scheduledTitleGenerations).toEqual([])
	})

	test('queues the first session on an owned host that is offline', async () => {
		const offlineHostId = randomUUID()
		await db.insert(onlineHosts).values({
			host_id: offlineHostId,
			user_id: ownerUserId,
			organization_id: organizationId,
			status: 'offline',
			last_seen: BigInt(Date.now() - 600_000),
		})
		const request = input()
		request.firstSession.hostId = offlineHostId

		const result = await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await countLaunchRows(request.draftId)

		expect(result).toMatchObject({ outcome: 'created', firstSessionId: request.firstSession.id })
		expect(rows.sessionRows).toEqual([
			expect.objectContaining({
				id: request.firstSession.id,
				host_id: offlineHostId,
				status: 'ready_for_launch',
			}),
		])
	})

	test('imports an attached Linear ticket and references it from task.md', async () => {
		const request = input({ ticketProvider: 'linear', ticketId: 'ENG-1234' })
		const linear = createMockLinearService({
			getIssue: async () => ({
				identifier: 'ENG-1234',
				title: 'Fix task ticket imports',
				url: 'https://linear.app/acme/issue/ENG-1234',
				branch: null,
				status: 'Todo',
				assignee: null,
				description: 'The attached ticket must become a task artifact.',
				comments: [],
				parents: [],
			}),
		})
		const linearContext = createMockApiContext({
			auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db, linear },
		})

		await call(launchTaskDraftProcedure, request, { context: linearContext })
		const rows = await db.select().from(artifacts).where(eq(artifacts.task_id, request.draftId))

		expect(rows).toHaveLength(2)
		expect(rows.find(({ file_name }) => file_name === 'task.md')?.content).toBe(
			'Launch this task\n\nSee [ENG-1234](./ENG-1234.md).',
		)
		expect(rows.find(({ file_name }) => file_name === 'ENG-1234.md')?.content).toContain(
			'The attached ticket must become a task artifact.',
		)
	})

	test('imports an attached Jira ticket and references it from task.md', async () => {
		const request = input({ ticketProvider: 'jira', ticketId: 'OPS-99' })
		const jira = createMockJiraService({
			getIssue: async () => ({
				key: 'OPS-99',
				summary: 'Fix Jira task ticket imports',
				url: 'https://jira.example.com/browse/OPS-99',
				status: 'Open',
				description: 'The Jira ticket must become a task artifact.',
			}),
		})
		const jiraContext = createMockApiContext({
			auth: createMockApiAuth({ userId: ownerUserId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db, jira, effectRuntime: runtime },
		})

		await call(launchTaskDraftProcedure, request, { context: jiraContext })
		const rows = await db.select().from(artifacts).where(eq(artifacts.task_id, request.draftId))

		expect(rows).toHaveLength(2)
		expect(rows.find(({ file_name }) => file_name === 'task.md')?.content).toBe(
			'Launch this task\n\nSee [OPS-99](./OPS-99.md).',
		)
		expect(rows.find(({ file_name }) => file_name === 'OPS-99.md')?.content).toContain(
			'The Jira ticket must become a task artifact.',
		)
	})

	test('imports an attached GitHub issue and references it from task.md', async () => {
		const request = input({
			ticketProvider: 'github',
			ticketId: '482',
			githubConnectionId,
			ticketRepositoryId: githubRepositoryId,
			ticketRepositoryFullName: 'acme/web',
		})

		await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await db.select().from(artifacts).where(eq(artifacts.task_id, request.draftId))

		expect(rows).toHaveLength(2)
		expect(rows.find(({ file_name }) => file_name === 'task.md')?.content).toBe(
			'Launch this task\n\nSee [acme/web#482](./acme-web-482.md).',
		)
		expect(rows.find(({ file_name }) => file_name === 'acme-web-482.md')?.content).toContain(
			'The GitHub issue must become a task artifact.',
		)
	})

	test('labels a research freeform session from its classified intent', async () => {
		const request = input({
			firstSession: {
				...input().firstSession,
				text: 'How does the task launch flow work?',
			},
		})

		await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await countLaunchRows(request.draftId)

		expect(rows.sessionRows[0]?.labels).toEqual([{ name: 'rpi:research', title: 'research' }])
	})

	test('labels a planning freeform session as design', async () => {
		const request = input({
			firstSession: {
				...input().firstSession,
				text: "Let's make a plan for improving task launch retries",
			},
		})

		await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await countLaunchRows(request.draftId)

		expect(rows.sessionRows[0]?.labels).toEqual([{ name: 'rpi:design', title: 'design' }])
	})

	test('labels the first session from the launcher intent instead of classifying it', async () => {
		const request = input({
			firstSession: {
				...input().firstSession,
				text: 'How does the task launch flow work?',
				intent: 'implementation',
			},
		})

		await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await countLaunchRows(request.draftId)

		expect(rows.sessionRows[0]?.labels).toEqual([{ name: 'rpi:implementation', title: 'implementation' }])
	})

	test('leaves an unknown freeform session unlabeled', async () => {
		const request = input({
			firstSession: {
				...input().firstSession,
				text: 'Unclear task',
			},
		})

		await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await countLaunchRows(request.draftId)

		expect(rows.sessionRows[0]?.labels).toEqual([])
	})

	test('promotes a saved draft in place', async () => {
		const request = input()
		request.firstSession.title = ''
		await db.insert(tasks).values({
			id: request.draftId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			name: 'Saved task draft',
			slug: request.slug,
			is_draft: true,
		})

		const result = await call(launchTaskDraftProcedure, request, { context: context() })
		const rows = await countLaunchRows(request.draftId)

		expect(result.outcome).toBe('promoted')
		expect(rows.taskRows).toEqual([
			expect.objectContaining({ id: request.draftId, is_draft: false, name: 'Durable launch' }),
		])
		expect(rows.sessionRows).toHaveLength(1)
		expect(rows.eventRows).toHaveLength(1)
		expect(rows.launchRows).toHaveLength(1)
		expect(rows.setupRows).toHaveLength(1)
		expect(scheduledTitleGenerations).toEqual([
			{
				sessionId: request.firstSession.id,
				organizationId,
				userId: ownerUserId,
				prompt: request.firstSession.text,
				ticketId: null,
				taskName: request.name,
			},
		])
	})

	test('replays the canonical launch when the client loses a response and proposes another first session', async () => {
		const request = input()
		request.firstSession.title = ''
		const created = await call(launchTaskDraftProcedure, request, { context: context() })
		const replayRequest = input({ draftId: request.draftId, slug: request.slug })
		replayRequest.firstSession.title = ''
		const replay = await call(launchTaskDraftProcedure, replayRequest, {
			context: context(),
		})
		const rows = await countLaunchRows(request.draftId)

		expect(replay).toMatchObject({
			outcome: 'already-launched',
			taskId: created.taskId,
			firstSessionId: created.firstSessionId,
			transactionId: created.transactionId,
		})
		expect(rows.taskRows).toHaveLength(1)
		expect(rows.sessionRows).toHaveLength(1)
		expect(rows.eventRows).toHaveLength(1)
		expect(rows.launchRows).toHaveLength(1)
		expect(rows.setupRows).toHaveLength(1)
		expect(scheduledTitleGenerations).toHaveLength(1)
		expect(scheduledTitleGenerations[0]?.sessionId).toBe(created.firstSessionId)
	})

	test('concurrent replays converge on one canonical first session and launch record', async () => {
		const request = input()
		const competing = input({ draftId: request.draftId, slug: request.slug })
		request.firstSession.title = ''
		competing.firstSession.title = ''
		const results = await Promise.all([
			call(launchTaskDraftProcedure, request, { context: context() }),
			call(launchTaskDraftProcedure, competing, { context: context() }),
		])
		const rows = await countLaunchRows(request.draftId)

		expect(new Set(results.map(({ taskId }) => taskId))).toEqual(new Set([request.draftId]))
		expect([...new Set(results.map(({ firstSessionId }) => firstSessionId))]).toHaveLength(1)
		expect(rows.taskRows).toHaveLength(1)
		expect(rows.sessionRows).toHaveLength(1)
		expect(rows.eventRows).toHaveLength(1)
		expect(rows.launchRows).toHaveLength(1)
		expect(rows.setupRows).toHaveLength(1)
		expect(scheduledTitleGenerations).toHaveLength(1)
		expect(scheduledTitleGenerations[0]?.sessionId).toBe(rows.sessionRows[0]?.id)
	})

	test('does not schedule a title when the launch transaction rolls back', async () => {
		const existing = input()
		await call(launchTaskDraftProcedure, existing, { context: context() })
		const request = input()
		request.firstSession.title = ''
		request.firstSession.eventId = existing.firstSession.eventId

		await expect(call(launchTaskDraftProcedure, request, { context: context() })).rejects.toMatchObject({
			code: 'SERVICE_UNAVAILABLE',
		})
		expect(await countLaunchRows(request.draftId)).toMatchObject({ taskRows: [], sessionRows: [], launchRows: [] })
		expect(scheduledTitleGenerations).toEqual([])
	})

	test('rejects another user from promoting the owner draft', async () => {
		const request = input()
		await db.insert(tasks).values({
			id: request.draftId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			name: 'Protected draft',
			is_draft: true,
		})

		await expect(
			call(launchTaskDraftProcedure, request, { context: context('another-user') }),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})
		expect(await countLaunchRows(request.draftId)).toMatchObject({
			taskRows: [expect.objectContaining({ is_draft: true })],
			sessionRows: [],
			launchRows: [],
		})
	})

	test('rejects a slug held by an active task in the organization', async () => {
		const request = input()
		await db.insert(tasks).values({
			id: uuidv7(),
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			name: 'Active slug holder',
			slug: request.slug,
			is_draft: false,
		})

		await expect(call(launchTaskDraftProcedure, request, { context: context() })).rejects.toMatchObject({
			code: 'TASK_LAUNCH_CONFLICT',
			data: {
				draftId: request.draftId,
				reason: 'slug-in-use',
				message: `The name "${request.slug}" is already in use. The task that uses it may be archived. Choose a different name.`,
			},
		})
		expect(await countLaunchRows(request.draftId)).toMatchObject({ taskRows: [], sessionRows: [], launchRows: [] })
	})

	test('rejects a slug whose only other holder is an archived task', async () => {
		const request = input()
		await db.insert(tasks).values({
			id: uuidv7(),
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			name: 'Archived slug holder',
			slug: request.slug,
			is_draft: false,
			archived: true,
		})

		await expect(call(launchTaskDraftProcedure, request, { context: context() })).rejects.toMatchObject({
			code: 'TASK_LAUNCH_CONFLICT',
			data: { draftId: request.draftId, reason: 'slug-in-use' },
		})
		expect(await countLaunchRows(request.draftId)).toMatchObject({ taskRows: [], sessionRows: [], launchRows: [] })
	})

	test('rejects an active task without a launch record as an identity conflict', async () => {
		const request = input()
		await db.insert(tasks).values({
			id: request.draftId,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			name: 'Untracked active task',
			is_draft: false,
		})

		await expect(call(launchTaskDraftProcedure, request, { context: context() })).rejects.toMatchObject({
			code: 'TASK_LAUNCH_CONFLICT',
			data: {
				draftId: request.draftId,
				reason: 'task-id-in-use',
				message: 'This draft was already launched. Refresh and try again.',
			},
		})
	})
})

const makeGitHubServiceLayer = () =>
	Layer.succeed(GitHubService, {
		createInstallUrl: () => Effect.die('createInstallUrl not used'),
		completeInstallation: () => Effect.die('completeInstallation not used'),
		mutatePullRequest: () => Effect.die('mutatePullRequest not used'),
		listConnections: () => Effect.die('listConnections not used'),
		getConnection: () => Effect.die('getConnection not used'),
		listRepositories: () => Effect.die('listRepositories not used'),
		getIssuePreview: () => Effect.die('getIssuePreview not used'),
		prepareIssueImport: (request) => {
			const content = [
				'[#482] Fix GitHub task ticket imports',
				'State: open',
				'',
				'Description:',
				'The GitHub issue must become a task artifact.',
				'',
				'View on GitHub: https://github.com/acme/web/issues/482',
				'',
			].join('\n')
			return Effect.succeed({
				identity: {
					connectionId: request.connectionId,
					issueNumber: 482,
					repositoryId: request.repositoryId,
					repositoryFullName: 'acme/web',
					url: 'https://github.com/acme/web/issues/482',
				},
				ticket: { fileName: 'ticket.md' as const, content, contentHash: hash(content) },
				images: [],
			})
		},
		syncArtifactBacklink: () => Effect.die('syncArtifactBacklink not used'),
		refreshConnection: () => Effect.die('refreshConnection not used'),
		fetchPullRequest: () => Effect.die('fetchPullRequest not used'),
		disconnect: () => Effect.die('disconnect not used'),
		verifyWebhook: () => Effect.die('verifyWebhook not used'),
		handleWebhook: () => Effect.void,
	})
