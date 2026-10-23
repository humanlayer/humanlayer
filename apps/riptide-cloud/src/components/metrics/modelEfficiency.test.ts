import { describe, expect, it } from 'vitest'

import { LOW_VOLUME_LOC_FLOOR } from './kpis'
import {
	type CoverageBucket,
	disclosureNotes,
	formatCoverage,
	modelLensFor,
	LOW_COVERAGE_THRESHOLD,
	type ModelCell,
	modelSeries,
	overallCoverage,
	pivotModelTrend,
	rankModels,
	TOP_MODEL_LIMIT,
} from './modelEfficiency'

const cell = (bucketStart: string, model: string, costUsd: number, locChanged: number): ModelCell => ({
	bucketStart,
	inRange: true,
	model,
	costUsd,
	locChanged,
	commitCount: 5,
	costPerKloc: locChanged > 0 ? costUsd / (locChanged / 1000) : null,
})

const coverageBucket = (bucketStart: string, attributed: number, total: number): CoverageBucket => ({
	bucketStart,
	attributedLocChanged: attributed,
	totalLocChanged: total,
	coverage: total > 0 ? attributed / total : null,
})

describe('rankModels', () => {
	it('orders by total spend across all weeks, not by any single week', () => {
		const ranking = rankModels(
			[
				cell('2026-01-05', 'opus', 10, 1000),
				cell('2026-01-12', 'opus', 10, 1000),
				cell('2026-01-05', 'fable', 15, 1000),
			],
			2,
		)
		expect(ranking.models).toEqual(['opus', 'fable'])
	})

	it('keeps only the top N and reports the rest by name', () => {
		const ranking = rankModels(
			[
				cell('2026-01-05', 'a', 100, 1000),
				cell('2026-01-05', 'b', 50, 1000),
				cell('2026-01-05', 'c', 5, 1000),
				cell('2026-01-05', 'd', 3, 1000),
			],
			2,
		)
		expect(ranking.models).toEqual(['a', 'b'])
		expect(ranking.omittedModels).toEqual(['c', 'd'])
		expect(ranking.omittedCostUsd).toBe(8)
	})

	it('breaks ties on model name so colours do not reshuffle between refetches', () => {
		const ranking = rankModels([cell('2026-01-05', 'z', 10, 1000), cell('2026-01-05', 'a', 10, 1000)], 2)
		expect(ranking.models).toEqual(['a', 'z'])
	})

	it('defaults to TOP_MODEL_LIMIT', () => {
		const cells = Array.from({ length: 8 }, (_, i) => cell('2026-01-05', `m${i}`, 10 - i, 1000))
		expect(rankModels(cells).models).toHaveLength(TOP_MODEL_LIMIT)
	})

	it('omits nothing when every model fits', () => {
		const ranking = rankModels([cell('2026-01-05', 'a', 10, 1000)], 5)
		expect(ranking.omittedModels).toEqual([])
		expect(ranking.omittedCostUsd).toBe(0)
	})
})

describe('modelSeries', () => {
	it('never uses the model name as a dataKey', () => {
		// A dot in a recharts dataKey is a property path, and dots/slashes are
		// invalid in the --color-<key> CSS custom property the chart reads.
		const series = modelSeries(['claude-opus-4.5', 'anthropic/fable'])
		expect(series.map((s) => s.key)).toEqual(['model0', 'model1'])
		for (const entry of series) {
			expect(entry.key).toMatch(/^model\d+$/)
		}
	})

	it('carries the model name as the legend label and assigns distinct colours', () => {
		const series = modelSeries(['opus', 'fable'])
		expect(series.map((s) => s.label)).toEqual(['opus', 'fable'])
		expect(new Set(series.map((s) => s.color)).size).toBe(2)
	})
})

describe('modelLensFor', () => {
	it('follows the kloc and commits lenses directly', () => {
		expect(modelLensFor('kloc')).toEqual({ modelLens: 'kloc', pinnedNote: null })
		expect(modelLensFor('commits')).toEqual({ modelLens: 'commits', pinnedNote: null })
	})

	it('pins the prs lens to kloc WITH a disclosure — $/PR by model does not exist', () => {
		const choice = modelLensFor('prs')
		expect(choice.modelLens).toBe('kloc')
		expect(choice.pinnedNote).toContain('per-model $/PR does not exist')
	})
})

describe('pivotModelTrend', () => {
	const series = modelSeries(['opus', 'fable'])

	it('places each model’s ratio on the dense week axis', () => {
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'opus', 200, 10_000), cell('2026-01-05', 'fable', 50, 10_000)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
		)
		expect(rows[0]?.model0).toBe(20)
		expect(rows[0]?.model1).toBe(5)
	})

	it('re-denominates the same cells under the commits lens', () => {
		// cell() seeds commitCount = 5, so $200 ÷ 5 commits = $40/commit.
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'opus', 200, 10_000)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
			'commits',
		)
		expect(rows[0]?.model0).toBe(40)
	})

	it('gaps a commits-lens cell with no commits rather than dividing by zero', () => {
		const noCommits = { ...cell('2026-01-05', 'opus', 200, 10_000), commitCount: 0 }
		const { rows } = pivotModelTrend([noCommits], series, '2026-01-05', '2026-01-11', 'week', 'commits')
		expect(rows[0]?.model0).toBeNull()
	})

	it('emits a week the server reported even when no model has a cell in it', () => {
		const { rows } = pivotModelTrend([], series, '2026-01-05', '2026-01-11', 'week')
		expect(rows).toHaveLength(1)
		expect(rows[0]?.model0).toBeNull()
	})

	it('gaps a model that produced output with no recorded spend rather than plotting $0', () => {
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'opus', 0, 10_000)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
		)
		expect(rows[0]?.model0).toBeNull()
	})

	it('gaps a model with spend but no attributed lines', () => {
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'opus', 200, 0)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
		)
		expect(rows[0]?.model0).toBeNull()
	})

	it('ignores cells for models that did not make the cut', () => {
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'haiku', 900, 10_000)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
		)
		expect(rows[0]?.model0).toBeNull()
		expect(rows[0]?.model1).toBeNull()
	})

	it('gaps a cell below the floor instead of letting its ratio set the axis', () => {
		// From dev: $182 of spend against 9 changed lines gives $20,227/kLOC,
		// against a median of $22, so this one cell sets the shared axis.
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'opus', 182, 9), cell('2026-01-05', 'fable', 50, 10_000)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
		)
		expect(rows[0]?.model0).toBeNull()
		expect(rows[0]?.model1).toBe(5)
	})

	it('plots a cell exactly on the floor', () => {
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'opus', 20, LOW_VOLUME_LOC_FLOOR)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
		)
		expect(rows[0]?.model0).toBe(20)
	})

	it('keeps a small week under the commits lens, because the floor counts lines', () => {
		// The same cell gaps under kLOC, but 5 commits is a valid denominator,
		// so this comes out at $200 / 5 = $40 per commit.
		const { rows } = pivotModelTrend(
			[cell('2026-01-05', 'opus', 200, 9)],
			series,
			'2026-01-05',
			'2026-01-11',
			'week',
			'commits',
		)
		expect(rows[0]?.model0).toBe(40)
	})
})

describe('pivotModelTrend low-volume count', () => {
	const series = modelSeries(['opus'])
	// Four whole weeks — the axis now comes from the range, not from coverage.
	const RANGE = ['2026-01-05', '2026-02-01'] as const

	it('counts only the cells the floor gapped, so the caption matches the line', () => {
		const cells = [
			cell('2026-01-05', 'opus', 182, 9), // below the floor: counted
			cell('2026-01-12', 'opus', 50, 10_000), // above the floor
			cell('2026-01-19', 'opus', 0, 9), // no spend, already a gap
			cell('2026-01-26', 'opus', 20, 0), // no denominator, already a gap
		]
		const { rows, lowVolumeCells } = pivotModelTrend(cells, series, RANGE[0], RANGE[1], 'week')
		expect(lowVolumeCells).toBe(1)
		// One gap of each kind, and only one of them is attributed to the floor.
		expect(rows.map((row) => row.model0)).toEqual([null, 5, null, null])
	})

	it('ignores cells for models that are not on the chart', () => {
		const cells = [cell('2026-01-05', 'haiku', 99, 9)]
		expect(pivotModelTrend(cells, series, RANGE[0], RANGE[1], 'week').lowVolumeCells).toBe(0)
	})

	it('counts nothing under the commits lens', () => {
		const cells = [cell('2026-01-05', 'opus', 182, 9)]
		expect(pivotModelTrend(cells, series, RANGE[0], RANGE[1], 'week', 'commits').lowVolumeCells).toBe(0)
	})
})

describe('overallCoverage', () => {
	it('is a ratio of sums, so a quiet week cannot outweigh a busy one', () => {
		// Weekly fractions are 1.0 and 0.1; their mean would be 0.55, but the
		// busy week dominates the real denominator.
		const result = overallCoverage([
			coverageBucket('2026-01-05', 10, 10),
			coverageBucket('2026-01-12', 1_000, 10_000),
		])
		expect(result).toBeCloseTo(1_010 / 10_010)
	})

	it('is null when there are no commits to attribute', () => {
		expect(overallCoverage([coverageBucket('2026-01-05', 0, 0)])).toBeNull()
		expect(overallCoverage([])).toBeNull()
	})
})

describe('formatCoverage', () => {
	it('renders a percentage', () => {
		expect(formatCoverage(0.618)).toBe('62%')
	})
})

describe('disclosureNotes', () => {
	const full = [coverageBucket('2026-01-05', 10_000, 10_000)]
	const text = (notes: string[]) => notes.join(' · ')

	it('always states coverage and the session-dominance approximation', () => {
		const notes = text(disclosureNotes(rankModels([]), full))
		expect(notes).toContain('100% of changed lines are session-linked')
		expect(notes).toContain('wholly under the model holding most of its spend')
	})

	it('names omitted models rather than truncating silently', () => {
		const ranking = rankModels(
			[cell('2026-01-05', 'a', 100, 1000), cell('2026-01-05', 'b', 5, 1000), cell('2026-01-05', 'c', 3, 1000)],
			1,
		)
		const notes = text(disclosureNotes(ranking, full))
		expect(notes).toContain('not shown: b, c')
		expect(notes).toContain('top 1 models by spend')
	})

	it('counts weeks whose ratios read high because of thin attribution', () => {
		const notes = text(
			disclosureNotes(rankModels([]), [
				coverageBucket('2026-01-05', 1_000, 10_000),
				coverageBucket('2026-01-12', 10_000, 10_000),
			]),
		)
		expect(notes).toContain(`1 week under ${formatCoverage(LOW_COVERAGE_THRESHOLD)} coverage`)
	})

	it('always states the zero-spend gap rule', () => {
		expect(text(disclosureNotes(rankModels([]), full))).toContain('no recorded spend are gaps')
	})

	it('reports the count of model-weeks the low-volume floor gapped', () => {
		const notes = text(disclosureNotes(rankModels([]), full, 1, 'kloc'))
		expect(notes).toContain(
			`1 model-week under ${LOW_VOLUME_LOC_FLOOR.toLocaleString()} changed lines shown as gaps`,
		)
	})

	it('states the floor as a rule when nothing hit it', () => {
		expect(text(disclosureNotes(rankModels([]), full))).toContain('are shown as gaps')
	})

	it('omits the lines floor under the commits lens, where it does not apply', () => {
		expect(text(disclosureNotes(rankModels([]), full, 1, 'commits'))).not.toContain('changed lines shown as')
	})
})
