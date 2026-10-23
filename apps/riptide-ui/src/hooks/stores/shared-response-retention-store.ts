import {
	RESPONSE_EDITOR_SCHEMA_VERSION,
	type ResponseEditorKey,
} from '@humanlayer/streams/response-editor-collaboration'
import * as Y from 'yjs'
import * as z from 'zod/v4'

import { captureException } from '@/integrations/sentry/sentry'

const RetainedResponse = z.object({ version: z.literal(RESPONSE_EDITOR_SCHEMA_VERSION), update: z.string() })
const storageKey = (key: ResponseEditorKey) =>
	`riptide-shared-response:${key.organizationId}:${key.sessionId}:v${RESPONSE_EDITOR_SCHEMA_VERSION}`

/** Causal Yjs state, never an import of the ordinary private draft. Separate keys avoid
 * one tab overwriting another session's state when localStorage is updated. */
export function readRetainedResponse(key: ResponseEditorKey): Uint8Array | undefined {
	try {
		const raw = localStorage.getItem(storageKey(key))
		if (!raw) return undefined
		const parsed = RetainedResponse.parse(JSON.parse(raw))
		const update = Uint8Array.from(atob(parsed.update), (char) => char.charCodeAt(0))
		// Validate the binary before it reaches the live owner.
		Y.decodeUpdate(update)
		return update
	} catch (error) {
		captureException(error)
		return undefined
	}
}

export function retainSharedResponse(key: ResponseEditorKey, doc: Y.Doc): void {
	try {
		const previous = readRetainedResponse(key)
		const current = Y.encodeStateAsUpdate(doc)
		const update = previous ? Y.mergeUpdates([previous, current]) : current
		let binary = ''
		for (const byte of update) binary += String.fromCharCode(byte)
		localStorage.setItem(
			storageKey(key),
			JSON.stringify({ version: RESPONSE_EDITOR_SCHEMA_VERSION, update: btoa(binary) }),
		)
	} catch (error) {
		// Storage quota/privacy failures must not break live editing or cleanup.
		captureException(error)
	}
}
