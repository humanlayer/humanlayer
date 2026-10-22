import diagnosticsChannel from 'node:diagnostics_channel'

import { Effect, Layer } from 'effect'

import { ConnectionMetrics, type UpstreamName } from './connection-metrics.service'
import { ProxyRuntimeConfig } from './proxy-runtime-config.service'

type ChannelName =
	| 'undici:client:beforeConnect'
	| 'undici:client:connected'
	| 'undici:client:connectError'
	| 'undici:request:error'

type DiagnosticsChannel = {
	readonly subscribe: (handler: (message: unknown) => void) => void
	readonly unsubscribe: (handler: (message: unknown) => void) => void
}

export type DiagnosticsChannelModule = {
	readonly channel: (name: ChannelName) => DiagnosticsChannel
}

type OriginLookup = (origin: string | undefined) =>
	| {
			readonly upstream: UpstreamName
			readonly origin: string
	  }
	| undefined

function errorClass(error: unknown) {
	if (error instanceof Error) return error.name || error.constructor.name
	if (typeof error === 'object' && error !== null && 'code' in error) return String(error.code)
	return 'UnknownError'
}

function getRecord(message: unknown): Record<string, unknown> {
	return typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : {}
}

function getOrigin(message: unknown) {
	const record = getRecord(message)
	const origin = record.origin ?? getRecord(record.connectParams).origin ?? getRecord(record.request).origin
	if (typeof origin === 'string') return origin
	if (origin instanceof URL) return origin.origin
	const host = getRecord(record.connectParams).host
	const protocol = getRecord(record.connectParams).protocol
	if (typeof host === 'string' && typeof protocol === 'string') return `${protocol}//${host}`
	return undefined
}

function getProtocol(message: unknown) {
	const version = getRecord(getRecord(message).connectParams).version ?? getRecord(message).version
	if (typeof version === 'string') return version
	if (typeof version === 'number') return version === 2 ? 'h2' : `http/${version}`
	return 'unknown'
}

function getMethod(message: unknown) {
	const method = getRecord(getRecord(message).request).method
	return typeof method === 'string' ? method : undefined
}

function withLookup(lookup: OriginLookup, origin: string | undefined) {
	const identified = lookup(origin)
	return { upstream: identified?.upstream, origin: identified?.origin ?? origin }
}

export function installUndiciDiagnostics(
	options: { readonly channels?: DiagnosticsChannelModule; readonly lookupOrigin?: OriginLookup } = {},
) {
	const channels = options.channels ?? diagnosticsChannel
	const lookupOrigin = options.lookupOrigin ?? (() => undefined)

	const acquire = Effect.gen(function* () {
		const metrics = yield* ConnectionMetrics
		const subscriptions: Array<{ channel: DiagnosticsChannel; handler: (message: unknown) => void }> = []

		const subscribe = (name: ChannelName, handler: (message: unknown) => void) => {
			const channel = channels.channel(name)
			channel.subscribe(handler)
			subscriptions.push({ channel, handler })
		}

		subscribe('undici:client:beforeConnect', (message) => {
			const observed = withLookup(lookupOrigin, getOrigin(message))
			void Effect.runPromise(metrics.recordConnectionLifecycle({ event: 'attempt', ...observed }))
		})

		subscribe('undici:client:connected', (message) => {
			const observed = withLookup(lookupOrigin, getOrigin(message))
			const protocol = getProtocol(message)
			void Effect.runPromise(
				Effect.all(
					[
						metrics.recordConnectionLifecycle({ event: 'connected', protocol, ...observed }),
						metrics.recordProtocolObservation({ protocol, ...observed }),
					],
					{ discard: true },
				),
			)
		})

		subscribe('undici:client:connectError', (message) => {
			const observed = withLookup(lookupOrigin, getOrigin(message))
			const error = getRecord(message).error
			void Effect.runPromise(
				metrics.recordConnectionLifecycle({
					event: 'connect_error',
					errorClass: errorClass(error),
					...observed,
				}),
			)
		})

		subscribe('undici:request:error', (message) => {
			const observed = withLookup(lookupOrigin, getOrigin(message))
			void Effect.runPromise(
				metrics.recordRequestError({
					errorClass: errorClass(getRecord(message).error),
					method: getMethod(message),
					...observed,
				}),
			)
		})

		return subscriptions
	})

	return Effect.acquireRelease(acquire, (subscriptions) =>
		Effect.sync(() => {
			for (const { channel, handler } of subscriptions) channel.unsubscribe(handler)
		}),
	)
}

// Map each known upstream origin to its UpstreamName so the diagnostics-channel observations
// (which only see a raw origin string, process-wide) are tagged with the right upstream instead of
// 'unknown'. Derived from ProxyRuntimeConfig; jwks is left to fall through to 'unknown' (low volume).
export const UndiciDiagnosticsLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* ProxyRuntimeConfig
		const byOrigin = new Map<string, { readonly upstream: UpstreamName; readonly origin: string }>([
			[config.electricOrigin, { upstream: 'electric', origin: config.electricOrigin }],
			[config.durableStreamsOrigin, { upstream: 'durable_stream', origin: config.durableStreamsOrigin }],
		])
		const lookupOrigin: OriginLookup = (origin) => (origin ? byOrigin.get(origin) : undefined)
		return yield* installUndiciDiagnostics({ lookupOrigin })
	}),
)
