import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createDiffCommentsTestHarness } from './diff-comments-test-harness'

describe('diff comments edit', () => {
	let harness: Awaited<ReturnType<typeof createDiffCommentsTestHarness>>
	beforeAll(async () => {
		harness = await createDiffCommentsTestHarness('diff_comments_edit')
	}, 60_000)
	afterAll(async () => harness.cleanup(), 30_000)

	test('lets only the author edit and hides cross-organization rows', async () => {
		const root = await harness.createRoot()
		await expect(
			call(
				harness.procedures.edit,
				{
					commentId: root.commentId,
					contentText: 'No',
				},
				{ context: harness.context(0, 'reader-1') },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		await expect(
			call(
				harness.procedures.edit,
				{
					commentId: root.commentId,
					contentText: 'Hidden',
				},
				{ context: harness.context(1) },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await call(
			harness.procedures.edit,
			{
				commentId: root.commentId,
				contentText: 'Updated',
				contentJson: { type: 'doc' },
			},
			{ context: harness.context() },
		)
		const [row] = await harness.db.select().from(diffComments).where(eq(diffComments.id, root.commentId))
		expect(row?.content_text).toBe('Updated')
		expect(row?.content_json).toEqual({ type: 'doc' })
	})
})
