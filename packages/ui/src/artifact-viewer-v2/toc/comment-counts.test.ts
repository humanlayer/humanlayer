import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { describe, expect, test } from 'vitest'

import type { ArtifactCommentProjection, ProjectedCommentThread } from '../comments/project-comments'
import type { NavigableBlock } from '../viewer/build-navigable-blocks'
import { addOpenCommentCounts } from './comment-counts'
import type { OutlineItem } from './build-outline'
import { commentRow } from '../test-utils/comment-row'

const outline: OutlineItem[] = [
	{
		id: 'h1-one',
		level: 1,
		text: 'One',
		pos: 10,
		children: [
			{ id: 'h2-nested', level: 2, text: 'Nested', pos: 30, children: [] },
		],
	},
	{ id: 'h1-two', level: 1, text: 'Two', pos: 50, children: [] },
]

const blocks: NavigableBlock[] = [
	{ id: 'before', pos: 0, end: 9, type: 'paragraph', kind: 'textblock', sectionId: null },
	{ id: 'one', pos: 10, end: 20, type: 'heading', kind: 'textblock', sectionId: 'h1-one' },
	{ id: 'one-body', pos: 20, end: 30, type: 'paragraph', kind: 'textblock', sectionId: 'h1-one' },
	{ id: 'nested', pos: 30, end: 40, type: 'heading', kind: 'textblock', sectionId: 'h2-nested' },
	{ id: 'nested-body', pos: 40, end: 50, type: 'paragraph', kind: 'textblock', sectionId: 'h2-nested' },
	{ id: 'two', pos: 50, end: 60, type: 'heading', kind: 'textblock', sectionId: 'h1-two' },
]

function root(id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return commentRow(id, { created_by_user_id: 'user', created_at: 1n, updated_at: 1n, ...overrides })
}

function thread(
	id: string,
	placement: ProjectedCommentThread['placement'],
	overrides: Partial<ArtifactComment> = {},
	replyCount = 0,
): ProjectedCommentThread {
	return {
		root: root(id, overrides),
		replies: Array.from({ length: replyCount }, (_, index) => ({
			id: `${id}-reply-${index}`,
			contentText: 'reply',
			contentJson: null,
			createdAt: BigInt(index + 2),
			createdByUserId: 'user',
			createdByAgent: false,
			authorName: 'Ada',
			authorAvatarUrl: null,
		})),
		authorName: 'Ada',
		authorAvatarUrl: null,
		participants: [],
		placement,
	}
}

function projection(
	threads: ProjectedCommentThread[],
	resolvedThreads: ProjectedCommentThread[] = [],
): ArtifactCommentProjection {
	return { threads, resolvedThreads, highlights: [], rootIds: new Set(threads.map((item) => item.root.id)) }
}

function counts(result: ReturnType<typeof addOpenCommentCounts>): Record<string, number> {
	const entries: Array<[string, number]> = []
	const visit = (item: (typeof result)[number]) => {
		entries.push([item.id, item.commentCount])
		item.children.forEach(visit)
	}
	result.forEach(visit)
	return Object.fromEntries(entries)
}

describe('addOpenCommentCounts', () => {
	test('assigns whole-block and ranged roots to their nearest direct section', () => {
		const result = addOpenCommentCounts(
			outline,
			blocks,
			projection([
				thread('whole', { status: 'resolved', from: 20, to: 30 }),
				thread('range', { status: 'resolved', from: 34, to: 37 }),
				thread('sibling', { status: 'resolved', from: 50, to: 60 }),
			]),
		)

		expect(counts(result)).toEqual({ 'h1-one': 1, 'h2-nested': 1, 'h1-two': 1 })
	})

	test('assigns a multi-block range by its start without rolling up child counts', () => {
		const result = addOpenCommentCounts(
			outline,
			blocks,
			projection([thread('cross-section', { status: 'resolved', from: 25, to: 55 })]),
		)

		expect(counts(result)).toEqual({ 'h1-one': 1, 'h2-nested': 0, 'h1-two': 0 })
	})

	test('counts a root once regardless of replies', () => {
		const result = addOpenCommentCounts(
			outline,
			blocks,
			projection([thread('with-replies', { status: 'resolved', from: 40, to: 50 }, {}, 4)]),
		)

		expect(counts(result)['h2-nested']).toBe(1)
	})

	test('excludes pre-heading, Outdated, reply, resolved, and deleted rows', () => {
		const resolved = thread('resolved', { status: 'resolved', from: 20, to: 30 }, { is_resolved: true })
		const result = addOpenCommentCounts(
			outline,
			blocks,
			projection(
				[
					thread('pre-heading', { status: 'resolved', from: 1, to: 8 }),
					thread('outdated', { status: 'outdated' }),
					thread('reply-row', { status: 'resolved', from: 20, to: 30 }, { reply_to_comment_id: 'root' }),
					thread('deleted', { status: 'resolved', from: 20, to: 30 }, { is_deleted: true }),
				],
				[resolved],
			),
		)

		expect(counts(result)).toEqual({ 'h1-one': 0, 'h2-nested': 0, 'h1-two': 0 })
	})

	test('returns an empty model for an empty outline', () => {
		expect(addOpenCommentCounts([], [], projection([]))).toEqual([])
	})
})
