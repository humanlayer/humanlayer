/**
 * Pure derivations behind the "Spend vs …" hero scatter: rate normalization,
 * the y-axis outlier fence, and plot-domain rounding. Kept free of
 * React/recharts so every display decision is unit-testable.
 */

/**
 * A raw count as a weekly rate, so a dot means the same thing in every window
 * (a raw count conflates window length with productivity: 12 PRs is heavy for
 * 4 weeks and light for 12) and widening the window reads as "same instrument,
 * longer averaging" instead of inflating every value 3×.
 *
 * `weeks` may be fractional — pass {@link elapsedWeeks}, not the nominal
 * window size: the anchored window is N-1 complete weeks plus the CURRENT
 * PARTIAL week, so dividing by nominal N understates every rate by up to a
 * full week (~25% at N=4 on a Monday morning), and by a different factor per
 * window size — the exact cross-window incomparability this function exists
 * to prevent.
 */
export function perWeek(value: number, weeks: number): number {
	return value / weeks
}

/**
 * Ease-in-out cubic — the lens-switch tween's easing. Pure so the frame math
 * is testable without an animation loop.
 */
export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * One tween frame of the lens switch: each TARGET point slides from its
 * previous position (matched by id) toward its new one; points with no
 * previous position (entering the lens) appear at their target immediately.
 * x is spend on every lens so it rarely moves, but it interpolates too for
 * the window-switch case.
 */
export function mixPoints<T extends { id?: string; x: number; y: number }>(
	from: readonly T[],
	to: readonly T[],
	eased: number,
): T[] {
	const byId = new Map(from.filter((point) => point.id).map((point) => [point.id, point]))
	return to.map((point) => {
		const previous = point.id ? byId.get(point.id) : undefined
		if (!previous) return point
		return {
			...point,
			x: previous.x + (point.x - previous.x) * eased,
			y: previous.y + (point.y - previous.y) * eased,
		}
	})
}

/**
 * Re-expresses points from one y-domain in another, preserving each point's
 * VISUAL position: a dot 30% up the old axis lands 30% up the new one. This
 * is what lets the axis snap to the new lens's domain immediately (recharts
 * must see exactly ONE domain change per switch — a per-frame domain sends
 * its tick store into an infinite update loop) while the dots still slide
 * from where the viewer last saw them.
 */
export function projectPoints<T extends { y: number }>(
	points: readonly T[],
	fromDomain: [number, number],
	toDomain: [number, number],
): T[] {
	const fromSpan = fromDomain[1] - fromDomain[0]
	const toSpan = toDomain[1] - toDomain[0]
	if (fromSpan === 0 || toSpan === 0) return [...points]
	return points.map((point) => ({
		...point,
		y: toDomain[0] + ((point.y - fromDomain[0]) / fromSpan) * toSpan,
	}))
}

export interface LinearFit {
	slope: number
	intercept: number
}

/**
 * Ordinary least-squares line through the points. Plain linear regression is
 * appropriate here BECAUSE the caller only fits the fence-filtered visible
 * points — the Tukey clamp (see splitYOutliers) already removed the extremes
 * that would otherwise let one user drag the line. Returns null when every
 * point shares the same x (vertical data has no defined slope).
 */
export function linearFit(points: ReadonlyArray<{ x: number; y: number }>): LinearFit | null {
	const n = points.length
	if (n < 2) return null
	const meanX = points.reduce((sum, point) => sum + point.x, 0) / n
	const meanY = points.reduce((sum, point) => sum + point.y, 0) / n
	const sxx = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0)
	if (sxx === 0) return null
	const sxy = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0)
	const slope = sxy / sxx
	return { slope, intercept: meanY - slope * meanX }
}

/**
 * Below this many points, quartiles are too noisy to call anything an
 * outlier — plot everything as-is.
 */
export const OUTLIER_MIN_POINTS = 12

/**
 * Tukey's far-out fence multiplier (3×IQR, vs the usual 1.5× "out" fence):
 * only points that would genuinely stretch the axis get clamped, not
 * ordinary spread.
 */
const TUKEY_K = 3

/** Linear-interpolated quantile (R-7) over an ascending-sorted array. */
function quantile(sorted: number[], p: number): number {
	const idx = (sorted.length - 1) * p
	const lo = Math.floor(idx)
	const hi = Math.ceil(idx)
	const loVal = sorted[lo]
	const hiVal = sorted[hi]
	if (loVal === undefined || hiVal === undefined) {
		throw new Error('invariant: quantile index out of range')
	}
	if (lo === hi) return loVal
	return loVal + (hiVal - loVal) * (idx - lo)
}

/**
 * Ceil to two significant figures: 31,456 → 32,000. Tight enough that the
 * plot doesn't waste vertical space, round enough for clean axis ticks.
 * Expects value > 0.
 */
export function ceilToTwoSig(value: number): number {
	const exp = Math.floor(Math.log10(value)) - 1
	// toPrecision scrubs float noise on both sides of the scaling — without it
	// 7 / 0.1 = 69.999…9 ceils to 70 but 70 * 0.1 = 7.000…1 leaks back out.
	const scaled = Math.ceil(Number((value / 10 ** exp).toPrecision(12)))
	return Number((scaled * 10 ** exp).toPrecision(12))
}

/**
 * Rounded y-axis domain covering the given points. Always includes 0 so
 * signed data keeps its zero line and positive data keeps its natural
 * baseline; degenerate all-zero input falls back to [0, 1].
 */
export function domainFor(points: Array<{ y: number }>): [number, number] {
	const ys = points.map((point) => point.y)
	const maxY = ys.length > 0 ? Math.max(...ys) : 0
	const minY = ys.length > 0 ? Math.min(...ys) : 0
	const hi = maxY > 0 ? ceilToTwoSig(maxY) : 0
	const lo = minY < 0 ? -ceilToTwoSig(-minY) : 0
	if (lo === 0 && hi === 0) return [0, 1]
	return [lo, hi]
}

export interface YOutlierSplit<T> {
	/** Points inside the fence — what the chart plots as dots. */
	visible: T[]
	/**
	 * Points beyond the fence — pinned at the domain edge as triangles.
	 * `edge` records WHICH fence each point crossed: the plot domain is
	 * rounded up from the visible points, so a high outlier can sit inside
	 * the domain and the chart cannot infer the side on its own.
	 */
	outliers: Array<T & { edge: 'top' | 'bottom' }>
	/** Rounded plot domain covering the visible points (always includes 0). */
	domain: [number, number]
}

/**
 * Splits points whose y sits beyond the Tukey far-out fence (3×IQR past the
 * quartiles) away from the plottable mass, so one 10× outlier can't squash
 * the whole distribution into a corner. The outliers stay disclosed — the
 * card pins them at the domain edge and captions the clamp — never silently
 * dropped. No-ops (everything visible) below {@link OUTLIER_MIN_POINTS} or
 * when the IQR is 0.
 */
export function splitYOutliers<T extends { y: number }>(points: T[]): YOutlierSplit<T> {
	let visible = points
	let outliers: Array<T & { edge: 'top' | 'bottom' }> = []
	if (points.length >= OUTLIER_MIN_POINTS) {
		const sorted = points.map((point) => point.y).sort((a, b) => a - b)
		const q1 = quantile(sorted, 0.25)
		const q3 = quantile(sorted, 0.75)
		const iqr = q3 - q1
		if (iqr > 0) {
			const lo = q1 - TUKEY_K * iqr
			const hi = q3 + TUKEY_K * iqr
			visible = points.filter((point) => point.y >= lo && point.y <= hi)
			outliers = points
				.filter((point) => point.y < lo || point.y > hi)
				.map((point) => ({ ...point, edge: point.y > hi ? ('top' as const) : ('bottom' as const) }))
		}
	}
	return { visible, outliers, domain: domainFor(visible) }
}
