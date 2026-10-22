import { describe, expect, it } from 'vitest'

import { diffBlocks, revisionBase } from '@/minimalist/lib/doc-diff'

describe('diffBlocks', () => {
	it('finds nothing between the same blocks, whatever their whitespace', () => {
		const changes = diffBlocks(['# Plan', 'Step  one'], ['# Plan', 'Step one\n'])
		expect(changes.marks.size).toBe(0)
		expect(changes.removed.size).toBe(0)
		expect(changes.counts).toEqual({ added: 0, changed: 0, removed: 0 })
	})

	it('marks added blocks and places removed ones before the block that follows them', () => {
		const changes = diffBlocks(['# Plan', 'Old step', 'Keep'], ['# Plan', 'Keep', 'New step'])
		expect([...changes.marks]).toEqual([[2, 'added']])
		expect([...changes.removed]).toEqual([[1, ['Old step']]])
		expect(changes.counts).toEqual({ added: 1, changed: 0, removed: 1 })
	})

	it('reads a removal beside an addition as a reworded block', () => {
		const changes = diffBlocks(['# Plan', 'Step one', 'Done'], ['# Plan', 'Step one, tested', 'Done'])
		expect([...changes.marks]).toEqual([[1, 'changed']])
		expect(changes.removed.size).toBe(0)
		expect(changes.counts).toEqual({ added: 0, changed: 1, removed: 0 })
	})

	it('keeps what is left of an uneven run', () => {
		const changes = diffBlocks(['A', 'B', 'C', 'D'], ['A', 'X', 'D', 'E'])
		expect([...changes.marks]).toEqual([
			[1, 'changed'],
			[3, 'added'],
		])
		expect([...changes.removed]).toEqual([[2, ['C']]])
	})

	it('puts blocks removed from the end after the last block', () => {
		const changes = diffBlocks(['A', 'B'], ['A'])
		expect([...changes.removed]).toEqual([[1, ['B']]])
	})
})

describe('revisionBase', () => {
	const minute = 60_000
	const version = (versionNumber: number, createdAt: number) => ({
		id: `v${versionNumber}`,
		versionNumber,
		createdAt,
	})

	it('reaches back past saves made close together', () => {
		const archived = [version(1, 0), version(2, 60 * minute), version(3, 61 * minute), version(4, 63 * minute)]
		expect(revisionBase(archived)?.id).toBe('v2')
	})

	it('takes the last save alone when the one before it is long past', () => {
		expect(revisionBase([version(1, 0), version(2, 90 * minute)])?.id).toBe('v2')
	})

	it('has nothing to compare before the first save', () => {
		expect(revisionBase([])).toBeNull()
	})
})
