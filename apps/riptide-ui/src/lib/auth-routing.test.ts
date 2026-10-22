import { describe, expect, test } from 'vitest'

import {
	authenticatedArtifactDestination,
	isPublicBrowserRoute,
	isSharedArtifactRoute,
	providerModeForPath,
} from './auth-routing'

describe('auth routing', () => {
	test('classifies shared artifact pages as public browser routes', () => {
		expect(isSharedArtifactRoute('/shared/artifacts/5f4f33dc-1074-4faf-9bda-2f168a1acafe')).toBe(true)
		expect(isPublicBrowserRoute('/shared/artifacts/5f4f33dc-1074-4faf-9bda-2f168a1acafe')).toBe(true)
		expect(providerModeForPath('/shared/artifacts/5f4f33dc-1074-4faf-9bda-2f168a1acafe')).toBe('shared')
	})

	test('keeps ordinary app pages authenticated', () => {
		expect(isSharedArtifactRoute('/tasks/task-id')).toBe(false)
		expect(isPublicBrowserRoute('/tasks/task-id')).toBe(false)
		expect(providerModeForPath('/tasks/task-id')).toBe('authenticated')
	})

	test('builds the normal task artifact destination for authenticated resolutions', () => {
		expect(authenticatedArtifactDestination('task-id', 'artifact-id')).toEqual({
			to: '/tasks/$taskId',
			params: { taskId: 'task-id' },
			search: { artifactId: 'artifact-id' },
			replace: true,
		})
	})
})
