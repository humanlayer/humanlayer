import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TaskViewMode } from '@/lib/tasks/taskScope'

export type TaskViewLayout = 'list' | 'board'

interface TaskViewPreferencesState {
	/** Which layout the Tasks tab renders. Board is the first-run default. */
	layout: TaskViewLayout
	/** Mine = only the current user's tasks; Everything = all tasks (optionally narrowed by selectedUserIds). */
	mode: TaskViewMode
	/** User ids selected in the Everything multi-select. Ignored when mode is 'mine'. */
	selectedUserIds: string[]
	/** Whether List groups rows by workflow phase. Written by the Grouped toggle. */
	grouped: boolean

	setLayout: (layout: TaskViewLayout) => void
	setMode: (mode: TaskViewMode) => void
	setSelectedUserIds: (userIds: string[]) => void
	setGrouped: (grouped: boolean) => void
}

/**
 * Persisted user choices for the whole Tasks surface: layout, scope, owners, and
 * grouping. The storage key is deliberately unchanged from the Kanban-only store
 * it replaces, so existing filter values rehydrate and the new fields fall back
 * to the store defaults.
 */
export const useTaskViewPreferencesStore = create<TaskViewPreferencesState>()(
	persist(
		(set) => ({
			layout: 'board',
			mode: 'everything',
			selectedUserIds: [],
			grouped: false,

			setLayout: (layout) => set({ layout }),
			setMode: (mode) => set({ mode }),
			setSelectedUserIds: (selectedUserIds) => set({ selectedUserIds }),
			setGrouped: (grouped) => set({ grouped }),
		}),
		{
			name: 'riptide-kanban-preferences',
			partialize: (state) => ({
				layout: state.layout,
				mode: state.mode,
				selectedUserIds: state.selectedUserIds,
				grouped: state.grouped,
			}),
		},
	),
)
