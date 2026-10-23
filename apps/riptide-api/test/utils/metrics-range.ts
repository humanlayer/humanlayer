import { addDays, type MetricsBucket, presetRange } from '@humanlayer/riptide-api-contract/api/metrics/range'

import { formatDate } from '../../src/orpc/api/metrics/utils'

/**
 * The range input Advanced Metrics tests pass, built the same way the UI's
 * preset buttons build theirs.
 *
 * Tests used to say `{ weeks: 4 }` and let the server anchor the window. The
 * range is now explicit and bucket-aligned, so the fixture has to construct
 * one — and constructing it through `presetRange` rather than by hand is the
 * point: if the preset ever drifts from what the handlers expect, these tests
 * fail rather than quietly testing a range the product never sends.
 */
export function metricsRange(options: { weeks?: number; bucket?: MetricsBucket; timezoneOffset?: number } = {}): {
	from: string
	to: string
	bucket: MetricsBucket
	timezoneOffset: number
} {
	const { weeks = 4, bucket = 'week', timezoneOffset = 0 } = options
	// "Today" in the CALLER's calendar — the same derivation the client makes.
	const todayKey = formatDate(new Date(), timezoneOffset)
	const { from, to } = presetRange(weeks, todayKey, bucket)
	return { from, to, bucket, timezoneOffset }
}

/**
 * A daily range covering the last `days` days up to and including today.
 * Day-aligned by construction, so it needs no snapping.
 */
export function dailyMetricsRange(
	days = 14,
	timezoneOffset = 0,
): { from: string; to: string; bucket: MetricsBucket; timezoneOffset: number } {
	const to = formatDate(new Date(), timezoneOffset)
	return { from: addDays(to, -(days - 1)), to, bucket: 'day', timezoneOffset }
}
