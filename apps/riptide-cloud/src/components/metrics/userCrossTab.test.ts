import { describe, expect, it } from 'vitest'

import {
	buildCrossTab,
	type CrossTabCell,
	type CrossTabSeries,
	drawableSegments,
	formatSegmentShare,
	MIN_SEGMENT_SHARE,
	seriesCovering,
} from './userCrossTab'

/** Canonical order, deliberately NOT the order the data arrives in. */
const SERIES: CrossTabSeries[] = [
	{ key: 'research', label: 'research', color: 'var(--chart-1)' },
	{ key: 'implementation', label: 'implementation', color: 'var(--chart-2)' },
	{ key: 'ad_hoc', label: 'ad-hoc', color: 'var(--color-muted-foreground)' },
]

const NAMES: Record<string, string> = { user_a: 'Ada Lovelace', user_b: 'Grace Hopper' }
const nameFor = (userId: string) => NAMES[userId]

/** Ada spends $100 (mostly implementation), Grace $50 (all ad-hoc). */
const cells: CrossTabCell[] = [
	{ userId: 'user_a', bucket: 'research', costUsd: 20 },
	{ userId: 'user_a', bucket: 'implementation', costUsd: 80 },
	{ userId: 'user_b', bucket: 'ad_hoc', costUsd: 50 },
]

describe('buildCrossTab', () => {
	it('orders rows by total spend, largest first', () => {
		const tab = buildCrossTab(cells, SERIES, nameFor)
		expect(tab.rows.map((row) => row.label)).toEqual(['Ada Lovelace', 'Grace Hopper'])
		expect(tab.rows.map((row) => row.total)).toEqual([100, 50])
		expect(tab.grandTotal).toBe(150)
	})

	it('takes shares against the PERSON, so every row sums to one', () => {
		// The whole reason the card exists: a $50 person and a $100 person are
		// only comparable once both bars are full width.
		const tab = buildCrossTab(cells, SERIES, nameFor)
		for (const row of tab.rows) {
			expect(row.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1)
		}
		expect(tab.rows[0]?.segments.find((s) => s.key === 'implementation')?.share).toBeCloseTo(0.8)
		expect(tab.rows[1]?.segments.find((s) => s.key === 'ad_hoc')?.share).toBe(1)
	})

	it('keeps segments in canonical order, not in per-row rank order', () => {
		// Bands have to line up between one person's bar and the next, so a
		// row's biggest segment must NOT be hoisted to the front.
		const tab = buildCrossTab(cells, SERIES, nameFor)
		expect(tab.rows[0]?.segments.map((s) => s.key)).toEqual(['research', 'implementation'])
	})

	it('breaks ties on the user id, not the display name', () => {
		const tied: CrossTabCell[] = [
			{ userId: 'user_z', bucket: 'research', costUsd: 7 },
			{ userId: 'user_a', bucket: 'research', costUsd: 7 },
		]
		const tab = buildCrossTab(tied, SERIES, () => 'Alex Kim')
		expect(tab.rows.map((row) => row.userId)).toEqual(['user_a', 'user_z'])
	})

	it('falls back to the raw id for someone who has left the org', () => {
		// Dropping them would make this card's total disagree with the ranking
		// above it, which still counts their spend.
		const tab = buildCrossTab(
			[...cells, { userId: 'user_gone', bucket: 'research', costUsd: 500 }],
			SERIES,
			nameFor,
		)
		expect(tab.rows[0]?.label).toBe('user_gone')
		expect(tab.grandTotal).toBe(650)
	})

	it('reports only the buckets somebody actually spent on', () => {
		// An all-zero series would sit in the legend claiming a colour that
		// appears nowhere on screen.
		const tab = buildCrossTab(cells, SERIES, nameFor)
		expect(tab.series.map((entry) => entry.key)).toEqual(['research', 'implementation', 'ad_hoc'])

		const narrow = buildCrossTab([{ userId: 'user_a', bucket: 'research', costUsd: 5 }], SERIES, nameFor)
		expect(narrow.series.map((entry) => entry.key)).toEqual(['research'])
	})

	it('scrubs non-finite and non-positive costs', () => {
		const poisoned: CrossTabCell[] = [
			{ userId: 'user_a', bucket: 'research', costUsd: Number.NaN },
			{ userId: 'user_a', bucket: 'implementation', costUsd: 10 },
			{ userId: 'user_a', bucket: 'ad_hoc', costUsd: -5 },
		]
		const tab = buildCrossTab(poisoned, SERIES, nameFor)
		expect(tab.rows[0]?.total).toBe(10)
		expect(tab.rows[0]?.segments.map((s) => s.key)).toEqual(['implementation'])
	})

	it('drops a person with no spend rather than drawing an empty bar', () => {
		const tab = buildCrossTab([{ userId: 'user_a', bucket: 'research', costUsd: 0 }], SERIES, nameFor)
		expect(tab.rows).toEqual([])
		expect(tab.grandTotal).toBe(0)
	})

	it('survives an empty window', () => {
		const tab = buildCrossTab([], SERIES, nameFor)
		expect(tab.rows).toEqual([])
		expect(tab.series).toEqual([])
	})
})

describe('seriesCovering', () => {
	const head: CrossTabSeries[] = [
		{ key: 'research', label: 'research', color: 'var(--chart-1)' },
		{ key: 'implementation', label: 'implementation', color: 'var(--chart-2)' },
	]
	const tail: CrossTabSeries[] = [{ key: 'ad_hoc', label: 'ad-hoc', color: 'var(--color-muted-foreground)' }]

	it('leaves the canonical series alone when the data introduces nothing new', () => {
		const observed = [head[0]!, tail[0]!, head[0]!]
		expect(seriesCovering(head, observed, tail).map((entry) => entry.key)).toEqual([
			'research',
			'implementation',
			'ad_hoc',
		])
	})

	it('appends an unknown bucket before the tail, once, keeping canonical order', () => {
		const legacy: CrossTabSeries = { key: 'stage_x_rpi_legacy', label: 'legacy', color: 'var(--muted)' }
		const covered = seriesCovering(head, [legacy, tail[0]!, legacy], tail)
		expect(covered.map((entry) => entry.key)).toEqual([
			'research',
			'implementation',
			'stage_x_rpi_legacy',
			'ad_hoc',
		])
	})

	it("keeps an unknown bucket's dollars in its own segment instead of re-basing them away", () => {
		// The regression this exists for: without covering, the legacy bucket
		// lands in row.total with no segment, so shares sum to 0.8 and
		// drawableSegments stretches the other two over the whole track.
		const withLegacy: CrossTabCell[] = [
			{ userId: 'user_a', bucket: 'research', costUsd: 20 },
			{ userId: 'user_a', bucket: 'implementation', costUsd: 60 },
			{ userId: 'user_a', bucket: 'stage_x_rpi_legacy', costUsd: 20 },
		]
		const legacy: CrossTabSeries = { key: 'stage_x_rpi_legacy', label: 'legacy', color: 'var(--muted)' }

		const uncovered = buildCrossTab(withLegacy, [...head, ...tail], nameFor)
		const uncoveredRow = uncovered.rows[0]!
		expect(uncoveredRow.total).toBe(100)
		expect(uncoveredRow.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(0.8)

		const covered = buildCrossTab(withLegacy, seriesCovering(head, [legacy], tail), nameFor)
		const coveredRow = covered.rows[0]!
		expect(coveredRow.total).toBe(100)
		expect(coveredRow.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1)
		expect(coveredRow.segments.find((segment) => segment.key === 'stage_x_rpi_legacy')?.total).toBe(20)
	})
})

describe('drawableSegments', () => {
	it('drops slivers below the floor and re-bases the rest to fill the bar', () => {
		const tab = buildCrossTab(
			[
				{ userId: 'user_a', bucket: 'research', costUsd: 999 },
				// 0.1% — under 3px on a 600px bar, and it would shift every
				// segment after it off its true position.
				{ userId: 'user_a', bucket: 'implementation', costUsd: 1 },
			],
			SERIES,
			nameFor,
		)
		const drawn = drawableSegments(tab.rows[0]!)
		expect(drawn.map((s) => s.key)).toEqual(['research'])
		expect(drawn[0]?.share).toBe(1)
	})

	it('keeps a segment exactly on the floor', () => {
		const tab = buildCrossTab(
			[
				{ userId: 'user_a', bucket: 'research', costUsd: 100 * (1 - MIN_SEGMENT_SHARE) },
				{ userId: 'user_a', bucket: 'implementation', costUsd: 100 * MIN_SEGMENT_SHARE },
			],
			SERIES,
			nameFor,
		)
		expect(drawableSegments(tab.rows[0]!).map((s) => s.key)).toEqual(['research', 'implementation'])
	})

	it('draws the largest segment full width when every one is dust', () => {
		// A person whose spend is spread over so many buckets that none clears
		// the floor still gets a bar, not an empty track.
		const many: CrossTabSeries[] = Array.from({ length: 300 }, (_, i) => ({
			key: `b${i}`,
			label: `b${i}`,
			color: 'var(--chart-1)',
		}))
		const cellsFor: CrossTabCell[] = many.map((entry, i) => ({
			userId: 'user_a',
			bucket: entry.key,
			costUsd: i === 0 ? 2 : 1,
		}))
		const tab = buildCrossTab(cellsFor, many, nameFor)
		const drawn = drawableSegments(tab.rows[0]!)
		expect(drawn).toHaveLength(1)
		expect(drawn[0]?.key).toBe('b0')
		expect(drawn[0]?.share).toBe(1)
	})

	it('leaves a single-segment bar alone', () => {
		const tab = buildCrossTab([{ userId: 'user_b', bucket: 'ad_hoc', costUsd: 50 }], SERIES, nameFor)
		expect(drawableSegments(tab.rows[0]!).map((s) => s.share)).toEqual([1])
	})
})

describe('formatSegmentShare', () => {
	it('renders one decimal', () => {
		expect(formatSegmentShare(0.448)).toBe('44.8%')
		expect(formatSegmentShare(1)).toBe('100.0%')
	})

	it('renders real-but-tiny spend as <0.1% rather than a flat zero', () => {
		expect(formatSegmentShare(0.0002)).toBe('<0.1%')
	})

	it('renders a true zero as zero', () => {
		expect(formatSegmentShare(0)).toBe('0.0%')
	})
})
