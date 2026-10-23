import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// V2 axis types (mirrored from NewTaskFormV2Pure to avoid circular imports)
type V2IssueSource = 'inline' | 'linear' | 'jira' | 'github'
type V2Workflow = 'rpi' | 'outline_only' | 'prd_tdd' | 'oneshot' | 'freeform'
// 'now' is included in the type for completeness but the wired form will not persist
// 'now' as a global default since it requires workspace config.
type V2WorkspaceTiming = 'now' | 'later' | 'never'

interface TaskSettingsState {
	// Draft launcher preferences (legacy V1 form)
	taskMode: 'structured' | 'linear' | 'jira' | 'freeform'

	// Auto-advance preferences
	autoAdvanceResearchToDesign: boolean
	autoAdvanceStructureOutlineToPR: boolean // RPI: full pipeline (plan→wt→impl→PR)
	autoAdvanceImplementationToPR: boolean // Oneshot: just impl→PR

	// V2 axis defaults (persisted globally; per-directory preferences handled by task-workspace-preferences)
	v2IssueSource: V2IssueSource
	v2Workflow: V2Workflow
	v2WorkspaceTiming: V2WorkspaceTiming
	sendArtifactUpdatesToSlack: boolean

	// Actions (legacy)
	setTaskMode: (value: TaskSettingsState['taskMode']) => void
	setAutoAdvanceResearchToDesign: (value: boolean) => void
	setAutoAdvanceStructureOutlineToPR: (value: boolean) => void
	setAutoAdvanceImplementationToPR: (value: boolean) => void

	// Actions (V2)
	setV2IssueSource: (value: V2IssueSource) => void
	setV2Workflow: (value: V2Workflow) => void
	setV2WorkspaceTiming: (value: V2WorkspaceTiming) => void
	setSendArtifactUpdatesToSlack: (value: boolean) => void
}

export const useTaskSettingsStore = create<TaskSettingsState>()(
	persist(
		(set) => ({
			// Default task creation mode (legacy)
			taskMode: 'structured',

			// Auto-advance defaults
			autoAdvanceResearchToDesign: true,
			autoAdvanceStructureOutlineToPR: false, // RPI: full pipeline off by default
			autoAdvanceImplementationToPR: true, // Oneshot: impl→PR on by default

			// V2 axis defaults
			v2IssueSource: 'inline',
			// 'outline_only' is the value behind the "RPI" button (normalizeSelectableWorkflow maps 'rpi' -> 'outline_only')
			v2Workflow: 'outline_only',
			v2WorkspaceTiming: 'later',
			sendArtifactUpdatesToSlack: true,

			// Legacy actions
			setTaskMode: (value) => set({ taskMode: value }),
			setAutoAdvanceResearchToDesign: (value) => set({ autoAdvanceResearchToDesign: value }),
			setAutoAdvanceStructureOutlineToPR: (value) => set({ autoAdvanceStructureOutlineToPR: value }),
			setAutoAdvanceImplementationToPR: (value) => set({ autoAdvanceImplementationToPR: value }),

			// V2 actions
			setV2IssueSource: (value) => set({ v2IssueSource: value }),
			setV2Workflow: (value) => set({ v2Workflow: value }),
			setV2WorkspaceTiming: (value) => set({ v2WorkspaceTiming: value }),
			setSendArtifactUpdatesToSlack: (value) => set({ sendArtifactUpdatesToSlack: value }),
		}),
		{
			name: 'riptide-task-settings',
			partialize: (state) => ({
				taskMode: state.taskMode,
				autoAdvanceResearchToDesign: state.autoAdvanceResearchToDesign,
				autoAdvanceStructureOutlineToPR: state.autoAdvanceStructureOutlineToPR,
				autoAdvanceImplementationToPR: state.autoAdvanceImplementationToPR,
				v2IssueSource: state.v2IssueSource,
				v2Workflow: state.v2Workflow,
				v2WorkspaceTiming: state.v2WorkspaceTiming,
				sendArtifactUpdatesToSlack: state.sendArtifactUpdatesToSlack,
			}),
		},
	),
)
