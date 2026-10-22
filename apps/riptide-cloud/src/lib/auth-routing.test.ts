import { describe, expect, test } from 'vitest'

import { isPublicRoute } from './auth-routing'

describe('isPublicRoute', () => {
	test.each(['/auth/signin', '/shared/artifacts/artifact-123?key=share-key', '/connect/linear'])(
		'allows unauthenticated access to %s',
		(pathname) => {
			expect(isPublicRoute(pathname)).toBe(true)
		},
	)

	test.each(['/artifacts/artifact-123', '/artifacts', '/tasks/task-123', '/organizations/select'])(
		'requires authentication for %s',
		(pathname) => {
			expect(isPublicRoute(pathname)).toBe(false)
		},
	)
})
