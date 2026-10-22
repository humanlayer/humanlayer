/**
 * THE range vocabulary for Advanced Metrics — the one place the page's time
 * selection is defined, for both sides of the wire.
 *
 * The page used to take `weeks: 4 | 8 | 12` and derive a Monday-anchored
 * window server-side. It now takes an explicit, inclusive, **bucket-aligned**
 * day range plus the bucket size:
 *
 *     { from: '2026-06-29', to: '2026-08-09', bucket: 'week' }
 *
 * The alignment invariant is the whole design. Every correctness property the
 * old anchored window had came from "every bucket except the current one is a
 * complete calendar week"; an arbitrary date range would have reintroduced
 * partial buckets, which a stacked area renders as a rise from zero and a
 * cliff back to it. Instead of forbidding arbitrary ranges, the range is
 * required to land on bucket edges, and the UI's brush handles snap to the
 * SAME unit the bucket uses. A partial bucket then cannot be expressed:
 *
 *   bucket 'week' → `from` is a Monday and `to` is a Sunday.
 *   bucket 'day'  → any `from` <= `to` (a day is already a whole day).
 *
 * Because the unit the user drags and the unit the chart buckets are the same
 * thing, the guarantee holds by construction rather than by convention, and
 * {@link validateMetricsRange} enforces it server-side so a hand-built request
 * cannot smuggle a partial bucket past the client.
 *
 * ## Day keys
 *
 * A day key is 'YYYY-MM-DD' in the CLIENT's local calendar. It is deliberately
 * a string and not a Date: all arithmetic here is naive-UTC epoch math on the
 * key, so it is timezone-independent — 'is this a Monday' has the same answer
 * everywhere. The client's real offset enters only where a key must become an
 * instant (the SQL bounds), which is the API's job, not this module's.
 */

import z from 'zod/v4'

export const METRICS_BUCKETS = ['week', 'day'] as const
export type MetricsBucket = (typeof METRICS_BUCKETS)[number]

/** An inclusive, bucket-aligned day range. The page's entire time selection. */
export interface MetricsRange {
	/** First day of the first bucket, 'YYYY-MM-DD'. */
	from: string
	/** Last day of the last bucket, 'YYYY-MM-DD'. */
	to: string
	bucket: MetricsBucket
}

const DAY_MS = 86_400_000
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * How far back the brush's strip reaches, and therefore the widest range that
 * can be selected. 26 weeks: twice the old widest preset, so the 12-week view
 * has somewhere to be dragged FROM, while still bounding the strip query and
 * capping a daily response at 182 buckets.
 */
export const RANGE_HISTORY_DAYS = 182

/**
 * Ranges the preset buttons produce, in weeks. Unchanged from the old
 * `WEEK_RANGES` — presets are now just shortcuts that set the handles, so a
 * pre-existing `?weeks=8` link still lands on exactly the range it used to.
 */
export const WEEK_PRESETS = [4, 8, 12] as const
export type WeekPreset = (typeof WEEK_PRESETS)[number]

/**
 * At or below this width a daily bucket is the better default; above it,
 * weekly. Six weeks — the point where a daily series stops being readable at
 * chart width and starts being a texture. The user can always override; this
 * only decides what the page opens on when the range changes.
 */
export const DAILY_BUCKET_MAX_DAYS = 42

/**
 * Buckets of lead-in a daily ratio series needs before the range it plots.
 *
 * A daily unit-cost ratio is a **7-day trailing** ratio (see the UI's
 * trailingRatio module for why a same-day ratio is not a number anyone should
 * read). The first plotted day therefore needs the six days before it, which
 * are outside the selection. The API reads them and marks them `inRange:
 * false` rather than the client widening its request, so the range the user
 * picked and the range the response describes stay reconcilable inside one
 * payload.
 */
export const TRAILING_LEAD_IN_DAYS = 6

/* ────────────────────────────── day-key math ────────────────────────────── */

/** A day key's naive-UTC epoch ms, or null when it does not parse. */
export function parseDayKey(key: string): number | null {
	const match = DAY_KEY_PATTERN.exec(key)
	if (!match) return null
	const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
	// Round-trip guards against valid-looking impossible dates ('2026-02-30',
	// which Date.UTC silently rolls forward into March).
	return formatDayKey(ms) === key ? ms : null
}

/** Naive-UTC epoch ms → 'YYYY-MM-DD'. */
export function formatDayKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10)
}

/** `key` shifted by `days` (may be negative). Returns key unchanged if unparseable. */
export function addDays(key: string, days: number): string {
	const ms = parseDayKey(key)
	return ms === null ? key : formatDayKey(ms + days * DAY_MS)
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. Null if either is unparseable. */
export function daysBetween(from: string, to: string): number | null {
	const a = parseDayKey(from)
	const b = parseDayKey(to)
	return a === null || b === null ? null : Math.round((b - a) / DAY_MS)
}

/** Inclusive day count of a range — what a user calls "28 days". */
export function rangeLengthDays(range: Pick<MetricsRange, 'from' | 'to'>): number | null {
	const span = daysBetween(range.from, range.to)
	return span === null ? null : span + 1
}

/** 0 = Monday … 6 = Sunday. ISO order, so `dayOfWeek(k) === 0` IS "is a Monday". */
export function dayOfWeek(key: string): number | null {
	const ms = parseDayKey(key)
	if (ms === null) return null
	// getUTCDay is 0 = Sunday; rotate so Monday leads.
	return (new Date(ms).getUTCDay() + 6) % 7
}

/** The Monday of the ISO week containing `key`. */
export function mondayOf(key: string): string {
	const dow = dayOfWeek(key)
	return dow === null ? key : addDays(key, -dow)
}

/** The Sunday of the ISO week containing `key`. */
export function sundayOf(key: string): string {
	const dow = dayOfWeek(key)
	return dow === null ? key : addDays(key, 6 - dow)
}

/* ────────────────────────────── bucket ops ────────────────────────────── */

/** The bucket `key` falls in, identified by its first day — the bucket KEY. */
export function bucketStartOf(key: string, bucket: MetricsBucket): string {
	return bucket === 'week' ? mondayOf(key) : key
}

/** The last day of the bucket `key` falls in. */
export function bucketEndOf(key: string, bucket: MetricsBucket): string {
	return bucket === 'week' ? sundayOf(key) : key
}

/**
 * Every bucket key in `[from, to]`, ascending and dense — the spine handlers
 * zero-fill against and charts plot along. Empty when the range is inverted or
 * unparseable, which callers treat as "no data" rather than crashing.
 */
export function enumerateBuckets(from: string, to: string, bucket: MetricsBucket): string[] {
	const start = parseDayKey(bucketStartOf(from, bucket))
	const end = parseDayKey(to)
	if (start === null || end === null || end < start) return []
	const step = bucket === 'week' ? 7 : 1
	const keys: string[] = []
	for (let ms = start; ms <= end; ms += step * DAY_MS) keys.push(formatDayKey(ms))
	return keys
}

/**
 * Whether a range lands exactly on bucket edges — the invariant the whole
 * design rests on. Weekly: Monday to Sunday. Daily: any ordered pair.
 */
export function isAlignedRange(from: string, to: string, bucket: MetricsBucket): boolean {
	const span = daysBetween(from, to)
	if (span === null || span < 0) return false
	if (bucket === 'day') return true
	return dayOfWeek(from) === 0 && dayOfWeek(to) === 6
}

/**
 * Snaps an arbitrary pair of days outward to bucket edges — what a brush
 * handle does on drop.
 *
 * Outward, not inward, on purpose: expanding never silently drops data the
 * user just dragged over, and a half-week drag in weekly mode yields a whole
 * week rather than an empty range. It also makes snapping idempotent, so a
 * range that survives one round trip survives every later one.
 */
export function snapRange(from: string, to: string, bucket: MetricsBucket): MetricsRange {
	const ordered = daysBetween(from, to)
	const [lo, hi] = ordered !== null && ordered < 0 ? [to, from] : [from, to]
	return { from: bucketStartOf(lo, bucket), to: bucketEndOf(hi, bucket), bucket }
}

/**
 * The range a preset button produces: the `weeks - 1` complete weeks before the
 * current one, plus however much of the current one has happened.
 *
 * `from` is byte-for-byte the Monday `calculateAnchoredWeekRange` used to
 * derive server-side, so a preset is now just a pair of handle positions and
 * nothing about the default weekly view moved.
 *
 * `to` is THE END OF THE BUCKET CONTAINING TODAY, which is where the two
 * bucket sizes legitimately differ:
 *
 *   week → the current week's Sunday, in the future. The current week IS the
 *          last bucket, and clamping to today would express a partial final
 *          week — exactly what the alignment invariant makes unrepresentable.
 *          Rows simply do not exist for the future part, and one in-progress
 *          bucket is a state the page already labels and explains.
 *   day  → today. Every future day would be a whole, empty bucket, and a run
 *          of zero bars at the right edge of a daily chart reads as a spending
 *          collapse. A partial week is a disclosed reading; six empty days are
 *          a fabricated trend.
 *
 * So "8 weeks" is 56 days weekly and 54 days daily on a Thursday. That is not a
 * discrepancy to hide — it is the difference between "the last eight weeks" and
 * "the last eight weeks so far", and the caption says which.
 */
export function presetRange(weeks: number, todayKey: string, bucket: MetricsBucket = 'week'): MetricsRange {
	const monday = mondayOf(todayKey)
	return { from: addDays(monday, -(weeks - 1) * 7), to: bucketEndOf(todayKey, bucket), bucket }
}

/**
 * Which preset a range corresponds to, or null when it is a custom selection.
 * Drives the pressed state of the preset buttons — a range dragged to exactly
 * eight weeks should light up "8 weeks", not read as custom.
 *
 * Bucket-aware because presets are: a daily "8 weeks" ends today while a weekly
 * one ends on Sunday, and comparing a daily range against the weekly preset
 * would make the button go dark the moment anyone pressed Daily.
 */
export function matchPreset(range: MetricsRange, todayKey: string): WeekPreset | null {
	for (const weeks of WEEK_PRESETS) {
		const preset = presetRange(weeks, todayKey, range.bucket)
		if (preset.from === range.from && preset.to === range.to) return weeks
	}
	return null
}

/**
 * The bucket a range of this width should open on. Width, not user memory,
 * decides — the toggle exists to override this, not to be the only way to get
 * a sane default after dragging from twelve weeks down to nine days.
 */
export function defaultBucketFor(from: string, to: string): MetricsBucket {
	const length = rangeLengthDays({ from, to })
	return length !== null && length <= DAILY_BUCKET_MAX_DAYS ? 'day' : 'week'
}

/**
 * The earliest day the brush may reach: `RANGE_HISTORY_DAYS` back from today.
 * NOT snapped to a bucket — callers that need a whole leading bucket run this
 * through {@link firstWholeBucketOn}, which is also what keeps a full-width
 * weekly drag inside the range-length cap.
 */
export function historyStart(todayKey: string): string {
	return addDays(todayKey, -(RANGE_HISTORY_DAYS - 1))
}

/**
 * The first WHOLE bucket that begins on or after `day`.
 *
 * `bucketStartOf` snaps backwards, which is right for "which bucket is this day
 * in" and wrong for "where may the leftmost handle go": snapping the strip's
 * first day back to its Monday reaches up to six days before the strip, past
 * the data and past the range-length cap. This snaps the other way, so the
 * leftmost selectable bucket is one the strip actually covers.
 *
 * With this bound in place a full-width weekly drag is exactly
 * {@link RANGE_HISTORY_DAYS} days on every weekday — the constant is 26 whole
 * weeks precisely so the widest draggable range lands on the cap rather than
 * one bucket past it.
 */
export function firstWholeBucketOn(day: string, bucket: MetricsBucket): string {
	// Only weeks can land mid-bucket; `bucketStartOf(day, 'day')` is the identity,
	// so the daily case always returns on the first line.
	const start = bucketStartOf(day, bucket)
	return start >= day ? start : addDays(start, 7)
}

/**
 * The earliest bucket a range may START on, given when attribution began.
 *
 * Spend is recorded for every org from the beginning; commit and PR
 * attribution only starts when an org opts in. A range reaching back past that
 * day therefore divides a whole numerator by a fraction of the denominator —
 * a unit cost that reads far too high for reasons that have nothing to do with
 * efficiency.
 *
 * The bound is STRICT: collection began partway through `attributionStartDate`
 * itself, so that day is partly uncovered and a range may not start on it. For
 * a weekly bucket that means the Monday AFTER the opt-in week, since a range
 * starting on the opt-in week's own Monday would include days before the
 * boundary.
 *
 * Returns null when the org has no attributed output at all — there is no
 * floor because there is no coverage.
 */
export function coverageFloor(attributionStartDate: string | null, bucket: MetricsBucket): string | null {
	if (attributionStartDate === null) return null
	return bucket === 'week' ? addDays(mondayOf(attributionStartDate), 7) : addDays(attributionStartDate, 1)
}

/**
 * Pulls a range forward so it starts no earlier than `floor`, keeping its end
 * and its alignment.
 *
 * Clamping rather than refusing is the point. The previous design offered only
 * the presets attribution could fill end to end and withheld the whole page
 * until one fitted — a newly opted-in org saw "the 4-week view unlocks on
 * August 24th" and nothing else. A brush has no such all-or-nothing choice to
 * make: it can simply show the covered part, which is a real, honest,
 * fully-aligned range on day one.
 *
 * Returns null when the floor is past the range's end — then there genuinely
 * is nothing to show yet.
 */
export function clampRangeToCoverage(range: MetricsRange, floor: string | null): MetricsRange | null {
	if (floor === null) return range
	if (range.from >= floor) return range
	const from = bucketStartOf(floor, range.bucket)
	// A weekly floor is already a Monday, so bucketStartOf is a no-op there; the
	// guard is for a caller passing an arbitrary day as the floor.
	if (daysBetween(from, range.to) === null || from > range.to) return null
	return { ...range, from }
}

/* ────────────────────────────── validation ────────────────────────────── */

export type MetricsRangeProblem = 'unparseable' | 'inverted' | 'unaligned' | 'too-long'

/** The first thing wrong with a range, or null when it is usable. */
export function validateMetricsRange(range: MetricsRange): MetricsRangeProblem | null {
	if (parseDayKey(range.from) === null || parseDayKey(range.to) === null) return 'unparseable'
	const length = rangeLengthDays(range)
	if (length === null || length < 1) return 'inverted'
	if (!isAlignedRange(range.from, range.to, range.bucket)) return 'unaligned'
	if (length > RANGE_HISTORY_DAYS) return 'too-long'
	return null
}

const PROBLEM_MESSAGES: Record<MetricsRangeProblem, string> = {
	unparseable: 'from and to must be YYYY-MM-DD calendar dates',
	inverted: 'to must be on or after from',
	unaligned: "a 'week' range must run from a Monday to a Sunday, so no bucket is partial",
	'too-long': `a range may span at most ${RANGE_HISTORY_DAYS} days`,
}

const DayKeySchema = z.string().regex(DAY_KEY_PATTERN, 'expected a YYYY-MM-DD date')

/**
 * The fields every Advanced Metrics endpoint takes. Exported as a raw shape
 * rather than a schema so each contract can compose its own extras into ONE
 * object and still receive the shared refinement from
 * {@link metricsRangeInput} — a refined schema cannot be `.extend()`ed, and
 * having each contract re-declare these four fields is how the previous
 * generation ended up with an inverted `timezoneOffset` bound copied into
 * thirteen files.
 */
/**
 * `Date.prototype.getTimezoneOffset()` — POSITIVE WEST of UTC, so the bounds are
 * -840 (UTC+14) to 720 (UTC-12) and not the inverse, which rejected every client
 * east of UTC+12. Exported on its own so the range-INDEPENDENT metrics contracts
 * can compose it instead of re-declaring the bound; see the note below.
 */
export const timezoneOffsetSchema = z.number().int().min(-840).max(720).default(0)

export const metricsRangeShape = {
	/** First day of the range, inclusive. Must be a bucket start. */
	from: DayKeySchema,
	/** Last day of the range, inclusive. Must be a bucket end. */
	to: DayKeySchema,
	bucket: z.enum(METRICS_BUCKETS).default('week'),
	timezoneOffset: timezoneOffsetSchema,
} as const

/**
 * Builds a metrics input schema: the shared range fields, any endpoint-specific
 * extras, and the alignment/length refinement that makes the partial-bucket
 * guarantee a property of the API rather than a habit of the client.
 */
export function metricsRangeInput<Extra extends z.ZodRawShape = Record<never, never>>(extra?: Extra) {
	const rangeSchema = z.object(metricsRangeShape)
	const inputSchema = z.object({ ...metricsRangeShape, ...((extra ?? {}) as Extra) })
	return inputSchema.superRefine((value, ctx) => {
		const range = rangeSchema.safeParse(value)
		if (!range.success) return
		const problem = validateMetricsRange(range.data)
		if (problem) ctx.addIssue({ code: 'custom', message: PROBLEM_MESSAGES[problem], path: ['to'] })
	})
}

/** The parsed shape every metrics handler receives. */
export interface MetricsRangeInput extends MetricsRange {
	timezoneOffset: number
}
