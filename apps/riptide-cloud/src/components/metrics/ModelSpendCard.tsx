import type { ChartConfig } from '@humanlayer/ui/components/chart'
import { InteractiveAreaChart } from '@humanlayer/ui/components/charts/interactive-area-chart'
import { useMemo } from 'react'

import { pivotBucketStacks, OTHER_SERIES_KEY } from './bucketStacks'
import { isCompleteBucket } from './clientBuckets'
import { formatUsdCompact, formatUsdExact } from './kpis'
import { CHART_SIZE, MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { useModelSpendTrend } from './useModelSpendTrend'

export interface ModelSpendCardProps {
	className?: string
	range: MetricsRange
}

/** Series beyond the top 5 by range spend fold into a named "other" band. */
const MAX_MODEL_SERIES = 5

/**
 * Token spend stacked by model, one band per bucket — the mix chart that explains the
 * unit-cost trend above it: when cost per unit of output climbs, this is
 * where "because spend shifted to a pricier model" becomes visible as a
 * widening band. The stack's top edge is the bucket's total spend.
 *
 * Pure spend, straight from usage rows — each row carries its own model, so
 * unlike costPerKlocByModel's ratios there is no session-dominance
 * approximation and no coverage caveat here.
 *
 * Capped at the top {@link MAX_MODEL_SERIES} models by range spend; the
 * popover NAMES what the cap folded into "other" rather than letting an
 * opaque band look as authoritative as the real ones.
 */
export function ModelSpendCard({ className, range }: ModelSpendCardProps) {
	const { data, isLoading, error } = useModelSpendTrend(range)

	// Stable identity: a fresh array every render makes recharts re-run its
	// mount animation on unrelated re-renders.
	const timezoneOffset = new Date().getTimezoneOffset()
	const { rows, series, droppedNames } = useMemo(() => {
		// Absolute TOTALS only plot complete buckets: a partial total drawn
		// next to full ones reads as a collapse to zero, which is a
		// data-arrival artifact, not a spend story. At day resolution that is
		// today; at week resolution, the current week.
		// (UnitCostTrendCard is the one that surfaces the partial week — a
		// partial RATIO is a real reading, and its summary labels it "so far".)
		//
		// Cells are filtered BEFORE the pivot so the top-5 ranking and the
		// "other" fold only count spend the chart actually draws — a model
		// first used in the incomplete bucket must not claim a series slot of
		// all zeros. The row filter after still drops the dense all-zero row
		// the pivot densifies in for that bucket.
		const isComplete = (bucketStart: string) =>
			isCompleteBucket(bucketStart, range.bucket, new Date(), timezoneOffset)
		const pivot = pivotBucketStacks(
			(data?.data ?? [])
				.filter((cell) => isComplete(cell.bucketStart))
				.map((cell) => ({
					bucketStart: cell.bucketStart,
					name: cell.model,
					value: cell.costUsd,
				})),
			data?.startDate ?? '',
			data?.endDate ?? '',
			range.bucket,
			MAX_MODEL_SERIES,
		)
		return {
			...pivot,
			rows: pivot.rows.filter((row) => isComplete(String(row.bucketStart))),
		}
	}, [data, range.bucket, timezoneOffset])

	const config: ChartConfig = Object.fromEntries(
		series.map((entry, index) => [
			entry.key,
			{
				label: entry.label,
				color:
					entry.key === OTHER_SERIES_KEY
						? 'var(--color-muted-foreground)'
						: `var(--chart-${(index % 5) + 1})`,
			},
		]),
	)

	return (
		<MetricCardShell
			className={className}
			title="Model spend over time"
			question="Where is the money going, and is the mix shifting?"
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="ModelSpendCard"
			error={error}
			isLoading={isLoading}
			isEmpty={!isLoading && series.length === 0}
			infoNotes={[
				`${range.bucket === 'week' ? 'Weekly' : 'Daily'} token spend, stacked by model — the top edge is total spend for the bucket.`,
				'Each usage row carries its own model, so every dollar lands under the model that billed it.',
				`The current ${range.bucket === 'week' ? 'week' : 'day'} is omitted until it completes — a partial total plotted next to full ones reads as a collapse.`,
				droppedNames.length > 0
					? `The "other" band folds ${droppedNames.length} smaller model${droppedNames.length === 1 ? '' : 's'}: ${droppedNames.join(', ')}.`
					: '',
			]}
		>
			<InteractiveAreaChart
				data={rows}
				xDataKey="bucketStart"
				yDataKeys={series.map((entry) => entry.key)}
				config={config}
				stacked
				lineType="linear"
				valueFormat={formatUsdExact}
				tickFormat={formatUsdCompact}
				className={CHART_SIZE}
			/>
		</MetricCardShell>
	)
}
