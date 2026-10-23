import { describe, expect, it } from 'vitest'

import { buildCodeViewItems } from './build-code-view-items'
import { buildDiffNavigationIndex } from './build-diff-navigation-index'

const OLD_LINES = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
OLD_LINES[1] = 'old two'
OLD_LINES[17] = 'old eighteen'
const NEW_LINES = [...OLD_LINES]
NEW_LINES[1] = 'new two'
NEW_LINES.splice(17, 1, 'new eighteen', 'new nineteen')

// Changes at lines 2 and 18 sit far enough apart for two hunks with Pierre's four lines of context.
const COMPARISON = {
	fileId: 'src/example.ts',
	oldFile: { name: 'src/example.ts', contents: `${OLD_LINES.join('\n')}\n`, cacheKey: 'example:old' },
	newFile: { name: 'src/example.ts', contents: `${NEW_LINES.join('\n')}\n`, cacheKey: 'example:new' },
}

function buildIndex(diffStyle: 'unified' | 'split' = 'unified') {
	const items = buildCodeViewItems(
		[
			{ id: 'src/example.ts', binary: false },
			{ id: 'assets/logo.png', binary: true },
			{ id: 'src/pending.ts', binary: false },
		],
		[COMPARISON],
	)
	return buildDiffNavigationIndex(items, diffStyle, new Set(['assets/logo.png']))
}

describe('buildDiffNavigationIndex', () => {
	it('orders headers, context, changes, multiple hunks, and placeholders', () => {
		const index = buildIndex()
		expect(index.targets.map((target) => target.id)).toEqual([
			'header:src/example.ts',
			'line:src/example.ts:additions:1',
			'line:src/example.ts:deletions:2',
			'line:src/example.ts:additions:2',
			'line:src/example.ts:additions:3',
			'line:src/example.ts:additions:4',
			'line:src/example.ts:additions:5',
			'line:src/example.ts:additions:6',
			'line:src/example.ts:additions:14',
			'line:src/example.ts:additions:15',
			'line:src/example.ts:additions:16',
			'line:src/example.ts:additions:17',
			'line:src/example.ts:deletions:18',
			'line:src/example.ts:additions:18',
			'line:src/example.ts:additions:19',
			'line:src/example.ts:additions:20',
			'line:src/example.ts:additions:21',
			'header:assets/logo.png',
			'placeholder:assets/logo.png:binary',
			'header:src/pending.ts',
			'placeholder:src/pending.ts:pending',
		])
	})

	it('uses rendered row order for split changes', () => {
		const index = buildIndex('split')
		const secondHunk = index.targets
			.filter((target) => target.kind === 'line' && target.lineNumber >= 15)
			.map((target) => target.id)
		expect(secondHunk).toEqual([
			'line:src/example.ts:additions:15',
			'line:src/example.ts:additions:16',
			'line:src/example.ts:additions:17',
			'line:src/example.ts:deletions:18',
			'line:src/example.ts:additions:18',
			'line:src/example.ts:additions:19',
			'line:src/example.ts:additions:20',
			'line:src/example.ts:additions:21',
		])
	})

	it('clamps sequential and file movement without wrapping', () => {
		const index = buildIndex()
		const first = index.targets[0]!
		const last = index.targets[index.targets.length - 1]!
		expect(index.move(first, -1)).toEqual(first)
		expect(index.move(last, 1)).toEqual(last)
		expect(index.moveFile(first, -1)).toEqual(first)
		expect(index.moveFile(last, 1)?.id).toBe('header:src/pending.ts')
	})

	it('keeps collapsed files header-only and target ids stable', () => {
		const files = [{ id: 'src/example.ts', binary: false }]
		const comparisons = [COMPARISON]
		const expanded = buildDiffNavigationIndex(buildCodeViewItems(files, comparisons), 'unified')
		const collapsed = buildDiffNavigationIndex(buildCodeViewItems(files, comparisons, new Set([files[0]!.id])), 'unified')
		expect(collapsed.targets.map((target) => target.id)).toEqual(['header:src/example.ts'])
		expect(expanded.targets[0]?.id).toBe(collapsed.targets[0]?.id)
	})
})
