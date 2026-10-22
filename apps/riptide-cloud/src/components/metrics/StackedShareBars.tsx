import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'

import { formatUsdExact } from './kpis'
import { type CrossTab, type CrossTabRow, drawableSegments, formatSegmentShare } from './userCrossTab'

/**
 * The 300px the ranked cards use, so the two rows of the Workflow tab line up.
 * Rows are ~34px, so eight people fit before it scrolls.
 */
const MAX_BODY_HEIGHT = 'max-h-[300px]'

export interface StackedShareBarsProps {
	crossTab: CrossTab
	/** Names the buckets in the legend and the tooltip — 'stage' or 'mode'. */
	bucketNoun: string
}

/**
 * One 100% stacked bar per person, segmented by that person's own mix.
 *
 * Shares of the PERSON, not of the org. That is what makes a $681 user and a
 * $4,834 user comparable at all — on raw dollars the biggest spender wins every
 * bucket by definition, and the ranked card above already answers "who spends
 * most". This card answers the different question: what does each person spend
 * it ON.
 *
 * A stacked bar rather than a heatmap because it has no natural width — it
 * fills whatever track it is given — so it survives the half-width card the
 * 2x2 grid gives it. A heatmap of eleven stage columns does not; it needs
 * rotated headers and roughly twice the room. (Both were built and compared;
 * see .humanlayer/mockups/poc-user-by-stage-mode.html.)
 *
 * Colours come from the caller and are the SAME ones the ranked card above
 * uses, keyed to canonical position, so 'implementation' is one blue in both
 * and stays that blue when the range changes.
 */
export function StackedShareBars({ crossTab, bucketNoun }: StackedShareBarsProps) {
	return (
		<div className="flex flex-col gap-3">
			<div className={`${MAX_BODY_HEIGHT} flex flex-col gap-2.5 overflow-y-auto`}>
				{crossTab.rows.map((row) => (
					<PersonBar key={row.userId} row={row} bucketNoun={bucketNoun} />
				))}
			</div>

			{/* The legend is load-bearing here in a way it is not on the ranked
			    cards: a segment carries no label of its own, so without this the
			    colours mean nothing. Wraps rather than scrolls — a clipped
			    legend is worse than a tall one. */}
			<div className="flex flex-wrap gap-x-3 gap-y-1 border-border/40 border-t pt-2 text-[10px] text-muted-foreground">
				{crossTab.series.map((entry) => (
					<span key={entry.key} className="inline-flex items-center gap-1.5">
						<span className="block size-2 shrink-0" style={{ backgroundColor: entry.color }} />
						{entry.label}
					</span>
				))}
			</div>
		</div>
	)
}

function PersonBar({ row, bucketNoun }: { row: CrossTabRow; bucketNoun: string }) {
	const drawn = drawableSegments(row)
	/** True share, before drawableSegments re-bases the drawn widths. */
	const shareOf = (key: string) => row.segments.find((entry) => entry.key === key)?.share ?? 0

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span className="truncate">{row.label}</span>
				<span className="shrink-0 tabular-nums text-muted-foreground">{formatUsdExact(row.total)}</span>
			</div>
			<div className="flex h-3 w-full overflow-hidden bg-muted">
				{drawn.map((segment) => (
					<Tooltip key={segment.key}>
						<TooltipTrigger asChild>
							{/* tabIndex: Radix opens a tooltip on pointer-move or on
							    focus and explicitly ignores touch pointers, so without
							    a tab stop the per-segment dollars — which appear
							    nowhere else — are reachable by mouse only.
							    aria-label because the segment has no text of its own:
							    a focusable element with no accessible name is a tab
							    stop that announces nothing. It carries the same three
							    facts the tooltip shows. */}
							<span
								tabIndex={0}
								aria-label={`${row.label}, ${segment.label}, ${formatUsdExact(segment.total)}, ${formatSegmentShare(shareOf(segment.key))} of their spend`}
								className="block h-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
								style={{
									width: `${(segment.share * 100).toFixed(3)}%`,
									backgroundColor: segment.color,
								}}
							/>
						</TooltipTrigger>
						<TooltipContent
							side="top"
							// `border` (the width) as well as the colour: the base
							// TooltipContent has no border utility, so a bare
							// border-border/50 renders no outline at all.
							className="border border-border/50 bg-background text-foreground shadow-xl"
							arrowClassName="bg-background fill-background"
						>
							<div className="grid gap-1">
								<div className="font-medium">{row.label}</div>
								<TooltipRow label={bucketNoun} value={segment.label} />
								<TooltipRow label="Spend" value={formatUsdExact(segment.total)} />
								{/* The TRUE share, from the full segment list — `drawn`
								    re-bases its widths onto the segments that survived
								    the dust filter, so reading the share off it would
								    overstate every one of them. */}
								<TooltipRow label="Of their spend" value={formatSegmentShare(shareOf(segment.key))} />
							</div>
						</TooltipContent>
					</Tooltip>
				))}
			</div>
		</div>
	)
}

function TooltipRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between gap-6">
			<span className="text-muted-foreground">{label}</span>
			<span className="tabular-nums">{value}</span>
		</div>
	)
}
