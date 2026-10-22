import { create } from 'zustand'

interface ArtifactViewerState {
	/** Session-only per-artifact escape hatch for legacy comments. */
	forceLegacyViewerByArtifactId: Record<string, true>
	setForceLegacyViewer: (artifactId: string, force: boolean) => void
}

export const useArtifactViewerStore = create<ArtifactViewerState>((set) => ({
	forceLegacyViewerByArtifactId: {},
	setForceLegacyViewer: (artifactId, force) => {
		set((state) => {
			const next = { ...state.forceLegacyViewerByArtifactId }
			if (force) next[artifactId] = true
			else delete next[artifactId]
			return { forceLegacyViewerByArtifactId: next }
		})
	},
}))
