import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createDiffCommentsTestHarness, testAnchor } from './diff-comments-test-harness'

describe('diff comments create', () => {
	let harness: Awaited<ReturnType<typeof createDiffCommentsTestHarness>>
	beforeAll(async () => {
		harness = await createDiffCommentsTestHarness('diff_comments_create')
	}, 60_000)
	afterAll(async () => harness.cleanup(), 30_000)

	test('creates a human root with a canonical anchor', async () => {
		const result = await harness.createRoot()
		const [row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, result.commentId))
		expect(row).toMatchObject({
			task_id: harness.taskIds[0],
			organization_id: harness.organizationIds[0],
			resource_owner_user_id: 'owner-1',
			created_by_user_id: 'author-1',
			reply_to_comment_id: null,
			anchor_json: testAnchor,
			created_by_agent: false,
		})
		expect(result.transactionId).toBeTypeOf('string')
	})

	test('saves the left-side sourceVersionId with the anchor', async () => {
		const anchor = { ...testAnchor, sourceVersionId: 'repo-1:src/example.ts:reviewed' }
		const result = await call(
			harness.procedures.create,
			{ taskId: harness.taskIds[0], contentText: 'On the reviewed version', anchor },
			{ context: harness.context(0) },
		)
		const [row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, result.commentId))
		expect(row?.anchor_json).toEqual(anchor)
	})

	test('saves the selected diff with the anchor', async () => {
		const anchor = { ...testAnchor, selectedDiff: ' keep\n-old line\n+new line' }
		const result = await call(
			harness.procedures.create,
			{ taskId: harness.taskIds[0], contentText: 'On these lines', anchor },
			{ context: harness.context(0) },
		)
		const [row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, result.commentId))
		expect(row?.anchor_json).toEqual(anchor)
	})

	test('rejects a selected diff over the cap', async () => {
		const selectedDiff = `+${'x'.repeat(DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH)}`
		await expect(
			call(
				harness.procedures.create,
				{ taskId: harness.taskIds[0], contentText: 'Too long', anchor: { ...testAnchor, selectedDiff } },
				{ context: harness.context(0) },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
	})

	test('hides a task from another organization', async () => {
		await expect(
			call(
				harness.procedures.create,
				{
					taskId: harness.taskIds[0],
					contentText: 'Denied',
					anchor: testAnchor,
				},
				{ context: harness.context(1) },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})
})
