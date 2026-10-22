import type { WorkspaceSetupStage } from '@humanlayer/schemas/effect/workspace'
import { Data } from 'effect'

/** Expected miss when a workspace setup row cannot be found for an authorized task/host. */
export class WorkspaceSetupRowNotFoundError extends Data.TaggedError('WorkspaceSetupRowNotFoundError')<{
	readonly organizationId: string
	readonly taskId: string
	readonly hostId?: string
	readonly rowId?: string
}> {}

/** Expected validation failure for workspace specs accepted at the service boundary. */
export class WorkspaceSetupInvalidSpecError extends Data.TaggedError('WorkspaceSetupInvalidSpecError')<{
	readonly taskId: string
	readonly hostId: string
	readonly cause?: unknown
}> {}

/** Expected validation failure for persisted or inbound workspace setup state JSON. */
export class WorkspaceSetupInvalidStateError extends Data.TaggedError('WorkspaceSetupInvalidStateError')<{
	readonly taskId: string
	readonly hostId: string
	readonly rowId?: string
	readonly schemaName: 'workspace_setup_state' | 'workspace_setup_error' | 'workspace_setup_row' | 'workspace_spec'
	readonly reason: string
	readonly cause?: unknown
}> {}

/** Expected rejection when a finished setup state is inconsistent with its spec. */
export class WorkspaceSetupFinishedStateInvalidError extends Data.TaggedError(
	'WorkspaceSetupFinishedStateInvalidError',
)<{
	readonly taskId: string
	readonly hostId: string
	readonly reason: string
}> {}

/** Expected rejection when an intent references state that is no longer current. */
export class WorkspaceSetupStaleIntentError extends Data.TaggedError('WorkspaceSetupStaleIntentError')<{
	readonly taskId: string
	readonly hostId: string
	readonly localPath?: string
	readonly stage?: WorkspaceSetupStage
	readonly reason: string
}> {}

/** Expected rejection when a retry no longer matches the persisted setup error. */
export class WorkspaceSetupRetryConflictError extends Data.TaggedError('WorkspaceSetupRetryConflictError')<{
	readonly taskId: string
	readonly hostId: string
	readonly localPath: string
	readonly stage: WorkspaceSetupStage
}> {}

/** Expected rejection when a user tries to skip a stage that must not be skipped. */
export class WorkspaceSetupSkipNotAllowedError extends Data.TaggedError('WorkspaceSetupSkipNotAllowedError')<{
	readonly taskId: string
	readonly hostId: string
	readonly localPath: string
	readonly stage: WorkspaceSetupStage
}> {}

/** Actionable persistence failure from the workspace setup repository boundary. */
export class WorkspaceSetupPersistenceError extends Data.TaggedError('WorkspaceSetupPersistenceError')<{
	readonly operation: string
	readonly organizationId: string
	readonly taskId: string
	readonly hostId?: string
	readonly rowId?: string
	readonly cause: unknown
}> {}

/** Public error for setup rows that are unavailable to the caller. */
export class WorkspaceSetupNotFoundError extends Data.TaggedError('WorkspaceSetupNotFoundError')<{
	readonly taskId: string
	readonly hostId?: string
	readonly rowId?: string
}> {}

/** Public rejection that includes the stable reason needed by the UI. */
export class WorkspaceSetupIntentRejectedError extends Data.TaggedError('WorkspaceSetupIntentRejectedError')<{
	readonly taskId: string
	readonly hostId: string
	readonly localPath?: string
	readonly stage?: WorkspaceSetupStage
	readonly reason: 'invalid_state' | 'retry_conflict' | 'skip_not_allowed' | 'stale_intent'
}> {}

/** Public retryable/non-retryable service unavailability outcome. */
export class WorkspaceSetupUnavailableError extends Data.TaggedError('WorkspaceSetupUnavailableError')<{
	readonly taskId: string
	readonly retryable: boolean
}> {}

export type WorkspaceSetupInternalError =
	| WorkspaceSetupRowNotFoundError
	| WorkspaceSetupInvalidSpecError
	| WorkspaceSetupInvalidStateError
	| WorkspaceSetupFinishedStateInvalidError
	| WorkspaceSetupStaleIntentError
	| WorkspaceSetupRetryConflictError
	| WorkspaceSetupSkipNotAllowedError
	| WorkspaceSetupPersistenceError

export type WorkspaceSetupMutationError =
	| WorkspaceSetupNotFoundError
	| WorkspaceSetupIntentRejectedError
	| WorkspaceSetupUnavailableError

export type WorkspaceSetupDaemonUpdateError =
	| WorkspaceSetupNotFoundError
	| WorkspaceSetupIntentRejectedError
	| WorkspaceSetupUnavailableError

export type WorkspaceSetupCreateError = WorkspaceSetupIntentRejectedError | WorkspaceSetupUnavailableError
