import { Editor } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import {
	blockOffsetToPos,
	collectAnchorBlocks,
	createRangeAnchor,
	createWholeBlockAnchor,
	pmTextBetween,
	type AnchorBlock,
} from './block-text-offsets'
import { normalizeAnchorText } from './doc-text-search'
import { parseAnchorV2, resolveAnchor } from './resolve'
import type { AnchorV2 } from './types'

let editors: Editor[] = []
afterEach(() => {
	for (const e of editors) e.destroy()
	editors = []
})

function docFor(markdown: string) {
	const editor = new Editor({
		extensions: [StarterKit, Markdown, Image],
		content: markdown,
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	return editor.state.doc
}

function blocksFor(markdown: string): AnchorBlock[] {
	return collectAnchorBlocks(docFor(markdown))
}

const DOC = ['# Title', '', 'Alpha paragraph.', '', 'Beta paragraph.', '', '```ts', 'const x = 1', '```'].join('\n')

function anchorFor(markdown: string, index: number): AnchorV2 {
	return createWholeBlockAnchor(blocksFor(markdown), index)
}

function expectResolvedAt(blocks: AnchorBlock[], anchor: AnchorV2, expectedText: string) {
	const placement = resolveAnchor(blocks, anchor)
	expect(placement.status).toBe('resolved')
	if (placement.status !== 'resolved') return
	const block = blocks.find((b) => b.pos === placement.from)
	expect(block?.text).toBe(expectedText)
	expect(placement.to).toBe(block?.end)
}

describe('resolveAnchor — whole-block chain', () => {
	test('exact reload: paragraph, heading, and code anchors resolve to the same blocks', () => {
		const original = blocksFor(DOC)
		const reloaded = blocksFor(DOC)

		expectResolvedAt(reloaded, createWholeBlockAnchor(original, 0), 'Title')
		expectResolvedAt(reloaded, createWholeBlockAnchor(original, 1), 'Alpha paragraph.')
		expectResolvedAt(reloaded, createWholeBlockAnchor(original, 3), 'const x = 1')
	})

	test('atom anchor resolves via type + neighboring context', () => {
		const doc = ['Before image.', '', '![a](https://example.com/a.png)', '', 'After image.'].join('\n')
		const original = blocksFor(doc)
		const anchor = createWholeBlockAnchor(original, 1)

		const reloaded = blocksFor(doc)
		const placement = resolveAnchor(reloaded, anchor)
		expect(placement.status).toBe('resolved')
		if (placement.status !== 'resolved') return
		expect(reloaded.find((b) => b.pos === placement.from)?.type).toBe('image')
	})

	test('local whitespace drift inside the block resolves through the normalized pass', () => {
		const anchor = anchorFor(DOC, 1) // 'Alpha paragraph.'
		const drifted = blocksFor(DOC.replace('Alpha paragraph.', 'Alpha  paragraph.'))
		expectResolvedAt(drifted, anchor, 'Alpha  paragraph.')
	})

	test('moved block recovers document-wide even when both neighbors changed', () => {
		const anchor = anchorFor(DOC, 2) // 'Beta paragraph.'
		const moved = blocksFor(
			['# Title', '', 'Alpha paragraph.', '', '```ts', 'const x = 1', '```', '', 'New tail.', '', 'Beta paragraph.'].join(
				'\n',
			),
		)
		expectResolvedAt(moved, anchor, 'Beta paragraph.')
	})

	test('duplicate block text disambiguates by stored neighboring context, not first match', () => {
		const doc = ['First intro.', '', 'Repeated line.', '', 'Middle text.', '', 'Repeated line.', '', 'Last outro.'].join(
			'\n',
		)
		const original = blocksFor(doc)
		// Anchor the SECOND duplicate (index 3).
		const anchor = createWholeBlockAnchor(original, 3)
		expect(anchor.start.previousBlockText).toBe('Middle text.')

		const reloaded = blocksFor(doc)
		const placement = resolveAnchor(reloaded, anchor)
		expect(placement.status).toBe('resolved')
		if (placement.status !== 'resolved') return
		// It must land on the later duplicate, whose neighbors match the anchor.
		expect(placement.from).toBe(reloaded[3]!.pos)
		expect(placement.from).not.toBe(reloaded[1]!.pos)
	})

	test('deleted or rewritten block text becomes outdated — no degraded placement', () => {
		const anchor = anchorFor(DOC, 1)
		const rewritten = blocksFor(DOC.replace('Alpha paragraph.', 'Completely different sentence.'))
		expect(resolveAnchor(rewritten, anchor)).toEqual({ status: 'outdated' })
	})

	test('ambiguous atoms (no own text, no context agreement) are outdated, not guessed', () => {
		const doc = ['Intro.', '', '![a](https://example.com/a.png)', '', 'Between.', '', '![b](https://example.com/b.png)'].join(
			'\n',
		)
		const original = blocksFor(doc)
		const anchor = createWholeBlockAnchor(original, 1)

		// All surrounding text rewritten: two image candidates, zero evidence.
		const rewritten = blocksFor(
			['New intro.', '', '![a](https://example.com/a.png)', '', 'New between.', '', '![b](https://example.com/b.png)'].join(
				'\n',
			),
		)
		expect(resolveAnchor(rewritten, anchor)).toEqual({ status: 'outdated' })
	})

})

/** Anchor a character sub-range of a block by offset. */
function rangeAnchorFor(markdown: string, blockIndex: number, start: number, end: number): AnchorV2 {
	const doc = docFor(markdown)
	const block = collectAnchorBlocks(doc)[blockIndex]!
	const anchor = createRangeAnchor(doc, blockOffsetToPos(block, start), blockOffsetToPos(block, end))
	if (!anchor) throw new Error('expected a range anchor')
	return anchor
}

function resolvedText(blocks: AnchorBlock[], doc: ReturnType<typeof docFor>, anchor: AnchorV2): string | null {
	const placement = resolveAnchor(blocks, anchor)
	if (placement.status !== 'resolved') return null
	return normalizeAnchorText(pmTextBetween(doc, placement.from, placement.to))
}

describe('resolveAnchor — precise range chain', () => {
	test('exact reload resolves precise offsets to the same words', () => {
		const anchor = rangeAnchorFor(DOC, 1, 6, 15) // 'paragraph' within 'Alpha paragraph.'
		expect(anchor.selectedText).toBe('paragraph')
		const doc = docFor(DOC)
		expect(resolvedText(collectAnchorBlocks(doc), doc, anchor)).toBe('paragraph')
	})

	test('local text drift within the block recovers via quote search', () => {
		const anchor = rangeAnchorFor(DOC, 1, 6, 15) // 'paragraph'
		// Insert text before the quote so the stored offset no longer points at it.
		const doc = docFor(DOC.replace('Alpha paragraph.', 'Alpha extra paragraph.'))
		expect(resolvedText(collectAnchorBlocks(doc), doc, anchor)).toBe('paragraph')
	})

	test('whitespace transform recovers via the normalized pass', () => {
		const anchor = rangeAnchorFor(DOC, 1, 0, 16) // 'Alpha paragraph.'
		const doc = docFor(DOC.replace('Alpha paragraph.', 'Alpha  paragraph.'))
		expect(resolvedText(collectAnchorBlocks(doc), doc, anchor)).toBe('Alpha paragraph.')
	})

	test('cross-block movement recovers document-wide', () => {
		const anchor = rangeAnchorFor(DOC, 2, 0, 15) // 'Beta paragraph.'
		const moved = docFor(['# Title', '', 'Alpha paragraph.', '', 'New tail added here.', '', 'Beta paragraph.'].join('\n'))
		expect(resolvedText(collectAnchorBlocks(moved), moved, anchor)).toBe('Beta paragraph.')
	})

	test('duplicate quote disambiguates by neighboring context, not first match', () => {
		const doc =
			'First intro line.\n\nRepeated quote text here.\n\nMiddle divider.\n\nRepeated quote text here.\n\nLast outro line.'
		const original = docFor(doc)
		const blocks = collectAnchorBlocks(original)
		// Anchor the SECOND occurrence (block index 3), quote "quote text".
		const secondBlock = blocks[3]!
		const anchor = createRangeAnchor(
			original,
			blockOffsetToPos(secondBlock, 9),
			blockOffsetToPos(secondBlock, 19),
		)!
		expect(anchor.selectedText).toBe('quote text')
		expect(anchor.start.previousBlockText).toBe('Middle divider.')

		const reloaded = docFor(doc)
		const reloadedBlocks = collectAnchorBlocks(reloaded)
		const placement = resolveAnchor(reloadedBlocks, anchor)
		expect(placement.status).toBe('resolved')
		if (placement.status !== 'resolved') return
		// Must land inside the SECOND repeated block, not the first.
		expect(placement.from).toBeGreaterThan(reloadedBlocks[3]!.pos)
		expect(placement.from).toBeLessThan(reloadedBlocks[3]!.end)
	})

	test('a vanished precise quote is Outdated — never floored to the whole block', () => {
		const anchor = rangeAnchorFor(DOC, 1, 0, 5) // 'Alpha' (unique in the doc)
		// The whole block still exists, but the quoted word is gone everywhere.
		const doc = docFor(DOC.replace('Alpha paragraph.', 'Zeta sentence.'))
		expect(resolveAnchor(collectAnchorBlocks(doc), anchor)).toEqual({ status: 'outdated' })
	})

	test('overlapping precise anchors both resolve independently', () => {
		const doc = docFor(DOC)
		const block = collectAnchorBlocks(doc)[1]! // 'Alpha paragraph.'
		const a = createRangeAnchor(doc, blockOffsetToPos(block, 0), blockOffsetToPos(block, 11))! // 'Alpha parag'
		const b = createRangeAnchor(doc, blockOffsetToPos(block, 6), blockOffsetToPos(block, 16))! // 'paragraph.'
		const reloaded = docFor(DOC)
		const reloadedBlocks = collectAnchorBlocks(reloaded)
		expect(resolveAnchor(reloadedBlocks, a).status).toBe('resolved')
		expect(resolveAnchor(reloadedBlocks, b).status).toBe('resolved')
	})
})

describe('parseAnchorV2 — resolver input contract', () => {
	test('legacy/null-anchor rows are outside the contract', () => {
		expect(parseAnchorV2(null)).toBeNull()
		expect(parseAnchorV2(undefined)).toBeNull()
		// A V1-style triplet object is not a V2 anchor.
		expect(
			parseAnchorV2({ commentedUponBlockText: 'x', previousBlockText: null, nextBlockText: null }),
		).toBeNull()
		expect(parseAnchorV2({ v: 1, selectedText: 'x' })).toBeNull()
		expect(parseAnchorV2('anchor')).toBeNull()
	})

	test('well-formed V2 envelopes round-trip', () => {
		const anchor = anchorFor(DOC, 1)
		expect(parseAnchorV2(JSON.parse(JSON.stringify(anchor)))).toEqual(anchor)
	})
})
