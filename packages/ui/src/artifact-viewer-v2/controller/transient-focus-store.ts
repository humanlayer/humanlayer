import { create } from 'zustand'

export interface ArtifactCommentFocusState {
	selectedRootId: string | null
	hoveredRootId: string | null
}

/**
 * Module-level transient thread activation (selected + hovered root). A single
 * store is shared by every mounted viewer — the controller resets it on mount,
 * and two simultaneously mounted viewers of one artifact intentionally share the
 * transient selection.
 */
export const useArtifactCommentFocusStore = create<ArtifactCommentFocusState>(() => ({
	selectedRootId: null,
	hoveredRootId: null,
}))

export function isArtifactCommentRootActive(state: ArtifactCommentFocusState, rootId: string): boolean {
	return state.selectedRootId === rootId || state.hoveredRootId === rootId
}
