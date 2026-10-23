import { describe, expect, test } from 'vitest'

import { aggregateTaskStatus } from './taskStatus'

const s = (status: string | null, lastActivityAt: bigint | null = 0n) => ({ status, lastActivityAt })

describe('aggregateTaskStatus', () => {
	test('returns undefined for no sessions', () => {
		expect(aggregateTaskStatus([])).toBeUndefined()
	})

	test('returns undefined for idle / unknown statuses', () => {
		expect(aggregateTaskStatus([s('ready_for_input'), s('interrupted'), s('draft'), s(null)])).toBeUndefined()
	})

	test('needs_approval beats everything', () => {
		expect(aggregateTaskStatus([s('running'), s('failed', 99n), s('needs_approval')])).toBe('needs_approval')
	})

	test('most-recent failed beats running/pending', () => {
		expect(aggregateTaskStatus([s('running', 1n), s('failed', 2n)])).toBe('failed')
	})

	test('failed that is NOT most-recent does not win; running takes over', () => {
		expect(aggregateTaskStatus([s('failed', 1n), s('running', 2n)])).toBe('running')
	})

	test('lost alone returns the warning state', () => {
		expect(aggregateTaskStatus([s('lost')])).toBe('lost')
	})

	test('lost beats running, pending, and interrupt_requested', () => {
		expect(aggregateTaskStatus([s('interrupt_requested'), s('launching'), s('running'), s('lost')])).toBe('lost')
	})

	test('needs_approval and most-recent failed beat lost', () => {
		expect(aggregateTaskStatus([s('lost', 2n), s('failed', 3n)])).toBe('failed')
		expect(aggregateTaskStatus([s('lost', 3n), s('failed', 2n), s('needs_approval')])).toBe('needs_approval')
	})

	test('lost still wins when an older failure is followed by running', () => {
		expect(aggregateTaskStatus([s('failed', 1n), s('lost', 2n), s('running', 3n)])).toBe('lost')
	})

	test('running beats pending', () => {
		expect(aggregateTaskStatus([s('ready_for_launch'), s('running')])).toBe('running')
	})

	test('pending beats interrupt_requested', () => {
		expect(aggregateTaskStatus([s('interrupt_requested'), s('launching')])).toBe('pending')
	})

	test('ready_for_launch / launching / resuming all count as pending', () => {
		expect(aggregateTaskStatus([s('ready_for_launch')])).toBe('pending')
		expect(aggregateTaskStatus([s('launching')])).toBe('pending')
		expect(aggregateTaskStatus([s('resuming')])).toBe('pending')
	})

	test('interrupt_requested alone', () => {
		expect(aggregateTaskStatus([s('interrupt_requested')])).toBe('interrupt_requested')
	})
})
