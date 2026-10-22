import { describe, expect, it } from 'vitest'

import { computeKpiTotals, type KpiUserRow } from './kpis'
import {
	availableLenses,
	lensDenominatorLabel,
	lensesWithDenominator,
	lensRatio,
	resolveLens,
	scatterHasSignal,
	scatterRawY,
	scatterSizeKey,
} from './lenses'

const user = (overrides: Partial<KpiUserRow> = {}): KpiUserRow => ({
	costUsd: 100,
	inputTokens: 1_000,
	outputTokens: 500,
	locAdded: 3_000,
	locDeleted: 1_000,
	commitCount: 40,
	prsMerged: 8,
	...overrides,
})

describe('lensRatio', () => {
	it('routes each lens to its ratio on the totals', () => {
		const totals = computeKpiTotals([user()])
		expect(lensRatio(totals, 'kloc')).toBe(totals.costPerKlocChanged)
		expect(lensRatio(totals, 'commits')).toBe(totals.costPerCommit)
		expect(lensRatio(totals, 'prs')).toBe(totals.costPerPrMerged)
	})
})

describe('lensDenominatorLabel', () => {
	it('labels the denominator each card divides by', () => {
		const totals = computeKpiTotals([user()])
		expect(lensDenominatorLabel(totals, 'kloc')).toBe('4K LOC changed')
		expect(lensDenominatorLabel(totals, 'commits')).toBe('40 commits')
		expect(lensDenominatorLabel(totals, 'prs')).toBe('8 PRs merged')
	})
})

describe('scatterRawY', () => {
	it('plots NET lines (signed) on the kloc lens, raw counts on the others', () => {
		const row = user()
		expect(scatterRawY(row, 'kloc')).toBe(2_000)
		expect(scatterRawY(row, 'commits')).toBe(40)
		expect(scatterRawY(row, 'prs')).toBe(8)
	})

	it('goes negative for deletion-heavy work instead of clamping to zero', () => {
		expect(scatterRawY(user({ locAdded: 200, locDeleted: 5_000 }), 'kloc')).toBe(-4_800)
	})
})

describe('scatterHasSignal', () => {
	it('keeps zero-spend users with activity on the lens axis — the baseline group', () => {
		const idleButCommitting = user({ costUsd: 0, prsMerged: 0 })
		expect(scatterHasSignal(idleButCommitting, 'commits')).toBe(true)
		expect(scatterHasSignal(idleButCommitting, 'prs')).toBe(false)
	})

	it('skips users with neither spend nor lens activity', () => {
		const idle = user({ costUsd: 0, locAdded: 0, locDeleted: 0, commitCount: 0, prsMerged: 0 })
		expect(scatterHasSignal(idle, 'kloc')).toBe(false)
		expect(scatterHasSignal(idle, 'commits')).toBe(false)
	})

	it('keeps a spend-only user on every lens — spend with no output is signal', () => {
		const spendOnly = user({ locAdded: 0, locDeleted: 0, commitCount: 0, prsMerged: 0 })
		expect(scatterHasSignal(spendOnly, 'kloc')).toBe(true)
		expect(scatterHasSignal(spendOnly, 'prs')).toBe(true)
	})
})

describe('availableLenses', () => {
	it('shows all three lenses when both pipelines collect', () => {
		expect(availableLenses({ commitTrackingEnabled: true, prTrackingEnabled: true })).toEqual([
			'commits',
			'kloc',
			'prs',
		])
	})

	it('drops the PR lens when PR tracking is off', () => {
		expect(availableLenses({ commitTrackingEnabled: true, prTrackingEnabled: false })).toEqual(['commits', 'kloc'])
	})

	it('drops the commit-derived lenses when commit tracking is off', () => {
		expect(availableLenses({ commitTrackingEnabled: false, prTrackingEnabled: true })).toEqual(['prs'])
	})

	it('falls back to every lens when both pipelines are off — no dead page', () => {
		expect(availableLenses({ commitTrackingEnabled: false, prTrackingEnabled: false })).toEqual([
			'commits',
			'kloc',
			'prs',
		])
	})
})

describe('resolveLens', () => {
	it('keeps an available requested lens', () => {
		expect(resolveLens('prs', ['commits', 'kloc', 'prs'])).toBe('prs')
	})

	it('falls back to the default when the requested lens is hidden', () => {
		expect(resolveLens('prs', ['commits', 'kloc'])).toBe('kloc')
	})

	it('falls back to the first available when the default is hidden too', () => {
		expect(resolveLens('kloc', ['prs'])).toBe('prs')
	})
})

describe('scatterSizeKey', () => {
	it('never restates the y-axis as the size encoding', () => {
		expect(scatterSizeKey('prs')).toBe('commitCount')
		expect(scatterSizeKey('kloc')).toBe('prsMerged')
		expect(scatterSizeKey('commits')).toBe('prsMerged')
	})
})

describe('lensesWithDenominator', () => {
	it('leaves every lens alone once a commit has been attributed', () => {
		expect(lensesWithDenominator(['commits', 'kloc', 'prs'], false)).toEqual(['commits', 'kloc', 'prs'])
	})

	it('keeps $/PR alive while commit attribution has produced nothing', () => {
		// The regression this guards: merged PRs are a separate pipeline in a
		// separate table and carry no attribution, so an org waiting on its
		// first commit still has a correct cost per PR. Hiding the whole tab
		// would withhold working data.
		expect(lensesWithDenominator(['commits', 'kloc', 'prs'], true)).toEqual(['prs'])
		expect(lensesWithDenominator(['prs'], true)).toEqual(['prs'])
	})

	it('empties when every available lens needs a commit', () => {
		// The page reads this as "replace the instrument", not "hide a card".
		expect(lensesWithDenominator(['commits', 'kloc'], true)).toEqual([])
	})
})
