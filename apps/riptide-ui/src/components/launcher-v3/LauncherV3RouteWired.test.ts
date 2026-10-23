import { expect, test } from 'vitest'

import { resolveInitialProjectId } from './LauncherV3RouteWired'

test('uses a URL projectId only when it is present in the readable list', () => {
	const projectId = '00000000-0000-4000-8000-000000000001'
	expect(resolveInitialProjectId(projectId, [{ id: projectId }])).toBe(projectId)
})

test.each([
	['missing', undefined, [{ id: 'project-1' }]],
	['stale', '00000000-0000-4000-8000-000000000001', []],
	['archived or inaccessible', '00000000-0000-4000-8000-000000000001', [{ id: 'project-2' }]],
])('leaves the Launcher V3 form unselected for a %s URL projectId', (_case, projectId, readableProjects) => {
	expect(resolveInitialProjectId(projectId, readableProjects)).toBeNull()
})
