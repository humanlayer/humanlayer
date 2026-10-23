import { parseDiffFromFile } from '@pierre/diffs'
import { describe, expect, test } from 'vitest'

import { canSpanSplitRow, getSplitRowKey } from './split-annotation-rows'

const oldLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
// Line 5 becomes two lines (offset +1 after it); lines 30-31 are deleted (offset +1 → -1 after them).
const newLines = [
	...oldLines.slice(0, 4),
	'five a',
	'five b',
	...oldLines.slice(5, 29),
	...oldLines.slice(31),
]
const fileDiff = parseDiffFromFile(
	{ name: 'a.txt', contents: `${oldLines.join('\n')}\n` },
	{ name: 'a.txt', contents: `${newLines.join('\n')}\n` },
)

function annotation(side: 'deletions' | 'additions', lineNumber: number) {
	return { side, lineNumber }
}

describe('getSplitRowKey', () => {
	test('pairs the nth deleted and added line of a change block', () => {
		expect(getSplitRowKey(fileDiff, 'deletions', 5)).toBe(getSplitRowKey(fileDiff, 'additions', 5))
		expect(getSplitRowKey(fileDiff, 'additions', 6)).not.toBe(getSplitRowKey(fileDiff, 'deletions', 5))
	})

	test('pairs unchanged lines inside, between, and after hunks', () => {
		// Before any hunk.
		expect(getSplitRowKey(fileDiff, 'deletions', 1)).toBe(getSplitRowKey(fileDiff, 'additions', 1))
		// Context inside the first hunk.
		expect(getSplitRowKey(fileDiff, 'deletions', 7)).toBe(getSplitRowKey(fileDiff, 'additions', 8))
		// Collapsed region between hunks.
		expect(getSplitRowKey(fileDiff, 'deletions', 20)).toBe(getSplitRowKey(fileDiff, 'additions', 21))
		// After the last hunk.
		expect(getSplitRowKey(fileDiff, 'deletions', 38)).toBe(getSplitRowKey(fileDiff, 'additions', 37))
		expect(getSplitRowKey(fileDiff, 'deletions', 38)).not.toBe(getSplitRowKey(fileDiff, 'additions', 38))
	})

	test('gives deleted lines without a partner their own rows', () => {
		expect(getSplitRowKey(fileDiff, 'deletions', 30)).not.toBe(getSplitRowKey(fileDiff, 'deletions', 31))
		expect(getSplitRowKey(fileDiff, 'deletions', 30)).not.toBe(getSplitRowKey(fileDiff, 'additions', 30))
	})
})

describe('canSpanSplitRow', () => {
	test('spans when the other side has nothing on the row', () => {
		const annotations = [annotation('deletions', 5), annotation('additions', 6), annotation('additions', 0)]
		for (const item of annotations) expect(canSpanSplitRow(fileDiff, annotations, item)).toBe(true)
	})

	test('keeps both annotations in their columns when they share a row', () => {
		const annotations = [annotation('deletions', 7), annotation('additions', 8)]
		for (const item of annotations) expect(canSpanSplitRow(fileDiff, annotations, item)).toBe(false)
	})

	test('never spans added or deleted files, which split view renders as one column', () => {
		const added = parseDiffFromFile({ name: 'b.txt', contents: '' }, { name: 'b.txt', contents: 'one\ntwo\n' })
		const deleted = parseDiffFromFile({ name: 'b.txt', contents: 'one\ntwo\n' }, { name: 'b.txt', contents: '' })
		expect(added.type).toBe('new')
		expect(deleted.type).toBe('deleted')
		expect(canSpanSplitRow(added, [annotation('additions', 1)], annotation('additions', 1))).toBe(false)
		expect(canSpanSplitRow(deleted, [annotation('deletions', 1)], annotation('deletions', 1))).toBe(false)
	})
})
