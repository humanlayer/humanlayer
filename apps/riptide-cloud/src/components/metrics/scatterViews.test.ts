import { describe, expect, it } from 'vitest'

import {
	ceilToTwoSig,
	domainFor,
	easeInOutCubic,
	linearFit,
	projectPoints,
	mixPoints,
	OUTLIER_MIN_POINTS,
	perWeek,
	splitYOutliers,
} from './scatterViews'

describe('perWeek', () => {
	it('is the identity over a 1-week window', () => {
		expect(perWeek(3, 1)).toBe(3)
	})

	it('normalizes a 4-week count to a weekly rate', () => {
		expect(perWeek(12, 4)).toBe(3)
	})

	it('makes the same cadence read identically across windows', () => {
		// 2/week of work observed through each window.
		expect(perWeek(8, 4)).toBeCloseTo(perWeek(24, 12))
	})
})

describe('easeInOutCubic', () => {
	it('starts at 0, ends at 1, and is symmetric around the midpoint', () => {
		expect(easeInOutCubic(0)).toBe(0)
		expect(easeInOutCubic(1)).toBe(1)
		expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
		expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1)
	})
})

describe('mixPoints', () => {
	const from = [{ id: 'a', x: 100, y: 0 }]
	const to = [
		{ id: 'a', x: 100, y: 10 },
		{ id: 'b', x: 50, y: 4 },
	]

	it('slides a matched point toward its target by the eased fraction', () => {
		const frame = mixPoints(from, to, 0.5)
		expect(frame[0]).toMatchObject({ id: 'a', x: 100, y: 5 })
	})

	it('places entering points (no previous position) at their target immediately', () => {
		const frame = mixPoints(from, to, 0.1)
		expect(frame[1]).toMatchObject({ id: 'b', x: 50, y: 4 })
	})

	it('lands exactly on the target at eased = 1', () => {
		expect(mixPoints(from, to, 1)[0]?.y).toBe(10)
	})
})

describe('projectPoints', () => {
	it('preserves each point’s visual position across domains', () => {
		// 30% up a [0, 100] axis lands 30% up a [0, 20] axis.
		const projected = projectPoints([{ y: 30 }], [0, 100], [0, 20])
		expect(projected[0]?.y).toBeCloseTo(6)
	})

	it('handles signed source domains', () => {
		// Midpoint of [-100, 100] is the midpoint of [0, 20].
		const projected = projectPoints([{ y: 0 }], [-100, 100], [0, 20])
		expect(projected[0]?.y).toBeCloseTo(10)
	})

	it('passes points through unchanged when either span is degenerate', () => {
		expect(projectPoints([{ y: 5 }], [0, 0], [0, 20])[0]?.y).toBe(5)
	})
})

describe('linearFit', () => {
	it('recovers an exact line', () => {
		const fit = linearFit([
			{ x: 0, y: 1 },
			{ x: 1, y: 3 },
			{ x: 2, y: 5 },
		])
		expect(fit?.slope).toBeCloseTo(2)
		expect(fit?.intercept).toBeCloseTo(1)
	})

	it('fits least squares through noisy points', () => {
		// Symmetric residuals around y = x: slope 1, intercept 0.
		const fit = linearFit([
			{ x: 0, y: 1 },
			{ x: 0, y: -1 },
			{ x: 10, y: 11 },
			{ x: 10, y: 9 },
		])
		expect(fit?.slope).toBeCloseTo(1)
		expect(fit?.intercept).toBeCloseTo(0)
	})

	it('returns null below two points or when every x is identical', () => {
		expect(linearFit([{ x: 1, y: 1 }])).toBeNull()
		expect(
			linearFit([
				{ x: 5, y: 1 },
				{ x: 5, y: 9 },
			]),
		).toBeNull()
	})
})

describe('ceilToTwoSig', () => {
	it('rounds up to two significant figures', () => {
		expect(ceilToTwoSig(31_456)).toBe(32_000)
		expect(ceilToTwoSig(8_400)).toBe(8_400)
		expect(ceilToTwoSig(7)).toBe(7)
		expect(ceilToTwoSig(0.84)).toBe(0.84)
	})
})

describe('domainFor', () => {
	it('anchors positive-only data at 0', () => {
		expect(domainFor([{ y: 120 }, { y: 8_350 }])).toEqual([0, 8_400])
	})

	it('extends below 0 for signed data', () => {
		expect(domainFor([{ y: -5_200 }, { y: 30_500 }])).toEqual([-5_200, 31_000])
	})

	it('keeps 0 as the ceiling for negative-only data', () => {
		expect(domainFor([{ y: -300 }, { y: -4_120 }])).toEqual([-4_200, 0])
	})

	it('falls back to [0, 1] for all-zero input', () => {
		expect(domainFor([{ y: 0 }, { y: 0 }])).toEqual([0, 1])
		expect(domainFor([])).toEqual([0, 1])
	})
})

// A tight cluster of ordinary users; outlier candidates get appended per test.
const cluster = Array.from({ length: OUTLIER_MIN_POINTS - 1 }, (_, i) => ({ y: 1_000 + i * 500, id: `u${i}` }))

describe('splitYOutliers', () => {
	it('keeps everything visible below the minimum point count', () => {
		const points = [...cluster.slice(0, OUTLIER_MIN_POINTS - 2), { y: 500_000, id: 'wild' }]
		const split = splitYOutliers(points)
		expect(split.outliers).toEqual([])
		expect(split.visible).toHaveLength(points.length)
		// Domain stretches to the wild point — no clamp means no hiding.
		expect(split.domain[1]).toBe(500_000)
	})

	it('splits a far-out high outlier and clamps the domain to the mass', () => {
		const points = [...cluster, { y: 500_000, id: 'wild' }]
		const split = splitYOutliers(points)
		expect(split.outliers.map((point) => point.id)).toEqual(['wild'])
		expect(split.outliers[0]?.edge).toBe('top')
		expect(split.visible).toHaveLength(cluster.length)
		// Domain covers only the visible cluster (max 6,000), not the outlier.
		expect(split.domain).toEqual([0, 6_000])
	})

	it('splits a far-out negative outlier and keeps the domain signed', () => {
		const points = [...cluster, { y: -80_000, id: 'deleter' }]
		const split = splitYOutliers(points)
		expect(split.outliers.map((point) => point.id)).toEqual(['deleter'])
		expect(split.outliers[0]?.edge).toBe('bottom')
		expect(split.domain[0]).toBe(0)
	})

	it('tags the fence side even when the outlier sits INSIDE the rounded domain', () => {
		// Six at 10, six at 10.2, one at 10.9: the far-out fence lands at ~10.8
		// but ceilToTwoSig rounds the visible max up to 11 — so 10.9 is an
		// outlier BELOW the domain top. Inferring the edge from the domain
		// would pin the dataset's largest value at the bottom of the chart.
		const points = [
			...Array.from({ length: 6 }, (_, i) => ({ y: 10, id: `a${i}` })),
			...Array.from({ length: 6 }, (_, i) => ({ y: 10.2, id: `b${i}` })),
			{ y: 10.9, id: 'high' },
		]
		const split = splitYOutliers(points)
		expect(split.outliers.map((point) => point.id)).toEqual(['high'])
		expect(split.outliers[0]?.edge).toBe('top')
		expect(split.domain[1]).toBeGreaterThanOrEqual(10.9)
	})

	it('keeps ordinary spread intact — the far-out fence is 3×IQR', () => {
		// Max of the cluster is well within 3×IQR of the quartiles.
		const split = splitYOutliers([...cluster, { y: 9_000, id: 'busy' }])
		expect(split.outliers).toEqual([])
	})

	it('no-ops when the IQR is 0 (identical values)', () => {
		const flat = Array.from({ length: OUTLIER_MIN_POINTS }, (_, i) => ({ y: 100, id: `u${i}` }))
		const split = splitYOutliers([...flat, { y: 90_000, id: 'wild' }])
		expect(split.outliers).toEqual([])
		expect(split.visible).toHaveLength(flat.length + 1)
	})
})
