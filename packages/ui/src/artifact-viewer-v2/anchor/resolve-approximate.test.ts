import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { collectAnchorBlocks, createRangeAnchor, createWholeBlockAnchor, blockOffsetToPos, type AnchorBlock } from './block-text-offsets'
import { resolveAnchor, resolveApproximateAnchor } from './resolve'
import type { AnchorV2 } from './types'

let editors: Editor[] = []
afterEach(() => {
	for (const editor of editors) editor.destroy()
	editors = []
})

function docFor(paragraphs: string[]) {
	const editor = new Editor({
		extensions: [StarterKit, Markdown],
		content: paragraphs.join('\n\n'),
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	return editor.state.doc
}

function blocksFor(paragraphs: string[]): AnchorBlock[] {
	return collectAnchorBlocks(docFor(paragraphs))
}

const ORIGINAL = ['Intro text.', 'Before block.', 'Target sentence.', 'After block.', 'Outro text.']

function targetAnchor(): AnchorV2 {
	return createWholeBlockAnchor(blocksFor(ORIGINAL), 2)
}

function textAt(blocks: AnchorBlock[], pos: number): string | undefined {
	return blocks.find((block) => block.pos === pos)?.text
}

/** Resolve like the projection: exact recovery first, approximate only when it fails. */
function place(blocks: AnchorBlock[], anchor: AnchorV2) {
	const placement = resolveAnchor(blocks, anchor)
	return { placement, approximate: placement.status === 'outdated' ? resolveApproximateAnchor(blocks, anchor) : null }
}

describe('resolveApproximateAnchor', () => {
	test('exact recovery wins; no approximate hint is computed for a located anchor', () => {
		const { placement, approximate } = place(blocksFor(ORIGINAL), targetAnchor())
		expect(placement.status).toBe('resolved')
		expect(approximate).toBeNull()
	})

	test('both neighbors in order place the marker after the preceding block', () => {
		const blocks = blocksFor(['Intro text.', 'Before block.', 'Rewritten sentence.', 'After block.', 'Outro text.'])
		const { placement, approximate } = place(blocks, targetAnchor())
		expect(placement.status).toBe('outdated')
		expect(approximate?.edge).toBe('after')
		expect(textAt(blocks, approximate!.blockPos)).toBe('Before block.')
	})

	test('content inserted between surviving neighbors still places after the preceding block', () => {
		const blocks = blocksFor(['Before block.', 'New one.', 'New two.', 'After block.'])
		const approximate = resolveApproximateAnchor(blocks, targetAnchor())
		expect(approximate?.edge).toBe('after')
		expect(textAt(blocks, approximate!.blockPos)).toBe('Before block.')
	})

	test('only the preceding neighbor survives → after it', () => {
		const blocks = blocksFor(['Intro text.', 'Before block.', 'Outro text.'])
		const approximate = resolveApproximateAnchor(blocks, targetAnchor())
		expect(approximate?.edge).toBe('after')
		expect(textAt(blocks, approximate!.blockPos)).toBe('Before block.')
	})

	test('only the following neighbor survives → before it', () => {
		const blocks = blocksFor(['Intro text.', 'After block.', 'Outro text.'])
		const approximate = resolveApproximateAnchor(blocks, targetAnchor())
		expect(approximate?.edge).toBe('before')
		expect(textAt(blocks, approximate!.blockPos)).toBe('After block.')
	})

	test('neighbors match after whitespace normalization', () => {
		const blocks = blocksFor(['Before   block.', 'Changed.', 'After block.'])
		const approximate = resolveApproximateAnchor(blocks, targetAnchor())
		expect(textAt(blocks, approximate!.blockPos)).toBe('Before   block.')
	})

	test('reversed neighbors are conflicting evidence → rail only', () => {
		const blocks = blocksFor(['After block.', 'Changed.', 'Before block.'])
		expect(resolveApproximateAnchor(blocks, targetAnchor())).toBeNull()
	})

	test('a duplicated neighbor is ambiguous, not missing; the other neighbor is not used', () => {
		const blocks = blocksFor(['Before block.', 'Changed.', 'Before block.', 'After block.'])
		expect(resolveApproximateAnchor(blocks, targetAnchor())).toBeNull()
	})

	test('no surviving neighbors → rail only', () => {
		expect(resolveApproximateAnchor(blocksFor(['Something else.', 'Entirely.']), targetAnchor())).toBeNull()
	})

	test('null boundary context and empty text identify nothing', () => {
		const first = createWholeBlockAnchor(blocksFor(['Only block.']), 0)
		expect(first.start.previousBlockText).toBeNull()
		expect(first.end.nextBlockText).toBeNull()
		expect(resolveApproximateAnchor(blocksFor(['Other.']), first)).toBeNull()

		const empty: AnchorV2 = {
			...first,
			start: { ...first.start, previousBlockText: '' },
			end: { ...first.end, nextBlockText: '   ' },
		}
		expect(resolveApproximateAnchor(blocksFor(['Other.', '   ']), empty)).toBeNull()
	})

	test('a multi-block range uses the block before its start and the block after its end', () => {
		const doc = docFor(ORIGINAL)
		const original = collectAnchorBlocks(doc)
		const from = blockOffsetToPos(original[1]!, 0)
		const to = blockOffsetToPos(original[3]!, original[3]!.text.length)
		const anchor = createRangeAnchor(doc, from, to)!
		expect(anchor.start.previousBlockText).toBe('Intro text.')
		expect(anchor.end.nextBlockText).toBe('Outro text.')

		const blocks = blocksFor(['Intro text.', 'All three rewritten.', 'Outro text.'])
		const { placement, approximate } = place(blocks, anchor)
		expect(placement.status).toBe('outdated')
		expect(approximate?.edge).toBe('after')
		expect(textAt(blocks, approximate!.blockPos)).toBe('Intro text.')
	})

	test('hints follow content updates and never rewrite the stored anchor', () => {
		const anchor = targetAnchor()
		const snapshot = structuredClone(anchor)

		const edited = blocksFor(['Before block.', 'Changed.', 'After block.'])
		expect(resolveApproximateAnchor(edited, anchor)).not.toBeNull()

		const ambiguous = blocksFor(['Before block.', 'Before block.'])
		expect(resolveApproximateAnchor(ambiguous, anchor)).toBeNull()

		const restored = blocksFor(ORIGINAL)
		expect(place(restored, anchor).placement.status).toBe('resolved')
		expect(anchor).toEqual(snapshot)
	})
})
