import { beforeEach, describe, expect, test } from 'vitest'

import {
	DEFAULT_DIFF_COMPARISON,
	getTaskDiffComparison,
	migrateTaskDiffReviewMarksState,
	TASK_DIFF_REVIEW_MARKS_STORAGE_KEY,
	taskDiffFileKey,
	useTaskDiffReviewMarksStore,
} from '@/hooks/stores/taskDiffReviewMarksStore'

const files = [
	{ fileKey: 'repo-1:a.ts', versionId: 'repo-1:a.ts:blob-a' },
	{ fileKey: 'repo-1:b.ts', versionId: 'repo-1:b.ts:blob-b' },
	{ fileKey: 'repo-1:image.png' },
]

const a = (blob: string) => ({ fileKey: 'repo-1:a.ts', versionId: `repo-1:a.ts:blob-${blob}` })

beforeEach(() => {
	localStorage.removeItem(TASK_DIFF_REVIEW_MARKS_STORAGE_KEY)
	useTaskDiffReviewMarksStore.setState({
		reviewedByTask: {},
		unmarkedByTask: {},
		collapsedByTask: {},
		comparisonByTask: {},
		defaultComparison: DEFAULT_DIFF_COMPARISON,
	})
})

function state() {
	return useTaskDiffReviewMarksStore.getState()
}

describe('taskDiffFileKey', () => {
	test('keys a detected rename by its task-start path, so review history follows it', () => {
		expect(taskDiffFileKey({ repoId: 'repo-1', path: 'new.ts', prevPath: 'old.ts' })).toBe('repo-1:old.ts')
		expect(taskDiffFileKey({ repoId: 'repo-1', path: 'old.ts' })).toBe('repo-1:old.ts')
	})
})

describe('review marks', () => {
	test('keeps the reviewed version per file key and collapses it', () => {
		state().markReviewed('task-1', files)

		expect(state().reviewedByTask['task-1']).toEqual({
			'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-a' },
			'repo-1:b.ts': { versionId: 'repo-1:b.ts:blob-b' },
		})
		expect(state().collapsedByTask['task-1']).toEqual({
			'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-a', collapsed: true },
			'repo-1:b.ts': { versionId: 'repo-1:b.ts:blob-b', collapsed: true },
		})
	})

	test('unmarking removes the reviewed version and expands the file', () => {
		state().markReviewed('task-1', files)
		state().markUnreviewed('task-1', [files[0]])

		expect(state().reviewedByTask['task-1']).toEqual({ 'repo-1:b.ts': { versionId: 'repo-1:b.ts:blob-b' } })
		expect(state().collapsedByTask['task-1']?.['repo-1:a.ts']).toEqual({
			versionId: 'repo-1:a.ts:blob-a',
			collapsed: false,
		})
	})

	test('collapsing leaves reviewed state alone', () => {
		state().markReviewed('task-1', [files[0]])
		state().setCollapsed('task-1', files, false)

		expect(state().reviewedByTask['task-1']).toEqual({ 'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-a' } })
		expect(state().collapsedByTask['task-1']).toEqual({
			'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-a', collapsed: false },
			'repo-1:b.ts': { versionId: 'repo-1:b.ts:blob-b', collapsed: false },
		})
	})

	test('marking a new version keeps the version reviewed before it', () => {
		state().markReviewed('task-1', [a('b')])
		state().markReviewed('task-1', [a('c')])

		expect(state().reviewedByTask['task-1']).toEqual({
			'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-c', previousVersionId: 'repo-1:a.ts:blob-b' },
		})
	})

	test('marking the same version again keeps its previous version', () => {
		state().markReviewed('task-1', [a('b')])
		state().markReviewed('task-1', [a('c')])
		state().markReviewed('task-1', [a('c')])

		expect(state().reviewedByTask['task-1']?.['repo-1:a.ts']).toEqual({
			versionId: 'repo-1:a.ts:blob-c',
			previousVersionId: 'repo-1:a.ts:blob-b',
		})
	})

	test('unmarking and marking the same version again keeps its history', () => {
		state().markReviewed('task-1', [a('b')])
		state().markReviewed('task-1', [a('c')])
		state().markUnreviewed('task-1', [a('c')])

		expect(state().reviewedByTask['task-1']).toEqual({})

		state().markReviewed('task-1', [a('c')])

		expect(state().reviewedByTask['task-1']?.['repo-1:a.ts']).toEqual({
			versionId: 'repo-1:a.ts:blob-c',
			previousVersionId: 'repo-1:a.ts:blob-b',
		})
		expect(state().unmarkedByTask['task-1']).toEqual({})
	})

	test('an unmarked version no longer counts as approved when a new version is marked', () => {
		state().markReviewed('task-1', [a('b')])
		state().markUnreviewed('task-1', [a('b')])
		state().markReviewed('task-1', [a('c')])

		expect(state().reviewedByTask['task-1']?.['repo-1:a.ts']).toEqual({ versionId: 'repo-1:a.ts:blob-c' })
	})

	test('marking a new version after unmarking remembers the version approved before the unmarked one', () => {
		state().markReviewed('task-1', [a('a')])
		state().markReviewed('task-1', [a('b')])
		state().markUnreviewed('task-1', [a('b')])
		state().markReviewed('task-1', [a('c')])

		expect(state().reviewedByTask['task-1']?.['repo-1:a.ts']).toEqual({
			versionId: 'repo-1:a.ts:blob-c',
			previousVersionId: 'repo-1:a.ts:blob-a',
		})
	})

	test('drops marks whose reviewed version is gone, in one task only', () => {
		state().markReviewed('task-1', files)
		state().markReviewed('task-2', files)
		state().dropReviewVersions('task-1', ['repo-1:a.ts:blob-a'])

		expect(state().reviewedByTask['task-1']).toEqual({ 'repo-1:b.ts': { versionId: 'repo-1:b.ts:blob-b' } })
		expect(Object.keys(state().reviewedByTask['task-2'] ?? {})).toHaveLength(2)
	})

	test('drops only the previous version when that one is gone', () => {
		state().markReviewed('task-1', [a('b')])
		state().markReviewed('task-1', [a('c')])
		state().dropReviewVersions('task-1', ['repo-1:a.ts:blob-b'])

		expect(state().reviewedByTask['task-1']).toEqual({ 'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-c' } })
	})

	test('drops missing versions from unmarked history too', () => {
		state().markReviewed('task-1', [a('b')])
		state().markReviewed('task-1', [a('c')])
		state().markUnreviewed('task-1', [a('c')])
		state().dropReviewVersions('task-1', ['repo-1:a.ts:blob-b'])

		expect(state().unmarkedByTask['task-1']).toEqual({ 'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-c' } })
	})

	test('leaves state alone when no mark names a missing version', () => {
		state().markReviewed('task-1', files)
		const before = state()
		state().dropReviewVersions('task-1', ['repo-1:a.ts:gone'])

		expect(state().reviewedByTask).toBe(before.reviewedByTask)
	})

	test('persists marks to localStorage so they survive a restart', () => {
		state().markReviewed('task-1', [files[0]])

		const persisted = JSON.parse(localStorage.getItem(TASK_DIFF_REVIEW_MARKS_STORAGE_KEY) ?? '{}')
		expect(persisted.state.reviewedByTask).toEqual({
			'task-1': { 'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-a' } },
		})
		expect(persisted.version).toBe(2)
	})

	test('migrates version 1 marks, which stored the reviewed versionId as a string', () => {
		const migrated = migrateTaskDiffReviewMarksState(
			{
				reviewedByTask: { 'task-1': { 'repo-1:a.ts': 'repo-1:a.ts:blob-a' } },
				comparisonByTask: { 'task-1': 'since-task-start' },
				defaultComparison: 'since-task-start',
			},
			1,
		)

		expect(migrated).toEqual({
			reviewedByTask: { 'task-1': { 'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-a' } } },
			unmarkedByTask: {},
			comparisonByTask: { 'task-1': 'since-task-start' },
			defaultComparison: 'since-task-start',
		})
	})
})

describe('comparison mode', () => {
	test('defaults to since last review', () => {
		expect(getTaskDiffComparison(state(), 'task-1')).toBe('since-last-review')
	})

	test('sets the task mode and the default for tasks without one', () => {
		state().setComparison('task-1', 'since-last-review')
		state().setComparison('task-2', 'since-task-start')

		expect(getTaskDiffComparison(state(), 'task-1')).toBe('since-last-review')
		expect(getTaskDiffComparison(state(), 'task-2')).toBe('since-task-start')
		expect(getTaskDiffComparison(state(), 'task-new')).toBe('since-task-start')
	})

	test('changing the mode does not touch review marks', () => {
		state().markReviewed('task-1', [files[0]])
		state().setComparison('task-1', 'since-task-start')

		expect(state().reviewedByTask['task-1']).toEqual({ 'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-a' } })
	})
})

describe('task cleanup', () => {
	function saveTask(taskId: string) {
		state().markReviewed(taskId, [a('b')])
		state().markReviewed(taskId, [files[1]])
		state().markUnreviewed(taskId, [files[1]])
		state().setCollapsed(taskId, [a('b')], false)
		state().setComparison(taskId, 'since-task-start')
	}

	test('reset forgets marks, removed marks and collapse choices but keeps the comparison mode', () => {
		saveTask('task-1')
		saveTask('task-2')
		state().resetReview('task-1')

		expect(state().reviewedByTask['task-1']).toBeUndefined()
		expect(state().unmarkedByTask['task-1']).toBeUndefined()
		expect(state().collapsedByTask['task-1']).toBeUndefined()
		expect(getTaskDiffComparison(state(), 'task-1')).toBe('since-task-start')
		expect(state().defaultComparison).toBe('since-task-start')
		expect(state().reviewedByTask['task-2']).toBeDefined()
	})

	test('a file marked again after a reset has no review history', () => {
		state().markReviewed('task-1', [a('b')])
		state().markUnreviewed('task-1', [a('b')])
		state().resetReview('task-1')
		state().markReviewed('task-1', [a('c')])

		expect(state().reviewedByTask['task-1']).toEqual({ 'repo-1:a.ts': { versionId: 'repo-1:a.ts:blob-c' } })
	})

	test('clearing an archived task forgets everything saved for it, comparison mode included', () => {
		saveTask('task-1')
		saveTask('task-2')
		state().clearTask('task-1')

		expect(state().reviewedByTask).not.toHaveProperty('task-1')
		expect(state().unmarkedByTask).not.toHaveProperty('task-1')
		expect(state().collapsedByTask).not.toHaveProperty('task-1')
		expect(state().comparisonByTask).not.toHaveProperty('task-1')
		expect(state().reviewedByTask['task-2']).toBeDefined()
		expect(state().defaultComparison).toBe('since-task-start')
		const persisted = JSON.parse(localStorage.getItem(TASK_DIFF_REVIEW_MARKS_STORAGE_KEY) ?? '{}')
		expect(persisted.state.reviewedByTask).not.toHaveProperty('task-1')
	})

	test('pruning drops archived tasks and keeps tasks missing from the synced list', () => {
		saveTask('task-archived')
		saveTask('task-active')
		saveTask('task-other-org')
		state().pruneTasks(new Set(['task-archived', 'task-never-saved']))

		expect(Object.keys(state().reviewedByTask).sort()).toEqual(['task-active', 'task-other-org'])
		expect(state().comparisonByTask).not.toHaveProperty('task-archived')
	})

	test('pruning with nothing to drop leaves state alone', () => {
		saveTask('task-1')
		const before = state()
		state().pruneTasks(new Set())
		state().clearTask('task-unknown')

		expect(state()).toBe(before)
	})
})
