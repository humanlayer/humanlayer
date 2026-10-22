import { describe, expect, test } from 'vitest'

import { selectActiveOutlineSection, type ObservedHeadingPosition } from './active-outline-section'

const ACTIVATION_LINE = 80

function select(headings: ObservedHeadingPosition[], options?: { atBottom?: boolean; activationLine?: number }) {
	return selectActiveOutlineSection({
		headings,
		activationLine: options?.activationLine ?? ACTIVATION_LINE,
		atBottom: options?.atBottom ?? false,
	})
}

describe('selectActiveOutlineSection', () => {
	test('returns null for a document with no headings', () => {
		expect(select([])).toBeNull()
	})

	test('document top: selects the first heading when nothing has crossed the line', () => {
		expect(
			select([
				{ id: 'h1-a', top: 200 },
				{ id: 'h2-b', top: 500 },
				{ id: 'h2-c', top: 900 },
			]),
		).toBe('h1-a')
	})

	test('activation-line crossing: a heading at exactly the line becomes active', () => {
		expect(
			select([
				{ id: 'h1-a', top: ACTIVATION_LINE },
				{ id: 'h2-b', top: 400 },
			]),
		).toBe('h1-a')
	})

	test('multiple visible headings: the last one that crossed the line wins', () => {
		expect(
			select([
				{ id: 'h1-a', top: -600 },
				{ id: 'h2-b', top: -100 },
				{ id: 'h3-c', top: 40 },
				{ id: 'h2-d', top: 300 },
				{ id: 'h1-e', top: 700 },
			]),
		).toBe('h3-c')
	})

	test('headings above the activation line stay crossed while scrolling deeper', () => {
		expect(
			select([
				{ id: 'h1-a', top: -2000 },
				{ id: 'h2-b', top: -1200 },
				{ id: 'h2-c', top: 500 },
			]),
		).toBe('h2-b')
	})

	test('scrolling back above the first heading re-activates the first item', () => {
		// After scrolling down and back up, every top is below the line again.
		expect(
			select([
				{ id: 'h1-a', top: 120 },
				{ id: 'h2-b', top: 480 },
			]),
		).toBe('h1-a')
	})

	test('document bottom: retains the final section even if its heading never crossed', () => {
		expect(
			select(
				[
					{ id: 'h1-a', top: -900 },
					{ id: 'h2-b', top: -300 },
					{ id: 'h2-final', top: 200 },
				],
				{ atBottom: true },
			),
		).toBe('h2-final')
	})

	test('last section: once the final heading crosses the line it stays active', () => {
		expect(
			select([
				{ id: 'h1-a', top: -900 },
				{ id: 'h2-final', top: 10 },
			]),
		).toBe('h2-final')
	})

	test('stable result when geometry changes without crossing a section boundary', () => {
		const before = select([
			{ id: 'h1-a', top: -240 },
			{ id: 'h2-b', top: 30 },
			{ id: 'h2-c', top: 420 },
		])
		const after = select([
			{ id: 'h1-a', top: -260 },
			{ id: 'h2-b', top: 10 },
			{ id: 'h2-c', top: 400 },
		])
		expect(before).toBe('h2-b')
		expect(after).toBe('h2-b')
	})

	test('single heading is active at the top, when crossed, and at the bottom', () => {
		expect(select([{ id: 'h1-only', top: 300 }])).toBe('h1-only')
		expect(select([{ id: 'h1-only', top: -50 }])).toBe('h1-only')
		expect(select([{ id: 'h1-only', top: -50 }], { atBottom: true })).toBe('h1-only')
	})
})
