import type {
	RepoWorkspaceSetupProgress,
	WorkspaceSetupError,
	WorkspaceSetupStage,
	WorkspaceSetupState,
	WorkspaceSpec,
	WorkspaceState,
} from '@humanlayer/schemas/effect/workspace'
import type { Effect } from 'effect'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type {
	WorkspaceSetupCreateError,
	WorkspaceSetupDaemonUpdateError,
	WorkspaceSetupMutationError,
} from './workspace-setup.errors'

export type WorkspaceSetupRow = {
	readonly id: string
	readonly organizationId: string
	readonly taskId: string
	readonly hostId: string
	readonly status: WorkspaceSetupStage
	readonly state: WorkspaceSetupState
	readonly error: WorkspaceSetupError | null
	readonly createdAt: bigint
	readonly updatedAt: bigint
}

export type CreateSetupRowForTaskSessionInput = {
	readonly organizationId: string
	readonly taskId: string
	readonly hostId: string
	readonly workspaceSpec: WorkspaceSpec | null
	readonly finishedState?: WorkspaceSetupState
}

export type ApplyWorkspaceSetupIntentInput = {
	readonly organizationId: string
	readonly taskId: string
	readonly hostId: string
	readonly localPath: string
	readonly stage: WorkspaceSetupStage
}

export type ApplyWorkspaceSetupSkipIntentInput = ApplyWorkspaceSetupIntentInput & {
	readonly userId: string
}

export type ReplaceWorkspaceSetupRepositoryDirectoryInput = {
	readonly organizationId: string
	readonly taskId: string
	readonly hostId: string
	readonly resolvedWorkspaceSpec: WorkspaceSpec
	readonly expectedUpdatedAt: bigint
}

export type ApplyDaemonWorkspaceSetupProgressInput = {
	readonly organizationId: string
	readonly authenticatedHostId: string
	readonly rowId: string
	readonly taskId: string
	readonly repo?: RepoWorkspaceSetupProgress
	readonly workspaceState?: WorkspaceState
	readonly error?: WorkspaceSetupError | null
}

export type WorkspaceSetupMutationResult = {
	readonly transactionId: string
	readonly row: WorkspaceSetupRow
}

export type WorkspaceSetupServiceShape = {
	readonly createSetupRowForTaskSession: (
		input: CreateSetupRowForTaskSessionInput,
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupCreateError>
	readonly applyRetryIntent: (
		input: ApplyWorkspaceSetupIntentInput,
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupMutationError>
	readonly applySkipIntent: (
		input: ApplyWorkspaceSetupSkipIntentInput,
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupMutationError>
	readonly replaceRepositoryDirectory: (
		input: ReplaceWorkspaceSetupRepositoryDirectoryInput,
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupMutationError>
	readonly applyDaemonProgressUpdate: (
		input: ApplyDaemonWorkspaceSetupProgressInput,
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupDaemonUpdateError, PostgresDb>
}
