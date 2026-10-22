import { describe, expect, it } from 'vitest'

import type { DiffLineNavigationTarget } from './diff-keyboard-range'
import { extendDiffKeyboardRange, orderedDiffKeyboardRange, startDiffKeyboardRange } from './diff-keyboard-range'

function line(fileId: string, lineNumber: number): DiffLineNavigationTarget {
	return {
		id: `line:${fileId}:additions:${lineNumber}`,
		kind: 'line',
		fileId,
		lineNumber,
		side: 'additions',
	}
}

const lines = [line('a.ts', 1), line('a.ts', 2), line('a.ts', 3)]

describe('diff keyboard range', () => {
	it('grows, contracts, reverses, and preserves a fixed anchor', () => {
		const started = startDiffKeyboardRange(lines[1]!)
		const grown = extendDiffKeyboardRange(started, lines, 1)
		expect(orderedDiffKeyboardRange(grown, lines).map((target) => target.lineNumber)).toEqual([2, 3])

		const contracted = extendDiffKeyboardRange(grown, lines, -1)
		expect(orderedDiffKeyboardRange(contracted, lines).map((target) => target.lineNumber)).toEqual([2])

		const reversed = extendDiffKeyboardRange(contracted, lines, -1)
		expect(reversed.anchor.lineNumber).toBe(2)
		expect(reversed.head.lineNumber).toBe(1)
		expect(orderedDiffKeyboardRange(reversed, lines).map((target) => target.lineNumber)).toEqual([1, 2])
	})

	it('clamps at same-file boundaries', () => {
		const atStart = startDiffKeyboardRange(lines[0]!)
		const atEnd = startDiffKeyboardRange(lines[2]!)
		expect(extendDiffKeyboardRange(atStart, lines, -1)).toEqual(atStart)
		expect(extendDiffKeyboardRange(atEnd, lines, 1)).toEqual(atEnd)
		expect(extendDiffKeyboardRange(atStart, [line('b.ts', 1)], 1)).toEqual(atStart)
	})
})
