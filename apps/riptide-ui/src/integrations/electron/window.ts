import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'
import { captureException } from '@/integrations/sentry/sentry'

export function openNewWindow(): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.OpenNewWindow()))
}

/** Call on an eligible Electron mouse down; cleanup ends the unary RPC gesture. */
export function startWindowDrag(): () => void {
	const fiber = electronClientRuntime.runFork(
		ElectronRpcClient.use((client) => client.DragWindow()).pipe(
			Effect.catchTag('WindowDragError', (error) =>
				error.reason === 'failed' ? Effect.fail(error) : Effect.void,
			),
			Effect.catchCause((cause) => {
				// Pointer release and renderer teardown are ordinary interruption.
				if (!Cause.hasFails(cause) && !Cause.hasDies(cause)) return Effect.void
				return Effect.logError('Electron window drag failed', cause).pipe(
					Effect.andThen(Effect.sync(() => captureException(cause, { tags: { operation: 'window.drag' } }))),
				)
			}),
			Effect.withSpan('electron_renderer.drag_window'),
		),
	)
	// This callback must remain synchronous, even before the lazy RPC runtime is ready.
	return () => fiber.interruptUnsafe()
}
