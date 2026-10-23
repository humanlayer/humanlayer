import type { ChartConfig } from '@humanlayer/ui/components/chart'
import { StackedBarChart } from '@humanlayer/ui/components/charts/stacked-bar-chart'
import { useMemo } from 'react'
import { z } from 'zod'

import { chartHeight, repoLabel, sortByTotalDesc, tierTotals } from './commitsByRepo'
import { MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { useAgentCommitsByRepo } from './useAgentCommitsByRepo'

export interface AgentCommitsByRepoCardProps {
	className?: string
	range: MetricsRange
}

const config: ChartConfig = {
	confirmed: {
		label: 'Confirmed',
		color: 'var(--chart-1)',
	},
	inferred: {
		label: 'Inferred',
		color: 'var(--chart-3)',
	},
}

const chartLabelSchema = z.string()

/**
 * HumanLayer commits per repository over the window — ranked horizontal bars,
 * deliberately NOT a time series: "where is agent usage concentrated" is a
 * comparison question, and bars rank repos at a glance where stacked bands'
 * middle positions wobble with their neighbours.
 *
 * Absolute counts, never a share of total commits: a percentage would be
 * actively misleading right now — the in-flight phantom-hook work steadily
 * captures MORE human commits, which would shrink the agent share and make
 * adoption look like it was falling while it was flat or rising.
 *
 * The two bar segments are the attribution tiers, not decoration: `inferred`
 * is a line-hash overlap heuristic with a measured ~24% false-positive rate,
 * so a single opaque "agent commits" bar would overstate certainty.
 */
export function AgentCommitsByRepoCard({ className, range }: AgentCommitsByRepoCardProps) {
	const { data, isLoading, error } = useAgentCommitsByRepo(range)

	// Stable identity: a fresh array every render makes recharts treat the data
	// as changed on unrelated re-renders.
	const rows = useMemo(() => sortByTotalDesc(data?.data ?? []), [data])
	const chartData = useMemo(
		() =>
			rows.map((row) => ({
				repo: row.repoFullName,
				confirmed: row.confirmedCount,
				inferred: row.inferredCount,
			})),
		[rows],
	)
	const tiers = useMemo(() => tierTotals(data?.data ?? []), [data])

	return (
		<MetricCardShell
			className={className}
			title="HumanLayer commits per repo"
			question="Where is agent usage concentrated?"
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="AgentCommitsByRepoCard"
			error={error}
			isLoading={isLoading}
			isEmpty={!isLoading && rows.length === 0}
			infoNotes={[
				'Agent-attributed commits over the window, ranked by repo.',
				tiers.total > 0
					? `${tiers.confirmed.toLocaleString()} confirmed (commit trailer names the session) · ${tiers.inferred.toLocaleString()} inferred (line-overlap heuristic).`
					: '',
				'Absolute counts, not a share of all commits. Observed commits only — a repo missing here isn’t necessarily agent-free.',
			]}
		>
			<StackedBarChart
				data={chartData}
				xDataKey="repo"
				yDataKeys={['confirmed', 'inferred']}
				config={config}
				orientation="vertical"
				labelFormat={(value) => repoLabel(chartLabelSchema.safeParse(value).data ?? '')}
				valueFormat={(value) => value.toLocaleString()}
				allowDecimals={false}
				yAxisWidth={180}
				// w-full defeats ChartContainer's `aspect-video justify-center`:
				// with an explicit height the aspect ratio would derive a narrow
				// width and center it, leaving the bars in a column adrift in a
				// full-width card. aspect-auto kills the ratio's intrinsic
				// min-content width, which would otherwise overflow phones (see
				// CHART_SIZE in MetricCardShell).
				className="aspect-auto w-full"
				style={{ height: chartHeight(chartData.length) }}
			/>
		</MetricCardShell>
	)
}
