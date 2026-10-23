import { Layer } from 'effect'

import { copyConfiguredWorkspaceFiles } from './copy-configured-files'
import { createOrAdoptWorkspaceWorktree } from './create-or-adopt-worktree'
import { preflightWorkspaceRepository } from './preflight-repository'
import { runWorkspaceSetupCommand } from './run-setup-command'
import { WorkspaceSetupExecutor } from './workspace-setup-executor.service'

export const WorkspaceSetupExecutorLive = Layer.succeed(
	WorkspaceSetupExecutor,
	WorkspaceSetupExecutor.of({
		preflightRepo: preflightWorkspaceRepository,
		createOrAdoptWorktree: createOrAdoptWorkspaceWorktree,
		copyConfiguredFiles: copyConfiguredWorkspaceFiles,
		runSetupCommand: runWorkspaceSetupCommand,
	}),
)
