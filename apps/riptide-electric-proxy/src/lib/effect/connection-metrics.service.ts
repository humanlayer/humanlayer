import { Context, type Duration, Effect, Layer, Metric } from 'effect'

export type UpstreamName = 'electric' | 'durable_stream' | 'jwks'

export type PoolStatsSnapshot = {
	readonly connected: number
	readonly free: number
	readonly running: number
	readonly pending: number
	readonly queued: number
	readonly size: number
	readonly connectionCap: number
	readonly origin: string
	readonly upstream: UpstreamName
}

export type RequestErrorObservation = {
	readonly upstream?: UpstreamName
	readonly origin?: string
	readonly errorClass: string
	readonly method?: string
	readonly phase?: 'socket' | 'body_stream'
}

export type ProtocolObservation = {
	readonly upstream?: UpstreamName
	readonly origin?: string
	readonly protocol: string
}

export type ConnectionLifecycleObservation = {
	readonly upstream?: UpstreamName
	readonly origin?: string
	readonly event: 'attempt' | 'connected' | 'connect_error' | 'closed' | 'drain'
	readonly protocol?: string
	readonly errorClass?: string
}

export type ProcessFdSnapshot = {
	readonly open: number
	readonly limit?: number
	readonly utilization?: number
}

const ecsTaskId = process.env.HOSTNAME ?? 'local'
const ecsService = 'riptide-electric-proxy'

/**
 * v4 replacement for v3 `Effect.tagMetrics`: merges the given attribute into
 * `Metric.CurrentMetricAttributes` for the duration of the effect.
 */
const tagMetrics =
	(key: string, value: string) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.gen(function* () {
			const previousAttributes = yield* Metric.CurrentMetricAttributes
			return yield* Effect.provideService(effect, Metric.CurrentMetricAttributes, {
				...previousAttributes,
				[key]: value,
			})
		})

/**
 * v4 replacement for v3 `Metric.trackDuration`: records the effect's elapsed
 * duration into the given timer histogram.
 */
const trackDuration =
	(timer: Metric.Histogram<Duration.Duration>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.flatMap(Effect.timed(effect), ([duration, value]) => Effect.as(Metric.update(timer, duration), value))

const withContainerTags = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(tagMetrics('ecs_task_id', ecsTaskId), tagMetrics('ecs_service', ecsService))

const electricConnections = Metric.gauge('electric.concurrent_connections', {
	description: 'Concurrent upstream Electric SQL connections',
})

const durableStreamConnections = Metric.gauge('durable_stream.concurrent_connections', {
	description: 'Concurrent upstream Durable Streams connections',
})

const activeRequests = Metric.gauge('requests.concurrent', {
	description: 'Concurrent requests handled by the Electric proxy',
})

const requestDuration = Metric.timer('requests.duration', {
	boundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
})

const poolConnected = Metric.gauge('http.pool.connected', {
	description: 'Open upstream HTTP client connections',
})
const poolFree = Metric.gauge('http.pool.free', { description: 'Idle upstream HTTP client connections' })
const poolRunning = Metric.gauge('http.pool.running', { description: 'Running upstream HTTP requests' })
const poolPending = Metric.gauge('http.pool.pending', { description: 'Pending upstream HTTP requests' })
const poolQueued = Metric.gauge('http.pool.queued', { description: 'Queued upstream HTTP requests' })
const poolSize = Metric.gauge('http.pool.size', { description: 'Total upstream HTTP pool size' })
const poolConnectionCap = Metric.gauge('http.pool.connection_cap', {
	description: 'Configured upstream HTTP connection cap',
})
const poolSaturation = Metric.gauge('http.pool.saturation', {
	description: 'Running upstream HTTP requests divided by connection cap',
})

const protocolObserved = Metric.counter('http.protocol.observed', {
	description: 'Observed upstream HTTP protocol negotiations',
})
const connectionLifecycle = Metric.counter('http.connection.lifecycle', {
	description: 'Observed upstream connection lifecycle events',
})
const requestErrors = Metric.counter('http.request.errors', {
	description: 'Observed upstream request errors by class',
})
const upstreamStreamAborts = Metric.counter('http.upstream.stream_aborted', {
	description: 'Upstream response bodies that errored mid-stream after headers (peer closed the connection)',
})

const fdOpen = Metric.gauge('process.fd.open', { description: 'Open process file descriptors' })
const fdLimit = Metric.gauge('process.fd.limit', { description: 'Process file descriptor limit' })
const fdUtilization = Metric.gauge('process.fd.utilization', {
	description: 'Open process file descriptors divided by file descriptor limit',
})

export class ConnectionMetrics extends Context.Service<
	ConnectionMetrics,
	{
		readonly withElectricConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
		readonly withDurableStreamConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
		readonly trackRequest: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
		readonly recordPoolSnapshot: (snapshot: PoolStatsSnapshot) => Effect.Effect<void>
		readonly recordProtocolObservation: (observation: ProtocolObservation) => Effect.Effect<void>
		readonly recordConnectionLifecycle: (observation: ConnectionLifecycleObservation) => Effect.Effect<void>
		readonly recordRequestError: (observation: RequestErrorObservation) => Effect.Effect<void>
		readonly recordStreamAbort: (observation: RequestErrorObservation) => Effect.Effect<void>
		readonly recordProcessFdSnapshot: (snapshot: ProcessFdSnapshot) => Effect.Effect<void>
	}
>()('ConnectionMetrics') {}

const trackGauge = <A, E, R>(gauge: Metric.Gauge<number>, effect: Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Metric.modify(gauge, 1),
		() => effect,
		() => Metric.modify(gauge, -1),
	)

export const ConnectionMetricsLive = Layer.succeed(ConnectionMetrics, {
	withElectricConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		withContainerTags(trackGauge(electricConnections, effect).pipe(trackDuration(requestDuration))),

	withDurableStreamConnection: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		withContainerTags(trackGauge(durableStreamConnections, effect).pipe(trackDuration(requestDuration))),

	trackRequest: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		withContainerTags(trackGauge(activeRequests, effect).pipe(trackDuration(requestDuration))),

	recordPoolSnapshot: (snapshot) =>
		withContainerTags(
			Effect.all(
				[
					Metric.update(poolConnected, snapshot.connected),
					Metric.update(poolFree, snapshot.free),
					Metric.update(poolRunning, snapshot.running),
					Metric.update(poolPending, snapshot.pending),
					Metric.update(poolQueued, snapshot.queued),
					Metric.update(poolSize, snapshot.size),
					Metric.update(poolConnectionCap, snapshot.connectionCap),
					Metric.update(
						poolSaturation,
						snapshot.connectionCap > 0 ? snapshot.running / snapshot.connectionCap : 0,
					),
				],
				{ discard: true },
			).pipe(tagMetrics('upstream', snapshot.upstream), tagMetrics('origin', snapshot.origin)),
		),

	recordProtocolObservation: (observation) =>
		withContainerTags(
			Metric.modify(protocolObserved, 1).pipe(
				tagMetrics('protocol', observation.protocol),
				tagMetrics('upstream', observation.upstream ?? 'unknown'),
				tagMetrics('origin', observation.origin ?? 'unknown'),
			),
		),

	recordConnectionLifecycle: (observation) =>
		withContainerTags(
			Metric.modify(connectionLifecycle, 1).pipe(
				tagMetrics('event', observation.event),
				tagMetrics('upstream', observation.upstream ?? 'unknown'),
				tagMetrics('origin', observation.origin ?? 'unknown'),
				tagMetrics('protocol', observation.protocol ?? 'unknown'),
				tagMetrics('error_class', observation.errorClass ?? 'none'),
			),
		),

	recordRequestError: (observation) =>
		withContainerTags(
			Metric.modify(requestErrors, 1).pipe(
				tagMetrics('error_class', observation.errorClass),
				tagMetrics('upstream', observation.upstream ?? 'unknown'),
				tagMetrics('origin', observation.origin ?? 'unknown'),
				tagMetrics('method', observation.method ?? 'unknown'),
			),
		),

	recordStreamAbort: (observation) =>
		withContainerTags(
			Metric.modify(upstreamStreamAborts, 1).pipe(
				tagMetrics('error_class', observation.errorClass),
				tagMetrics('upstream', observation.upstream ?? 'unknown'),
				tagMetrics('origin', observation.origin ?? 'unknown'),
				tagMetrics('phase', observation.phase ?? 'unknown'),
			),
		),

	recordProcessFdSnapshot: (snapshot) =>
		withContainerTags(
			Effect.all(
				[
					Metric.update(fdOpen, snapshot.open),
					snapshot.limit === undefined ? Effect.void : Metric.update(fdLimit, snapshot.limit),
					snapshot.utilization === undefined
						? Effect.void
						: Metric.update(fdUtilization, snapshot.utilization),
				],
				{ discard: true },
			),
		),
})
