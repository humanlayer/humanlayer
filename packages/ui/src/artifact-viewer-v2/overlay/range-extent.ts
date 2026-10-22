import type { EditorView } from '@tiptap/pm/view'

/** Viewport-space vertical extent of a rendered inline document range. */
export interface RangeExtent {
	/** Top of the range's first visual line. */
	top: number
	/** Bottom of the range's last visual line. */
	bottom: number
}

/**
 * Measure the vertical extent (first line top → last line bottom) of an inline
 * document range from its rendered DOM. A DOM `Range`'s `getClientRects()`
 * emits a rect per text-node/inline-element fragment; unioning their tops and
 * bottoms yields one contiguous band that spans the whole range — used both to
 * draw a single unbroken rail and to vertically center the gutter avatar on the
 * range rather than its containing block. Returns null when the range can't be
 * measured (stale positions mid-change).
 */
export function measureRangeExtent(view: EditorView, from: number, to: number): RangeExtent | null {
	try {
		const start = view.domAtPos(from)
		const end = view.domAtPos(to)
		const range = document.createRange()
		range.setStart(start.node, start.offset)
		range.setEnd(end.node, end.offset)
		const rects = range.getClientRects()
		let top = Number.POSITIVE_INFINITY
		let bottom = Number.NEGATIVE_INFINITY
		for (let index = 0; index < rects.length; index++) {
			const rect = rects[index]
			if (!rect || rect.height === 0) continue
			top = Math.min(top, rect.top)
			bottom = Math.max(bottom, rect.bottom)
		}
		if (top === Number.POSITIVE_INFINITY) return null
		return { top, bottom }
	} catch {
		return null
	}
}
