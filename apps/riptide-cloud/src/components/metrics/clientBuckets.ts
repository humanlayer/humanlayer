/**
 * THE bucket-key display module: every Advanced Metrics chart keys its data on
 * CLIENT-LOCAL bucket keys ('YYYY-MM-DD', shifted by the caller's timezone
 * offset on the API side — see the API's metrics/utils.ts for the server half
 * of the rule). Parsing, completeness and formatting of those keys live here,
 * so "local midnight happens at real time midnight + offset" exists in exactly
 * one place per side of the wire.
 *
 * The key ARITHMETIC — enumeration, alignment, snapping — is not here: it is
 * isomorphic and lives in the contract package, so the client and the API
 * cannot drift. What is here is everything that needs a clock or a reader.
 */

import { type MetricsBucket, parseDayKey } from '@humanlayer/riptide-api-contract/api/metrics/range'
import { format } from 'date-fns'

export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const MS_PER_WEEK = 7 * MS_PER_DAY

/** Days a bucket of this size spans. */
export function bucketDays(bucket: MetricsBucket): number {
	return bucket === 'week' ? 7 : 1
}

/**
 * The real (absolute) epoch ms at which a client-local bucket key begins:
 * local midnight happens at real time midnight + offset.
 */
export function bucketRealStartMs(bucketStart: string, offsetMinutes: number): number | null {
	const naive = parseDayKey(bucketStart)
	return naive === null ? null : naive + offsetMinutes * 60_000
}

/**
 * 'YYYY-MM-DD' → a Date safe to hand to date-fns format(): constructed in
 * LOCAL time. Passing the string straight to format() parses it as UTC
 * midnight and then renders in local time — every caption date shifts one
 * day early for viewers west of Greenwich ('2026-08-03' → "Aug 2nd" in New
 * York), defeating the endpoints' careful client-offset bucketing.
 */
export function parseLocalDay(dateStr: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
	if (!match) return null
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** '2026-07-27' → 'Jul 27' for headline labels; falls through unparseable input. */
export function formatBucketLabel(bucketStart: string): string {
	const day = parseLocalDay(bucketStart)
	return day ? format(day, 'MMM d') : bucketStart
}

/**
 * How a bucket is NAMED in prose — "wk of Jul 27" versus "Jul 27".
 *
 * A weekly point stands for seven days, so its label has to say so; a daily
 * point stands for itself. Getting this wrong is how a reader ends up thinking
 * a daily chart shows weeks.
 */
export function bucketNoun(bucketStart: string, bucket: MetricsBucket): string {
	const label = formatBucketLabel(bucketStart)
	return bucket === 'week' ? `wk of ${label}` : label
}

/**
 * Whether the bucket starting `bucketStart` has fully elapsed as of `now`.
 *
 * The final bucket of any range that reaches today is in progress: its spend
 * and output are still arriving, so its ratio is a partial numerator over a
 * partial denominator and routinely swings wildly. Quoting it as complete
 * would manufacture an alarming move every Monday morning — or, at day
 * resolution, every morning.
 *
 * `offsetMinutes` (Date.prototype.getTimezoneOffset) matters: parsing the
 * client-local key as plain UTC would flip a bucket to "complete" up to the
 * offset early — a New York viewer on Sunday evening would see the
 * still-in-progress week quoted as final.
 */
export function isCompleteBucket(bucketStart: string, bucket: MetricsBucket, now: Date, offsetMinutes = 0): boolean {
	const start = bucketRealStartMs(bucketStart, offsetMinutes)
	if (start === null) return false
	return start + bucketDays(bucket) * MS_PER_DAY <= now.getTime()
}

/**
 * Fractional weeks actually elapsed inside a range — the divisor the scatter's
 * per-week rates use.
 *
 * Bounded at BOTH ends now that a range has an explicit end: a range that
 * finished last month elapsed its full width, while one running to today
 * elapsed only up to now. Dividing a completed range's output by the time
 * since its start would shrink every rate by however long ago it was viewed.
 *
 * Null when the input doesn't parse or the span is non-positive — callers fall
 * back to the nominal range width.
 */
export function elapsedWeeksInRange(from: string, to: string, now: Date, offsetMinutes = 0): number | null {
	const start = bucketRealStartMs(from, offsetMinutes)
	const end = bucketRealStartMs(to, offsetMinutes)
	if (start === null || end === null) return null
	// `to` is inclusive, so the range runs to the END of that day.
	const finish = Math.min(now.getTime(), end + MS_PER_DAY)
	const elapsed = finish - start
	return elapsed > 0 ? elapsed / MS_PER_WEEK : null
}
