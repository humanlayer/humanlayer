import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createDiffCommentsTestHarness } from './diff-comments-test-harness'

describe('diff comments delete', () => {
	let harness: Awaited<ReturnType<typeof createDiffCommentsTestHarness>>
	beforeAll(async () => {
		harness = await createDiffCommentsTestHarness('diff_comments_delete')
	}, 60_000)
	afterAll(async () => harness.cleanup(), 30_000)

	test('tombstones the author row while retaining content and replies', async () => {
		const root = await harness.createRoot()
		const reply = await call(
			harness.procedures.reply,
			{
				taskId: harness.taskIds[0],
				rootCommentId: root.commentId,
				contentText: 'Keep me',
			},
			{ context: harness.context(0, 'reader-1') },
		)
		await expect(
			call(
				harness.procedures.delete,
				{ commentId: root.commentId },
				{
					context: harness.context(0, 'reader-1'),
				},
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		await call(harness.procedures.delete, { commentId: root.commentId }, { context: harness.context() })
		const [rootRow] = await harness.db.select().from(diffComments).where(eq(diffComments.id, root.commentId))
		const [replyRow] = await harness.db.select().from(diffComments).where(eq(diffComments.id, reply.commentId))
		expect(rootRow).toMatchObject({
			is_deleted: true,
			content_text: 'Root comment',
			content_json: null,
		})
		expect(replyRow?.content_text).toBe('Keep me')
	})
})
