import { describe, expect, test } from 'vitest'
import { computeThreadGroupHeight, reverseClampToContainer } from './comment-layout'

const GAP = 8
const DEFAULT_HEIGHT = 120

function makeThread(id: string) {
	return { root: { id } }
}

describe('computeThreadGroupHeight', () => {
	test('returns default height for a single unmeasured thread', () => {
		const threads = [makeThread('a')]
		expect(computeThreadGroupHeight(threads, new Map(), GAP, DEFAULT_HEIGHT)).toBe(120)
	})

	test('uses measured height when available', () => {
		const threads = [makeThread('a')]
		const measured = new Map([['a', 200]])
		expect(computeThreadGroupHeight(threads, measured, GAP, DEFAULT_HEIGHT)).toBe(200)
	})

	test('sums multiple threads with gaps', () => {
		const threads = [makeThread('a'), makeThread('b'), makeThread('c')]
		const measured = new Map([
			['a', 100],
			['b', 50],
			['c', 80],
		])
		// 100 + 8 + 50 + 8 + 80 = 246
		expect(computeThreadGroupHeight(threads, measured, GAP, DEFAULT_HEIGHT)).toBe(246)
	})

	test('mixes measured and default heights', () => {
		const threads = [makeThread('a'), makeThread('b')]
		const measured = new Map([['a', 60]])
		// 60 + 8 + 120 = 188
		expect(computeThreadGroupHeight(threads, measured, GAP, DEFAULT_HEIGHT)).toBe(188)
	})

	test('returns 0 for empty threads array', () => {
		expect(computeThreadGroupHeight([], new Map(), GAP, DEFAULT_HEIGHT)).toBe(0)
	})
})

describe('reverseClampToContainer', () => {
	test('does nothing when all items fit', () => {
		const items = [
			{ threads: [makeThread('a')], top: 0 },
			{ threads: [makeThread('b')], top: 200 },
		]
		const measured = new Map([
			['a', 100],
			['b', 100],
		])
		reverseClampToContainer(items, 500, measured, GAP, DEFAULT_HEIGHT)
		expect(items[0]!.top).toBe(0)
		expect(items[1]!.top).toBe(200)
	})

	test('clamps the last item when it overflows', () => {
		const items = [
			{ threads: [makeThread('a')], top: 0 },
			{ threads: [makeThread('b')], top: 450 },
		]
		const measured = new Map([
			['a', 100],
			['b', 100],
		])
		// containerHeight=500, item b height=100, maxTop = 500 - 100 - 8 = 392
		reverseClampToContainer(items, 500, measured, GAP, DEFAULT_HEIGHT)
		expect(items[0]!.top).toBe(0)
		expect(items[1]!.top).toBe(392)
	})

	test('respects floor of the item above', () => {
		const items = [
			{ threads: [makeThread('a')], top: 380 },
			{ threads: [makeThread('b')], top: 600 },
		]
		const measured = new Map([
			['a', 100],
			['b', 100],
		])
		// item b maxTop = 500 - 100 - 8 = 392
		// floor from item a = 380 + 100 + 8 = 488
		// Math.max(488, 392) = 488
		reverseClampToContainer(items, 500, measured, GAP, DEFAULT_HEIGHT)
		expect(items[1]!.top).toBe(488)
	})

	test('clamps multiple overflowing items', () => {
		const items = [
			{ threads: [makeThread('a')], top: 300 },
			{ threads: [makeThread('b')], top: 500 },
			{ threads: [makeThread('c')], top: 700 },
		]
		const measured = new Map([
			['a', 80],
			['b', 80],
			['c', 80],
		])
		// container=500
		// item c: maxTop = 500 - 80 - 8 = 412. floor from b needed.
		// item b: maxTop = 500 - 80 - 8 = 412. But first clamp c, then b...
		// The algorithm walks bottom-to-top:
		// i=2 (c): maxTop=412, top=700 > 412. floor from b = 500+80+8=588 (original b.top).
		//   Actually b hasn't been clamped yet. floor = items[1].top + height(b) + gap = 500+80+8=588
		//   c.top = max(588, 412) = 588 -- still overflows but bounded by b's current pos
		// i=1 (b): maxTop=412, top=500 > 412. floor from a = 300+80+8=388
		//   b.top = max(388, 412) = 412
		// i=0 (a): maxTop=412, top=300 <= 412. break.
		reverseClampToContainer(items, 500, measured, GAP, DEFAULT_HEIGHT)
		expect(items[0]!.top).toBe(300)
		expect(items[1]!.top).toBe(412)
		// After b moved to 412, c's floor wasn't recalculated (single pass),
		// but c was already set to 588 in the first iteration
		expect(items[2]!.top).toBe(588)
	})

	test('is a no-op for empty items', () => {
		reverseClampToContainer([], 500, new Map(), GAP, DEFAULT_HEIGHT)
	})

	test('is a no-op for zero containerHeight', () => {
		const items = [{ threads: [makeThread('a')], top: 100 }]
		reverseClampToContainer(items, 0, new Map(), GAP, DEFAULT_HEIGHT)
		expect(items[0]!.top).toBe(100)
	})

	test('first item gets clamped with floor of 0', () => {
		const items = [{ threads: [makeThread('a')], top: 500 }]
		const measured = new Map([['a', 100]])
		// maxTop = 200 - 100 - 8 = 92, floor = 0
		reverseClampToContainer(items, 200, measured, GAP, DEFAULT_HEIGHT)
		expect(items[0]!.top).toBe(92)
	})
})
