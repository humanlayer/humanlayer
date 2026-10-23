import { getPrimaryTargetDirectory } from '@humanlayer/db/utils/repository-directory'
import type { WorkspaceSetupState, WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'

import { deriveWorkspacePrimaryLaunchDirectory } from '@/lib/workspace-launch'

export interface ResolveDraftWorkingDirectoryInputs {
	existingDraft: { working_directory?: string | null } | null | undefined
	workingDirectoryParam: string | undefined
	userTaskSettings: { working_directory?: string | null; workspace_base_directory?: string | null } | null | undefined
	task:
		| {
				resource_owner_user_id?: string | null
				default_working_directory?: string | null
				worktree_timing?: string | null
				workspace_spec: WorkspaceSpec | null
				workspace_state: WorkspaceState | null
		  }
		| null
		| undefined
	userId: string | undefined
	defaultDirectory: string
	workspaceSetupState: WorkspaceSetupState | null
	/** Local $HOME when known (Tauri); expands the workspace snapshot's `~` base at priority 5 */
	homeDirectory: string | null
}

/**
 * Keeps a user's form selection authoritative while retaining the planned workspace
 * directory as a fallback before the form has been initialized.
 */
export function resolveEffectiveDraftWorkingDirectory(
	selectedWorkingDirectory: string | null | undefined,
	plannedWorkspaceDirectory: string | null | undefined,
): string {
	return selectedWorkingDirectory || plannedWorkspaceDirectory || ''
}

/**
 * Resolution priority (highest → lowest):
 * 1. Existing draft's working_directory (editing a draft)
 * 2. Explicit ?workingDirectory= query param
 * 3. Planned primary worktree for an unresolved worktree-now task
 * 4. Current user's task_user_settings.working_directory
 * 5. Task's default_working_directory — owner only
 * 6. Multi-repo workspace primary repo dir — derived from workspace_spec plus
 *    the current host setup row, with workspace_state as a legacy fallback.
 * 7. Local settingsStore.defaultDirectory
 *
 * Inputs at priority 4/6 must be the CURRENT USER's row only (caller responsibility).
 */
export function resolveDraftWorkingDirectory(inputs: ResolveDraftWorkingDirectoryInputs): string {
	const { existingDraft, workingDirectoryParam, userTaskSettings, task, userId, defaultDirectory, homeDirectory } =
		inputs
	const plannedWorkspaceDirectory =
		task?.worktree_timing === 'now' && task.workspace_spec && inputs.workspaceSetupState === null
			? getPrimaryTargetDirectory(task.workspace_spec)
			: undefined
	return (
		existingDraft?.working_directory ??
		workingDirectoryParam ??
		plannedWorkspaceDirectory ??
		userTaskSettings?.working_directory ??
		(task?.resource_owner_user_id === userId ? task?.default_working_directory : undefined) ??
		deriveWorkspacePrimaryLaunchDirectory({
			workspaceView: null,
			workspaceSpec: task ? task.workspace_spec : null,
			workspaceSetupState: inputs.workspaceSetupState,
			workspaceState: task ? task.workspace_state : null,
			userWorkspaceBaseDirectory: userTaskSettings?.workspace_base_directory ?? null,
			homeDirectory,
		}) ??
		defaultDirectory
	)
}
