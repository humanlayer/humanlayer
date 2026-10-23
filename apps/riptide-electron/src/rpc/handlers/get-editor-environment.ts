import * as Effect from 'effect/Effect'

import { EditorEnvironmentService } from '../../editor/editor-environment-service'

export const getEditorEnvironmentHandler = Effect.fn('rpc.get_editor_environment')(function* () {
	return yield* (yield* EditorEnvironmentService).get
})
