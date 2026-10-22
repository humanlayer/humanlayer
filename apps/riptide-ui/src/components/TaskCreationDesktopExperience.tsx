import type { CreatedWithExperimentFlags } from '@humanlayer/riptide-api-contract/api/tasks/experiment-flags'
import type { ResolvedTaskWorkflowType } from '@humanlayer/schemas/effect/taskconfiguration'

import { LauncherV3RouteWired } from '@/components/launcher-v3/LauncherV3RouteWired'
import type { ExistingTaskDraft } from '@/components/NewTaskFormV2'

export interface TaskCreationDesktopExperienceProps {
	createdWithExperimentFlags: CreatedWithExperimentFlags
	name?: string
	slug?: string
	prompt?: string
	model?: string
	permissionsMode?: 'default' | 'accept_edits' | 'auto' | 'bypass'
	initialWorkflow?: ResolvedTaskWorkflowType
	showWorkflow?: boolean
	initialProjectId?: string
	draftId?: string
	existingDraft?: ExistingTaskDraft
}

export function TaskCreationDesktopExperience({
	createdWithExperimentFlags,
	name,
	slug,
	prompt,
	model,
	permissionsMode,
	initialWorkflow,
	showWorkflow,
	initialProjectId,
	draftId,
	existingDraft,
}: TaskCreationDesktopExperienceProps) {
	return (
		<LauncherV3RouteWired
			initial={{
				name,
				slug,
				prompt,
				model,
				permissionsMode,
				workflow: initialWorkflow,
				showWorkflow,
				projectId: initialProjectId,
			}}
			draftId={draftId}
			existingDraft={existingDraft}
			createdWithExperimentFlags={createdWithExperimentFlags}
		/>
	)
}
