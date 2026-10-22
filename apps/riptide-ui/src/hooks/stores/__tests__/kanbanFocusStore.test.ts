import type { KanbanColumnModel } from '@humanlayer/ui/components/kanban'
import { beforeEach, describe, expect, test } from 'vitest'

import { useKanbanFocusStore } from '../kanbanFocusStore'

const label = { name: 'rpi:todo', color: 'gray' } as unknown as KanbanColumnModel['cards'][number]['workflowLabel']

function card(id: string): KanbanColumnModel['cards'][number] {
	return { id, title: id, ownerInitials: 'XX', workflowLabel: label }
}

function column(id: string, cardIds: string[]): KanbanColumnModel {
	return { id, title: id, cards: cardIds.map(card) }
}

/**
 * Fixture board:
 *   todo:        a1, a2, a3
 *   research:    (empty)
 *   planning:    c1, c2
 *   impl:        d1
 *   in-review:   (empty)
 */
const columns: KanbanColumnModel[] = [
	column('todo', ['a1', 'a2', 'a3']),
	column('research', []),
	column('planning', ['c1', 'c2']),
	column('impl', ['d1']),
	column('in-review', []),
]

describe('kanbanFocusStore', () => {
	beforeEach(() => {
		useKanbanFocusStore.setState({ focusedTaskId: null, focusSource: null })
	})

	test('starts unfocused', () => {
		expect(useKanbanFocusStore.getState().focusedTaskId).toBeNull()
		expect(useKanbanFocusStore.getState().focusSource).toBeNull()
	})

	test('setFocusedTaskId / clearFocus track source', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('a2', 'mouse')
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a2')
		expect(useKanbanFocusStore.getState().focusSource).toBe('mouse')

		useKanbanFocusStore.getState().clearFocus()
		expect(useKanbanFocusStore.getState().focusedTaskId).toBeNull()
		expect(useKanbanFocusStore.getState().focusSource).toBeNull()
	})

	test('first movement when unfocused lands on first card of leftmost non-empty column', () => {
		useKanbanFocusStore.getState().focusDown(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a1')
		expect(useKanbanFocusStore.getState().focusSource).toBe('keyboard')

		useKanbanFocusStore.setState({ focusedTaskId: null, focusSource: null })
		useKanbanFocusStore.getState().focusRight(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a1')
	})

	test('focusDown advances within a column and clamps at the bottom', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('a1', 'keyboard')
		useKanbanFocusStore.getState().focusDown(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a2')

		useKanbanFocusStore.getState().focusDown(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a3')

		// Clamp at the bottom.
		useKanbanFocusStore.getState().focusDown(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a3')
	})

	test('focusUp retreats within a column and clamps at the top', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('a3', 'keyboard')
		useKanbanFocusStore.getState().focusUp(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a2')

		useKanbanFocusStore.getState().focusUp(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a1')

		// Clamp at the top.
		useKanbanFocusStore.getState().focusUp(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a1')
	})

	test('focusRight skips empty columns and preserves row when possible', () => {
		// a1 (row 0) -> skip empty research -> planning row 0 = c1
		useKanbanFocusStore.getState().setFocusedTaskId('a1', 'keyboard')
		useKanbanFocusStore.getState().focusRight(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('c1')
	})

	test('focusRight falls back to last card when the row is out of range', () => {
		// a3 (row 2) -> planning has only rows 0,1 -> clamp to last card c2
		useKanbanFocusStore.getState().setFocusedTaskId('a3', 'keyboard')
		useKanbanFocusStore.getState().focusRight(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('c2')
	})

	test('focusRight clamps to last card across multiple non-empty columns', () => {
		// c2 (row 1) -> impl has only row 0 -> d1
		useKanbanFocusStore.getState().setFocusedTaskId('c2', 'keyboard')
		useKanbanFocusStore.getState().focusRight(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('d1')
	})

	test('focusRight at the rightmost non-empty column is a no-op', () => {
		// d1 is in the last non-empty column; in-review is empty.
		useKanbanFocusStore.getState().setFocusedTaskId('d1', 'keyboard')
		useKanbanFocusStore.getState().focusRight(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('d1')
	})

	test('focusLeft skips empty columns and preserves row when possible', () => {
		// c1 (row 0) -> skip empty research -> todo row 0 = a1
		useKanbanFocusStore.getState().setFocusedTaskId('c1', 'keyboard')
		useKanbanFocusStore.getState().focusLeft(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a1')
	})

	test('focusLeft preserves row index across columns', () => {
		// c2 (row 1) -> skip empty research -> todo row 1 = a2
		useKanbanFocusStore.getState().setFocusedTaskId('c2', 'keyboard')
		useKanbanFocusStore.getState().focusLeft(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a2')
	})

	test('focusLeft at the leftmost non-empty column is a no-op', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('a1', 'keyboard')
		useKanbanFocusStore.getState().focusLeft(columns)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a1')
	})

	test('movement is a no-op on an empty board', () => {
		const empty: KanbanColumnModel[] = [column('todo', []), column('research', [])]
		useKanbanFocusStore.getState().focusDown(empty)
		expect(useKanbanFocusStore.getState().focusedTaskId).toBeNull()
	})

	test('focusAfterTaskRemoved moves to the next card in the same column', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('a2', 'keyboard')
		useKanbanFocusStore.getState().focusAfterTaskRemoved(columns, 'a2')
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a3')
		expect(useKanbanFocusStore.getState().focusSource).toBe('keyboard')
	})

	test('focusAfterTaskRemoved falls back to the previous card at the bottom', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('a3', 'keyboard')
		useKanbanFocusStore.getState().focusAfterTaskRemoved(columns, 'a3')
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a2')
	})

	test('focusAfterTaskRemoved clears focus when the column has no replacement', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('d1', 'keyboard')
		useKanbanFocusStore.getState().focusAfterTaskRemoved(columns, 'd1')
		expect(useKanbanFocusStore.getState().focusedTaskId).toBeNull()
		expect(useKanbanFocusStore.getState().focusSource).toBeNull()
	})

	test('focusAfterTaskRemoved is a no-op for non-focused tasks', () => {
		useKanbanFocusStore.getState().setFocusedTaskId('a1', 'keyboard')
		useKanbanFocusStore.getState().focusAfterTaskRemoved(columns, 'a2')
		expect(useKanbanFocusStore.getState().focusedTaskId).toBe('a1')
	})
})
