/**
 * This is the actual JWKS cache and validator
 */

import { Context, Duration, Effect, Layer, Ref, Schedule } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { importJWK } from 'jose'

import { Sentry } from '@/lib/effect/sentry.service'
import { logger } from '@/lib/logger'

import {
	JWKSFetchError,
	JWKSFetchTimeoutError,
	JWKSKeyImportError,
	JWKSKeyNotFoundError,
	type JWKSNotReadyError,
} from './errors'
import { JWKSResponse } from './jwk.schema'
import { JWKSConfig } from './jwks-cache-config.service'

/**
 * Service for JWKS cache - this defines the interface for how we cache JWKS keys
 */
export class JWKSCache extends Context.Service<
	JWKSCache,
	{
		getKey: (kid: string) => Effect.Effect<CryptoKey, JWKSNotReadyError | JWKSKeyNotFoundError>
		isReady: Effect.Effect<boolean>
		forceRefresh: Effect.Effect<void, JWKSFetchError | JWKSFetchTimeoutError | JWKSKeyImportError>
	}
>()('JWKSCache') {}

/**
 * This is the interface of the internal state for the JWKS cache which will be a ref inside our layer
 */
export interface JWKSState {
	keys: Map<string, CryptoKey>
	ready: boolean
}

export const JWKSCacheLive = Layer.effect(
	JWKSCache,
	Effect.gen(function* () {
		const jwksConfig = yield* JWKSConfig
		const state = yield* Ref.make<JWKSState>({ ready: false, keys: new Map<string, CryptoKey>() })
		const httpClient = yield* HttpClient.HttpClient

		/**
		 * Fetch JWKS from the configured URL with timeout
		 */
		const fetchJWKS = HttpClientRequest.get(jwksConfig.jwksUrl).pipe(
			httpClient.execute,
			Effect.flatMap(HttpClientResponse.schemaBodyJson(JWKSResponse)),
			Effect.mapError(
				(error) =>
					new JWKSFetchError({
						message: 'Failed to fetch JWKS',
						cause: String(error),
					}),
			),
			Effect.timeoutOrElse({
				duration: Duration.millis(jwksConfig.keyFetchTimeoutMs),
				orElse: () => Effect.fail(new JWKSFetchTimeoutError()),
			}),
			Effect.scoped,
		)

		/**
		 * Import fetched JWKs into CryptoKey instances
		 */
		const importJwks = (response: typeof JWKSResponse.Type) =>
			Effect.gen(function* () {
				const newKeys = new Map<string, CryptoKey>()
				for (const jwk of response.keys) {
					if (jwk.kid) {
						const key = yield* Effect.tryPromise({
							try: () => importJWK(jwk) as Promise<CryptoKey>,
							catch: (error) => {
								const importError = new JWKSKeyImportError({
									kid: jwk.kid ?? '',
									cause: String(error),
								})
								logger.error({ kid: jwk.kid, error: String(error) }, 'Failed to import JWK')
								Sentry.captureException(error, {
									tags: { error_type: 'jwks_key_import', kid: jwk.kid },
								})
								return importError
							},
						})
						newKeys.set(jwk.kid, key)
					}
				}
				return newKeys
			})

		/**
		 * Retry schedule: exponential backoff 250ms -> 500ms -> 1s -> 2s -> ...
		 * Stop retrying after the refresh interval has elapsed so the next scheduled
		 * cycle can use the same cadence without extra coordination.
		 */
		const refreshInterval = Duration.millis(jwksConfig.refreshIntervalMs)
		const retrySchedule = Schedule.max([
			Schedule.exponential(Duration.millis(250), 2),
			Schedule.during(refreshInterval),
		])
		const observeRefreshFailure = (error: JWKSFetchError | JWKSFetchTimeoutError | JWKSKeyImportError) =>
			Effect.sync(() => {
				logger.warn({ error: { _tag: error._tag } }, 'JWKS refresh failed, retrying')
				Sentry.addBreadcrumb({
					category: 'jwks',
					message: `JWKS fetch failed: ${error._tag}`,
					level: 'warning',
				})
			})

		/**
		 * Fetch, import, and update state - with retry on failure
		 */
		const refreshJwksOnce = fetchJWKS.pipe(
			Effect.flatMap(importJwks),
			Effect.tap((newKeys) => Ref.set(state, { ready: true, keys: newKeys })),
			Effect.tap((newKeys) => Effect.sync(() => logger.info({ keyCount: newKeys.size }, 'JWKS cache refreshed'))),
			Effect.asVoid,
			Effect.tapError(observeRefreshFailure),
			Effect.retry(retrySchedule),
			Effect.tapError((error) =>
				Effect.sync(() => {
					logger.error({ error: { _tag: error._tag } }, 'JWKS refresh failed after all retries')
					Sentry.captureException(error, { tags: { error_type: 'jwks_refresh' } })
				}),
			),
		)

		// Initial fetch - blocks until first successful fetch
		yield* refreshJwksOnce
		yield* Effect.sync(() => logger.info('JWKS cache initialized'))

		const logBackgroundRefreshFailure = (error: JWKSFetchError | JWKSFetchTimeoutError | JWKSKeyImportError) =>
			Effect.sync(() => {
				logger.error(
					{ error: { _tag: error._tag } },
					'JWKS background refresh failed, will retry next interval',
				)
				Sentry.captureException(error, {
					tags: { error_type: 'jwks_background_refresh' },
				})
			})

		// Background refresh loop. Each refresh owns its retry window; when the
		// interval-sized backoff is exhausted, the fixed schedule starts the next one.
		yield* Effect.forkScoped(
			Effect.repeat(
				refreshJwksOnce.pipe(Effect.catch(logBackgroundRefreshFailure)),
				Schedule.fixed(refreshInterval),
			),
		)

		return {
			getKey: (kid: string) =>
				Effect.gen(function* () {
					const current = yield* Ref.get(state)
					const key = current.keys.get(kid)
					if (!key) {
						yield* Effect.sync(() => {
							logger.error({ kid }, 'Key not found for kid')
							Sentry.captureMessage('JWKS key not found', {
								level: 'error',
								tags: { error_type: 'jwks_key_not_found', kid },
							})
						})
						return yield* Effect.fail(new JWKSKeyNotFoundError({ kid }))
					}
					return key
				}),

			isReady: Ref.get(state).pipe(Effect.map((s) => s.ready)),

			forceRefresh: refreshJwksOnce,
		}
	}),
)
