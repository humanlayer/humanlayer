/**
 * Keyboard block navigation (`j`/`k`) should scroll the artifact document
 * *before* the focused block reaches the very top or bottom edge, leaving a few
 * blocks of breathing room so the reader keeps surrounding context in view.
 * These helpers operate on the artifact document's own scroll container — never
 * the window — and preserve `scrollIntoView({ block: 'nearest' })`'s "only move
 * when the block is actually out of the comfort zone" behavior.
 */

/** Vertical breathing room (px) kept between the focused block and each edge of
 *  the scroll container — roughly 2–3 blocks of a typical document. */
export const BLOCK_FOCUS_SCROLL_MARGIN_PX = 96

/**
 * Signed scroll delta needed to keep a block `margin` px clear of the scroll
 * container's top and bottom edges. Negative scrolls up, positive scrolls down,
 * and `0` means the block already sits inside the comfort zone (no scroll).
 *
 * `blockTop`/`blockBottom` are the block's edges relative to the container's
 * client top (i.e. `blockRect.top - containerRect.top`); `viewHeight` is the
 * container's `clientHeight`. The comfort margin is capped so it can never
 * exceed the room a block leaves in the viewport — otherwise a block taller
 * than `viewHeight - 2*margin` (or a very short container) could never satisfy
 * both edges and would jitter.
 */
export function computeComfortScrollDelta(
	blockTop: number,
	blockBottom: number,
	viewHeight: number,
	margin: number = BLOCK_FOCUS_SCROLL_MARGIN_PX,
): number {
	const blockHeight = blockBottom - blockTop
	const effectiveMargin = Math.max(0, Math.min(margin, (viewHeight - blockHeight) / 2))

	const topOverflow = blockTop - effectiveMargin
	if (topOverflow < 0) return topOverflow

	const bottomOverflow = blockBottom - (viewHeight - effectiveMargin)
	if (bottomOverflow > 0) return bottomOverflow

	return 0
}

/**
 * Scroll `scrollEl` (the artifact document container) just enough to keep
 * `blockEl` inside the comfort zone. No-op when it already is.
 */
export function scrollBlockIntoViewWithComfort(
	scrollEl: HTMLElement,
	blockEl: HTMLElement,
	margin: number = BLOCK_FOCUS_SCROLL_MARGIN_PX,
): void {
	const containerRect = scrollEl.getBoundingClientRect()
	const blockRect = blockEl.getBoundingClientRect()
	const delta = computeComfortScrollDelta(
		blockRect.top - containerRect.top,
		blockRect.bottom - containerRect.top,
		scrollEl.clientHeight,
		margin,
	)
	if (delta !== 0) scrollEl.scrollTop += delta
}
