import { describe, expect, test } from 'vitest'

import type { OutlineItem } from '../toc/build-outline'
import type { NavigableBlock } from '../viewer/build-navigable-blocks'
import {
	buildSectionRanges,
	getFoldedHeadingIdsContainingPosition,
	getSectionForBlock,
	getVisibleBlocks,
} from './section-ranges'

const blocks = [0, 2, 4, 6, 8, 10].map((pos) => ({
	id: `heading-${pos}`,
	pos,
	end: pos + 2,
	type: pos % 4 === 0 ? 'heading' : 'paragraph',
	kind: 'textblock' as const,
	sectionId: pos < 4 ? 'a' : pos < 8 ? 'b' : 'c',
})) satisfies NavigableBlock[]

const outline: OutlineItem[] = [
	{ id: 'a', level: 1, text: 'A', pos: 0, children: [{ id: 'b', level: 2, text: 'B', pos: 4, children: [] }] },
	{ id: 'c', level: 1, text: 'C', pos: 8, children: [] },
]

describe('section ranges', () => {
	test('includes nested headings until an equal or higher sibling', () => {
		const ranges = buildSectionRanges(outline, blocks)
		expect(ranges.find((range) => range.id === 'a')?.descendantBlocks.map((block) => block.id)).toEqual([
			'heading-2', 'heading-4', 'heading-6',
		])
		expect(ranges.find((range) => range.id === 'b')?.descendantBlocks.map((block) => block.id)).toEqual(['heading-6'])
		expect(ranges.find((range) => range.id === 'c')?.descendantBlocks.map((block) => block.id)).toEqual(['heading-10'])
	})

	test('resolves focused headings and descendants and filters nested content', () => {
		const ranges = buildSectionRanges(outline, blocks)
		expect(getSectionForBlock(blocks[3]!, ranges)?.id).toBe('b')
		expect(getVisibleBlocks(blocks, ranges, new Set(['a'])).map((block) => block.pos)).toEqual([0, 8, 10])
	})

	test('handles empty documents', () => {
		expect(buildSectionRanges([], [])).toEqual([])
	})

	test('finds folded parents from outer to inner with strict bounds', () => {
		const ranges = buildSectionRanges(outline, blocks)
		const folded = new Set(['a', 'b', 'c'])
		expect(getFoldedHeadingIdsContainingPosition(6, ranges, folded)).toEqual(['a', 'b'])
		expect(getFoldedHeadingIdsContainingPosition(4, ranges, folded)).toEqual(['a'])
		expect(getFoldedHeadingIdsContainingPosition(8, ranges, folded)).toEqual([])
	})
})
