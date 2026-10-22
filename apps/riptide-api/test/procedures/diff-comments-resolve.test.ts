import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createDiffCommentsTestHarness } from './diff-comments-test-harness'

describe('diff comments resolve', () => {
	let harness: Awaited<ReturnType<typeof createDiffCommentsTestHarness>>
	beforeAll(async () => {
		harness = await createDiffCommentsTestHarness('diff_comments_resolve')
	}, 60_000)
	afterAll(async () => harness.cleanup(), 30_000)

	test('lets an organization member resolve and reopen a root through a reply', async () => {
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
		await call(
			harness.procedures.resolve,
			{ commentId: reply.commentId, isResolved: true },
			{
				context: harness.context(0, 'reader-1'),
			},
		)
		let [row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, root.commentId))
		expect(row).toMatchObject({ is_resolved: true, resolved_by_user_id: 'reader-1' })
		await call(
			harness.procedures.resolve,
			{ commentId: root.commentId, isResolved: false },
			{
				context: harness.context(0, 'author-1'),
			},
		)
		;[row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, root.commentId))
		expect(row).toMatchObject({ is_resolved: false, resolved_by_user_id: null })
	})

	test('hides cross-organization threads', async () => {
		const root = await harness.createRoot()
		await expect(
			call(
				harness.procedures.resolve,
				{ commentId: root.commentId, isResolved: true },
				{
					context: harness.context(1),
				},
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('resolves a tombstone root when live replies preserve its thread', async () => {
		const root = await harness.createRoot()
		await call(
			harness.procedures.reply,
			{ taskId: harness.taskIds[0], rootCommentId: root.commentId, contentText: 'Live reply' },
			{ context: harness.context(0, 'reader-1') },
		)
		await call(harness.procedures.delete, { commentId: root.commentId }, { context: harness.context() })

		await call(
			harness.procedures.resolve,
			{ commentId: root.commentId, isResolved: true },
			{
				context: harness.context(0, 'reader-1'),
			},
		)
		const [row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, root.commentId))
		expect(row).toMatchObject({ is_deleted: true, is_resolved: true, resolved_by_user_id: 'reader-1' })
	})
})
