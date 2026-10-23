import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import type { ElectronWindowHandle } from '../src/platform/electron-platform.service'
import { MessagePortServer } from '../src/rpc/message-port-server'
import { RpcWindowAttachmentLive } from '../src/rpc/window-attachment.layer'
import { WindowService } from '../src/window/window-service'

function fakeWindowHandle(id: number): {
	readonly handle: ElectronWindowHandle
	readonly emitClosed: () => void
} {
	let closedListener: (() => void) | undefined
	return {
		handle: {
			id,
			dragWindow: Effect.die('dragWindow was not expected'),
			destroy: Effect.void,
			setThemeSource: () => Effect.void,
			setZoomFactor: () => Effect.void,
			stateChanges: Stream.empty,
			showAndFocus: Effect.void,
			postMessage: () => undefined,
			onRendererReady: () => () => undefined,
			onClosed: (listener) => {
				closedListener = listener
				return () => {
					closedListener = undefined
				}
			},
		},
		emitClosed: () => closedListener?.(),
	}
}

describe('RpcWindowAttachmentLive', () => {
	it.effect('attaches the RPC server to every opened window and closes it with the window', () =>
		Effect.gen(function* () {
			const openedWindows = yield* Queue.unbounded<ElectronWindowHandle>()
			const attachedWindowIds = yield* Queue.unbounded<number>()
			const closedWindowIds = yield* Queue.unbounded<number>()

			const windowService = Layer.succeed(
				WindowService,
				WindowService.of({
					openMainWindow: Effect.die('openMainWindow was not expected'),
					openNewWindow: Effect.die('openNewWindow was not expected'),
					openedWindows: Stream.fromEffectRepeat(Queue.take(openedWindows)),
					setWindowTheme: () => Effect.void,
					setZoom: () => Effect.void,
				}),
			)
			const messagePortServer = Layer.succeed(
				MessagePortServer,
				MessagePortServer.of({
					attach: (window) =>
						Queue.offer(attachedWindowIds, window.id).pipe(
							Effect.as({ close: Queue.offer(closedWindowIds, window.id).pipe(Effect.asVoid) }),
						),
				}),
			)
			const wiring = RpcWindowAttachmentLive.pipe(Layer.provide(Layer.mergeAll(windowService, messagePortServer)))

			const first = fakeWindowHandle(1)
			const second = fakeWindowHandle(2)
			yield* Effect.gen(function* () {
				yield* Queue.offer(openedWindows, first.handle)
				yield* Queue.offer(openedWindows, second.handle)
				expect(yield* Queue.take(attachedWindowIds)).toBe(1)
				expect(yield* Queue.take(attachedWindowIds)).toBe(2)

				first.emitClosed()
				expect(yield* Queue.take(closedWindowIds)).toBe(1)
			}).pipe(Effect.provide(wiring))

			// Layer teardown closes the attachment for the still-open window.
			expect(yield* Queue.take(closedWindowIds)).toBe(2)
		}),
	)
})
