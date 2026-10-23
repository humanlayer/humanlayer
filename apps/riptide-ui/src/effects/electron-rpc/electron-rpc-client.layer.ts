import { DesktopRpc } from '@humanlayer/riptide-electron-rpc'
import { electronRpcPortMessage } from '@humanlayer/riptide-electron-rpc/protocol'
import * as Data from 'effect/Data'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as RpcClient from 'effect/rpc/RpcClient'
import { RpcClientDefect, RpcClientError } from 'effect/rpc/RpcClientError'
import type { FromServerEncoded } from 'effect/rpc/RpcMessage'
import * as Schema from 'effect/Schema'

import { ElectronRpcClient } from './electron-rpc-client.service'

const FromServer = Data.taggedEnum<FromServerEncoded>()

function clientError(message: string, cause?: unknown): RpcClientError {
	return new RpcClientError({ reason: new RpcClientDefect({ message, cause }) })
}

export const ElectronMessagePortProtocolLive = Layer.effect(
	RpcClient.Protocol,
	Effect.gen(function* () {
		const initialPort = yield* Deferred.make<MessagePort>()
		let activePort: MessagePort | undefined
		let activeClientId: number | undefined
		let bindProtocolPort: ((port: MessagePort) => void) | undefined

		const receivePort = (event: MessageEvent<unknown>) => {
			if (event.source !== window || event.data !== electronRpcPortMessage || event.ports.length !== 1) return
			const receivedPort = event.ports[0]
			if (receivedPort === undefined) return
			if (bindProtocolPort !== undefined) {
				bindProtocolPort(receivedPort)
				return
			}
			activePort?.close()
			activePort = receivedPort
			Effect.runFork(Deferred.succeed(initialPort, receivedPort))
		}

		window.addEventListener('message', receivePort)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				window.removeEventListener('message', receivePort)
				activePort?.close()
			}),
		)

		return yield* RpcClient.Protocol.make((writeResponse) =>
			Effect.gen(function* () {
				const context = yield* Effect.context<never>()
				let boundPort: MessagePort | undefined
				const onMessage = (event: MessageEvent<FromServerEncoded>) => {
					if (activeClientId !== undefined) {
						Effect.runForkWith(context)(writeResponse(activeClientId, event.data))
					}
				}
				const onMessageError = (event: MessageEvent<unknown>) => {
					if (activeClientId === undefined) return
					Effect.runForkWith(context)(
						writeResponse(
							activeClientId,
							FromServer.ClientProtocolError({
								error: clientError('Electron RPC response could not be decoded', event.data),
							}),
						),
					)
				}
				const bindPort = (port: MessagePort) => {
					if (boundPort === port) return
					boundPort?.removeEventListener('message', onMessage)
					boundPort?.removeEventListener('messageerror', onMessageError)
					boundPort?.close()
					boundPort = port
					activePort = port
					port.addEventListener('message', onMessage)
					port.addEventListener('messageerror', onMessageError)
					port.start()
				}

				yield* Effect.acquireRelease(
					Effect.sync(() => {
						bindProtocolPort = bindPort
						if (activePort !== undefined) bindPort(activePort)
					}),
					() =>
						Effect.sync(() => {
							bindProtocolPort = undefined
							boundPort?.removeEventListener('message', onMessage)
							boundPort?.removeEventListener('messageerror', onMessageError)
							boundPort?.close()
							boundPort = undefined
							activePort = undefined
						}),
				)

				return {
					send: (clientId, request) =>
						(activePort === undefined ? Deferred.await(initialPort) : Effect.succeed(activePort)).pipe(
							Effect.flatMap((port) =>
								Effect.try({
									try: () => {
										activeClientId = clientId
										port.postMessage(request)
									},
									catch: (cause) => clientError('Electron RPC request could not be sent', cause),
								}),
							),
						),
					supportsAck: false,
					supportsTransferables: false,
					codecFor: Schema.toCodecJson,
				}
			}),
		)
	}),
)

export const ElectronRpcClientLive = Layer.effect(ElectronRpcClient, RpcClient.make(DesktopRpc)).pipe(
	Layer.provide(ElectronMessagePortProtocolLive),
)
