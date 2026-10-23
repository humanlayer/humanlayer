import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import { app, BrowserWindow } from 'electron'

import { DeepLinkPlatform } from './deep-link-platform.service'
import { DeepLinkPlatformError } from './deep-link.errors'
import { subscribeToCapturedOpenUrls } from './open-url-capture'

const openUrlArguments = Stream.callback<ReadonlyArray<string>>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			return subscribeToCapturedOpenUrls((url) => Queue.offerUnsafe(queue, [url]))
		}),
		(removeListener) => Effect.sync(removeListener),
	),
)

const secondInstanceArguments = Stream.callback<ReadonlyArray<string>>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const listener = (_event: Electron.Event, argv: string[]) => {
				Queue.offerUnsafe(queue, argv)
			}
			app.on('second-instance', listener)
			return listener
		}),
		(listener) => Effect.sync(() => app.off('second-instance', listener)),
	),
)

export const DeepLinkPlatformLive = Layer.succeed(
	DeepLinkPlatform,
	DeepLinkPlatform.of({
		initialArguments: process.argv,
		incomingArguments: Stream.merge(openUrlArguments, secondInstanceArguments),
		registerProtocolClient: ({ scheme }) =>
			Effect.try({
				try: () => app.setAsDefaultProtocolClient(scheme),
				catch: (cause) => new DeepLinkPlatformError({ operation: 'register_protocol_client', cause }),
			}).pipe(Effect.withSpan('deep_link_platform.register_protocol_client', { attributes: { scheme } })),
		ownsProtocol: ({ scheme }) =>
			Effect.try({
				try: () => app.isDefaultProtocolClient(scheme),
				catch: (cause) => new DeepLinkPlatformError({ operation: 'verify_protocol_client', cause }),
			}).pipe(Effect.withSpan('deep_link_platform.verify_protocol_client', { attributes: { scheme } })),
		focusMainWindow: Effect.try({
			try: () => {
				const window = BrowserWindow.getAllWindows()[0]
				if (window === undefined) return
				if (window.isMinimized()) window.restore()
				window.show()
				window.focus()
			},
			catch: (cause) => new DeepLinkPlatformError({ operation: 'focus_main_window', cause }),
		}).pipe(Effect.withSpan('deep_link_platform.focus_main_window')),
	}),
)
