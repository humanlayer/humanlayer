import type { OpenInEditorPayload } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { EditorService } from '../../editor/editor-service'

export const openInEditorHandler = Effect.fn('rpc.open_in_editor')(function* (input: OpenInEditorPayload) {
	const annotations = {
		rpc_operation: 'OpenInEditor',
		editor: input.editor ?? 'default',
	}
	const editorService = yield* EditorService
	return yield* editorService.open(input).pipe(Effect.annotateSpans(annotations), Effect.annotateLogs(annotations))
})
