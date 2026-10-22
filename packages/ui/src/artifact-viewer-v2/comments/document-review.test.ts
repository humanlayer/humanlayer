import { describe, expect, it } from 'vitest'

import type { NavigableBlock } from '../viewer/build-navigable-blocks'
import type { ProjectedCommentThread } from './project-comments'
import {
	decideDocumentReviewClick,
	deriveDocumentReviewFacts,
	pickThreadCoveringTarget,
	verdictAlreadyPresent,
} from './document-review'

const blocks: NavigableBlock[] = [
	{ id: 'block-1', pos: 10, end: 30, kind: 'textblock', type: 'paragraph', sectionId: null },
]

describe('document review behavior', () => {
	it('activates the deterministic precise highlight and leaves undecorated text targetable', () => {
		const highlights = [
			{ rootCommentId: 'later', from: 12, to: 22, createdAt: 20 },
			{ rootCommentId: 'small', from: 14, to: 18, createdAt: 30 },
			{ rootCommentId: 'early', from: 12, to: 22, createdAt: 10 },
		]
		expect(decideDocumentReviewClick(15, blocks, highlights)).toEqual({ kind: 'activate', rootCommentId: 'small' })
		expect(decideDocumentReviewClick(20, blocks, highlights)).toEqual({ kind: 'activate', rootCommentId: 'early' })
		expect(decideDocumentReviewClick(25, blocks, highlights)).toEqual({ kind: 'target-block', block: blocks[0] })
	})

	it('uses creation time then root ID for equal spans and excludes the end position', () => {
		const equal = [
			{ rootCommentId: 'z', from: 12, to: 18, createdAt: 10 },
			{ rootCommentId: 'a', from: 12, to: 18, createdAt: 10 },
		]
		expect(decideDocumentReviewClick(12, blocks, equal)).toEqual({ kind: 'activate', rootCommentId: 'a' })
		expect(decideDocumentReviewClick(18, blocks, equal).kind).toBe('target-block')
	})

	it('derives whole-block gutters and precise rails from one projection', () => {
		const participant = { userId: 'u1', name: 'A', avatarUrl: '' }
		const thread = (id: string, from: number, to: number) =>
			({ root: { id }, replies: [], participants: [participant], placement: { status: 'resolved', from, to } }) as unknown as ProjectedCommentThread
		const facts = deriveDocumentReviewFacts(
			[thread('whole', 10, 30), thread('precise', 14, 18)],
			blocks,
			new Set(['precise']),
		)
		expect(facts.gutterItems).toEqual([{ blockPos: 10, rootCommentIds: ['whole', 'precise'], participants: [participant] }])
		expect(facts.railRanges).toEqual([{ key: 'precise', from: 14, to: 18, active: true }])
	})

	it('derives approximate markers for Outdated threads with hints, grouped by block edge, never as highlights', () => {
		const outdated = (id: string, approximate: ProjectedCommentThread['approximate']) =>
			({ root: { id }, replies: [], participants: [], placement: { status: 'outdated' }, approximate }) as unknown as ProjectedCommentThread
		const facts = deriveDocumentReviewFacts(
			[
				outdated('a', { blockPos: 10, edge: 'after' }),
				outdated('b', { blockPos: 10, edge: 'after' }),
				outdated('c', { blockPos: 10, edge: 'before' }),
				outdated('stale-pos', { blockPos: 99, edge: 'after' }),
				outdated('none', null),
			],
			blocks,
			new Set(),
		)
		expect(facts.approximateMarkers).toEqual([
			{ key: '10:after', blockPos: 10, edge: 'after', rootCommentIds: ['a', 'b'] },
			{ key: '10:before', blockPos: 10, edge: 'before', rootCommentIds: ['c'] },
		])
		expect(facts.gutterItems).toEqual([])
		expect(facts.railRanges).toEqual([])
	})

	it('treats a repeated same-kind verdict as already present but lets other kinds stack', () => {
		const highlights = [{ rootCommentId: 'del', from: 10, to: 30, createdAt: 10, kind: 'deletion' as const }]
		// Re-issuing `d` on the already-deleted block is a no-op.
		expect(verdictAlreadyPresent(highlights, { from: 10, to: 30 }, 'deletion')).toBe(true)
		// `a` on the same block still stacks (cross-kind verdicts are allowed).
		expect(verdictAlreadyPresent(highlights, { from: 10, to: 30 }, 'approval')).toBe(false)
		// A disjoint block carries no verdict yet.
		expect(verdictAlreadyPresent(highlights, { from: 40, to: 60 }, 'deletion')).toBe(false)
	})

	it('picks the smallest deterministic annotation that fully covers a target', () => {
		const highlights = [
			{ rootCommentId: 'wide', from: 5, to: 40, createdAt: 1 },
			{ rootCommentId: 'later', from: 10, to: 30, createdAt: 2 },
			{ rootCommentId: 'earlier', from: 10, to: 30, createdAt: 1 },
		]

		expect(pickThreadCoveringTarget(highlights, { from: 12, to: 20 })).toBe('earlier')
	})

	it('does not continue a thread that only partially overlaps the target', () => {
		const highlights = [{ rootCommentId: 'partial', from: 10, to: 20 }]

		expect(pickThreadCoveringTarget(highlights, { from: 15, to: 25 })).toBeNull()
	})
})
