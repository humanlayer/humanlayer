import type { WorkspaceSetupState, WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'

const STAGE_ORDER = ['setup_requested', 'preflight', 'worktree', 'copy_globs', 'setup_command', 'done'] as const
const WORKTREE_STAGE_INDEX = STAGE_ORDER.indexOf('worktree')

type WorkspaceSetupStage = (typeof STAGE_ORDER)[number]

export interface WorkspaceSetupProgressSummary {
	readonly totalRepos: number
	readonly completedRepos: number
	readonly acceptedSkipCount: number
	readonly currentStage: WorkspaceSetupStage
	readonly stageCounts: Readonly<Record<WorkspaceSetupStage, number>>
}

export function repoHasCompletedWorkspaceSetup(repo: WorkspaceSetupState['repos'][number]): boolean {
	return repo.status === 'done'
}

export function workspaceSetupForTaskOnHostHasCompleted(state: WorkspaceSetupState): boolean {
	return state.repos.every(repoHasCompletedWorkspaceSetup)
}

export function workspaceSetupStateAllowsSessionLaunch(
	state: WorkspaceSetupState,
	spec: Pick<WorkspaceSpec, 'setupBlocksFirstSession'> | null | undefined,
): boolean {
	if (spec?.setupBlocksFirstSession) {
		return workspaceSetupForTaskOnHostHasCompleted(state)
	}

	return state.repos.every((repo) => STAGE_ORDER.indexOf(repo.status) > WORKTREE_STAGE_INDEX)
}

export function calculateWorkspaceSetupElapsedTime(state: WorkspaceSetupState, now = Date.now()): number | null {
	if (state.startedAt === undefined) return null
	return Math.max(0, (state.finishedAt ?? now) - state.startedAt)
}

export function summarizeWorkspaceSetupProgressForDisplay(state: WorkspaceSetupState): WorkspaceSetupProgressSummary {
	const stageCounts: Record<WorkspaceSetupStage, number> = {
		setup_requested: 0,
		preflight: 0,
		worktree: 0,
		copy_globs: 0,
		setup_command: 0,
		done: 0,
	}

	for (const repo of state.repos) {
		stageCounts[repo.status] += 1
	}

	const currentStage = STAGE_ORDER.find((stage) => stageCounts[stage] > 0 && stage !== 'done') ?? ('done' as const)

	return {
		totalRepos: state.repos.length,
		completedRepos: stageCounts.done,
		acceptedSkipCount: state.acceptedSkips?.length ?? 0,
		currentStage,
		stageCounts,
	}
}
