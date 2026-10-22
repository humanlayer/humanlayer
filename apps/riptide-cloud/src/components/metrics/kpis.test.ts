import { describe, expect, it } from 'vitest'

import {
	computeKpiTotals,
	costPerKlocLabel,
	formatCompact,
	formatUsdCompact,
	formatUsdWhole,
	formatUsdExact,
	formatUsdPerLine,
	formatUsdRatio,
	type KpiUserRow,
	locRatioBlockingFilter,
	spendCoverageSuspect,
} from './kpis'

// Magnitudes modeled on the real dev-org usersScatter response (2026-07-19, 7d
// range): two heavy users and one low-volume outlier.
const rows: KpiUserRow[] = [
	{
		costUsd: 11088.68,
		inputTokens: 1_941_609_934,
		outputTokens: 6_782_827,
		locAdded: 854_584,
		locDeleted: 389_695,
		commitCount: 274,
		prsMerged: 10,
	},
	{
		costUsd: 7986.42,
		inputTokens: 1_321_569_698,
		outputTokens: 7_620_446,
		locAdded: 706_677,
		locDeleted: 220_506,
		commitCount: 159,
		prsMerged: 19,
	},
	{
		costUsd: 80.71,
		inputTokens: 16_307,
		outputTokens: 623_848,
		locAdded: 21,
		locDeleted: 0,
		commitCount: 6,
		prsMerged: 1,
	},
]

describe('computeKpiTotals', () => {
	it('sums per-user aggregates and derives LOC changed', () => {
		const totals = computeKpiTotals(rows)
		expect(totals.costUsd).toBeCloseTo(19155.81, 2)
		expect(totals.locChanged).toBe(2_171_483)
		expect(totals.commitCount).toBe(439)
		expect(totals.prsMerged).toBe(30)
	})

	it('computes cost per kLOC from the aggregate, not a mean of user ratios', () => {
		const totals = computeKpiTotals(rows)
		// Σcost ÷ ΣkLOC ≈ $8.82. A mean of per-user ratios would be ~$1,287
		// because the low-volume outlier alone computes to ~$3,843/kLOC.
		expect(totals.costPerKlocChanged).toBeCloseTo(8.82, 2)
		expect(totals.costPerCommit).toBeCloseTo(43.64, 2)
		expect(totals.costPerPrMerged).toBeCloseTo(638.53, 2)
	})

	it('returns null ratios instead of dividing by zero', () => {
		const totals = computeKpiTotals([
			{ costUsd: 50, inputTokens: 1, outputTokens: 1, locAdded: 0, locDeleted: 0, commitCount: 0, prsMerged: 0 },
		])
		expect(totals.costPerKlocChanged).toBeNull()
		expect(totals.costPerCommit).toBeNull()
		expect(totals.costPerPrMerged).toBeNull()
	})

	it('handles an empty org (no users in range)', () => {
		const totals = computeKpiTotals([])
		expect(totals.costUsd).toBe(0)
		expect(totals.locChanged).toBe(0)
		expect(totals.costPerKlocChanged).toBeNull()
		expect(totals.costPerCommit).toBeNull()
		expect(totals.costPerPrMerged).toBeNull()
	})
})

describe('locRatioBlockingFilter', () => {
	it('allows no filters and agent filters (they narrow both spend and LOC)', () => {
		expect(locRatioBlockingFilter({})).toBeNull()
		expect(locRatioBlockingFilter({ models: [], agents: [], repos: [] })).toBeNull()
		expect(locRatioBlockingFilter({ agents: ['claude'] })).toBeNull()
	})

	it('blocks on model filters (they narrow spend but not LOC)', () => {
		expect(locRatioBlockingFilter({ models: ['claude-opus-4-8'] })).toBe('model')
	})

	it('blocks on repo filters (they narrow LOC but not spend)', () => {
		expect(locRatioBlockingFilter({ repos: ['humanlayer/syncopate'] })).toBe('repo')
	})

	it('reports the model filter when several blocking filters are active', () => {
		expect(locRatioBlockingFilter({ models: ['claude-opus-4-8'], repos: ['humanlayer/syncopate'] })).toBe('model')
	})
})

describe('spendCoverageSuspect', () => {
	const at = (costUsd: number, locChanged: number) => ({ costUsd, locChanged })

	it('flags a longer window with identical spend but more LOC than the shorter one', () => {
		// Real shape: 90d cost == 30d cost to the cent, LOC ~2.7×.
		expect(spendCoverageSuspect(at(25149.76, 12_768_859), at(25149.76, 4_800_985))).toBe(true)
	})

	it('tolerates ulp-level float drift between the two order-dependent sums', () => {
		expect(spendCoverageSuspect(at(25149.760000000002, 12_768_859), at(25149.76, 4_800_985))).toBe(true)
	})

	it('does not flag spends that differ by a real amount', () => {
		expect(spendCoverageSuspect(at(25149.77, 12_768_859), at(25149.76, 4_800_985))).toBe(false)
	})

	it('does not flag when the longer window has more spend', () => {
		expect(spendCoverageSuspect(at(25149.76, 12_768_859), at(19155.8, 4_800_985))).toBe(false)
	})

	it('does not flag zero-spend orgs', () => {
		expect(spendCoverageSuspect(at(0, 100), at(0, 50))).toBe(false)
	})
})

describe('formatters', () => {
	it('formats compact numbers and dollars', () => {
		expect(formatCompact(2_171_483)).toBe('2.2M')
		expect(formatCompact(439)).toBe('439')
		expect(formatUsdCompact(19155.8)).toBe('$19.2K')
		expect(formatUsdCompact(81)).toBe('$81')
	})

	it('formats whole dollars for a ranked column', () => {
		expect(formatUsdWhole(507.53)).toBe('$508')
		expect(formatUsdWhole(12519.91)).toBe('$12,520')
		// The reason this is not formatUsdCompact: compact collapses both of
		// these to "$1K", and a ranked column has to keep them apart.
		expect(formatUsdWhole(1100)).toBe('$1,100')
		expect(formatUsdWhole(1400)).toBe('$1,400')
		expect(formatUsdWhole(0)).toBe('$0')
	})

	it('formats ratios as two-decimal unit prices', () => {
		expect(formatUsdRatio(8.8215)).toBe('$8.82')
		expect(formatUsdRatio(1.9695)).toBe('$1.97')
		expect(formatUsdRatio(638.527)).toBe('$638.53')
	})

	it('formats the per-line whisper with enough precision to be non-zero', () => {
		expect(formatUsdPerLine(8.8215)).toBe('$0.0088')
	})

	// The tooltip regression: an unformatted spend printed as a bare float with
	// three decimals, because toLocaleString() defaults to maximumFractionDigits 3.
	it('formats tooltip dollars exactly, with a separator and two decimals', () => {
		expect(formatUsdExact(19155.831)).toBe('$19,155.83')
		expect(formatUsdExact(8.8235)).toBe('$8.82')
		expect(formatUsdExact(1234567.891)).toBe('$1,234,567.89')
		expect(formatUsdExact(0)).toBe('$0.00')
	})
})

describe('costPerKlocLabel', () => {
	it('formats the per-user ratio above the volume floor', () => {
		expect(costPerKlocLabel(11088.68, 1_244_279)).toBe('$8.91')
	})

	it('guards low-volume users whose ratio would explode', () => {
		expect(costPerKlocLabel(80.71, 21)).toBe('low volume')
	})

	it('formats at exactly the floor (the guard is strictly below 1,000)', () => {
		expect(costPerKlocLabel(10, 1000)).toBe('$10.00')
	})
})
