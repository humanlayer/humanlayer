import { randomUUID } from 'node:crypto'

import { generateSessionTitle } from '@humanlayer/ai/generate-session-title'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { waitForPendingSessionTitleGenerations } from '../../src/lib/session-title-generation'
import { launchSessionProcedure } from '../../src/orpc/api/sessions/launch'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

// This file runs in the `unit-isolated` vitest project: the shared `unit`
// module registry (isolate: false) makes this vi.mock order-dependent, because
// another file in the same worker may already have loaded the real module.
vi.mock('@humanlayer/ai/generate-session-title', () => ({
	generateSessionTitle: vi.fn(async () => 'Generated session title'),
}))

await requireExternalTestServices()

describe('api/sessions/launch title generation', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let taskId: string
	const workosOrganizationId = 'org_sessions_launch_titles'
	const userId = 'user_sessions_launch_titles'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('sessions_launch_titles')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'session launch title test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		await db.insert(onlineHosts).values({ host_id: hostId, user_id: userId, organization_id: organizationId })

		// A directory task (no project workspace), which is what the new UI launches into
		// through sessions.launch.
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'directory task',
				resource_owner_user_id: userId,
				created_by: userId,
				organization_id: organizationId,
				default_working_directory: '/code/app',
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeContext() {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	function launchInput(title: string | null) {
		return {
			taskId,
			title,
			text: 'Fix the login bug',
			workingDirectory: '/code/app',
			hostId,
			codingAgent: 'claude' as const,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissionsMode: 'default' as const,
		}
	}

	async function storedTitle(sessionId: string) {
		const [session] = await db
			.select({ title: sessions.title })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
			.limit(1)
		return session?.title
	}

	test.each([
		['an empty', ''],
		['a whitespace-only', '   '],
		['no', null],
	])('stores %s title as null, then saves the generated title', async (_label, title) => {
		vi.mocked(generateSessionTitle).mockClear()

		const result = await call(launchSessionProcedure, launchInput(title), { context: makeContext() })

		expect(result.session.title).toBeNull()
		await waitForPendingSessionTitleGenerations()
		expect(generateSessionTitle).toHaveBeenCalledTimes(1)
		expect(await storedTitle(result.session.id)).toBe('Generated session title')
	})

	test('keeps a title the caller sent and does not generate one', async () => {
		vi.mocked(generateSessionTitle).mockClear()

		const result = await call(launchSessionProcedure, launchInput('Investigate login'), {
			context: makeContext(),
		})

		await waitForPendingSessionTitleGenerations()
		expect(generateSessionTitle).not.toHaveBeenCalled()
		expect(await storedTitle(result.session.id)).toBe('Investigate login')
	})
})
