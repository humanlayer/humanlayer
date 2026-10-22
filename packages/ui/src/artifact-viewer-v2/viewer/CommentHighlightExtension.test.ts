import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { blockOffsetToPos, collectAnchorBlocks } from '../anchor/block-text-offsets'
import {
	COMMENT_ACTIVE_CLASS,
	COMMENT_APPROVAL_CLASS,
	COMMENT_BLOCK_CLASS,
	COMMENT_DELETION_CLASS,
	COMMENT_PENDING_CLASS,
	COMMENT_RANGE_CLASS,
	CommentHighlightExtension,
	getCommentHighlightState,
	pickRangeAt,
	setActiveCommentHighlights,
	setCommentHighlights,
	setPendingHighlight,
	type CommentHighlightRange,
} from './CommentHighlightExtension'
import { KEYBOARD_FOCUS_CLASS, KeyboardFocusExtension, setKeyboardBlockFocus } from './KeyboardFocusExtension'

let editors: Editor[] = []
afterEach(() => {
	for (const e of editors) e.destroy()
	editors = []
})

const MARKDOWN = ['# Title', '', 'First paragraph.', '', '---', '', 'Second paragraph.'].join('\n')

function makeEditor(markdown: string = MARKDOWN): Editor {
	const editor = new Editor({
		extensions: [StarterKit, Markdown, KeyboardFocusExtension, CommentHighlightExtension],
		content: markdown,
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	return editor
}

function blockPos(editor: Editor, predicate: (typeName: string, text: string) => boolean): { pos: number; end: number } {
	let found: { pos: number; end: number } | null = null
	editor.state.doc.descendants((node, pos) => {
		if (found) return false
		if ((node.isTextblock || (node.isBlock && node.isAtom)) && predicate(node.type.name, node.textContent)) {
			found = { pos, end: pos + node.nodeSize }
			return false
		}
		return true
	})
	expect(found).not.toBeNull()
	return found!
}

function commentedDomNodes(editor: Editor): Element[] {
	return Array.from(editor.view.dom.querySelectorAll(`.${COMMENT_BLOCK_CLASS}`))
}

describe('CommentHighlightExtension', () => {
	test('starts empty with no decorations', () => {
		const editor = makeEditor()
		expect(getCommentHighlightState(editor.state).ranges).toEqual([])
		expect(commentedDomNodes(editor)).toHaveLength(0)
	})

	test('a whole-block range decorates the block node', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')

		setCommentHighlights(editor.view, [{ rootCommentId: 'c1', from: para.pos, to: para.end }])

		const decorated = commentedDomNodes(editor)
		expect(decorated).toHaveLength(1)
		expect(decorated[0]!.textContent).toBe('First paragraph.')
		expect(decorated[0]!.getAttribute('data-comment-root-ids')).toBe('c1')
	})

	test('multiple comments on one block collapse into one block-level state', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')

		setCommentHighlights(editor.view, [
			{ rootCommentId: 'c1', from: para.pos, to: para.end },
			{ rootCommentId: 'c2', from: para.pos, to: para.end },
		])

		const decorated = commentedDomNodes(editor)
		expect(decorated).toHaveLength(1)
		expect(decorated[0]!.getAttribute('data-comment-root-ids')).toBe('c1,c2')
	})

	test('atom blocks (horizontal rule) receive the comment state', () => {
		const editor = makeEditor()
		const hr = blockPos(editor, (type) => type === 'horizontalRule')

		setCommentHighlights(editor.view, [{ rootCommentId: 'c-hr', from: hr.pos, to: hr.end }])

		const decorated = commentedDomNodes(editor)
		expect(decorated).toHaveLength(1)
		expect(decorated[0]!.tagName.toLowerCase()).toBe('hr')
	})

	test('removing a comment removes its decoration', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')

		setCommentHighlights(editor.view, [{ rootCommentId: 'c1', from: para.pos, to: para.end }])
		setCommentHighlights(editor.view, [])

		expect(commentedDomNodes(editor)).toHaveLength(0)
	})

	test('projection membership removal also clears stale active root IDs', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')
		setCommentHighlights(editor.view, [{ rootCommentId: 'c1', from: para.pos, to: para.end }])
		setActiveCommentHighlights(editor.view, ['c1'])

		setCommentHighlights(editor.view, [])

		expect([...getCommentHighlightState(editor.state).activeRootIds]).toEqual([])
	})

	test('unmatched/outdated comments are simply not fed in — only supplied ranges decorate', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')

		// The resolution pass yields no placement for outdated comments, so the
		// caller passes only the resolved subset.
		setCommentHighlights(editor.view, [{ rootCommentId: 'resolved', from: para.pos, to: para.end }])

		const decorated = commentedDomNodes(editor)
		expect(decorated).toHaveLength(1)
		expect(decorated[0]!.getAttribute('data-comment-root-ids')).toBe('resolved')
	})

	test('active root IDs add the active class only to their block', () => {
		const editor = makeEditor()
		const first = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')
		const second = blockPos(editor, (type, text) => type === 'paragraph' && text === 'Second paragraph.')

		setCommentHighlights(editor.view, [
			{ rootCommentId: 'c1', from: first.pos, to: first.end },
			{ rootCommentId: 'c2', from: second.pos, to: second.end },
		])
		setActiveCommentHighlights(editor.view, ['c2'])

		const active = Array.from(editor.view.dom.querySelectorAll(`.${COMMENT_ACTIVE_CLASS}`))
		expect(active).toHaveLength(1)
		expect(active[0]!.textContent).toBe('Second paragraph.')
		// Clearing active emphasis keeps the base comment state.
		setActiveCommentHighlights(editor.view, [])
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_ACTIVE_CLASS}`)).toHaveLength(0)
		expect(commentedDomNodes(editor)).toHaveLength(2)
	})

	test('coexists with the keyboard focus decoration on the same block', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')

		setCommentHighlights(editor.view, [{ rootCommentId: 'c1', from: para.pos, to: para.end }])
		setKeyboardBlockFocus(editor.view, para.pos)

		const el = editor.view.dom.querySelector(`.${COMMENT_BLOCK_CLASS}`)
		expect(el).not.toBeNull()
		expect(el!.classList.contains(KEYBOARD_FOCUS_CLASS)).toBe(true)
	})
})

/** PM `[from, to)` for a character sub-range of the first paragraph. */
function inlineRange(editor: Editor, blockText: string, start: number, end: number) {
	const block = collectAnchorBlocks(editor.state.doc).find((b) => b.text === blockText)!
	return { from: blockOffsetToPos(block, start), to: blockOffsetToPos(block, end) }
}

describe('CommentHighlightExtension — precise ranges (Phase 5)', () => {
	test('a precise inline range decorates only the selected span', () => {
		const editor = makeEditor()
		const { from, to } = inlineRange(editor, 'First paragraph.', 0, 5) // 'First'
		setCommentHighlights(editor.view, [{ rootCommentId: 'r1', from, to }])

		const rangeEls = editor.view.dom.querySelectorAll(`.${COMMENT_RANGE_CLASS}`)
		expect(rangeEls).toHaveLength(1)
		expect(rangeEls[0]!.textContent).toBe('First')
		// It is an inline span, not a whole-block node decoration.
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_BLOCK_CLASS}`)).toHaveLength(0)
	})

	test('overlapping inline ranges each render independently', () => {
		const editor = makeEditor()
		const a = inlineRange(editor, 'First paragraph.', 0, 11) // 'First parag'
		const b = inlineRange(editor, 'First paragraph.', 6, 16) // 'paragraph.'
		setCommentHighlights(editor.view, [
			{ rootCommentId: 'a', from: a.from, to: a.to },
			{ rootCommentId: 'b', from: b.from, to: b.to },
		])
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_RANGE_CLASS}`).length).toBeGreaterThanOrEqual(2)
	})

	test('active emphasis lands on the matching inline range only', () => {
		const editor = makeEditor()
		const { from, to } = inlineRange(editor, 'First paragraph.', 0, 5)
		setCommentHighlights(editor.view, [{ rootCommentId: 'r1', from, to }])
		setActiveCommentHighlights(editor.view, ['r1'])
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_ACTIVE_CLASS}`).length).toBeGreaterThanOrEqual(1)
	})

	test('pending selection renders and clears', () => {
		const editor = makeEditor()
		const { from, to } = inlineRange(editor, 'First paragraph.', 0, 5)
		setPendingHighlight(editor.view, { from, to })
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_PENDING_CLASS}`)).toHaveLength(1)
		setPendingHighlight(editor.view, null)
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_PENDING_CLASS}`)).toHaveLength(0)
	})

	test('pending coexists with resolved ranges', () => {
		const editor = makeEditor()
		const resolved = inlineRange(editor, 'First paragraph.', 0, 5)
		const pending = inlineRange(editor, 'Second paragraph.', 0, 6)
		setCommentHighlights(editor.view, [{ rootCommentId: 'r1', from: resolved.from, to: resolved.to }])
		setPendingHighlight(editor.view, { from: pending.from, to: pending.to })
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_RANGE_CLASS}`)).toHaveLength(1)
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_PENDING_CLASS}`)).toHaveLength(1)
	})
})

describe('CommentHighlightExtension — typed verdict kinds (Phase 6)', () => {
	test('a whole-block deletion adds the deletion class to the block node', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')
		setCommentHighlights(editor.view, [{ rootCommentId: 'd1', from: para.pos, to: para.end, kind: 'deletion' }])

		const el = editor.view.dom.querySelector(`.${COMMENT_BLOCK_CLASS}`)
		expect(el).not.toBeNull()
		expect(el!.classList.contains(COMMENT_DELETION_CLASS)).toBe(true)
		expect(el!.classList.contains(COMMENT_APPROVAL_CLASS)).toBe(false)
	})

	test('a precise approval range adds the approval class to the inline span', () => {
		const editor = makeEditor()
		const { from, to } = inlineRange(editor, 'First paragraph.', 0, 5)
		setCommentHighlights(editor.view, [{ rootCommentId: 'a1', from, to, kind: 'approval' }])

		const el = editor.view.dom.querySelector(`.${COMMENT_RANGE_CLASS}`)
		expect(el).not.toBeNull()
		expect(el!.classList.contains(COMMENT_APPROVAL_CLASS)).toBe(true)
		expect(el!.classList.contains(COMMENT_DELETION_CLASS)).toBe(false)
	})

	test('updating a range from comment to deletion swaps the kind class', () => {
		const editor = makeEditor()
		const { from, to } = inlineRange(editor, 'First paragraph.', 0, 5)
		setCommentHighlights(editor.view, [{ rootCommentId: 'r1', from, to, kind: 'comment' }])
		expect(editor.view.dom.querySelector(`.${COMMENT_DELETION_CLASS}`)).toBeNull()

		setCommentHighlights(editor.view, [{ rootCommentId: 'r1', from, to, kind: 'deletion' }])
		expect(editor.view.dom.querySelector(`.${COMMENT_DELETION_CLASS}`)).not.toBeNull()
	})

	test('overlapping ranges of different kinds each keep their own class', () => {
		const editor = makeEditor()
		const del = inlineRange(editor, 'First paragraph.', 0, 5)
		const app = inlineRange(editor, 'First paragraph.', 6, 16)
		setCommentHighlights(editor.view, [
			{ rootCommentId: 'del', from: del.from, to: del.to, kind: 'deletion' },
			{ rootCommentId: 'app', from: app.from, to: app.to, kind: 'approval' },
		])
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_DELETION_CLASS}`).length).toBeGreaterThanOrEqual(1)
		expect(editor.view.dom.querySelectorAll(`.${COMMENT_APPROVAL_CLASS}`).length).toBeGreaterThanOrEqual(1)
	})

	test('a block carrying mixed verdicts stays neutral', () => {
		const editor = makeEditor()
		const para = blockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')
		setCommentHighlights(editor.view, [
			{ rootCommentId: 'd', from: para.pos, to: para.end, kind: 'deletion' },
			{ rootCommentId: 'a', from: para.pos, to: para.end, kind: 'approval' },
		])
		const el = editor.view.dom.querySelector(`.${COMMENT_BLOCK_CLASS}`)
		expect(el).not.toBeNull()
		expect(el!.classList.contains(COMMENT_DELETION_CLASS)).toBe(false)
		expect(el!.classList.contains(COMMENT_APPROVAL_CLASS)).toBe(false)
	})
})

describe('pickRangeAt — deterministic overlap hit testing', () => {
	const ranges: CommentHighlightRange[] = [
		{ rootCommentId: 'wide', from: 0, to: 100 },
		{ rootCommentId: 'narrow', from: 40, to: 60 },
	]

	test('prefers the smallest range containing the position', () => {
		expect(pickRangeAt(ranges, 50)?.rootCommentId).toBe('narrow')
		expect(pickRangeAt(ranges, 10)?.rootCommentId).toBe('wide')
	})

	test('equal-span ties break by creation time, then root ID', () => {
		const tied: CommentHighlightRange[] = [
			{ rootCommentId: 'b', from: 0, to: 10, createdAt: 200 },
			{ rootCommentId: 'a', from: 0, to: 10, createdAt: 100 },
		]
		expect(pickRangeAt(tied, 5)?.rootCommentId).toBe('a') // earlier createdAt wins
		const sameTime: CommentHighlightRange[] = [
			{ rootCommentId: 'z', from: 0, to: 10, createdAt: 100 },
			{ rootCommentId: 'a', from: 0, to: 10, createdAt: 100 },
		]
		expect(pickRangeAt(sameTime, 5)?.rootCommentId).toBe('a') // lexicographic root ID
	})

	test('returns null when no range contains the position', () => {
		expect(pickRangeAt(ranges, 200)).toBeNull()
	})
})
