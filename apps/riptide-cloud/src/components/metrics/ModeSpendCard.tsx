import { useMemo } from 'react'

import { isCompleteBucket } from './clientBuckets'
import { formatUsdCompact } from './kpis'
import { MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { RankedSpendChart } from './RankedSpendChart'
import { rankSpendSeries } from './spendRanking'
import { pivotModeBuckets } from './stageAttribution'
import { useModeSpendTrend } from './useModeSpendTrend'

export interface ModeSpendCardProps {
	className?: string
	range: MetricsRange
}

/**
 * Token spend by workflow mode over the window — the companion to the stage
 * card over the same spend: stages say WHICH PART of a workflow the money
 * bought, modes say WHICH KIND of workflow ran.
 *
 * A ranking for the same reason as the stage card, and rendered by the same
 * component so the two read as one instrument: identical row shape, identical
 * bar scale, identical sparkline rules.
 *
 * Modes are a closed set of five, so every mode with spend gets a row (no
 * fold) with its fixed color, assigned by canonical order — structured first —
 * so a mode keeps its color across ranges even as the ranking reorders it.
 */
export function ModeSpendCard({ className, range }: ModeSpendCardProps) {
	const { data, isLoading, error } = useModeSpendTrend(range)

	const timezoneOffset = new Date().getTimezoneOffset()
	const ranking = useMemo(() => {
		// Complete buckets only — same rule as the stage and model cards.
		const isComplete = (bucketStart: string) =>
			isCompleteBucket(bucketStart, range.bucket, new Date(), timezoneOffset)
		const pivot = pivotModeBuckets(
			(data?.data ?? []).filter((cell) => isComplete(cell.bucketStart)),
			data?.startDate ?? '',
			data?.endDate ?? '',
			range.bucket,
		)
		return rankSpendSeries(
			pivot.rows.filter((row) => isComplete(String(row.bucketStart))),
			pivot.series,
		)
	}, [data, range.bucket, timezoneOffset])

	return (
		<MetricCardShell
			className={className}
			title="Spend by workflow mode"
			question="Which kind of workflow is the spend running in?"
			captionSuffix={ranking.grandTotal > 0 ? ` · ${formatUsdCompact(ranking.grandTotal)} total` : undefined}
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="ModeSpendCard"
			error={error}
			isLoading={isLoading}
			isEmpty={!isLoading && ranking.rows.length === 0}
			infoNotes={[
				"Token spend over the window, one row per workflow mode (the task's stored type), ranked by spend. Bars are scaled to the largest mode, so they compare modes to each other rather than to the total.",
				'The sparkline is that mode’s spend per bucket, scaled to its own peak (marked) — it shows shape, not size.',
				'Mode is the stored workflow type on the task, so this is measured, not inferred.',
				'Spend on sessions without a task counts as freeform.',
				'Usage collection began in July 2026; earlier buckets read as empty, not as zero spend.',
				`The current ${range.bucket === 'week' ? 'week' : 'day'} is omitted until it completes — a partial bucket understates whatever is running right now.`,
			]}
		>
			<RankedSpendChart ranking={ranking} bucket={range.bucket} labelHeader="Mode" />
		</MetricCardShell>
	)
}
