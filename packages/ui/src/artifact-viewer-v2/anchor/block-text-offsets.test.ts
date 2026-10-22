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
	posToBlockOffset,
	wholeBlockPmRange,
} from './block-text-offsets'
import { normalizeAnchorText } from './doc-text-search'
import { resolveAnchor } from './resolve'

let editors: Editor[] = []
afterEach(() => {
	for (const e of editors) e.destroy()
	editors = []
})

const MARKDOWN = [
	'# Title',
	'',
	'First paragraph.',
	'',
	'```ts',
	'const x = 1',
	'```',
	'',
	'![diagram](https://example.com/a.png)',
	'',
	'Last paragraph.',
].join('\n')

function makeEditor(markdown: string = MARKDOWN): Editor {
	const editor = new Editor({
		extensions: [StarterKit, Markdown, Image],
		content: markdown,
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	return editor
}

describe('collectAnchorBlocks', () => {
	test('collects textblocks and atoms in document order with rendered text', () => {
		const blocks = collectAnchorBlocks(makeEditor().state.doc)

		expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'codeBlock', 'image', 'paragraph'])
		expect(blocks.map((b) => b.text)).toEqual(['Title', 'First paragraph.', 'const x = 1', '', 'Last paragraph.'])
		expect(blocks.map((b) => b.kind)).toEqual(['textblock', 'textblock', 'textblock', 'atom', 'textblock'])
		// Positions ascend and each block's range is pos..pos+nodeSize.
		for (let i = 1; i < blocks.length; i++) expect(blocks[i]!.pos).toBeGreaterThan(blocks[i - 1]!.pos)
		for (const block of blocks) expect(block.end).toBeGreaterThan(block.pos)
	})
})

describe('createWholeBlockAnchor', () => {
	test('paragraph anchor spans the whole block with full context fingerprint', () => {
		const blocks = collectAnchorBlocks(makeEditor().state.doc)
		const anchor = createWholeBlockAnchor(blocks, 1)

		expect(anchor).toEqual({
			v: 2,
			scope: 'block',
			selectedText: 'First paragraph.',
			start: {
				blockType: 'paragraph',
				blockText: 'First paragraph.',
				previousBlockText: 'Title',
				nextBlockText: 'const x = 1',
				offset: 0,
			},
			end: {
				blockType: 'paragraph',
				blockText: 'First paragraph.',
				previousBlockText: 'Title',
				nextBlockText: 'const x = 1',
				offset: 'First paragraph.'.length,
			},
		})
	})

	test('first block has null previous context; last block has null next context', () => {
		const blocks = collectAnchorBlocks(makeEditor().state.doc)

		const heading = createWholeBlockAnchor(blocks, 0)
		expect(heading.start.blockType).toBe('heading')
		expect(heading.start.previousBlockText).toBeNull()

		const last = createWholeBlockAnchor(blocks, blocks.length - 1)
		expect(last.start.nextBlockText).toBeNull()
	})

	test('code block anchor stores the code text', () => {
		const blocks = collectAnchorBlocks(makeEditor().state.doc)
		const anchor = createWholeBlockAnchor(blocks, 2)
		expect(anchor.start.blockType).toBe('codeBlock')
		expect(anchor.selectedText).toBe('const x = 1')
		expect(anchor.end.offset).toBe('const x = 1'.length)
	})

	test('atom anchor has empty text, zero-length offsets, and neighbor evidence', () => {
		const blocks = collectAnchorBlocks(makeEditor().state.doc)
		const anchor = createWholeBlockAnchor(blocks, 3)
		expect(anchor.start.blockType).toBe('image')
		expect(anchor.selectedText).toBe('')
		expect(anchor.start.offset).toBe(0)
		expect(anchor.end.offset).toBe(0)
		expect(anchor.start.previousBlockText).toBe('const x = 1')
		expect(anchor.start.nextBlockText).toBe('Last paragraph.')
	})

	test('throws for an out-of-range block index', () => {
		const blocks = collectAnchorBlocks(makeEditor().state.doc)
		expect(() => createWholeBlockAnchor(blocks, blocks.length)).toThrow(RangeError)
	})
})

describe('wholeBlockPmRange', () => {
	test('maps a block back to its node range', () => {
		const blocks = collectAnchorBlocks(makeEditor().state.doc)
		const block = blocks[1]!
		expect(wholeBlockPmRange(block)).toEqual({ from: block.pos, to: block.end })
	})
})

/** PM `[from, to)` for a character sub-range of the block at `blockIndex`. */
function pmRange(doc: ReturnType<typeof makeEditor>['state']['doc'], blockIndex: number, start: number, end: number) {
	const block = collectAnchorBlocks(doc)[blockIndex]!
	return { from: blockOffsetToPos(block, start), to: blockOffsetToPos(block, end) }
}

/**
 * Round-trip a precise selection: build the anchor from a fresh document, then
 * resolve it against a reload and assert the resolved PM range reproduces the
 * exact selected text.
 */
function expectRangeRoundTrip(markdown: string, blockIndex: number, start: number, end: number, expected: string) {
	const original = makeEditor(markdown)
	const { from, to } = pmRange(original.state.doc, blockIndex, start, end)
	const anchor = createRangeAnchor(original.state.doc, from, to)
	expect(anchor?.scope).toBe('range')
	expect(anchor?.selectedText).toBe(expected)

	const reloaded = makeEditor(markdown)
	const blocks = collectAnchorBlocks(reloaded.state.doc)
	const placement = resolveAnchor(blocks, anchor!)
	expect(placement.status).toBe('resolved')
	if (placement.status !== 'resolved') return
	expect(normalizeAnchorText(pmTextBetween(reloaded.state.doc, placement.from, placement.to))).toBe(
		normalizeAnchorText(expected),
	)
}

describe('createRangeAnchor / posToBlockOffset — precise round trips', () => {
	test('single word inside a paragraph', () => {
		expectRangeRoundTrip('# H\n\nAlpha beta gamma.', 1, 6, 10, 'beta')
	})

	test('forward and backward selection produce the same anchor', () => {
		const doc = makeEditor('Alpha beta gamma.').state.doc
		const { from, to } = pmRange(doc, 0, 6, 10)
		expect(createRangeAnchor(doc, from, to)).toEqual(createRangeAnchor(doc, to, from))
	})

	test('collapsed selection is not a range (explicit whole-block only)', () => {
		const doc = makeEditor('Alpha beta.').state.doc
		const { from } = pmRange(doc, 0, 3, 3)
		expect(createRangeAnchor(doc, from, from)).toBeNull()
	})

	test('marked text (bold) round-trips across the mark boundary', () => {
		// textContent = "Some bold word." — "bold" spans its own text node.
		expectRangeRoundTrip('Some **bold** word.', 0, 5, 9, 'bold')
	})

	test('inline code round-trips', () => {
		expectRangeRoundTrip('Use the `foo()` call.', 0, 8, 13, 'foo()')
	})

	test('hard break: a selection spanning the break keeps the newline', () => {
		// "line1\nline2" — the hard break contributes one '\n' character.
		const original = makeEditor('line1\\\nline2')
		const blocks = collectAnchorBlocks(original.state.doc)
		expect(blocks[0]!.text).toBe('line1\nline2')
		const { from, to } = pmRange(original.state.doc, 0, 0, 11)
		const anchor = createRangeAnchor(original.state.doc, from, to)
		expect(anchor?.selectedText).toBe('line1\nline2')
		const placement = resolveAnchor(collectAnchorBlocks(makeEditor('line1\\\nline2').state.doc), anchor!)
		expect(placement.status).toBe('resolved')
	})

	test('code block content range round-trips', () => {
		expectRangeRoundTrip(['```ts', 'const value = 42', '```'].join('\n'), 0, 6, 11, 'value')
	})

	test('nested list item textblock range round-trips', () => {
		expectRangeRoundTrip(['- outer', '  - inner detail'].join('\n'), 1, 6, 12, 'detail')
	})

	test('cross-paragraph (multi-block) range keeps both endpoints', () => {
		const markdown = 'First paragraph here.\n\nSecond paragraph here.'
		const original = makeEditor(markdown)
		const blocks = collectAnchorBlocks(original.state.doc)
		const from = blockOffsetToPos(blocks[0]!, 6) // "paragraph here."
		const to = blockOffsetToPos(blocks[1]!, 6) // "Second"
		const anchor = createRangeAnchor(original.state.doc, from, to)
		expect(anchor?.start.blockText).toBe('First paragraph here.')
		expect(anchor?.end.blockText).toBe('Second paragraph here.')
		expect(anchor?.selectedText).toContain('paragraph here.')
		expect(anchor?.selectedText).toContain('Second')

		const placement = resolveAnchor(collectAnchorBlocks(makeEditor(markdown).state.doc), anchor!)
		expect(placement.status).toBe('resolved')
	})

	test('endpoint exactly at the end of a block content maps to the last offset', () => {
		const doc = makeEditor('Alpha beta.').state.doc
		const block = collectAnchorBlocks(doc)[0]!
		const endPos = blockOffsetToPos(block, block.text.length)
		expect(posToBlockOffset(block, endPos)).toBe(block.text.length)
	})
})
