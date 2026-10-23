/**
 * Pure logic behind the two per-person cross-tab cards: who spends on which
 * stage, and who runs which mode.
 *
 * Kept free of React so the ordering, the share arithmetic and the dust rules
 * are unit-testable — same split as spendRanking.ts, which backs the ranked
 * cards these two sit beneath.
 */

/** One (person, bucket) cell from userStageSpend / userModeSpend. */
export interface CrossTabCell {
	userId: string
	bucket: string
	costUsd: number
}

/** A bucket as the card draws it: canonical order, fixed colour. */
export interface CrossTabSeries {
	key: string
	label: string
	color: string
}

export interface CrossTabSegment {
	key: string
	label: string
	color: string
	total: number
	/** Fraction of this PERSON's spend, not of the org's. Rows sum to 1. */
	share: number
}

export interface CrossTabRow {
	userId: string
	label: string
	total: number
	segments: CrossTabSegment[]
}

export interface CrossTab {
	rows: CrossTabRow[]
	grandTotal: number
	/** Buckets that any person actually spent on, in canonical order. */
	series: CrossTabSeries[]
}

/**
 * The canonical series, plus one entry for every bucket the data carries that
 * the canonical list does not name, plus the entries that must stay last.
 *
 * Load-bearing, not defensive. {@link buildCrossTab} totals every bucket but
 * only emits segments for buckets named in `series`, so an unnamed bucket puts
 * dollars in a person's total and no rectangle in their bar. Their shares then
 * sum to less than 1, and {@link drawableSegments} re-bases what survives to
 * fill the track — quietly spreading that spend over the buckets that ARE
 * named, while the card's header total still matches the ranking above it.
 *
 * Both cards can hit it. `mostProgressedStageSql` deliberately reports a
 * legacy `rpi:*` label rather than nothing, and the API passes an unknown
 * `tasks.workflow_type` straight through. The ranked cards above build their
 * series FROM the data, so they would draw such a bucket while these two
 * dropped it — breaking the roll-up the pair exists to support.
 *
 * `observed` may repeat and may overlap `head`/`tail`; first mention wins, so
 * an unknown bucket keeps one entry and canonical order is untouched.
 */
export function seriesCovering(
	head: readonly CrossTabSeries[],
	observed: readonly CrossTabSeries[],
	tail: readonly CrossTabSeries[],
): CrossTabSeries[] {
	const named = new Set<string>([...head, ...tail].map((entry) => entry.key))
	const extra: CrossTabSeries[] = []
	for (const entry of observed) {
		if (named.has(entry.key)) continue
		named.add(entry.key)
		extra.push(entry)
	}
	return extra.length === 0 ? [...head, ...tail] : [...head, ...extra, ...tail]
}

/**
 * A segment below this fraction of a person's bar is dropped from the drawn
 * stack. At 0.5% of a ~600px bar a segment is under 3px — too small to see,
 * too small to hover, and it pushes every segment after it off its true
 * position. The dollars stay in the row total and in the tooltip; only the
 * rectangle goes.
 */
export const MIN_SEGMENT_SHARE = 0.005

/**
 * Cross-tabs sparse cells into one row per person, ordered by total spend.
 *
 * Rows are shares of the PERSON, not of the org, and that is the whole point:
 * a $681 user and a $4,834 user are only comparable once both bars are 100%
 * wide. On raw dollars the biggest spender wins every bucket by definition,
 * which answers "who spends most" — a question the ranked card above already
 * answers better.
 *
 * `nameFor` resolves a WorkOS user id to a display name and returns undefined
 * for someone who has left the org; the raw id is used rather than dropping
 * their spend, so this card's total stays equal to the ranked card's above it.
 *
 * Series order is CANONICAL (workflow progression, or mode ceremony), never
 * per-row rank: the segments have to line up between one person's bar and the
 * next, and the colours have to match the ranked card above.
 */
export function buildCrossTab(
	cells: readonly CrossTabCell[],
	series: readonly CrossTabSeries[],
	nameFor: (userId: string) => string | undefined,
): CrossTab {
	const byUser = new Map<string, Map<string, number>>()
	for (const cell of cells) {
		// Non-finite guard, not just a type guard: a NaN reaching the width
		// calculation poisons every segment after it in the flex row.
		const value = Number.isFinite(cell.costUsd) ? cell.costUsd : 0
		if (value <= 0) continue
		let row = byUser.get(cell.userId)
		if (!row) {
			row = new Map()
			byUser.set(cell.userId, row)
		}
		row.set(cell.bucket, (row.get(cell.bucket) ?? 0) + value)
	}

	const totals = new Map<string, number>()
	for (const [userId, row] of byUser) {
		let total = 0
		for (const value of row.values()) total += value
		totals.set(userId, total)
	}

	const ordered = Array.from(totals.entries())
		// Tie-break on the ID, not the display name: two people can share a
		// name, and two departed members both fall back to an id. A name
		// tie-break would let their rows swap between refetches of identical
		// data.
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.filter(([, total]) => total > 0)

	const rows: CrossTabRow[] = ordered.map(([userId, total]) => {
		// `?? new Map()` rather than a non-null assertion: `ordered` is derived
		// from `byUser`, so the lookup cannot miss, but an assertion would hide
		// it if that ever stopped being true.
		const cellsFor = byUser.get(userId) ?? new Map<string, number>()
		const segments = series
			.map((entry) => {
				const value = cellsFor.get(entry.key) ?? 0
				return { ...entry, total: value, share: total > 0 ? value / total : 0 }
			})
			.filter((segment) => segment.total > 0)
		return { userId, label: nameFor(userId) ?? userId, total, segments }
	})

	// Only buckets somebody spent on. An all-zero series would sit in the
	// legend claiming a colour nothing on screen uses.
	const used = new Set<string>()
	for (const row of rows) for (const segment of row.segments) used.add(segment.key)

	return {
		rows,
		grandTotal: rows.reduce((sum, row) => sum + row.total, 0),
		series: series.filter((entry) => used.has(entry.key)),
	}
}

/**
 * The segments a bar actually draws, dropping slivers below
 * {@link MIN_SEGMENT_SHARE}. Widths are re-based on what survives, so the bar
 * still fills its track exactly rather than ending a hair short.
 */
export function drawableSegments(row: CrossTabRow): CrossTabSegment[] {
	const kept = row.segments.filter((segment) => segment.share >= MIN_SEGMENT_SHARE)
	// Everything was dust (a person whose whole spend is spread over a dozen
	// slivers): draw the largest one full width rather than an empty track.
	if (kept.length === 0) {
		const largest = row.segments.reduce<CrossTabSegment | null>(
			(best, segment) => (best === null || segment.total > best.total ? segment : best),
			null,
		)
		return largest ? [{ ...largest, share: 1 }] : []
	}
	const keptTotal = kept.reduce((sum, segment) => sum + segment.total, 0)
	return kept.map((segment) => ({
		...segment,
		share: keptTotal > 0 ? segment.total / keptTotal : 0,
	}))
}

/** `44.8%`, with a floor so real-but-tiny spend never prints as a flat zero. */
export function formatSegmentShare(share: number): string {
	const percent = share * 100
	if (percent > 0 && percent < 0.05) return '<0.1%'
	return `${percent.toFixed(1)}%`
}
