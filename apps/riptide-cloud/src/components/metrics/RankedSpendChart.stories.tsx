import type { Meta, StoryObj } from '@storybook/react-vite'

import { RankedSpendChart } from './RankedSpendChart'
import { pivotModeBuckets, pivotStageBuckets } from './stageAttribution'
import { rankSpendSeries } from './spendRanking'

/**
 * Real data: the HumanLayer dev org, Aug 3–28 2026, $13,188.88 of attributed
 * spend. Kept real on purpose — it is the window the ranking was designed
 * against, and it carries the cases invented fixtures never do: one line item
 * at 45% of the total, a long tail under 1%, and 'plan' at $0.07 for the whole
 * month (the row that proves a self-normalising sparkline must refuse to draw
 * a mountain out of seven cents).
 */
const DAYS = [
	'2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09',
	'2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
	'2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23',
	'2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
]

const STAGE_SPEND: Record<string, number[]> = {
	no_stage: [44.07, 226.39, 134.95, 149.37, 254.39, 358.77, 229.22, 80.58, 485.51, 249.57, 298.44, 529.66, 199.68, 151.94, 112.44, 262.63, 431.15, 248.34, 458.97, 102.49, 8.72, 109.68, 26.31, 82.63, 275.13, 397.14],
	'rpi:research-questions': [1.34, 3.71, 0.09, 19.41, 7.47, 8.38, 11.62, 1.96, 3.86, 5.94, 0, 2.22, 0, 5.85, 6.15, 23.3, 0, 20.62, 0, 2.33, 5.96, 11.52, 4.72, 7.3, 25.78, 5.12],
	'rpi:research': [11.37, 19.62, 18.1, 44.53, 49.63, 40.61, 35.53, 15.71, 19.57, 27.59, 0, 0, 0, 17.06, 23.34, 96.45, 0, 70.12, 0, 16.81, 13.62, 0, 31.82, 9.86, 94.19, 14.23],
	'rpi:design': [9.36, 23.52, 25.52, 22.73, 33.22, 64.24, 32.79, 0.93, 0, 4.54, 9.35, 6.44, 8.41, 72.62, 38.42, 11.41, 0, 19.66, 0, 2.01, 0, 0, 2.28, 2.2, 19.29, 31.48],
	'rpi:design-prd': [0.75, 0, 0, 0.34, 8.94, 4.49, 9.06, 28.12, 18.11, 5.12, 0, 0, 0, 1.48, 7.23, 28.63, 0, 13.8, 1.16, 3.67, 28, 14.92, 31.44, 39.55, 99.62, 0.18],
	'rpi:design-tdd': [13.86, 3.91, 0, 15, 12.88, 0, 0, 0, 21.79, 32.02, 8.66, 0, 0, 0, 0, 16.66, 15.34, 17.51, 23.43, 18.13, 4.02, 0, 1.78, 0, 0, 0],
	'rpi:structure': [16.41, 0, 22.37, 33.98, 9.25, 3.38, 14.84, 5.05, 0, 8.82, 18.91, 7.55, 0, 4.54, 41.04, 31.6, 6.07, 6.93, 40.24, 9.29, 25.57, 42.28, 39.91, 12.44, 0, 0],
	'rpi:plan': [0, 0, 0, 0, 0, 0.07, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	'rpi:worktree-setup': [0, 0, 26.51, 0.47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.45, 0.18, 13.34, 33.37, 38.04, 0, 0, 0, 0, 0],
	'rpi:implementation': [416.02, 39.77, 98.28, 237.78, 136.44, 98.93, 69.96, 56.75, 102.65, 324.97, 94.86, 123.04, 74.43, 234.91, 24.16, 127.42, 136.49, 132.89, 132.05, 135.73, 20.7, 26.51, 16.35, 132.59, 129.31, 106.65],
	'rpi:describe-pr': [155.75, 19.85, 22.97, 149.49, 85.26, 137.45, 33.94, 99.14, 66.26, 21.58, 193.23, 25.15, 93.84, 62.67, 12.48, 130.63, 23.48, 32.2, 17.84, 3.75, 40.8, 37.08, 68.64, 13.97, 113.58, 32.72],
}

const MODE_SPEND: Record<string, number[]> = {
	prd_tdd: [263.66, 108.57, 62.73, 94.3, 119.43, 37.06, 23.55, 86.34, 163.87, 132.4, 284.42, 192.12, 135.16, 54.34, 23.73, 164.52, 114.96, 67.53, 161.66, 119.3, 95.26, 52.26, 47.16, 44.66, 154.12, 0],
	outline_only: [234.28, 110.44, 202.07, 416.73, 330.8, 526.14, 327.75, 111.2, 179.09, 70.65, 29.41, 176.78, 68.83, 261.51, 98.5, 242.09, 28.11, 104.82, 81.1, 26.86, 0, 9.72, 19.9, 16.78, 171.27, 26.11],
	oneshot: [149.96, 35.29, 34.96, 134.09, 94.19, 132.59, 63.26, 65, 47.49, 277.72, 32.46, 13.49, 23.36, 126.98, 27.09, 140.48, 33.38, 35.67, 9.68, 7.21, 0, 1.84, 9.07, 0, 0, 1.47],
	freeform: [21.03, 82.48, 49.02, 27.99, 53.07, 20.5, 22.38, 25.7, 327.3, 199.37, 277.16, 311.67, 149, 108.22, 115.95, 181.65, 436.53, 354.24, 434.59, 174.21, 90.15, 178.19, 147.12, 239.09, 431.5, 559.95],
}

/** Zero-spend cells are absent from the API, so the fixture drops them too. */
function cells<Key extends string>(spend: Record<string, number[]>, days: string[], nameKey: Key) {
	return Object.entries(spend).flatMap(([name, values]) =>
		values.flatMap((costUsd, index) =>
			costUsd > 0 ? [{ bucketStart: days[index] ?? '', [nameKey]: name, costUsd } as never] : [],
		),
	)
}

const first = DAYS[0] ?? ''
const last = DAYS[DAYS.length - 1] ?? ''

/** Through the production pivot, so the story sees the keys and colors the card sees. */
const stagePivot = pivotStageBuckets(cells(STAGE_SPEND, DAYS, 'stage'), first, last, 'day')
const modePivot = pivotModeBuckets(cells(MODE_SPEND, DAYS, 'mode'), first, last, 'day')
const oneDayPivot = pivotStageBuckets(cells(STAGE_SPEND, [first], 'stage'), first, first, 'day')

const meta = {
	title: 'Components/Metrics/RankedSpendChart',
	component: RankedSpendChart,
	// 667px is the real budget: a 699px half-width card at a 1470px viewport,
	// less the card's p-4 gutters. Stories drawn at Storybook's default width
	// flatter the layout by ~100px.
	decorators: [(Story) => <div className="w-[667px]">{Story()}</div>],
} satisfies Meta<typeof RankedSpendChart>

export default meta
type Story = StoryObj<typeof meta>

/** Eleven stages — the longest vocabulary the card has to seat in one slot. */
export const Stage: Story = {
	args: {
		ranking: rankSpendSeries(stagePivot.rows, stagePivot.series),
		bucket: 'day',
		labelHeader: 'Stage',
	},
}

/** Four modes — the same component with a short vocabulary and no scroll. */
export const Mode: Story = {
	args: {
		ranking: rankSpendSeries(modePivot.rows, modePivot.series),
		bucket: 'day',
		labelHeader: 'Mode',
	},
}

/**
 * One bucket: every sparkline falls back to a flat baseline, because a line
 * through a single point is a shape the reader would invent meaning for.
 */
export const SingleBucket: Story = {
	args: {
		ranking: rankSpendSeries(oneDayPivot.rows, oneDayPivot.series),
		bucket: 'day',
		labelHeader: 'Stage',
	},
}

/** Empty window — the card's shell shows its own empty state above this. */
export const Empty: Story = {
	args: {
		ranking: rankSpendSeries([], []),
		bucket: 'day',
		labelHeader: 'Stage',
	},
}
