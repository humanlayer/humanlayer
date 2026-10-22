import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { describe, expect, test } from 'vitest'

import type { AnchorPlacement } from '../anchor/types'
import { decideCommentDeepLink } from './comment-deep-link'
import { commentVisibilityIncludes, visibilityRevealing } from './comment-visibility'
import type { ProjectedCommentThread, ProjectedReply } from './project-comments'
import { commentRow } from '../test-utils/comment-row'

function root(id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return commentRow(id, {
		created_by_user_id: 'author',
		content_text: `${id} text`,
		anchor_json: {
			v: 2,
			scope: 'block',
			selectedText: 'quoted',
			start: {
				blockType: 'paragraph',
				blockText: 'quoted',
				previousBlockText: null,
				nextBlockText: null,
				offset: 0,
			},
			end: {
				blockType: 'paragraph',
				blockText: 'quoted',
				previousBlockText: null,
				nextBlockText: null,
				offset: 6,
			},
		},
		...overrides,
	})
}

function reply(id: string): ProjectedReply {
	return {
		id,
		contentText: `${id} text`,
		contentJson: null,
		createdAt: 200n,
		createdByUserId: 'author',
		createdByAgent: false,
		authorName: 'Author',
		authorAvatarUrl: null,
	}
}

function thread(
	id: string,
	placement: AnchorPlacement,
	options: { replies?: ProjectedReply[]; resolved?: boolean; approximate?: ProjectedCommentThread['approximate'] } = {},
): ProjectedCommentThread {
	return {
		root: root(id, { is_resolved: options.resolved ?? false }),
		replies: options.replies ?? [],
		authorName: 'Author',
		authorAvatarUrl: null,
		participants: [],
		placement,
		approximate: options.approximate ?? null,
	}
}

const anchored: AnchorPlacement = { status: 'resolved', from: 1, to: 8 }
const outdated: AnchorPlacement = { status: 'outdated' }

describe('decideCommentDeepLink', () => {
	test('reveals an anchored open root in the document under the default Open filter', () => {
		const decision = decideCommentDeepLink('open-root', {
			threads: [thread('open-root', anchored)],
			resolvedThreads: [],
		})
		expect(decision).toEqual({
			status: 'reveal',
			rootId: 'open-root',
			replyId: null,
			requiredMode: 'rendered',
			visibility: 'open',
			scrollTarget: 'document',
			threadState: 'open',
		})
	})

	test('reveals an Outdated root without a location in the rail under Open', () => {
		const decision = decideCommentDeepLink('stale-root', {
			threads: [thread('stale-root', outdated)],
			resolvedThreads: [],
		})
		expect(decision).toMatchObject({
			status: 'reveal',
			rootId: 'stale-root',
			replyId: null,
			visibility: 'open',
			scrollTarget: 'rail',
			threadState: 'outdated',
		})
	})

	test('sends an Outdated root with an approximate location to the document, but its replies to the rail', () => {
		const approximate = { blockPos: 4, edge: 'after' as const }
		const facts = {
			threads: [thread('stale-root', outdated, { approximate, replies: [reply('stale-reply')] })],
			resolvedThreads: [],
		}
		expect(decideCommentDeepLink('stale-root', facts)).toMatchObject({
			visibility: 'open',
			scrollTarget: 'document',
			threadState: 'outdated',
		})
		expect(decideCommentDeepLink('stale-reply', facts)).toMatchObject({
			replyId: 'stale-reply',
			scrollTarget: 'rail',
		})
	})

	test('reveals a resolved root in the Resolved bucket', () => {
		const decision = decideCommentDeepLink('done-root', {
			threads: [],
			resolvedThreads: [thread('done-root', anchored, { resolved: true })],
		})
		expect(decision).toMatchObject({
			status: 'reveal',
			rootId: 'done-root',
			replyId: null,
			visibility: 'resolved',
			scrollTarget: 'rail',
			threadState: 'resolved',
		})
	})

	test('normalizes a reply ID to its root and targets the rail card', () => {
		const decision = decideCommentDeepLink('the-reply', {
			threads: [thread('open-root', anchored, { replies: [reply('the-reply')] })],
			resolvedThreads: [],
		})
		expect(decision).toMatchObject({
			status: 'reveal',
			rootId: 'open-root',
			replyId: 'the-reply',
			visibility: 'open',
			scrollTarget: 'rail',
			threadState: 'open',
		})
	})

	test('normalizes a reply in a resolved thread to the Resolved bucket', () => {
		const decision = decideCommentDeepLink('resolved-reply', {
			threads: [],
			resolvedThreads: [thread('done-root', outdated, { resolved: true, replies: [reply('resolved-reply')] })],
		})
		expect(decision).toMatchObject({
			status: 'reveal',
			rootId: 'done-root',
			replyId: 'resolved-reply',
			visibility: 'resolved',
			scrollTarget: 'rail',
			threadState: 'resolved',
		})
	})

	test('reports deleted, unknown, and unauthorized IDs identically as unavailable', () => {
		const facts = { threads: [thread('open-root', anchored)], resolvedThreads: [] }
		// Deleted and unauthorized rows never enter the projection, so all three
		// cases are one absent-ID result — no data leaks about which it was.
		expect(decideCommentDeepLink('missing-id', facts)).toEqual({ status: 'unavailable' })
	})

	test('rejects empty and whitespace-only IDs', () => {
		const facts = { threads: [thread('open-root', anchored)], resolvedThreads: [] }
		expect(decideCommentDeepLink('', facts)).toEqual({ status: 'unavailable' })
		expect(decideCommentDeepLink('   ', facts)).toEqual({ status: 'unavailable' })
	})
})

describe('commentVisibilityIncludes', () => {
	test('Open and Resolved are disjoint buckets; All includes both', () => {
		expect(commentVisibilityIncludes('open', 'open')).toBe(true)
		expect(commentVisibilityIncludes('open', 'resolved')).toBe(false)
		expect(commentVisibilityIncludes('resolved', 'resolved')).toBe(true)
		expect(commentVisibilityIncludes('resolved', 'open')).toBe(false)
		expect(commentVisibilityIncludes('all', 'open')).toBe(true)
		expect(commentVisibilityIncludes('all', 'resolved')).toBe(true)
	})

	test('a reveal keeps a compatible filter and otherwise switches to the target bucket', () => {
		expect(visibilityRevealing('all', 'resolved')).toBe('all')
		expect(visibilityRevealing('open', 'open')).toBe('open')
		expect(visibilityRevealing('open', 'resolved')).toBe('resolved')
		expect(visibilityRevealing('resolved', 'open')).toBe('open')
	})
})
