import type { KanbanColumnModel } from '@humanlayer/ui/components/kanban'
import { create } from 'zustand'

export type KanbanFocusSource = 'keyboard' | 'mouse'

export interface KanbanFocusState {
	/** Currently focused card (task) id, or null when nothing is focused. */
	focusedTaskId: string | null
	/** What caused the current focus, so cards can ignore stale mouse-enter events. */
	focusSource: KanbanFocusSource | null

	setFocusedTaskId: (taskId: string | null, source: KanbanFocusSource) => void
	/** Flip the focus source to mouse without moving focus (call on mouse move). */
	enableMouseFocus: () => void
	clearFocus: () => void
	focusAfterTaskRemoved: (columns: KanbanColumnModel[], taskId: string) => void

	/** Keyboard movement over the current columns array. */
	focusDown: (columns: KanbanColumnModel[]) => void
	focusUp: (columns: KanbanColumnModel[]) => void
	focusLeft: (columns: KanbanColumnModel[]) => void
	focusRight: (columns: KanbanColumnModel[]) => void
}

interface CardLocation {
	columnIndex: number
	rowIndex: number
}

/** Locate the focused card within the columns array. Returns null when not found. */
function locate(columns: KanbanColumnModel[], taskId: string | null): CardLocation | null {
	if (!taskId) return null
	for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
		const column = columns[columnIndex]
		if (column === undefined) continue
		const rowIndex = column.cards.findIndex((card) => card.id === taskId)
		if (rowIndex !== -1) return { columnIndex, rowIndex }
	}
	return null
}

/** First card in the leftmost non-empty column, or null when the board is empty. */
function firstCardId(columns: KanbanColumnModel[]): string | null {
	for (const column of columns) {
		const first = column.cards[0]
		if (first !== undefined) return first.id
	}
	return null
}

/**
 * Move horizontally to the nearest non-empty column in `direction` (-1 left,
 * +1 right), preserving the row index where possible and otherwise landing on
 * that column's last card. Empty columns are skipped.
 */
function horizontalTarget(columns: KanbanColumnModel[], from: CardLocation, direction: -1 | 1): string | null {
	for (
		let columnIndex = from.columnIndex + direction;
		columnIndex >= 0 && columnIndex < columns.length;
		columnIndex += direction
	) {
		const column = columns[columnIndex]
		if (column === undefined) continue
		const cards = column.cards
		if (cards.length === 0) continue
		const targetRow = Math.min(from.rowIndex, cards.length - 1)
		const card = cards[targetRow]
		if (card === undefined) continue
		return card.id
	}
	return null
}

export const useKanbanFocusStore = create<KanbanFocusState>((set, get) => ({
	focusedTaskId: null,
	focusSource: null,

	setFocusedTaskId: (taskId, source) => set({ focusedTaskId: taskId, focusSource: source }),
	enableMouseFocus: () => set({ focusSource: 'mouse' }),
	clearFocus: () => set({ focusedTaskId: null, focusSource: null }),
	focusAfterTaskRemoved: (columns, taskId) => {
		if (get().focusedTaskId !== taskId) return

		const current = locate(columns, taskId)
		if (!current) {
			set({ focusedTaskId: null, focusSource: null })
			return
		}

		const column = columns[current.columnIndex]
		if (column === undefined) return
		const cards = column.cards
		const target = cards[current.rowIndex + 1]?.id ?? cards[current.rowIndex - 1]?.id ?? null
		set({ focusedTaskId: target, focusSource: target ? 'keyboard' : null })
	},

	focusDown: (columns) => {
		const current = locate(columns, get().focusedTaskId)
		if (!current) {
			const first = firstCardId(columns)
			if (first) set({ focusedTaskId: first, focusSource: 'keyboard' })
			return
		}
		const column = columns[current.columnIndex]
		if (column === undefined) return
		const cards = column.cards
		const nextRow = Math.min(current.rowIndex + 1, cards.length - 1)
		const card = cards[nextRow]
		if (card === undefined) return
		set({ focusedTaskId: card.id, focusSource: 'keyboard' })
	},

	focusUp: (columns) => {
		const current = locate(columns, get().focusedTaskId)
		if (!current) {
			const first = firstCardId(columns)
			if (first) set({ focusedTaskId: first, focusSource: 'keyboard' })
			return
		}
		const column = columns[current.columnIndex]
		if (column === undefined) return
		const cards = column.cards
		const prevRow = Math.max(current.rowIndex - 1, 0)
		const card = cards[prevRow]
		if (card === undefined) return
		set({ focusedTaskId: card.id, focusSource: 'keyboard' })
	},

	focusLeft: (columns) => {
		const current = locate(columns, get().focusedTaskId)
		if (!current) {
			const first = firstCardId(columns)
			if (first) set({ focusedTaskId: first, focusSource: 'keyboard' })
			return
		}
		const target = horizontalTarget(columns, current, -1)
		if (target) set({ focusedTaskId: target, focusSource: 'keyboard' })
	},

	focusRight: (columns) => {
		const current = locate(columns, get().focusedTaskId)
		if (!current) {
			const first = firstCardId(columns)
			if (first) set({ focusedTaskId: first, focusSource: 'keyboard' })
			return
		}
		const target = horizontalTarget(columns, current, 1)
		if (target) set({ focusedTaskId: target, focusSource: 'keyboard' })
	},
}))
