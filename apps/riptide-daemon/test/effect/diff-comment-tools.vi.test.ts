import { it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { describe, expect } from 'vitest'

import {
	executeGetDiffComments,
	executeReplyToDiffComment,
	executeUpdateDiffComments,
	formatDiffCommentsPage,
} from '@/agents/shared/humanlayer-tools/executors'
import {
	GetDiffCommentsInputSchema,
	ReplyToDiffCommentInputSchema,
	TOOL_DESCRIPTIONS,
	UpdateDiffCommentsInputSchema,
} from '@/agents/shared/humanlayer-tools/schemas'

import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'

const rootId = '11111111-1111-4111-8111-111111111111'
const replyId = '22222222-2222-4222-8222-222222222222'

const thread = {
	root: {
		id: rootId,
		truncatedId: rootId.slice(-12),
		createdByUserId: 'reviewer-1',
		createdByAgent: false,
		contentText: 'Use <safe> output',
		isDeleted: false,
	},
	replies: [
		{
			id: replyId,
			truncatedId: replyId.slice(-12),
			createdByUserId: 'driver-1',
			createdByAgent: true,
			contentText: '',
			isDeleted: true,
		},
	],
	anchor: {
		v: 1 as const,
		repoId: 'syncopate',
		path: 'src/example.ts',
		patchHash: 'patch-one',
		start: { side: 'old' as const, line: 4 },
		end: { side: 'new' as const, line: 8 },
	},
	isResolved: false,
}

function makeDaemonApiLayer(overrides: {
	readonly getDiffComments?: () => Effect.Effect<{ comments: Array<typeof thread> }>
	readonly replyToDiffComment?: () => Effect.Effect<{
		readonly success: true
		readonly commentId: string
		readonly parentCommentId: string
		readonly transactionId: string
	}>
	readonly updateDiffComments?: () => Effect.Effect<{
		readonly success: boolean
		readonly updated: Array<{ truncatedId: string; commentId: string }>
		readonly failed: Array<{
			truncatedId: string
			reason: 'not_found' | 'ambiguous' | 'forbidden'
		}>
		readonly transactionId: string
	}>
}) {
	return makeMockDaemonApiLayer(overrides)
}

describe('diff comment tool executors', () => {
	it('parses defaults and unique short suffix input at the tool boundary', () => {
		expect(GetDiffCommentsInputSchema.parse({})).toEqual({ include_resolved: false, offset: 0, limit: 20 })
		expect(ReplyToDiffCommentInputSchema.parse({ thread_id: 'A1B2C3D4', content: 'Reply' })).toEqual({
			thread_id: 'A1B2C3D4',
			content: 'Reply',
		})
		expect(() => ReplyToDiffCommentInputSchema.parse({ thread_id: 'short', content: 'Reply' })).toThrow()
		expect(() => UpdateDiffCommentsInputSchema.parse({ comment_ids: ['not-hex-id'], resolved: true })).toThrow()
		expect(TOOL_DESCRIPTIONS.update_diff_comments).toContain('only when the user asks')
		expect(TOOL_DESCRIPTIONS.update_diff_comments).toContain('Send & Resolve')
	})

	it('names the left side each comment was written on', () => {
		expect(formatDiffCommentsPage([thread], 0, 20)).toContain('patch_hash="patch-one" source="task start"')
		const fromReview = { ...thread, anchor: { ...thread.anchor, sourceVersionId: 'syncopate:src/example.ts:abc' } }
		expect(formatDiffCommentsPage([fromReview], 0, 20)).toContain('source="version syncopate:src/example.ts:abc"')
	})

	it('includes the selected diff when the anchor has one, escaped like other text', () => {
		const withoutSnippet = formatDiffCommentsPage([thread], 0, 20)
		expect(withoutSnippet).not.toContain('selected_diff')
		expect(withoutSnippet).toBe(
			[
				'<diff_comments>',
				'<diff_comment id="111111111111" repo="syncopate" path="src/example.ts" patch_hash="patch-one" source="task start" start_side="old" start_line="4" end_side="new" end_line="8" resolved="false">',
				'  <comment id="111111111111" author="reviewer-1">Use &lt;safe&gt; output</comment>',
				'  <reply id="222222222222" author="driver-1&apos;s agent">Comment deleted</reply>',
				'</diff_comment>',
				'</diff_comments>',
			].join('\n'),
		)

		const withSnippet = {
			...thread,
			anchor: { ...thread.anchor, selectedDiff: ' if (a < b) {\n-  return "x"\n+  return "y"\n… 2 more lines' },
		}
		expect(formatDiffCommentsPage([withSnippet], 0, 20)).toContain(
			[
				'resolved="false">',
				'  <selected_diff>',
				' if (a &lt; b) {',
				'-  return &quot;x&quot;',
				'+  return &quot;y&quot;',
				'… 2 more lines',
				'  </selected_diff>',
				'  <comment id="111111111111"',
			].join('\n'),
		)
	})

	it('formats exact IDs, anchors, deleted rows, escaping, and paging after ordered results', () => {
		const secondThread = {
			...thread,
			root: { ...thread.root, id: '33333333-3333-4333-8333-333333333333', truncatedId: '333333333333' },
		}
		const output = formatDiffCommentsPage([thread, secondThread], 0, 1)
		expect(output).toContain('id="111111111111"')
		expect(output).toContain('repo="syncopate"')
		expect(output).toContain('start_side="old" start_line="4"')
		expect(output).toContain('end_side="new" end_line="8"')
		expect(output).toContain('Use &lt;safe&gt; output')
		expect(output).toContain('id="222222222222"')
		expect(output).toContain('Comment deleted')
		expect(output).not.toContain('333333333333')
		expect(output).toContain('(1 additional threads not returned)')
	})

	it.effect('yields DaemonApi and keeps task identity outside model input', () =>
		Effect.gen(function* () {
			const requests = yield* Ref.make<Array<unknown>>([])
			const layer = makeDaemonApiLayer({
				getDiffComments: () =>
					Ref.update(requests, (calls) => [...calls, 'get']).pipe(Effect.as({ comments: [thread] })),
				replyToDiffComment: () =>
					Ref.update(requests, (calls) => [...calls, 'reply']).pipe(
						Effect.as({
							success: true as const,
							commentId: replyId,
							parentCommentId: rootId,
							transactionId: '1',
						}),
					),
				updateDiffComments: () =>
					Ref.update(requests, (calls) => [...calls, 'update']).pipe(
						Effect.as({
							success: true,
							updated: [{ truncatedId: rootId.slice(-12), commentId: rootId }],
							failed: [],
							transactionId: '2',
						}),
					),
			})

			const getOutput = yield* executeGetDiffComments({
				taskId: 'task-from-server',
				toolInput: { include_resolved: false, offset: 0, limit: 20 },
			}).pipe(Effect.provide(layer))
			const replyOutput = yield* executeReplyToDiffComment({
				taskId: 'task-from-server',
				toolInput: { thread_id: rootId.slice(-12), content: 'Reply' },
			}).pipe(Effect.provide(layer))
			const updateOutput = yield* executeUpdateDiffComments({
				taskId: 'task-from-server',
				toolInput: { comment_ids: [rootId.slice(-12)], resolved: true },
			}).pipe(Effect.provide(layer))

			expect(getOutput).toContain('111111111111')
			expect(replyOutput).toBe('Reply added (id: 222222222222)')
			expect(updateOutput).toBe('Updated 1 comment(s)')
			expect(yield* Ref.get(requests)).toEqual(['get', 'reply', 'update'])
		}),
	)
})
