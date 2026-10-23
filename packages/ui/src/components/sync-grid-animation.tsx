'use client'

import type React from 'react'
import { cn } from '@humanlayer/ui/lib/utils'
import { memo } from 'react'

/**
 * Traversal path through the 3x3 grid as [row, col] pairs.
 *
 * Direction of motion:
 *   top-right -> top-center -> top-left (sweep left across top)
 *   -> center-left -> bottom-left (down the left side)
 *   -> bottom-center -> bottom-right (sweep right across bottom)
 *   -> center-right -> center (up and into center)
 */
const CELL_PATH: ReadonlyArray<[number, number]> = [
	[0, 2], // top-right
	[0, 1], // top-center
	[0, 0], // top-left
	[1, 0], // center-left
	[2, 0], // bottom-left
	[2, 1], // bottom-center
	[2, 2], // bottom-right
	[1, 2], // center-right
	[1, 1], // center
]

/**
 * Circular path around the 8 outer cells of the 3x3 grid (clockwise).
 * The center cell [1,1] is never visited.
 */
const RING_PATH: ReadonlyArray<[number, number]> = [
	[0, 0], // top-left
	[0, 1], // top-center
	[0, 2], // top-right
	[1, 2], // center-right
	[2, 2], // bottom-right
	[2, 1], // bottom-center
	[2, 0], // bottom-left
	[1, 0], // center-left
]

const PATH_LEN = CELL_PATH.length // 9

/** Steps to hold "all filled" before clearing (fill variant). */
const HOLD_STEPS = 4
/** Steps to show empty grid before restarting (fill variant). */
const EMPTY_STEPS = 2
const FILL_CYCLE = PATH_LEN + HOLD_STEPS + EMPTY_STEPS // 15

/** Simultaneously lit cells in snake/ring mode. Baked into the keyframes. */
const SNAKE_LENGTH = 5
/** Extra empty steps after the snake fully drains before the next cycle starts. */
const SNAKE_GAP_STEPS = 2
const SNAKE_CYCLE = PATH_LEN + SNAKE_LENGTH + SNAKE_GAP_STEPS // 16
const RING_CYCLE = RING_PATH.length // 8

/** Path position for each 3x3 cell key (row * 3 + col). */
const PATH_INDEX_BY_CELL = Array.from({ length: 9 }, (_, key) =>
	CELL_PATH.findIndex(([r, c]) => r * 3 + c === key),
)
/** Ring position for each 3x3 cell key; the center cell maps to -1. */
const RING_INDEX_BY_CELL = Array.from({ length: 9 }, (_, key) =>
	RING_PATH.findIndex(([r, c]) => r * 3 + c === key),
)

export interface SyncGridAnimationProps extends React.ComponentPropsWithoutRef<'div'> {
	/** 'fill': cells accumulate then clear. 'snake': moving window of lit cells. 'ring': snake loops around the 8 outer cells. */
	variant?: 'fill' | 'snake' | 'ring'
	/** Milliseconds per animation step. Default 100 for ring, 150 otherwise. */
	speed?: number
	/** Predefined size. Default 'sm'. */
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
	/** Outer grid dimension — 3 shows only animated cells, larger values add faint surrounding dots. Default 3. */
	gridSize?: number
	/** When true, all synchronized instances with the same speed share a wall-clock phase. Default false. */
	synchronized?: boolean
}

const SIZE_WIDTHS: Record<NonNullable<SyncGridAnimationProps['size']>, string> = {
	xs: 'w-2.5',
	sm: 'w-4',
	md: 'w-6',
	lg: 'w-10',
	xl: 'w-16',
}

/**
 * A self-contained 3x3 grid animation that indicates syncing activity.
 *
 * Driven entirely by CSS keyframes (see the sync-grid-* blocks in
 * globals.css): no timers, no re-renders, no inline style churn after mount,
 * and WebKit/Chromium run the opacity keyframes on the compositor thread.
 * Each cell plays the shared per-variant keyframes phase-shifted by a
 * negative animation-delay derived from its position on the traversal path.
 *
 * `synchronized` derives the initial negative delay from the wall clock, so
 * instances mounted at different times share the same phase without querying
 * or changing the browser's live Animation objects.
 *
 * Do not attach animationstart/iteration/end listeners on this component or
 * its ancestors: any such listener forces the animations off the compositor
 * onto the main thread.
 *
 * Color: uses theme accent color by default. Override with `className="text-muted-foreground"` etc.
 */
export const SyncGridAnimation = memo(function SyncGridAnimation({
	variant = 'fill',
	speed: speedProp,
	size = 'sm',
	className,
	gridSize = 3,
	synchronized = false,
	ref,
	style,
	...rest
}: SyncGridAnimationProps & { ref?: React.Ref<HTMLDivElement> }) {
	const speed = speedProp ?? (variant === 'ring' ? 100 : 150)
	const cycleSteps = variant === 'fill' ? FILL_CYCLE : variant === 'ring' ? RING_CYCLE : SNAKE_CYCLE
	const cycleMs = cycleSteps * speed

	// A negative delay starts synchronized instances at the current wall-clock
	// position in the cycle. Avoid the Web Animations API here: WebKit can enter
	// a layout and microtask loop when getAnimations() is called for these
	// infinite CSS animations.
	const now = typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : 0
	const epoch = synchronized ? -(now % cycleMs) : 0

	const offset = Math.floor((gridSize - 3) / 2)
	const totalCells = gridSize * gridSize

	return (
		<div
			ref={ref}
			{...rest}
			className={cn(
				'inline-grid aspect-square text-accent',
				SIZE_WIDTHS[size],
				className,
			)}
			style={{
				gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
				gridTemplateRows: `repeat(${gridSize}, 1fr)`,
				gap: '8%',
				...style,
			}}
			role="img"
			aria-label="Syncing"
		>
			{Array.from({ length: totalCells }, (_, i) => {
				const row = Math.floor(i / gridSize)
				const col = i % gridSize
				const innerRow = row - offset
				const innerCol = col - offset
				const isInner = innerRow >= 0 && innerRow < 3 && innerCol >= 0 && innerCol < 3

				if (!isInner) {
					return <div key={i} className="bg-current opacity-[0.06]" style={{ borderRadius: 0 }} />
				}

				const cellKey = innerRow * 3 + innerCol
				const pathIndex = variant === 'ring' ? RING_INDEX_BY_CELL[cellKey] : PATH_INDEX_BY_CELL[cellKey]

				// The ring never lights the center cell
				if (pathIndex === -1) {
					return <div key={i} className="bg-current" style={{ borderRadius: 0, opacity: 0.08 }} />
				}

				const animationName =
					variant === 'fill'
						? `sync-grid-fill-cell-${pathIndex}`
						: variant === 'ring'
							? 'sync-grid-ring-cell'
							: 'sync-grid-snake-cell'
				// Fill keyframes carry the activation offset themselves; ring/snake
				// cells phase-shift the shared block by path position.
				const delayMs = variant === 'fill' ? epoch : epoch + (pathIndex ?? 0) * speed - cycleMs

				return (
					<div
						key={i}
						className="bg-current"
						style={{
							borderRadius: 0,
							// Fallback if the keyframes fail to load; the animation overrides it.
							opacity: 0.35,
							animationName,
							animationDuration: `${cycleMs}ms`,
							animationDelay: `${delayMs}ms`,
							animationIterationCount: 'infinite',
							animationTimingFunction: 'linear',
						}}
					/>
				)
			})}
		</div>
	)
})
