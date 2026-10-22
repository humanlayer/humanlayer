import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

import { createHorizontalTabHistory } from './horizontal-tab-history'

describe('createHorizontalTabHistory', () => {
	test('preserves application state and attaches the selected tab to pushes and replacements', () => {
		const baseHistory = createMemoryHistory({ initialEntries: ['/'] })
		let selectedTabId: string | null = 'tab-1'
		const history = createHorizontalTabHistory(baseHistory, () => selectedTabId)

		history.push('/tasks/task-a', { applicationState: 'push-state' })

		expect(history.location.state).toMatchObject({
			applicationState: 'push-state',
			nativeTabId: 'tab-1',
		})
		expect(history.location.state.__TSR_index).toBe(1)

		selectedTabId = 'tab-2'
		history.replace('/sessions?tab=drafts', { applicationState: 'replace-state' })

		expect(history.location.state).toMatchObject({
			applicationState: 'replace-state',
			nativeTabId: 'tab-2',
		})
		expect(history.location.state.__TSR_index).toBe(1)
	})

	test('is a pass-through when horizontal tabs are ineligible', () => {
		const baseHistory = createMemoryHistory({ initialEntries: ['/'] })
		const history = createHorizontalTabHistory(baseHistory, () => null)
		const state = { applicationState: 'unchanged' }

		history.push('/sessions', state)

		expect(history.location.state).toMatchObject(state)
		expect(history.location.state).not.toHaveProperty('nativeTabId')
	})

	test('keeps live properties and delegates non-writing history behavior', () => {
		const baseHistory = createMemoryHistory({ initialEntries: ['/'] })
		const history = createHorizontalTabHistory(baseHistory, () => 'tab-1')
		const subscriber = vi.fn()
		const unsubscribe = history.subscribe(subscriber)

		history.push('/tasks/task-a')
		expect(history.location).toBe(baseHistory.location)
		expect(history.length).toBe(2)
		expect(history.canGoBack()).toBe(true)
		expect(history.createHref('/sessions')).toBe('/sessions')

		history.back()
		expect(history.location.href).toBe('/')
		history.forward()
		expect(history.location.href).toBe('/tasks/task-a')
		history.go(-1)
		expect(history.location.href).toBe('/')
		expect(subscriber).toHaveBeenCalled()

		unsubscribe()
		history.flush()
		history.destroy()
	})
})
