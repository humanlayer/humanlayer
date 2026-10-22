export type ArtifactViewPreferenceMode = 'rendered' | 'raw' | 'diff'

export function getRestorableArtifactViewMode(mode: unknown): 'rendered' | 'raw' {
	return mode === 'raw' ? 'raw' : 'rendered'
}

export function getArtifactViewModeAfterArtifactChange({
	previousArtifactId,
	nextArtifactId,
	viewMode,
}: {
	previousArtifactId: string | null
	nextArtifactId: string | null
	viewMode: ArtifactViewPreferenceMode
}): ArtifactViewPreferenceMode {
	if (previousArtifactId !== nextArtifactId && viewMode === 'diff') return 'rendered'
	return viewMode
}
