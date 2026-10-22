import type {
	ArtifactOutlinePreference,
	ArtifactScrollSnapshot,
	ArtifactScrollSnapshotInput,
} from '@humanlayer/ui/artifact-viewer-v2'
import {
	getArtifactViewModeAfterArtifactChange,
	getRestorableArtifactViewMode,
} from '@humanlayer/ui/lib/artifact-view-mode-preference'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'

import { useFocusStore } from './focusStore'

type ArtifactViewMode = 'rendered' | 'raw' | 'diff'

export interface ArtifactVersionSelection {
	sourceId: string
	destinationId: string
}

interface ArtifactViewerState {
	selectedArtifactId: string | null
	viewMode: ArtifactViewMode
	versionSelectionByArtifact: Record<string, ArtifactVersionSelection>
	isFullscreen: boolean
	/** Content-only fullscreen modal for previewable artifacts (image / HTML / PDF). */
	isFullscreenModalOpen: boolean
	/** True while the sidebar artifact list or viewer focus surface is mounted. */
	isSidebarViewerMounted: boolean
	sidebarOutlinePreference: ArtifactOutlinePreference
	/** Session-only per-artifact escape hatch for legacy comments. */
	forceLegacyViewerByArtifactId: Record<string, true>
	readingFocusByArtifactId: Record<string, ArtifactScrollSnapshot>
	foldsByArtifactId: Record<string, ReadonlySet<string>>

	setSelectedArtifactId: (id: string | null, options?: { claimFocus?: boolean }) => void
	setViewMode: (mode: ArtifactViewMode) => void
	setVersionSelection: (artifactId: string, selection: ArtifactVersionSelection) => void
	clearSelection: () => void
	openFullscreen: () => void
	closeFullscreen: () => void
	toggleFullscreen: () => void
	openFullscreenModal: () => void
	setFullscreenModalOpen: (open: boolean) => void
	setSidebarViewerMounted: (mounted: boolean) => void
	setSidebarOutlinePreference: (preference: ArtifactOutlinePreference) => void
	setForceLegacyViewer: (artifactId: string, force: boolean) => void
	publishReadingFocus: (snapshot: ArtifactScrollSnapshotInput) => void
	setArtifactFolds: (artifactId: string, foldedHeadingIds: ReadonlySet<string>) => void
}

export const useArtifactViewerStore = create<ArtifactViewerState>()(
	persist(
		(set, get) => ({
			selectedArtifactId: null,
			viewMode: 'rendered',
			versionSelectionByArtifact: {},
			isFullscreen: false,
			isFullscreenModalOpen: false,
			isSidebarViewerMounted: false,
			sidebarOutlinePreference: 'auto',
			forceLegacyViewerByArtifactId: {},
			readingFocusByArtifactId: {},
			foldsByArtifactId: {},

			setSelectedArtifactId: (id, options) => {
				set((state) => ({
					selectedArtifactId: id,
					viewMode: getArtifactViewModeAfterArtifactChange({
						previousArtifactId: state.selectedArtifactId,
						nextArtifactId: id,
						viewMode: state.viewMode,
					}),
				}))
				if (id && options?.claimFocus !== false) {
					useFocusStore.getState().focusRightPane()
				} else if (useFocusStore.getState().focusedArea === 'RIGHT_PANE') {
					if (!id) focusMainAndReleaseSpatialDomFocus()
				}
			},
			setViewMode: (mode) => set({ viewMode: mode }),
			setVersionSelection: (artifactId, selection) =>
				set((state) => ({
					versionSelectionByArtifact: {
						...state.versionSelectionByArtifact,
						[artifactId]: selection,
					},
				})),
			clearSelection: () => {
				set({ selectedArtifactId: null })
				if (useFocusStore.getState().focusedArea === 'RIGHT_PANE' && !get().isSidebarViewerMounted) {
					focusMainAndReleaseSpatialDomFocus()
				}
			},
			openFullscreen: () => {
				set({ isFullscreen: true })
				useFocusStore.getState().focusRightPane()
			},
			closeFullscreen: () => {
				set({ isFullscreen: false })
			},
			toggleFullscreen: () => {
				const opening = !get().isFullscreen
				set({ isFullscreen: opening })
				if (opening) {
					useFocusStore.getState().focusRightPane()
				}
			},
			openFullscreenModal: () => {
				set({ isFullscreenModalOpen: true })
				useFocusStore.getState().focusRightPane()
			},
			setFullscreenModalOpen: (open) => {
				set({ isFullscreenModalOpen: open })
			},
			setSidebarViewerMounted: (mounted) => {
				set({ isSidebarViewerMounted: mounted })
			},
			setSidebarOutlinePreference: (preference) => {
				set({ sidebarOutlinePreference: preference })
			},
			setForceLegacyViewer: (artifactId, force) => {
				set((state) => {
					const next = { ...state.forceLegacyViewerByArtifactId }
					if (force) next[artifactId] = true
					else delete next[artifactId]
					return { forceLegacyViewerByArtifactId: next }
				})
			},
			publishReadingFocus: (snapshot) => {
				set((state) => {
					const previous = state.readingFocusByArtifactId[snapshot.artifactId]
					return {
						readingFocusByArtifactId: {
							...state.readingFocusByArtifactId,
							[snapshot.artifactId]: { ...snapshot, revision: (previous?.revision ?? 0) + 1 },
						},
					}
				})
			},
			setArtifactFolds: (artifactId, foldedHeadingIds) => {
				set((state) => {
					const previous = state.foldsByArtifactId[artifactId]
					if (
						previous?.size === foldedHeadingIds.size &&
						[...foldedHeadingIds].every((headingId) => previous.has(headingId))
					) {
						return state
					}
					return {
						foldsByArtifactId: {
							...state.foldsByArtifactId,
							[artifactId]: new Set(foldedHeadingIds),
						},
					}
				})
			},
		}),
		{
			name: 'riptide-artifact-viewer',
			version: 3,
			migrate: (persistedState) => {
				const state = persistedState as Partial<ArtifactViewerState> & { isSidebarOutlineOpen?: boolean }
				return {
					selectedArtifactId: state.selectedArtifactId ?? null,
					viewMode: getRestorableArtifactViewMode(state.viewMode),
					versionSelectionByArtifact: state.versionSelectionByArtifact ?? {},
					sidebarOutlinePreference:
						state.sidebarOutlinePreference ?? (state.isSidebarOutlineOpen === false ? 'closed' : 'auto'),
				}
			},
			partialize: (state) => ({
				selectedArtifactId: state.selectedArtifactId,
				viewMode: getRestorableArtifactViewMode(state.viewMode),
				versionSelectionByArtifact: state.versionSelectionByArtifact,
				sidebarOutlinePreference: state.sidebarOutlinePreference,
			}),
		},
	),
)

/**
 * True while the sidebar artifact viewer holds the shared navigation keys.
 * Page-level j/k-style hotkeys (conversation stream, task sessions table)
 * should be disabled while this is true; the viewer's own navigation should
 * be enabled only while it is.
 */
export function useArtifactPaneOwnsNavigationKeys(): boolean {
	return useFocusStore((s) => s.focusedArea === 'RIGHT_PANE')
}
