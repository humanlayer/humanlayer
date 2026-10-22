import { beforeEach, describe, expect, test } from 'vitest'

import { createTaskDiffVisibilityStore } from '@/hooks/stores/taskDiffVisibilityStore'

beforeEach(() => sessionStorage.clear())

describe('task diff visibility store', () => {
	test('persists review scope separately for each task', async () => {
		const first = createTaskDiffVisibilityStore('task-1')
		const second = createTaskDiffVisibilityStore('task-2')
		first.getState().setHideReviewed(true)

		expect(first.getState().hideReviewed).toBe(true)
		expect(second.getState().hideReviewed).toBe(false)
		expect(JSON.parse(sessionStorage.getItem('riptide-task-diff-visibility:task-1') ?? '{}')).toMatchObject({
			state: { hideReviewed: true },
		})
	})

	test('keeps temporary reveals and dismissed deep links out of persisted state', () => {
		const store = createTaskDiffVisibilityStore('task-1')
		store.getState().revealFile('file-1')
		store.getState().dismissDeepLink('file-2')

		expect(store.getState()).toMatchObject({
			revealedFileId: 'file-1',
			dismissedDeepLinkFileId: 'file-2',
		})
		expect(JSON.parse(sessionStorage.getItem('riptide-task-diff-visibility:task-1') ?? '{}')).toMatchObject({
			state: { hideReviewed: false },
		})
	})

	test('clears a temporary reveal when the scope changes', () => {
		const store = createTaskDiffVisibilityStore('task-1')
		store.getState().revealFile('file-1')
		store.getState().setHideReviewed(false)
		expect(store.getState().revealedFileId).toBeNull()
	})
})
