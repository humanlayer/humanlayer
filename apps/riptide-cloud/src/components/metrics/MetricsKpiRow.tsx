import { Card } from '@humanlayer/ui/components/card'
import { Skeleton } from '@humanlayer/ui/components/skeleton'
import { cn } from '@humanlayer/ui/lib/utils'
import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'

import {
	computeKpiTotals,
	formatUsdCompact,
	formatUsdPerLine,
	formatUsdRatio,
	LOW_VOLUME_LOC_FLOOR,
	spendCoverageSuspect,
} from './kpis'
import { LENS_DEFINITIONS, lensDenominatorLabel, lensRatio, type MetricLens } from './lenses'
import { type MetricsRange, formatRangeLength } from './range'
import { useUnitCostTrend } from './useUnitCostTrend'
import { useUsersScatter } from './useUsersScatter'

export interface MetricsKpiRowProps {
	className?: string
	range: MetricsRange
	/** Lenses whose data pipeline is on (see availableLenses) — one card each. */
	lenses: readonly MetricLens[]
	/** The active lens — this card renders emphasized and drives the page. */
	lens: MetricLens
	onLensChange: (lens: MetricLens) => void
}

/** Grid classes per card count — Tailwind can't build class names at runtime. */
function gridColumns(cardCount: number): string {
	switch (cardCount) {
		case 1:
			return 'grid gap-6'
		case 2:
			return 'grid gap-6 sm:grid-cols-2'
		default:
			return 'grid gap-6 sm:grid-cols-3'
	}
}

/**
 * The spend-coverage heuristic compares a range against its most recent HALF.
 *
 * It used to compare fixed windows (8w against its last 4, 12w against its
 * last 8), which only worked because there were three of them. A dragged range
 * has no "next shorter" sibling, so the comparison is now structural: if the
 * whole range's spend equals its second half's to the cent while its output
 * kept growing, the numerator does not reach back as far as the denominator.
 * Same signal, no lookup table.
 */
/** Buckets below this and the halves are too small for the comparison to mean anything. */
const MIN_COVERAGE_COMPARISON_BUCKETS = 4

/**
 * The page's three unit-cost cards — one numerator (token spend), three
 * denominators — doubling as the LENS SELECTOR: clicking a card re-axes the
 * hero scatter and re-denominates the trend chart below. All three stay
 * visible (comparing $/commit to $/kLOC to $/PR side-by-side IS this row's
 * value); the active one drives everything else.
 *
 * Each subheader shows the working of its ratio (`$3.1K ÷ 146.6K LOC
 * changed`), so total spend appears on every card and each denominator's
 * total on its own card — the old standalone "Token spend" / "LOC changed"
 * tiles live on here as arithmetic rather than pretending to be KPIs.
 *
 * Everything derives client-side from queries other cards on the page already
 * make — usersScatter for the totals, unitCostTrend for the coverage check —
 * so this row adds no requests (TanStack Query dedupes the keys).
 *
 * The cards are RANGE totals, so the bucket size never touches them: $22.59
 * per kLOC is the same number in weekly and daily views, which is exactly the
 * property that makes a granularity toggle safe to offer.
 */
export function MetricsKpiRow({ className, range, lenses, lens, onLensChange }: MetricsKpiRowProps) {
	const { data: scatterData, isLoading, error } = useUsersScatter(range)
	const { data: trendData } = useUnitCostTrend(range)

	const totals = useMemo(() => (scatterData ? computeKpiTotals(scatterData.data) : null), [scatterData])

	// The coverage heuristic compares the full range against its most recent
	// half. The trend endpoint's dense rows give both from the one query
	// UnitCostTrendCard already makes — no second scatter fetch just to re-sum
	// a shorter range. Lead-in buckets are excluded: they sit outside the range
	// the cards describe, so counting them would compare two different spans.
	const coverageSuspect = useMemo(() => {
		if (!trendData) return false
		const rows = trendData.data
			.filter((row) => row.inRange)
			.sort((a, b) => (a.bucketStart < b.bucketStart ? -1 : 1))
		if (rows.length < MIN_COVERAGE_COMPARISON_BUCKETS) return false
		const sum = (subset: typeof rows) => ({
			costUsd: subset.reduce((acc, row) => acc + row.costUsd, 0),
			locChanged: subset.reduce((acc, row) => acc + row.locChanged, 0),
		})
		const half = Math.floor(rows.length / 2)
		return spendCoverageSuspect(sum(rows), sum(rows.slice(-half)))
	}, [trendData])

	// The scatter already renders a prominent error card (with Sentry capture)
	// for this exact query — a second failure surface here would just be noise.
	if (error) return null

	if (isLoading || !totals) {
		return (
			<div className={cn(gridColumns(lenses.length), className)}>
				{lenses.map((key) => (
					<Card key={key} className="gap-1 p-4">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="mt-2 h-9 w-24" />
						<Skeleton className="mt-1 h-3 w-40" />
					</Card>
				))}
			</div>
		)
	}

	// Same floor as the tooltip: below it the org kLOC ratio is noise.
	const locLowVolume = totals.locChanged > 0 && totals.locChanged < LOW_VOLUME_LOC_FLOOR

	return (
		// A group of toggle buttons, NOT role="tablist": the tabs pattern
		// promises roving tabindex + arrow-key navigation + tabpanel semantics
		// we don't implement — announcing a contract we don't honor is worse
		// than plain pressed-state buttons.
		<div className={cn(gridColumns(lenses.length), className)} role="group" aria-label="Unit-cost lens">
			{lenses.map((key) => {
				const definition = LENS_DEFINITIONS[key]
				const ratio = lensRatio(totals, key)
				const lowVolume = key === 'kloc' && locLowVolume
				// No coverage caveat here: the range is clamped to what attribution
				// covers before any card queries it (see clampRangeToCoverage), so
				// a tile never has to apologise for its own denominator.
				const value = ratio === null || lowVolume ? '—' : formatUsdRatio(ratio)
				const subline =
					ratio === null
						? key === 'prs'
							? 'no PRs merged in range'
							: 'no tracked commits in range'
						: lowVolume
							? `low volume — under ${LOW_VOLUME_LOC_FLOOR.toLocaleString()} lines changed in range`
							: `${formatUsdCompact(totals.costUsd)} ÷ ${lensDenominatorLabel(totals, key)}${
									key === 'kloc' && ratio !== null ? ` · ≈ ${formatUsdPerLine(ratio)} per line` : ''
								}`
				return (
					<LensCard
						key={key}
						label={definition.kpiLabel}
						value={value}
						unit={ratio !== null && !lowVolume ? definition.unit : undefined}
						subline={subline}
						active={key === lens}
						onSelect={() => onLensChange(key)}
						warning={
							ratio !== null && !lowVolume && coverageSuspect
								? `spend history may not cover this full ${formatRangeLength(range)}`
								: undefined
						}
					/>
				)
			})}
		</div>
	)
}

interface LensCardProps {
	label: string
	value: string
	unit?: string
	subline: string
	warning?: string
	active: boolean
	onSelect: () => void
}

/**
 * A KPI tile that is also a tab. Rendered as a button so it's keyboard- and
 * screen-reader-operable; the active card keeps the primary emphasis the old
 * hero tile had, now meaning "this is the lens" rather than "this is the
 * important number".
 */
function LensCard({ label, value, unit, subline, warning, active, onSelect }: LensCardProps) {
	return (
		<Card
			role="button"
			aria-pressed={active}
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					onSelect()
				}
			}}
			className={cn(
				'cursor-pointer gap-1 p-4 text-left transition-colors',
				active ? 'border-primary/60 bg-primary/5' : 'hover:border-muted-foreground/40',
			)}
		>
			<div className="flex items-baseline justify-between gap-2">
				<div className="text-sm text-muted-foreground">{label}</div>
				{/* Layout reservation: transparent on inactive cards so the header
				    height never shifts on lens change. aria-hidden — aria-pressed
				    on the card already announces the state. */}
				<div
					aria-hidden="true"
					className={cn(
						'text-[10px] font-medium uppercase tracking-wide',
						active ? 'text-primary' : 'text-transparent',
					)}
				>
					lens
				</div>
			</div>
			<div className={cn('text-3xl font-semibold', active && 'text-primary')}>
				{value}
				{unit ? <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span> : null}
			</div>
			<div className="text-xs text-muted-foreground">{subline}</div>
			{warning ? (
				<div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
					<TriangleAlert className="size-3 shrink-0" />
					{warning}
				</div>
			) : null}
		</Card>
	)
}
