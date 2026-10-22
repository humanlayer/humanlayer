import { randomUUID } from 'node:crypto'

import { generateSessionTitle } from '@humanlayer/ai/generate-session-title'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { createTaskProcedure } from '../../src/orpc/api/tasks/create'
import { createMockApiAuth, createMockApiContext, createMockJiraService, createMockLinearService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

// This file runs in the `unit-isolated` vitest project: the shared `unit`
// module registry (isolate: false) makes this vi.mock order-dependent, because
// another file in the same worker may already have loaded the real module.
vi.mock('@humanlayer/ai/generate-session-title', () => ({
	generateSessionTitle: vi.fn(async () => 'Generated session title'),
}))

await requireExternalTestServices()

describe('api/tasks/create first-session title generation', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const workosOrganizationId = 'org_tasks_create_titles'
	const userId = 'user_tasks_create_titles'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('tasks_create_titles')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'task create title test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		await db.insert(onlineHosts).values({ host_id: hostId, user_id: userId, organization_id: organizationId })
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeContext() {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: {
				db,
				dbReadReplica: db,
				linear: createMockLinearService(),
				jira: createMockJiraService(),
			},
		})
	}

	function firstSessionInput() {
		return {
			title: 'Research the task',
			text: 'Create research questions',
			workingDirectory: '~/.humanlayer/workspaces/phase-3/syncopate',
			hostId,
			codingAgent: 'claude' as const,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissionsMode: 'default' as const,
		}
	}

	test('does not generate a title when the first session already has one', async () => {
		vi.mocked(generateSessionTitle).mockClear()

		const result = await call(
			createTaskProcedure,
			{ name: 'titled first session task', firstSession: firstSessionInput() },
			{ context: makeContext() },
		)

		const [session] = await db.select().from(sessions).where(eq(sessions.task_id, result.task.id)).limit(1)
		expect(session?.title).toBe('Research the task')
		expect(generateSessionTitle).not.toHaveBeenCalled()
	})
})
