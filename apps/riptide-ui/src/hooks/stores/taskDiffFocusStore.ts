import type { DiffNavigationTarget } from '@humanlayer/ui/lib/diff-review/build-diff-navigation-index'
import type { DiffKeyboardRange } from '@humanlayer/ui/lib/diff-review/diff-keyboard-range'
import { create } from 'zustand'

export type TaskDiffFocusSource = 'keyboard' | 'pointer'

export interface TaskDiffPointerSnapshot {
	x: number
	y: number
}

export interface TaskDiffFocusEntry {
	target: DiffNavigationTarget | null
	range: DiffKeyboardRange | null
	source: TaskDiffFocusSource | null
	pointerSnapshot: TaskDiffPointerSnapshot | null
	showHints: boolean
}

const EMPTY_FOCUS_ENTRY: TaskDiffFocusEntry = {
	target: null,
	range: null,
	source: null,
	pointerSnapshot: null,
	showHints: false,
}

interface TaskDiffFocusStoreState {
	byTask: Record<string, TaskDiffFocusEntry>
	setKeyboardFocus: (taskId: string, target: DiffNavigationTarget, pointerSnapshot?: TaskDiffPointerSnapshot) => void
	setKeyboardRange: (taskId: string, range: DiffKeyboardRange) => void
	clearRange: (taskId: string) => void
	clearFocus: (taskId: string) => void
	setPointerFocus: (taskId: string, target: DiffNavigationTarget | null) => void
	setPointerRange: (taskId: string, range: DiffKeyboardRange) => void
	establishKeyboardPointerBaseline: (taskId: string, pointerSnapshot: TaskDiffPointerSnapshot) => void
	setPointerOwnership: (taskId: string) => void
}

function updateTaskEntry(
	state: TaskDiffFocusStoreState,
	taskId: string,
	update: (entry: TaskDiffFocusEntry) => TaskDiffFocusEntry,
): Pick<TaskDiffFocusStoreState, 'byTask'> {
	return { byTask: { ...state.byTask, [taskId]: update(state.byTask[taskId] ?? EMPTY_FOCUS_ENTRY) } }
}

export const useTaskDiffFocusStore = create<TaskDiffFocusStoreState>((set) => ({
	byTask: {},
	setKeyboardFocus: (taskId, target, pointerSnapshot) =>
		set((state) =>
			updateTaskEntry(state, taskId, (entry) => ({
				...entry,
				target,
				range: null,
				source: 'keyboard',
				pointerSnapshot: pointerSnapshot ?? entry.pointerSnapshot,
				showHints: true,
			})),
		),
	setKeyboardRange: (taskId, range) =>
		set((state) =>
			updateTaskEntry(state, taskId, (entry) => ({
				...entry,
				target: range.head,
				range,
				source: 'keyboard',
				showHints: true,
			})),
		),
	clearRange: (taskId) =>
		set((state) =>
			updateTaskEntry(state, taskId, (entry) => ({
				...entry,
				target: entry.range?.head ?? entry.target,
				range: null,
			})),
		),
	clearFocus: (taskId) => set((state) => updateTaskEntry(state, taskId, () => EMPTY_FOCUS_ENTRY)),
	setPointerFocus: (taskId, target) =>
		set((state) => {
			const entry = state.byTask[taskId] ?? EMPTY_FOCUS_ENTRY
			// Hover re-enters the same line constantly; identical targets must not
			// produce a new entry object or every crossing re-renders the workspace.
			if (target && entry.source === 'pointer' && entry.range === null && entry.target?.id === target.id) {
				return state
			}
			if (!target && entry === EMPTY_FOCUS_ENTRY) return state
			return updateTaskEntry(state, taskId, () =>
				target
					? { target, range: null, source: 'pointer', pointerSnapshot: null, showHints: false }
					: EMPTY_FOCUS_ENTRY,
			)
		}),
	setPointerRange: (taskId, range) =>
		set((state) =>
			updateTaskEntry(state, taskId, (entry) => ({
				...entry,
				target: range.head,
				range,
				source: 'pointer',
				pointerSnapshot: null,
				showHints: false,
			})),
		),
	establishKeyboardPointerBaseline: (taskId, pointerSnapshot) =>
		set((state) =>
			updateTaskEntry(state, taskId, (entry) =>
				entry.source === 'keyboard' && entry.pointerSnapshot === null ? { ...entry, pointerSnapshot } : entry,
			),
		),
	setPointerOwnership: (taskId) =>
		set((state) =>
			updateTaskEntry(state, taskId, (entry) => ({
				...entry,
				range: null,
				source: entry.target ? 'pointer' : null,
				pointerSnapshot: null,
				showHints: false,
			})),
		),
}))
