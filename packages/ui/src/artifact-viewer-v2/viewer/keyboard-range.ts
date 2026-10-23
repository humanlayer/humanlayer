import { getVisibleBlocks, type SectionRange } from '../folding/section-ranges'
import type { NavigableBlock } from './build-navigable-blocks'

/**
 * Pure anchored-range state machine for keyboard block-range selection
 * (`Shift+J` / `Shift+K`).
 *
 * The `anchor` block is fixed at the block focused when the range began; the
 * `head` block moves one commentable block per keypress. The ordered selected
 * range always spans `[min(anchor, head), max(anchor, head)]` in document
 * order, so reversing direction contracts the range and can extend past the
 * anchor in the opposite direction.
 *
 * Folded sections are entered explicitly: when the next target lives in a
 * collapsed section, traversal reports the heading IDs to unfold (the section
 * and every nested folded descendant that hides the target), and the head lands
 * on the first block (moving down) or last block (moving up) of the now-visible
 * section.
 */
export interface KeyboardRangeState {
	/** Fixed anchor block id (where the range began). */
	anchorId: string
	/** Movable head block id (last block added/removed). */
	headId: string
}

export interface KeyboardRangeStep {
	state: KeyboardRangeState
	/** Selected block ids in document order (visible after any unfolds). */
	selectedIds: string[]
	/** Folded heading ids to expand as a side effect of entering a section. */
	unfoldHeadingIds: string[]
}

export interface KeyboardRangeStepInput {
	anchorId: string
	headId: string
	/** Full document-order block list (including blocks hidden by folds). */
	allBlocks: NavigableBlock[]
	sectionRanges: SectionRange[]
	foldedHeadingIds: ReadonlySet<string>
	/** `1` extends the head toward the document end, `-1` toward the start. */
	direction: 1 | -1
}

/** Begin a keyboard range from a single focused block. */
export function startKeyboardRange(blockId: string): KeyboardRangeState {
	return { anchorId: blockId, headId: blockId }
}

/** The ordered visible selected ids for a range state, given the visible blocks. */
export function selectedRangeIds(state: KeyboardRangeState, visibleBlocks: NavigableBlock[]): string[] {
	const anchorIdx = visibleBlocks.findIndex((block) => block.id === state.anchorId)
	const headIdx = visibleBlocks.findIndex((block) => block.id === state.headId)
	if (anchorIdx === -1 || headIdx === -1) return []
	const lo = Math.min(anchorIdx, headIdx)
	const hi = Math.max(anchorIdx, headIdx)
	return visibleBlocks.slice(lo, hi + 1).map((block) => block.id)
}

/** Folded heading ids whose section hides the given block. */
function foldsHiding(
	blockId: string,
	sectionRanges: SectionRange[],
	foldedHeadingIds: ReadonlySet<string>,
): string[] {
	return sectionRanges
		.filter((range) => foldedHeadingIds.has(range.id) && range.descendantBlocks.some((block) => block.id === blockId))
		.map((range) => range.id)
}

/**
 * Advance the head one commentable block in `direction`. Clamps at the document
 * boundaries. Entering a collapsed section unfolds it (and nested folds hiding
 * the target) and lands the head on the boundary block of the revealed section.
 */
export function stepKeyboardRange({
	anchorId,
	headId,
	allBlocks,
	sectionRanges,
	foldedHeadingIds,
	direction,
}: KeyboardRangeStepInput): KeyboardRangeStep {
	const currentIdx = allBlocks.findIndex((block) => block.id === headId)
	const noop = (): KeyboardRangeStep => {
		const visible = getVisibleBlocks(allBlocks, sectionRanges, foldedHeadingIds)
		return {
			state: { anchorId, headId },
			selectedIds: selectedRangeIds({ anchorId, headId }, visible),
			unfoldHeadingIds: [],
		}
	}
	if (currentIdx === -1) return noop()

	const targetIdx = currentIdx + direction
	if (targetIdx < 0 || targetIdx >= allBlocks.length) return noop()
	const target = allBlocks[targetIdx]!

	// Entering a collapsed section: unfold everything hiding the target so it (a
	// section-boundary block) becomes visible, then land the head on it.
	const unfoldHeadingIds = foldsHiding(target.id, sectionRanges, foldedHeadingIds)
	const effectiveFolded = new Set(foldedHeadingIds)
	for (const id of unfoldHeadingIds) effectiveFolded.delete(id)

	const visible = getVisibleBlocks(allBlocks, sectionRanges, effectiveFolded)
	const nextState = { anchorId, headId: target.id }
	return {
		state: nextState,
		selectedIds: selectedRangeIds(nextState, visible),
		unfoldHeadingIds,
	}
}
