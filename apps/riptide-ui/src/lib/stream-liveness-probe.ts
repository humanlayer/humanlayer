import { DurableStream } from '@durable-streams/client'

import { logger } from '@/lib/logger'

export type StreamProbeResult =
	| { outcome: 'current' }
	| { outcome: 'gone' }
	| { outcome: 'unreachable'; reason: 'network'; error: unknown }
	| { outcome: 'unreachable'; reason: 'refused'; status: number }

// A `HEAD` that never answers would otherwise hold the watchdog's in-flight slot forever.
export const STREAM_PROBE_TIMEOUT_MS = 10_000

// `HEAD` does not extend the stream's idle TTL, so probing cannot keep a stream nobody wants alive.
export const probeStream = async (
	url: string,
	getAccessToken: () => Promise<string | null>,
	timeoutMs = STREAM_PROBE_TIMEOUT_MS,
): Promise<StreamProbeResult> => {
	const abort = new AbortController()
	const timer = setTimeout(() => abort.abort(), timeoutMs)
	try {
		const token = await getAccessToken()
		const result = await DurableStream.head({
			url,
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			signal: abort.signal,
		})
		return result.exists ? { outcome: 'current' } : { outcome: 'gone' }
	} catch (error) {
		logger.debug('[stream-liveness] probe threw', { url, error })
		if (error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
			return { outcome: 'unreachable', reason: 'refused', status: error.status }
		}
		return { outcome: 'unreachable', reason: 'network', error }
	} finally {
		clearTimeout(timer)
	}
}
