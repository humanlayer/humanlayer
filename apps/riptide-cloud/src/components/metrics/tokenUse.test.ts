import { describe, expect, test } from 'vitest'

import {
	barWidthPercent,
	contributorMarkLabel,
	formatShare,
	formatTokens,
	MAX_MODEL_SERIES,
	MAX_PERSON_SERIES,
	measureValue,
	MIN_BAR_PERCENT,
	modelSeriesLookup,
	otherMeasure,
	OTHER_MODEL_KEY,
	OTHER_PERSON_KEY,
	personSeriesLookup,
	rankModelSeries,
	rankPersonSeries,
	showsContributorMark,
	SPLIT_LABELS,
	splitSegmentsBar,
	supportsSplit,
	taskLabelParts,
	TOKEN_USE_SPLITS,
} from './tokenUse'

describe('taskLabelParts', () => {
	test('strips a ticket the name already carries so it is not printed twice', () => {
		expect(taskLabelParts('[CORE-1725] new task form v3', 'CORE-1725')).toEqual({
			ticket: 'CORE-1725',
			name: 'new task form v3',
		})
	})

	test('promotes an embedded ticket when the row has no ticketId', () => {
		expect(taskLabelParts('[ENG-42] fix the thing', null)).toEqual({
			ticket: 'ENG-42',
			name: 'fix the thing',
		})
	})

	test('keeps the ticketId chip when the name does not embed one', () => {
		expect(taskLabelParts('Fold in HumanLayer', 'ENG-9')).toEqual({
			ticket: 'ENG-9',
			name: 'Fold in HumanLayer',
		})
	})

	test('leaves a name with no ticket at all alone', () => {
		expect(taskLabelParts('[Syncopate] De-Slop', null)).toEqual({
			ticket: null,
			name: '[Syncopate] De-Slop',
		})
	})
})

describe('showsContributorMark', () => {
	// The whole point of the mark: on today's data 99.4% of tasks are solo, so a
	// chip on every row is the same word twelve times over.
	test('stays hidden for a solo task', () => {
		expect(showsContributorMark(1)).toBe(false)
	})

	test('appears once a task is shared', () => {
		expect(showsContributorMark(2)).toBe(true)
		expect(contributorMarkLabel(2)).toBe('2 people')
	})

	test('never claims a contributor for a task with none recorded', () => {
		expect(showsContributorMark(0)).toBe(false)
	})
})

describe('measureValue', () => {
	const row = { tokens: 1_000_000, costUsd: 12.5 }

	test('reads the field the active measure names', () => {
		expect(measureValue(row, 'tokens')).toBe(1_000_000)
		expect(measureValue(row, 'cost')).toBe(12.5)
	})
})

describe('barWidthPercent', () => {
	test('scales against the longest bar', () => {
		expect(barWidthPercent(50, 100)).toBe(50)
		expect(barWidthPercent(100, 100)).toBe(100)
	})

	test('floors a tiny value so the bar is still visible', () => {
		// Against the 168px bar column the floor has to clear one device pixel,
		// or the lightest tasks in the range draw nothing at all.
		expect(barWidthPercent(1, 1_000_000)).toBe(MIN_BAR_PERCENT)
		expect(MIN_BAR_PERCENT * 1.68).toBeGreaterThan(1)
	})

	test('is zero when there is no scale', () => {
		expect(barWidthPercent(5, 0)).toBe(0)
	})
})

describe('formatting', () => {
	test('compacts token counts', () => {
		expect(formatTokens(1_688_412_905)).toBe('1.69B')
		expect(formatTokens(6_920_165)).toBe('6.9M')
		expect(formatTokens(4_200)).toBe('4K')
		expect(formatTokens(42)).toBe('42')
	})

	test('formats a share and refuses to divide by zero', () => {
		expect(formatShare(1, 4)).toBe('25.0%')
		expect(formatShare(1, 0)).toBe('—')
	})
})

describe('rankModelSeries', () => {
	const task = (...models: Array<[string, number]>) => ({
		models: models.map(([model, costUsd]) => ({ model, costUsd })),
	})

	test('ranks by total spend across every visible task', () => {
		const series = rankModelSeries([task(['a', 10], ['b', 1]), task(['b', 50])])
		expect(series.map((entry) => entry.key)).toEqual(['b', 'a'])
	})

	test('assigns chart slots by rank, the same rule the Model spend card uses', () => {
		const series = rankModelSeries([task(['a', 3], ['b', 2], ['c', 1])])
		expect(series.map((entry) => entry.color)).toEqual(['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'])
	})

	test('folds everything past the cap into one muted band', () => {
		const series = rankModelSeries([task(['a', 6], ['b', 5], ['c', 4], ['d', 3], ['e', 2], ['f', 1], ['g', 1])])
		expect(series).toHaveLength(MAX_MODEL_SERIES + 1)
		const fold = series[series.length - 1]!
		expect(fold.key).toBe(OTHER_MODEL_KEY)
		expect(fold.label).toBe('other (2)')
		expect(fold.costUsd).toBe(2)
		expect(fold.color).toBe('var(--color-muted-foreground)')
	})

	test('breaks ties by name so colours do not shuffle between refetches', () => {
		const first = rankModelSeries([task(['zeta', 5], ['alpha', 5])])
		const second = rankModelSeries([task(['alpha', 5], ['zeta', 5])])
		expect(first.map((entry) => entry.key)).toEqual(['alpha', 'zeta'])
		expect(second.map((entry) => entry.key)).toEqual(first.map((entry) => entry.key))
	})

	test('adds no fold when the models fit', () => {
		const series = rankModelSeries([task(['a', 2], ['b', 1])])
		expect(series.every((entry) => entry.key !== OTHER_MODEL_KEY)).toBe(true)
	})
})

describe('modelSeriesLookup', () => {
	const series = rankModelSeries([{ models: [1, 2, 3, 4, 5, 6].map((n) => ({ model: `m${n}`, tokens: 10 - n })) }])
	const lookup = modelSeriesLookup(series)

	test('maps a kept model to its own band', () => {
		expect(lookup('m1')?.key).toBe('m1')
	})

	test('maps a dropped model to the fold rather than to nothing', () => {
		expect(lookup('m6')?.key).toBe(OTHER_MODEL_KEY)
	})

	test('maps an unknown model to the fold too', () => {
		expect(lookup('never-seen')?.key).toBe(OTHER_MODEL_KEY)
	})

	test('returns undefined when there is no fold to catch it', () => {
		expect(
			modelSeriesLookup(rankModelSeries([{ models: [{ model: 'only', costUsd: 1 }] }]))('other'),
		).toBeUndefined()
	})
})

describe('rankPersonSeries', () => {
	const task = (...people: Array<[string, number]>) => ({
		contributors: people.map(([userId, costUsd]) => ({ userId, costUsd })),
	})
	const names: Record<string, string> = { u1: 'Ada Lovelace', u2: 'Grace Hopper' }
	const nameFor = (userId: string) => names[userId]

	test('ranks by total spend across every visible task', () => {
		const series = rankPersonSeries([task(['u1', 10], ['u2', 1]), task(['u2', 50])], nameFor)
		expect(series.map((entry) => entry.key)).toEqual(['u2', 'u1'])
	})

	test('labels a person by their display name', () => {
		expect(rankPersonSeries([task(['u1', 1])], nameFor)[0]?.label).toBe('Ada Lovelace')
	})

	test('falls back to the raw id rather than dropping someone who left the org', () => {
		// The whole point of the fallback: their spend is real and must still be
		// drawn, even though the member list no longer knows their name.
		expect(rankPersonSeries([task(['departed', 5])], nameFor)[0]?.label).toBe('departed')
	})

	test('folds everyone past the cap into one muted band', () => {
		const series = rankPersonSeries(
			[task(['a', 6], ['b', 5], ['c', 4], ['d', 3], ['e', 2], ['f', 1], ['g', 1])],
			nameFor,
		)
		expect(series).toHaveLength(MAX_PERSON_SERIES + 1)
		const fold = series[series.length - 1]!
		expect(fold.key).toBe(OTHER_PERSON_KEY)
		expect(fold.label).toBe('other (2)')
		expect(fold.color).toBe('var(--color-muted-foreground)')
	})

	test('breaks ties by id so colours do not shuffle between refetches', () => {
		const first = rankPersonSeries([task(['u2', 5], ['u1', 5])], nameFor)
		const second = rankPersonSeries([task(['u1', 5], ['u2', 5])], nameFor)
		expect(first.map((entry) => entry.key)).toEqual(['u1', 'u2'])
		expect(second.map((entry) => entry.key)).toEqual(first.map((entry) => entry.key))
	})
})

describe('personSeriesLookup', () => {
	const series = rankPersonSeries(
		[{ contributors: [1, 2, 3, 4, 5, 6].map((n) => ({ userId: `u${n}`, costUsd: 10 - n })) }],
		() => undefined,
	)
	const lookup = personSeriesLookup(series)

	test('maps a kept person to their own band', () => {
		expect(lookup('u1')?.key).toBe('u1')
	})

	test('maps a dropped person to the fold rather than to nothing', () => {
		expect(lookup('u6')?.key).toBe(OTHER_PERSON_KEY)
	})
})

describe('splitSegmentsBar', () => {
	test('mode recolours the bar instead of segmenting it', () => {
		// A task has exactly one workflow_type, so a mode "split" would be a
		// single band at 100% on every row. This is the rule that stops the card
		// from drawing one.
		expect(splitSegmentsBar('mode')).toBe(false)
		expect(splitSegmentsBar('none')).toBe(false)
	})

	test('every genuinely multi-valued dimension does segment', () => {
		expect(splitSegmentsBar('agent')).toBe(true)
		expect(splitSegmentsBar('model')).toBe(true)
		expect(splitSegmentsBar('stage')).toBe(true)
		expect(splitSegmentsBar('person')).toBe(true)
	})

	test('every split has a label, so the combo box can never render a blank row', () => {
		for (const split of TOKEN_USE_SPLITS) {
			expect(SPLIT_LABELS[split]).toBeTruthy()
		}
	})
})

describe('lens capabilities', () => {
	test('only the tasks lens draws bars, so only it takes a split', () => {
		expect(supportsSplit('tasks')).toBe(true)
		expect(supportsSplit('fanout')).toBe(false)
	})
})

describe('otherMeasure', () => {
	test('the inactive figure column is what a click switches to', () => {
		expect(otherMeasure('tokens')).toBe('cost')
		expect(otherMeasure('cost')).toBe('tokens')
	})
})
