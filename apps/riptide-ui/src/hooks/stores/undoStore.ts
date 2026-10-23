import { create } from 'zustand'

export type UndoActionType = 'archive_session' | 'unarchive_session' | 'archive_task' | 'unarchive_task'

export interface UndoEntry {
	type: UndoActionType
	undoId: string
	entityId: string
	toastId: string
	title: string
	description: string
	onUndo: () => void | Promise<void>
	timeoutId: ReturnType<typeof setTimeout>
}

interface UndoState {
	undoStack: UndoEntry[]

	pushUndo: (entry: Omit<UndoEntry, 'timeoutId'>, timeoutMs?: number) => void
	popUndo: () => UndoEntry | null
	removeUndo: (undoId: string) => void
	clearAll: () => void
}

export const useUndoStore = create<UndoState>((set, get) => ({
	undoStack: [],

	pushUndo: (entry, timeoutMs = 5000) => {
		const timeoutId = setTimeout(() => {
			get().removeUndo(entry.undoId)
		}, timeoutMs)

		set((state) => ({
			undoStack: [...state.undoStack, { ...entry, timeoutId }],
		}))
	},

	popUndo: () => {
		const state = get()
		if (state.undoStack.length === 0) return null

		const entry = state.undoStack.at(-1)
		if (entry === undefined) return null
		clearTimeout(entry.timeoutId)

		set((s) => ({
			undoStack: s.undoStack.slice(0, -1),
		}))

		return entry
	},

	removeUndo: (undoId) =>
		set((state) => {
			const entry = state.undoStack.find((e) => e.undoId === undoId)
			if (entry) {
				clearTimeout(entry.timeoutId)
			}
			return {
				undoStack: state.undoStack.filter((e) => e.undoId !== undoId),
			}
		}),

	clearAll: () => {
		const state = get()
		for (const entry of state.undoStack) {
			clearTimeout(entry.timeoutId)
		}
		set({ undoStack: [] })
	},
}))
