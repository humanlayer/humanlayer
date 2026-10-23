export const STREAM_CONFIG = {
	contentType: 'application/json',
	ttlSeconds: 3600,
} as const

/**
 * Largest JSON-encoded file body the daemon will publish. The sync proxy rejects bodies over 10 MB
 * and a batch can carry up to 1 MB of other bodies alongside the largest one.
 */
export const MAX_TASK_DIFF_BODY_BYTES = 8 * 1024 * 1024

/** Backoff for stream reads. Full jitter averages half of the current delay ceiling. */
export const DURABLE_STREAM_READ_BACKOFF_OPTIONS = {
	initialDelay: 250,
	maxDelay: 20_000,
	multiplier: 2,
	maxRetries: Infinity,
} as const

/** Backoff for eventually creating a missing stream without a bursty retry ramp. */
export const DURABLE_STREAM_CREATE_BACKOFF_OPTIONS = {
	initialDelay: 500,
	maxDelay: 60_000,
	multiplier: 2,
	maxRetries: Infinity,
} as const
