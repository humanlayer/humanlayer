/**
 * Shared utility functions for metrics endpoints.
 *
 * NOTE: metrics queries read commit data FROM the `authored_commits` view
 * (the ledger minus merge commits — see packages/db/src/tables/commits.ts),
 * never from `commits` directly. The view is where "what counts" lives.
 *
 * Two generations of time window live here side by side, on purpose:
 *
 * - The **Team Metrics** page still uses rolling `'7d' | '30d' | '90d'`
 *   windows ({@link calculateDateRange}) and the rolling N×7-day
 *   {@link calculateWeekRange}. Untouched.
 * - The **Advanced Metrics** page takes an explicit bucket-aligned range and
 *   resolves it through {@link resolveMetricsRange}. The range algebra itself
 *   is isomorphic and lives in the contract package, so this side and the UI
 *   cannot disagree about what a bucket is.
 */

import {
	addDays,
	enumerateBuckets,
	historyStart,
	type MetricsBucket,
	type MetricsRangeInput,
	parseDayKey,
	TRAILING_LEAD_IN_DAYS,
} from '@humanlayer/riptide-api-contract/api/metrics/range'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Formats a date as YYYY-MM-DD, adjusted by the given timezone offset.
 *
 * @param d - The date to format
 * @param offsetMinutes - Timezone offset in minutes (from Date.getTimezoneOffset())
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDate(d: Date, offsetMinutes: number): string {
	// Apply offset by creating a new date shifted by the offset
	const adjustedTime = d.getTime() - offsetMinutes * 60 * 1000
	const adjustedDate = new Date(adjustedTime)

	const year = adjustedDate.getUTCFullYear()
	const month = String(adjustedDate.getUTCMonth() + 1).padStart(2, '0')
	const day = String(adjustedDate.getUTCDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

/**
 * Calculates rolling date range boundaries for metrics queries.
 *
 * @param range - Time range ('7d', '30d', or '90d')
 * @returns Object containing start/end dates and timestamps
 */
export function calculateDateRange(range: '7d' | '30d' | '90d'): {
	startDate: Date
	endDate: Date
	startTimestamp: bigint
	endTimestamp: bigint
} {
	const days = range === '7d' ? 7 : range === '30d' ? 30 : 90

	const startDate = new Date()
	startDate.setDate(startDate.getDate() - days)

	const endDate = new Date()

	const startTimestamp = BigInt(startDate.getTime())
	const endTimestamp = BigInt(endDate.getTime())

	return {
		startDate,
		endDate,
		startTimestamp,
		endTimestamp,
	}
}

/**
 * Gets the Monday of the ISO week containing the given date, in UTC.
 *
 * MUST be UTC-anchored: the SQL side buckets weeks with Postgres
 * `DATE_TRUNC('week', … AT TIME ZONE 'UTC')` (an ISO Monday in UTC), and
 * {@link formatDate} renders bucket keys in UTC. Computing the Monday in the
 * server's LOCAL timezone would, on any non-UTC host, shift the key by a day
 * (e.g. CEST → the previous Sunday), so every generated bucket key misses the
 * SQL keys and counts collapse to zero. UTC methods keep both sides aligned.
 *
 * @param date - The date to find the Monday for
 * @returns Date object set to the UTC Monday 00:00:00.000
 */
export function getMonday(date: Date): Date {
	const d = new Date(date)
	const day = d.getUTCDay()
	const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
	d.setUTCDate(diff)
	d.setUTCHours(0, 0, 0, 0)
	return d
}

/**
 * Calculates date range boundaries for weekly metrics queries.
 *
 * @param weeks - Number of weeks to look back (4, 8, or 12)
 * @returns Object containing start/end dates and timestamps
 */
export function calculateWeekRange(weeks: number): {
	startDate: Date
	endDate: Date
	startTimestamp: bigint
	endTimestamp: bigint
} {
	const endDate = new Date()
	endDate.setDate(endDate.getDate() + 1) // +1 to handle UTC offset issues

	const startDate = new Date()
	startDate.setDate(startDate.getDate() - weeks * 7)

	const startTimestamp = BigInt(startDate.getTime())
	const endTimestamp = BigInt(endDate.getTime())

	return {
		startDate,
		endDate,
		startTimestamp,
		endTimestamp,
	}
}

/**
 * Normalizes a `DATE_TRUNC(…)::date` result to its 'YYYY-MM-DD' bucket key.
 * Postgres drivers return dates as either strings or Date objects depending on
 * configuration; every bucketed handler joins its SQL rows to generated keys
 * through THIS one rule, so a change to the Date branch can't drift
 * per-handler and silently zero a chart.
 */
export function bucketKey(value: string | Date): string {
	return value instanceof Date ? formatDate(value, 0) : String(value)
}

/**
 * The bucket-key SQL expression, built once instead of hand-copied into every
 * handler.
 *
 * `epochMsColumn` is a millisecond epoch column (`occurred_at`,
 * `committed_at`, `merged_at`). The `- INTERVAL '1 minute' * offset` shift is
 * what makes the bucket a CLIENT-LOCAL one: without it a viewer in Auckland
 * sees Sunday evening's spend fall in the following week. `bucket` is a bind
 * parameter rather than interpolated text — DATE_TRUNC takes its unit as
 * text, so there is no reason to build this string by hand.
 */
export function bucketKeySql(epochMsColumn: SQL, bucket: MetricsBucket, offsetMinutes: number): SQL {
	return sql`DATE_TRUNC(${bucket}, to_timestamp(${epochMsColumn} / 1000) AT TIME ZONE 'UTC' - INTERVAL '1 minute' * ${offsetMinutes})::date`
}

/** What every Advanced Metrics handler needs in order to run its queries. */
export interface ResolvedMetricsRange {
	/**
	 * Real epoch ms of the first instant the query must read — the local
	 * midnight opening the first bucket, INCLUDING the trailing lead-in.
	 */
	startTimestamp: bigint
	/** Real epoch ms of the last instant of `to`'s local day. */
	endTimestamp: bigint
	/**
	 * Every bucket key the response must carry, ascending, lead-in buckets
	 * first. Handlers zero-fill against THESE rather than re-deriving keys, so
	 * the dense spine is computed once per request.
	 */
	bucketKeys: string[]
	/** Bucket keys inside the selected range only — the dense spine for non-ratio handlers. */
	inRangeBucketKeys: string[]
	bucket: MetricsBucket
	offsetMinutes: number
	/** Echo of the caller's range, for the response's caption fields. */
	startDate: string
	endDate: string
}

/**
 * Turns the wire range into SQL bounds and a dense bucket spine.
 *
 * The range arrives bucket-aligned (the contract's schema refuses anything
 * else), so this does no snapping and no anchoring — the guarantee that no
 * bucket is partial was established before the request was sent, which is the
 * point of the whole design. What is left is mechanical: convert local day
 * keys to real instants using the caller's offset, and enumerate the buckets.
 *
 * `leadInBuckets` asks for extra buckets BEFORE `from`, needed only by the
 * ratio endpoints in daily mode (see TRAILING_LEAD_IN_DAYS). It is ignored for
 * weekly ranges: a weekly ratio already divides a whole week of numerator by
 * the same whole week of denominator, so it needs no history to be readable.
 */
export function resolveMetricsRange(
	input: MetricsRangeInput,
	options: { leadInBuckets?: number } = {},
): ResolvedMetricsRange {
	const { from, to, bucket } = input
	const offsetMinutes = input.timezoneOffset ?? 0

	// No snapping: the contract's schema refuses an unaligned range, so `from`
	// is already a bucket start. Snapping here would be a no-op that made the
	// invariant look optional.
	const leadIn = bucket === 'day' ? (options.leadInBuckets ?? 0) : 0
	const queryFrom = leadIn > 0 ? addDays(from, -leadIn) : from

	// A day key names a local wall-clock midnight; that wall time happens at
	// real time `naive + offset` (getTimezoneOffset is positive WEST). Same rule
	// the SQL bucketing uses, expressed once on each side of the wire.
	const toLocalStartMs = (key: string) => (parseDayKey(key) ?? 0) + offsetMinutes * 60_000

	const bucketKeys = enumerateBuckets(queryFrom, to, bucket)
	const inRangeBucketKeys = enumerateBuckets(from, to, bucket)

	return {
		startTimestamp: BigInt(toLocalStartMs(queryFrom)),
		// End of `to`'s local day. Inclusive bound, so the last millisecond of the
		// final bucket is read — a `< next midnight` bound would drop a usage
		// event landing exactly on it.
		endTimestamp: BigInt(toLocalStartMs(to) + 86_399_999),
		bucketKeys,
		inRangeBucketKeys,
		bucket,
		offsetMinutes,
		startDate: from,
		endDate: to,
	}
}

/** The lead-in every ratio endpoint asks for. Named so handlers agree by construction. */
export const RATIO_LEAD_IN = { leadInBuckets: TRAILING_LEAD_IN_DAYS } as const

/** The strip window the range-INDEPENDENT endpoints share: the brush's own span. */
export interface HistoryWindow {
	earliestDate: string
	latestDate: string
	startTimestamp: bigint
	endTimestamp: bigint
}

/**
 * The window behind `rangeOverview` and `scatterFilterOptions` — the span the
 * range brush draws, which is also the span it can select within.
 *
 * Shared rather than derived per handler for the same reason
 * {@link resolveMetricsRange} is: those two endpoints are documented as covering
 * EXACTLY the same days, and two hand-rolled copies of "client today minus
 * RANGE_HISTORY_DAYS" keep that agreement by luck rather than by construction.
 */
export function resolveHistoryWindow(offsetMinutes: number): HistoryWindow {
	// "Today" in the CALLER's calendar, not the server's — on a UTC host those
	// are up to a day apart.
	const latestDate = formatDate(new Date(), offsetMinutes)
	const earliestDate = historyStart(latestDate)
	const toLocalStartMs = (key: string) => (parseDayKey(key) ?? 0) + offsetMinutes * 60_000
	return {
		earliestDate,
		latestDate,
		startTimestamp: BigInt(toLocalStartMs(earliestDate)),
		endTimestamp: BigInt(toLocalStartMs(latestDate) + 86_399_999),
	}
}

/**
 * Determines if a date is a weekend, adjusted by timezone offset.
 *
 * @param d - The date to check
 * @param offsetMinutes - Timezone offset in minutes
 * @returns true if the date is a Saturday or Sunday in the adjusted timezone
 */
export function getIsWeekend(d: Date, offsetMinutes: number): boolean {
	// Apply offset to get the correct local day
	const adjustedTime = d.getTime() - offsetMinutes * 60 * 1000
	const adjustedDate = new Date(adjustedTime)

	const dayOfWeek = adjustedDate.getUTCDay() // 0=Sunday, 6=Saturday
	return dayOfWeek === 0 || dayOfWeek === 6
}
