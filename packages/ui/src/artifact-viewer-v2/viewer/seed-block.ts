/**
 * Seed selection for keyboard block navigation (`j`/`k`) when no block is yet
 * focused. The first press must land the cursor on a block the reader is
 * already looking at — never yank the document back to the top.
 */

/** One navigable block's vertical geometry, in document order. `top` is the
 *  block's top edge relative to the scroll container's client top (i.e.
 *  `blockRect.top - containerRect.top`): negative when the block began above
 *  the viewport, `0` at the container's top edge. */
export interface SeedBlockGeometry {
	id: string
	top: number
}

/**
 * Pick the block to seed the keyboard cursor on for the first `j/k` press.
 *
 * Precedence:
 * 1. The hovered block, when the pointer is over a rendered block — the reader
 *    pointed at where they want to start, so start there (no scroll).
 * 2. Otherwise the block nearest the activation line, matching the outline's
 *    active-section rule: the last block whose top has crossed the line.
 *
 * The viewport fallback avoids the "scroll back to the top" bug: the block that
 * *crosses* the activation line is frequently a tall block (code block, table,
 * long paragraph) that began well above the viewport, so seeding it would make
 * the follow-up comfort-scroll reveal its far-above top and yank the reader
 * upward. When the crossing block began above the viewport (`top < 0`) we seed
 * the first block that actually begins within the viewport instead, so seeding
 * stays put.
 *
 * Returns the chosen block id, or `null` when there is no geometry to seed from.
 */
export function pickSeedBlockId(
	geometries: SeedBlockGeometry[],
	activationLine: number,
	hoveredBlockId: string | null,
): string | null {
	if (geometries.length === 0) return null

	if (hoveredBlockId != null && geometries.some((g) => g.id === hoveredBlockId)) {
		return hoveredBlockId
	}

	// Last block whose top has crossed the activation line (same rule the active
	// outline section uses); the first block until anything has crossed.
	let crossed = geometries[0]!
	for (const g of geometries) {
		if (g.top <= activationLine) crossed = g
		else break
	}

	// A tall block spanning the activation line begins above the viewport;
	// seeding it would scroll upward to reveal its top. Prefer the first block
	// that begins within the viewport so the seed causes no upward jump.
	if (crossed.top < 0) {
		const firstInView = geometries.find((g) => g.top >= 0)
		if (firstInView) return firstInView.id
	}

	return crossed.id
}
