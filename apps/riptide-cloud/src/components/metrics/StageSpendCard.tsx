import { useMemo } from 'react'

import { isCompleteBucket } from './clientBuckets'
import { formatUsdCompact } from './kpis'
import { MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { RankedSpendChart } from './RankedSpendChart'
import { rankSpendSeries } from './spendRanking'
import { NO_STAGE_LABEL, pivotStageBuckets } from './stageAttribution'
import { useStageSpendTrend } from './useStageSpendTrend'

export interface StageSpendCardProps {
	className?: string
	range: MetricsRange
}

/**
 * Token spend by RPI workflow stage over the window — the second mix chart
 * beside model spend: models say WHAT billed the money, this says where in the
 * workflow it landed.
 *
 * A RANKING, not a time series, because the caption's question ("where does
 * spend land") is about proportion. Stages are a closed vocabulary and every
 * one with spend gets a row — no top-N fold — so the previous grouped bars
 * drew one bar per stage per bucket: on the dev org's August window that was
 * 286 bars about 2px wide, 224 of them under $50 and 82 exactly zero, with a
 * single outlier owning the axis. The ranking answers the question in one
 * scan and keeps each stage's per-bucket shape as its own sparkline, so the
 * "did this run steadily or in one burst" follow-up survives.
 *
 * Rows are ordered by spend rather than by workflow position: position is
 * already carried by the fixed per-stage color (see stageColorVar), and the
 * reader of a mix chart ranks before they sequence. The muted row is spend on
 * sessions that never invoked an RPI skill (ad-hoc work), kept visible instead
 * of silently dropped — on current data it is the largest line item, which is
 * itself the finding.
 */
export function StageSpendCard({ className, range }: StageSpendCardProps) {
	const { data, isLoading, error } = useStageSpendTrend(range)

	const timezoneOffset = new Date().getTimezoneOffset()
	const ranking = useMemo(() => {
		// The window TOTAL only counts complete buckets — same rule and
		// rationale as ModelSpendCard: a partial bucket understates the stage
		// that happens to be running right now, and here it would reorder the
		// ranking rather than just dent one bar.
		const isComplete = (bucketStart: string) =>
			isCompleteBucket(bucketStart, range.bucket, new Date(), timezoneOffset)
		const pivot = pivotStageBuckets(
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
			title="Spend by workflow stage"
			question="Where in the workflow does spend land?"
			captionSuffix={ranking.grandTotal > 0 ? ` · ${formatUsdCompact(ranking.grandTotal)} total` : undefined}
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="StageSpendCard"
			error={error}
			isLoading={isLoading}
			isEmpty={!isLoading && ranking.rows.length === 0}
			infoNotes={[
				'Token spend over the window, one row per RPI stage, ranked by spend. Bars are scaled to the largest stage, so they compare stages to each other rather than to the total.',
				'The sparkline is that stage’s spend per bucket, scaled to its own peak (marked) — it shows shape, not size. A stage whose whole window is under $1 draws a flat line instead.',
				"A session's stage is its most-progressed RPI label, recorded when the Skill was invoked — measured, not modelled. Sub-agent tokens count toward the parent session's stage.",
				`"${NO_STAGE_LABEL}" (muted) is spend on sessions that never invoked an RPI skill.`,
				'Usage collection began in July 2026; earlier buckets read as empty, not as zero spend.',
				`The current ${range.bucket === 'week' ? 'week' : 'day'} is omitted until it completes — a partial bucket understates whatever is running right now.`,
			]}
		>
			<RankedSpendChart ranking={ranking} bucket={range.bucket} labelHeader="Stage" />
		</MetricCardShell>
	)
}
