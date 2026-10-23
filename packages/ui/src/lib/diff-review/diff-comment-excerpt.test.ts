import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import { getSingularPatch } from '@pierre/diffs'
import { describe, expect, test } from 'vitest'

import { DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH } from '@humanlayer/db/zodschemas/diff-comment-anchor'

import { getComparisonDiff, type DiffReviewComparison } from './build-code-view-items'
import {
	buildDiffCommentSelectedDiff,
	DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS,
	extractDiffCommentExcerpts,
} from './diff-comment-excerpt'
import type { ProjectableDiffComment, ProjectedDiffThread } from './project-diff-comments'

const lines = (count: number, overrides: Record<number, string> = {}) =>
	`${Array.from({ length: count }, (_, index) => overrides[index + 1] ?? `line ${index + 1}`).join('\n')}\n`

// src/a.ts: line 11 changes from "old" to "new" in a 20-line file.
const comparisonA: DiffReviewComparison = {
	fileId: 'file-1',
	oldFile: { name: 'src/a.ts', contents: lines(20, { 10: 'keep', 11: 'old', 12: 'keep' }), cacheKey: 'a:old' },
	newFile: { name: 'src/a.ts', contents: lines(20, { 10: 'keep', 11: 'new', 12: 'keep' }), cacheKey: 'a:new' },
}

// src/b.ts: one change far below the anchored lines, which are unchanged context.
const comparisonB: DiffReviewComparison = {
	fileId: 'file-2',
	oldFile: { name: 'src/b.ts', contents: lines(30, { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' }), cacheKey: 'b:old' },
	newFile: {
		name: 'src/b.ts',
		contents: lines(30, { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 30: 'changed' }),
		cacheKey: 'b:new',
	},
}

const comparisonsByVersion: Record<string, DiffReviewComparison> = { 'patch-1': comparisonA, 'patch-2': comparisonB }
const resolve = (anchor: { readonly patchHash: string }) => comparisonsByVersion[anchor.patchHash]

function thread(anchor: NonNullable<DiffComment['anchor_json']>, id = 'root-1'): ProjectedDiffThread {
	const root: ProjectableDiffComment = {
		id,
		organization_id: 'org-1',
		resource_owner_user_id: 'user-1',
		task_id: 'task-1',
		created_by_user_id: 'user-1',
		reply_to_comment_id: null,
		created_at: 1n,
		updated_at: 1n,
		content_text: 'Root',
		content_json: null,
		anchor_json: anchor,
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
	}
	return { root, replies: [], placement: { status: 'current', fileId: 'file-1', side: 'new', line: anchor.end.line } }
}

const anchorBase = { v: 1 as const, repoId: 'repo-1', path: 'src/a.ts', patchHash: 'patch-1' }

describe('extractDiffCommentExcerpts', () => {
	test('synthesizes a unified diff of the new-side lines for a same-side range', () => {
		const excerpts = extractDiffCommentExcerpts(
			[thread({ ...anchorBase, start: { side: 'new', line: 10 }, end: { side: 'new', line: 12 } })],
			resolve,
		)

		expect(excerpts.get('root-1')).toEqual({
			hiddenLineCount: 0,
			patch: [
				'diff --git a/src/a.ts b/src/a.ts',
				'--- a/src/a.ts',
				'+++ b/src/a.ts',
				'@@ -10,2 +10,3 @@',
				' keep',
				'+new',
				' keep',
				'',
			].join('\n'),
		})
	})

	test('synthesizes both endpoints of a cross-side range in diff order', () => {
		const excerpts = extractDiffCommentExcerpts(
			[thread({ ...anchorBase, start: { side: 'old', line: 11 }, end: { side: 'new', line: 11 } })],
			resolve,
		)

		expect(excerpts.get('root-1')?.patch).toBe(
			[
				'diff --git a/src/a.ts b/src/a.ts',
				'--- a/src/a.ts',
				'+++ b/src/a.ts',
				'@@ -11,1 +11,1 @@',
				'-old',
				'+new',
				'',
			].join('\n'),
		)
	})

	test('keeps the last lines of a long range of expanded context and reports the hidden count', () => {
		const excerpts = extractDiffCommentExcerpts(
			[
				thread({
					...anchorBase,
					path: 'src/b.ts',
					patchHash: 'patch-2',
					start: { side: 'new', line: 1 },
					end: { side: 'new', line: 6 },
				}),
			],
			resolve,
		)

		const excerpt = excerpts.get('root-1')
		expect(excerpt?.hiddenLineCount).toBe(2)
		expect(excerpt?.patch).toBe(
			['diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -3,4 +3,4 @@', ' three', ' four', ' five', ' six', ''].join('\n'),
		)
	})

	test('emits a patch Pierre can parse back into the anchored rows', () => {
		const excerpts = extractDiffCommentExcerpts(
			[thread({ ...anchorBase, start: { side: 'new', line: 10 }, end: { side: 'new', line: 12 } })],
			resolve,
		)

		const roundTripped = getSingularPatch(excerpts.get('root-1')!.patch)
		expect(roundTripped?.name).toBe('src/a.ts')
		expect(roundTripped?.additionLines.map((line) => line.replace(/\n$/, ''))).toEqual(['keep', 'new', 'keep'])
	})

	test('omits threads whose anchored version is no longer available', () => {
		const excerpts = extractDiffCommentExcerpts(
			[thread({ ...anchorBase, patchHash: 'gone', start: { side: 'new', line: 10 }, end: { side: 'new', line: 10 } })],
			resolve,
		)

		expect(excerpts.size).toBe(0)
	})
})

describe('buildDiffCommentSelectedDiff', () => {
	const diffA = getComparisonDiff(comparisonA)!

	test('records a single removed line', () => {
		expect(buildDiffCommentSelectedDiff(diffA, { start: { side: 'old', line: 11 }, end: { side: 'old', line: 11 } })).toBe(
			'-old',
		)
	})

	test('records every row between the endpoints in unified-diff order', () => {
		const expected = [' keep', '-old', '+new', ' keep'].join('\n')
		expect(buildDiffCommentSelectedDiff(diffA, { start: { side: 'new', line: 10 }, end: { side: 'new', line: 12 } })).toBe(
			expected,
		)
		expect(buildDiffCommentSelectedDiff(diffA, { start: { side: 'old', line: 10 }, end: { side: 'new', line: 12 } })).toBe(
			expected,
		)
		// A selection dragged upward covers the same rows.
		expect(buildDiffCommentSelectedDiff(diffA, { start: { side: 'new', line: 12 }, end: { side: 'old', line: 10 } })).toBe(
			expected,
		)
	})

	test('keeps the first rows and counts the rest when the selection is over the row cap', () => {
		const leftOut = 12
		const count = DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS + leftOut
		const parsed = getComparisonDiff({
			fileId: 'file-3',
			oldFile: null,
			newFile: { name: 'src/c.ts', contents: lines(count), cacheKey: 'c:new' },
		})!
		const snippet = buildDiffCommentSelectedDiff(parsed, { start: { side: 'new', line: 1 }, end: { side: 'new', line: count } })
		const snippetLines = snippet!.split('\n')
		expect(snippetLines).toHaveLength(DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS + 1)
		expect(snippetLines[0]).toBe('+line 1')
		expect(snippetLines[DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS - 1]).toBe(`+line ${DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS}`)
		expect(snippetLines.at(-1)).toBe(`… ${leftOut} more lines`)
	})

	test('stays under the anchor length cap when rows are long', () => {
		const long = 'x'.repeat(3000)
		const parsed = getComparisonDiff({
			fileId: 'file-4',
			oldFile: null,
			newFile: { name: 'src/d.ts', contents: lines(5, { 1: long, 2: long, 3: long, 4: long, 5: long }), cacheKey: 'd:new' },
		})!
		const snippet = buildDiffCommentSelectedDiff(parsed, { start: { side: 'new', line: 1 }, end: { side: 'new', line: 5 } })!
		expect(snippet.length).toBeLessThanOrEqual(DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH)
		expect(snippet.split('\n')).toEqual([`+${long}`, `+${long}`, '… 3 more lines'])

		const huge = getComparisonDiff({
			fileId: 'file-5',
			oldFile: null,
			newFile: { name: 'src/e.ts', contents: `${'y'.repeat(20_000)}\n`, cacheKey: 'e:new' },
		})!
		const clipped = buildDiffCommentSelectedDiff(huge, { start: { side: 'new', line: 1 }, end: { side: 'new', line: 1 } })!
		expect(clipped.length).toBeLessThanOrEqual(DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH)
		expect(clipped).toMatch(/^\+y+…$/)
	})

	test('returns nothing when a point is not in the diff', () => {
		expect(buildDiffCommentSelectedDiff(diffA, { start: { side: 'new', line: 99 }, end: { side: 'new', line: 99 } })).toBeUndefined()
	})
})
