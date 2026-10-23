import { Context, Effect, FileSystem, Path } from 'effect'
import { ChildProcessSpawner } from 'effect/process'

import { WorkspacePathResolver } from '../workspace-path-resolver/workspace-path-resolver.service'
import type {
	WorkspaceCopyError,
	WorkspacePreflightError,
	WorkspaceSetupCommandError,
	WorkspaceWorktreeError,
} from './workspace-setup-executor.errors'
import type {
	WorkspaceCopyFacts,
	WorkspacePreflightFacts,
	WorkspaceRepoOperationInput,
	WorkspaceSetupCommandFacts,
	WorkspaceWorktreeFacts,
	WorkspaceWorktreeOperationInput,
} from './workspace-setup-executor.types'

export type WorkspaceSetupExecutorRequirements =
	| ChildProcessSpawner.ChildProcessSpawner
	| FileSystem.FileSystem
	| Path.Path
	| WorkspacePathResolver

export interface WorkspaceSetupExecutorService {
	readonly preflightRepo: (
		input: WorkspaceRepoOperationInput,
	) => Effect.Effect<WorkspacePreflightFacts, WorkspacePreflightError, WorkspaceSetupExecutorRequirements>
	readonly createOrAdoptWorktree: (
		input: WorkspaceWorktreeOperationInput,
	) => Effect.Effect<WorkspaceWorktreeFacts, WorkspaceWorktreeError, WorkspaceSetupExecutorRequirements>
	readonly copyConfiguredFiles: (
		input: WorkspaceRepoOperationInput,
	) => Effect.Effect<WorkspaceCopyFacts, WorkspaceCopyError, WorkspaceSetupExecutorRequirements>
	readonly runSetupCommand: (
		input: WorkspaceRepoOperationInput,
	) => Effect.Effect<WorkspaceSetupCommandFacts, WorkspaceSetupCommandError, WorkspaceSetupExecutorRequirements>
}

export class WorkspaceSetupExecutor extends Context.Service<WorkspaceSetupExecutor, WorkspaceSetupExecutorService>()(
	'WorkspaceSetupExecutor',
) {}
