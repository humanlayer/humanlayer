import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { ChartConfig } from '@humanlayer/ui/components/chart'
import { ScatterChart, type ScatterDataPoint } from '@humanlayer/ui/components/charts/scatter-chart'
import { useMemo, useState } from 'react'

import { useOrgMembers } from '@/hooks/useOrgMembers'

import { elapsedWeeksInRange } from './clientBuckets'
import { FilterDropdown } from './FilterDropdown'
import { filterAsymmetryNote, filterSummary, type ScatterFilters } from './filters'
import { costPerKlocLabel, formatCompact, formatUsdCompact, locRatioBlockingFilter } from './kpis'
import {
	LENS_DEFINITIONS,
	SCATTER_SIZE_LABEL,
	scatterHasSignal,
	scatterRawY,
	scatterSizeKey,
	type MetricLens,
} from './lenses'
import { MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { linearFit, perWeek, splitYOutliers } from './scatterViews'
import { useLensTransition } from './useLensTransition'
import { useScatterFilterOptions } from './useScatterFilterOptions'
import { useUsersScatter } from './useUsersScatter'

export interface SpendScatterCardProps {
	className?: string
	range: MetricsRange
	/** The active lens — decides the y-axis (spend is always x). */
	lens: MetricLens
	/**
	 * Whether the org collects PRs at all. When false, PR figures are
	 * structurally zero, so the PR tooltip row hides (a literal "0 PRs" would
	 * be a lie-by-zero) and dot size falls back to another encoding.
	 */
	prDataAvailable?: boolean
	/**
	 * The three filters, held in the page's URL so a filtered view can be
	 * shared. They are still CONSUMED here alone — see the doc comment below
	 * for why no other card may read them — but where they are *stored* is a
	 * separate question from who is allowed to use them.
	 */
	models?: string[]
	agents?: CodingAgent[]
	repos?: string[]
	onFiltersChange: (next: { models?: string[]; agents?: CodingAgent[]; repos?: string[] }) => void
}

const LENS_COLOR: Record<MetricLens, string> = {
	commits: 'var(--chart-3)',
	kloc: 'var(--chart-4)',
	prs: 'var(--chart-2)',
}

/**
 * Explicit size for the hero chart. Without a height, ChartContainer's
 * `aspect-video` makes this full-width chart ~700px tall on a laptop — the
 * fold then lands mid-scatter and the sections below it are invisible with
 * no scroll affordance (the page scrolls an inner container, so macOS
 * overlay scrollbars give no hint). 360px keeps the whole instrument row
 * above a 900px fold with the mix row's headers peeking.
 *
 * `aspect-auto`: same rationale as CHART_SIZE — the aspect-video ratio
 * otherwise sets a ~640px intrinsic min-content width that blows the card
 * out of narrow viewports.
 */
const SCATTER_CHART_SIZE = 'aspect-auto w-full h-[360px]'

/**
 * The hero scatter: one contributor per dot, token spend always on x, the
 * active lens's output on y as a WEEKLY RATE (so 4w/8w/12w windows stay
 * comparable — widening the window averages longer instead of inflating
 * every value). Clicking a KPI card above re-axes this chart; the dots are
 * the same people, so who rises and who collapses between lenses IS the
 * story (big diffs + few PRs, deletion-heavy refactorers, …).
 *
 * Spend is the input axis on purpose: the trend line's slope reads as output
 * per dollar — the ROI question. Zero-spend users stay plotted (in gray) as
 * the non-adopter baseline instead of being filtered away.
 *
 * The model/agent/repo filters live INSIDE this card because they apply to
 * this card alone: every one of them narrows only one side of a spend÷output
 * ratio, so the KPI cards and trend refuse them wholesale, while the scatter
 * tolerates them as a disclosed exploration (the popover states exactly
 * which axis a filter narrowed). Clicking a dot highlights that contributor;
 * the card stays mounted across lens/window switches, so the highlight
 * follows one person across the definitions of output.
 *
 * Far-out y outliers (Tukey 3×IQR fence) are clamped to the domain edge as
 * triangles — disclosed in the popover, never silently dropped — so one
 * extreme week can't squash the distribution.
 */
export function SpendScatterCard({
	className,
	range,
	lens,
	prDataAvailable = true,
	models,
	agents,
	repos,
	onFiltersChange,
}: SpendScatterCardProps) {
	// The filters come from the page's URL so a filtered view is a shareable
	// link. Only this card consumes them (see the card doc comment) — that
	// rule is about who may READ them, and it is unchanged.
	//
	// The highlight stays card-local, deliberately: it is a transient pointer,
	// and routing it through the URL would re-render every sibling recharts
	// tree on each dot click.
	const [highlightedUserId, setHighlightedUserId] = useState<string | null>(null)
	const selectedModels = useMemo(() => models ?? [], [models])
	const selectedAgents = useMemo(() => agents ?? [], [agents])
	const selectedRepos = useMemo(() => repos ?? [], [repos])
	const filters = useMemo<ScatterFilters>(
		() => ({ models: selectedModels, agents: selectedAgents, repos: selectedRepos }),
		[selectedModels, selectedAgents, selectedRepos],
	)

	const { data: scatterData, isLoading, error } = useUsersScatter(range, filters)
	// Unfiltered variant only for the dropdown options: the option lists must
	// not shrink to the current selection (and the API skips computing them
	// on filtered calls). Query-key dedupe makes this free when no filter is
	// active.
	// Range-independent, so this is one fetch per page load rather than a
	// second full scatter query on every range change.
	const { data: filterOptions } = useScatterFilterOptions()
	const { memberFor } = useOrgMembers()

	const definition = LENS_DEFINITIONS[lens]
	// Dot-size encoding: the lens's usual third variable, unless it would be
	// PR data the org doesn't collect — then every lens still keeps a third
	// variable (uniform dots read as "size means nothing here", which wastes
	// the channel): kloc sizes by commits, commits by lines changed.
	const sizeInfo = prDataAvailable
		? { key: scatterSizeKey(lens), label: SCATTER_SIZE_LABEL[lens] }
		: lens === 'commits'
			? { key: 'locChanged' as const, label: 'lines changed' }
			: { key: 'commitCount' as const, label: 'commits' }

	// Divide rates by the weeks that actually ELAPSED inside the range, not by
	// its nominal width: a range running to today is only partly spent, and
	// dividing by its full width would understate every rate by a factor that
	// changes with the range. Now that a range also has an explicit END, a
	// range that finished last month divides by its whole width rather than by
	// the time since it started (see elapsedWeeksInRange).
	// MEMOIZED on the data load: `new Date()` advances every render, and an
	// ever-so-slightly-different divisor would give `points` a fresh identity
	// per render — which loops fatally against useLensTransition's effect
	// (setState → render → new points → setState …).
	const timezoneOffset = new Date().getTimezoneOffset()
	const startDate = scatterData?.startDate
	const endDate = scatterData?.endDate
	const weeksElapsed = useMemo(
		() => (startDate && endDate ? elapsedWeeksInRange(startDate, endDate, new Date(), timezoneOffset) : null) ?? 1,
		[startDate, endDate, timezoneOffset],
	)

	// Stable identity: a fresh array every render makes recharts treat the
	// data as changed on unrelated re-renders (see scatter-chart.tsx).
	const points: ScatterDataPoint[] = useMemo(
		() =>
			(scatterData?.data ?? [])
				.filter((user) => scatterHasSignal(user, lens))
				.map((user) => {
					return {
						x: user.costUsd,
						y: perWeek(scatterRawY(user, lens), weeksElapsed),
						label: memberFor(user.userId)?.displayName ?? user.userId,
						id: user.userId,
						locAdded: user.locAdded,
						locDeleted: user.locDeleted,
						// Pre-summed so the size encoding can use it as a plain field.
						locChanged: user.locAdded + user.locDeleted,
						commitCount: user.commitCount,
						prsMerged: user.prsMerged,
					}
				}),
		[scatterData, memberFor, lens, weeksElapsed],
	)

	const { visible, outliers, domain } = useMemo(() => splitYOutliers(points), [points])

	// The signature move: on a lens switch the dots SLIDE to their new y
	// instead of the chart re-popping — same people, new definition of
	// output. The axis snaps to the new domain (recharts requirement — see
	// useLensTransition); data refreshes snap entirely. A range change only
	// slides when the new range is already cached — a cold switch has
	// nothing to tween, and the fetched data snaps in on arrival.
	const displayedPoints = useLensTransition(visible, domain, `${lens}:${range.from}:${range.to}`)

	// Linear (least-squares) fit over the VISIBLE points only — the Tukey
	// fence already excluded the extremes that would drag the line, and the
	// clamped outliers sit at fake (pinned) positions. Zero-spend baseline
	// users stay in: they're real observations at x = 0. Fitted on the
	// DISPLAYED (mid-tween) points so the line sweeps with the dots during a
	// lens switch.
	const fit = useMemo(() => linearFit(displayedPoints), [displayedPoints])
	const trendLine = fit ?? undefined

	// Worded around the Tukey fence, not the axis interval: the plotted
	// domain rounds UP from the visible points, so an outlier can sit past
	// the fence yet inside the printed interval — citing the interval would
	// caption a value as "beyond" bounds its tooltip shows it within.
	const outlierNote =
		outliers.length > 0
			? `${outliers.length} outlier${outliers.length === 1 ? '' : 's'} far outside the typical range, pinned at the chart edge as triangles — real values in their tooltips`
			: ''

	const config: ChartConfig = {
		points: { label: 'Users', color: LENS_COLOR[lens] },
	}

	return (
		<MetricCardShell
			className={className}
			title={definition.scatterTitle}
			question={definition.scatterQuestion}
			captionSuffix={filterSummary(filters)}
			startDate={scatterData?.startDate}
			endDate={scatterData?.endDate}
			sentryComponent="SpendScatterCard"
			error={error}
			isLoading={isLoading}
			isEmpty={!isLoading && points.length === 0}
			infoNotes={[
				'One dot per contributor; x is token spend, y is the active lens’s output as a weekly rate.',
				`Dot size: ${sizeInfo.label} · gray dots: no recorded spend (the non-adopter baseline).`,
				trendLine ? 'Dashed line: linear fit through the visible points.' : '',
				outlierNote,
				lens === 'kloc'
					? 'The y-axis plots NET lines (added − deleted) so deletion-heavy refactors show below zero, while the $/kLOC ratio divides by CHANGED lines (added + deleted) — a heavy refactorer can plot near zero yet carry a large share of the denominator.'
					: '',
				'Commits known to be human-authored are excluded from the LOC and commit figures everywhere on this page (spend is agent-only, so human lines would understate unit cost); unattributed legacy commits stay. Merged PRs carry no attribution, so $/PR has no such exclusion.',
				'Filters apply to this chart only — each narrows one side of the spend÷output ratios, so the KPI cards and trend ignore them.',
				filterAsymmetryNote(filters, lens === 'prs'),
			]}
			headerAction={
				<div className="flex flex-row flex-wrap items-center gap-2">
					{/* Each dropdown sends the WHOLE filter set up, not just its
					    own slice: the page writes all three search params in one
					    navigation, so changing the model filter cannot drop a
					    repo selection made a moment earlier. */}
					<FilterDropdown
						noun="model"
						options={filterOptions?.models ?? []}
						selected={selectedModels}
						onChange={(next) =>
							onFiltersChange({ models: next, agents: selectedAgents, repos: selectedRepos })
						}
					/>
					<FilterDropdown
						noun="agent"
						options={filterOptions?.agents ?? []}
						selected={selectedAgents}
						onChange={(next) =>
							onFiltersChange({ models: selectedModels, agents: next, repos: selectedRepos })
						}
					/>
					<FilterDropdown
						noun="repo"
						options={filterOptions?.repos ?? []}
						selected={selectedRepos}
						onChange={(next) =>
							onFiltersChange({ models: selectedModels, agents: selectedAgents, repos: next })
						}
					/>
				</div>
			}
		>
			<ScatterChart
				data={displayedPoints}
				config={config}
				className={SCATTER_CHART_SIZE}
				seriesKey="points"
				xLabel="Token spend (USD)"
				yLabel={definition.yAxisLabel}
				xFormatter={(value) => `$${value.toFixed(2)}`}
				xTickFormatter={formatUsdCompact}
				yFormatter={(value) => (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1))}
				yTickFormatter={formatCompact}
				sizeKey={sizeInfo.key}
				pointFill={(point) => (point.x === 0 ? 'var(--color-muted-foreground)' : undefined)}
				yDomain={domain}
				showZeroLine={lens === 'kloc'}
				edgeMarkers={outliers.length > 0 ? outliers : undefined}
				trendLine={trendLine}
				showAxisTitles
				showPointLabels
				highlightedId={highlightedUserId}
				onPointClick={(point) => {
					if (!point.id) return
					setHighlightedUserId((current) => (current === point.id ? null : (point.id as string)))
				}}
				tooltipExtra={(point) => (
					<>
						<div className="flex w-full items-center justify-between gap-4">
							<span className="text-muted-foreground">Lines added</span>
							<span className="font-mono font-medium tabular-nums text-foreground">
								{(point.locAdded as number).toLocaleString()}
							</span>
						</div>
						<div className="flex w-full items-center justify-between gap-4">
							<span className="text-muted-foreground">Lines deleted</span>
							<span className="font-mono font-medium tabular-nums text-foreground">
								{(point.locDeleted as number).toLocaleString()}
							</span>
						</div>
						<div className="flex w-full items-center justify-between gap-4">
							<span className="text-muted-foreground">Commits</span>
							<span className="font-mono font-medium tabular-nums text-foreground">
								{(point.commitCount as number).toLocaleString()}
							</span>
						</div>
						{/* Hidden when the org doesn't collect PRs — a literal
						    "0 PRs" for uncollected data would be a lie-by-zero. */}
						{prDataAvailable ? (
							<div className="flex w-full items-center justify-between gap-4">
								<span className="text-muted-foreground">PRs merged</span>
								<span className="font-mono font-medium tabular-nums text-foreground">
									{(point.prsMerged as number).toLocaleString()}
								</span>
							</div>
						) : null}
						{/* Hidden under model/repo filters for the same reason as the
						    KPI cards: they narrow only one side of the division. */}
						{locRatioBlockingFilter(filters) === null ? (
							<div className="flex w-full items-center justify-between gap-4">
								<span className="text-muted-foreground">Cost / kLOC changed</span>
								<span className="font-mono font-medium tabular-nums text-foreground">
									{costPerKlocLabel(
										point.x,
										(point.locAdded as number) + (point.locDeleted as number),
									)}
								</span>
							</div>
						) : null}
					</>
				)}
			/>
		</MetricCardShell>
	)
}
