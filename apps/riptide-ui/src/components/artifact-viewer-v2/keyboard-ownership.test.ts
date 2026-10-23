import { describe, expect, test } from 'vitest'

import { artifactReviewScopeActive, artifactViewerNavigationEnabled } from './keyboard-ownership'

describe('artifact viewer dual-instance keyboard ownership', () => {
	test('only the fullscreen controller receives navigation while both instances are mounted', () => {
		const common = {
			isFullscreen: true,
			focusedArea: 'RIGHT_PANE' as const,
			enabled: true,
			editableFocused: false,
		}

		expect(artifactViewerNavigationEnabled({ ...common, displayMode: 'sidebar' })).toBe(false)
		expect(artifactViewerNavigationEnabled({ ...common, displayMode: 'fullscreen' })).toBe(true)
	})

	test('the sidebar regains navigation after fullscreen closes', () => {
		const common = {
			isFullscreen: false,
			focusedArea: 'RIGHT_PANE' as const,
			enabled: true,
			editableFocused: false,
		}

		expect(artifactViewerNavigationEnabled({ ...common, displayMode: 'sidebar' })).toBe(true)
		expect(artifactViewerNavigationEnabled({ ...common, displayMode: 'fullscreen' })).toBe(false)
	})

	test('editable focus and non-right areas suppress both instances', () => {
		for (const displayMode of ['sidebar', 'fullscreen'] as const) {
			expect(
				artifactViewerNavigationEnabled({
					displayMode,
					isFullscreen: displayMode === 'fullscreen',
					focusedArea: 'MAIN',
					enabled: true,
					editableFocused: false,
				}),
			).toBe(false)
			expect(
				artifactViewerNavigationEnabled({
					displayMode,
					isFullscreen: displayMode === 'fullscreen',
					focusedArea: 'RIGHT_PANE',
					enabled: true,
					editableFocused: true,
				}),
			).toBe(false)
		}
	})

	test('a retained block target cannot shadow MAIN after right-pane navigation ends', () => {
		expect(artifactReviewScopeActive({ targetActive: true, navigationEnabled: false })).toBe(false)
		expect(artifactReviewScopeActive({ targetActive: true, navigationEnabled: true })).toBe(true)
	})
})
