import { describe, expect, test } from 'vitest'

import type { SectionRange } from '../folding/section-ranges'
import type { NavigableBlock } from './build-navigable-blocks'
import { selectedRangeIds, startKeyboardRange, stepKeyboardRange } from './keyboard-range'

function block(id: string, pos: number, sectionId: string | null): NavigableBlock {
	return { id, pos, end: pos + 2, type: 'paragraph', kind: 'textblock', sectionId }
}

// Document:
//   h1     (section h1)
//   p1     (section h1)
//   h2     (section h2, nested under h1)
//   p2a    (section h2)
//   p2b    (section h2)
//   h1b    (section h1b)
//   p3     (section h1b)
const ALL: NavigableBlock[] = [
	block('h1', 0, 'h1'),
	block('p1', 2, 'h1'),
	block('h2', 4, 'h2'),
	block('p2a', 6, 'h2'),
	block('p2b', 8, 'h2'),
	block('h1b', 10, 'h1b'),
	block('p3', 12, 'h1b'),
]

const SECTIONS: SectionRange[] = [
	{
		id: 'h1',
		headingPos: 0,
		endPos: 10,
		level: 1,
		descendantBlocks: [
			{ id: 'p1', pos: 2, end: 4 },
			{ id: 'h2', pos: 4, end: 6 },
			{ id: 'p2a', pos: 6, end: 8 },
			{ id: 'p2b', pos: 8, end: 10 },
		],
	},
	{
		id: 'h2',
		headingPos: 4,
		endPos: 10,
		level: 2,
		descendantBlocks: [
			{ id: 'p2a', pos: 6, end: 8 },
			{ id: 'p2b', pos: 8, end: 10 },
		],
	},
	{ id: 'h1b', headingPos: 10, endPos: Infinity, level: 1, descendantBlocks: [{ id: 'p3', pos: 12, end: 14 }] },
]

const NONE: ReadonlySet<string> = new Set()

describe('keyboard-range state machine', () => {
	test('extending downward grows the range from the anchor', () => {
		let state = startKeyboardRange('p1')
		expect(selectedRangeIds(state, ALL)).toEqual(['p1'])
		const step = stepKeyboardRange({ ...state, allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: NONE, direction: 1 })
		state = step.state
		expect(state.headId).toBe('h2')
		expect(step.selectedIds).toEqual(['p1', 'h2'])
		expect(step.unfoldHeadingIds).toEqual([])
	})

	test('reversing direction contracts, then crosses the anchor', () => {
		// anchor p1, head extended to p2a
		let state = { anchorId: 'p1', headId: 'p2a' }
		// Up: head -> h2 (contract)
		let step = stepKeyboardRange({ ...state, allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: NONE, direction: -1 })
		state = step.state
		expect(step.selectedIds).toEqual(['p1', 'h2'])
		// Up: head -> p1 (single block)
		step = stepKeyboardRange({ ...state, allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: NONE, direction: -1 })
		state = step.state
		expect(step.selectedIds).toEqual(['p1'])
		// Up again: head -> h1, crossing the anchor
		step = stepKeyboardRange({ ...state, allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: NONE, direction: -1 })
		expect(step.selectedIds).toEqual(['h1', 'p1'])
	})

	test('clamps at the document boundaries', () => {
		const top = stepKeyboardRange({ anchorId: 'h1', headId: 'h1', allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: NONE, direction: -1 })
		expect(top.state.headId).toBe('h1')
		const bottom = stepKeyboardRange({ anchorId: 'p3', headId: 'p3', allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: NONE, direction: 1 })
		expect(bottom.state.headId).toBe('p3')
	})

	test('entering a collapsed section downward unfolds it and adds its first block', () => {
		const folded = new Set(['h2'])
		// Head at the folded heading h2; moving down enters the hidden section.
		const step = stepKeyboardRange({ anchorId: 'p1', headId: 'h2', allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: folded, direction: 1 })
		expect(step.unfoldHeadingIds).toEqual(['h2'])
		expect(step.state.headId).toBe('p2a')
		expect(step.selectedIds).toEqual(['p1', 'h2', 'p2a'])
	})

	test('entering a collapsed section upward unfolds it and adds its last block', () => {
		const folded = new Set(['h2'])
		// Head at h1b; moving up crosses into the collapsed h2 section from below.
		const step = stepKeyboardRange({ anchorId: 'p3', headId: 'h1b', allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: folded, direction: -1 })
		expect(step.unfoldHeadingIds).toEqual(['h2'])
		expect(step.state.headId).toBe('p2b')
	})

	test('traversing nested folds progressively unfolds each entered section', () => {
		// Both the h1 section and the nested h2 section are collapsed. Walking down
		// from h1 enters each in turn, unfolding only what hides the next block.
		const folded = new Set(['h1', 'h2'])

		let step = stepKeyboardRange({ anchorId: 'h1', headId: 'h1', allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: folded, direction: 1 })
		expect(step.unfoldHeadingIds).toEqual(['h1'])
		expect(step.state.headId).toBe('p1')
		for (const id of step.unfoldHeadingIds) folded.delete(id)

		step = stepKeyboardRange({ ...step.state, allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: folded, direction: 1 })
		expect(step.state.headId).toBe('h2') // the nested heading is visible; no unfold yet
		expect(step.unfoldHeadingIds).toEqual([])

		step = stepKeyboardRange({ ...step.state, allBlocks: ALL, sectionRanges: SECTIONS, foldedHeadingIds: folded, direction: 1 })
		expect(step.unfoldHeadingIds).toEqual(['h2'])
		expect(step.state.headId).toBe('p2a')
	})
})
