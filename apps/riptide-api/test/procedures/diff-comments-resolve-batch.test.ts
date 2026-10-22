import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createDiffCommentsTestHarness } from './diff-comments-test-harness'

describe('diff comments resolve batch', () => {
	let harness: Awaited<ReturnType<typeof createDiffCommentsTestHarness>>
	beforeAll(async () => {
		harness = await createDiffCommentsTestHarness('diff_comments_resolve_batch')
	}, 60_000)
	afterAll(async () => harness.cleanup(), 30_000)

	test('resolves exact roots atomically and is repeat-safe', async () => {
		const first = await harness.createRoot()
		const second = await harness.createRoot()
		const input = { taskId: harness.taskIds[0], rootCommentIds: [first.commentId, second.commentId] }
		const result = await call(harness.procedures.resolveBatch, input, { context: harness.context(0, 'reader-1') })
		expect(result.resolvedCount).toBe(2)
		const repeated = await call(harness.procedures.resolveBatch, input, { context: harness.context(0, 'reader-1') })
		expect(repeated.resolvedCount).toBe(0)
	})

	test('rolls back the whole set when one root is invalid', async () => {
		const valid = await harness.createRoot()
		await expect(
			call(
				harness.procedures.resolveBatch,
				{
					taskId: harness.taskIds[0],
					rootCommentIds: [valid.commentId, crypto.randomUUID()],
				},
				{ context: harness.context() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		const [row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, valid.commentId))
		expect(row?.is_resolved).toBe(false)
	})
})
