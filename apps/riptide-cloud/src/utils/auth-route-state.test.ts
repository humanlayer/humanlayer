import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
	captureAuthReturnToHref,
	captureAuthReturnToState,
	consumeAuthReturnTo,
	storeAuthReturnTo,
} from './auth-route-state'

describe('auth return route state', () => {
	beforeEach(() => {
		sessionStorage.clear()
		vi.useRealTimers()
	})

	test('preserves the route path, search state, and fragment', () => {
		const state = captureAuthReturnToState(
			'/artifacts/artifact-123',
			{ comment: 'comment-456', fullscreen: true },
			'#discussion',
		)
		storeAuthReturnTo(state)

		expect(consumeAuthReturnTo()).toEqual(state)
		expect(consumeAuthReturnTo()).toBeNull()
	})

	test('does not capture authentication routes', () => {
		expect(captureAuthReturnToState('/auth/signin', {}, '')).toBeNull()
		expect(captureAuthReturnToState('/auth/callback', {}, '')).toBeNull()
	})

	test('captures a same-origin returnTo href from an explicit sign-in link', () => {
		expect(
			captureAuthReturnToHref(
				'/artifacts/artifact-123?comment=comment-456&fullscreen=true&tag=one&tag=two#discussion',
			),
		).toMatchObject({
			pathname: '/artifacts/artifact-123',
			search: { comment: 'comment-456', fullscreen: true, tag: ['one', 'two'] },
			hash: 'discussion',
		})
	})

	test('rejects an off-origin returnTo href', () => {
		expect(captureAuthReturnToHref('https://example.com/artifacts/artifact-123')).toBeNull()
	})

	test('ignores an expired route', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		storeAuthReturnTo(captureAuthReturnToState('/artifacts/artifact-123', {}, ''))

		vi.advanceTimersByTime(10 * 60 * 1000 + 1)

		expect(consumeAuthReturnTo()).toBeNull()
	})
})
