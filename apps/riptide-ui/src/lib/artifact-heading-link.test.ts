import { describe, expect, test } from 'vitest'

import { buildArtifactHeadingLink } from './artifact-heading-link'

describe('buildArtifactHeadingLink', () => {
	test('opens the selected artifact at the requested heading', () => {
		const link = buildArtifactHeadingLink(
			'https://app.example.test/tasks/task-1?from=archive-tasks&commentId=comment-1',
			'artifact-1',
			'h2-details-2',
			'sidebar',
		)
		const url = new URL(link)

		expect(url.pathname).toBe('/tasks/task-1')
		expect(Object.fromEntries(url.searchParams)).toEqual({
			from: 'archive-tasks',
			artifactId: 'artifact-1',
			headingId: 'h2-details-2',
		})
	})

	test('preserves the whole session route and requests fullscreen when copied there', () => {
		const link = buildArtifactHeadingLink(
			'https://app.example.test/sessions/session-1?from=archive-sessions&deep=true',
			'artifact-1',
			'h4-deep-heading',
			'fullscreen',
		)
		const url = new URL(link)

		expect(url.pathname).toBe('/sessions/session-1')
		expect(Object.fromEntries(url.searchParams)).toEqual({
			from: 'archive-sessions',
			deep: 'true',
			artifactId: 'artifact-1',
			headingId: 'h4-deep-heading',
			fullscreen: 'true',
		})
	})

	test('removes a stale fullscreen parameter for sidebar links', () => {
		const link = buildArtifactHeadingLink(
			'https://app.example.test/tasks/task-1?fullscreen=true&forceViewerV2=true',
			'artifact-1',
			'h2-details',
			'sidebar',
		)

		expect(new URL(link).searchParams.has('fullscreen')).toBe(false)
		expect(new URL(link).searchParams.has('forceViewerV2')).toBe(false)
	})
})
