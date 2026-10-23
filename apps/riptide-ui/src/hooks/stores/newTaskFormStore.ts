import type { UseFormReturn } from 'react-hook-form'
import { create } from 'zustand'

import type { NewTaskFormV2Input } from '@/components/NewTaskFormV2'
import type { OperationStatus } from '@/components/OperationStatusRow'

/**
 * Represents a single operation in the submit pipeline.
 */
export interface ResolutionHint {
	text: string
	url: string
	anchorText: string
}

export interface SubmitOperation {
	id: string
	name: string
	status: OperationStatus
	errorMessage?: string
	resolutionHint?: ResolutionHint
	command?: string
	scope?: 'task' | 'session' | 'workspace'
}

/**
 * State for the multi-step submit pipeline.
 */
export type SubmitState = {
	isSubmitting: boolean
	operations: SubmitOperation[]
	createdTaskId: string | null
}

/**
 * Actions for the submit pipeline reducer pattern.
 * Kept for backward compatibility with helper functions that expect a dispatch pattern.
 */
export type SubmitAction =
	| { type: 'START_SUBMIT' }
	| { type: 'SET_OPERATIONS'; operations: SubmitOperation[] }
	| { type: 'APPEND_OPERATIONS'; operations: SubmitOperation[] }
	| { type: 'UPDATE_OP'; id: string; updates: Partial<SubmitOperation> }
	| { type: 'SET_CREATED_TASK_ID'; taskId: string }
	| { type: 'FINISH_SUBMIT' }
	| { type: 'ABORT_SUBMIT' }

const submitInitialState: SubmitState = {
	isSubmitting: false,
	operations: [],
	createdTaskId: null,
}

interface NewTaskFormStore {
	// Form instance (set on mount, null on unmount)
	form: UseFormReturn<NewTaskFormV2Input> | null
	setForm: (form: UseFormReturn<NewTaskFormV2Input> | null) => void

	// Host selection
	userSelectedHostId: string
	setUserSelectedHostId: (id: string) => void

	// UI state
	showLargeWorkspaceConfirm: boolean
	setShowLargeWorkspaceConfirm: (show: boolean) => void
	launchModalOpen: boolean
	setLaunchModalOpen: (open: boolean) => void
	saveDraftDialogOpen: boolean
	setSaveDraftDialogOpen: (open: boolean) => void
	slugManuallyEdited: boolean
	setSlugManuallyEdited: (edited: boolean) => void
	nameManuallyEdited: boolean
	setNameManuallyEdited: (edited: boolean) => void

	// Workspace config state
	/**
	 * Per-task primary-repo override, scoped to the directory it was chosen for.
	 * Reads resolve to null when the selected directory differs, so the override
	 * resets implicitly when the directory changes. null = use config-marked primary.
	 */
	primaryRepoOverride: { directory: string; localPath: string } | null
	setPrimaryRepoOverride: (directory: string, localPath: string) => void

	// Submit pipeline state
	submitState: SubmitState
	startSubmit: () => void
	setOperations: (operations: SubmitOperation[]) => void
	appendOperations: (operations: SubmitOperation[]) => void
	updateOperation: (id: string, updates: Partial<SubmitOperation>) => void
	setCreatedTaskId: (taskId: string) => void
	finishSubmit: () => void
	abortSubmit: () => void

	// Reset all UI state (called on form unmount)
	resetUIState: () => void
}

const initialUIState = {
	showLargeWorkspaceConfirm: false,
	launchModalOpen: false,
	saveDraftDialogOpen: false,
	slugManuallyEdited: false,
	nameManuallyEdited: false,
}

const initialWorkspaceState = {
	primaryRepoOverride: null as { directory: string; localPath: string } | null,
}

export const useNewTaskFormStore = create<NewTaskFormStore>((set) => ({
	form: null,
	setForm: (form) => set({ form }),

	// Host selection
	userSelectedHostId: '',
	setUserSelectedHostId: (id) => set({ userSelectedHostId: id }),

	// UI state
	...initialUIState,
	setShowLargeWorkspaceConfirm: (show) => set({ showLargeWorkspaceConfirm: show }),
	setLaunchModalOpen: (open) => set({ launchModalOpen: open }),
	setSaveDraftDialogOpen: (open) => set({ saveDraftDialogOpen: open }),
	setSlugManuallyEdited: (edited) => set({ slugManuallyEdited: edited }),
	setNameManuallyEdited: (edited) => set({ nameManuallyEdited: edited }),

	// Workspace config state
	...initialWorkspaceState,
	setPrimaryRepoOverride: (directory, localPath) => set({ primaryRepoOverride: { directory, localPath } }),

	// Submit pipeline state
	submitState: submitInitialState,
	startSubmit: () => set({ submitState: { isSubmitting: true, operations: [], createdTaskId: null } }),
	setOperations: (operations) => set((state) => ({ submitState: { ...state.submitState, operations } })),
	appendOperations: (operations) =>
		set((state) => ({
			submitState: { ...state.submitState, operations: [...state.submitState.operations, ...operations] },
		})),
	updateOperation: (id, updates) =>
		set((state) => ({
			submitState: {
				...state.submitState,
				operations: state.submitState.operations.map((op) => (op.id === id ? { ...op, ...updates } : op)),
			},
		})),
	setCreatedTaskId: (taskId) => set((state) => ({ submitState: { ...state.submitState, createdTaskId: taskId } })),
	finishSubmit: () => set({ submitState: submitInitialState }),
	abortSubmit: () => set({ submitState: submitInitialState }),

	resetUIState: () =>
		set({ ...initialUIState, ...initialWorkspaceState, submitState: submitInitialState, userSelectedHostId: '' }),
}))
