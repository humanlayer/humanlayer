import type { TokenUseMeasure } from '@humanlayer/riptide-api-contract/api/metrics/tokenUseByTask'
import { Button } from '@humanlayer/ui/components/button'
import { Input } from '@humanlayer/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Search, X } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { useOrgMembers } from '@/hooks/useOrgMembers'
import { taskAppUrl } from '@/lib/app-links'

import { formatUsdCompact, formatUsdExact, formatUsdWhole } from './kpis'
import { MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import {
	MODE_ORDER,
	modeColorVar,
	modeDisplayName,
	NO_STAGE_KEY,
	STAGE_ORDER,
	stageColorVar,
	stageDisplayName,
} from './stageAttribution'
import {
	AGENT_COLORS,
	AGENT_LABELS,
	AGENT_ORDER,
	barWidthPercent,
	contributorMarkLabel,
	formatShare,
	formatTokens,
	LENS_LABELS,
	lensQuestion,
	MEASURE_LABELS,
	measureValue,
	modelSeriesLookup,
	otherMeasure,
	personSeriesLookup,
	rankModelSeries,
	rankPersonSeries,
	SERIES_COLOR,
	SPLIT_LABELS,
	showsContributorMark,
	splitSegmentsBar,
	supportsSplit,
	taskLabelParts,
	TOKEN_USE_LENSES,
	TOKEN_USE_SPLITS,
	type TokenUseLens,
	type TokenUseSplit,
} from './tokenUse'
import { useTaskFanOut } from './useTaskFanOut'
import { useTokenUseByTask } from './useTokenUseByTask'

export interface TokenUseByTaskCardProps {
	className?: string
	range: MetricsRange
	lens: TokenUseLens
	measure: TokenUseMeasure
	split: TokenUseSplit
	search: string
	onLensChange: (lens: TokenUseLens) => void
	onMeasureChange: (measure: TokenUseMeasure) => void
	onSplitChange: (split: TokenUseSplit) => void
	onSearchChange: (search: string) => void
}

/* ─────────────────────────── shared pieces ─────────────────────────── */

function Segmented<T extends string>({
	label,
	options,
	value,
	disabled,
	onChange,
}: {
	label: string
	options: readonly { value: T; label: string }[]
	value: T
	disabled?: boolean
	onChange: (next: T) => void
}) {
	return (
		<div className="flex overflow-hidden rounded-md border" role="group" aria-label={label}>
			{options.map((option, index) => (
				<Button
					key={option.value}
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
					className={cn(
						'h-7 rounded-none px-3 text-[10px] font-medium tracking-wider uppercase',
						index > 0 && 'border-l',
						value === option.value && 'bg-primary text-primary-foreground hover:bg-primary',
					)}
				>
					{option.label}
				</Button>
			))}
		</div>
	)
}

/**
 * The split control.
 *
 * A combo box, not a sixth-and-seventh segmented button. Six options is where
 * a segmented control stops working: the row wrapped to two lines beside the
 * lens toggle, and the buttons became the widest thing in the card header
 * while naming the least important piece of state. A select states the current
 * split in one chip and hides the rest until asked.
 */
function SplitSelect({
	value,
	disabled,
	onChange,
}: {
	value: TokenUseSplit
	disabled?: boolean
	onChange: (next: TokenUseSplit) => void
}) {
	return (
		<Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as TokenUseSplit)}>
			<SelectTrigger
				size="sm"
				aria-label="Split"
				className="h-7 gap-1.5 px-2.5 text-[10px] font-medium tracking-wider uppercase"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				{TOKEN_USE_SPLITS.map((option) => (
					<SelectItem key={option} value={option} className="text-xs">
						{SPLIT_LABELS[option]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

/**
 * A link to a task's page.
 *
 * The real task page — sessions, composer, the working view — lives in
 * riptide-ui, so this is an EXTERNAL anchor to the app origin whenever that
 * origin was built in. Where it was not (local dev, mock builds) it degrades
 * to the in-app artifacts route, which always exists.
 *
 * Never the bare `/tasks/$taskId`: that is a LAYOUT route with an Outlet and
 * no index child, so it renders an empty page. It typechecks, because a layout
 * route is a legal navigation target — which is exactly how it shipped broken.
 */
function TaskLink({
	taskId,
	className,
	title,
	ariaLabel,
	children,
}: {
	taskId: string
	className?: string
	title?: string
	ariaLabel?: string
	children: React.ReactNode
}) {
	const href = taskAppUrl(taskId)
	// Same tab, matching every other link in this card. Both branches are real
	// anchors underneath, so middle-click and "copy link address" work.
	if (href) {
		return (
			<a href={href} className={className} title={title} aria-label={ariaLabel}>
				{children}
			</a>
		)
	}
	return (
		<Link
			to="/tasks/$taskId/artifacts"
			params={{ taskId }}
			className={className}
			title={title}
			aria-label={ariaLabel}
		>
			{children}
		</Link>
	)
}

/** Uppercase micro-heading used above each sub-block inside the card. */
function BlockLabel({ children }: { children: React.ReactNode }) {
	return <p className="text-muted-foreground mb-2 text-[10px] tracking-widest uppercase">{children}</p>
}

/**
 * The row grid, shared by the header strip and every task.
 *
 * Rank, name, bar, figures and the link each own a column, so a long task name
 * cannot push a number out of line. Written once because the header and the
 * rows MUST agree — a header whose columns drift from the data underneath is
 * worse than no header.
 */
const ROW_GRID = 'grid grid-cols-[1.5rem_minmax(0,1fr)_10.5rem_auto_1.125rem] items-center gap-3'
const FIGURE_GRID = 'grid grid-cols-[4.75rem_4.5rem_4rem] gap-x-3 text-right text-[11px] tabular-nums'

interface TaskBarSegment {
	key: string
	label: string
	value: number
	color: string
}

function taskBarSegments(
	split: TokenUseSplit,
	segments: {
		agent: TaskBarSegment[]
		model: TaskBarSegment[]
		stage: TaskBarSegment[]
		person: TaskBarSegment[]
	},
): TaskBarSegment[] {
	if (!splitSegmentsBar(split)) return []
	if (split === 'agent') return segments.agent
	if (split === 'model') return segments.model
	if (split === 'stage') return segments.stage
	return segments.person
}

function taskListStatus(
	rowCount: number,
	search: string,
	isFetchingNextPage: boolean,
	isFetchNextPageError: boolean,
	hasNextPage: boolean,
): string {
	if (rowCount === 0) return `No task matches “${search}”`
	if (isFetchingNextPage) return 'Loading more…'
	// The loaded rows stay on screen: losing page 6 is no reason to throw away pages 1 to 5.
	if (isFetchNextPageError) return 'Could not load more tasks'
	if (hasNextPage) return 'Scroll for more'
	const taskSuffix = rowCount === 1 ? '' : 's'
	return `End of list · ${rowCount} task${taskSuffix}`
}

/* ───────────────────────────── tasks lens ───────────────────────────── */

function TasksLens({
	range,
	measure,
	split,
	search,
	onMeasureChange,
	onSearchChange,
}: {
	range: MetricsRange
	measure: TokenUseMeasure
	split: TokenUseSplit
	search: string
	onMeasureChange: (measure: TokenUseMeasure) => void
	onSearchChange: (search: string) => void
}) {
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = useTokenUseByTask(
		range,
		measure,
		search,
	)

	// Every page carries the same matched-set totals; page one is the one that
	// always exists once anything has loaded.
	const first = data?.pages[0]
	const rows = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data])
	const matched = first?.matched
	// THE bar scale, from the server and not from the loaded rows: it must not
	// move as pages arrive or as a filter changes which task ranks first.
	const max = first?.maxValue ?? 0
	// What the rows ON SCREEN are ranked by, which is not the same as what the
	// header asks for: the previous page stays up while a flipped measure loads,
	// and dividing the new measure by the old one's maximum would collapse every
	// bar to its floor for the length of the fetch. `measure` still drives the
	// header, so the caret moves the instant you click.
	const shown = first?.measure ?? measure
	const format = shown === 'cost' ? formatUsdWhole : formatTokens
	// Whole dollars are right for the COLUMN, where the scale is a task total
	// and the decimals are noise. They are wrong for a tooltip about a BAND: a
	// band is a fraction of that total, so a $12 task split four ways would
	// report every band as "$0". Tooltips get exact dollars, matching the row
	// title and the fan-out tooltip.
	const formatExact = shown === 'cost' ? formatUsdExact : formatTokens

	// Ranked once for the whole list, not per row, so every bar paints the same
	// model the same colour. Memoized on `rows` alone — the ranking is by spend
	// and must not move when the measure flips.
	const models = useMemo(() => rankModelSeries(rows), [rows])
	const modelSeries = useMemo(() => modelSeriesLookup(models), [models])

	// Names for the by-person split. Its loading state is NOT folded into the
	// card's the way the two Spend-by-person cards fold theirs: this list is
	// useful under every other split while members are still in flight, and
	// blocking the whole card on a query only one split needs would be a worse
	// trade. A row that resolves late falls back to the raw id in the meantime.
	const { memberFor } = useOrgMembers()
	const nameFor = useCallback((userId: string) => memberFor(userId)?.displayName, [memberFor])
	const people = useMemo(() => rankPersonSeries(rows, nameFor), [rows, nameFor])
	const personSeries = useMemo(() => personSeriesLookup(people), [people])

	// Filtered to what is on screen, per split. Stages and modes come from their
	// canonical vocabularies (so the hues match the Workflow tab); agents, models
	// and people come from the page's own ranking.
	//
	// The filters test the MEASURE, not mere presence, because the segment
	// builder drops any band worth zero. A stage the range touched but never
	// billed for (`rpi:plan` is $0.07 on dev, and 0 on a seeded stack) has a row
	// in the payload and no band in any bar — on a presence test it appeared in
	// the legend naming a colour the reader could not find anywhere.
	const legendEntries = useMemo(() => {
		switch (split) {
			case 'agent':
				return AGENT_ORDER.filter((agent) =>
					rows.some((row) =>
						row.agents.some((entry) => entry.agent === agent && measureValue(entry, shown) > 0),
					),
				).map((agent) => ({ key: agent, label: AGENT_LABELS[agent], color: AGENT_COLORS[agent] }))
			case 'stage':
				return STAGE_ORDER.concat(NO_STAGE_KEY)
					.filter((stage) =>
						rows.some((row) =>
							row.stages.some((entry) => entry.stage === stage && measureValue(entry, shown) > 0),
						),
					)
					.map((stage) => ({ key: stage, label: stageDisplayName(stage), color: stageColorVar(stage) }))
			case 'mode':
				return MODE_ORDER.filter((mode) => rows.some((row) => row.mode === mode)).map((mode) => ({
					key: mode,
					label: modeDisplayName(mode),
					color: modeColorVar(mode),
				}))
			case 'person':
				return people
			case 'model':
				return models
			default:
				return []
		}
	}, [split, rows, models, people, shown])

	// React Query owns the paging itself (see useTokenUseByTask); all this adds
	// is WHEN to ask for the next page. An IntersectionObserver on a sentinel
	// after the last row, wired through a callback ref — the repo's no-useEffect
	// idiom, same as WiredMobileArtifactSheet.
	//
	// Not scroll-position arithmetic, which cannot fire when there is nothing to
	// scroll: a page that fails to fill the box produces no scroll event, and
	// the list would sit there with more to fetch and no way to ask. A sentinel
	// that is already on screen fires on its own, so the list keeps pulling
	// until the box is full.
	const observeSentinel = useCallback(
		(sentinel: HTMLDivElement) => {
			const observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
				},
				{
					// The scroll box, read from the DOM rather than held in a ref:
					// React attaches child refs before parent ones, so a ref on the
					// container is still null while this runs on mount.
					root: sentinel.parentElement,
					// A row-height of slack, so the fetch is in flight before the
					// reader actually reaches the end.
					rootMargin: '96px',
				},
			)
			observer.observe(sentinel)
			return () => observer.disconnect()
		},
		[fetchNextPage],
	)

	const secondary = otherMeasure(measure)

	return (
		<div className="flex flex-col">
			{/* Its own band between the card's controls and the column headers,
			    pushed right so it reads as belonging to the table below it rather
			    than to the lens/split controls above. Inside this component
			    because it filters THIS list — the fan-out lens has nothing to
			    filter, and it should not have to render a disabled box. */}
			<div className="mb-2.5 flex justify-end">
				<div className="relative">
					<Search
						className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2"
						aria-hidden
					/>
					<Input
						value={search}
						onChange={(event) => onSearchChange(event.target.value)}
						// Short enough to fit the box. The long form was truncated to
						// "Filter tasks or tick", which read worse than saying less.
						placeholder="Filter by task"
						aria-label="Filter tasks"
						className="h-7 w-56 pr-7 pl-7 text-xs"
					/>
					{search ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Clear filter"
							onClick={() => onSearchChange('')}
							className="absolute top-1/2 right-0 h-7 w-7 -translate-y-1/2 p-0"
						>
							<X className="size-3" aria-hidden />
						</Button>
					) : null}
				</div>
			</div>

			{/* overscroll-contain: the page already scrolls in an inner container,
			    so without it reaching the end of this list keeps scrolling that. */}
			<div className="max-h-[22rem] overflow-y-auto overscroll-contain pr-1.5">
				{/* Sticky INSIDE the list, so it holds while rows pass under it and
				    never floats over the rest of the page. */}
				<div
					className={cn(
						ROW_GRID,
						'bg-card sticky top-0 z-10 items-end border-b px-1 pb-1.5',
						'text-muted-foreground text-[9.5px] tracking-wider uppercase',
					)}
				>
					<span>#</span>
					<span>Task</span>
					<span>
						<span className="sr-only">{MEASURE_LABELS[shown]}</span>
					</span>
					<span className={cn(FIGURE_GRID, 'text-[9.5px] tracking-wider')}>
						{/* The two figure headers ARE the sort control: the measure
						    already decides the ranking and the bar, so a separate
						    Tokens/Cost toggle would be a second control for one
						    piece of state. Sessions is display-only — ranking by it
						    would leave the bars, which show the measure, running in
						    no order at all. */}
						<button
							type="button"
							onClick={() => onMeasureChange(measure)}
							aria-pressed
							className="text-primary text-right tracking-wider uppercase"
						>
							{MEASURE_LABELS[measure]} ▾
						</button>
						<button
							type="button"
							onClick={() => onMeasureChange(secondary)}
							aria-pressed={false}
							className="hover:text-foreground text-right tracking-wider uppercase"
						>
							{MEASURE_LABELS[secondary]}
						</button>
						<span>Sess</span>
					</span>
					<span className="sr-only">Open</span>
				</div>

				<ul className="mt-1.5 flex list-none flex-col gap-0 p-0">
					{rows.map((row, index) => {
						const value = measureValue(row, shown)
						const { ticket, name } = taskLabelParts(row.name, row.ticketId)
						// Both splits paint in a FIXED order, never in each row's own
						// rank order: a task missing an agent or a model must not
						// repaint the hues of the ones that remain. flatMap (not map +
						// filter) so empties drop with the type narrowed.
						const agentSegments = AGENT_ORDER.flatMap((agent) => {
							const entry = row.agents.find((candidate) => candidate.agent === agent)
							const segmentValue = entry ? measureValue(entry, shown) : 0
							return segmentValue > 0
								? [
										{
											key: agent,
											label: AGENT_LABELS[agent],
											value: segmentValue,
											color: AGENT_COLORS[agent],
										},
									]
								: []
						})
						// Models fold past the cap, so several of a row's models can
						// land in the same band — accumulate rather than emitting
						// duplicates.
						const modelTotals = new Map<string, { value: number; color: string }>()
						for (const entry of row.models) {
							const found = modelSeries(entry.model)
							if (!found) continue
							const segmentValue = measureValue(entry, shown)
							if (segmentValue <= 0) continue
							const current = modelTotals.get(found.key)
							modelTotals.set(found.key, {
								value: (current?.value ?? 0) + segmentValue,
								color: found.color,
							})
						}
						// flatMap over the ranked series (not over the map) so the
						// bands paint in the card's fixed colour order on every row.
						const modelSegments = models.flatMap((entry) => {
							const total = modelTotals.get(entry.key)
							return total
								? [{ key: entry.key, label: entry.label, value: total.value, color: total.color }]
								: []
						})

						// Stages paint in the RPI progression order, not in the row's own
						// rank order, so a task that skipped research does not repaint
						// the stages it did run. Same rule as agents.
						const stageSegments = STAGE_ORDER.concat(NO_STAGE_KEY).flatMap((stage) => {
							const entry = row.stages.find((candidate) => candidate.stage === stage)
							const segmentValue = entry ? measureValue(entry, shown) : 0
							return segmentValue > 0
								? [
										{
											key: stage,
											label: stageDisplayName(stage),
											value: segmentValue,
											color: stageColorVar(stage),
										},
									]
								: []
						})
						// People fold past the cap exactly like models, so several of a
						// row's contributors can land in the same band — accumulate
						// rather than emitting duplicates.
						const personTotals = new Map<string, { value: number; color: string }>()
						for (const entry of row.contributors) {
							const found = personSeries(entry.userId)
							if (!found) continue
							const segmentValue = measureValue(entry, shown)
							if (segmentValue <= 0) continue
							const current = personTotals.get(found.key)
							personTotals.set(found.key, {
								value: (current?.value ?? 0) + segmentValue,
								color: found.color,
							})
						}
						const personSegments = people.flatMap((entry) => {
							const total = personTotals.get(entry.key)
							return total
								? [{ key: entry.key, label: entry.label, value: total.value, color: total.color }]
								: []
						})

						// `none` and `mode` produce no bands at all — see splitSegmentsBar.
						// Guarding on it rather than letting the chain fall through to []
						// keeps the one rule in one place.
						const segments = taskBarSegments(split, {
							agent: agentSegments,
							model: modelSegments,
							stage: stageSegments,
							person: personSegments,
						})

						// `mode` is the one split that does not segment: the task has a
						// single workflow_type, so it recolours the whole bar. See
						// splitSegmentsBar.
						const barColor = split === 'mode' ? modeColorVar(row.mode) : SERIES_COLOR

						return (
							<li
								key={row.taskId}
								className={cn(ROW_GRID, 'hover:bg-muted/60 group rounded-sm px-1 py-[3px]')}
								title={[
									ticket ? `${ticket} — ${name}` : name,
									`${formatTokens(row.tokens)} tokens · ${formatUsdExact(row.costUsd)} · ${row.sessionCount} sessions`,
									`${formatShare(row.tokens, matched?.tokens ?? 0)} of the matching tasks’ tokens`,
									`${row.contributorCount} contributor${row.contributorCount === 1 ? '' : 's'} · ${row.modelCount} model${row.modelCount === 1 ? '' : 's'}`,
									// Always, not only under the mode split: it is one more
									// fact about the task, and it is the only place the mode
									// is named now that the tinted bar carries no title.
									`mode: ${modeDisplayName(row.mode)}`,
								].join('\n')}
							>
								{/* A stable address for a row, once the list is long
								    enough that "the third one" stops being findable. */}
								<span className="text-muted-foreground/70 text-[10.5px] tabular-nums">{index + 1}</span>

								<div className="flex min-w-0 items-baseline gap-2">
									{/* The NAME is the link, not just the icon at the end
									    of the row. A 12px glyph is a poor target for the
									    one thing every row is about, and the name is what
									    a reader points at. The icon stays as the visible
									    hint that the row goes somewhere. */}
									<TaskLink
										taskId={row.taskId}
										// Dotted and faint at REST, solid accent on hover. A
										// link inside a dense table has to say so without
										// hovering — the alternative was colouring the name,
										// but the ticket chip and the contributor mark are
										// both already `text-primary`, so that would erase
										// the difference between "this is a ticket" and
										// "this is a link" and turn the whole column blue.
										// At 40% the decoration reads as texture, not as 25
										// blue rules.
										className="hover:text-primary focus-visible:text-primary decoration-muted-foreground/40 truncate text-xs underline decoration-dotted underline-offset-[3px] hover:decoration-current hover:decoration-solid"
									>
										{ticket ? <span className="text-primary">{ticket} </span> : null}
										{name}
									</TaskLink>
									{/* Only on the exceptions — see showsContributorMark. */}
									{showsContributorMark(row.contributorCount) ? (
										<span className="text-primary shrink-0 text-[10px]">
											{contributorMarkLabel(row.contributorCount)}
										</span>
									) : null}
								</div>

								<div className="flex h-2 gap-0.5" style={{ width: `${barWidthPercent(value, max)}%` }}>
									{segments.length > 0 ? (
										// A real tooltip, not a `title`. The legend pairs a
										// colour with a name, but at four bands in a 168px bar
										// the reader still has to match a 6px sliver against a
										// swatch by eye — and a folded band ("other (3)") has
										// no single colour a legend can disambiguate at all.
										// Same component and same shape as StackedShareBars,
										// which solves this on the Workflow tab.
										segments.map((segment) => (
											<Tooltip key={segment.key}>
												<TooltipTrigger asChild>
													{/* tabIndex + aria-label copied from
													    StackedShareBars for the same reason:
													    Radix opens on pointer-move or focus and
													    ignores touch, so without a tab stop the
													    per-band figures are mouse-only, and a
													    focusable element with no text needs an
													    accessible name. */}
													<span
														tabIndex={0}
														aria-label={`${segment.label}, ${formatExact(segment.value)}, ${formatShare(segment.value, value)} of this task`}
														// min-w-px because the row floor sizes the
														// WHOLE bar, not its bands: the lightest
														// tasks draw at the 1.5% floor, and split
														// four ways each band is half a pixel and
														// vanishes — a row with four models would
														// then show none of them.
														className="focus-visible:ring-ring block h-full min-w-px first:rounded-l-[2px] last:rounded-r-[2px] focus-visible:ring-1 focus-visible:ring-inset focus-visible:outline-none"
														style={{
															width: `${(segment.value / value) * 100}%`,
															background: segment.color,
														}}
													/>
												</TooltipTrigger>
												{/* Same surface override as StackedShareBars. The base
											    TooltipContent is `bg-primary`, on which
											    `text-muted-foreground` is nearly illegible — that
											    token is tuned for the page background. On
											    `bg-background` the card palette applies and the
											    second line reads. `border` (the width) too,
											    because the base carries no border utility. */}
												<TooltipContent
													side="top"
													className="border-border/50 bg-background text-foreground border shadow-xl"
													arrowClassName="bg-background fill-background"
												>
													<div className="grid gap-1">
														<div className="flex items-center gap-1.5 font-medium">
															<i
																className="inline-block size-2 shrink-0 rounded-[2px]"
																style={{ background: segment.color }}
																aria-hidden
															/>
															{segment.label}
														</div>
														<div className="text-muted-foreground tabular-nums">
															{formatExact(segment.value)} ·{' '}
															{formatShare(segment.value, value)} of this task
														</div>
													</div>
												</TooltipContent>
											</Tooltip>
										))
									) : (
										// No title of its own, deliberately. A child title
										// SHADOWS its ancestor's, and this div spans the whole
										// bar column — naming the mode here replaced the row's
										// tooltip (name, tokens, cost, sessions, share,
										// contributors) with one word, which is less than there
										// was before the split existed. The mode is in the row
										// title instead, so hovering anywhere gives both. Bands
										// are different: they are narrow, so shadowing costs a
										// sliver and the rest of the row still answers.
										<div
											className="h-full w-full rounded-r-[2px]"
											style={{ background: barColor }}
										/>
									)}
								</div>

								{/* Three FIXED-WIDTH right-aligned cells, not one string
								    with separators: "1.40B · $1.1K · 12s" and "952.0M ·
								    $507.5 · 8s" are different widths, so a single run of
								    text makes the dots wander down the column. */}
								{/* One treatment for all three, and ORDER alone says which
								    figure leads: the active measure sits first, next to
								    the bar that draws it. They were foreground, muted and
								    muted/70, which read as three levels of importance and
								    were hard to read at 11px. The weight bump on the
								    first cell went with them (d8944d5cc on main) — it
								    duplicated what position already said. */}
								<div className={cn(FIGURE_GRID, 'text-foreground items-baseline')}>
									<span>{format(value)}</span>
									<span>
										{shown === 'cost' ? formatTokens(row.tokens) : formatUsdWhole(row.costUsd)}
									</span>
									{/* "12s" reads as twelve seconds; spell the unit. */}
									<span>{row.sessionCount} sess</span>
								</div>

								{/* The row's own page, in this tab. NOT /deep/tasks/$id:
								    that route tries the desktop app first and flashes an
								    "Opening in HumanLayer…" card, which is wrong for a
								    click inside the web app. See TaskLink. */}
								<TaskLink
									taskId={row.taskId}
									ariaLabel={`Open ${name}`}
									title={`Open ${name}`}
									className="text-muted-foreground/40 hover:text-primary group-hover:text-muted-foreground focus-visible:text-primary flex size-[18px] items-center justify-center transition-colors"
								>
									<ExternalLink className="size-3" aria-hidden />
								</TaskLink>
							</li>
						)
					})}
				</ul>

				{/* Mounted only while there is a page to fetch and none in flight, so
				    the guard lives in the render and the observer callback can never
				    close over a stale one. A fetch unmounts it; the page landing
				    remounts it, which fires again if it is still on screen. */}
				{/* Also gated on the error: without that, a page that keeps failing
				    would remount the sentinel, fire the observer, fail, remount…
				    hammering the API in a loop. On failure the reader gets a button
				    instead, so the retry is a decision rather than a spin. */}
				{hasNextPage && !isFetchingNextPage && !isFetchNextPageError ? (
					<div ref={observeSentinel} aria-hidden />
				) : null}

				<p className="text-muted-foreground py-3 text-center text-[10px] tracking-wider uppercase">
					{taskListStatus(rows.length, search, isFetchingNextPage, isFetchNextPageError, hasNextPage)}
				</p>

				{isFetchNextPageError ? (
					<div className="flex justify-center pb-3">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-6 text-[10px]"
							onClick={() => void fetchNextPage()}
						>
							Retry
						</Button>
					</div>
				) : null}
			</div>

			{/* A legend is always present once colour carries meaning — identity
			    must never rest on colour alone. That includes `mode`, which
			    tints rather than segments: the reader still has to be told what
			    the hue of a whole bar means. Every branch is filtered to what is
			    ON SCREEN, so the legend never names a series no bar carries. */}
			{split !== 'none' && rows.length > 0 ? (
				<div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
					{legendEntries.map((entry) => (
						<span key={entry.key} className="inline-flex items-center gap-1.5">
							<i
								className="inline-block size-2 shrink-0 rounded-[2px]"
								style={{ background: entry.color }}
								aria-hidden
							/>
							{entry.label}
						</span>
					))}
				</div>
			) : null}

			<div className="text-muted-foreground mt-3 flex justify-between border-t pt-2.5 text-[10.5px] tabular-nums">
				<span>
					Showing {rows.length} of {matched?.taskCount ?? 0} {search ? 'matching ' : ''}task
					{(matched?.taskCount ?? 0) === 1 ? '' : 's'} · {formatTokens(matched?.tokens ?? 0)} ·{' '}
					{formatUsdCompact(matched?.costUsd ?? 0)}
				</span>
				<span>Sorted by {shown === 'cost' ? 'cost' : 'tokens'}, highest first</span>
			</div>
		</div>
	)
}

/* ──────────────────────────── fan-out lens ──────────────────────────── */

function FanOutLens({ range }: { range: MetricsRange }) {
	const { data } = useTaskFanOut(range)

	const blocks = [
		{
			title: 'Contributors per task',
			buckets: data?.contributors ?? [],
			unit: (count: number, folded: boolean) =>
				`${count}${folded ? '+' : ''} ${count === 1 && !folded ? 'person' : 'people'}`,
		},
		{
			title: 'Coding agents per task',
			buckets: data?.agents ?? [],
			unit: (count: number, folded: boolean) =>
				`${count}${folded ? '+' : ''} agent${count === 1 && !folded ? '' : 's'}`,
		},
		{
			title: 'Models per task',
			buckets: data?.models ?? [],
			unit: (count: number, folded: boolean) =>
				folded ? `${count} or more` : `${count} model${count === 1 ? '' : 's'}`,
		},
	]

	const totalTasks = data?.taskCount ?? 0
	const totalTokens = data?.tokens ?? 0

	return (
		<div className="flex flex-col">
			<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{blocks.map((block) => (
					<div key={block.title}>
						<BlockLabel>{block.title}</BlockLabel>
						{block.buckets.map((bucket) => {
							const taskShare = totalTasks > 0 ? (bucket.taskCount / totalTasks) * 100 : 0
							const tokenShare = totalTokens > 0 ? (bucket.tokens / totalTokens) * 100 : 0
							return (
								<div
									key={`${bucket.count}-${bucket.folded}`}
									className="mb-2 grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2.5"
									title={`${block.unit(bucket.count, bucket.folded)}\n${bucket.taskCount} of ${totalTasks} tasks (${formatShare(bucket.taskCount, totalTasks)})\n${formatTokens(bucket.tokens)} tokens (${formatShare(bucket.tokens, totalTokens)}) · ${formatUsdExact(bucket.costUsd)}`}
								>
									<span className="text-xs">{block.unit(bucket.count, bucket.folded)}</span>
									<div>
										<div className="flex flex-col gap-0.5">
											<div
												className="bg-muted-foreground/35 h-1.5 rounded-r-[2px]"
												style={{ width: `${Math.max(taskShare, 0.6)}%` }}
											/>
											<div
												className="h-1.5 rounded-r-[2px]"
												style={{
													width: `${Math.max(tokenShare, 0.6)}%`,
													background: SERIES_COLOR,
												}}
											/>
										</div>
										<div className="text-muted-foreground mt-0.5 text-[10px] tabular-nums">
											{bucket.taskCount} tasks · {formatShare(bucket.tokens, totalTokens)} of
											tokens
										</div>
									</div>
								</div>
							)
						})}
					</div>
				))}
			</div>
			<div className="text-muted-foreground mt-3 flex flex-wrap gap-3 border-t pt-3 text-[10.5px]">
				<span className="inline-flex items-center gap-1.5">
					<i className="bg-muted-foreground/35 inline-block size-2 rounded-[2px]" aria-hidden />
					Share of tasks
				</span>
				<span className="inline-flex items-center gap-1.5">
					<i className="inline-block size-2 rounded-[2px]" style={{ background: SERIES_COLOR }} aria-hidden />
					Share of tokens
				</span>
			</div>
		</div>
	)
}

/* ────────────────────────────── the card ────────────────────────────── */

/**
 * Token use by task — one instrument, two lenses, the page's one range.
 *
 * The page's rule is one instrument, one lens, one range: the KPI cards
 * already re-axe the scatter beside them, and this card applies the same idea
 * to "where did the tokens go". A lens swaps what a bar STANDS FOR (a task, a
 * fan-out bucket); the split swaps what a bar is MADE OF. All of it lives in
 * the URL, so a pasted link reopens the exact view being discussed.
 *
 * Three deliberate calls worth keeping:
 *
 * - **Measure is a server input, and the column headers are its control.**
 *   Tokens and cost rank tasks differently because agents bill at very
 *   different rates per token, so each measure re-ranks the whole range rather
 *   than re-sorting one list. Since the measure already decides the ranking
 *   and the bar, clicking the header is the sort — a separate segmented
 *   toggle would be a second control for one piece of state.
 * - **The list is the whole range, filtered and paged server-side.** There is
 *   no top N. Filtering client-side would search the pages that happen to be
 *   loaded and report a matching task further down as absent.
 * - **Contributors are a count and only when it is not one.** No name, avatar
 *   or per-person total appears anywhere, and the API returns no user id at
 *   all. On today's data ~99% of tasks are solo, so a mark on every row would
 *   be the same word repeated down the card.
 */
export function TokenUseByTaskCard({
	className,
	range,
	lens,
	measure,
	split,
	search,
	onLensChange,
	onMeasureChange,
	onSplitChange,
	onSearchChange,
}: TokenUseByTaskCardProps) {
	// Only the mounted lens fetches — `enabled` really gates it, rather than
	// both queries running and one result being ignored.
	const tasks = useTokenUseByTask(range, measure, search, lens === 'tasks')
	const fanOut = useTaskFanOut(range, lens === 'fanout')

	const active = lens === 'tasks' ? tasks : fanOut
	const startDate = lens === 'tasks' ? tasks.data?.pages[0]?.startDate : fanOut.data?.startDate
	const endDate = lens === 'tasks' ? tasks.data?.pages[0]?.endDate : fanOut.data?.endDate

	// A filter that matches nothing is NOT an empty card: the shell's empty
	// state says the range has no data, which would be a lie. The list renders
	// its own "no task matches" line instead.
	const isEmpty =
		lens === 'tasks'
			? search.trim().length === 0 && (tasks.data?.pages[0]?.matched.taskCount ?? 0) === 0
			: (fanOut.data?.taskCount ?? 0) === 0

	return (
		<MetricCardShell
			className={className}
			title="Token use by task"
			question={lensQuestion(lens, measure)}
			startDate={startDate}
			endDate={endDate}
			sentryComponent="TokenUseByTaskCard"
			// The shell replaces the WHOLE card with "Unable to load" when this is
			// set, so it only gets an error while there is nothing else to show. A
			// page that fails six deep into the scroll must not discard the five
			// pages already on screen; the list reports that failure itself, with a
			// retry, and keeps its rows.
			error={lens === 'tasks' && (tasks.data?.pages.length ?? 0) > 0 ? undefined : active.error}
			isLoading={active.isLoading}
			isEmpty={!active.isLoading && isEmpty}
			infoNotes={[
				'Tokens are input + output + cache read + cache creation, summed over every session on the task. Sub-agent tokens count toward the parent session’s task.',
				'Tokens are NOT comparable across coding agents — they bill at very different rates per token, so the tokens and cost rankings are different orderings of the range, not one list re-sorted. Clicking a figure column re-ranks server-side.',
				'The list covers every task in the range and pages in as you scroll. The filter matches task names and ticket ids server-side, so it searches the whole range and not just the rows already loaded.',
				'Contributors are shown as a COUNT and only when a task had more than one. No name or per-person total is shown, and the query returns no user identifier.',
				'Usage collection began in July 2026; earlier ranges read as empty, not as zero use.',
			]}
			// The filter is NOT here. It belongs to the task list, not to the card:
			// in this row it would sit beside two controls that outlive the lens,
			// and switching to Fan-out would leave a box that filters nothing — or
			// reflow the whole row on every lens change. It lives in its own band
			// inside TasksLens instead.
			headerAction={
				<div className="flex flex-wrap items-center gap-2">
					<Segmented
						label="Lens"
						value={lens}
						onChange={onLensChange}
						options={TOKEN_USE_LENSES.map((value) => ({ value, label: LENS_LABELS[value] }))}
					/>
					<SplitSelect value={split} disabled={!supportsSplit(lens)} onChange={onSplitChange} />
				</div>
			}
		>
			{lens === 'tasks' ? (
				<TasksLens
					range={range}
					measure={measure}
					split={split}
					search={search}
					onMeasureChange={onMeasureChange}
					onSearchChange={onSearchChange}
				/>
			) : (
				<FanOutLens range={range} />
			)}
		</MetricCardShell>
	)
}
