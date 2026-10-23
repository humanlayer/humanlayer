import type { Editor, OpenInEditorError } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'

export interface EditorServiceShape {
	readonly open: (input: {
		readonly path: string
		readonly editor: Editor | null
	}) => Effect.Effect<void, OpenInEditorError>
}

export class EditorService extends Context.Service<EditorService, EditorServiceShape>()('EditorService') {}
