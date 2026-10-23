import type { CollectionHealthTracker } from './health-tracker.ts'

/** Minimal logger interface — avoids coupling to @humanlayer/logger transports. */
interface FetchLogger {
	warn(...args: unknown[]): void
}

/**
 * Wraps the global `fetch` function to automatically record Electric SQL health
 * events on the provided `CollectionHealthTracker`.
 *
 * - HTTP 5XX responses → recordElectricError (counts toward failover threshold)
 * - HTTP 2XX responses → recordElectricSuccess (counts toward recovery threshold)
 * - Other status codes (1XX, 3XX, 4XX) → ignored (not Electric failures)
 * - Network errors (fetch threw a TypeError) → recordElectricError
 *
 * A single recorded error does not failover on its own: Electric wraps this fetch in an
 * infinite-backoff retry loop, so individual attempts fail and recover constantly. The
 * tracker only degrades after DEGRADE_ERROR_THRESHOLD consecutive errors (a sustained
 * outage), and any success resets the streak — so a transient drop that Electric retries
 * and recovers within a second never flaps the collection to query mode (CORE-1326).
 *
 * Intended to be passed as `fetchClient` in Electric collection `shapeOptions`.
 *
 * @param tracker - The CollectionHealthTracker to record events on
 * @param collectionName - The collection name used for tracker event recording
 * @param logger - Optional logger for diagnostic output
 * @returns A fetch-compatible function
 */
export function createTrackedFetchClient(
	tracker: CollectionHealthTracker,
	collectionName: string,
	logger?: FetchLogger,
): (input: Request | string | URL, init?: RequestInit) => Promise<Response> {
	return async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
		try {
			const response = await fetch(input, init)

			if (response.status >= 500) {
				logger?.warn({ status: response.status, collectionName }, 'Electric fetch 5XX')
				tracker.recordElectricError(collectionName)
			} else if (response.ok) {
				tracker.recordElectricSuccess(collectionName)
			}

			return response
		} catch (err) {
			// Only treat real network errors as Electric failures. fetch() throws
			// TypeError for genuine network issues (DNS failure, connection refused).
			// Everything else — AbortError, raw strings thrown by Electric's internal
			// fetch wrappers during abort/reconnection cycles — should be ignored.
			if (err instanceof TypeError) {
				logger?.warn({ collectionName, error: (err as Error).message }, 'Electric fetch network error')
				tracker.recordElectricError(collectionName)
			}

			throw err
		}
	}
}
