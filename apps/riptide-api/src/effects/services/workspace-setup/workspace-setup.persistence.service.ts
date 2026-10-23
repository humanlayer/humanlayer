import { Context, type Effect } from 'effect'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type {
	WorkspaceSetupFinishedStateInvalidError,
	WorkspaceSetupInvalidStateError,
	WorkspaceSetupPersistenceError,
	WorkspaceSetupRetryConflictError,
	WorkspaceSetupRowNotFoundError,
	WorkspaceSetupSkipNotAllowedError,
	WorkspaceSetupStaleIntentError,
} from './workspace-setup.errors'
import type {
	ApplyDaemonWorkspaceSetupProgressInput,
	ApplyWorkspaceSetupIntentInput,
	ApplyWorkspaceSetupSkipIntentInput,
	CreateSetupRowForTaskSessionInput,
	ReplaceWorkspaceSetupRepositoryDirectoryInput,
	WorkspaceSetupMutationResult,
} from './workspace-setup.types'

type WorkspaceSetupPersistenceCreateError =
	| WorkspaceSetupFinishedStateInvalidError
	| WorkspaceSetupInvalidStateError
	| WorkspaceSetupPersistenceError
	| WorkspaceSetupRowNotFoundError

type WorkspaceSetupPersistenceIntentError =
	| WorkspaceSetupInvalidStateError
	| WorkspaceSetupPersistenceError
	| WorkspaceSetupRetryConflictError
	| WorkspaceSetupRowNotFoundError
	| WorkspaceSetupSkipNotAllowedError
	| WorkspaceSetupStaleIntentError

type WorkspaceSetupPersistenceDaemonUpdateError =
	| WorkspaceSetupInvalidStateError
	| WorkspaceSetupPersistenceError
	| WorkspaceSetupRowNotFoundError
	| WorkspaceSetupStaleIntentError

type WorkspaceSetupPersistenceShape = {
	readonly createSetupRowForTaskSession: (
		input: CreateSetupRowForTaskSessionInput & { readonly now: number },
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupPersistenceCreateError>
	readonly applyRetryIntent: (
		input: ApplyWorkspaceSetupIntentInput,
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupPersistenceIntentError>
	readonly applySkipIntent: (
		input: ApplyWorkspaceSetupSkipIntentInput & { readonly now: number },
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupPersistenceIntentError>
	readonly replaceRepositoryDirectory: (
		input: ReplaceWorkspaceSetupRepositoryDirectoryInput & { readonly now: number },
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupPersistenceIntentError>
	readonly applyDaemonProgressUpdate: (
		input: ApplyDaemonWorkspaceSetupProgressInput,
	) => Effect.Effect<WorkspaceSetupMutationResult, WorkspaceSetupPersistenceDaemonUpdateError, PostgresDb>
}

/** DB adapter for task-host workspace setup rows. */
export class WorkspaceSetupPersistence extends Context.Service<
	WorkspaceSetupPersistence,
	WorkspaceSetupPersistenceShape
>()('WorkspaceSetupPersistence') {}
