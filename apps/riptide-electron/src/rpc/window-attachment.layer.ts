import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'

import { WindowService } from '../window/window-service'
import { MessagePortServer } from './message-port-server'

// Attaches the RPC message-port server to every window the window service
// opens. This wiring lives at the composition root so the window service does
// not depend on the RPC transport, which is itself built from the RPC handlers
// that call the window service.
export const RpcWindowAttachmentLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const windowService = yield* WindowService
		const messagePortServer = yield* MessagePortServer
		yield* windowService.openedWindows.pipe(
			Stream.runForEach((handle) =>
				Effect.gen(function* () {
					const attachment = yield* messagePortServer.attach(handle)
					// Register the close listener before yielding so a window that
					// closes immediately still releases its attachment.
					const windowClosed = yield* Deferred.make<void>()
					const removeClosedListener = handle.onClosed(() => Deferred.doneUnsafe(windowClosed, Effect.void))
					yield* Deferred.await(windowClosed).pipe(
						// ensuring also runs on layer teardown, closing attachments for
						// windows that are still open.
						Effect.ensuring(Effect.sync(removeClosedListener).pipe(Effect.andThen(attachment.close))),
						Effect.forkScoped,
					)
				}),
			),
			Effect.forkScoped,
		)
	}),
)
