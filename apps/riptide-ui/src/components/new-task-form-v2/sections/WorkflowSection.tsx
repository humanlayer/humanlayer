/**
 * WorkflowSection.tsx
 *
 * Section component for workflow selection (outline_only/prd_tdd/oneshot/freeform).
 * Subscribes to form and store state directly using Zustand selectors.
 *
 * Internalizes:
 * - Auto-advance state and setters from taskSettingsStore
 * - Global workflow/timing preference setters from taskSettingsStore
 */

import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useWatch } from 'react-hook-form'

import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useTaskSettingsStore } from '@/hooks/stores/taskSettingsStore'

import {
	AxisSelector,
	normalizeSelectableWorkflow,
	WORKFLOW_OPTIONS,
	type Workflow,
	type WorkspaceTiming,
} from './shared'
import { workflowCreatesImplementationArtifact, workflowUsesRpiArtifactPipeline } from './workflow-artifacts'

export interface WorkflowSectionProps {
	// Axis preferences persistence (needs parent context for hostId/directory)
	persistAxisPreferences: (partial: { workflow?: Workflow; workspaceTiming?: WorkspaceTiming }) => void
}

export const WorkflowSection: FC<WorkflowSectionProps> = ({ persistAxisPreferences }) => {
	const form = useNewTaskFormStore((s) => s.form)
	const submitState = useNewTaskFormStore((s) => s.submitState)

	// Global preference setters from taskSettingsStore
	const setV2Workflow = useTaskSettingsStore((s) => s.setV2Workflow)
	const setV2WorkspaceTiming = useTaskSettingsStore((s) => s.setV2WorkspaceTiming)

	// Auto-advance state from taskSettingsStore
	const autoAdvanceQuestionsToResearch = useTaskSettingsStore((s) => s.autoAdvanceResearchToDesign)
	const autoAdvanceStructureOutlineToPR = useTaskSettingsStore((s) => s.autoAdvanceStructureOutlineToPR)
	const autoAdvanceImplementationToPR = useTaskSettingsStore((s) => s.autoAdvanceImplementationToPR)
	const setAutoAdvanceQuestionsToResearch = useTaskSettingsStore((s) => s.setAutoAdvanceResearchToDesign)
	const setAutoAdvanceStructureOutlineToPR = useTaskSettingsStore((s) => s.setAutoAdvanceStructureOutlineToPR)
	const setAutoAdvanceImplementationToPR = useTaskSettingsStore((s) => s.setAutoAdvanceImplementationToPR)

	// Remembered new-task default for the owner's per-task Slack artifact notifications. Persisted in the
	// store so the switch keeps the user's last choice; the submit path writes the inverse to the row's
	// `slack_notifications_muted` (positive UI copy over a muted boolean).
	const sendArtifactUpdatesToSlack = useTaskSettingsStore((s) => s.sendArtifactUpdatesToSlack)
	const setSendArtifactUpdatesToSlack = useTaskSettingsStore((s) => s.setSendArtifactUpdatesToSlack)

	const workflow = useWatch({ control: form?.control, name: 'workflow' }) as Workflow | undefined

	const isSubmitting = submitState.isSubmitting

	const handleWorkflowChange = useCallback(
		(value: Workflow) => {
			if (!form) return

			form.setValue('workflow', value)
			setV2Workflow(value)

			// For oneshot workflow w/ worktree timing 'later', update to 'never'
			let workspaceTiming = form.getValues('workspaceTiming') as WorkspaceTiming
			const shouldForceWorkspaceTimingToNever = value === 'oneshot' && workspaceTiming !== 'now'

			if (shouldForceWorkspaceTimingToNever) {
				workspaceTiming = 'never'
				form.setValue('workspaceTiming', 'never')
				setV2WorkspaceTiming('never')
			}

			persistAxisPreferences({ workflow: value, workspaceTiming })
		},
		[form, setV2Workflow, setV2WorkspaceTiming, persistAxisPreferences],
	)

	if (!form) return null

	const showRpiAutoAdvanceControls = workflowUsesRpiArtifactPipeline(workflow)
	const showOneshotAutoAdvanceControls = workflowCreatesImplementationArtifact(workflow)
	const showSlackArtifactNotificationPreference = workflowUsesRpiArtifactPipeline(workflow)

	return (
		<>
			{/* Workflow axis */}
			<AxisSelector
				label="Workflow"
				options={WORKFLOW_OPTIONS}
				selected={normalizeSelectableWorkflow(workflow ?? 'freeform')}
				onSelect={handleWorkflowChange}
				disabled={isSubmitting}
				layout="grid-2-2"
			/>

			{/* Auto-advance toggles - RPI workflows */}
			{showRpiAutoAdvanceControls && (
				<div className="space-y-3">
					<div className="flex items-center gap-3">
						<Switch
							id="v2-auto-advance"
							checked={autoAdvanceQuestionsToResearch}
							onCheckedChange={setAutoAdvanceQuestionsToResearch}
							disabled={isSubmitting}
						/>
						<Label htmlFor="v2-auto-advance" className="text-sm font-medium leading-none">
							Auto-advance questions {'->'} research {'->'} design
						</Label>
					</div>
					{workflow === 'rpi' && (
						<div className="flex items-center gap-3">
							<Switch
								id="v2-auto-advance-structure-outline"
								checked={autoAdvanceStructureOutlineToPR}
								onCheckedChange={setAutoAdvanceStructureOutlineToPR}
								disabled={isSubmitting}
							/>
							<Label
								htmlFor="v2-auto-advance-structure-outline"
								className="text-sm font-medium leading-none"
							>
								Auto-advance plan {'->'} worktree {'->'} implementation {'->'} PR
							</Label>
						</div>
					)}
				</div>
			)}

			{/* Auto-advance toggle - Oneshot workflow */}
			{showOneshotAutoAdvanceControls && (
				<div className="space-y-3">
					<div className="flex items-center gap-3">
						<Switch
							id="v2-auto-advance-impl-to-pr"
							checked={autoAdvanceImplementationToPR}
							onCheckedChange={setAutoAdvanceImplementationToPR}
							disabled={isSubmitting}
						/>
						<Label htmlFor="v2-auto-advance-impl-to-pr" className="text-sm font-medium leading-none">
							Open a PR when implementation complete
						</Label>
					</div>
				</div>
			)}

			{/* Slack artifact notifications are only configurable for RPI-style artifact pipelines. */}
			{showSlackArtifactNotificationPreference && (
				<div className="flex items-center gap-3">
					<Switch
						id="v2-send-artifact-updates-to-slack"
						checked={sendArtifactUpdatesToSlack}
						onCheckedChange={setSendArtifactUpdatesToSlack}
						disabled={isSubmitting}
					/>
					<Label htmlFor="v2-send-artifact-updates-to-slack" className="text-sm font-medium leading-none">
						Send new artifacts and comments to Slack
					</Label>
				</div>
			)}
		</>
	)
}
