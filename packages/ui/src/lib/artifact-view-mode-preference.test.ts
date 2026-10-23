import { describe, expect, test } from 'vitest'

import { getArtifactViewModeAfterArtifactChange, getRestorableArtifactViewMode } from './artifact-view-mode-preference'

describe('artifact view mode preference', () => {
	test.each(['rendered', 'raw'] as const)('keeps %s when the artifact changes', (viewMode) => {
		expect(
			getArtifactViewModeAfterArtifactChange({
				previousArtifactId: 'artifact-1',
				nextArtifactId: 'artifact-2',
				viewMode,
			}),
		).toBe(viewMode)
	})

	test('returns to Rendered when the artifact changes from Diff', () => {
		expect(
			getArtifactViewModeAfterArtifactChange({
				previousArtifactId: 'artifact-1',
				nextArtifactId: 'artifact-2',
				viewMode: 'diff',
			}),
		).toBe('rendered')
	})

	test('does not close Diff when the selected artifact stays the same', () => {
		expect(
			getArtifactViewModeAfterArtifactChange({
				previousArtifactId: 'artifact-1',
				nextArtifactId: 'artifact-1',
				viewMode: 'diff',
			}),
		).toBe('diff')
	})

	test.each([
		['rendered', 'rendered'],
		['raw', 'raw'],
		['diff', 'rendered'],
		[undefined, 'rendered'],
	] as const)('restores %s as %s', (storedMode, expected) => {
		expect(getRestorableArtifactViewMode(storedMode)).toBe(expected)
	})
})
