import { Effect, Layer, ManagedRuntime } from 'effect'

import { JWKSConfigLive } from '@/auth/effect/jwks-cache-config.service'
import { JWKSCacheLive } from '@/auth/effect/jwks-cache.service'
import { JWTValidator, JWTValidatorLive } from '@/auth/effect/jwt-validator.service'
import { WorkosConfigLive } from '@/auth/effect/workos.service'

import { type ConnectionMetrics, ConnectionMetricsLive } from './connection-metrics.service'
import { DurableStreamsHttpClientLive } from './durable-streams-http-client.service'
import { type DurableStreamsProxy, DurableStreamsProxyLive } from './durable-streams-proxy.service'
import { ElectricProxyHttpClientLive } from './electric-http-client.service'
import { type ElectricProxy, ElectricProxyLive } from './electric-proxy.service'
import { type HttpPoolMetrics, HttpPoolMetricsLive, HttpPoolMetricsPollerLive } from './http-pool-metrics.service'
import { JWKSHttpClientAsHttpClientLive } from './jwks-http-client.service'
import {
	type ProcessResourceMetrics,
	ProcessResourceMetricsLive,
	ProcessResourceMetricsPollerLive,
} from './process-resource-metrics.service'
import {
	makeProxyRuntimeConfig,
	type ProxyRuntimeConfig,
	ProxyRuntimeConfigLive,
	type ProxyRuntimeConfigValues,
} from './proxy-runtime-config.service'
import { SentryLive } from './sentry.service'
import { UndiciDiagnosticsLive } from './undici-diagnostics.service'
import { ResponseEditorGatewayLive, type YjsGateway } from './yjs-gateway.service'

export type AppRuntimeServices =
	| JWTValidator
	| ConnectionMetrics
	| ElectricProxy
	| DurableStreamsProxy
	| YjsGateway
	| ProxyRuntimeConfig
	| HttpPoolMetrics
	| ProcessResourceMetrics

const MetricsCoreLive = Layer.mergeAll(ConnectionMetricsLive, HttpPoolMetricsLive)
const ProcessResourceMetricsWithConnectionsLive = ProcessResourceMetricsLive.pipe(Layer.provide(ConnectionMetricsLive))
const ProcessResourceMetricsPollerWithMetricsLive = ProcessResourceMetricsPollerLive.pipe(
	Layer.provide(ProcessResourceMetricsWithConnectionsLive),
)

export const makeAppObservabilityLive = (proxyRuntimeConfig: ProxyRuntimeConfigValues) =>
	Layer.mergeAll(
		SentryLive,
		MetricsCoreLive,
		ProcessResourceMetricsWithConnectionsLive,
		HttpPoolMetricsPollerLive.pipe(Layer.provide(MetricsCoreLive)),
		ProcessResourceMetricsPollerWithMetricsLive,
		// UndiciDiagnosticsLive needs ProxyRuntimeConfig to map upstream origins → UpstreamName.
		UndiciDiagnosticsLive.pipe(
			Layer.provide(Layer.mergeAll(ConnectionMetricsLive, ProxyRuntimeConfigLive(proxyRuntimeConfig))),
		),
	)

const JWKSConfigWithWorkosLive = JWKSConfigLive.pipe(Layer.provideMerge(WorkosConfigLive))

const JWKSHttpClientWithConfigLive = JWKSHttpClientAsHttpClientLive.pipe(Layer.provideMerge(JWKSConfigWithWorkosLive))

const JWKSCacheWithDependenciesLive = JWKSCacheLive.pipe(Layer.provideMerge(JWKSHttpClientWithConfigLive))

export const AppAuthLive = JWTValidatorLive.pipe(Layer.provide(JWKSCacheWithDependenciesLive))

export const makeProxyLayer = (proxyRuntimeConfig: ProxyRuntimeConfigValues) => {
	const runtimeConfigLive = ProxyRuntimeConfigLive(proxyRuntimeConfig)
	const electricHttpClientWithConfigLive = ElectricProxyHttpClientLive.pipe(Layer.provide(runtimeConfigLive))
	const durableStreamsHttpClientWithConfigLive = DurableStreamsHttpClientLive.pipe(Layer.provide(runtimeConfigLive))

	return Layer.mergeAll(
		runtimeConfigLive,
		ElectricProxyLive.pipe(Layer.provide(electricHttpClientWithConfigLive)),
		DurableStreamsProxyLive.pipe(Layer.provide(durableStreamsHttpClientWithConfigLive)),
		ResponseEditorGatewayLive.pipe(
			Layer.provide(Layer.mergeAll(runtimeConfigLive, durableStreamsHttpClientWithConfigLive)),
		),
	)
}

export const makeAppLayer = <E>(options: {
	readonly proxyRuntimeConfig: ProxyRuntimeConfigValues
	readonly authLayer: Layer.Layer<JWTValidator, E, HttpPoolMetrics | ConnectionMetrics>
}) =>
	Layer.mergeAll(makeProxyLayer(options.proxyRuntimeConfig), options.authLayer).pipe(
		Layer.provideMerge(makeAppObservabilityLive(options.proxyRuntimeConfig)),
	)

export const makeProductionAppLayer = (proxyRuntimeConfig: ProxyRuntimeConfigValues) =>
	makeAppLayer({
		proxyRuntimeConfig,
		authLayer: AppAuthLive,
	})

export type AppRuntimeError = Layer.Error<ReturnType<typeof makeProductionAppLayer>>
export type AppRuntime = ManagedRuntime.ManagedRuntime<AppRuntimeServices, AppRuntimeError>

export function createAppRuntime<E>(
	layer: Layer.Layer<AppRuntimeServices, E, never>,
): ManagedRuntime.ManagedRuntime<AppRuntimeServices, E> {
	return ManagedRuntime.make(layer)
}

/**
 * App runtime for tests that authenticate via `testAuthContext` (which bypasses
 * the JWT middleware entirely): real proxy + observability layers, with a
 * JWTValidator stub that dies loudly if anything actually invokes it.
 *
 * Callers own the runtime's lifecycle — `await runtime.dispose()` on teardown
 * to stop the observability pollers.
 */
export const createTestAppRuntime = (options: {
	readonly electricShapeUrl: string
	readonly durableStreamsOrigin: string
}): AppRuntime =>
	createAppRuntime(
		makeAppLayer({
			proxyRuntimeConfig: makeProxyRuntimeConfig(options),
			authLayer: Layer.succeed(JWTValidator, {
				validateJWT: () =>
					Effect.die(
						new Error(
							'createTestAppRuntime: JWTValidator stub invoked — provide testAuthContext or build a runtime with a real auth layer',
						),
					),
			}),
		}),
	)
