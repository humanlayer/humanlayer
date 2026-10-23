import { describe, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'

import { ConnectionMetrics } from '../../src/lib/effect/connection-metrics.service'
import {
	type DiagnosticsChannelModule,
	installUndiciDiagnostics,
} from '../../src/lib/effect/undici-diagnostics.service'

class FakeDiagnosticsChannel {
	readonly handlers = new Set<(message: unknown) => void>()

	subscribe(handler: (message: unknown) => void) {
		this.handlers.add(handler)
	}

	unsubscribe(handler: (message: unknown) => void) {
		this.handlers.delete(handler)
	}

	publish(message: unknown) {
		for (const handler of this.handlers) handler(message)
	}
}

function makeFakeChannels(): DiagnosticsChannelModule & { readonly channels: Map<string, FakeDiagnosticsChannel> } {
	const channels = new Map<string, FakeDiagnosticsChannel>()
	return {
		channels,
		channel: (name) => {
			const existing = channels.get(name)
			if (existing) return existing
			const channel = new FakeDiagnosticsChannel()
			channels.set(name, channel)
			return channel
		},
	}
}

describe('installUndiciDiagnostics', () => {
	it.effect('subscribes and releases all diagnostics handlers without duplicates', ({ expect }) =>
		Effect.gen(function* () {
			const fakeChannels = makeFakeChannels()
			const observations = yield* Ref.make<string[]>([])
			const metricsLayer = Layer.succeed(ConnectionMetrics, {
				withElectricConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
				withDurableStreamConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
				trackRequest: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
				recordPoolSnapshot: () => Effect.void,
				recordProtocolObservation: (observation) =>
					Ref.update(observations, (current) => [...current, `protocol:${observation.protocol}`]),
				recordConnectionLifecycle: (observation) =>
					Ref.update(observations, (current) => [...current, `connection:${observation.event}`]),
				recordRequestError: (observation) =>
					Ref.update(observations, (current) => [...current, `request:${observation.errorClass}`]),
				recordStreamAbort: () => Effect.void,
				recordProcessFdSnapshot: () => Effect.void,
			})

			const install = installUndiciDiagnostics({ channels: fakeChannels }).pipe(Effect.provide(metricsLayer))

			yield* Effect.scoped(install)
			expect([...fakeChannels.channels.values()].every((channel) => channel.handlers.size === 0)).toBe(true)

			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* install
					const connected = fakeChannels.channels.get('undici:client:connected')
					expect(connected?.handlers.size).toBe(1)
					connected?.publish({ connectParams: { version: 'h2', origin: 'https://electric.test' } })
					yield* Effect.sleep(0)
				}),
			)

			expect([...fakeChannels.channels.values()].every((channel) => channel.handlers.size === 0)).toBe(true)
			expect(yield* Ref.get(observations)).toEqual(['connection:connected', 'protocol:h2'])
		}),
	)
})
