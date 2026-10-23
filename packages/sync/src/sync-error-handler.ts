import type { Logger } from '@humanlayer/logger'
import { ElectricFetchError } from '@humanlayer/schemas/effect/electric/fetch-error'
import * as Schema from 'effect/Schema'

/**
 * Callback type for reporting sync errors to an external error tracker (e.g. Sentry).
 * Accepts the error and a context object with tags for categorization.
 */
export type SyncErrorReporter = (error: unknown, context: { tags: Record<string, string> }) => void

/**
 * Duck-type check for FetchError from @electric-sql/client.
 *
 * We cannot use `instanceof FetchError` because Vite may pre-bundle a separate
 * copy of @electric-sql/client (inlined into @tanstack/electric-db-collection)
 * from the app's direct dependency. The error thrown by the bundled copy would
 * fail instanceof checks against the app's imported class.
 */
export function isFetchError(error: unknown): error is Error & ElectricFetchError {
	return error instanceof Error && Schema.is(ElectricFetchError)(error)
}

/**
 * True for expected auth-lifecycle churn — an expired or absent access token, or a 401/403 —
 * rather than a real sync bug. During these the token refreshes and the next request succeeds,
 * so query-mode sync skips Sentry (these otherwise dominate the UI projects' error volume, e.g.
 * RIPTIDE-UI-59 "No access token available"). The Electric handler already skips the same cases.
 *
 * Matches on stable, bundling-safe signals (never the class name, which fragments per release):
 * a FetchError `.status`, an `AccessTokenUnavailableError` `.name`, an oRPC `code`, or WorkOS
 * authkit's "No access token available" message.
 */
export function isAuthLifecycleError(error: unknown): boolean {
	if (isFetchError(error) && (error.status === 401 || error.status === 403)) return true
	if (error !== null && typeof error === 'object') {
		const { name, code, status, message } = error as {
			name?: unknown
			code?: unknown
			status?: unknown
			message?: unknown
		}
		if (name === 'AccessTokenUnavailableError') return true
		if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return true
		if (status === 401 || status === 403) return true
		if (typeof message === 'string' && message.includes('No access token available')) return true
	}
	return false
}

/**
 * Create an error handler for query-based sync collection errors.
 *
 * Used by query-based sync (via createSyncQueryFn onError) to tag errors
 * with `sync.mode` and `sync.collection` for Sentry filtering.
 */
export function createQuerySyncErrorHandler(opts: {
	collectionName: string
	syncMode: 'electric' | 'query'
	captureException?: SyncErrorReporter
}): (error: unknown) => void {
	const tags = {
		'sync.mode': opts.syncMode,
		'sync.collection': opts.collectionName,
	}

	return (error: unknown) => {
		// Auth-lifecycle churn (expired or absent token, 401 or 403) is expected: the token refreshes
		// and the next query succeeds, so skip Sentry, mirroring the Electric handler. `ignoreErrors`
		// stays a backstop.
		if (isAuthLifecycleError(error)) return
		opts.captureException?.(error, { tags })
	}
}

const AUTH_ERROR_RETRY_DELAY_MS = 2_000

/**
 * Create an error handler for Electric sync collection errors.
 *
 * Consolidates the common Electric onError logic across all apps:
 * - 409 → return `{}` (Electric control flow, re-sync immediately)
 * - 401/403 → delay 2s + return `{}` (retry with fresh auth from async header)
 * - Auth token unavailable (async tokenFetcher threw) → delay 2s + return `{}` once past
 *   initial load (shouldRetryOnFailure), else `undefined`
 * - 404 → log + capture → return `undefined` (stop sync)
 * - Unknown → log + capture → return `{}` if shouldRetryOnFailure, else stop
 *
 * The 401/403 and auth-unavailable retries work because Electric's Authorization header is
 * an async function that calls getAccessToken() fresh on each request. After a brief auth
 * blip — an upstream JWKS refresh, a transient network failure during a token refresh, or a
 * cross-tab refresh-lock timeout — the next request gets valid auth. Returning `undefined`
 * instead would permanently tear down the shape stream (recoverable only by a full reload),
 * which is the CORE-1326 "left nav hangs / stale data" failure.
 *
 * @param opts.collectionName - Name used in log messages and Sentry tags
 * @param opts.shouldRetryOnFailure - Whether to signal Electric to re-init on unknown errors
 * @param opts.logger - Logger instance from @humanlayer/logger
 * @param opts.captureException - Optional Sentry reporter
 * @param opts.isAuthUnavailableError - Optional predicate for auth-token-unavailable errors (browser apps)
 * @param opts.authErrorRetryDelayMs - Override for tests; production defaults to 2 seconds
 */
export function createElectricSyncErrorHandler(opts: {
	collectionName: string
	shouldRetryOnFailure: boolean
	logger: Logger
	captureException?: SyncErrorReporter
	isAuthUnavailableError?: (error: unknown) => boolean
	authErrorRetryDelayMs?: number
}): (error: unknown) => Promise<{} | undefined> | {} | undefined {
	const tags = {
		'sync.mode': 'electric',
		'sync.collection': opts.collectionName,
	}

	let authUnavailableLogged = false

	return async (error: unknown): Promise<{} | undefined> => {
		// Auth token unavailable: the async tokenFetcher (getAccessToken) threw.
		//
		// authkit throws here on TRANSIENT refresh failures too — a network blip during the
		// token refresh, or a cross-tab refresh-lock timeout — not only on genuine logout,
		// and it deliberately stays recoverable, expecting the next getAccessToken() call to
		// succeed. Returning undefined would tear the Electric ShapeStream down for good (no
		// retry), stranding the collection on stale data until a full page reload (CORE-1326).
		// So once we're past initial auth load, retry like the 401/403 path: Electric
		// re-invokes the async Authorization header, getAccessToken() refreshes, and the
		// stream resumes — which also preserves the client's wake/visibility auto-recovery
		// that a teardown would otherwise unsubscribe.
		if (opts.isAuthUnavailableError?.(error)) {
			if (opts.shouldRetryOnFailure) {
				opts.logger.warn(`Access token unavailable for ${opts.collectionName}; retrying after delay`)
				if (!authUnavailableLogged) {
					authUnavailableLogged = true
					console.error(`Electric sync auth token unavailable for ${opts.collectionName}`, error)
				}
				await new Promise((resolve) =>
					setTimeout(resolve, opts.authErrorRetryDelayMs ?? AUTH_ERROR_RETRY_DELAY_MS),
				)
				return {}
			}
			// During initial auth load this is expected, and the collection is recreated when
			// `isLoading` flips to false, so stopping here is fine.
			opts.logger.warn(`Access token unavailable for ${opts.collectionName} during load; stopping sync.`)
			return
		}

		// Electric's FetchError carries the shape URL on `.url` even when the message
		// is a bare network string like "Load failed" / "Failed to fetch".
		const url = isFetchError(error) ? error.url : undefined

		if (isFetchError(error)) {
			if (error.status === 401 || error.status === 403) {
				opts.logger.info(`Auth error (${error.status}) syncing ${opts.collectionName}; retrying after delay`)
				await new Promise((resolve) =>
					setTimeout(resolve, opts.authErrorRetryDelayMs ?? AUTH_ERROR_RETRY_DELAY_MS),
				)
				return {}
			}
			if (error.status === 404) {
				opts.logger.error(`Sync endpoint not found for ${opts.collectionName} (url: ${url}); stopping sync.`)
				opts.captureException?.(error, { tags })
				return
			}
			if (error.status === 409) {
				return {}
			}
		}

		opts.logger.error(`Error syncing ${opts.collectionName} (url: ${url ?? 'unknown'}):`, error)
		opts.captureException?.(error, { tags })
		if (opts.shouldRetryOnFailure) {
			return {}
		}
	}
}
