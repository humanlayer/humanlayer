import type { DiffStyle } from '../../components/diff-style-provider'

/**
 * Narrowest diff pane, in CSS pixels, that shows split view. The two line-number gutters take
 * about 100px, so 480px leaves each side about 190px of code: some 24 characters of the 13px
 * monospace font. Narrower than that, most lines wrap every few words and the pairing of old and
 * new lines is harder to follow than unified view. Fullscreen on a 1512px-wide laptop screen
 * (about 625px) and the main pane stay above it; the side panel falls below it.
 */
export const MIN_SPLIT_DIFF_WIDTH_PX = 480

/**
 * Whether a diff pane `width` pixels wide has room for split view. A pane that has no width yet
 * (unmeasured or hidden) keeps the saved choice rather than flipping on a zero reading.
 */
export function fitsSplitDiff(width: number): boolean {
	return width <= 0 || width >= MIN_SPLIT_DIFF_WIDTH_PX
}

/** The style to render: the saved choice, or unified when split view has no room. */
export function fitDiffStyle(preferred: DiffStyle, splitFits: boolean): DiffStyle {
	return preferred === 'split' && !splitFits ? 'unified' : preferred
}
