import type { Logger } from '@humanlayer/logger'

import type { CollectionHealthTracker } from './health-tracker.ts'
import type { SyncErrorReporter } from './sync-error-handler.ts'

/**
 * Minimal collection surface the keep-alive needs. A real TanStack DB `Collection`
 * satisfies this structurally (it's the same `subscribeChanges` / `on` shape the
 * collection cache already relies on), so no cast is required at the call site.
 */
export interface KeepAliveCollection {
	subscribeChanges(callback: () => void, options?: { includeInitialState?: boolean }): { unsubscribe: () => void }
	on(event: 'status:change', handler: (payload: { status: string }) => void): void
}

/** The slice of the health tracker the keep-alive reads from. */
type KeepAliveTracker = Pick<CollectionHealthTracker, 'getAllModes' | 'onChange'>

export interface KeepAliveOptions {
	logger?: Logger
	/** Reporter for unexpected keep-alive failures (e.g. Sentry). */
	captureException?: SyncErrorReporter
}

/**
 * Keeps an on-demand Electric collection syncing while it is in query (degraded) mode, so the
 * health tracker can observe Electric successes and recover it back to electric mode.
 *
 * Electric collections are `syncMode: 'on-demand'`: they only sync while something subscribes.
 * When a collection degrades to query mode the UI swaps to the query collection and stops
 * subscribing to the Electric one — the ShapeStream stops, no Electric successes are ever
 * recorded, and the consecutive-success recovery can never fire. The collection is then stuck
 * on stale data until a full page reload (CORE-1326). Holding a no-op `subscribeChanges` while
 * degraded keeps the ShapeStream long-polling so the tracker can recover it on its own.
 *
 * This is wired once per collection at creation (in `createBrowserElectricCollection`), so it
 * covers every Electric collection — including dynamically-added ones — with no per-app wiring.
 * The tracker subscription is torn down when the collection emits `status:change` → `cleaned-up`
 * (the same disposal signal the collection cache uses), so it never outlives its collection.
 *
 * Observability: the subscribe/unsubscribe calls run inside the tracker's and the collection's
 * event-emit loops, so an uncaught throw here would otherwise be swallowed (or break dispatch for
 * other listeners). They are wrapped — every failure is logged, and the first failure of each kind
 * is reported via `captureException` (deduped so a flapping collection can't flood Sentry) with
 * `sync.*` tags, so a stalled recovery is visible instead of silently failing. Normal engage/release
 * transitions are logged at debug for a breadcrumb trail.
 *
 * @returns A teardown function. It also runs automatically on the collection's `cleaned-up`
 *   status, so callers that let the collection manage its own lifecycle can ignore it.
 */
export function attachElectricKeepAlive(
	collection: KeepAliveCollection,
	tracker: KeepAliveTracker,
	collectionName: string,
	options: KeepAliveOptions = {},
): () => void {
	const { logger, captureException } = options
	const tags = { 'sync.mode': 'electric', 'sync.collection': collectionName }
	// Report each kind of failure at most once per collection instance: degrade/recover cycles
	// would otherwise re-run the failing call and flood Sentry. Logging is not deduped.
	const reportedReasons = new Set<string>()

	const report = (error: unknown, reason: 'subscribe' | 'unsubscribe') => {
		const cause = error instanceof Error ? error : new Error(String(error))
		logger?.warn(`Electric keep-alive ${reason} failed for ${collectionName}`, cause)
		if (reportedReasons.has(reason)) return
		reportedReasons.add(reason)
		captureException?.(new Error(`Electric keep-alive ${reason} failed for ${collectionName}`, { cause }), {
			tags: { ...tags, 'sync.reason': `keep_alive_${reason}` },
		})
	}

	let keepAlive: { unsubscribe: () => void } | null = null

	const ensureKeepAlive = () => {
		if (keepAlive) return
		try {
			// includeInitialState: false avoids replaying the whole collection to our no-op callback.
			keepAlive = collection.subscribeChanges(() => undefined, { includeInitialState: false })
			logger?.debug(`Electric keep-alive engaged for ${collectionName} (degraded to query mode)`)
		} catch (error) {
			report(error, 'subscribe')
		}
	}

	const releaseKeepAlive = () => {
		if (!keepAlive) return
		try {
			keepAlive.unsubscribe()
			logger?.debug(`Electric keep-alive released for ${collectionName} (recovered to electric mode)`)
		} catch (error) {
			report(error, 'unsubscribe')
		} finally {
			keepAlive = null
		}
	}

	// Cover the case where the collection is created while it is already degraded.
	if (tracker.getAllModes()[collectionName] === 'query') ensureKeepAlive()

	const unsubscribeTracker = tracker.onChange((name, mode) => {
		if (name !== collectionName) return
		if (mode === 'query') ensureKeepAlive()
		else releaseKeepAlive()
	})

	let isTornDown = false
	const teardown = () => {
		if (isTornDown) return
		isTornDown = true
		unsubscribeTracker()
		releaseKeepAlive()
	}

	collection.on('status:change', ({ status }) => {
		if (status === 'cleaned-up') teardown()
	})

	return teardown
}
