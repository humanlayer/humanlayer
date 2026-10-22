import { uuidv7 } from 'uuidv7'

import { useDraftsStore } from '@/hooks/stores/draftsStore'
import { sanitizeMessageText } from '@/utils/text-sanitization'
import { getTextFromContent } from '@/utils/tiptap-content'

export interface SessionEditorDeliveryCapture {
	readonly id: string
	readonly text: string
}

export interface SessionEditorDeliveryPort {
	readonly capture: () => SessionEditorDeliveryCapture
	readonly clearIfUnchanged: (captureId: string) => void
}

export function createSessionEditorDeliveryPort(sessionId: string): SessionEditorDeliveryPort {
	// Direct delivery deliberately captures only the private draft. It never
	// acquires the response content port or a shared acceptance/clear capability.
	const captures = new Map<string, string>()
	const readEditorText = () => getTextFromContent(useDraftsStore.getState().drafts[sessionId] ?? null)
	return {
		capture: () => {
			const editorText = readEditorText()
			const capture = { id: uuidv7(), text: sanitizeMessageText(editorText).trim() }
			captures.clear()
			captures.set(capture.id, editorText)
			return capture
		},
		clearIfUnchanged: (captureId) => {
			const capturedText = captures.get(captureId)
			captures.delete(captureId)
			if (capturedText === undefined || readEditorText() !== capturedText) return
			useDraftsStore.getState().clearDraft(sessionId)
		},
	}
}
