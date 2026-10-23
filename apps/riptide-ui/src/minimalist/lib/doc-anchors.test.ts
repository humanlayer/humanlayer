import { collectAnchorBlocks, normalizeAnchorText, resolveAnchor } from '@humanlayer/ui/artifact-viewer-v2'
import { Editor } from '@tiptap/core'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { all, createLowlight } from 'lowlight'
import { afterEach, describe, expect, it } from 'vitest'

import { body, splitBlocks } from '@/minimalist/lib/artifacts'
import { anchorSpan, docBlocks, rangeAnchor, topBlockAnchor } from '@/minimalist/lib/doc-anchors'

const DOC = [
	'# Plan: ship the thing',
	'',
	'Intro with **bold**, _emphasis_, `code` and a [link](https://example.com).',
	'Soft wrapped line.',
	'',
	'- first item',
	'- second item',
	'  - nested item',
	'- third item',
	'',
	'1. Loose one',
	'',
	'2. Loose two',
	'',
	'- [ ] open task',
	'- [x] done task',
	'',
	'> A quote',
	'> that wraps',
	'',
	'| Col A | Col B |',
	'|-------|-------|',
	'| a1 | `b1` |',
	'| a2 | b2 |',
	'',
	'```ts',
	'const x = 1',
	'',
	'const y = 2',
	'```',
	'',
	'---',
	'',
	'![diagram](https://example.com/a.png)',
	'',
	'Line one  ',
	'line two after a hard break.',
	'',
	'## Next steps',
	'',
	'Last paragraph.',
].join('\n')

let editors: Editor[] = []
afterEach(() => {
	for (const editor of editors) editor.destroy()
	editors = []
})

/** The standard viewer's parse, minus its React node views. */
function standardBlocks(markdown: string) {
	const editor = new Editor({
		extensions: [
			StarterKit.configure({ codeBlock: false }),
			Markdown,
			Image,
			TaskItem,
			TaskList,
			TableKit,
			CodeBlockLowlight.configure({ lowlight: createLowlight(all) }),
		],
		content: markdown,
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	return collectAnchorBlocks(editor.state.doc)
}

const ours = (markdown: string) => docBlocks(splitBlocks(body(markdown)))

describe('docBlocks', () => {
	it('finds the same blocks, in order, as the standard viewer', () => {
		const theirs = standardBlocks(DOC)
		const mine = ours(DOC)
		expect(mine.map((block) => [block.type, normalizeAnchorText(block.text)])).toEqual(
			theirs.map((block) => [block.type, normalizeAnchorText(block.text)]),
		)
	})

	it('records which top-level block each one sits in', () => {
		const blocks = ours(DOC)
		const tops = new Map(blocks.map((block) => [block.text, block.top]))
		expect(tops.get('first item')).toBe(tops.get('third item'))
		expect(tops.get('first item')).not.toBe(tops.get('Loose one'))
		expect(blocks.find((block) => block.text === 'nested item')?.ordinal).toBe(2)
	})
})

describe('anchorSpan placement', () => {
	it('places a standard viewer comment on the block it names', () => {
		const theirs = standardBlocks(DOC)
		const index = theirs.findIndex((block) => block.text === 'second item')
		const anchor = {
			v: 2 as const,
			scope: 'block' as const,
			selectedText: 'second item',
			start: {
				blockType: 'paragraph',
				blockText: 'second item',
				previousBlockText: theirs[index - 1]?.text ?? null,
				nextBlockText: theirs[index + 1]?.text ?? null,
				offset: 0,
			},
			end: {
				blockType: 'paragraph',
				blockText: 'second item',
				previousBlockText: theirs[index - 1]?.text ?? null,
				nextBlockText: theirs[index + 1]?.text ?? null,
				offset: 11,
			},
		}
		const blocks = ours(DOC)
		expect(anchorSpan(blocks, anchor)?.start.top ?? null).toBe(
			blocks.find((block) => block.text === 'first item')?.top,
		)
	})

	it('gives null once the text is gone', () => {
		const anchor = topBlockAnchor(ours(DOC), 0)
		if (!anchor) throw new Error('no anchor')
		expect(anchorSpan(ours(DOC.replace('ship the thing', 'ship something else')), anchor)).toBeNull()
	})

	it('follows a block that moved', () => {
		const anchor = topBlockAnchor(ours(DOC), ours(DOC).find((block) => block.text === 'Last paragraph.')?.top ?? -1)
		if (!anchor) throw new Error('no anchor')
		const moved = `Last paragraph.\n\n${DOC.replace('Last paragraph.', '')}`
		expect(anchorSpan(ours(moved), anchor)?.start.top ?? null).toBe(0)
	})
})

describe('anchors written here', () => {
	it('resolve in the standard viewer: a paragraph', () => {
		const blocks = ours(DOC)
		const top = blocks.find((block) => block.text.startsWith('Intro'))?.top ?? -1
		const anchor = topBlockAnchor(blocks, top)
		if (!anchor) throw new Error('no anchor')
		expect(anchor.scope).toBe('block')
		expect(resolveAnchor(standardBlocks(DOC), anchor).status).toBe('resolved')
	})

	it('resolve in the standard viewer: a whole list, as a range', () => {
		const blocks = ours(DOC)
		const top = blocks.find((block) => block.text === 'first item')?.top ?? -1
		const anchor = topBlockAnchor(blocks, top)
		if (!anchor) throw new Error('no anchor')
		expect(anchor.scope).toBe('range')
		expect(anchor.selectedText).toBe('first item\nsecond item\nnested item\nthird item')
		expect(resolveAnchor(standardBlocks(DOC), anchor).status).toBe('resolved')
	})

	it('resolve in the standard viewer: a selection across blocks', () => {
		const blocks = ours(DOC)
		const first = blocks.find((block) => block.text === 'first item')
		const second = blocks.find((block) => block.text === 'second item')
		if (!first || !second) throw new Error('missing blocks')
		const anchor = rangeAnchor(
			blocks,
			{ top: first.top, ordinal: first.ordinal, offset: 6 },
			{ top: second.top, ordinal: second.ordinal, offset: 6 },
		)
		expect(anchor?.selectedText).toBe('item\nsecond')
		if (!anchor) throw new Error('no anchor')
		expect(resolveAnchor(standardBlocks(DOC), anchor).status).toBe('resolved')
	})

	it('refuse an empty selection', () => {
		const blocks = ours(DOC)
		const first = blocks.find((block) => block.text === 'first item')
		if (!first) throw new Error('missing block')
		const point = { top: first.top, ordinal: first.ordinal, offset: 3 }
		expect(rangeAnchor(blocks, point, point)).toBeNull()
	})
})

describe('anchorSpan', () => {
	it('gives the selected words back as block points', () => {
		const blocks = ours(DOC)
		const first = blocks.find((block) => block.text === 'first item')
		const second = blocks.find((block) => block.text === 'second item')
		if (!first || !second) throw new Error('missing blocks')
		const start = { top: first.top, ordinal: first.ordinal, offset: 6 }
		const end = { top: second.top, ordinal: second.ordinal, offset: 6 }
		const anchor = rangeAnchor(blocks, start, end)
		if (!anchor) throw new Error('no anchor')
		expect(anchorSpan(blocks, anchor)).toEqual({ start, end })
	})

	it('spans a whole block from its first character to its last', () => {
		const blocks = ours(DOC)
		const intro = blocks.find((block) => block.text.startsWith('Intro'))
		if (!intro) throw new Error('missing block')
		const anchor = topBlockAnchor(blocks, intro.top)
		if (!anchor) throw new Error('no anchor')
		expect(anchorSpan(blocks, anchor)).toEqual({
			start: { top: intro.top, ordinal: 0, offset: 0 },
			end: { top: intro.top, ordinal: 0, offset: intro.text.length },
		})
	})
})
