import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { requireExternalTestServices } from '../utils/external-test-services'
import { createDaemonDiffCommentsTestHarness } from './diff-comments-daemon-test-harness'

await requireExternalTestServices()

describe('daemon/diff-comments/reply', () => {
	let harness: Awaited<ReturnType<typeof createDaemonDiffCommentsTestHarness>>

	beforeAll(async () => {
		harness = await createDaemonDiffCommentsTestHarness('diff_comments_daemon_reply')
	}, 60_000)

	afterAll(async () => {
		await harness.cleanup()
	}, 30_000)

	test('matches unique 8-12 suffixes, replies directly to the root, and reopens with agent identity', async () => {
		const rootId = await harness.insertComment({ isResolved: true, contentText: 'Resolved root', order: 1 })
		const existingReplyId = await harness.insertComment({ replyToCommentId: rootId, order: 2 })
		const result = await call(
			harness.procedures.reply,
			{
				taskId: harness.taskIds[0],
				truncatedCommentId: existingReplyId.slice(-8),
				contentText: 'Agent reply',
			},
			{ context: harness.context(0, 'driver-1') },
		)

		expect(result.parentCommentId).toBe(rootId)
		const rows = await harness.db.select().from(diffComments).where(eq(diffComments.task_id, harness.taskIds[0]))
		expect(rows.find((row) => row.id === rootId)).toMatchObject({ is_resolved: false, resolved_by_user_id: null })
		expect(rows.find((row) => row.id === result.commentId)).toMatchObject({
			reply_to_comment_id: rootId,
			anchor_json: null,
			created_by_user_id: 'driver-1',
			created_by_agent: true,
			content_text: 'Agent reply',
		})
	})

	test('returns distinct not-found and ambiguous errors without crossing task scope', async () => {
		const sharedSuffix = 'aaaaaaaaaaaa'
		await harness.insertComment({ id: `11111111-1111-4111-8111-${sharedSuffix}`, order: 10 })
		await harness.insertComment({ id: `22222222-2222-4222-8222-${sharedSuffix}`, order: 11 })
		const siblingId = await harness.insertComment({ taskIndex: 1, order: 1 })

		await expect(
			call(
				harness.procedures.reply,
				{
					taskId: harness.taskIds[0],
					truncatedCommentId: sharedSuffix.slice(-8),
					contentText: 'Ambiguous reply',
				},
				{ context: harness.context() },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { message: 'Ambiguous diff comment ID suffix' } })

		await expect(
			call(
				harness.procedures.reply,
				{
					taskId: harness.taskIds[0],
					truncatedCommentId: siblingId.slice(-12),
					contentText: 'Cross-task reply',
				},
				{ context: harness.context() },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND', data: { message: 'Diff comment not found' } })
	})
})
