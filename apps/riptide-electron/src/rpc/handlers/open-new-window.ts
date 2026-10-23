import { OpenNewWindowError } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { Sentry } from '../../instrument'
import { WindowService } from '../../window/window-service'

export const openNewWindowHandler = Effect.fn('rpc.open_new_window')(function* () {
	const windowService = yield* WindowService
	yield* windowService.openNewWindow.pipe(
		Effect.asVoid,
		Effect.tapError((e) => Effect.logError(e)),
		Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
		Effect.mapError(() => new OpenNewWindowError({ message: 'Failed to open a new window' })),
		Effect.annotateSpans({ rpc_operation: 'OpenNewWindow' }),
		Effect.annotateLogs({ rpc_operation: 'OpenNewWindow' }),
	)
})
