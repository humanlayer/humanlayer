import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export type DiffReviewBasePlacement = 'sidebar' | 'primary'
export type DiffReviewPresentation = DiffReviewBasePlacement | 'fullscreen'
export type DiffReviewPlacement = DiffReviewBasePlacement

export interface DiffReviewPresentationState {
	active: DiffReviewPresentation | null
	fullscreenOrigin: DiffReviewBasePlacement | null
}

/** Selection and presentation only; review marks live in `taskDiffReviewMarksStore`. */
interface TaskDiffReviewState {
	selectedFileByTask: Record<string, string>
	presentationByTask: Record<string, DiffReviewPresentationState>
	preferredPlacement: DiffReviewBasePlacement
	/**
	 * Whether the fullscreen review dialog is on screen. It sits in the browser's top layer, which
	 * react-resizable-panels cannot see, so panel groups behind it disable themselves while it is
	 * open; otherwise their resize handles take clicks meant for the dialog. Not persisted.
	 */
	fullscreenDialogOpen: boolean
	setSelectedFile: (taskId: string, fileId: string | null) => void
	setPresentation: (taskId: string, presentation: DiffReviewPresentationState) => void
	setPreferredPlacement: (placement: DiffReviewBasePlacement) => void
	setFullscreenDialogOpen: (open: boolean) => void
}

type PersistedTaskDiffReviewState = Pick<
	TaskDiffReviewState,
	'selectedFileByTask' | 'presentationByTask' | 'preferredPlacement'
>

interface LegacyPersistedTaskDiffReviewState extends Partial<PersistedTaskDiffReviewState> {
	viewedByTask?: unknown
	reviewedByTask?: unknown
	collapsedByTask?: unknown
}

export function migrateTaskDiffReviewState(
	persistedState: unknown,
	version: number,
): Partial<PersistedTaskDiffReviewState> {
	const persisted = (persistedState ?? {}) as LegacyPersistedTaskDiffReviewState
	if (version >= 3) return persisted
	// Review marks moved to the localStorage marks store, keyed by fileKey. The old ones hold
	// patch hashes or file IDs, which never match, so they are dropped rather than carried over.
	const {
		viewedByTask: _viewedByTask,
		reviewedByTask: _reviewedByTask,
		collapsedByTask: _collapsedByTask,
		...current
	} = persisted
	return current
}

export function removeFullscreenPresentations(
	presentations: Record<string, DiffReviewPresentationState> | undefined,
): Record<string, DiffReviewPresentationState> {
	return Object.fromEntries(
		Object.entries(presentations ?? {}).map(([taskId, presentation]) => [
			taskId,
			presentation.active === 'fullscreen'
				? { active: presentation.fullscreenOrigin, fullscreenOrigin: null }
				: presentation,
		]),
	)
}

const noopStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
}

export const useTaskDiffReviewStore = create<TaskDiffReviewState>()(
	persist(
		(set) => ({
			selectedFileByTask: {},
			presentationByTask: {},
			preferredPlacement: 'sidebar',
			fullscreenDialogOpen: false,
			setSelectedFile: (taskId, fileId) =>
				set((state) => {
					const selectedFileByTask = { ...state.selectedFileByTask }
					if (fileId) selectedFileByTask[taskId] = fileId
					else delete selectedFileByTask[taskId]
					return { selectedFileByTask }
				}),
			setPresentation: (taskId, presentation) =>
				set((state) => ({
					presentationByTask: { ...state.presentationByTask, [taskId]: presentation },
				})),
			setPreferredPlacement: (preferredPlacement) => set({ preferredPlacement }),
			setFullscreenDialogOpen: (fullscreenDialogOpen) => set({ fullscreenDialogOpen }),
		}),
		{
			name: 'riptide-task-diff-review',
			version: 3,
			storage: createJSONStorage(() => (typeof sessionStorage === 'undefined' ? noopStorage : sessionStorage)),
			partialize: (state): PersistedTaskDiffReviewState => ({
				selectedFileByTask: state.selectedFileByTask,
				presentationByTask: removeFullscreenPresentations(state.presentationByTask),
				preferredPlacement: state.preferredPlacement,
			}),
			migrate: migrateTaskDiffReviewState,
			merge: (persistedState, currentState) => {
				const persisted = persistedState as Partial<PersistedTaskDiffReviewState>
				return {
					...currentState,
					...persisted,
					presentationByTask: removeFullscreenPresentations(persisted.presentationByTask),
				}
			},
		},
	),
)

/** True while the fullscreen review dialog covers the page; see `fullscreenDialogOpen`. */
export const useDiffFullscreenDialogOpen = () => useTaskDiffReviewStore((state) => state.fullscreenDialogOpen)
