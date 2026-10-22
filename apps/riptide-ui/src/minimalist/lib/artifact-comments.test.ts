import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { describe, expect, it } from 'vitest'

import {
	commentsMessage,
	documentThreads,
	isClosedComment,
	parseCommentMessage,
	threadOf,
} from '@/minimalist/lib/artifact-comments'
import { docBlocks, rangeAnchor, topBlockAnchor } from '@/minimalist/lib/doc-anchors'

const row = (over: Partial<ArtifactComment>) =>
	({
		id: 'c',
		artifact_id: 'a1',
		reply_to_comment_id: null,
		is_resolved: false,
		is_deleted: false,
		anchor_json: null,
		created_at: 1n,
		content_text: '',
		commented_upon_block_text: null,
		previous_block_text: null,
		next_block_text: null,
		created_by_user_id: 'u1',
		created_by_agent: false,
		...over,
	}) as ArtifactComment

const texts = ['Plan', 'Step one', 'Step one and two', 'Step three']
const blocks = docBlocks(texts)
/** Open threads of the plain four-block document above. */
const openThreads = (rows: ArtifactComment[]) => {
	const { open, byBlock } = documentThreads(rows, blocks, texts)
	return { threads: open, byBlock }
}

describe('documentThreads with older anchors', () => {
	it('puts each open thread on its block, oldest first, with its replies in order', () => {
		const { threads, byBlock } = openThreads([
			row({ id: 'late', created_at: 3n, commented_upon_block_text: 'Step one' }),
			row({ id: 'early', created_at: 2n, commented_upon_block_text: 'Step one' }),
			row({ id: 'r2', reply_to_comment_id: 'early', created_at: 5n }),
			row({ id: 'r1', reply_to_comment_id: 'early', created_at: 4n }),
			row({ id: 'part', commented_upon_block_text: 'and two' }),
		])
		expect(threads.map((thread) => thread.root.id)).toEqual(['part', 'early', 'late'])
		expect(byBlock.get(1)?.map((thread) => thread.root.id)).toEqual(['early', 'late'])
		expect(byBlock.get(1)?.[0]?.replies.map((reply) => reply.id)).toEqual(['r1', 'r2'])
		// No exact match, so the first block that contains the anchor.
		expect(byBlock.get(2)?.map((thread) => thread.root.id)).toEqual(['part'])
	})

	it('sets aside threads whose block is gone and skips resolved or deleted ones', () => {
		const { threads, byBlock } = openThreads([
			row({ id: 'gone', commented_upon_block_text: 'Step four' }),
			row({ id: 'bare' }),
			row({ id: 'done', is_resolved: true, commented_upon_block_text: 'Plan' }),
			row({ id: 'deleted', is_deleted: true, commented_upon_block_text: 'Plan' }),
		])
		expect(threads.map((thread) => thread.root.id)).toEqual(['gone', 'bare'])
		expect([...byBlock.keys()]).toEqual([-1])
	})
})

describe('threadOf and isClosedComment', () => {
	const rows = [
		row({ id: 'open', commented_upon_block_text: 'Plan' }),
		row({ id: 'reply', reply_to_comment_id: 'open' }),
		row({ id: 'done', is_resolved: true, commented_upon_block_text: 'Plan' }),
		row({ id: 'done-reply', reply_to_comment_id: 'done' }),
		row({ id: 'unknown', anchor_json: { v: 3 } as ArtifactComment['anchor_json'] }),
	]

	it('finds the open thread a link names, by its root or a reply', () => {
		const { threads } = openThreads(rows)
		expect(threadOf(threads, 'reply')?.root.id).toBe('open')
		expect(threadOf(threads, 'done')).toBeUndefined()
	})

	it('calls a comment closed when it or its thread is resolved or deleted, or it is gone', () => {
		expect(isClosedComment(rows, 'reply')).toBe(false)
		expect(isClosedComment(rows, 'done-reply')).toBe(true)
		expect(isClosedComment(rows, 'missing')).toBe(true)
		// Open, though its anchor can't be read, so it sits with the threads whose text is gone.
		expect(isClosedComment(rows, 'unknown')).toBe(false)
	})
})

describe('commentsMessage and parseCommentMessage', () => {
	it('reads back what "Send to the agent" posts', () => {
		const { threads } = openThreads([
			row({
				id: 'root-1',
				content_text: 'Split this step',
				commented_upon_block_text: 'Step one',
				previous_block_text: 'Plan',
				next_block_text: 'Step one and two',
			}),
			row({ id: 'reply-1', reply_to_comment_id: 'root-1', content_text: 'Agreed', created_by_user_id: 'u2' }),
			row({ id: 'root-2', content_text: 'Add tests', created_at: 2n }),
		])
		const names = new Map([
			['u1', 'Dex'],
			['u2', 'Kyle'],
		])
		const message = commentsMessage(
			'plan.md',
			threads,
			(comment) => names.get(comment.created_by_user_id ?? '') ?? 'Someone',
		)

		expect(message).toContain('</comments>')
		expect(parseCommentMessage(message)).toEqual({
			file: 'plan.md',
			comments: [
				{ quote: 'Step one', lines: ['Dex: Split this step', 'Kyle: Agreed'] },
				{ quote: '', lines: ['Dex: Add tests'] },
			],
		})
	})

	it('quotes the selected words of a current comment, and names a guest', () => {
		const anchor = rangeAnchor(blocks, { top: 2, ordinal: 0, offset: 9 }, { top: 2, ordinal: 0, offset: 16 })
		const { open } = documentThreads(
			[
				row({
					id: 'guest',
					anchor_json: anchor as ArtifactComment['anchor_json'],
					content_text: 'Why both?',
					created_by_user_id: null,
					anonymous_author_id: 'g1',
					anonymous_guest_name: 'Sam',
				}),
			],
			blocks,
			texts,
		)
		const message = commentsMessage('plan.md', open, (comment) => comment.anonymous_guest_name ?? 'Someone')
		expect(parseCommentMessage(message)?.comments).toEqual([{ quote: 'and two', lines: ['Sam: Why both?'] }])
	})

	it('leaves ordinary messages alone', () => {
		expect(parseCommentMessage('Look at <comments> in the code')).toBeNull()
	})
})

describe('documentThreads with current anchors', () => {
	it('places them the way the standard viewer does, quoting only part of a block', () => {
		const whole = topBlockAnchor(blocks, 1)
		const part = rangeAnchor(blocks, { top: 2, ordinal: 0, offset: 9 }, { top: 2, ordinal: 0, offset: 16 })
		const { byBlock } = documentThreads(
			[
				row({ id: 'whole', anchor_json: whole as ArtifactComment['anchor_json'] }),
				row({ id: 'part', anchor_json: part as ArtifactComment['anchor_json'], created_at: 2n }),
			],
			blocks,
			texts,
		)
		expect(byBlock.get(1)?.map((thread) => [thread.root.id, thread.quote])).toEqual([['whole', null]])
		expect(byBlock.get(2)?.map((thread) => [thread.root.id, thread.quote])).toEqual([['part', 'and two']])
	})

	it('sets aside threads whose text is gone, and lists resolved ones apart', () => {
		const anchor = topBlockAnchor(blocks, 3)
		const { open, resolved, byBlock } = documentThreads(
			[
				row({ id: 'gone', anchor_json: anchor as ArtifactComment['anchor_json'] }),
				row({
					id: 'done',
					is_resolved: true,
					anchor_json: topBlockAnchor(blocks, 0) as ArtifactComment['anchor_json'],
				}),
				row({ id: 'reply', reply_to_comment_id: 'done', is_resolved: true }),
			],
			docBlocks(texts.slice(0, 3)),
			texts.slice(0, 3),
		)
		expect(open.map((thread) => thread.root.id)).toEqual(['gone'])
		expect([...byBlock.keys()]).toEqual([-1])
		expect(resolved.map((thread) => [thread.root.id, thread.replies.length])).toEqual([['done', 1]])
	})
})
