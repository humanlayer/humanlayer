import { describe, expect, test } from 'vitest'

import { parseNavigationDeepLink } from './handler'

describe('parseNavigationDeepLink', () => {
	test('preserves capability and review state while dropping the browser-only handoff flag', () => {
		expect(
			parseNavigationDeepLink(
				'humanlayer-dev://nav/shared/artifacts/5f4f33dc-1074-4faf-9bda-2f168a1acafe?key=share-secret&artifactId=5f4f33dc-1074-4faf-9bda-2f168a1acafe&comment=comment-id&fullscreen=true&deep=true',
			),
		).toBe(
			'/shared/artifacts/5f4f33dc-1074-4faf-9bda-2f168a1acafe?key=share-secret&artifactId=5f4f33dc-1074-4faf-9bda-2f168a1acafe&comment=comment-id&fullscreen=true',
		)
	})
})
