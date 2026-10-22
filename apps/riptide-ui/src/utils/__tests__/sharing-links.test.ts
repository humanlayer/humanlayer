import { describe, expect, test } from 'vitest'

import { getSessionShareUrl, getTaskShareUrl } from '../sharing-links'

describe('sharing-links', () => {
	test('generates direct task link with ?deep=true using window.location.origin', () => {
		const url = getTaskShareUrl('task-123')
		expect(url).toBe(`${window.location.origin}/tasks/task-123?deep=true`)
	})

	test('generates direct session link with ?deep=true using window.location.origin', () => {
		const url = getSessionShareUrl('session-456')
		expect(url).toBe(`${window.location.origin}/sessions/session-456?deep=true`)
	})

	test.each(['sidebar', 'primary', 'fullscreen'] as const)(
		'generates exact task review targets in %s',
		(diffPresentation) => {
			const url = getTaskShareUrl('task-123', {
				diffPresentation,
				diffFileId: 'task-123:repo-1:src/review.ts',
				diffCommentId: 'root-comment',
			})

			expect(url).toBe(
				`${window.location.origin}/tasks/task-123?deep=true&diffPresentation=${diffPresentation}&diffFileId=task-123%3Arepo-1%3Asrc%2Freview.ts&diffCommentId=root-comment`,
			)
		},
	)

	test.each(['sidebar', 'primary', 'fullscreen'] as const)(
		'generates exact session review targets in %s',
		(diffPresentation) => {
			const url = getSessionShareUrl('session-456', {
				diffPresentation,
				diffFileId: 'task-123:repo-1:src/review.ts',
				diffCommentId: 'root-comment',
			})

			expect(url).toBe(
				`${window.location.origin}/sessions/session-456?deep=true&diffPresentation=${diffPresentation}&diffFileId=task-123%3Arepo-1%3Asrc%2Freview.ts&diffCommentId=root-comment`,
			)
		},
	)

	test('supports review-only, file, root, and reply-originated root targets', () => {
		expect(getTaskShareUrl('task-123', { diffPresentation: 'sidebar' })).toBe(
			`${window.location.origin}/tasks/task-123?deep=true&diffPresentation=sidebar`,
		)
		expect(getTaskShareUrl('task-123', { diffPresentation: 'sidebar', diffFileId: 'file-1' })).toBe(
			`${window.location.origin}/tasks/task-123?deep=true&diffPresentation=sidebar&diffFileId=file-1`,
		)
		expect(
			getTaskShareUrl('task-123', {
				diffPresentation: 'sidebar',
				diffFileId: 'file-1',
				diffCommentId: 'root-comment',
			}),
		).toBe(
			`${window.location.origin}/tasks/task-123?deep=true&diffPresentation=sidebar&diffFileId=file-1&diffCommentId=root-comment`,
		)
	})
})
