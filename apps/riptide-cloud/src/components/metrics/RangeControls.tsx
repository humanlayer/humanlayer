import { presetRange } from '@humanlayer/riptide-api-contract/api/metrics/range'
import { Card } from '@humanlayer/ui/components/card'
import { ChartLoadingState } from '@humanlayer/ui/components/charts/chart-states'
import { ToggleGroup, ToggleGroupItem } from '@humanlayer/ui/components/toggle-group'

import {
	activePreset,
	type MetricsBucket,
	type MetricsRange,
	type RangeBounds,
	todayKey,
	WEEK_PRESETS,
	type WeekPreset,
} from './range'
import { RangeBrush } from './RangeBrush'

export interface RangeControlsProps {
	range: MetricsRange
	bounds: RangeBounds
	overview:
		| { days: ReadonlyArray<{ date: string; costUsd: number }>; attributionStartDate: string | null }
		| undefined
	onRangeChange: (range: MetricsRange) => void
	onBucketChange: (bucket: MetricsBucket) => void
}

/**
 * The page's one time control: presets, a bucket toggle, and the brush.
 *
 * The presets did not go away when the brush arrived — they became shortcuts
 * that set the handles. Two clicks a day are still two clicks, and an old
 * `?weeks=8` link still resolves to the range that preset always meant.
 *
 * A preset whose range reaches back past the attribution floor is DISABLED
 * rather than silently clamped: a button labelled "12 weeks" that hands back
 * nine is worse than one that says it cannot. Dragging to that same nine weeks
 * is still allowed — it just is not a preset any more, which is exactly what
 * the pressed state then says.
 */
export function RangeControls({ range, bounds, overview, onRangeChange, onBucketChange }: RangeControlsProps) {
	const today = todayKey()
	const preset = activePreset(range, today)

	const selectPreset = (weeks: WeekPreset) => {
		const next = presetRange(weeks, today, range.bucket)
		onRangeChange(next)
	}

	return (
		<Card className="gap-4 p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">Bucket</span>
					<ToggleGroup
						type="single"
						value={range.bucket}
						onValueChange={(value) => value && onBucketChange(value as MetricsBucket)}
						aria-label="Bucket size"
					>
						<ToggleGroupItem value="week" aria-label="Weekly buckets">
							Weekly
						</ToggleGroupItem>
						<ToggleGroupItem value="day" aria-label="Daily buckets">
							Daily
						</ToggleGroupItem>
					</ToggleGroup>
				</div>

				<ToggleGroup
					type="single"
					value={preset === null ? 'custom' : String(preset)}
					onValueChange={(value) => {
						// 'custom' is a display state, not a command — there is no range
						// it could mean, so pressing it does nothing.
						const weeks = WEEK_PRESETS.find((entry) => String(entry) === value)
						if (weeks) selectPreset(weeks)
					}}
					aria-label="Range preset"
				>
					{WEEK_PRESETS.map((weeks) => (
						<ToggleGroupItem
							key={weeks}
							value={String(weeks)}
							aria-label={`Last ${weeks} weeks`}
							disabled={!bounds.availablePresets.includes(weeks)}
						>
							{weeks} weeks
						</ToggleGroupItem>
					))}
					{/* Present only while a dragged selection is active, so the control
					    never shows a fourth option nobody can reach. */}
					{preset === null ? (
						<ToggleGroupItem value="custom" aria-label="Custom range">
							Custom
						</ToggleGroupItem>
					) : null}
				</ToggleGroup>
			</div>

			{!overview ? (
				<ChartLoadingState />
			) : (
				<RangeBrush
					days={overview.days}
					range={range}
					bounds={bounds}
					onChange={onRangeChange}
					attributionStartDate={overview.attributionStartDate}
				/>
			)}
		</Card>
	)
}
