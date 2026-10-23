import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { isLocalDaemonStarting, useLocalDaemonLaunchStore } from './localDaemonLaunchStore'

describe('localDaemonLaunchStore', () => {
	const store = useLocalDaemonLaunchStore

	beforeEach(() => {
		vi.useFakeTimers()
		store.setState({ phase: 'idle', launchAttempt: 0 })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test('holds syncing-host for the grace period after a successful launch, then reports ready', () => {
		store.getState().launchStarted()
		expect(store.getState().phase).toBe('starting')

		store.getState().launchSucceeded()
		expect(store.getState().phase).toBe('syncing-host')

		vi.advanceTimersByTime(9_999)
		expect(store.getState().phase).toBe('syncing-host')
		vi.advanceTimersByTime(1)
		expect(store.getState().phase).toBe('ready')
	})

	test('a new launch cancels the pending grace timer', () => {
		store.getState().launchSucceeded()
		store.getState().launchStarted()
		vi.advanceTimersByTime(20_000)
		expect(store.getState().phase).toBe('starting')
	})

	test('a failed launch ends the starting phase', () => {
		store.getState().launchStarted()
		store.getState().launchFailed()
		expect(store.getState().phase).toBe('failed')
	})

	test('a retry after a failure starts a new launch attempt', () => {
		store.getState().launchStarted()
		store.getState().launchFailed()
		store.getState().retryLaunch()
		expect(store.getState()).toMatchObject({ phase: 'starting', launchAttempt: 1 })
	})

	test('a retry while a launch is in flight changes nothing', () => {
		store.getState().launchStarted()
		store.getState().retryLaunch()
		expect(store.getState()).toMatchObject({ phase: 'starting', launchAttempt: 0 })
	})
})

test.each([
	['idle', false],
	['starting', true],
	['syncing-host', true],
	['ready', false],
	['failed', false],
] as const)('isLocalDaemonStarting(%s) is %s', (phase, starting) => {
	expect(isLocalDaemonStarting(phase)).toBe(starting)
})
