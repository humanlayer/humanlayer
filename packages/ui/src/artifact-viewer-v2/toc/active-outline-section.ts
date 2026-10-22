/** A heading observed in the rendered document, in document order. */
export interface ObservedHeadingPosition {
	/** Outline item ID of the heading. */
	id: string
	/**
	 * Vertical offset of the rendered heading relative to the top of the
	 * artifact document's own scroll viewport, in px. Negative when the heading
	 * has scrolled above the visible area.
	 */
	top: number
}

export interface ActiveOutlineSectionInput {
	/** Observed headings in document order (tops ascend with document order). */
	headings: ObservedHeadingPosition[]
	/**
	 * The activation line: a small offset below the top of the document
	 * viewport. A heading "crosses" the line once its top is at or above it.
	 */
	activationLine: number
	/**
	 * True when the document scroll container is scrolled to its bottom.
	 * Callers must only report `true` when the container actually scrolls
	 * (scrollHeight > clientHeight); an unscrollable document is "at the top".
	 */
	atBottom: boolean
}

/**
 * Pure selection rule for the active outline section while reading.
 *
 * - The active section is the last heading that has crossed the activation
 *   line near the top of the document viewport (`top <= activationLine`).
 * - Document top / nothing crossed yet: the first heading is active.
 * - Scrolled to the document bottom: the final section stays active, even if
 *   its heading never reaches the activation line.
 * - No headings: nothing is active.
 *
 * The result is a pure function of the observed geometry, so re-measuring
 * without crossing a section boundary always yields the same ID.
 */
export function selectActiveOutlineSection({
	headings,
	activationLine,
	atBottom,
}: ActiveOutlineSectionInput): string | null {
	if (headings.length === 0) return null
	if (atBottom) return headings[headings.length - 1]!.id

	let activeId = headings[0]!.id
	for (const heading of headings) {
		if (heading.top <= activationLine) activeId = heading.id
	}
	return activeId
}
