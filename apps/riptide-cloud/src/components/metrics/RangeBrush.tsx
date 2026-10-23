import { addDays, daysBetween } from '@humanlayer/riptide-api-contract/api/metrics/range'
import { cn } from '@humanlayer/ui/lib/utils'
import { useCallback, useMemo, useRef, useState } from 'react'

import { bucketDays, formatBucketLabel } from './clientBuckets'
import { dayAtFraction, formatRangeLength, type MetricsRange, type RangeBounds, rangeFromDrag } from './range'

export interface RangeBrushProps {
	className?: string
	/** Daily spend across the whole strip — never the selection alone. */
	days: ReadonlyArray<{ date: string; costUsd: number }>
	range: MetricsRange
	bounds: RangeBounds
	onChange: (range: MetricsRange) => void
	/** The day attribution begins; everything before it is hatched and unreachable. */
	attributionStartDate: string | null
}

type DragState = { anchorDay: string; pointerId: number; moved: boolean } | null

/**
 * The page's range control: a daily spend strip you drag a selection across.
 *
 * Three things make this honest rather than merely convenient.
 *
 * **The handles snap to the bucket.** Weekly buckets snap to Mondays, daily
 * buckets to days — the unit you drag IS the unit the charts aggregate, so a
 * partial bucket cannot be expressed. This is what makes a free-form range
 * safe on a page whose correctness previously rested on Monday anchoring.
 *
 * **The strip is always the full history, never the selection.** A range
 * control that only draws its own range cannot show you the spike you should
 * have selected. It is fed by a range-independent query so dragging never
 * refetches it.
 *
 * **The coverage floor is drawn, not described.** The days before an org's
 * first attributed commit are hatched and the handles refuse to enter them,
 * replacing the sentence that used to sit beside a greyed-out preset button.
 *
 * Raw dollars only — no ratio appears at day resolution here. See
 * trailingRatio for why.
 */
export function RangeBrush({ className, days, range, bounds, onChange, attributionStartDate }: RangeBrushProps) {
	const trackRef = useRef<HTMLDivElement>(null)
	const [drag, setDrag] = useState<DragState>(null)
	// The selection being painted mid-drag. Null when no drag is in flight, so
	// the committed `range` prop is the single source of truth at rest.
	const [preview, setPreview] = useState<MetricsRange | null>(null)

	const maxCost = useMemo(() => Math.max(1, ...days.map((day) => day.costUsd)), [days])
	const earliest = days[0]?.date ?? range.from
	const latest = days[days.length - 1]?.date ?? range.to

	const dayFromEvent = useCallback(
		(clientX: number) => {
			const track = trackRef.current
			if (!track) return null
			const rect = track.getBoundingClientRect()
			if (rect.width === 0) return null
			return dayAtFraction((clientX - rect.left) / rect.width, earliest, latest)
		},
		[earliest, latest],
	)

	// A drag is one gesture from press to release: the day under the press is
	// the anchor and the day under the pointer is the other edge, so grabbing
	// either end and dragging past the other simply inverts the selection
	// instead of colliding with a per-handle state machine.
	//
	// THE RANGE IS COMMITTED ON RELEASE, NOT ON MOVE. `preview` paints the
	// selection locally while the pointer is down; only `endDrag` calls
	// `onChange`. Every range change refetches the whole page — seven endpoints,
	// fifteen database queries, one of which walks each session's entire usage
	// history to keep model identity stable. Snapping bounds how many DISTINCT
	// ranges a drag can produce, but that is still up to 182 in daily mode, so
	// committing per move would put ~2,700 queries behind one gesture.
	const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		const day = dayFromEvent(event.clientX)
		if (!day) return
		event.currentTarget.setPointerCapture(event.pointerId)
		setDrag({ anchorDay: day, pointerId: event.pointerId, moved: false })
		setPreview(rangeFromDrag(day, day, range.bucket, bounds))
	}

	const continueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!drag || event.pointerId !== drag.pointerId) return
		const day = dayFromEvent(event.clientX)
		if (!day) return
		// Both setters must bail out, or the drag re-renders all 182 bars on every
		// pointermove. `rangeFromDrag` returns a fresh object, so `setPreview`
		// never hits React's Object.is check on its own; and re-flagging `moved`
		// each move re-allocates the drag state. In weekly mode a 500px drag has
		// ~13 distinct snapped selections against ~120 pointermove frames, so
		// without these guards ~89% of the renders paint an identical strip.
		if (!drag.moved && day !== drag.anchorDay) setDrag({ ...drag, moved: true })
		const next = rangeFromDrag(drag.anchorDay, day, range.bucket, bounds)
		setPreview((prev) => (prev && prev.from === next.from && prev.to === next.to ? prev : next))
	}

	const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!drag || event.pointerId !== drag.pointerId) return
		event.currentTarget.releasePointerCapture(event.pointerId)
		const moved = drag.moved
		setDrag(null)
		setPreview(null)
		// A click that never moved selects NOTHING. Committing the bucket under
		// the pointer would collapse a twelve-week selection to a single week on
		// one stray click, and refetch the page to do it.
		if (!moved) return
		if (preview && (preview.from !== range.from || preview.to !== range.to)) onChange(preview)
	}

	// Keyboard: the whole track is one control. Arrows move the range by a
	// bucket, shift+arrows resize it from the right edge. A drag surface with no
	// keyboard path would put the page's primary control out of reach entirely.
	//
	// Same commit-on-release rule as the pointer, for the same reason: holding an
	// arrow key auto-repeats keydown at the OS repeat rate and would fire a
	// fifteen-query refetch per repeat. Keydown moves the preview, keyup — which
	// fires once, however long the key was held — commits it.
	const nudge = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const step = bucketDays(range.bucket)
		const direction = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
		if (direction === 0) return
		event.preventDefault()
		const from = preview ?? range
		setPreview(
			event.shiftKey
				? // Resize: hold `from`, move `to`.
					rangeFromDrag(from.from, addDays(from.to, direction), range.bucket, bounds)
				: rangeFromDrag(addDays(from.from, direction), addDays(from.to, direction), range.bucket, bounds),
		)
	}

	const commitNudge = () => {
		if (!preview || drag) return
		if (preview.from !== range.from || preview.to !== range.to) onChange(preview)
		setPreview(null)
	}

	// Paint the in-flight selection; fall back to the committed one at rest.
	const shown = preview ?? range

	const total = (daysBetween(earliest, latest) ?? 0) + 1
	// Clamped to the strip: a weekly range ends on the current week's Sunday,
	// which is up to six days past `latest`, and the track has no overflow
	// clipping — so an unclamped handle paints outside the bordered strip on
	// every weekday but Sunday. The range VALUE keeps the real date.
	const offsetOf = (day: string) => Math.min(100, Math.max(0, ((daysBetween(earliest, day) ?? 0) / total) * 100))
	const selectionLeft = offsetOf(shown.from)
	const selectionRight = Math.min(100, offsetOf(shown.to) + 100 / total)
	const lockRight = attributionStartDate ? Math.min(100, offsetOf(attributionStartDate) + 100 / total) : 0

	const label = `${formatBucketLabel(shown.from)} – ${formatBucketLabel(shown.to)} · ${formatRangeLength(shown)}`

	return (
		<div className={cn('flex flex-col gap-1', className)}>
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span className="font-medium">{label}</span>
				<span className="text-muted-foreground">
					daily spend · {range.bucket === 'week' ? 'snapping to Mondays' : 'snapping to days'}
				</span>
			</div>

			{/* biome-ignore lint/a11y/useSemanticElements: a two-thumb range over
			    calendar days has no native element; slider semantics plus the
			    keyboard handler below is the closest honest description. */}
			<div
				ref={trackRef}
				role="slider"
				tabIndex={0}
				aria-label="Metrics date range"
				aria-valuetext={label}
				aria-valuemin={0}
				aria-valuemax={total}
				aria-valuenow={daysBetween(earliest, shown.from) ?? 0}
				onPointerDown={beginDrag}
				onPointerMove={continueDrag}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onKeyDown={nudge}
				onKeyUp={commitNudge}
				onBlur={commitNudge}
				className={cn(
					'relative h-20 w-full touch-none select-none rounded-sm border bg-muted/30',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
					drag ? 'cursor-grabbing' : 'cursor-crosshair',
				)}
			>
				{/* Uncovered history: hatched, and the handles will not enter it. */}
				{lockRight > 0 ? (
					<div
						aria-hidden="true"
						className="absolute inset-y-0 left-0 rounded-l-sm bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--destructive)_3px,var(--destructive)_4px)] opacity-40"
						style={{ width: `${lockRight}%` }}
					/>
				) : null}

				<div
					aria-hidden="true"
					className="absolute inset-y-0 bg-primary/10"
					style={{ left: `${selectionLeft}%`, width: `${Math.max(0, selectionRight - selectionLeft)}%` }}
				/>

				{/* Bars. Absolute rather than flex so a bar's x position is a pure
				    function of its date — the same function the handles use, so a
				    handle always lands on the bar the pointer is over. */}
				{days.map((day, index) => {
					const inSelection = day.date >= shown.from && day.date <= shown.to
					const locked = attributionStartDate !== null && day.date <= attributionStartDate
					return (
						<div
							key={day.date}
							aria-hidden="true"
							className={cn(
								'absolute bottom-0',
								locked ? 'bg-destructive/25' : inSelection ? 'bg-primary' : 'bg-muted-foreground/30',
							)}
							style={{
								left: `${(index / total) * 100}%`,
								width: `${100 / total}%`,
								height: `${Math.max(1, (day.costUsd / maxCost) * 100)}%`,
							}}
						/>
					)
				})}

				{[selectionLeft, selectionRight].map((position, index) => (
					<div
						key={index === 0 ? 'from' : 'to'}
						aria-hidden="true"
						className="absolute inset-y-[-2px] w-[3px] -translate-x-1/2 rounded-full bg-primary"
						style={{ left: `${position}%` }}
					/>
				))}
			</div>

			<div className="flex justify-between text-[10px] text-muted-foreground">
				<span>{formatBucketLabel(earliest)}</span>
				{attributionStartDate ? (
					<span>attribution starts {formatBucketLabel(attributionStartDate)}</span>
				) : null}
				<span>{formatBucketLabel(latest)}</span>
			</div>
		</div>
	)
}
