import * as Sentry from '@sentry/node'
import { Effect, Layer } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { Pool } from 'undici'

import { logger } from '../logger'
import { ConnectionMetrics, type UpstreamName } from './connection-metrics.service'
import { HttpPoolMetrics } from './http-pool-metrics.service'
import { makeInstrumentedConnector } from './instrumented-connector'
import type { UndiciPoolOptions } from './undici-pool-options'
import { createRequestProxyWithSocketPool } from './undici-proxy-fetch'

const BENIGN_SOCKET_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])

type ClosablePool = Pool & {
	readonly close?: () => Promise<void>
	readonly destroy?: () => Promise<void> | void
}

function makeFetchHttpClientLayer(fetch: typeof globalThis.fetch) {
	return FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)))
}

function errorClassOf(error: unknown): string {
	const code = (error as { code?: unknown } | null)?.code
	if (typeof code === 'string') return code
	if (error instanceof Error) return error.name
	return 'UnknownError'
}

export function makePooledHttpClient(options: {
	readonly upstream: UpstreamName
	readonly origin: string
	readonly poolOptions: UndiciPoolOptions
}) {
	return Effect.gen(function* () {
		const poolMetrics = yield* HttpPoolMetrics
		const metrics = yield* ConnectionMetrics

		// recordStreamAbort fires on the raw undici socket/Readable after the request Effect resolved,
		// while the HTTP server drains the body off-fiber — no request fiber to catch it in, so record it
		// fire-and-forget (same pattern as undici-diagnostics.service.ts).
		const recordAbort = (phase: 'socket' | 'body_stream', error: unknown) =>
			void Effect.runPromise(
				metrics.recordStreamAbort({
					upstream: options.upstream,
					origin: options.origin,
					errorClass: errorClassOf(error),
					phase,
				}),
			)

		const onSocketError = (error: unknown) => {
			recordAbort('socket', error)
			const code = (error as { code?: unknown } | null)?.code
			if (typeof code === 'string' && BENIGN_SOCKET_CODES.has(code)) {
				logger.debug(`[${options.upstream}] upstream socket teardown (${code})`)
			} else {
				// Unexpected socket error — surface it (handled, NOT fatal) so we learn about new variants.
				Sentry.captureException(error, {
					level: 'warning',
					tags: { upstream: options.upstream, phase: 'socket' },
				})
			}
		}

		const onStreamError = (error: unknown) => recordAbort('body_stream', error)

		const connectTimeoutMs =
			typeof options.poolOptions.connect === 'object' &&
			options.poolOptions.connect !== null &&
			typeof (options.poolOptions.connect as { timeout?: unknown }).timeout === 'number'
				? (options.poolOptions.connect as { timeout: number }).timeout
				: 10_000

		const pool = yield* Effect.acquireRelease(
			Effect.sync(
				() =>
					new Pool(options.origin, {
						...options.poolOptions,
						connect: makeInstrumentedConnector({ connectTimeoutMs, onSocketError }),
					}),
			).pipe(
				Effect.tap((pool) =>
					poolMetrics.registerPool({
						upstream: options.upstream,
						origin: options.origin,
						connectionCap: options.poolOptions.connections ?? 0,
						pool,
					}),
				),
			),
			(pool) =>
				poolMetrics.unregisterPool(options.upstream, options.origin).pipe(
					Effect.andThen(
						Effect.promise(async () => {
							const closablePool = pool as ClosablePool
							if (typeof closablePool.close === 'function') {
								await closablePool.close()
								return
							}
							if (typeof closablePool.destroy === 'function') await closablePool.destroy()
						}),
					),
				),
		)

		return yield* HttpClient.HttpClient.pipe(
			Effect.provide(makeFetchHttpClientLayer(createRequestProxyWithSocketPool(pool, onStreamError))),
		)
	})
}
