import { describe, expect, it } from 'vitest'

import {
	chartHeight,
	type RepoCommitCounts,
	repoLabel,
	REPO_LABEL_MAX,
	repoTotal,
	sortByTotalDesc,
	tierTotals,
} from './commitsByRepo'

const row = (repoFullName: string, confirmedCount: number, inferredCount: number): RepoCommitCounts => ({
	repoFullName,
	confirmedCount,
	inferredCount,
})

describe('repoTotal', () => {
	it('sums the two disjoint attribution tiers', () => {
		expect(repoTotal(row('a/b', 3, 4))).toBe(7)
	})
})

describe('sortByTotalDesc', () => {
	it('orders by total descending, not by either tier alone', () => {
		// b/b wins on total (10) despite having fewer confirmed than a/a.
		const sorted = sortByTotalDesc([row('a/a', 6, 0), row('b/b', 1, 9)])
		expect(sorted.map((r) => r.repoFullName)).toEqual(['b/b', 'a/a'])
	})

	it('breaks ties on repo name so ordering is stable across refetches', () => {
		const sorted = sortByTotalDesc([row('z/z', 2, 3), row('a/a', 5, 0), row('m/m', 1, 4)])
		expect(sorted.map((r) => r.repoFullName)).toEqual(['a/a', 'm/m', 'z/z'])
	})

	it('does not mutate the input', () => {
		const input = [row('a/a', 1, 0), row('b/b', 9, 0)]
		sortByTotalDesc(input)
		expect(input.map((r) => r.repoFullName)).toEqual(['a/a', 'b/b'])
	})
})

describe('tierTotals', () => {
	it('sums each tier separately and overall', () => {
		expect(tierTotals([row('a/a', 2, 3), row('b/b', 4, 1)])).toEqual({ confirmed: 6, inferred: 4, total: 10 })
	})

	it('is all zeroes for no rows', () => {
		expect(tierTotals([])).toEqual({ confirmed: 0, inferred: 0, total: 0 })
	})
})

describe('repoLabel', () => {
	it('leaves a short name untouched', () => {
		expect(repoLabel('humanlayer/syncopate')).toBe('humanlayer/syncopate')
	})

	it('keeps the repo name and ellipsizes the owner', () => {
		const label = repoLabel('averylongorganizationname/riptide-api')
		expect(label.startsWith('…')).toBe(true)
		// The identifying tail survives; the owner prefix is what got dropped.
		expect(label.endsWith('riptide-api')).toBe(true)
		expect(label.length).toBe(REPO_LABEL_MAX)
	})

	it('never exceeds the max width', () => {
		expect(repoLabel('a'.repeat(200)).length).toBe(REPO_LABEL_MAX)
	})

	it('respects a caller-supplied max', () => {
		expect(repoLabel('humanlayer/syncopate', 10)).toBe('…syncopate')
	})
})

describe('chartHeight', () => {
	it('holds a floor so a single bar still renders a readable chart', () => {
		expect(chartHeight(0)).toBe(180)
		expect(chartHeight(1)).toBe(180)
	})

	it('grows with the bar count so rows never get squashed', () => {
		expect(chartHeight(10)).toBeGreaterThan(chartHeight(5))
		expect(chartHeight(20)).toBeGreaterThan(chartHeight(10))
	})
})
