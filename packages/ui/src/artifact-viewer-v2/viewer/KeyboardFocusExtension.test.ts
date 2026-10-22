import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import {
	getKeyboardBlockFocus,
	KEYBOARD_FOCUS_CLASS,
	KeyboardFocusExtension,
	setKeyboardBlockFocus,
} from './KeyboardFocusExtension'

let editors: Editor[] = []
afterEach(() => {
	for (const e of editors) e.destroy()
	editors = []
})

const MARKDOWN = ['# Title', '', 'First paragraph.', '', '---', '', 'Second paragraph.'].join('\n')

function makeEditor(markdown: string = MARKDOWN): Editor {
	const editor = new Editor({
		extensions: [StarterKit, Markdown, KeyboardFocusExtension],
		content: markdown,
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	return editor
}

function findBlockPos(editor: Editor, predicate: (typeName: string, text: string) => boolean): number {
	let found = -1
	editor.state.doc.descendants((node, pos) => {
		if (found !== -1) return false
		if ((node.isTextblock || (node.isBlock && node.isAtom)) && predicate(node.type.name, node.textContent)) {
			found = pos
			return false
		}
		return true
	})
	expect(found).toBeGreaterThanOrEqual(0)
	return found
}

function focusedDomNodes(editor: Editor): Element[] {
	return Array.from(editor.view.dom.querySelectorAll(`.${KEYBOARD_FOCUS_CLASS}`))
}

describe('KeyboardFocusExtension', () => {
	test('starts with no focused block and no decoration', () => {
		const editor = makeEditor()
		expect(getKeyboardBlockFocus(editor.state)).toBeNull()
		expect(focusedDomNodes(editor)).toHaveLength(0)
	})

	test('focus command updates plugin state and decorates the textblock', () => {
		const editor = makeEditor()
		const paragraphPos = findBlockPos(editor, (type, text) => type === 'paragraph' && text === 'First paragraph.')

		setKeyboardBlockFocus(editor.view, paragraphPos)

		expect(getKeyboardBlockFocus(editor.state)).toBe(paragraphPos)
		const decorated = focusedDomNodes(editor)
		expect(decorated).toHaveLength(1)
		expect(decorated[0]!.textContent).toBe('First paragraph.')
	})

	test('moving focus re-places the single decoration', () => {
		const editor = makeEditor()
		const headingPos = findBlockPos(editor, (type) => type === 'heading')
		const paragraphPos = findBlockPos(editor, (type, text) => type === 'paragraph' && text === 'Second paragraph.')

		setKeyboardBlockFocus(editor.view, headingPos)
		setKeyboardBlockFocus(editor.view, paragraphPos)

		const decorated = focusedDomNodes(editor)
		expect(decorated).toHaveLength(1)
		expect(decorated[0]!.textContent).toBe('Second paragraph.')
	})

	test('decorates block atoms (horizontal rule)', () => {
		const editor = makeEditor()
		const hrPos = findBlockPos(editor, (type) => type === 'horizontalRule')

		setKeyboardBlockFocus(editor.view, hrPos)

		expect(getKeyboardBlockFocus(editor.state)).toBe(hrPos)
		const decorated = focusedDomNodes(editor)
		expect(decorated).toHaveLength(1)
		expect(decorated[0]!.tagName.toLowerCase()).toBe('hr')
	})

	test('clearing focus removes state and decoration', () => {
		const editor = makeEditor()
		const paragraphPos = findBlockPos(editor, (type) => type === 'paragraph')

		setKeyboardBlockFocus(editor.view, paragraphPos)
		setKeyboardBlockFocus(editor.view, null)

		expect(getKeyboardBlockFocus(editor.state)).toBeNull()
		expect(focusedDomNodes(editor)).toHaveLength(0)
	})

	test('document remount starts without focus (state is not persistent)', () => {
		const first = makeEditor()
		const paragraphPos = findBlockPos(first, (type) => type === 'paragraph')
		setKeyboardBlockFocus(first.view, paragraphPos)
		first.destroy()

		const second = makeEditor()
		expect(getKeyboardBlockFocus(second.state)).toBeNull()
		expect(focusedDomNodes(second)).toHaveLength(0)
	})
})
