import { CHECK_CONCLUSIONS, type CheckConclusion, type CheckRowType } from '@humanlayer/streams/pr-status'
import { describe, expect, it } from 'vitest'

import { type CheckGroupKind, checkGroupOf, countFailingChecks, formatCheckDuration, groupChecks } from './check-groups'

const check = (overrides: Partial<CheckRowType> = {}): CheckRowType => ({
	id: 'check_run:typecheck',
	name: 'typecheck',
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
	detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	...overrides,
})

const CONCLUSION_EXPECTATIONS: ReadonlyArray<readonly [CheckConclusion, CheckGroupKind]> = [
	['FAILURE', 'failed'],
	['TIMED_OUT', 'failed'],
	['CANCELLED', 'failed'],
	['STALE', 'failed'],
	['STARTUP_FAILURE', 'failed'],
	['ACTION_REQUIRED', 'failed'],
	['SUCCESS', 'passed'],
	['NEUTRAL', 'passed'],
	['SKIPPED', 'passed'],
]

describe('check groups', () => {
	it.each(CONCLUSION_EXPECTATIONS)('puts a %s check in the %s group', (conclusion, group) => {
		expect(checkGroupOf(check({ conclusion }))).toBe(group)
	})

	it('places every conclusion GitHub defines', () => {
		expect([...CONCLUSION_EXPECTATIONS].map(([conclusion]) => conclusion).sort()).toEqual(
			[...CHECK_CONCLUSIONS].sort(),
		)
	})

	it.each(['QUEUED', 'IN_PROGRESS', 'PENDING', 'REQUESTED', 'WAITING'] as const)(
		'reports a %s check with no conclusion as running',
		(status) => {
			expect(checkGroupOf(check({ status, conclusion: null }))).toBe('running')
		},
	)

	it('reports a completed check carrying no conclusion as running rather than as passed', () => {
		expect(checkGroupOf(check({ status: 'COMPLETED', conclusion: null }))).toBe('running')
	})

	it('splits the checks three ways and keeps GitHub ordering inside each group', () => {
		const groups = groupChecks([
			check({ id: 'a', name: 'lint' }),
			check({ id: 'b', name: 'typecheck', conclusion: 'FAILURE' }),
			check({ id: 'c', name: 'build', status: 'IN_PROGRESS', conclusion: null }),
			check({ id: 'd', name: 'test', conclusion: 'FAILURE' }),
			check({ id: 'e', name: 'e2e', conclusion: 'SKIPPED' }),
		])

		expect(groups.failed.map((row) => row.name)).toEqual(['typecheck', 'test'])
		expect(groups.running.map((row) => row.name)).toEqual(['build'])
		expect(groups.passed.map((row) => row.name)).toEqual(['lint', 'e2e'])
		expect(groups.total).toBe(5)
	})

	it('counts an empty rollup as no groups and no badge', () => {
		expect(groupChecks([])).toEqual({ failed: [], running: [], passed: [], total: 0 })
		expect(countFailingChecks([])).toBe(0)
	})

	it('counts only failing checks for the badge', () => {
		expect(
			countFailingChecks([
				check({ id: 'a', conclusion: 'FAILURE' }),
				check({ id: 'b', conclusion: 'TIMED_OUT' }),
				check({ id: 'c', conclusion: 'SKIPPED' }),
				check({ id: 'd', conclusion: null, status: 'IN_PROGRESS' }),
				check({ id: 'e', conclusion: 'SUCCESS' }),
			]),
		).toBe(2)
	})
})

describe('formatCheckDuration', () => {
	it('measures a finished check between its own two timestamps', () => {
		expect(formatCheckDuration(check())).toBe('1m 12s')
	})

	it('shows nothing for a running check, so the panel never needs a clock', () => {
		expect(formatCheckDuration(check({ completedAt: null }))).toBeNull()
	})

	it('drops sub-minute durations to seconds', () => {
		expect(formatCheckDuration(check({ completedAt: '2026-08-30T09:00:04Z' }))).toBe('4s')
	})

	// A GitHub Actions job runs for up to six hours, so this is reachable with real data rather
	// than a theoretical edge. Without an hour unit it reads `360m 00s`.
	it('promotes durations of an hour or more to hours and minutes', () => {
		expect(formatCheckDuration(check({ completedAt: '2026-08-30T10:31:46Z' }))).toBe('1h 31m')
		expect(formatCheckDuration(check({ completedAt: '2026-08-30T15:00:00Z' }))).toBe('6h 00m')
	})

	it('reports nothing rather than a wrong number when a timestamp is missing or unusable', () => {
		expect(formatCheckDuration(check({ startedAt: null }))).toBeNull()
		expect(formatCheckDuration(check({ startedAt: 'not a date' }))).toBeNull()
	})
})
