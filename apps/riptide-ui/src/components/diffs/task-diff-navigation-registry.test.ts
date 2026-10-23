import { afterEach, describe, expect, test, vi } from 'vitest'

import { navigateMountedTaskDiffFile, registerTaskDiffFileNavigator } from './task-diff-navigation-registry'

const cleanups: Array<() => void> = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('task diff navigation registry', () => {
	test('navigates a mounted placement to the requested file', () => {
		const navigateToFile = vi.fn()
		cleanups.push(registerTaskDiffFileNavigator('task-1', 'primary', { navigateToFile }))

		expect(navigateMountedTaskDiffFile('task-1', 'primary', 'file-2')).toBe(true)
		expect(navigateToFile).toHaveBeenCalledWith('file-2')
	})

	test('does not route a request to another task or placement', () => {
		const navigateToFile = vi.fn()
		cleanups.push(registerTaskDiffFileNavigator('task-1', 'primary', { navigateToFile }))

		expect(navigateMountedTaskDiffFile('task-2', 'primary', 'file-2')).toBe(false)
		expect(navigateMountedTaskDiffFile('task-1', 'sidebar', 'file-2')).toBe(false)
		expect(navigateToFile).not.toHaveBeenCalled()
	})
})
