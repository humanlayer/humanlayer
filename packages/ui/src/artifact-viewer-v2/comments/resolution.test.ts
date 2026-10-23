import { describe, expect, test } from 'vitest'

import type { AnchorPlacement } from '../anchor/types'
import type { ProjectedCommentThread, ProjectedReply } from './project-comments'
import { isThreadResolved, partitionThreadsByResolution } from './resolution'
import { commentRow as root } from '../test-utils/comment-row'

function reply(id: string, overrides: Partial<ProjectedReply> = {}): ProjectedReply {
	return {
		id,
		contentText: id,
		contentJson: null,
		createdAt: 200n,
		createdByUserId: 'user-1',
		createdByAgent: false,
		authorName: 'Ada',
		authorAvatarUrl: null,
		...overrides,
	}
}

const placement: AnchorPlacement = { status: 'resolved', from: 1, to: 5 }

function thread(id: string, resolved: boolean, replies: ProjectedReply[] = []): ProjectedCommentThread {
	return {
		root: root(id, { is_resolved: resolved }),
		replies,
		authorName: 'Ada',
		authorAvatarUrl: null,
		participants: [],
		placement,
	}
}

describe('partitionThreadsByResolution', () => {
	test('splits threads into open and resolved by their root state, preserving order', () => {
		const openA = thread('open-a', false)
		const resolvedA = thread('resolved-a', true)
		const openB = thread('open-b', false)
		const { open, resolved } = partitionThreadsByResolution([openA, resolvedA, openB])

		expect(open.map((t) => t.root.id)).toEqual(['open-a', 'open-b'])
		expect(resolved.map((t) => t.root.id)).toEqual(['resolved-a'])
	})

	test('a resolved root carries all of its replies into the resolved bucket', () => {
		const replies = [reply('r-1'), reply('r-2', { createdByAgent: true, authorName: 'Agent' })]
		const resolvedThread = thread('resolved-root', true, replies)
		const { open, resolved } = partitionThreadsByResolution([resolvedThread])

		expect(open).toEqual([])
		expect(resolved).toHaveLength(1)
		// Replies follow their root's effective state — the whole thread moves as a unit.
		expect(resolved[0]!.replies.map((r) => r.id)).toEqual(['r-1', 'r-2'])
	})

	test('an open root keeps its replies in the open bucket', () => {
		const openThread = thread('open-root', false, [reply('r-1')])
		const { open, resolved } = partitionThreadsByResolution([openThread])

		expect(resolved).toEqual([])
		expect(open[0]!.replies.map((r) => r.id)).toEqual(['r-1'])
	})

	test('isThreadResolved reads the root row, ignoring reply rows', () => {
		expect(isThreadResolved(thread('a', true))).toBe(true)
		expect(isThreadResolved(thread('b', false))).toBe(false)
	})

	test('empty input yields two empty buckets', () => {
		expect(partitionThreadsByResolution([])).toEqual({ open: [], resolved: [] })
	})
})
