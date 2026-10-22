import { describe, expect, test } from 'vitest'
import { RPI_LABELS } from './rpi-skills'

/**
 * Rank-contract test: the index of a label in RPI_LABELS is its progression rank
 * (ascending = more progressed). Both the sidebar (`getMostProgressedLabel`) and
 * the task table (`useTaskMostProgressedLabel`) pick the furthest-along label by
 * `RPI_LABELS.findIndex(name)`, so this ordering must stay stable.
 */
describe('RPI_LABELS rank contract', () => {
	const rank = (name: string) => RPI_LABELS.findIndex((label) => label.name === name)

	test('every expected label is present in RPI_LABELS', () => {
		for (const name of [
			'rpi:todo',
			'rpi:research-questions',
			'rpi:research',
			'rpi:design',
			'rpi:design-prd',
			'rpi:design-tdd',
			'rpi:structure',
		]) {
			expect(rank(name)).toBeGreaterThanOrEqual(0)
		}
	})

	test('progression rank is todo < research-questions < research < design < design-prd < design-tdd < structure', () => {
		expect(rank('rpi:todo')).toBeLessThan(rank('rpi:research-questions'))
		expect(rank('rpi:research-questions')).toBeLessThan(rank('rpi:research'))
		expect(rank('rpi:research')).toBeLessThan(rank('rpi:design'))
		expect(rank('rpi:design')).toBeLessThan(rank('rpi:design-prd'))
		expect(rank('rpi:design-prd')).toBeLessThan(rank('rpi:design-tdd'))
		expect(rank('rpi:design-tdd')).toBeLessThan(rank('rpi:structure'))
	})

	test('design-prd and design-tdd outrank research (the core CORE-1323 fix)', () => {
		expect(rank('rpi:design-prd')).toBeGreaterThan(rank('rpi:research'))
		expect(rank('rpi:design-tdd')).toBeGreaterThan(rank('rpi:research'))
	})

	test('RPI_LABELS order matches the documented progression sequence', () => {
		expect(RPI_LABELS.map((label) => label.name)).toEqual([
			'rpi:todo',
			'rpi:research-questions',
			'rpi:research',
			'rpi:design',
			'rpi:design-prd',
			'rpi:design-tdd',
			'rpi:structure',
			'rpi:plan',
			'rpi:worktree-setup',
			'rpi:implementation',
			'rpi:describe-pr',
			'rpi:review',
		])
	})
})
