import { create } from 'zustand'

export type ArtifactSharingDialogSource =
	| 'artifact-list'
	| 'artifact-sidebar'
	| 'artifact-fullscreen'
	| 'legacy-viewer'
	| 'onboarding'
	| 'conversation'

export interface ArtifactSharingDialogTarget {
	artifactId: string
	source: ArtifactSharingDialogSource
}

interface ArtifactSharingDialogState {
	target: ArtifactSharingDialogTarget | null
	open: boolean
	openDialog: (target: ArtifactSharingDialogTarget) => void
	setOpen: (open: boolean) => void
}

export const useArtifactSharingDialogStore = create<ArtifactSharingDialogState>((set) => ({
	target: null,
	open: false,
	openDialog: (target) => set({ target, open: true }),
	setOpen: (open) => set({ open }),
}))
