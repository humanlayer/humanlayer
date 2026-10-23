import { afterEach, describe, expect, test } from 'vitest'

import {
	extractRenderedSelection,
	isNodeAnnotatable,
	leadingRect,
	normalizeRangeEndpoints,
	readRangeText,
	unionRects,
} from './rendered-range'

afterEach(() => {
	document.body.innerHTML = ''
})

function mount(html: string): HTMLElement {
	const root = document.createElement('div')
	root.className = 'root'
	root.innerHTML = html
	document.body.appendChild(root)
	return root
}

/** A minimal Selection over a single range, for composition tests. */
function selectionOver(range: Range): Selection {
	return {
		rangeCount: 1,
		isCollapsed: range.collapsed,
		getRangeAt: () => range,
	} as unknown as Selection
}

describe('unionRects', () => {
	test('unions non-empty rects and discards zero-area rects', () => {
		const rects = [new DOMRect(10, 10, 0, 0), new DOMRect(20, 30, 40, 10), new DOMRect(80, 20, 10, 40)]
		const union = unionRects(rects)
		expect(union).not.toBeNull()
		expect(union!.left).toBe(20)
		expect(union!.top).toBe(20)
		expect(union!.right).toBe(90)
		expect(union!.bottom).toBe(60)
	})

	test('returns null when every rect is empty', () => {
		expect(unionRects([new DOMRect(0, 0, 0, 0)])).toBeNull()
	})
})

describe('leadingRect', () => {
	test('returns the first non-empty rect (the selection start line), not the union', () => {
		const rects = [new DOMRect(0, 0, 0, 0), new DOMRect(20, 30, 40, 10), new DOMRect(5, 80, 300, 10)]
		const leading = leadingRect(rects)
		// The tall multi-line union would center near x=155; the leading rect keeps
		// the toolbar over the first line's start fragment instead.
		expect(leading).toEqual(new DOMRect(20, 30, 40, 10))
	})

	test('returns null when every rect is empty', () => {
		expect(leadingRect([new DOMRect(10, 10, 0, 0)])).toBeNull()
	})
})

describe('isNodeAnnotatable', () => {
	test('text inside the document is annotatable, text inside excluded chrome is not', () => {
		const root = mount('<p>hello</p><button class="artifact-viewer-v2-heading-disclosure">x</button>')
		const paragraphText = root.querySelector('p')!.firstChild!
		const buttonText = root.querySelector('button')!.firstChild!
		expect(isNodeAnnotatable(paragraphText, root)).toBe(true)
		expect(isNodeAnnotatable(buttonText, root)).toBe(false)
	})

	test('a node outside the root is rejected', () => {
		const root = mount('<p>inside</p>')
		const outside = document.createElement('span')
		document.body.appendChild(outside)
		expect(isNodeAnnotatable(outside, root)).toBe(false)
	})
})

describe('normalizeRangeEndpoints', () => {
	test('descends element endpoints to their text nodes', () => {
		const root = mount('<p>alpha</p>')
		const p = root.querySelector('p')!
		const range = document.createRange()
		range.setStart(p, 0)
		range.setEnd(p, 1)
		const normalized = normalizeRangeEndpoints(range, root)
		expect(normalized.startContainer.nodeType).toBe(Node.TEXT_NODE)
		expect(normalized.endContainer.nodeType).toBe(Node.TEXT_NODE)
	})

	test('an end at offset zero of the next text node is pulled back to the previous boundary (focus spill)', () => {
		const p = document.createElement('p')
		const first = document.createTextNode('abc')
		const second = document.createTextNode('def')
		p.appendChild(first)
		p.appendChild(second)
		document.body.appendChild(p)

		const range = document.createRange()
		range.setStart(first, 0)
		range.setEnd(second, 0)
		const normalized = normalizeRangeEndpoints(range, p)
		expect(normalized.endContainer).toBe(first)
		expect(normalized.endOffset).toBe(3)
	})
})

describe('readRangeText', () => {
	test('reads the selected text (innerText clone or toString fallback)', () => {
		const root = mount('<p>hello world</p>')
		const textNode = root.querySelector('p')!.firstChild as Text
		const range = document.createRange()
		range.setStart(textNode, 0)
		range.setEnd(textNode, 5)
		expect(readRangeText(range).trim()).toBe('hello')
	})
})

describe('extractRenderedSelection', () => {
	test('returns a normalized rendered selection with its quote', () => {
		const root = mount('<p>hello world</p>')
		const textNode = root.querySelector('p')!.firstChild as Text
		const range = document.createRange()
		range.setStart(textNode, 0)
		range.setEnd(textNode, 5)
		const rendered = extractRenderedSelection(selectionOver(range), root)
		expect(rendered).not.toBeNull()
		expect(rendered!.quote.trim()).toBe('hello')
	})

	test('a collapsed selection yields null', () => {
		const root = mount('<p>hello</p>')
		const textNode = root.querySelector('p')!.firstChild as Text
		const range = document.createRange()
		range.setStart(textNode, 2)
		range.setEnd(textNode, 2)
		expect(extractRenderedSelection(selectionOver(range), root)).toBeNull()
	})

	test('a selection crossing excluded chrome is rejected', () => {
		const root = mount('<button class="artifact-viewer-v2-heading-disclosure">toggle</button>')
		const buttonText = root.querySelector('button')!.firstChild as Text
		const range = document.createRange()
		range.setStart(buttonText, 0)
		range.setEnd(buttonText, 3)
		expect(extractRenderedSelection(selectionOver(range), root)).toBeNull()
	})

	test('a whitespace-only selection yields null', () => {
		const root = mount('<p>   </p>')
		const textNode = root.querySelector('p')!.firstChild as Text
		const range = document.createRange()
		range.setStart(textNode, 0)
		range.setEnd(textNode, 3)
		expect(extractRenderedSelection(selectionOver(range), root)).toBeNull()
	})
})
