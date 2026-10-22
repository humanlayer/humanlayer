// File: apps/riptide-api/test/procedures/events-create-null-bytes.test.ts
//
// RIPTIDE-API-NE / RIPTIDE-DAEMON-CB regression: a conversation event whose tool input,
// content, or tool result holds U+0000 must be stored with the null bytes removed, not
// rejected by Postgres ("unsupported Unicode escape sequence", 22P05). Coding agents emit
// real null characters when they read or write code that mentions null bytes. Before the
// fix the insert failed, the daemon got a 500, and the session died.

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createEventProcedure } from '../../src/orpc/daemon/sessions/events/create'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { createMockLinearService } from '../mocks/linear-service.mock'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

// The six-character TEXT backslash-u-0-0-0-0 as it appears in source code. Not a null byte.
const LITERAL_ESCAPE_TEXT = String.fromCharCode(92) + 'u0000'

describe('Events create: strips null bytes (RIPTIDE-API-NE)', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_null_bytes'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('events_create_null_bytes')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'null bytes org', workos_organization_id: `org_null_bytes_${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	async function createSession(name: string) {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name,
				slug: name,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: name,
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
			})
			.returning()

		return session!
	}

	function daemonContext() {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db, linear: createMockLinearService({}) },
		})
	}

	test('tool_call with null bytes in tool input is stored with them removed', async () => {
		const session = await createSession('null-bytes-tool-call')
		const eventId = randomUUID()

		// Shape taken from the Sentry event: a Write whose content discusses null bytes, where
		// the model emitted a real NUL in place of the escape text.
		const result = await call(
			createEventProcedure,
			{
				eventId,
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-null-bytes',
				eventType: 'tool_call',
				role: 'assistant',
				toolCallId: 'toolu_null_bytes',
				toolName: 'Write',
				toolInputJson: {
					file_path: '/tmp/research.md',
					content: `Postgres rejects \`\0\` (the null byte) in JSONB.\nStrip \`\0\` before insert.`,
					nested: { list: ['a\0b', { deep: '\0' }] },
				},
			},
			{ context: daemonContext() },
		)
		expect(result.eventId).toBe(eventId)

		const [row] = await db
			.select({ tool_input_json: conversationEvents.tool_input_json })
			.from(conversationEvents)
			.where(eq(conversationEvents.id, eventId))
		expect(row?.tool_input_json).toEqual({
			file_path: '/tmp/research.md',
			content: 'Postgres rejects `` (the null byte) in JSONB.\nStrip `` before insert.',
			nested: { list: ['ab', { deep: '' }] },
		})
	})

	test('keeps the literal text backslash-u0000 in tool input intact', async () => {
		// An Edit whose old_string is real source code that mentions null bytes. The text is
		// six ordinary characters and must round-trip unchanged (RIPTIDE-API-ND regression
		// shape, applied to the conversation-event path).
		const session = await createSession('null-bytes-literal-text')
		const eventId = randomUUID()
		const oldString = `const signature = selectedValues.join("${LITERAL_ESCAPE_TEXT}");`

		await call(
			createEventProcedure,
			{
				eventId,
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-literal',
				eventType: 'tool_call',
				role: 'assistant',
				toolCallId: 'toolu_literal',
				toolName: 'Edit',
				toolInputJson: { file_path: '/tmp/index.tsx', old_string: oldString, new_string: `${oldString}\0` },
			},
			{ context: daemonContext() },
		)

		const [row] = await db
			.select({ tool_input_json: conversationEvents.tool_input_json })
			.from(conversationEvents)
			.where(eq(conversationEvents.id, eventId))
		expect(row?.tool_input_json).toEqual({
			file_path: '/tmp/index.tsx',
			old_string: oldString,
			new_string: oldString,
		})
	})

	test('message content and tool result content with null bytes are stored with them removed', async () => {
		const session = await createSession('null-bytes-text-columns')
		const messageId = randomUUID()
		const toolResultId = randomUUID()

		await call(
			createEventProcedure,
			{
				eventId: messageId,
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-text',
				eventType: 'message',
				role: 'assistant',
				content: 'hello\0world',
			},
			{ context: daemonContext() },
		)
		await call(
			createEventProcedure,
			{
				eventId: toolResultId,
				sessionId: session.id,
				codingAgentSessionId: 'agent-session-text',
				eventType: 'tool_result',
				role: 'user',
				toolResultForId: 'toolu_text',
				toolResultContent: `binary\0output\0here ${LITERAL_ESCAPE_TEXT}`,
			},
			{ context: daemonContext() },
		)

		const rows = await db
			.select({
				id: conversationEvents.id,
				content: conversationEvents.content,
				tool_result_content: conversationEvents.tool_result_content,
			})
			.from(conversationEvents)
			.where(eq(conversationEvents.session_id, session.id))
		const byId = new Map(rows.map((row) => [row.id, row]))
		expect(byId.get(messageId)?.content).toBe('helloworld')
		expect(byId.get(toolResultId)?.tool_result_content).toBe(`binaryoutputhere ${LITERAL_ESCAPE_TEXT}`)
	})
})
