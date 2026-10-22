import type { Content, Editor } from '@tiptap/core'
import type * as Y from 'yjs'

import { sanitizeMessageText } from '@/utils/text-sanitization'
import { getTextFromContent } from '@/utils/tiptap-content'

/** A submission owns its initiating document, never whichever editor mounts later. */
export interface ResponseEditorSubmission {
	accepted(): void
}

export interface ResponseEditorContentPort {
	readonly mode: 'local' | 'shared' | 'denial' | 'fork'
	serialize(): string
	insert(content: Content, position?: 'end'): boolean
	beginSubmission(): ResponseEditorSubmission
	captureInsertion(): (content: Content) => boolean
	dispose(): void
}

const ports = new WeakMap<Editor, ResponseEditorContentPort>()
const writable = new WeakMap<Editor, boolean>()
let currentPort: ResponseEditorContentPort | undefined

export function insertIntoCurrentResponseEditor(content: Content): boolean {
	return currentPort?.insert(content) ?? false
}

export function getResponseEditorContentPort(editor: Editor | null | undefined) {
	return editor ? ports.get(editor) : undefined
}

/** Registered at editor-ref commit, revoked on mode/access changes and unmount. */
export function createResponseEditorContentPort({
	editor,
	mode,
	canInsert,
	canClear = canInsert,
	sharedDocument,
}: {
	editor: Editor
	mode: ResponseEditorContentPort['mode']
	canInsert: boolean
	canClear?: boolean
	sharedDocument?: Y.Doc
}): ResponseEditorContentPort {
	let active = true
	let generation = 0
	const invalidateEmptyDocument = ({ transaction }: { transaction: import('prosemirror-state').Transaction }) => {
		if (transaction.docChanged && editor.isEmpty) generation += 1
	}
	editor.on('transaction', invalidateEmptyDocument)
	const insert = (content: Content, position?: 'end') => {
		if (!active || !canInsert || editor.isDestroyed || !editor.isEditable) return false
		return editor.chain().focus(position).insertContent(content).run()
	}
	const port: ResponseEditorContentPort = {
		mode,
		serialize: () => sanitizeMessageText(getTextFromContent(editor.getJSON())).trim(),
		insert,
		beginSubmission: () => {
			generation += 1
			let accepted = false
			return {
				accepted: () => {
					if (accepted) return
					accepted = true
					// Local clear/rollback remains owned by the existing action. Private
					// workflows and direct delivery never acquire a shared clear.
					if (mode === 'shared' && writable.get(editor) && !editor.isDestroyed) editor.commands.clearContent()
					else if (
						mode === 'shared' &&
						editor.isDestroyed &&
						sharedDocument &&
						!sharedDocument.isDestroyed &&
						canClear
					) {
						// Private mode unmounts Tiptap, not the session's document owner.
						const fragment = sharedDocument.getXmlFragment('response')
						sharedDocument.transact(() => fragment.delete(0, fragment.length))
					}
				},
			}
		},
		captureInsertion: () => {
			const capturedGeneration = generation
			return (content) => capturedGeneration === generation && insert(content)
		},
		dispose: () => {
			active = false
			editor.off('transaction', invalidateEmptyDocument)
			if (ports.get(editor) === port) {
				ports.delete(editor)
				writable.delete(editor)
			}
			if (currentPort === port) currentPort = undefined
		},
	}
	ports.set(editor, port)
	writable.set(editor, canClear)
	currentPort = port
	return port
}
