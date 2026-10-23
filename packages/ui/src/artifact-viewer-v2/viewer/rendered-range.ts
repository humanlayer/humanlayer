/**
 * Custom browser-range adapter for Artifact Viewer V2 (plannotator-inspired).
 *
 * The persisted quote is NOT inferred from `Selection.toString()`, whose
 * whitespace reflects HTML source rather than visual block boundaries. Instead
 * a normalized `Range` is cloned into an offscreen rendered container and read
 * with `innerText` (block boundaries become newlines), with `Range.toString()`
 * as the fallback. Selection direction and text-node endpoints are normalized
 * first, endpoints that spilled into the next node at offset zero are pulled
 * back, and ranges that cross viewer chrome / excluded NodeView controls are
 * rejected. Toolbar geometry anchors to the selection's leading (first-line)
 * client rect so the floating bar sits at the start of the selection rather
 * than the center of a tall multi-line/multi-block bounding box.
 *
 * Everything here is DOM-only and independent of React and persistence.
 */

/** Selectors whose subtree is not part of the annotatable document. */
export const EXCLUDED_RANGE_SELECTORS = [
	'.artifact-viewer-v2-heading-disclosure',
	'.artifact-viewer-v2-comment-gutter',
	'.artifact-viewer-v2-outline-toggle',
	'button',
	'[contenteditable="false"] button',
]

export interface NormalizedEndpoints {
	startContainer: Node
	startOffset: number
	endContainer: Node
	endOffset: number
}

/** Deepest text node at (or before) an element/offset, for endpoint descent. */
function descendToText(node: Node, offset: number, preferEnd: boolean): { node: Node; offset: number } {
	let current: Node = node
	let currentOffset = offset
	while (current.nodeType === Node.ELEMENT_NODE) {
		const children = current.childNodes
		if (children.length === 0) break
		const index = Math.min(currentOffset, children.length - 1)
		const child = preferEnd ? children[Math.max(0, currentOffset - 1)] : children[index]
		if (!child) break
		current = child
		currentOffset = preferEnd ? nodeLength(child) : 0
	}
	return { node: current, offset: currentOffset }
}

function nodeLength(node: Node): number {
	return node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length
}

function previousTextNode(node: Node, root: Node): Text | null {
	let current: Node | null = node
	while (current && current !== root) {
		let sibling = current.previousSibling
		while (sibling) {
			const deepest = deepestLastText(sibling)
			if (deepest) return deepest
			sibling = sibling.previousSibling
		}
		current = current.parentNode
	}
	return null
}

function deepestLastText(node: Node): Text | null {
	if (node.nodeType === Node.TEXT_NODE) {
		return (node.textContent?.length ?? 0) > 0 ? (node as Text) : null
	}
	for (let i = node.childNodes.length - 1; i >= 0; i--) {
		const found = deepestLastText(node.childNodes[i]!)
		if (found) return found
	}
	return null
}

/**
 * Normalize a range's endpoints to exact text-node boundaries: descend element
 * endpoints to their text nodes, and treat an end sitting at offset zero of a
 * node as the trailing boundary of the previous text node (the browser
 * focus-spill regression plannotator documents).
 */
export function normalizeRangeEndpoints(range: Range, root: Node): NormalizedEndpoints {
	const start = descendToText(range.startContainer, range.startOffset, false)
	let end = descendToText(range.endContainer, range.endOffset, true)

	// Focus spill: an end at offset zero of the next text node actually ended at
	// the previous selected boundary.
	if (end.node.nodeType === Node.TEXT_NODE && end.offset === 0) {
		const prev = previousTextNode(end.node, root)
		if (prev) end = { node: prev, offset: prev.textContent?.length ?? 0 }
	}

	return {
		startContainer: start.node,
		startOffset: start.offset,
		endContainer: end.node,
		endOffset: end.offset,
	}
}

/** Whether a node lies inside the root and outside every excluded subtree. */
export function isNodeAnnotatable(node: Node, root: Element, excludedSelectors: string[] = EXCLUDED_RANGE_SELECTORS): boolean {
	const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
	if (!element || !root.contains(element)) return false
	for (const selector of excludedSelectors) {
		if (element.closest(selector)) return false
	}
	return true
}

/**
 * Read the visible quote of a range: clone into an offscreen container and read
 * `innerText` so visual block boundaries become newlines, falling back to
 * `Range.toString()`. Never uses `display: none` (which zeroes `innerText`).
 */
export function readRangeText(range: Range, doc: Document = document): string {
	try {
		const holder = doc.createElement('div')
		holder.style.position = 'absolute'
		holder.style.left = '-9999px'
		holder.style.whiteSpace = 'pre-wrap'
		holder.appendChild(range.cloneContents())
		doc.body.appendChild(holder)
		const text = holder.innerText
		doc.body.removeChild(holder)
		if (typeof text === 'string' && text.length > 0) return text
	} catch {
		// Fall through to toString below.
	}
	return range.toString()
}

/** Union the non-empty client rects of a range into one bounding rect. */
export function unionRects(rects: DOMRect[]): DOMRect | null {
	const usable = rects.filter((rect) => rect.width > 0 && rect.height > 0)
	if (usable.length === 0) return null
	let left = Infinity
	let top = Infinity
	let right = -Infinity
	let bottom = -Infinity
	for (const rect of usable) {
		left = Math.min(left, rect.left)
		top = Math.min(top, rect.top)
		right = Math.max(right, rect.right)
		bottom = Math.max(bottom, rect.bottom)
	}
	return new DOMRect(left, top, right - left, bottom - top)
}

/**
 * The selection's leading client rect: the first non-empty rect in document
 * order (top-most line, then left-most fragment). Floating UI anchors here so
 * the toolbar/composer appears at the start of the selection — a wide multi-line
 * union would instead center the bar mid-page, far from the text.
 */
export function leadingRect(rects: DOMRect[]): DOMRect | null {
	for (const rect of rects) {
		if (rect.width > 0 && rect.height > 0) return rect
	}
	return null
}

export interface RenderedSelection {
	/** The normalized, direction-corrected range. */
	range: Range
	/** Visible quote (innerText of the cloned range, with block newlines). */
	quote: string
	/** The selection's leading (first-line) client rect; null if none exposed. */
	rect: DOMRect | null
}

/**
 * Extract a normalized rendered selection from the live `Selection`, or null
 * when the selection is empty, collapsed, whitespace-only, or crosses viewer
 * chrome / excluded NodeView controls. Direction is normalized to forward.
 */
export function extractRenderedSelection(
	selection: Selection | null,
	root: Element,
	excludedSelectors: string[] = EXCLUDED_RANGE_SELECTORS,
	doc: Document = document,
): RenderedSelection | null {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
	const raw = selection.getRangeAt(0)
	if (raw.collapsed) return null

	const normalized = normalizeRangeEndpoints(raw, root)
	if (
		!isNodeAnnotatable(normalized.startContainer, root, excludedSelectors) ||
		!isNodeAnnotatable(normalized.endContainer, root, excludedSelectors)
	) {
		return null
	}

	const range = doc.createRange()
	try {
		range.setStart(normalized.startContainer, normalized.startOffset)
		range.setEnd(normalized.endContainer, normalized.endOffset)
	} catch {
		return null
	}
	if (range.collapsed) return null

	const quote = readRangeText(range, doc)
	if (quote.trim().length === 0) return null

	return { range, quote, rect: leadingRect(Array.from(range.getClientRects())) }
}
