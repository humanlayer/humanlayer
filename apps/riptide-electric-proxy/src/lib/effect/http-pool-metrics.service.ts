import { Context, Effect, Layer, Schedule } from 'effect'
import type { Pool } from 'undici'

import { ConnectionMetrics, type PoolStatsSnapshot, type UpstreamName } from './connection-metrics.service'

export type PoolMetricRegistration = {
	readonly upstream: UpstreamName
	readonly origin: string
	readonly connectionCap: number
	readonly pool: Pick<Pool, 'stats'>
}

export class HttpPoolMetrics extends Context.Service<
	HttpPoolMetrics,
	{
		readonly registerPool: (registration: PoolMetricRegistration) => Effect.Effect<void>
		readonly unregisterPool: (upstream: UpstreamName, origin: string) => Effect.Effect<void>
		readonly snapshotPools: Effect.Effect<readonly PoolStatsSnapshot[]>
	}
>()('HttpPoolMetrics') {}

function registrationKey(registration: Pick<PoolMetricRegistration, 'upstream' | 'origin'>) {
	return `${registration.upstream}:${registration.origin}`
}

function readNumber(stats: Pool['stats'], key: keyof Pool['stats']) {
	const value = stats[key]
	return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function snapshotPool(registration: PoolMetricRegistration): PoolStatsSnapshot {
	const { stats } = registration.pool
	return {
		upstream: registration.upstream,
		origin: registration.origin,
		connectionCap: registration.connectionCap,
		connected: readNumber(stats, 'connected'),
		free: readNumber(stats, 'free'),
		running: readNumber(stats, 'running'),
		pending: readNumber(stats, 'pending'),
		queued: readNumber(stats, 'queued'),
		size: readNumber(stats, 'size'),
	}
}

export const HttpPoolMetricsLive = Layer.effect(
	HttpPoolMetrics,
	Effect.sync(() => {
		const registeredPools = new Map<string, PoolMetricRegistration>()

		return HttpPoolMetrics.of({
			registerPool: (registration) =>
				Effect.sync(() => {
					registeredPools.set(registrationKey(registration), registration)
				}),

			unregisterPool: (upstream, origin) =>
				Effect.sync(() => {
					registeredPools.delete(registrationKey({ upstream, origin }))
				}),

			snapshotPools: Effect.sync(() => [...registeredPools.values()].map(snapshotPool)),
		})
	}),
)

export const HttpPoolMetricsPollerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const poolMetrics = yield* HttpPoolMetrics
		const connectionMetrics = yield* ConnectionMetrics

		const recordSnapshots = poolMetrics.snapshotPools.pipe(
			Effect.flatMap((snapshots) =>
				Effect.all(
					snapshots.map((snapshot) => connectionMetrics.recordPoolSnapshot(snapshot)),
					{ discard: true },
				),
			),
		)

		yield* Effect.forkScoped(Effect.repeat(recordSnapshots, Schedule.fixed('30 seconds')))
	}),
)
