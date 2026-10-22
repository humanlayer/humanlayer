import { WindowThemeSetError, type WindowTheme } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { WindowService } from '../../window/window-service'

export const setWindowThemeHandler = Effect.fn('rpc.set_window_theme')(function* (input: {
	readonly theme: WindowTheme
}) {
	const windowService = yield* WindowService
	const annotations = { rpc_operation: 'SetWindowTheme', theme: input.theme }
	yield* windowService.setWindowTheme(input).pipe(
		Effect.mapError(() => new WindowThemeSetError({ message: 'Failed to set window theme' })),
		Effect.annotateSpans(annotations),
		Effect.annotateLogs(annotations),
	)
})
