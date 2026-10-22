import { create } from 'zustand'

export type ArtifactListFocusSource = 'keyboard' | 'pointer'

interface ArtifactListFocusState {
	focusedArtifactId: string | null
	focusedArtifactIndex: number | null
	focusSource: ArtifactListFocusSource | null

	setFocusedArtifact: (artifactId: string, index: number, source: ArtifactListFocusSource) => void
	reconcileArtifactIds: (artifactIds: string[]) => void
	focusNext: (artifactIds: string[]) => void
	focusPrevious: (artifactIds: string[]) => void
	clearFocus: () => void
}

function focusAtIndex(
	set: (state: Partial<ArtifactListFocusState>) => void,
	artifactIds: string[],
	index: number,
): void {
	const artifactId = artifactIds[index]
	if (!artifactId) return
	set({ focusedArtifactId: artifactId, focusedArtifactIndex: index, focusSource: 'keyboard' })
}

function currentIndex(artifactIds: string[], state: ArtifactListFocusState): number {
	if (state.focusedArtifactIndex !== null && artifactIds[state.focusedArtifactIndex] === state.focusedArtifactId) {
		return state.focusedArtifactIndex
	}
	return artifactIds.indexOf(state.focusedArtifactId ?? '')
}

/**
 * Runtime-only cursor for the sidebar artifact list. Spatial area ownership
 * remains in focusStore; this store tracks only the row inside RIGHT_PANE.
 */
export const useArtifactListFocusStore = create<ArtifactListFocusState>((set, get) => ({
	focusedArtifactId: null,
	focusedArtifactIndex: null,
	focusSource: null,

	setFocusedArtifact: (artifactId, index, source) =>
		set({ focusedArtifactId: artifactId, focusedArtifactIndex: index, focusSource: source }),
	reconcileArtifactIds: (artifactIds) => {
		const { focusedArtifactId, focusedArtifactIndex } = get()
		if (!focusedArtifactId) {
			if (focusedArtifactIndex !== null) set({ focusedArtifactIndex: null })
			return
		}

		const nextIndex = currentIndex(artifactIds, get())
		if (nextIndex === -1) {
			set({ focusedArtifactId: null, focusedArtifactIndex: null, focusSource: null })
		} else if (nextIndex !== focusedArtifactIndex) {
			set({ focusedArtifactIndex: nextIndex })
		}
	},
	focusNext: (artifactIds) => {
		if (artifactIds.length === 0) return
		const index = currentIndex(artifactIds, get())
		focusAtIndex(set, artifactIds, index === -1 ? 0 : Math.min(index + 1, artifactIds.length - 1))
	},
	focusPrevious: (artifactIds) => {
		if (artifactIds.length === 0) return
		const index = currentIndex(artifactIds, get())
		focusAtIndex(set, artifactIds, index === -1 ? 0 : Math.max(index - 1, 0))
	},
	clearFocus: () => set({ focusedArtifactId: null, focusedArtifactIndex: null, focusSource: null }),
}))
