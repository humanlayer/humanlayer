import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createDiffCommentsTestHarness } from './diff-comments-test-harness'

describe('diff comments reply', () => {
	let harness: Awaited<ReturnType<typeof createDiffCommentsTestHarness>>
	beforeAll(async () => {
		harness = await createDiffCommentsTestHarness('diff_comments_reply')
	}, 60_000)
	afterAll(async () => harness.cleanup(), 30_000)

	test('adds a direct-root reply and reopens the root', async () => {
		const root = await harness.createRoot()
		await call(
			harness.procedures.resolve,
			{ commentId: root.commentId, isResolved: true },
			{ context: harness.context() },
		)
		const reply = await call(
			harness.procedures.reply,
			{
				taskId: harness.taskIds[0],
				rootCommentId: root.commentId,
				contentText: 'Reply',
			},
			{ context: harness.context(0, 'reader-1') },
		)
		const [rootRow] = await harness.db.select().from(diffComments).where(eq(diffComments.id, root.commentId))
		const [replyRow] = await harness.db.select().from(diffComments).where(eq(diffComments.id, reply.commentId))
		expect(rootRow?.is_resolved).toBe(false)
		expect(replyRow).toMatchObject({
			reply_to_comment_id: root.commentId,
			anchor_json: null,
			created_by_user_id: 'reader-1',
		})
	})

	test('rejects replies to replies and cross-organization roots', async () => {
		const root = await harness.createRoot()
		const reply = await call(
			harness.procedures.reply,
			{
				taskId: harness.taskIds[0],
				rootCommentId: root.commentId,
				contentText: 'Reply',
			},
			{ context: harness.context() },
		)
		await expect(
			call(
				harness.procedures.reply,
				{
					taskId: harness.taskIds[0],
					rootCommentId: reply.commentId,
					contentText: 'Nested',
				},
				{ context: harness.context() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await expect(
			call(
				harness.procedures.reply,
				{
					taskId: harness.taskIds[0],
					rootCommentId: root.commentId,
					contentText: 'Denied',
				},
				{ context: harness.context(1) },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('keeps a thread replyable when its root is a tombstone', async () => {
		const root = await harness.createRoot()
		await call(
			harness.procedures.reply,
			{ taskId: harness.taskIds[0], rootCommentId: root.commentId, contentText: 'First reply' },
			{ context: harness.context(0, 'reader-1') },
		)
		await call(harness.procedures.delete, { commentId: root.commentId }, { context: harness.context() })

		const reply = await call(
			harness.procedures.reply,
			{ taskId: harness.taskIds[0], rootCommentId: root.commentId, contentText: 'Reply after delete' },
			{ context: harness.context(0, 'reader-2') },
		)
		const [replyRow] = await harness.db.select().from(diffComments).where(eq(diffComments.id, reply.commentId))
		expect(replyRow?.reply_to_comment_id).toBe(root.commentId)
	})
})
