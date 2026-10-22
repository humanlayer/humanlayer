import { beforeEach, describe, expect, test } from 'vitest'

import {
	migrateTaskDiffReviewState,
	removeFullscreenPresentations,
	useTaskDiffReviewStore,
} from '@/hooks/stores/taskDiffReviewStore'

beforeEach(() => {
	useTaskDiffReviewStore.setState({
		selectedFileByTask: {},
		presentationByTask: {},
		preferredPlacement: 'sidebar',
	})
})

describe('removeFullscreenPresentations', () => {
	test('restores the fullscreen origin before presentation state is persisted', () => {
		expect(
			removeFullscreenPresentations({
				'task-sidebar': { active: 'fullscreen', fullscreenOrigin: 'sidebar' },
				'task-primary': { active: 'fullscreen', fullscreenOrigin: 'primary' },
				'task-direct': { active: 'fullscreen', fullscreenOrigin: null },
				'task-open': { active: 'sidebar', fullscreenOrigin: null },
			}),
		).toEqual({
			'task-sidebar': { active: 'sidebar', fullscreenOrigin: null },
			'task-primary': { active: 'primary', fullscreenOrigin: null },
			'task-direct': { active: null, fullscreenOrigin: null },
			'task-open': { active: 'sidebar', fullscreenOrigin: null },
		})
	})
})

describe('task diff review persistence', () => {
	test.each([0, 2])('drops review marks persisted by version %i; they now live in localStorage', (version) => {
		expect(
			migrateTaskDiffReviewState(
				{
					viewedByTask: { 'task-1': { 'file-1': 'hash-1' } },
					reviewedByTask: { 'task-1': { 'file-1': 'hash-1' } },
					collapsedByTask: { 'task-1': { 'file-1': { patchHash: 'hash-1', collapsed: true } } },
					preferredPlacement: 'primary',
				},
				version,
			),
		).toEqual({ preferredPlacement: 'primary' })
	})
})
