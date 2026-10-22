import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { ConnectionMetrics, ConnectionMetricsLive } from '../../src/lib/effect/connection-metrics.service'
import { HttpPoolMetrics, HttpPoolMetricsLive } from '../../src/lib/effect/http-pool-metrics.service'

describe('ConnectionMetricsLive', () => {
	it.effect('records tagged pool snapshots and operational observations', ({ expect }) =>
		Effect.gen(function* () {
			const metrics = yield* ConnectionMetrics

			yield* metrics.recordPoolSnapshot({
				upstream: 'electric',
				origin: 'https://electric.test',
				connected: 3,
				free: 1,
				running: 2,
				pending: 0,
				queued: 0,
				size: 3,
				connectionCap: 5_000,
			})
			yield* metrics.recordProtocolObservation({
				upstream: 'electric',
				origin: 'https://electric.test',
				protocol: 'h2',
			})
			yield* metrics.recordConnectionLifecycle({
				upstream: 'electric',
				origin: 'https://electric.test',
				event: 'connected',
				protocol: 'h2',
			})
			yield* metrics.recordRequestError({
				upstream: 'electric',
				origin: 'https://electric.test',
				errorClass: 'ConnectTimeoutError',
				method: 'GET',
			})
			yield* metrics.recordProcessFdSnapshot({ open: 10, limit: 100, utilization: 0.1 })

			expect(true).toBe(true)
		}).pipe(Effect.provide(ConnectionMetricsLive)),
	)
})

describe('HttpPoolMetricsLive', () => {
	it.effect('snapshots registered pool stats with upstream and origin tags', ({ expect }) =>
		Effect.gen(function* () {
			const poolMetrics = yield* HttpPoolMetrics
			const pool = {
				stats: {
					connected: 4,
					free: 1,
					running: 3,
					pending: 2,
					queued: 1,
					size: 6,
				},
			}

			yield* poolMetrics.registerPool({
				upstream: 'durable_stream',
				origin: 'https://durable.test',
				connectionCap: 5_000,
				pool: pool as never,
			})

			const snapshots = yield* poolMetrics.snapshotPools
			expect(snapshots).toContainEqual({
				upstream: 'durable_stream',
				origin: 'https://durable.test',
				connectionCap: 5_000,
				connected: 4,
				free: 1,
				running: 3,
				pending: 2,
				queued: 1,
				size: 6,
			})

			yield* poolMetrics.unregisterPool('durable_stream', 'https://durable.test')
		}).pipe(Effect.provide(Layer.mergeAll(HttpPoolMetricsLive))),
	)
})
