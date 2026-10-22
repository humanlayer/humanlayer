import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'

import { bucketNoun } from './clientBuckets'
import { formatUsdExact } from './kpis'
import type { MetricsRange } from './range'
import { activeBucketsLabel, formatShare, type SpendRanking, sparklineGeometry } from './spendRanking'

/**
 * Sparkline box. 72px, not the 104 the first cut used: `CardContent` adds
 * `px-6` on top of the card's `p-4`, so a half-width card at a 1280px viewport
 * holds ~396px of content, and a 104px trend column left the bar nothing.
 */
const SPARK_WIDTH = 72
const SPARK_HEIGHT = 16

/**
 * The 300px the grouped-bar chart used to occupy. Rows are ~19px, so 11 stages
 * fit with room to spare; this is a ceiling, not a floor — a card with four
 * modes does not pad itself out to 300px of whitespace, and a vocabulary longer
 * than the box scrolls instead of shrinking its rows.
 */
const MAX_BODY_HEIGHT = 'max-h-[300px]'

/**
 * An AUTO-layout table, and the auto is load-bearing.
 *
 * The first cut used `table-fixed` with pixel column widths summing to 382px.
 * Below ~400px of card content the bar column — the whole point of a ranking —
 * collapsed to 0px and the card grew a sideways scrollbar (measured: a 188px
 * container held a 394px table and a 0px bar). Replacing it with a CSS grid
 * then let the label shrink instead, which turned 'research' and
 * 'research-questions' into the same "resear…" and 'design-prd' and
 * 'design-tdd' into the same "design…" — two pairs of rows a reader cannot tell
 * apart. A per-row grid also sizes its own columns, so every bar started at a
 * different x and bar lengths stopped being comparable.
 *
 * Auto table layout gets all three right for free: columns are shared across
 * rows, so bars share a baseline; the label column sizes to its longest label,
 * so no name is ever cut; and the bar cell carries `w-full`, the classic way to
 * make one cell absorb whatever is left.
 *
 * Two columns of numbers plus a trend need roughly 320px, so the cards only go
 * side by side at `xl` (see advanced-metrics.tsx) and below `sm` — a phone —
 * the trend and the share drop out, leaving the label, the bar and the dollars.
 */
const SPARK_CELL = 'hidden sm:table-cell'

/** Share is the first number to go: below `sm` the bar and the dollars carry it. */
const SHARE_CELL = 'hidden sm:table-cell'

export interface RankedSpendChartProps {
	ranking: SpendRanking
	/** Bucket of the range, so the tooltip names a peak DAY or a peak WEEK. */
	bucket: MetricsRange['bucket']
	/** Header over the label column — 'Stage' or 'Mode'. */
	labelHeader: string
}

/**
 * Ranked spend rows: one row per series, ordered by window total, each with a
 * proportional bar, its dollars, its share, and a sparkline of its per-bucket
 * shape with the peak bucket marked.
 *
 * Bars are scaled to the LARGEST row, not to the grand total: the reader's
 * question is "how do these compare", and a share-of-total scale wastes most of
 * the width whenever one line item dominates (ad-hoc alone was 45% of the dev
 * org's August spend, so every other bar would have lived in the left third).
 *
 * The sparkline is the part the ranking would otherwise lose. A row's total
 * cannot tell you whether a stage ran steadily or in one burst, and that is
 * exactly what a reader looking at a workflow mix wants next — so each row
 * keeps its own tiny time series, normalised to itself.
 */
export function RankedSpendChart({ ranking, bucket, labelHeader }: RankedSpendChartProps) {
	const activeLabel = activeBucketsLabel(bucket)

	return (
		<div className={`${MAX_BODY_HEIGHT} overflow-y-auto`}>
			<table className="w-full text-xs">
				<thead>
					<tr className="border-border border-b text-[10px] text-muted-foreground uppercase tracking-wide">
						<th className="w-2 pb-1.5 pr-1.5" aria-label="Colour" />
						<th className="pb-1.5 pr-2 text-left font-normal">{labelHeader}</th>
						{/* w-full: in auto layout, one cell asking for 100% takes every
						    pixel the other columns did not need — which is what keeps the
						    bar alive on a narrow card. */}
						<th className="w-full pb-1.5 pr-2" aria-label="Relative spend" />
						<th className="whitespace-nowrap pb-1.5 pr-2 text-right font-normal">Spend</th>
						<th className={`${SHARE_CELL} whitespace-nowrap pb-1.5 pr-2 text-right font-normal`}>Share</th>
						<th className={`${SPARK_CELL} pb-1.5 text-left font-normal`}>Trend</th>
					</tr>
				</thead>
				<tbody>
					{ranking.rows.map((row) => {
						const peakBucket = ranking.buckets[row.peakIndex]
						return (
							<Tooltip key={row.key}>
								<TooltipTrigger asChild>
									{/* tabIndex: Radix opens a tooltip on pointer-move or on
									    focus, and explicitly ignores touch pointers. Without a
									    tab stop the peak bucket and the active-bucket count —
									    which appear nowhere else in the UI — were reachable by
									    mouse only. */}
									<tr
										tabIndex={0}
										className="border-border/40 border-b last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
									>
										<td className="py-0.5 pr-1.5">
											<span className="block size-2" style={{ backgroundColor: row.color }} />
										</td>
										<td className="whitespace-nowrap py-0.5 pr-2">{row.label}</td>
										<td className="py-0.5 pr-2">
											<span className="block h-2.5 bg-muted">
												<span
													className="block h-full"
													style={{
														// max(): a row exists because it has
														// spend, so it must draw something.
														// plan's $0.07 against a $5,900 max
														// rounds to 0.0% width, and would
														// otherwise show nothing beside a share
														// the code deliberately prints as
														// "<0.1%".
														width: `max(1px, ${(row.barFraction * 100).toFixed(1)}%)`,
														backgroundColor: row.color,
													}}
												/>
											</span>
										</td>
										<td className="whitespace-nowrap py-0.5 pr-2 text-right tabular-nums">
											{formatUsdExact(row.total)}
										</td>
										<td
											className={`${SHARE_CELL} whitespace-nowrap py-0.5 pr-2 text-right text-muted-foreground tabular-nums`}
										>
											{formatShare(row.share)}
										</td>
										<td className={`${SPARK_CELL} py-0.5`}>
											<Sparkline
												values={row.values}
												peakIndex={row.peakIndex}
												color={row.color}
											/>
										</td>
									</tr>
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
										<TooltipRow label="Spend" value={formatUsdExact(row.total)} />
										<TooltipRow label="Share" value={formatShare(row.share)} />
										{peakBucket ? (
											<TooltipRow
												label={bucket === 'week' ? 'Peak week' : 'Peak day'}
												value={`${bucketNoun(peakBucket, bucket)} · ${formatUsdExact(row.peak)}`}
											/>
										) : null}
										<TooltipRow
											label={activeLabel}
											value={`${row.activeBuckets} / ${ranking.buckets.length}`}
										/>
									</div>
								</TooltipContent>
							</Tooltip>
						)
					})}
				</tbody>
			</table>
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

function Sparkline({ values, peakIndex, color }: { values: number[]; peakIndex: number; color: string }) {
	const geometry = sparklineGeometry(values, peakIndex, SPARK_WIDTH, SPARK_HEIGHT)

	// No honest curve to draw (one bucket, or a window of rounding dust): a flat
	// baseline says "present but negligible" where a normalised line would have
	// drawn cents as a mountain.
	if (!geometry) {
		return (
			<svg width={SPARK_WIDTH} height={SPARK_HEIGHT} className="block" role="presentation">
				<line
					x1={2}
					x2={SPARK_WIDTH - 2}
					y1={SPARK_HEIGHT - 2}
					y2={SPARK_HEIGHT - 2}
					stroke={color}
					strokeWidth={1.2}
					opacity={0.5}
				/>
			</svg>
		)
	}

	return (
		<svg width={SPARK_WIDTH} height={SPARK_HEIGHT} className="block" role="presentation">
			<path d={geometry.area} fill={color} opacity={0.16} />
			<path d={geometry.line} fill="none" stroke={color} strokeWidth={1.2} opacity={0.9} />
			<circle cx={geometry.peakX} cy={geometry.peakY} r={2.2} fill={color} />
		</svg>
	)
}
