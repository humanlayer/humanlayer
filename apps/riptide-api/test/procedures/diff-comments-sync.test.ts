import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { syncV2DiffCommentsProcedure } from '../../src/orpc/api/sync/v2/diff-comments'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('diff comment sync procedures', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let taskId: string
	let visibleCommentIds: string[]

	beforeAll(async () => {
		const testDb = await createTestDb('diff_comments_sync')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [organization, otherOrganization] = await db
			.insert(organizations)
			.values([
				{ name: 'Diff comments sync org', workos_organization_id: 'org_diff_comments_sync' },
				{ name: 'Other diff comments org', workos_organization_id: 'org_other_diff_comments_sync' },
			])
			.returning()
		if (!organization || !otherOrganization) throw new Error('Failed to seed organizations')
		organizationId = organization.id

		const [task, otherTask] = await db
			.insert(tasks)
			.values([
				{
					organization_id: organization.id,
					name: 'Visible task',
					resource_owner_user_id: 'owner',
					created_by: 'owner',
				},
				{
					organization_id: otherOrganization.id,
					name: 'Hidden task',
					resource_owner_user_id: 'other-owner',
					created_by: 'other-owner',
				},
			])
			.returning()
		if (!task || !otherTask) throw new Error('Failed to seed tasks')
		taskId = task.id

		const [root, reply] = await db
			.insert(diffComments)
			.values([
				{
					organization_id: organization.id,
					resource_owner_user_id: 'owner',
					task_id: task.id,
					created_by_user_id: 'owner',
					content_text: 'Root',
					anchor_json: {
						v: 1,
						repoId: 'repo-1',
						path: 'src/file.ts',
						patchHash: 'patch-1',
						sourceVersionId: 'repo-1:src/file.ts:reviewed',
						selectedDiff: ' keep\n-old\n+new',
						start: { side: 'old', line: 2 },
						end: { side: 'new', line: 5 },
					},
				},
				{
					organization_id: organization.id,
					resource_owner_user_id: 'owner',
					task_id: task.id,
					created_by_user_id: 'member',
					content_text: 'Reply',
				},
			])
			.returning()
		if (!root || !reply) throw new Error('Failed to seed visible comments')
		await db.update(diffComments).set({ reply_to_comment_id: root.id }).where(eq(diffComments.id, reply.id))
		visibleCommentIds = [root.id, reply.id]

		await db.insert(diffComments).values({
			organization_id: otherOrganization.id,
			resource_owner_user_id: 'other-owner',
			task_id: otherTask.id,
			created_by_user_id: 'other-owner',
			content_text: 'Cross-organization comment',
			anchor_json: {
				v: 1,
				repoId: 'repo-2',
				path: 'src/hidden.ts',
				patchHash: 'patch-2',
				start: { side: 'new', line: 1 },
				end: { side: 'new', line: 1 },
			},
		})
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30_000)

	function context() {
		return createMockApiContext({
			auth: createMockApiAuth({
				userId: 'same-org-member',
				organizationId,
				workosOrganizationId: 'org_diff_comments_sync',
			}),
			services: { db, dbReadReplica: db },
		})
	}

	test('returns same-organization rows to any organization member', async () => {
		const result = await call(syncV2DiffCommentsProcedure, { sorts: [] }, { context: context() })
		expect(result.rows.map((row) => row.id).sort()).toEqual([...visibleCommentIds].sort())
	})

	test('returns the anchor with its left-side sourceVersionId and selected diff', async () => {
		const result = await call(syncV2DiffCommentsProcedure, { sorts: [] }, { context: context() })
		const root = result.rows.find((row) => row.id === visibleCommentIds[0])
		expect(root?.anchor_json?.sourceVersionId).toBe('repo-1:src/file.ts:reviewed')
		expect(root?.anchor_json?.selectedDiff).toBe(' keep\n-old\n+new')
	})

	test('supports task filtering without weakening organization scope', async () => {
		const result = await call(
			syncV2DiffCommentsProcedure,
			{
				sorts: [],
				where: { type: 'comparison', field: ['task_id'], operator: 'eq', value: taskId },
			},
			{ context: context() },
		)
		expect(result.rows.map((row) => row.id).sort()).toEqual([...visibleCommentIds].sort())
	})
})
