import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { applyTextChange, caretOffset, positionAt, promptText } from '@/minimalist/lib/shared-prompt'

const editors: Editor[] = []
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy()
})

function editorWith(html: string) {
	const editor = new Editor({ extensions: [StarterKit], content: html })
	editors.push(editor)
	return editor
}

describe('shared prompt text mapping', () => {
	it('reads paragraphs and hard breaks as newlines', () => {
		const editor = editorWith('<p>one<br>two</p><p>three</p>')
		expect(promptText(editor.state.doc)).toBe('one\ntwo\nthree')
	})

	it('maps a text offset to a position and back across paragraphs', () => {
		const editor = editorWith('<p>ab</p><p>cd</p>')
		const { doc } = editor.state
		for (let offset = 0; offset <= 5; offset++) expect(caretOffset(doc, positionAt(doc, offset))).toBe(offset)
	})

	it('edits only the changed span, leaving text around it in place', () => {
		const editor = editorWith('<p>hello @re</p><p>keep this</p>')
		const before = editor.state.doc.child(1)
		applyTextChange(editor, 'hello @research.md \nkeep this')
		expect(promptText(editor.state.doc)).toBe('hello @research.md \nkeep this')
		// The second paragraph is the same node: a teammate's caret there would not move.
		expect(editor.state.doc.child(1)).toBe(before)
	})

	it('inserts newlines as hard breaks and deletes spans', () => {
		const editor = editorWith('<p>/rpi</p>')
		applyTextChange(editor, 'use the rpi skill\n\n')
		expect(promptText(editor.state.doc)).toBe('use the rpi skill\n\n')
		applyTextChange(editor, 'use the skill\n\n')
		expect(promptText(editor.state.doc)).toBe('use the skill\n\n')
	})
})
