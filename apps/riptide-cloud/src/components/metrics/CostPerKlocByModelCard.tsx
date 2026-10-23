import type { ChartConfig } from '@humanlayer/ui/components/chart'
import { InteractiveLineChart } from '@humanlayer/ui/components/charts/interactive-line-chart'
import { useMemo } from 'react'

import { formatUsdRatio } from './kpis'
import type { MetricLens } from './lenses'
import { CHART_SIZE, MetricCardShell } from './MetricCardShell'
import { disclosureNotes, modelLensFor, modelSeries, pivotModelTrend, rankModels } from './modelEfficiency'
import type { MetricsRange } from './range'
import { trailingCaption } from './trailingRatio'
import { useCostPerKlocByModel } from './useCostPerKlocByModel'

export interface CostPerKlocByModelCardProps {
	className?: string
	range: MetricsRange
	/**
	 * The page lens. kloc/commits re-denominate this chart client-side (the
	 * endpoint returns both denominators per cell); the prs lens pins to kLOC
	 * with a disclosed note — see modelLensFor.
	 */
	lens: MetricLens
}

/**
 * Cost per kLOC/commit split by model — the efficiency comparison ("how does
 * Fable compare to Sonnet per thousand lines?") that the model-spend chart
 * beside it structurally cannot answer: spend says where the money goes,
 * this says what each model's output costs.
 *
 * The heaviest-caveated chart on the page, deliberately: models are
 * attributed at session granularity (dominant-by-spend) and only
 * session-linked commits enter the denominator. Both approximations live in
 * the info popover via `disclosureNotes` — this chart's honesty budget.
 */
export function CostPerKlocByModelCard({ className, range, lens }: CostPerKlocByModelCardProps) {
	const { data, isLoading, error } = useCostPerKlocByModel(range)
	const { modelLens, pinnedNote } = modelLensFor(lens)
	const title = modelLens === 'commits' ? 'Cost per commit by model' : 'Cost per kLOC by model'
	const question =
		modelLens === 'commits' ? 'Which model lands commits cheapest?' : 'Which model gives the most code per dollar?'

	// Stable identities: fresh arrays every render make recharts re-run its
	// mount animation on unrelated re-renders.
	const ranking = useMemo(() => rankModels(data?.data ?? []), [data])
	const series = useMemo(() => modelSeries(ranking.models), [ranking])
	const trend = useMemo(
		() =>
			pivotModelTrend(
				data?.data ?? [],
				series,
				data?.startDate ?? '',
				data?.endDate ?? '',
				range.bucket,
				modelLens,
			),
		[data, series, range.bucket, modelLens],
	)
	const caption = trailingCaption(range.bucket)

	const config: ChartConfig = Object.fromEntries(
		series.map((entry) => [entry.key, { label: entry.label, color: entry.color }]),
	)

	return (
		<MetricCardShell
			className={className}
			title={title}
			question={question}
			captionSuffix={
				[
					pinnedNote ? ' · $/PR can’t be split by model — showing $/kLOC' : '',
					caption ? ` · ${caption}` : '',
				].join('') || undefined
			}
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="CostPerKlocByModelCard"
			error={error}
			isLoading={isLoading}
			isEmpty={!isLoading && series.length === 0}
			infoNotes={[
				pinnedNote ?? '',
				...disclosureNotes(ranking, data?.coverage ?? [], trend.lowVolumeCells, modelLens, range.bucket),
				// Unlike the model-spend TOTALS chart this ratio chart does plot
				// the in-progress bucket (a partial ratio is a real reading), so
				// the final point deserves the same "so far" disclosure.
				`The current ${range.bucket === 'week' ? 'week' : 'day'} is still in progress — the last point can move as spend and commits arrive.`,
			]}
		>
			<InteractiveLineChart
				data={trend.rows}
				xDataKey="bucketStart"
				yDataKeys={series.map((entry) => entry.key)}
				config={config}
				valueFormat={(value) => formatUsdRatio(value)}
				lineType="linear"
				showDots={range.bucket === 'week'}
				className={CHART_SIZE}
			/>
		</MetricCardShell>
	)
}
