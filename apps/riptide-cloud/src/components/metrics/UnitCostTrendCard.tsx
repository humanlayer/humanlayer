import type { ChartConfig } from '@humanlayer/ui/components/chart'
import { InteractiveLineChart } from '@humanlayer/ui/components/charts/interactive-line-chart'
import { useMemo } from 'react'

import { formatUsdRatio } from './kpis'
import { LENS_DEFINITIONS, type MetricLens } from './lenses'
import { CHART_SIZE, MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { trailingCaption, TRAILING_WINDOW_DAYS } from './trailingRatio'
import { currentBucketSoFar, formatTrendSummary, gapSummary, latestCompleteBucket, toTrendRows } from './unitCostTrend'
import { useUnitCostTrend } from './useUnitCostTrend'

export interface UnitCostTrendCardProps {
	className?: string
	range: MetricsRange
	/** The active lens — decides which denominator the bucketed spend divides by. */
	lens: MetricLens
}

/**
 * The active lens's unit-cost ratio through time — the same number as the
 * selected KPI card, as a trend. The card above says where you are; this says
 * which way you're moving. A team that swapped the model behind their
 * implementation phase saw cost per unit of output jump ~5x and caught it in
 * two days — because they were looking at the slope.
 *
 * One query carries all three denominators, so switching lenses re-divides
 * client-side (in `toTrendRows`) with no refetch, and this chart can never
 * disagree with the KPI card: both are Σcost ÷ Σdenominator over the same
 * population.
 *
 * At day resolution each point is a {@link TRAILING_WINDOW_DAYS}-day trailing
 * ratio rather than that day's own — see trailingRatio for why a same-day unit
 * cost is not a readable number. The card SAYS so in its caption, because a
 * reader who takes a daily point for "what Tuesday cost" has misread it and
 * the chart is the only place that can prevent that.
 */
export function UnitCostTrendCard({ className, range, lens }: UnitCostTrendCardProps) {
	const { data, isLoading, error } = useUnitCostTrend(range)
	const definition = LENS_DEFINITIONS[lens]
	const daily = range.bucket === 'day'

	// Stable identity: a fresh array every render makes recharts re-run its
	// mount animation on unrelated re-renders.
	const rows = useMemo(() => toTrendRows(data?.data ?? [], lens, range.bucket), [data, lens, range.bucket])
	// Both figures under the title describe DIFFERENT buckets (latest complete,
	// current partial) and say so — see formatTrendSummary. The timezone
	// offset threads through because the bucket keys are client-local.
	const timezoneOffset = new Date().getTimezoneOffset()
	const complete = useMemo(
		() => latestCompleteBucket(rows, range.bucket, new Date(), timezoneOffset),
		[rows, range.bucket, timezoneOffset],
	)
	const soFar = useMemo(
		() => currentBucketSoFar(rows, range.bucket, new Date(), timezoneOffset),
		[rows, range.bucket, timezoneOffset],
	)
	const summary = formatTrendSummary(complete, soFar, lens, range.bucket)
	const caption = trailingCaption(range.bucket)

	const config: ChartConfig = {
		value: { label: definition.kpiLabel, color: 'var(--chart-1)' },
	}

	return (
		<MetricCardShell
			className={className}
			title={definition.trendTitle}
			question={definition.trendQuestion}
			captionSuffix={caption ? ` · ${caption}` : undefined}
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="UnitCostTrendCard"
			error={error}
			isLoading={isLoading}
			isEmpty={!isLoading && rows.every((row) => row.value === null)}
			infoNotes={[
				daily
					? `Each point is spend ÷ output over the ${TRAILING_WINDOW_DAYS} days ending that day, each summed before dividing. A same-day ratio would divide one day's money by one day's merges — spend is recorded as it happens, output lands days later in a lump — so it swings on merge timing rather than on efficiency.`
					: 'Weekly spend ÷ weekly output, each summed before dividing — the same ratio as the selected KPI card, per week.',
				daily
					? 'On the last day of a week the trailing value equals that week’s weekly figure, so the daily and weekly views agree wherever they can be compared.'
					: '',
				daily
					? 'The six days before the range are read to make the first point a whole window, and are never plotted.'
					: '',
				`The final point is the current ${daily ? 'day' : 'week'} in progress; the figure under the title names what it quotes.`,
				'Commits known to be human-authored are excluded from the LOC and commit denominators (spend is agent-only); unattributed legacy commits stay. PRs carry no attribution, so $/PR has no such exclusion.',
				`${daily ? 'Windows' : 'Weeks'} with output but no recorded spend render as gaps, not $0 — usage collection started later than the commit backfill.`,
				`${daily ? 'Windows' : 'Weeks'} with spend but no output render as gaps too. Usage is collected for every org, but commit and PR tracking start when an org opts in.`,
				gapSummary(rows, range.bucket),
			]}
			preChart={summary ? <p className="mb-2 text-sm text-muted-foreground">{summary}</p> : null}
		>
			<InteractiveLineChart
				data={rows}
				xDataKey="bucketStart"
				yDataKeys={['value']}
				config={config}
				valueFormat={(value) => formatUsdRatio(value)}
				showLegend={false}
				// Linear, with dots on the sparser weekly view: a natural spline
				// over a handful of observations invents waves between them. Dots
				// come off at day resolution, where up to 182 of them would read as
				// a dotted band rather than as observations.
				lineType="linear"
				showDots={!daily}
				className={CHART_SIZE}
			/>
		</MetricCardShell>
	)
}
