import { diffCommentSelectSchema } from '@humanlayer/db/tables/diff-comments'
import { DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import { describe, expect, expectTypeOf, test } from 'vitest'
import z from 'zod/v4'

import { CreateDiffCommentInputSchema } from '../src/api/diff-comments/create'
import { DeleteDiffCommentInputSchema } from '../src/api/diff-comments/delete'
import { EditDiffCommentInputSchema } from '../src/api/diff-comments/edit'
import { ReplyDiffCommentInputSchema } from '../src/api/diff-comments/reply'
import { ResolveDiffCommentInputSchema } from '../src/api/diff-comments/resolve'
import { ResolveBatchDiffCommentsInputSchema } from '../src/api/diff-comments/resolve-batch'
import { syncV2DiffCommentsContract } from '../src/api/sync/v2/diff-comments'
import { GetDiffCommentsOutputSchema } from '../src/daemon/diff-comments/get'
import { ReplyToDiffCommentInputSchema } from '../src/daemon/diff-comments/reply'
import { UpdateDiffCommentsInputSchema } from '../src/daemon/diff-comments/update'

const anchor = {
	v: 1 as const,
	repoId: 'repo-1',
	path: 'src/file.ts',
	patchHash: 'patch-1',
	start: { side: 'old' as const, line: 4 },
	end: { side: 'new' as const, line: 9 },
}

describe('diff comment contracts', () => {
	test('derives human mutation inputs from database field schemas', () => {
		const root = CreateDiffCommentInputSchema.parse({
			taskId: crypto.randomUUID(),
			contentText: 'Review this range',
			anchor,
		})
		const reply = ReplyDiffCommentInputSchema.parse({
			taskId: root.taskId,
			rootCommentId: crypto.randomUUID(),
			contentText: 'Reply',
		})

		expect(root.anchor.start.side).toBe('old')
		expect(root.anchor.end.side).toBe('new')
		expect(reply).not.toHaveProperty('anchor')
		expect(reply).not.toHaveProperty('replyToCommentId')
		expectTypeOf(root.anchor).toMatchTypeOf<NonNullable<z.infer<typeof diffCommentSelectSchema>['anchor_json']>>()
	})

	test('accepts an optional left-side sourceVersionId on the anchor', () => {
		const withSource = CreateDiffCommentInputSchema.parse({
			taskId: crypto.randomUUID(),
			contentText: 'Review this range',
			anchor: { ...anchor, sourceVersionId: 'repo-1:src/file.ts:abc' },
		})
		expect(withSource.anchor.sourceVersionId).toBe('repo-1:src/file.ts:abc')
		expect(
			CreateDiffCommentInputSchema.parse({ taskId: crypto.randomUUID(), contentText: 'Comment', anchor }).anchor,
		).not.toHaveProperty('sourceVersionId')
		expect(
			GetDiffCommentsOutputSchema.shape.comments.element.shape.anchor.parse({
				...anchor,
				sourceVersionId: 'repo-1:src/file.ts:abc',
			}).sourceVersionId,
		).toBe('repo-1:src/file.ts:abc')
	})

	test('accepts an optional selected diff on the anchor up to its cap', () => {
		const selectedDiff = ' keep\n-old\n+new'
		const input = { taskId: crypto.randomUUID(), contentText: 'Review this range' }
		expect(
			CreateDiffCommentInputSchema.parse({ ...input, anchor: { ...anchor, selectedDiff } }).anchor.selectedDiff,
		).toBe(selectedDiff)
		expect(CreateDiffCommentInputSchema.parse({ ...input, anchor }).anchor).not.toHaveProperty('selectedDiff')
		expect(
			GetDiffCommentsOutputSchema.shape.comments.element.shape.anchor.parse({ ...anchor, selectedDiff })
				.selectedDiff,
		).toBe(selectedDiff)
		const atCap = `+${'x'.repeat(DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH - 1)}`
		expect(
			CreateDiffCommentInputSchema.safeParse({ ...input, anchor: { ...anchor, selectedDiff: atCap } }).success,
		).toBe(true)
		expect(
			CreateDiffCommentInputSchema.safeParse({ ...input, anchor: { ...anchor, selectedDiff: `${atCap}x` } })
				.success,
		).toBe(false)
		expect(
			CreateDiffCommentInputSchema.safeParse({ ...input, anchor: { ...anchor, selectedDiff: '' } }).success,
		).toBe(false)
	})

	test('keeps root and reply inputs distinct', () => {
		const common = { taskId: crypto.randomUUID(), contentText: 'Comment' }

		expect(CreateDiffCommentInputSchema.safeParse({ ...common, rootCommentId: crypto.randomUUID() }).success).toBe(
			false,
		)
		expect(ReplyDiffCommentInputSchema.safeParse({ ...common, anchor }).success).toBe(false)
	})

	test('exports every Phase 1 human mutation schema', () => {
		expect(EditDiffCommentInputSchema).toBeDefined()
		expect(DeleteDiffCommentInputSchema).toBeDefined()
		expect(ResolveDiffCommentInputSchema).toBeDefined()
		expect(ResolveBatchDiffCommentsInputSchema).toBeDefined()
	})

	test('uses the canonical database row schema for the v2 sync output', () => {
		expect(syncV2DiffCommentsContract).toBeDefined()
		expect(
			diffCommentSelectSchema.parse({
				id: crypto.randomUUID(),
				organization_id: crypto.randomUUID(),
				resource_owner_user_id: 'owner',
				task_id: crypto.randomUUID(),
				created_by_user_id: 'author',
				reply_to_comment_id: null,
				created_at: 1n,
				updated_at: 1n,
				content_text: 'Comment',
				content_json: null,
				anchor_json: anchor,
				is_resolved: false,
				resolved_by_user_id: null,
				is_deleted: false,
				created_by_agent: false,
			}).anchor_json,
		).toEqual(anchor)
	})

	test('keeps daemon anchors canonical and parses only 8-12 character UUID suffixes', () => {
		const rootId = crypto.randomUUID()
		const output = GetDiffCommentsOutputSchema.parse({
			comments: [
				{
					root: {
						id: rootId,
						truncatedId: rootId.slice(-12),
						createdByUserId: 'driver-1',
						createdByAgent: true,
						contentText: 'Agent reply',
						isDeleted: false,
					},
					replies: [],
					anchor,
					isResolved: false,
				},
			],
		})

		const firstThread = output.comments[0]
		if (!firstThread) throw new Error('Expected parsed daemon diff comment thread')
		expect(firstThread.anchor).toEqual(anchor)
		expectTypeOf(firstThread.anchor).toMatchTypeOf<
			NonNullable<z.infer<typeof diffCommentSelectSchema>['anchor_json']>
		>()
		expect(
			ReplyToDiffCommentInputSchema.safeParse({
				taskId: crypto.randomUUID(),
				truncatedCommentId: 'a1b2c3d4',
				contentText: 'Reply',
			}).success,
		).toBe(true)
		expect(
			UpdateDiffCommentsInputSchema.safeParse({
				taskId: crypto.randomUUID(),
				truncatedCommentIds: ['a1b2c3d4e5f6'],
				resolved: false,
			}).success,
		).toBe(true)
		expect(
			ReplyToDiffCommentInputSchema.safeParse({
				taskId: crypto.randomUUID(),
				truncatedCommentId: 'a1b2c3d',
				contentText: 'Reply',
			}).success,
		).toBe(false)
		expect(
			ReplyToDiffCommentInputSchema.safeParse({
				taskId: crypto.randomUUID(),
				truncatedCommentId: 'a1b2c3d4e5f67',
				contentText: 'Reply',
			}).success,
		).toBe(false)
	})
})
