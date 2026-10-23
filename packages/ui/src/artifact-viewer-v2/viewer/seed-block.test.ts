import { describe, expect, test } from 'vitest'

import { pickSeedBlockId, type SeedBlockGeometry } from './seed-block'

const LINE = 80

function geo(entries: Array<[string, number]>): SeedBlockGeometry[] {
	return entries.map(([id, top]) => ({ id, top }))
}

describe('pickSeedBlockId', () => {
	test('returns null when there is no geometry', () => {
		expect(pickSeedBlockId([], LINE, null)).toBeNull()
		expect(pickSeedBlockId([], LINE, 'a')).toBeNull()
	})

	test('prefers the hovered block regardless of scroll position', () => {
		const g = geo([
			['a', -400],
			['b', 40],
			['c', 300],
		])
		expect(pickSeedBlockId(g, LINE, 'c')).toBe('c')
	})

	test('ignores a hovered id that is not among the rendered blocks', () => {
		const g = geo([
			['a', -20],
			['b', 40],
			['c', 300],
		])
		// Falls through to the viewport rule; `b` is the last block above the line
		// and begins in view.
		expect(pickSeedBlockId(g, LINE, 'ghost')).toBe('b')
	})

	test('at the document top, seeds the first block', () => {
		const g = geo([
			['a', 16],
			['b', 60],
			['c', 200],
		])
		// Last block whose top has crossed the 80px line is `b`.
		expect(pickSeedBlockId(g, LINE, null)).toBe('b')
	})

	test('mid-document with short blocks, seeds the block at the activation line', () => {
		const g = geo([
			['a', -40],
			['b', 60],
			['c', 140],
			['d', 220],
		])
		// `b` is the last block above the line and begins in view (top >= 0).
		expect(pickSeedBlockId(g, LINE, null)).toBe('b')
	})

	test('does not yank up: a tall block crossing the line seeds the next in-view block', () => {
		// `a` spans from 300px above the viewport through past the activation line;
		// it is the block that "crosses" the line, but seeding it would scroll the
		// reader up to reveal its far-above top. The first block that begins in the
		// viewport (`b`) is seeded instead.
		const g = geo([
			['a', -300],
			['b', 420],
		])
		expect(pickSeedBlockId(g, LINE, null)).toBe('b')
	})

	test('falls back to the crossing block when nothing begins in the viewport', () => {
		// Only a single block covers the whole viewport and nothing else begins in
		// view: there is no better seed than the crossing block itself.
		const g = geo([['a', -300]])
		expect(pickSeedBlockId(g, LINE, null)).toBe('a')
	})

	test('near the bottom, seeds the last block above the line', () => {
		const g = geo([
			['a', -500],
			['b', -200],
			['c', 30],
		])
		// `c` begins in view and is the last block above the line.
		expect(pickSeedBlockId(g, LINE, null)).toBe('c')
	})
})
