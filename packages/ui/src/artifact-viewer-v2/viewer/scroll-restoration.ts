import type { AnchorBlock } from '../anchor/block-text-offsets'
import { createWholeBlockAnchor } from '../anchor/block-text-offsets'
import { resolveAnchor } from '../anchor/resolve'
import type { AnchorV2 } from '../anchor/types'
import type { NavigableBlock } from './build-navigable-blocks'

export interface ReadingBlockGeometry {
	block: NavigableBlock
	top: number
	bottom: number
}

export interface ScrollRestorationTarget {
	anchor: AnchorV2
	anchorViewportOffset: number
}

export interface RestoredScrollPosition {
	scrollTop: number
	resolvedBlock: AnchorBlock | null
}

/**
 * Pick the semantic reading block. Keyboard focus wins when it belongs to the
 * current document; otherwise use the first block crossing the viewport top.
 */
export function selectReadingBlock(
	geometries: ReadingBlockGeometry[],
	viewportTop: number,
	keyboardFocusedBlockId: string | null,
	keyboardFocused: boolean,
): ReadingBlockGeometry | null {
	if (keyboardFocused && keyboardFocusedBlockId) {
		const focused = geometries.find(({ block }) => block.id === keyboardFocusedBlockId)
		if (focused) return focused
	}
	return geometries.find(({ top, bottom }) => top <= viewportTop && bottom > viewportTop) ?? null
}

/** Build the durable whole-block target captured from the old document. */
export function createScrollRestorationTarget(
	anchorBlocks: AnchorBlock[],
	selected: ReadingBlockGeometry,
	viewportTop: number,
): ScrollRestorationTarget | null {
	const index = anchorBlocks.findIndex((block) => block.pos === selected.block.pos)
	if (index < 0) return null
	return {
		anchor: createWholeBlockAnchor(anchorBlocks, index),
		anchorViewportOffset: selected.top - viewportTop,
	}
}

/** Resolve a saved whole-block anchor to the matching block in the new doc. */
export function resolveScrollRestorationBlock(anchorBlocks: AnchorBlock[], anchor: AnchorV2 | null): AnchorBlock | null {
	if (!anchor) return null
	const placement = resolveAnchor(anchorBlocks, anchor)
	if (placement.status !== 'resolved') return null
	return anchorBlocks.find((block) => block.pos === placement.from) ?? null
}

/**
 * Keep a resolved semantic block at its saved signed viewport offset. When the
 * anchor is stale, return the old numeric scrollTop instead.
 */
export function computeRestoredScrollPosition({
	anchorBlocks,
	anchor,
	currentScrollTop,
	currentAnchorViewportOffset,
	savedAnchorViewportOffset,
	fallbackScrollTop,
}: {
	anchorBlocks: AnchorBlock[]
	anchor: AnchorV2 | null
	currentScrollTop: number
	currentAnchorViewportOffset: number | null
	savedAnchorViewportOffset: number
	fallbackScrollTop: number
}): RestoredScrollPosition {
	const resolvedBlock = resolveScrollRestorationBlock(anchorBlocks, anchor)
	if (!resolvedBlock || currentAnchorViewportOffset == null) {
		return { scrollTop: fallbackScrollTop, resolvedBlock: null }
	}
	return {
		scrollTop: currentScrollTop + currentAnchorViewportOffset - savedAnchorViewportOffset,
		resolvedBlock,
	}
}
