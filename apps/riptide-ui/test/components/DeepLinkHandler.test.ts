import { describe, expect, test, vi } from 'vitest'

vi.mock('../../src/integrations/sentry/sentry', () => ({
	captureException: vi.fn(),
}))

vi.mock('../../src/lib/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

import { handleDeepLinkUrl, parseNavigationDeepLink } from '../../src/domains/deep-links/handler'

describe('handleDeepLinkUrl', () => {
	test('forwards nav deep links without search params', () => {
		const navigate = vi.fn()

		handleDeepLinkUrl('riptide-local://nav/tasks/task-123', navigate as never)

		expect(navigate).toHaveBeenCalledWith({
			href: '/tasks/task-123',
		})
	})

	test('normalizes nav paths while retaining query values and hash state', () => {
		expect(
			parseNavigationDeepLink(
				'riptide-local://nav/tasks/task-123?artifactId=artifact-1&tag=one&tag=two#comment-1',
			),
		).toBe('/tasks/task-123?artifactId=artifact-1&tag=one&tag=two#comment-1')
	})

	test('forwards normalized nav hrefs to TanStack Router', () => {
		const navigate = vi.fn()

		handleDeepLinkUrl('riptide-local://nav/settings/billing?billing=starter_to_pro_finalized', navigate as never)

		expect(navigate).toHaveBeenCalledWith({
			href: '/settings/billing?billing=starter_to_pro_finalized',
		})
	})

	test('consumes the browser-only deep flag while preserving the native intent', () => {
		const navigate = vi.fn()

		handleDeepLinkUrl(
			'riptide-local://nav/tasks/task-123?deep=true&artifactId=artifact-1&fullscreen=true',
			navigate as never,
		)

		expect(navigate).toHaveBeenCalledWith({
			href: '/tasks/task-123?artifactId=artifact-1&fullscreen=true',
		})
	})

	test('delegates normalized nav hrefs when a native destination owner is available', () => {
		const navigate = vi.fn()
		const openNavigationDeepLink = vi.fn()

		handleDeepLinkUrl(
			'riptide-local://nav/sessions/session-123?deep=true#event-1',
			navigate as never,
			openNavigationDeepLink,
		)

		expect(openNavigationDeepLink).toHaveBeenCalledWith('/sessions/session-123#event-1')
		expect(navigate).not.toHaveBeenCalled()
	})

	test('accepts focus deep links without router navigation', () => {
		const navigate = vi.fn()

		handleDeepLinkUrl('riptide-beta://focus', navigate as never)

		expect(navigate).not.toHaveBeenCalled()
	})

	test('accepts OAuth callback links without router or tab navigation', () => {
		const navigate = vi.fn()
		const openNavigationDeepLink = vi.fn()

		handleDeepLinkUrl(
			'riptide-beta://oauth/callback?state=callback-state',
			navigate as never,
			openNavigationDeepLink,
		)

		expect(navigate).not.toHaveBeenCalled()
		expect(openNavigationDeepLink).not.toHaveBeenCalled()
	})
})
