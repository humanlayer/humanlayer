/**
 * The Advanced Metrics page's time selection, client side.
 *
 * The range algebra itself — alignment, snapping, presets, the coverage floor —
 * lives in the contract package so this file and the API cannot disagree about
 * what a bucket is. What lives HERE is everything the browser adds: reading a
 * range out of the URL, deciding what to do with a hand-mangled one, and
 * turning a pixel position on the brush into a day.
 */

import {
	addDays,
	bucketEndOf,
	clampRangeToCoverage,
	coverageFloor,
	daysBetween,
	defaultBucketFor,
	firstWholeBucketOn,
	historyStart,
	isAlignedRange,
	matchPreset,
	type MetricsBucket,
	METRICS_BUCKETS,
	type MetricsRange,
	presetRange,
	rangeLengthDays,
	snapRange,
	validateMetricsRange,
	type WeekPreset,
	WEEK_PRESETS,
} from '@humanlayer/riptide-api-contract/api/metrics/range'
import { format } from 'date-fns'

export type { MetricsBucket, MetricsRange, WeekPreset }
export { METRICS_BUCKETS, rangeLengthDays, WEEK_PRESETS }

/** The preset the page opens on when the URL says nothing. */
export const DEFAULT_PRESET: WeekPreset = 4

/**
 * Today in the VIEWER's calendar.
 *
 * `format(new Date(), 'yyyy-MM-dd')` and not an ISO slice: `toISOString()` is
 * UTC, so a viewer in Auckland on Monday morning would get Sunday's key and
 * every bucket on the page would be off by one for a third of their day.
 */
export function todayKey(now: Date = new Date()): string {
	return format(now, 'yyyy-MM-dd')
}

/** The URL fields the page owns, all optional so a bare link still works. */
export interface RangeSearch {
	from?: string
	to?: string
	bucket?: MetricsBucket
	/** Legacy: the 4/8/12 selector this page shipped with. Still honoured. */
	weeks?: number
}

/**
 * The range a URL asks for, or the default.
 *
 * Order matters. An explicit, aligned `from`/`to` wins. A legacy `?weeks=`
 * link resolves to exactly the range that preset always meant, so links
 * pasted into tickets before this change still open on the view they
 * described. Anything unusable falls back to the default preset rather than
 * erroring — a mangled query string should not be able to break the page.
 *
 * An explicit `from`/`to` that is NOT bucket-aligned is snapped outward rather
 * than rejected: hand-typed dates are a legitimate way to reach the page, and
 * snapping is exactly what the brush would have done with the same input.
 */
export function rangeFromSearch(search: RangeSearch, today: string = todayKey()): MetricsRange {
	const { from, to } = search
	if (from && to && daysBetween(from, to) !== null) {
		const bucket = search.bucket ?? defaultBucketFor(from, to)
		const explicit = isAlignedRange(from, to, bucket) ? { from, to, bucket } : snapRange(from, to, bucket)
		// A hand-edited or stale link can name a span wider than the API accepts.
		// Falling back beats passing it through: the contract would refuse it and
		// all seven cards would render error states over a bad URL.
		if (validateMetricsRange(explicit) === null) return explicit
	}

	const weeks = WEEK_PRESETS.find((preset) => preset === search.weeks) ?? DEFAULT_PRESET
	// Derive the bucket BEFORE building the range, because the bucket decides
	// where the range ends: a weekly range runs to the current week's Sunday,
	// a daily one stops at today. Building the preset weekly and then relabelling
	// it daily produced a daily range ending on a future Sunday — up to six
	// empty buckets at the right edge, which is exactly the fabricated trend
	// presetRange exists to prevent — and left no preset button pressed, since
	// `matchPreset` compares against a daily preset ending today.
	const bucket = search.bucket ?? defaultBucketFor(presetRange(weeks, today).from, today)
	return presetRange(weeks, today, bucket)
}

/** The URL fields for a range — `weeks` is never written back, only read. */
export function searchFromRange(range: MetricsRange): Required<Omit<RangeSearch, 'weeks'>> {
	return { from: range.from, to: range.to, bucket: range.bucket }
}

/**
 * What the range control needs to render: the selection, where its handles may
 * go, and which presets are honest right now.
 */
export interface RangeBounds {
	/** Earliest selectable day — the later of the strip's start and the coverage floor. */
	minDate: string
	/** Latest selectable day: the viewer's today. */
	maxDate: string
	/** First day attribution covers, or null when the org has no attributed output. */
	floor: string | null
	/** Presets that fit entirely inside the covered span. */
	availablePresets: WeekPreset[]
	/**
	 * True when nothing at all is selectable yet — the org opted in so recently
	 * that not one whole bucket is covered. The page shows the warm-up splash.
	 */
	empty: boolean
}

/**
 * Resolves what the brush may offer, given the strip's domain and the org's
 * attribution boundary.
 *
 * A preset is offered only when it fits entirely after the floor. A preset
 * button that silently handed back a shorter range than its label promises
 * would be worse than a disabled one — but note the SELECTION is still clamped
 * rather than refused (see `clampRangeToCoverage`): dragging to a covered
 * sub-range is always allowed, it just isn't a preset any more.
 */
export function rangeBounds(
	overview: { earliestDate: string; latestDate: string; attributionStartDate: string | null } | undefined,
	bucket: MetricsBucket,
	today: string = todayKey(),
): RangeBounds {
	// The end of the bucket containing today: the current week's Sunday when
	// weekly, today when daily. See presetRange for why the two differ.
	const maxDate = bucketEndOf(overview?.latestDate ?? today, bucket)
	const stripStart = overview?.earliestDate ?? historyStart(today)
	const floor = coverageFloor(overview?.attributionStartDate ?? null, bucket)
	// Forward to the first WHOLE bucket, not back to the containing one: snapping
	// the strip's first day back to its Monday would let a full-width weekly drag
	// start up to six days before the strip and blow past the range-length cap
	// the API enforces. See firstWholeBucketOn.
	const minDate = firstWholeBucketOn(floor && floor > stripStart ? floor : stripStart, bucket)

	const availablePresets = WEEK_PRESETS.filter((weeks) => {
		const preset = presetRange(weeks, today)
		return floor === null || preset.from >= floor
	})

	return { minDate, maxDate, floor, availablePresets, empty: minDate > maxDate }
}

/** The range to actually query: the URL's, pulled forward to the coverage floor. */
export function resolveRange(requested: MetricsRange, bounds: RangeBounds): MetricsRange | null {
	return clampRangeToCoverage(requested, bounds.floor)
}

/**
 * True when the org has never had a commit attributed, so every
 * commit-denominated card is WAITING rather than empty.
 *
 * A null `attributionStartDate` is not the same as "no restriction", which is
 * the only way `rangeBounds` can read it: with no floor to hold them, the
 * brush's handles must open onto the whole strip, and `bounds.empty` stays
 * false. So an org that has just switched tracking on — spend flowing, not one
 * attributed commit yet — sails past the warm-up and lands on a full range of
 * blank cards, each advising a different time period that cannot help. The
 * date the warm-up needs is produced by the very commit it is waiting for.
 *
 * It is a property of the ORG rather than of the selection, which is why it is
 * answered once here instead of by each card's own empty state.
 *
 * `undefined` is deliberately not pending: with the overview still loading, or
 * its query failed, the page must not claim attribution is missing on the
 * strength of an answer it never got.
 */
export function attributionPending(overview: { attributionStartDate: string | null } | undefined): boolean {
	return overview !== undefined && overview.attributionStartDate === null
}

/**
 * Which preset button is pressed, or null for a dragged selection. Bucket-aware
 * through `matchPreset`, so pressing Daily does not make every preset go dark.
 */
export function activePreset(range: MetricsRange, today: string = todayKey()): WeekPreset | null {
	return matchPreset(range, today)
}

/**
 * Human range label for captions: "Jun 29 – Aug 9 · 6 weeks".
 *
 * The length is spelled out because a brush makes range width a variable the
 * reader can no longer assume. Whole weeks are named in weeks; anything else
 * in days, since "4.3 weeks" is not a thing anyone says.
 */
export function formatRangeLength(range: MetricsRange): string {
	const days = rangeLengthDays(range)
	if (days === null) return ''
	if (days % 7 === 0) {
		const weeks = days / 7
		return `${weeks} week${weeks === 1 ? '' : 's'}`
	}
	return `${days} day${days === 1 ? '' : 's'}`
}

/**
 * Maps a fraction across the strip (0 = its first day, 1 = the day after its
 * last) to a day key — the brush's pointer maths, kept out of the component so
 * it can be tested without a DOM.
 *
 * Deliberately floors into a day rather than rounding: a pointer anywhere
 * inside a day's bar selects that day, which is what a bar looks like it
 * promises. The +1 span on the denominator is what makes the LAST day occupy a
 * full bar's width instead of a zero-width sliver at the right edge.
 */
export function dayAtFraction(fraction: number, earliest: string, latest: string): string {
	const span = daysBetween(earliest, latest)
	if (span === null) return earliest
	const total = span + 1
	const index = Math.min(total - 1, Math.max(0, Math.floor(fraction * total)))
	return addDays(earliest, index)
}

/**
 * A dragged pair of days turned into a range the page may actually request:
 * ordered, snapped to bucket edges, and clamped to what the bounds allow.
 *
 * Clamping happens BEFORE snapping so a handle dragged past the coverage floor
 * lands on the first covered bucket rather than snapping to an uncovered one
 * and then being pulled forward a second time — which would move the handle
 * two buckets from where the user dropped it.
 */
export function rangeFromDrag(
	anchorDay: string,
	dragDay: string,
	bucket: MetricsBucket,
	bounds: RangeBounds,
): MetricsRange {
	const clamp = (day: string) => (day < bounds.minDate ? bounds.minDate : day > bounds.maxDate ? bounds.maxDate : day)
	const snapped = snapRange(clamp(anchorDay), clamp(dragDay), bucket)
	// Snapping expands OUTWARD, so it can push `from` back past the bound it was
	// just clamped to. `minDate` is itself bucket-aligned (see rangeBounds), so
	// taking the later of the two keeps the range aligned as well as in bounds.
	return snapped.from < bounds.minDate ? { ...snapped, from: bounds.minDate } : snapped
}

/**
 * The same range at a different bucket size, re-snapped.
 *
 * Re-snapping is not optional. A 17-day daily selection is a perfectly legal
 * daily range and an illegal weekly one, so flipping the toggle without
 * snapping would send the API a partial weekly bucket — which it refuses, as it
 * should. Snapping outward turns those 17 days into the three whole weeks
 * containing them, which is what the brush would have produced from the same
 * drag in weekly mode.
 *
 * `bounds` must be the bounds for the TARGET bucket. They differ at both ends —
 * the coverage floor rounds to a different unit, and a weekly range may run to
 * a future Sunday while a daily one stops at today — so re-snapping against the
 * outgoing bucket`s bounds lands the handles a bucket out.
 */
export function withBucket(range: MetricsRange, bucket: MetricsBucket, bounds: RangeBounds): MetricsRange {
	return rangeFromDrag(range.from, range.to, bucket, bounds)
}
