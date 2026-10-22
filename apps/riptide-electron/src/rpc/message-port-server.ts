import { DesktopRpc, DragWindow } from '@humanlayer/riptide-electron-rpc'
import { electronRpcPortChannel } from '@humanlayer/riptide-electron-rpc/protocol'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as RpcServer from 'effect/rpc/RpcServer'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import type { MessagePortMain } from 'electron'

import type { ElectronWindowHandle } from '../platform/electron-platform.service'
import type { DesktopRpcHandlerServices } from './desktop-rpc-handlers'

export interface MessagePortServerAttachment {
	readonly close: Effect.Effect<void>
}

export class MessagePortServer extends Context.Service<
	MessagePortServer,
	{
		readonly attach: (window: ElectronWindowHandle) => Effect.Effect<MessagePortServerAttachment>
	}
>()('MessagePortServer') {}

export const MessagePortServerLive = Layer.effect(
	MessagePortServer,
	Effect.gen(function* () {
		const handlerContext = yield* Effect.context<DesktopRpcHandlerServices>()
		return MessagePortServer.of({
			attach: (window) => attachMessagePortServer(window, handlerContext),
		})
	}),
)

function attachMessagePortServer(
	window: ElectronWindowHandle,
	handlerContext: Context.Context<DesktopRpcHandlerServices>,
): Effect.Effect<MessagePortServerAttachment> {
	return Effect.gen(function* () {
		// RPC handlers capture their construction context. Construct this handler
		// here, with the actual attached handle, never a global/focused window.
		const windowHandlers = yield* RpcGroup.make(DragWindow).toHandlers({
			DragWindow: () => window.dragWindow.pipe(Effect.withSpan('rpc.drag_window')),
		})
		const connectionContext = Context.merge(handlerContext, windowHandlers)
		const createMessageChannel = window.createMessageChannel
		if (createMessageChannel === undefined) return { close: Effect.void }
		let activePort: MessagePortMain | undefined
		let serverFiber: Fiber.Fiber<never, never> | undefined

		const closeConnection = () => {
			activePort?.close()
			activePort = undefined
			if (serverFiber !== undefined) {
				Effect.runFork(Fiber.interrupt(serverFiber))
				serverFiber = undefined
			}
		}

		const connect = () => {
			closeConnection()
			const { port1, port2 } = createMessageChannel()
			activePort = port1
			serverFiber = Effect.runForkWith(connectionContext)(runServer(port1))
			window.postMessage(electronRpcPortChannel, port2)
		}

		const removeReadyListener = window.onRendererReady(connect)
		const removeClosedListener = window.onClosed(closeConnection)
		connect()

		return {
			close: Effect.sync(() => {
				removeReadyListener()
				removeClosedListener()
				closeConnection()
			}),
		}
	})
}

function runServer(port: MessagePortMain) {
	return Effect.gen(function* () {
		const protocol = yield* messagePortProtocol(port)
		return yield* RpcServer.make(DesktopRpc).pipe(Effect.provideService(RpcServer.Protocol, protocol))
	}).pipe(Effect.scoped)
}

export function messagePortProtocol(
	port: MessagePortMain,
): Effect.Effect<RpcServer.Protocol['Service'], never, Scope.Scope> {
	return RpcServer.Protocol.make((writeRequest) =>
		Effect.gen(function* () {
			const clientId = 1
			const disconnects = yield* Queue.unbounded<number>()
			const context = yield* Effect.context<never>()
			const onMessage = (event: Electron.MessageEvent) => {
				Effect.runForkWith(context)(writeRequest(clientId, event.data))
			}
			const onClose = () => {
				Effect.runForkWith(context)(Queue.offer(disconnects, clientId))
			}

			yield* Effect.acquireRelease(
				Effect.sync(() => {
					port.on('message', onMessage)
					port.on('close', onClose)
					port.start()
				}),
				() =>
					Effect.sync(() => {
						port.off('message', onMessage)
						port.off('close', onClose)
					}),
			)

			return {
				disconnects,
				send: (_id, response) => Effect.sync(() => port.postMessage(response)),
				end: () => Effect.sync(() => port.close()),
				clientIds: Effect.succeed(new Set([clientId])),
				initialMessage: Effect.succeed(Option.none()),
				supportsAck: false,
				supportsTransferables: false,
				supportsSpanPropagation: false,
				supportsNotifications: false,
				codecFor: Schema.toCodecJson,
			}
		}),
	)
}
