import { useMemo, useSyncExternalStore } from 'react'

import { logger } from '@/lib/logger'
import { probeStream, type StreamProbeResult } from '@/lib/stream-liveness-probe'

export interface WatchableStream {
	readonly offset: string
	readonly stream: { readonly url: string }
}

// A stream only dies when `durable-streams` restarts, and `HEAD` does not extend its idle TTL.
export const STREAM_LIVENESS_INTERVAL_MS = 30_000

// The oRPC client raises `code: 'NOT_FOUND'`; the durable-stream client raises a `FetchError` with
// `status: 404` and no `code`.
export const isNotFoundError = (error: unknown): boolean => {
	if (error === null || typeof error !== 'object') return false
	if ('code' in error && error.code === 'NOT_FOUND') return true
	return 'status' in error && error.status === 404
}

export interface UseStreamLivenessInput {
	db: WatchableStream | null
	getAccessToken: () => Promise<string | null>
	// Before the first successful read, every not-yet-created stream would look dead.
	enabled: boolean
	// Must be stable (`useCallback`): it restarts the watchdog when it changes.
	onStreamLost: () => void
	intervalMs?: number
}

export interface StreamLiveness {
	staleSince: number | null
}

interface StreamWatch {
	subscribe: (onChange: () => void) => () => void
	getStaleSince: () => number | null
}

const IDLE_WATCH: StreamWatch = { subscribe: () => () => {}, getStaleSince: () => null }
const getNoStaleSince = () => null

// When a stream is deleted or its server restarts, the `StreamDB` consumer dies silently:
// `preload()` has already resolved and the 404 reaches only `console`.
function createStreamWatch(
	db: WatchableStream,
	getAccessToken: () => Promise<string | null>,
	onStreamLost: () => void,
	intervalMs: number,
): StreamWatch {
	const url = db.stream.url
	const listeners = new Set<() => void>()
	let timer: ReturnType<typeof setInterval> | null = null
	let staleSince: number | null = null
	let lastOffset = db.offset
	let lastConfirmedAt = Date.now()
	let reportedLost = false
	let probing = false

	const publish = (next: number | null) => {
		if (next === staleSince) return
		staleSince = next
		for (const listener of listeners) listener()
	}

	const markCurrent = () => {
		lastConfirmedAt = Date.now()
		publish(null)
	}

	const applyProbeResult = (result: StreamProbeResult) => {
		if (result.outcome === 'gone') {
			if (reportedLost) return
			reportedLost = true
			logger.warn('[stream-liveness] stream is gone, rebuilding', { url })
			onStreamLost()
			return
		}

		if (result.outcome === 'unreachable') {
			if (result.reason === 'network') {
				logger.warn('[stream-liveness] probe could not reach the stream', { url, error: result.error })
			} else {
				logger.warn('[stream-liveness] probe was refused', { url, status: result.status })
			}
			publish(lastConfirmedAt)
			return
		}

		markCurrent()
	}

	const probe = async () => {
		if (db.offset !== lastOffset) {
			lastOffset = db.offset
			markCurrent()
			return
		}
		const result = await probeStream(url, getAccessToken)
		if (timer !== null) applyProbeResult(result)
	}

	const tick = () => {
		if (probing) return
		probing = true
		void probe().finally(() => {
			probing = false
		})
	}

	return {
		getStaleSince: () => staleSince,
		subscribe: (onChange) => {
			listeners.add(onChange)
			timer ??= setInterval(tick, intervalMs)
			return () => {
				listeners.delete(onChange)
				if (listeners.size === 0 && timer !== null) {
					clearInterval(timer)
					timer = null
				}
			}
		},
	}
}

export function useStreamLiveness({
	db,
	getAccessToken,
	enabled,
	onStreamLost,
	intervalMs = STREAM_LIVENESS_INTERVAL_MS,
}: UseStreamLivenessInput): StreamLiveness {
	const watch = useMemo(
		() => (enabled && db ? createStreamWatch(db, getAccessToken, onStreamLost, intervalMs) : IDLE_WATCH),
		[db, enabled, getAccessToken, onStreamLost, intervalMs],
	)
	const staleSince = useSyncExternalStore(watch.subscribe, watch.getStaleSince, getNoStaleSince)
	return { staleSince }
}
