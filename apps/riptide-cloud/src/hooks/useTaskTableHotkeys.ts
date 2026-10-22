import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

import type { TableTask } from '@/components/task-table/TaskTable'

import type { HotkeyScope } from './hotkeys/scopes'

export interface UseTaskTableHotkeysOptions {
	tasks: TableTask[]
	focusedTaskId: string | null
	scope: HotkeyScope
	enabled?: boolean

	// Navigation
	onFocusNext: () => void
	onFocusPrevious: () => void

	// Actions
	onActivateTask: (task: TableTask) => void
}

export function useTaskTableHotkeys({
	tasks,
	focusedTaskId,
	scope,
	enabled = true,
	onFocusNext,
	onFocusPrevious,
	onActivateTask,
}: UseTaskTableHotkeysOptions) {
	const focusedTask = tasks.find((t) => t.id === focusedTaskId) ?? null
	const hasFocus = focusedTaskId !== null

	// j - Navigate down
	useHotkeys(
		'j',
		() => onFocusNext(),
		{
			scopes: [scope],
			enabled,
		},
		[onFocusNext],
	)

	// k - Navigate up
	useHotkeys(
		'k',
		() => onFocusPrevious(),
		{
			scopes: [scope],
			enabled,
		},
		[onFocusPrevious],
	)

	// enter - Activate focused task
	useHotkeys(
		'enter',
		() => {
			if (focusedTask) {
				onActivateTask(focusedTask)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && hasFocus,
		},
		[focusedTask, onActivateTask],
	)

	return {
		focusedTask,
		hasFocus,
	}
}
