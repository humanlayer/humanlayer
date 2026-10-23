import type { Editor } from '@tiptap/core'

type Doc = Editor['state']['doc']

/**
 * The shared prompt is a Yjs-backed editor, but suggestions work on plain text with a caret offset.
 * These map between the two. Paragraph breaks and hard breaks both count as one `\n`, as in the sent text.
 */
export function promptText(doc: Doc, to = doc.content.size): string {
	return doc.textBetween(0, to, '\n', '\n')
}

export function caretOffset(doc: Doc, pos: number): number {
	return promptText(doc, pos).length
}

/** The first editor position whose text before it is `offset` characters long. */
export function positionAt(doc: Doc, offset: number): number {
	const end = doc.content.size
	for (let pos = 1; pos < end; pos++) if (caretOffset(doc, pos) >= offset) return pos
	return Math.max(1, end - 1)
}

/**
 * Applies a text change as the smallest edit that covers it. Replacing the whole document would
 * drop what teammates type meanwhile and send their carets back to the start.
 */
export function applyTextChange(editor: Editor, next: string): void {
	const before = promptText(editor.state.doc)
	if (before === next) return
	let start = 0
	while (start < before.length && start < next.length && before[start] === next[start]) start++
	let end = 0
	while (
		end < before.length - start &&
		end < next.length - start &&
		before[before.length - 1 - end] === next[next.length - 1 - end]
	)
		end++
	const from = positionAt(editor.state.doc, start)
	const to = positionAt(editor.state.doc, before.length - end)
	const inserted = next.slice(start, next.length - end)
	const content: ({ type: 'hardBreak' } | { type: 'text'; text: string })[] = []
	inserted.split('\n').forEach((line, index) => {
		if (index > 0) content.push({ type: 'hardBreak' })
		if (line) content.push({ type: 'text', text: line })
	})
	if (content.length === 0) editor.commands.deleteRange({ from, to })
	else editor.commands.insertContentAt({ from, to }, content)
}
