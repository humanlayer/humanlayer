import { randomUUID } from 'node:crypto'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { type SessionStatus, sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { handoffSessionProcedure } from '../../src/orpc/api/sessions/handoff'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/sessions/handoff', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_sessions_handoff'
	const userId = 'user_sessions_handoff'
	const hostId = randomUUID()
	let taskId: string

	beforeAll(async () => {
		const testDb = await createTestDb('sessions_handoff')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'session handoff test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'handoff test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		await db.insert(onlineHosts).values({ host_id: hostId, user_id: userId, organization_id: organizationId })
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeContext(uid = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	type SourceOverrides = {
		status?: SessionStatus
		archived?: boolean
		createdBy?: string
		orgId?: string
		sourceTaskId?: string
		title?: string | null
		withConversation?: boolean
	}

	async function createHandoffSource(statusOrOverrides: SessionStatus | SourceOverrides = {}) {
		const {
			status = 'ready_for_input',
			archived = false,
			createdBy = userId,
			orgId = organizationId,
			sourceTaskId = taskId,
			title = 'Source session',
			withConversation = true,
		} = typeof statusOrOverrides === 'string' ? { status: statusOrOverrides } : statusOrOverrides
		const id = uuidv7()
		const now = BigInt(Date.now())
		await db.insert(sessions).values({
			id,
			task_id: sourceTaskId,
			organization_id: orgId,
			resource_owner_user_id: userId,
			created_by: createdBy,
			host_id: hostId,
			working_directory: '/tmp/handoff-test',
			coding_agent: 'claude',
			status,
			coding_agent_session_id: randomUUID(),
			provider: 'anthropic',
			model: 'opus',
			permissions_mode: 'default',
			title,
			archived,
		})
		if (!withConversation) return id
		await db.insert(conversationEvents).values([
			{
				id: uuidv7(),
				session_id: id,
				organization_id: orgId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'user',
				content: 'Fix the auth bug',
				created_at: now,
				updated_at: now,
			},
			{
				id: uuidv7(),
				session_id: id,
				organization_id: orgId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'assistant',
				content: 'Reading the file',
				created_at: now + 1n,
				updated_at: now + 1n,
			},
			{
				id: uuidv7(),
				session_id: id,
				organization_id: orgId,
				resource_owner_user_id: userId,
				event_type: 'tool_call',
				role: 'assistant',
				tool_name: 'Read',
				tool_input_json: { file_path: '/auth.ts' },
				created_at: now + 2n,
				updated_at: now + 2n,
			},
			{
				id: uuidv7(),
				session_id: id,
				organization_id: orgId,
				resource_owner_user_id: userId,
				event_type: 'tool_result',
				role: 'user',
				tool_result_content: 'export function auth() {}',
				created_at: now + 3n,
				updated_at: now + 3n,
			},
		])
		return id
	}

	async function initialEventContent(sessionId: string): Promise<string> {
		const [event] = await db
			.select({ content: conversationEvents.content })
			.from(conversationEvents)
			.where(and(eq(conversationEvents.session_id, sessionId), eq(conversationEvents.role, 'user')))
			.orderBy(asc(conversationEvents.created_at))
			.limit(1)
		return event?.content ?? ''
	}

	test('creates a linked destination session seeded with the transcript', async () => {
		const sourceSessionId = await createHandoffSource()
		const result = await call(
			handoffSessionProcedure,
			{ sourceSessionId, codingAgent: 'codelayer', provider: 'codex', model: 'gpt-5.4', includeToolCalls: true },
			{ context: makeContext() },
		)

		expect(result.session.handoff_source_session_id).toBe(sourceSessionId)
		expect(result.session.forked_from_session_id).toBeNull()
		expect(result.session.coding_agent).toBe('codelayer')
		expect(result.session.provider).toBe('codex')
		expect(result.session.model).toBe('gpt-5.4')
		expect(result.session.status).toBe('ready_for_launch')
		expect(result.session.working_directory).toBe('/tmp/handoff-test')

		const content = await initialEventContent(result.session.id)
		expect(content).toContain('handed off from Claude Code')
		expect(content).toContain('Fix the auth bug')
		expect(content).toContain('### Tool call: Read')
		expect(content).toContain('/auth.ts')
	})

	test('omits tool calls when includeToolCalls is false', async () => {
		const sourceSessionId = await createHandoffSource()
		const result = await call(
			handoffSessionProcedure,
			{ sourceSessionId, codingAgent: 'codelayer', provider: 'codex', model: 'gpt-5.4', includeToolCalls: false },
			{ context: makeContext() },
		)

		const content = await initialEventContent(result.session.id)
		expect(content).toContain('Fix the auth bug')
		expect(content).not.toContain('Tool call')
		expect(content).not.toContain('/auth.ts')
	})

	test('rejects handing off a running session', async () => {
		const sourceSessionId = await createHandoffSource('running')
		await expect(
			call(
				handoffSessionProcedure,
				{
					sourceSessionId,
					codingAgent: 'codelayer',
					provider: 'codex',
					model: 'gpt-5.4',
					includeToolCalls: true,
				},
				{ context: makeContext() },
			),
		).rejects.toMatchObject({ code: 'HANDOFF_FAILED' })
	})

	function handoff(sourceSessionId: string, overrides: { title?: string | null } = {}) {
		return call(
			handoffSessionProcedure,
			{
				sourceSessionId,
				codingAgent: 'codelayer',
				provider: 'codex',
				model: 'gpt-5.4',
				includeToolCalls: true,
				...overrides,
			},
			{ context: makeContext() },
		)
	}

	test('rejects handing off a session parked on a usage limit', async () => {
		const sourceSessionId = await createHandoffSource('waiting_for_usage_limit')
		await expect(handoff(sourceSessionId)).rejects.toMatchObject({ code: 'HANDOFF_FAILED' })
	})

	test('hands off an interrupted session', async () => {
		const sourceSessionId = await createHandoffSource('interrupted')
		const result = await handoff(sourceSessionId)

		expect(result.session.handoff_source_session_id).toBe(sourceSessionId)
	})

	test('rejects an archived session', async () => {
		const sourceSessionId = await createHandoffSource({ archived: true })

		await expect(handoff(sourceSessionId)).rejects.toMatchObject({ code: 'HANDOFF_FAILED' })
	})

	test('rejects a session with no conversation', async () => {
		const sourceSessionId = await createHandoffSource({ withConversation: false })

		await expect(handoff(sourceSessionId)).rejects.toMatchObject({
			code: 'HANDOFF_FAILED',
			data: { message: 'The session has no conversation to hand off.' },
		})
	})

	test('forbids a user who did not create the source session', async () => {
		const sourceSessionId = await createHandoffSource({ createdBy: 'user_sessions_handoff_other' })

		await expect(handoff(sourceSessionId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('hides a source session from another organization', async () => {
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'other handoff org', workos_organization_id: 'org_sessions_handoff_other' })
			.returning()
		if (!otherOrg) throw new Error('Unable to insert other organization')
		const [otherTask] = await db
			.insert(tasks)
			.values({
				organization_id: otherOrg.id,
				name: 'other org task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()
		if (!otherTask) throw new Error('Unable to insert other task')
		const sourceSessionId = await createHandoffSource({ orgId: otherOrg.id, sourceTaskId: otherTask.id })

		await expect(handoff(sourceSessionId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('stores the transcript as the session prompt', async () => {
		const sourceSessionId = await createHandoffSource()
		const result = await handoff(sourceSessionId)

		const [stored] = await db
			.select({ prompt: sessions.prompt })
			.from(sessions)
			.where(eq(sessions.id, result.session.id))
		expect(stored?.prompt).toBe(await initialEventContent(result.session.id))
	})

	test('derives the title from the source title and the target agent', async () => {
		const sourceSessionId = await createHandoffSource()
		const result = await handoff(sourceSessionId)

		expect(result.session.title).toBe('Source session (Codex)')
	})

	test('keeps an explicit title', async () => {
		const sourceSessionId = await createHandoffSource()
		const result = await handoff(sourceSessionId, { title: 'Custom title' })

		expect(result.session.title).toBe('Custom title')
	})

	test('leaves the title empty when the source has none', async () => {
		const sourceSessionId = await createHandoffSource({ title: null })
		const result = await handoff(sourceSessionId)

		expect(result.session.title).toBeNull()
	})
})
