import { describe, expect, test } from 'vitest'

import { partitionCommentRowsByRootFormat, type PartitionableCommentRow } from './artifact-comment-format'

const anchor = { v: 2, scope: 'block', selectedText: 'x' }

function row(id: string, replyTo: string | null = null, anchorJson: unknown = null): PartitionableCommentRow {
	return { id: id, reply_to_comment_id: replyTo, anchor_json: anchorJson }
}

describe('partitionCommentRowsByRootFormat', () => {
	test('V2 roots and legacy roots partition with their replies following the root', () => {
		const rows = [
			row('v2-root', null, anchor),
			row('v2-reply', 'v2-root'), // reply itself has no anchor — follows its root
			row('legacy-root'),
			row('legacy-reply', 'legacy-root'),
		]
		const { v2, legacy } = partitionCommentRowsByRootFormat(rows)
		expect(v2.map((r) => r.id)).toEqual(['v2-root', 'v2-reply'])
		expect(legacy.map((r) => r.id)).toEqual(['legacy-root', 'legacy-reply'])
	})

	test('replies are never classified independently — an anchored reply under a legacy root stays legacy', () => {
		// Historical mixed rows: a reply row carrying its own anchor value must
		// not drag itself into V2 when its root is legacy.
		const rows = [row('legacy-root'), row('odd-reply', 'legacy-root', anchor)]
		const { v2, legacy } = partitionCommentRowsByRootFormat(rows)
		expect(v2).toEqual([])
		expect(legacy.map((r) => r.id)).toEqual(['legacy-root', 'odd-reply'])
	})

	test('nested (grandchild) reply chains walk to the true root', () => {
		const rows = [row('root', null, anchor), row('child', 'root'), row('grandchild', 'child')]
		const { v2, legacy } = partitionCommentRowsByRootFormat(rows)
		expect(v2.map((r) => r.id)).toEqual(['root', 'child', 'grandchild'])
		expect(legacy).toEqual([])
	})

	test('orphaned replies (missing/deleted root row) classify by their last reachable ancestor', () => {
		const rows = [row('orphan-legacy', 'gone'), row('orphan-anchored', 'gone', anchor)]
		const { v2, legacy } = partitionCommentRowsByRootFormat(rows)
		expect(legacy.map((r) => r.id)).toEqual(['orphan-legacy'])
		expect(v2.map((r) => r.id)).toEqual(['orphan-anchored'])
	})

	test('defensive: a reply cycle terminates and classifies deterministically', () => {
		const rows = [row('a', 'b'), row('b', 'a')]
		const { v2, legacy } = partitionCommentRowsByRootFormat(rows)
		expect(v2).toEqual([])
		expect(legacy.map((r) => r.id).sort()).toEqual(['a', 'b'])
	})

	test('partition is exhaustive and disjoint regardless of input order', () => {
		const rows = [
			row('v2-reply', 'v2-root'),
			row('legacy-reply', 'legacy-root'),
			row('v2-root', null, anchor),
			row('legacy-root'),
		]
		const { v2, legacy } = partitionCommentRowsByRootFormat(rows)
		const all = [...v2, ...legacy].map((r) => r.id).sort()
		expect(all).toEqual(['legacy-reply', 'legacy-root', 'v2-reply', 'v2-root'])
		const v2Ids = new Set(v2.map((r) => r.id))
		expect(legacy.some((r) => v2Ids.has(r.id))).toBe(false)
	})
})
