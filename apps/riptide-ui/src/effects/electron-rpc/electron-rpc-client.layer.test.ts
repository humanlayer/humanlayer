import { describe, expect, it } from '@effect/vitest'
import { electronRpcPortMessage } from '@humanlayer/riptide-electron-rpc/protocol'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as RpcClient from 'effect/rpc/RpcClient'

import { ElectronMessagePortProtocolLive } from './electron-rpc-client.layer'

class FakeMessagePort extends EventTarget {
	readonly sent: unknown[] = []
	closed = false
	started = false

	postMessage(message: unknown) {
		this.sent.push(message)
	}

	start() {
		this.started = true
	}

	close() {
		this.closed = true
	}
}

describe('Electron RPC client protocol', () => {
	it.effect('sends through the replacement port after renderer reconnection', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const protocol = yield* RpcClient.Protocol
				const runFiber = yield* Effect.forkChild(
					protocol.run(1, () => Effect.void),
					{
						startImmediately: true,
					},
				)
				const firstPort = new FakeMessagePort()
				dispatchPort(firstPort)

				yield* protocol.send(1, request('first'))
				expect(firstPort.sent).toEqual([request('first')])

				const replacementPort = new FakeMessagePort()
				dispatchPort(replacementPort)
				yield* protocol.send(1, request('second'))

				expect(firstPort.closed).toBe(true)
				expect(replacementPort.started).toBe(true)
				expect(replacementPort.sent).toEqual([request('second')])
				yield* Fiber.interrupt(runFiber)
			}),
		).pipe(Effect.provide(ElectronMessagePortProtocolLive)),
	)
})

function request(id: string) {
	return { _tag: 'Request' as const, id, tag: 'GetHostId', payload: {}, headers: [] }
}

function dispatchPort(port: FakeMessagePort) {
	const event = new Event('message')
	Object.defineProperties(event, {
		data: { value: electronRpcPortMessage },
		source: { value: window },
		ports: { value: [port] },
	})
	window.dispatchEvent(event)
}
