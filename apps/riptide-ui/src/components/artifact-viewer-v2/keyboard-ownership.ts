import type { FocusedArea } from '@/hooks/stores/focusStore'

export function artifactViewerNavigationEnabled({
	displayMode,
	isFullscreen,
	focusedArea,
	enabled,
	editableFocused,
}: {
	displayMode: 'sidebar' | 'fullscreen'
	isFullscreen: boolean
	focusedArea: FocusedArea
	enabled: boolean
	editableFocused: boolean
}): boolean {
	if (!enabled || editableFocused || focusedArea !== 'RIGHT_PANE') return false
	return displayMode === 'fullscreen' ? isFullscreen : !isFullscreen
}

export function artifactReviewScopeActive({
	targetActive,
	navigationEnabled,
}: {
	targetActive: boolean
	navigationEnabled: boolean
}): boolean {
	return targetActive && navigationEnabled
}
