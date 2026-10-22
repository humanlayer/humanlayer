import { describe, expect, it } from 'vitest'

import {
	CHART_PALETTE_SIZE,
	MODE_ORDER,
	modeColorVar,
	modeDisplayName,
	type ModeBucketCell,
	NO_STAGE_KEY,
	NO_STAGE_LABEL,
	NO_STAGE_SERIES_KEY,
	pivotModeBuckets,
	pivotStageBuckets,
	STAGE_ORDER,
	stageColorVar,
	stageDisplayName,
	type StageBucketCell,
} from './stageAttribution'

const modeCell = (bucketStart: string, mode: string, costUsd: number): ModeBucketCell => ({
	bucketStart,
	mode,
	costUsd,
})
const stageCell = (bucketStart: string, stage: string, costUsd: number): StageBucketCell => ({
	bucketStart,
	stage,
	costUsd,
})

describe('stageDisplayName', () => {
	it('maps known RPI labels to their titles', () => {
		expect(stageDisplayName('rpi:structure')).toBe('structure')
		expect(stageDisplayName('rpi:implementation')).toBe('implementation')
	})

	it('maps the sentinel to the fixed ad-hoc label', () => {
		expect(stageDisplayName(NO_STAGE_KEY)).toBe(NO_STAGE_LABEL)
	})

	it('falls back to stripping the rpi: prefix for legacy labels', () => {
		expect(stageDisplayName('rpi:design-discussion')).toBe('design-discussion')
	})
})

describe('modeDisplayName', () => {
	it('names the stored workflow types', () => {
		expect(modeDisplayName('outline_only')).toBe('outline only')
		expect(modeDisplayName('prd_tdd')).toBe('PRD / TDD')
		expect(modeDisplayName('rpi')).toBe('rpi (legacy)')
	})

	it('passes unknown modes through as stored', () => {
		expect(modeDisplayName('some_future_mode')).toBe('some_future_mode')
	})
})

describe('stageColorVar', () => {
	it('gives every stage a fixed color by workflow position, not window rank', () => {
		const index = STAGE_ORDER.indexOf('rpi:research')
		expect(stageColorVar('rpi:research')).toBe(`var(--chart-${index + 1})`)
	})

	it('mutes the ad-hoc bucket and legacy labels', () => {
		expect(stageColorVar(NO_STAGE_KEY)).toBe('var(--color-muted-foreground)')
		expect(stageColorVar('rpi:design-discussion')).toBe('var(--color-muted-foreground)')
	})

	it('gives every stage a DISTINCT color — the vocabulary has to fit the palette', () => {
		// At a palette of 10 the eleventh stage wrapped onto the first one's
		// color. Harmless on the ranked card, where every row carries text;
		// wrong on the stacked bar, where the color is all that names a segment.
		expect(STAGE_ORDER.length).toBeLessThanOrEqual(CHART_PALETTE_SIZE)
		expect(MODE_ORDER.length).toBeLessThanOrEqual(CHART_PALETTE_SIZE)
		expect(new Set(STAGE_ORDER.map(stageColorVar)).size).toBe(STAGE_ORDER.length)
	})
})

describe('pivotStageBuckets', () => {
	it('gives every stage its own band in workflow order — no fold', () => {
		const { series } = pivotStageBuckets(
			[
				stageCell('2026-01-05', 'rpi:implementation', 100),
				stageCell('2026-01-05', 'rpi:research', 1),
				stageCell('2026-01-05', 'rpi:design', 5),
				stageCell('2026-01-05', 'rpi:describe-pr', 2),
				stageCell('2026-01-05', 'rpi:research-questions', 3),
				stageCell('2026-01-05', 'rpi:structure', 4),
			],
			'2026-01-05',
			'2026-01-05',
			'week',
		)
		expect(series.map((entry) => entry.label)).toEqual([
			'research-questions',
			'research',
			'design',
			'structure',
			'implementation',
			'describe-pr',
		])
	})

	it('densifies weeks with zeros and keeps ad-hoc as the muted final band', () => {
		const { rows, series } = pivotStageBuckets(
			[stageCell('2026-01-05', NO_STAGE_KEY, 10), stageCell('2026-01-19', 'rpi:research', 30)],
			'2026-01-05',
			'2026-01-19',
			'week',
		)
		expect(series.at(-1)).toMatchObject({
			key: NO_STAGE_SERIES_KEY,
			label: NO_STAGE_LABEL,
			color: 'var(--color-muted-foreground)',
		})
		const researchKey = series.find((entry) => entry.label === 'research')!.key
		expect(rows.map((row) => row[researchKey])).toEqual([0, 0, 30])
	})
})

describe('modeColorVar', () => {
	it('gives every known mode a fixed color by canonical position', () => {
		const index = MODE_ORDER.indexOf('oneshot')
		expect(modeColorVar('oneshot')).toBe(`var(--chart-${index + 1})`)
	})

	it('mutes an unknown future mode rather than stealing a color', () => {
		expect(modeColorVar('some_future_mode')).toBe('var(--color-muted-foreground)')
	})
})

describe('pivotModeBuckets', () => {
	it('stacks modes structured-first so freeform sits on top', () => {
		const { series } = pivotModeBuckets(
			[
				modeCell('2026-01-05', 'freeform', 40),
				modeCell('2026-01-05', 'oneshot', 30),
				modeCell('2026-01-05', 'prd_tdd', 20),
				modeCell('2026-01-05', 'outline_only', 10),
			],
			'2026-01-05',
			'2026-01-05',
			'week',
		)
		expect(series.map((entry) => entry.label)).toEqual(['PRD / TDD', 'outline only', 'oneshot', 'freeform'])
	})

	it('densifies weeks with zeros so areas span the whole window', () => {
		const { rows, series } = pivotModeBuckets(
			[modeCell('2026-01-05', 'oneshot', 10), modeCell('2026-01-19', 'oneshot', 30)],
			'2026-01-05',
			'2026-01-19',
			'week',
		)
		const key = series[0]!.key
		expect(rows.map((row) => row[key])).toEqual([10, 0, 30])
	})

	it('uses synthetic keys — raw mode names never become CSS vars', () => {
		const { series } = pivotModeBuckets(
			[modeCell('2026-01-05', 'outline_only', 1)],
			'2026-01-05',
			'2026-01-05',
			'week',
		)
		expect(series[0]!.key).toBe('mode_1')
	})
})
