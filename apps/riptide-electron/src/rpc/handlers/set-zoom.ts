import { WindowZoomSetError, type SetZoomPayload } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { WindowService } from '../../window/window-service'

export const setZoomHandler = Effect.fn('rpc.set_zoom')(function* (input: SetZoomPayload) {
	const annotations = { rpc_operation: 'SetZoom', zoom_factor: input.zoomFactor }
	const windowService = yield* WindowService
	yield* windowService.setZoom(input).pipe(
		Effect.mapError(() => new WindowZoomSetError({ message: 'Failed to set window zoom' })),
		Effect.annotateSpans(annotations),
		Effect.annotateLogs(annotations),
	)
})
