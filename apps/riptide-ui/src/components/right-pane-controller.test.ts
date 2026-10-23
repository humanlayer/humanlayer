import { afterEach, describe, expect, test, vi } from 'vitest'

import { getRightPaneController, registerRightPaneController } from './right-pane-controller'

const cleanups: Array<() => void> = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('right pane controller registration', () => {
	test('exposes the active pane expansion command', () => {
		const expand = vi.fn()
		cleanups.push(registerRightPaneController({ expand }))

		getRightPaneController()?.expand()

		expect(expand).toHaveBeenCalledOnce()
	})

	test('does not let stale cleanup unregister a replacement pane', () => {
		const firstCleanup = registerRightPaneController({ expand: vi.fn() })
		const replacement = { expand: vi.fn() }
		cleanups.push(registerRightPaneController(replacement))

		firstCleanup()

		expect(getRightPaneController()).toBe(replacement)
	})
})
