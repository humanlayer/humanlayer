import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { ArtifactSearch, type ArtifactSearchStorage } from './ArtifactSearchExtension'

const editors: Editor[] = []

function makeEditor(content: string): Editor {
	const editor = new Editor({
		extensions: [StarterKit, Markdown, ArtifactSearch],
		content,
		contentType: 'markdown',
	})
	editors.push(editor)
	return editor
}

function storage(editor: Editor): ArtifactSearchStorage {
	return (editor.storage as unknown as { artifactSearch: ArtifactSearchStorage }).artifactSearch
}

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy()
})

describe('ArtifactSearch', () => {
	test('matches literal text without case or overlap and joins inline marks', () => {
		const editor = makeEditor('Banana BANANA. A+b.\n\n**hello** world')
		editor.commands.setSearchQuery('ana')
		expect(storage(editor).matches).toHaveLength(2)
		editor.commands.setSearchQuery('A+b')
		expect(storage(editor).matches).toHaveLength(1)
		editor.commands.setSearchQuery('hello world')
		expect(storage(editor).matches).toHaveLength(1)
	})

	test('wraps the active index and clears all decorations', () => {
		const editor = makeEditor('one one')
		editor.commands.setSearchQuery('one')
		editor.commands.setSearchIndex(-1)
		expect(storage(editor).activeIndex).toBe(1)
		expect(editor.view.dom.querySelectorAll('.search-match-current')).toHaveLength(1)
		editor.commands.clearSearch()
		expect(storage(editor).matches).toEqual([])
		expect(editor.view.dom.querySelectorAll('.search-match')).toHaveLength(0)
	})
})
