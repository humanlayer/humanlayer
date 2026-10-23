import { beforeEach, describe, expect, test, vi } from 'vitest'

import { archiveTaskWithCleanup } from '@/actions/archiveTaskWithCleanup'
import { DEFAULT_DIFF_COMPARISON, useTaskDiffReviewMarksStore } from '@/hooks/stores/taskDiffReviewMarksStore'

vi.mock('@/integrations/desktop/pty', () => ({ cleanupPtyForSession: vi.fn() }))
vi.mock('@/utils/undoToast', () => ({ showUndoToast: vi.fn() }))

const file = { fileKey: 'repo-1:a.ts', versionId: 'repo-1:a.ts:blob-a' }

function archive(taskId: string, archived: boolean) {
	archiveTaskWithCleanup({
		taskActions: { archiveTask: vi.fn() } as unknown as Parameters<typeof archiveTaskWithCleanup>[0]['taskActions'],
		taskId,
		taskName: 'Task',
		archived,
		sessionIds: [],
	})
}

describe('archiveTaskWithCleanup', () => {
	beforeEach(() => {
		useTaskDiffReviewMarksStore.setState({
			reviewedByTask: {},
			unmarkedByTask: {},
			collapsedByTask: {},
			comparisonByTask: {},
			defaultComparison: DEFAULT_DIFF_COMPARISON,
		})
		for (const taskId of ['task-1', 'task-2']) {
			useTaskDiffReviewMarksStore.getState().markReviewed(taskId, [file])
			useTaskDiffReviewMarksStore.getState().setComparison(taskId, 'since-task-start')
		}
	})

	test("archiving a task clears the task's saved diff review marks", () => {
		archive('task-1', true)

		const state = useTaskDiffReviewMarksStore.getState()
		expect(state.reviewedByTask).not.toHaveProperty('task-1')
		expect(state.collapsedByTask).not.toHaveProperty('task-1')
		expect(state.comparisonByTask).not.toHaveProperty('task-1')
		expect(state.reviewedByTask).toHaveProperty('task-2')
	})

	test('unarchiving a task leaves its marks alone', () => {
		archive('task-1', false)

		expect(useTaskDiffReviewMarksStore.getState().reviewedByTask).toHaveProperty('task-1')
	})
})
