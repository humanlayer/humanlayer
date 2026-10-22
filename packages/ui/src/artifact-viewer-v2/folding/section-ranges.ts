import { flattenOutline, type OutlineItem } from '../toc/build-outline'
import type { NavigableBlock } from '../viewer/build-navigable-blocks'

export interface SectionRange {
	id: string
	headingPos: number
	/** Position of the next heading of equal or higher level, or document end. */
	endPos: number
	level: number
	/** Blocks hidden when this section is folded. */
	descendantBlocks: Array<Pick<NavigableBlock, 'id' | 'pos' | 'end'>>
}

export function buildSectionRanges(outline: OutlineItem[], blocks: NavigableBlock[]): SectionRange[] {
	const headings = flattenOutline(outline)
	return headings.map((heading, index) => {
		const boundary = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)?.pos ?? Infinity
		return {
			id: heading.id,
			headingPos: heading.pos,
			endPos: boundary,
			level: heading.level,
			descendantBlocks: blocks
				.filter((block) => block.pos > heading.pos && block.pos < boundary)
				.map(({ id, pos, end }) => ({ id, pos, end })),
		}
	})
}

export function getSectionForBlock(
	block: NavigableBlock | null,
	ranges: SectionRange[],
): SectionRange | null {
	if (!block) return null
	return ranges.find((range) => range.id === block.sectionId) ?? null
}

export function getVisibleBlocks(
	blocks: NavigableBlock[],
	ranges: SectionRange[],
	foldedHeadingIds: ReadonlySet<string>,
): NavigableBlock[] {
	const hidden = new Set(
		ranges
			.filter((range) => foldedHeadingIds.has(range.id))
			.flatMap((range) => range.descendantBlocks.map((block) => block.id)),
	)
	return blocks.filter((block) => !hidden.has(block.id))
}

export function getFoldedHeadingIdsContainingPosition(
	position: number,
	ranges: SectionRange[],
	foldedHeadingIds: ReadonlySet<string>,
): string[] {
	return ranges
		.filter(
			(range) =>
				foldedHeadingIds.has(range.id) && position > range.headingPos && position < range.endPos,
		)
		.sort((a, b) => a.level - b.level)
		.map((range) => range.id)
}
