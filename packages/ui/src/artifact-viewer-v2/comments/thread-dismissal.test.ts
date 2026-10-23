import { describe, expect, test } from 'vitest'

import type { AnchorPlacement } from '../anchor/types'
import type { ProjectedCommentThread } from './project-comments'
import { collectDismissedThreads, mergeDismissingThreads } from './thread-dismissal'
import { commentRow as root } from '../test-utils/comment-row'

const placement: AnchorPlacement = { status: 'resolved', from: 1, to: 5 }

function thread(id: string): ProjectedCommentThread {
	return {
		root: root(id),
		replies: [],
		authorName: 'Ada',
		authorAvatarUrl: null,
		participants: [],
		placement,
	}
}

const ids = (entries: { thread: ProjectedCommentThread }[]) => entries.map((entry) => entry.thread.root.id)

describe('collectDismissedThreads', () => {
	test('captures every open thread with its index on a bulk send-and-resolve', () => {
		const previous = [thread('a'), thread('b'), thread('c')]
		const dismissed = collectDismissedThreads(previous, new Set(), new Set(['a', 'b', 'c']))

		expect(dismissed.map((entry) => entry.thread.root.id)).toEqual(['a', 'b', 'c'])
		expect(dismissed.map((entry) => entry.index)).toEqual([0, 1, 2])
	})

	test('a single resolved thread keeps its former index', () => {
		const previous = [thread('a'), thread('b'), thread('c')]
		const dismissed = collectDismissedThreads(previous, new Set(['a', 'c']), new Set(['b']))

		expect(dismissed).toHaveLength(1)
		expect(dismissed[0]!.thread.root.id).toBe('b')
		expect(dismissed[0]!.index).toBe(1)
	})

	test('threads that left without resolving (deleted or filtered) are not dismissals', () => {
		const previous = [thread('deleted'), thread('filtered')]
		expect(collectDismissedThreads(previous, new Set(), new Set())).toEqual([])
	})

	test('already-resolved threads leaving the list (Resolved → Open) are not dismissals', () => {
		const done = { ...thread('done'), root: root('done', { is_resolved: true }) }
		expect(collectDismissedThreads([done], new Set(['open']), new Set(['done']))).toEqual([])
	})

	test('still-visible threads are never dismissals even when marked resolved', () => {
		const previous = [thread('a')]
		expect(collectDismissedThreads(previous, new Set(['a']), new Set(['a']))).toEqual([])
	})
})

describe('mergeDismissingThreads', () => {
	test('reinserts a dismissing snapshot at its former index among remaining threads', () => {
		const merged = mergeDismissingThreads(
			[thread('a'), thread('c')],
			[{ thread: thread('b'), index: 1 }],
		)

		expect(ids(merged)).toEqual(['a', 'b', 'c'])
		expect(merged.map((entry) => entry.dismissing)).toEqual([false, true, false])
	})

	test('a bulk dismissal preserves document order when the visible list is empty', () => {
		const merged = mergeDismissingThreads(
			[],
			[
				{ thread: thread('b'), index: 1 },
				{ thread: thread('a'), index: 0 },
			],
		)

		expect(ids(merged)).toEqual(['a', 'b'])
		expect(merged.every((entry) => entry.dismissing)).toBe(true)
	})

	test('an out-of-range remembered index clamps to the end of the list', () => {
		const merged = mergeDismissingThreads([thread('a')], [{ thread: thread('z'), index: 9 }])

		expect(ids(merged)).toEqual(['a', 'z'])
	})

	test('no dismissals returns the visible list untouched', () => {
		const merged = mergeDismissingThreads([thread('a')], [])
		expect(ids(merged)).toEqual(['a'])
		expect(merged[0]!.dismissing).toBe(false)
	})
})
