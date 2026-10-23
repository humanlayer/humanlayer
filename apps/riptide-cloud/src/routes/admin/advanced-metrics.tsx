import { RANGE_HISTORY_DAYS } from '@humanlayer/riptide-api-contract/api/metrics/range'
import { TOKEN_USE_MEASURES, type TokenUseMeasure } from '@humanlayer/riptide-api-contract/api/metrics/tokenUseByTask'
import { type CodingAgent, CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { ChartLoadingState } from '@humanlayer/ui/components/charts/chart-states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@humanlayer/ui/components/tabs'
import { cn } from '@humanlayer/ui/lib/utils'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { type ReactNode, useMemo } from 'react'
import z from 'zod/v4'

import { AgentCommitsByRepoCard } from '@/components/metrics/AgentCommitsByRepoCard'
import { AttributionWarmUp } from '@/components/metrics/AttributionWarmUp'
import { parseLocalDay } from '@/components/metrics/clientBuckets'
import { CommitTrackingCallout, SampleChartPreview } from '@/components/metrics/CommitTrackingCallout'
import { CostPerKlocByModelCard } from '@/components/metrics/CostPerKlocByModelCard'
import { formatUsdWhole } from '@/components/metrics/kpis'
import {
	availableLenses,
	DEFAULT_LENS,
	lensesWithDenominator,
	type MetricLens,
	resolveLens,
} from '@/components/metrics/lenses'
import { adoptionLocked, efficiencyLocked } from '@/components/metrics/locks'
import { MetricsKpiRow } from '@/components/metrics/MetricsKpiRow'
import { ModelSpendCard } from '@/components/metrics/ModelSpendCard'
import { ModeSpendCard } from '@/components/metrics/ModeSpendCard'
import {
	attributionPending,
	METRICS_BUCKETS,
	type MetricsBucket,
	type MetricsRange,
	rangeBounds,
	rangeFromSearch,
	rangeLengthDays,
	resolveRange,
	searchFromRange,
	todayKey,
	withBucket,
} from '@/components/metrics/range'
import { RangeControls } from '@/components/metrics/RangeControls'
import { AdoptionSample, EfficiencySample } from '@/components/metrics/SampleMetrics'
import { SpendScatterCard } from '@/components/metrics/SpendScatterCard'
import { StageSpendCard } from '@/components/metrics/StageSpendCard'
import {
	DEFAULT_TOKEN_USE_LENS,
	TOKEN_USE_LENSES,
	TOKEN_USE_SPLITS,
	type TokenUseLens,
	type TokenUseSplit,
} from '@/components/metrics/tokenUse'
import { TokenUseByTaskCard } from '@/components/metrics/TokenUseByTaskCard'
import { UnitCostTrendCard } from '@/components/metrics/UnitCostTrendCard'
import { useRangeOverview } from '@/components/metrics/useRangeOverview'
import { UserModeSpendCard } from '@/components/metrics/UserModeSpendCard'
import { UserStageSpendCard } from '@/components/metrics/UserStageSpendCard'
import { useUserInfo } from '@/hooks/useUserInfo'

export const METRICS_TABS = ['efficiency', 'workflow', 'tasks', 'adoption'] as const
export type MetricsTab = (typeof METRICS_TABS)[number]
const DEFAULT_TAB: MetricsTab = 'efficiency'

const TAB_LABELS: Record<MetricsTab, string> = {
	efficiency: 'Efficiency',
	workflow: 'Workflow',
	tasks: 'Tasks',
	adoption: 'Adoption',
}

// Mirrors the usersScatter contract's caps. Also applied in `setSearch`: the schema's `.catch`
// drops the whole array on overflow, so an unclamped write would clear every filter.
export const SCATTER_FILTER_CAPS = { models: 32, agents: 32, repos: 64 } as const

// `catch`, not just `default`: a hand-mangled query string falls back instead of blowing up the
// route. `weeks` is read but never written, so links that carry it keep resolving.
const advancedMetricsSearchSchema = z.object({
	tab: z.enum(METRICS_TABS).default(DEFAULT_TAB).catch(DEFAULT_TAB),
	lens: z.enum(['commits', 'kloc', 'prs']).default(DEFAULT_LENS).catch(DEFAULT_LENS),
	from: z.string().optional().catch(undefined),
	to: z.string().optional().catch(undefined),
	bucket: z.enum(METRICS_BUCKETS).optional().catch(undefined),
	weeks: z.number().int().min(4).max(12).optional().catch(undefined),
	tokenLens: z.enum(TOKEN_USE_LENSES).default(DEFAULT_TOKEN_USE_LENS).catch(DEFAULT_TOKEN_USE_LENS),
	tokenMeasure: z.enum(TOKEN_USE_MEASURES).default('tokens').catch('tokens'),
	tokenSplit: z.enum(TOKEN_USE_SPLITS).default('none').catch('none'),
	tokenSearch: z.string().max(200).default('').catch(''),
	models: z.array(z.string().min(1).max(256)).max(SCATTER_FILTER_CAPS.models).optional().catch(undefined),
	agents: z.array(CodingAgentZodSchema).max(SCATTER_FILTER_CAPS.agents).optional().catch(undefined),
	repos: z.array(z.string().min(1).max(512)).max(SCATTER_FILTER_CAPS.repos).optional().catch(undefined),
})

// Empty is `undefined`, not `[]`, so the URL carries no filter param. Over-cap keeps the first N;
// the schema's `.catch` would drop them all.
function cappedFilter<T>(values: readonly T[] | undefined, cap: number): T[] | undefined {
	return values?.length ? values.slice(0, cap) : undefined
}

export const Route = createFileRoute('/admin/advanced-metrics')({
	component: AdvancedMetricsPage,
	validateSearch: advancedMetricsSearchSchema,
})

function AdvancedMetricsPage() {
	const { isLoading: authLoading } = useAuth()
	const { advancedMetricsVisible, isLoading: infoLoading } = useUserInfo()
	const navigate = useNavigate()

	if (authLoading || infoLoading) return null
	if (!advancedMetricsVisible) {
		navigate({ to: '/metrics' })
		return null
	}

	// Separate component so its queries mount after the guard; a viewer outside the audience would
	// otherwise get a 403 toast on the way to the redirect.
	return <AdvancedMetricsContent />
}

function MetricsPageShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col gap-6 p-6 min-h-0 grow overflow-auto">
			<h1 className="text-2xl font-semibold">Advanced Metrics</h1>
			{children}
		</div>
	)
}

function AdvancedMetricsContent() {
	const { commitTrackingEnabled, prTrackingEnabled } = useUserInfo()
	const navigate = useNavigate()
	const search = Route.useSearch()

	const tab: MetricsTab = search.tab

	const { data: overview, isLoading: overviewLoading } = useRangeOverview()

	const today = todayKey()
	const requested = useMemo(() => rangeFromSearch(search, today), [search, today])
	const bounds = useMemo(() => rangeBounds(overview, requested.bucket, today), [overview, requested.bucket, today])
	const range = useMemo(() => resolveRange(requested, bounds), [requested, bounds])

	const commitAttributionPending = commitTrackingEnabled && attributionPending(overview)

	const efficiencyIsLocked = efficiencyLocked({ commitTrackingEnabled, prTrackingEnabled })
	const adoptionIsLocked = adoptionLocked({ commitTrackingEnabled, prTrackingEnabled })
	const modelRatioUnavailable = efficiencyIsLocked || commitAttributionPending

	const lenses = lensesWithDenominator(
		availableLenses({ commitTrackingEnabled, prTrackingEnabled }),
		commitAttributionPending,
	)
	const lens = resolveLens(search.lens, lenses)

	const waitingOnAttribution = commitAttributionPending && lenses.length === 0

	const setSearch = (
		next: Partial<{
			tab: MetricsTab
			lens: MetricLens
			range: MetricsRange
			scatterFilters: { models?: string[]; agents?: CodingAgent[]; repos?: string[] }
		}>,
	) => {
		navigate({
			to: '/admin/advanced-metrics',
			search: (prev) => {
				const nextSearch: typeof prev = {
					...prev,
					// A stale `weeks` beside an explicit from/to would make the URL self-contradictory.
					weeks: undefined,
				}
				if (next.tab) nextSearch.tab = next.tab
				if (next.lens) nextSearch.lens = next.lens
				if (next.scatterFilters) {
					nextSearch.models = cappedFilter(next.scatterFilters.models, SCATTER_FILTER_CAPS.models)
					nextSearch.agents = cappedFilter(next.scatterFilters.agents, SCATTER_FILTER_CAPS.agents)
					nextSearch.repos = cappedFilter(next.scatterFilters.repos, SCATTER_FILTER_CAPS.repos)
				}
				if (next.range) {
					const rangeSearch = searchFromRange(next.range)
					nextSearch.from = rangeSearch.from
					nextSearch.to = rangeSearch.to
					nextSearch.bucket = rangeSearch.bucket
				}
				return nextSearch
			},
			replace: true,
		})
	}

	const setRange = (next: MetricsRange) => setSearch({ range: next })

	const setTokenUse = (
		next: Partial<{
			tokenLens: TokenUseLens
			tokenMeasure: TokenUseMeasure
			tokenSplit: TokenUseSplit
			tokenSearch: string
		}>,
	) => {
		navigate({
			to: '/admin/advanced-metrics',
			search: (prev) => ({ ...prev, ...next }),
			replace: true,
		})
	}
	const setBucket = (bucket: MetricsBucket) => {
		if (!range) return
		// Bounds for the target bucket: floor and end differ per bucket, so re-snapping against the
		// current bucket's bounds lands the handles a bucket out.
		setRange(withBucket(range, bucket, rangeBounds(overview, bucket, today)))
	}

	// Without the overview the coverage floor is unknown, and the cards would paint uncovered unit
	// costs before the warm-up replaces them.
	if (overviewLoading) {
		return (
			<MetricsPageShell>
				<ChartLoadingState />
			</MetricsPageShell>
		)
	}

	if (bounds.empty || range === null) {
		const startsOn = overview?.attributionStartDate ? parseLocalDay(overview.attributionStartDate) : null
		const unlocksOn = bounds.floor ? parseLocalDay(bounds.floor) : null
		return (
			<MetricsPageShell>
				<AttributionWarmUp coverageStart={startsOn} unlocksOn={unlocksOn} historyDays={RANGE_HISTORY_DAYS} />
			</MetricsPageShell>
		)
	}

	const rangeSpendUsd = overview
		? overview.days.reduce(
				(total, day) => (day.date >= range.from && day.date <= range.to ? total + day.costUsd : total),
				0,
			)
		: 0
	const rangeDays = rangeLengthDays(range)

	return (
		<div className="flex flex-col gap-6 p-6 min-h-0 grow overflow-auto">
			<h1 className="text-2xl font-semibold">Advanced Metrics</h1>

			<RangeControls
				range={range}
				bounds={bounds}
				overview={overview}
				onRangeChange={setRange}
				onBucketChange={setBucket}
			/>

			<Tabs value={tab} onValueChange={(next) => setSearch({ tab: next as MetricsTab })} className="gap-6">
				<TabsList variant="underline" className="h-9 w-full border-border border-b">
					{METRICS_TABS.map((value) => (
						<TabsTrigger key={value} value={value}>
							{TAB_LABELS[value]}
						</TabsTrigger>
					))}
				</TabsList>

				<TabsContent value="efficiency" className="flex flex-col gap-6">
					{efficiencyIsLocked ? (
						<>
							<CommitTrackingCallout
								title="What did all those tokens actually build?"
								description="Turn on commit tracking to set spend against output: cost per commit, per 1,000 lines changed, per merged pull request. Find which models return the most code per dollar, which repositories absorb the most spend, and whether the ratio is improving week over week. Metadata only — no source code leaves a member's machine."
								recordedSpend={
									Math.round(rangeSpendUsd) > 0 && rangeDays !== null
										? { usd: formatUsdWhole(rangeSpendUsd), days: rangeDays }
										: undefined
								}
							/>
							<SampleChartPreview>
								<EfficiencySample />
							</SampleChartPreview>
						</>
					) : waitingOnAttribution ? (
						<AttributionWarmUp coverageStart={null} unlocksOn={null} historyDays={RANGE_HISTORY_DAYS} />
					) : (
						<>
							<MetricsKpiRow
								range={range}
								lenses={lenses}
								lens={lens}
								onLensChange={(next) => setSearch({ lens: next })}
							/>

							{/* grid-cols-1 is load-bearing: an implicit auto column honors the charts' ~640px
							    min-content width and overflows phones; minmax(0,1fr) lets them shrink. */}
							<div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
								<SpendScatterCard
									className="lg:col-span-3"
									range={range}
									lens={lens}
									prDataAvailable={prTrackingEnabled}
									models={search.models}
									agents={search.agents}
									repos={search.repos}
									onFiltersChange={(scatterFilters) => setSearch({ scatterFilters })}
								/>
								<UnitCostTrendCard className="lg:col-span-2" range={range} lens={lens} />
							</div>
						</>
					)}

					<div className={cn('grid grid-cols-1 gap-6', !modelRatioUnavailable && 'md:grid-cols-2')}>
						<ModelSpendCard range={range} />
						{modelRatioUnavailable ? null : <CostPerKlocByModelCard range={range} lens={lens} />}
					</div>
				</TabsContent>

				<TabsContent value="workflow" className="flex flex-col gap-6">
					{/* `xl`: a ranked row needs ~320px of card content, and at `lg` with the sidebar open each
					    card holds ~268px. */}
					<div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
						<StageSpendCard range={range} />
						<ModeSpendCard range={range} />
					</div>

					<div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
						<UserStageSpendCard range={range} />
						<UserModeSpendCard range={range} />
					</div>
				</TabsContent>

				<TabsContent value="tasks" className="flex flex-col gap-6">
					<TokenUseByTaskCard
						range={range}
						lens={search.tokenLens}
						measure={search.tokenMeasure}
						split={search.tokenSplit}
						search={search.tokenSearch}
						onLensChange={(tokenLens) => setTokenUse({ tokenLens })}
						onMeasureChange={(tokenMeasure) => setTokenUse({ tokenMeasure })}
						onSplitChange={(tokenSplit) => setTokenUse({ tokenSplit })}
						onSearchChange={(tokenSearch) => setTokenUse({ tokenSearch })}
					/>
				</TabsContent>

				<TabsContent value="adoption" className="flex flex-col gap-6">
					{adoptionIsLocked ? (
						<>
							<CommitTrackingCallout
								title="Which repositories are your agents actually shipping to?"
								description="Turn on commit tracking to rank every repository by the agent commits landing in it, and see where adoption is real rather than assumed. Metadata only — no source code leaves a member's machine."
							/>
							<SampleChartPreview>
								<AdoptionSample />
							</SampleChartPreview>
						</>
					) : commitAttributionPending ? (
						<AttributionWarmUp coverageStart={null} unlocksOn={null} historyDays={RANGE_HISTORY_DAYS} />
					) : (
						<AgentCommitsByRepoCard range={range} />
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}
