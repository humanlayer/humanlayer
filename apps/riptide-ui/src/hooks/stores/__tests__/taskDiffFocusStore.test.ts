import { beforeEach, describe, expect, test } from 'vitest'

import { useTaskDiffFocusStore } from '../taskDiffFocusStore'

const firstLine = {
	id: 'line:file-1:additions:1',
	kind: 'line' as const,
	fileId: 'file-1',
	lineNumber: 1,
	side: 'additions' as const,
}
const secondLine = { ...firstLine, id: 'line:file-1:additions:2', lineNumber: 2 }

describe('taskDiffFocusStore', () => {
	beforeEach(() => useTaskDiffFocusStore.setState({ byTask: {} }))

	test('keeps keyboard focus and ranges task keyed without persistence', () => {
		const store = useTaskDiffFocusStore.getState()
		store.setKeyboardFocus('task-1', firstLine, { x: 10, y: 20 })
		store.setKeyboardRange('task-1', { anchor: firstLine, head: secondLine })
		store.setKeyboardFocus('task-2', { id: 'header:file-2', kind: 'header', fileId: 'file-2' })

		expect(useTaskDiffFocusStore.getState().byTask['task-1']).toMatchObject({
			target: secondLine,
			range: { anchor: firstLine, head: secondLine },
			source: 'keyboard',
			pointerSnapshot: { x: 10, y: 20 },
			showHints: true,
		})
		expect(useTaskDiffFocusStore.getState().byTask['task-2']?.target?.fileId).toBe('file-2')
	})

	test('clears a range before focus and restores its head', () => {
		const store = useTaskDiffFocusStore.getState()
		store.setKeyboardRange('task-1', { anchor: firstLine, head: secondLine })
		store.clearRange('task-1')

		expect(useTaskDiffFocusStore.getState().byTask['task-1']).toMatchObject({
			target: secondLine,
			range: null,
			source: 'keyboard',
		})

		store.clearFocus('task-1')
		expect(useTaskDiffFocusStore.getState().byTask['task-1']).toMatchObject({
			target: null,
			range: null,
			source: null,
			showHints: false,
		})
	})
})
