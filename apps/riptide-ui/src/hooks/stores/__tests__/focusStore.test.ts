import type { SidebarItem } from '@humanlayer/ui/components/sidebar/types'
import { beforeEach, describe, expect, test } from 'vitest'

import { useFocusStore } from '../focusStore'

const items: SidebarItem[] = [
	{ type: 'task', id: 'task-a' },
	{ type: 'session', id: 'session-a1', taskId: 'task-a' },
	{ type: 'session', id: 'session-a2', taskId: 'task-a' },
	{ type: 'task', id: 'task-b' },
	{ type: 'session', id: 'session-b1', taskId: 'task-b' },
	{ type: 'standalone-session', id: 'standalone-c' },
]

describe('focusStore sidebar task removal', () => {
	beforeEach(() => {
		useFocusStore.setState({ focusedSidebarItem: null, focusedArea: 'MAIN' })
	})

	test('skips every descendant session and focuses the next surviving row', () => {
		useFocusStore.getState().setFocusedSidebarItem({ type: 'task', id: 'task-a' })

		useFocusStore.getState().focusAfterSidebarTaskRemoved(items, 'task-a')

		expect(useFocusStore.getState().focusedSidebarItem).toEqual({ type: 'task', id: 'task-b' })
	})

	test('skips descendants when the next surviving row is a standalone session', () => {
		useFocusStore.getState().setFocusedSidebarItem({ type: 'task', id: 'task-b' })

		useFocusStore.getState().focusAfterSidebarTaskRemoved(items, 'task-b')

		expect(useFocusStore.getState().focusedSidebarItem).toEqual({
			type: 'standalone-session',
			id: 'standalone-c',
		})
	})

	test('falls back to the previous surviving row when the removed subtree is last', () => {
		useFocusStore.getState().setFocusedSidebarItem({ type: 'task', id: 'task-b' })

		useFocusStore.getState().focusAfterSidebarTaskRemoved(items.slice(0, 5), 'task-b')

		expect(useFocusStore.getState().focusedSidebarItem).toEqual({
			type: 'session',
			id: 'session-a2',
			taskId: 'task-a',
		})
	})

	test('clears focus when the removed task subtree is the entire layout', () => {
		useFocusStore.getState().setFocusedSidebarItem({ type: 'task', id: 'task-a' })

		useFocusStore.getState().focusAfterSidebarTaskRemoved(items.slice(0, 3), 'task-a')

		expect(useFocusStore.getState().focusedSidebarItem).toBeNull()
	})

	test('does not move focus when a different item is focused', () => {
		useFocusStore.getState().setFocusedSidebarItem({ type: 'task', id: 'task-b' })

		useFocusStore.getState().focusAfterSidebarTaskRemoved(items, 'task-a')

		expect(useFocusStore.getState().focusedSidebarItem).toEqual({ type: 'task', id: 'task-b' })
	})
})

describe('focusStore spatial area transitions', () => {
	beforeEach(() => {
		useFocusStore.setState({ focusedSidebarItem: null, focusedArea: 'MAIN' })
	})

	test.each([
		['LEFT_NAV', true, 'LEFT_NAV'],
		['LEFT_NAV', false, 'LEFT_NAV'],
		['MAIN', true, 'LEFT_NAV'],
		['MAIN', false, 'LEFT_NAV'],
		['RIGHT_PANE', true, 'MAIN'],
		['RIGHT_PANE', false, 'MAIN'],
	] as const)('moveFocusLeft: %s with right-pane availability %s -> %s', (start, available, expected) => {
		useFocusStore.setState({ focusedArea: start })
		useFocusStore.getState().moveFocusLeft(available)
		expect(useFocusStore.getState().focusedArea).toBe(expected)
	})

	test.each([
		['LEFT_NAV', true, 'MAIN'],
		['LEFT_NAV', false, 'MAIN'],
		['MAIN', true, 'RIGHT_PANE'],
		['MAIN', false, 'MAIN'],
		['RIGHT_PANE', true, 'RIGHT_PANE'],
		['RIGHT_PANE', false, 'RIGHT_PANE'],
	] as const)('moveFocusRight: %s with right-pane availability %s -> %s', (start, available, expected) => {
		useFocusStore.setState({ focusedArea: start })
		useFocusStore.getState().moveFocusRight(available)
		expect(useFocusStore.getState().focusedArea).toBe(expected)
	})

	test('focusMain is the outward Escape step from RIGHT_PANE and clears sidebar entity focus', () => {
		useFocusStore.setState({ focusedArea: 'RIGHT_PANE', focusedSidebarItem: { type: 'task', id: 'task-a' } })
		useFocusStore.getState().focusMain()
		expect(useFocusStore.getState().focusedArea).toBe('MAIN')
		expect(useFocusStore.getState().focusedSidebarItem).toBeNull()
	})
})
