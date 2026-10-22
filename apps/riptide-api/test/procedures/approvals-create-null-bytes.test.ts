// File: apps/riptide-api/test/procedures/approvals-create-null-bytes.test.ts
//
// Regression for the "unsupported Unicode escape sequence" failures on approvals/create:
// tool_input (jsonb) must have U+0000 removed before insert.

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createApprovalProcedure } from '../../src/orpc/daemon/approvals/create'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const LITERAL_ESCAPE_TEXT = String.fromCharCode(92) + 'u0000'

describe('approvals create: strips null bytes', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let sessionId: string
	const userId = 'user_approval_null_bytes'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('approvals_create_null_bytes')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'approval null bytes org', workos_organization_id: `org_approval_nul_${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'approval null bytes task',
				slug: 'approval-null-bytes',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task.id,
				title: 'approval null bytes',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'running',
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		sessionId = session.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	test('stores tool input with null bytes removed and literal escape text intact', async () => {
		const result = await call(
			createApprovalProcedure,
			{
				sessionId,
				toolName: 'Edit',
				toolInput: {
					file_path: '/tmp/lock.ts',
					old_string: `join("${LITERAL_ESCAPE_TEXT}")`,
					new_string: `join("\0")`,
				},
				toolUseId: 'toolu_approval_nul',
			},
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId, organizationId, hostId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

		const [row] = await db
			.select({ tool_input: approvals.tool_input, status: approvals.status })
			.from(approvals)
			.where(eq(approvals.id, result.approvalId))
		expect(row?.status).toBe('pending')
		expect(row?.tool_input).toEqual({
			file_path: '/tmp/lock.ts',
			old_string: `join("${LITERAL_ESCAPE_TEXT}")`,
			new_string: 'join("")',
		})
	})
})
