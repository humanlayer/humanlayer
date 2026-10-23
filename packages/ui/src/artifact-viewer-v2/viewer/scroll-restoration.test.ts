import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { collectAnchorBlocks } from '../anchor/block-text-offsets'
import { buildNavigableBlocks } from './build-navigable-blocks'
import {
	computeRestoredScrollPosition,
	createScrollRestorationTarget,
	resolveScrollRestorationBlock,
	selectReadingBlock,
	type ReadingBlockGeometry,
} from './scroll-restoration'

const editors: Editor[] = []

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy()
})

function documentParts(markdown: string) {
	const editor = new Editor({
		extensions: [StarterKit, Markdown],
		content: markdown,
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	return {
		anchorBlocks: collectAnchorBlocks(editor.state.doc),
		blocks: buildNavigableBlocks(editor.state.doc, []),
	}
}

function geometry(markdown: string, tops: number[], height = 40): ReadingBlockGeometry[] {
	const { blocks } = documentParts(markdown)
	return blocks.map((block, index) => ({ block, top: tops[index] ?? 0, bottom: (tops[index] ?? 0) + height }))
}

describe('scroll restoration helpers', () => {
	test('selects keyboard focus before the first block crossing the viewport top', () => {
		const geometries = geometry('One\n\nTwo\n\nThree', [70, 110, 150])
		expect(selectReadingBlock(geometries, 100, geometries[2]!.block.id, true)?.block).toBe(geometries[2]!.block)
		expect(selectReadingBlock(geometries, 100, null, false)?.block).toBe(geometries[0]!.block)
	})

	test('keeps the signed offset when the viewport top cuts through a tall block', () => {
		const geometries = geometry('Tall paragraph.\n\nLater paragraph.', [40, 260], 220)
		const selected = selectReadingBlock(geometries, 100, null, false)!
		const { anchorBlocks } = documentParts('Tall paragraph.\n\nLater paragraph.')
		expect(createScrollRestorationTarget(anchorBlocks, selected, 100)?.anchorViewportOffset).toBe(-60)
	})

	test('resolves the same block after insertion and deletion above it', () => {
		const original = documentParts('Before.\n\nTarget.\n\nAfter.')
		const selected = { block: original.blocks[1]!, top: 90, bottom: 130 }
		const target = createScrollRestorationTarget(original.anchorBlocks, selected, 100)!

		const inserted = documentParts('New top.\n\nBefore.\n\nTarget.\n\nAfter.')
		const deleted = documentParts('Target.\n\nAfter.')
		expect(resolveScrollRestorationBlock(inserted.anchorBlocks, target.anchor)?.text).toBe('Target.')
		expect(resolveScrollRestorationBlock(deleted.anchorBlocks, target.anchor)?.text).toBe('Target.')
	})

	test('uses neighboring context to resolve duplicate text', () => {
		const original = documentParts('First.\n\nRepeated.\n\nMiddle.\n\nRepeated.\n\nLast.')
		const selected = { block: original.blocks[3]!, top: 100, bottom: 140 }
		const target = createScrollRestorationTarget(original.anchorBlocks, selected, 100)!
		const replacement = documentParts('First.\n\nRepeated.\n\nMiddle.\n\nRepeated.\n\nLast.')
		expect(resolveScrollRestorationBlock(replacement.anchorBlocks, target.anchor)?.pos).toBe(
			replacement.anchorBlocks[3]!.pos,
		)
	})

	test('computes semantic correction and stale-anchor numeric fallback', () => {
		const original = documentParts('Before.\n\nTarget.')
		const selected = { block: original.blocks[1]!, top: 80, bottom: 120 }
		const target = createScrollRestorationTarget(original.anchorBlocks, selected, 100)!
		const replacement = documentParts('Inserted.\n\nBefore.\n\nTarget.')

		expect(
			computeRestoredScrollPosition({
				anchorBlocks: replacement.anchorBlocks,
				anchor: target.anchor,
				currentScrollTop: 300,
				currentAnchorViewportOffset: 140,
				savedAnchorViewportOffset: target.anchorViewportOffset,
				fallbackScrollTop: 75,
			}).scrollTop,
		).toBe(460)

		const rewritten = documentParts('Before.\n\nGone.')
		expect(
			computeRestoredScrollPosition({
				anchorBlocks: rewritten.anchorBlocks,
				anchor: target.anchor,
				currentScrollTop: 300,
				currentAnchorViewportOffset: null,
				savedAnchorViewportOffset: target.anchorViewportOffset,
				fallbackScrollTop: 75,
			}),
		).toEqual({ scrollTop: 75, resolvedBlock: null })
	})
})
