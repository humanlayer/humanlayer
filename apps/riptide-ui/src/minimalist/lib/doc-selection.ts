import type { DocPoint } from '@/minimalist/lib/doc-anchors'

/**
 * Where a text selection sits in a rendered document, in the terms `docBlocks` uses. Each
 * top-level block renders in an element with `data-block={index}`, its markdown inside `.prose`.
 */
export type DocSelection = { start: DocPoint; end: DocPoint; text: string }

const CANDIDATES = 'p, h1, h2, h3, h4, h5, h6, pre, td, th, li, hr, img'
/** Inside a textblock, these hold another block's text or no document text at all. */
const NOT_OWN_TEXT = 'ul, ol, p, button, .copy-code'

/** A rendered top-level block's textblocks and atoms, in the order `docBlocks` lists them. */
export function renderedBlocks(top: Element): Element[] {
	const prose = top.querySelector('.prose')
	if (!prose) return []
	return [...prose.querySelectorAll(CANDIDATES)].filter((element) => {
		// A loose list item's paragraphs are its textblocks; a tight one is a textblock itself.
		if (element.tagName === 'LI') return !element.querySelector(':scope > p')
		if (element.tagName === 'P') return !imagesOnly(element)
		if (element.tagName === 'IMG')
			return element.parentElement?.tagName === 'P' && imagesOnly(element.parentElement)
		return true
	})
}

/** The selection as block points, or null when either end is outside the document's text. */
export function readSelection(selection: Selection | null): DocSelection | null {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
	const range = selection.getRangeAt(0)
	const start = pointAt(range.startContainer, range.startOffset)
	const end = pointAt(range.endContainer, range.endOffset)
	const text = range.toString()
	return start && end && text.trim() ? { start, end, text } : null
}

function pointAt(node: Node, offset: number): DocPoint | null {
	const element = node instanceof Element ? node : node.parentElement
	const top = element?.closest<HTMLElement>('[data-block]')
	if (!element || !top) return null
	const blocks = renderedBlocks(top)
	// The innermost one: a nested list item sits inside its parent item.
	const block = [...blocks].reverse().find((candidate) => candidate === element || candidate.contains(element))
	if (!block) return null
	return { top: Number(top.dataset.block), ordinal: blocks.indexOf(block), offset: offsetIn(block, node, offset) }
}

/** A DOM range over the text between two block points, or null when those blocks aren't rendered. */
export function domRange(root: Element, start: DocPoint, end: DocPoint): Range | null {
	const from = domPoint(root, start)
	const to = domPoint(root, end)
	if (!from || !to) return null
	const range = document.createRange()
	range.setStart(from.node, from.offset)
	range.setEnd(to.node, to.offset)
	return range
}

/** One run of a block's own text: a text node, or a `<br>` that reads as one newline. */
type Run = { node: Node; length: number; skip: number }

/**
 * A textblock's own text, run by run, as `docBlocks` reads it. The markdown renderer puts a
 * newline text node after each `<br>`; the break already counted it, so it is skipped.
 */
function* runs(block: Element): Generator<Run> {
	let afterBreak = false
	const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
	for (let current = walker.nextNode(); current; current = walker.nextNode()) {
		if (!ownText(block, current)) continue
		if (current.nodeType === Node.TEXT_NODE) {
			const text = current.textContent ?? ''
			const skip = afterBreak && text.startsWith('\n') ? 1 : 0
			afterBreak = false
			yield { node: current, length: text.length - skip, skip }
		} else if ((current as Element).tagName === 'BR') {
			afterBreak = true
			yield { node: current, length: 1, skip: 0 }
		}
	}
}

/** Characters of the block's own text before a DOM point. */
function offsetIn(block: Element, node: Node, offset: number): number {
	const boundary = document.createRange()
	boundary.setStart(node, offset)
	let count = 0
	for (const run of runs(block)) {
		if (run.node === node) return count + Math.max(0, Math.min(offset - run.skip, run.length))
		// Stop at the first run past the boundary.
		if (boundary.comparePoint(run.node, 0) > 0) return count
		count += run.length
	}
	// A code block's text ends with a newline that isn't part of the code.
	return block.tagName === 'PRE' ? Math.min(count, (block.textContent ?? '').replace(/\n$/, '').length) : count
}

/** The DOM position of a block point: a text node and an offset into it. */
function domPoint(root: Element, point: DocPoint): { node: Node; offset: number } | null {
	const top = root.querySelector(`[data-block="${point.top}"]`)
	const block = top ? renderedBlocks(top)[point.ordinal] : undefined
	if (!block) return null
	let remaining = point.offset
	let last: { node: Node; offset: number } = { node: block, offset: 0 }
	for (const run of runs(block)) {
		if (run.node.nodeType !== Node.TEXT_NODE) {
			const parent = run.node.parentNode
			const index = parent ? [...parent.childNodes].indexOf(run.node as ChildNode) : 0
			if (remaining === 0 && parent) return { node: parent, offset: index }
			remaining -= 1
			if (parent) last = { node: parent, offset: index + 1 }
			continue
		}
		if (remaining <= run.length) return { node: run.node, offset: remaining + run.skip }
		remaining -= run.length
		last = { node: run.node, offset: run.length + run.skip }
	}
	return last
}

function ownText(block: Element, node: Node): boolean {
	const element = node instanceof Element ? node : node.parentElement
	const outside = element?.closest(NOT_OWN_TEXT)
	return !outside || outside === block || !block.contains(outside)
}

function imagesOnly(paragraph: Element): boolean {
	const images = paragraph.querySelectorAll('img').length
	return images > 0 && paragraph.children.length === images && !paragraph.textContent?.trim()
}
