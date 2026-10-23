import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { blockOffsetToPos, collectAnchorBlocks, pmTextBetween } from '../anchor/block-text-offsets'
import { buildSelectionIntent } from './selection'

let editors: Editor[] = []
afterEach(() => {
	for (const e of editors) e.destroy()
	editors = []
})

function docFor(markdown: string) {
	const editor = new Editor({ extensions: [StarterKit, Markdown], content: markdown, contentType: 'markdown', editable: false })
	editors.push(editor)
	return editor.state.doc
}

/** PM `[from, to)` for a character sub-range of the block at `blockIndex`. */
function pmRange(doc: ReturnType<typeof docFor>, blockIndex: number, start: number, end: number) {
	const block = collectAnchorBlocks(doc)[blockIndex]!
	return { from: blockOffsetToPos(block, start), to: blockOffsetToPos(block, end) }
}

const DOC = '# Title\n\nAlpha beta gamma.\n\nSecond paragraph here.'

describe('buildSelectionIntent', () => {
	test('rendered and PM quotes agree → a persistable selection intent', () => {
		const doc = docFor(DOC)
		const { from, to } = pmRange(doc, 1, 6, 10) // 'beta'
		const result = buildSelectionIntent(doc, from, to, 'beta', null)
		expect(result.status).toBe('selection')
		if (result.status !== 'selection') return
		expect(result.intent.anchor.scope).toBe('range')
		expect(result.intent.anchor.selectedText).toBe('beta')
		expect(result.intent.from).toBe(from)
		expect(result.intent.to).toBe(to)
	})

	test('disagreement between rendered and PM quotes is a non-persistable mismatch', () => {
		const doc = docFor(DOC)
		const { from, to } = pmRange(doc, 1, 6, 10) // PM says 'beta'
		const result = buildSelectionIntent(doc, from, to, 'gamma', null)
		expect(result.status).toBe('mismatch')
	})

	test('collapsed selection is empty (focused-block target stays authoritative)', () => {
		const doc = docFor(DOC)
		const { from } = pmRange(doc, 1, 3, 3)
		expect(buildSelectionIntent(doc, from, from, '', null).status).toBe('empty')
	})

	test('whitespace-only agreement still resolves (normalization tolerant)', () => {
		const doc = docFor(DOC)
		const block = collectAnchorBlocks(doc)[1]! // 'Alpha beta gamma.'
		const { from, to } = pmRange(doc, 1, 0, block.text.length)
		// Rendered quote carries collapsed extra spaces; normalization reconciles.
		const result = buildSelectionIntent(doc, from, to, 'Alpha  beta  gamma.', null)
		expect(result.status).toBe('selection')
	})

	test('multi-block selection preserves both endpoints and the joined quote', () => {
		const doc = docFor(DOC)
		const startBlock = collectAnchorBlocks(doc)[1]!
		const endBlock = collectAnchorBlocks(doc)[2]!
		const from = blockOffsetToPos(startBlock, 6) // 'beta gamma.'
		const to = blockOffsetToPos(endBlock, 6) // 'Second'
		const pmQuote = pmTextBetween(doc, from, to)
		const result = buildSelectionIntent(doc, from, to, pmQuote, null)
		expect(result.status).toBe('selection')
		if (result.status !== 'selection') return
		expect(result.intent.anchor.start.blockText).toBe('Alpha beta gamma.')
		expect(result.intent.anchor.end.blockText).toBe('Second paragraph here.')
	})

	test('backward selection (from > to) still yields a forward intent', () => {
		const doc = docFor(DOC)
		const { from, to } = pmRange(doc, 1, 6, 10)
		const result = buildSelectionIntent(doc, to, from, 'beta', null)
		expect(result.status).toBe('selection')
		if (result.status !== 'selection') return
		expect(result.intent.from).toBeLessThan(result.intent.to)
	})
})
