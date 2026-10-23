import { Effect } from 'effect'

import {
	WorkspaceSetupFinishedStateInvalidError,
	WorkspaceSetupIntentRejectedError,
	WorkspaceSetupInvalidSpecError,
	WorkspaceSetupInvalidStateError,
	WorkspaceSetupNotFoundError,
	WorkspaceSetupPersistenceError,
	WorkspaceSetupRetryConflictError,
	WorkspaceSetupRowNotFoundError,
	WorkspaceSetupSkipNotAllowedError,
	WorkspaceSetupStaleIntentError,
	WorkspaceSetupUnavailableError,
} from './workspace-setup.errors'

type CreateInternalError =
	| WorkspaceSetupFinishedStateInvalidError
	| WorkspaceSetupInvalidSpecError
	| WorkspaceSetupInvalidStateError
	| WorkspaceSetupPersistenceError
	| WorkspaceSetupRowNotFoundError

type IntentInternalError =
	| WorkspaceSetupInvalidSpecError
	| WorkspaceSetupInvalidStateError
	| WorkspaceSetupPersistenceError
	| WorkspaceSetupRetryConflictError
	| WorkspaceSetupRowNotFoundError
	| WorkspaceSetupSkipNotAllowedError
	| WorkspaceSetupStaleIntentError

type DaemonUpdateInternalError =
	| WorkspaceSetupInvalidStateError
	| WorkspaceSetupPersistenceError
	| WorkspaceSetupRowNotFoundError
	| WorkspaceSetupStaleIntentError

/** Narrows internal setup row creation failures to public, caller-actionable outcomes. */
export const narrowCreateWorkspaceSetupErrors = <A, R>(program: Effect.Effect<A, CreateInternalError, R>) =>
	program.pipe(
		Effect.catchTags({
			WorkspaceSetupFinishedStateInvalidError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						reason: 'invalid_state',
					}),
				),
			WorkspaceSetupInvalidSpecError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						reason: 'invalid_state',
					}),
				),
			WorkspaceSetupInvalidStateError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						reason: 'invalid_state',
					}),
				),
			WorkspaceSetupRowNotFoundError: (error) =>
				Effect.fail(new WorkspaceSetupUnavailableError({ taskId: error.taskId, retryable: true })),
			WorkspaceSetupPersistenceError: (error) =>
				Effect.fail(new WorkspaceSetupUnavailableError({ taskId: error.taskId, retryable: true })),
		}),
	)

/** Narrows user workspace setup intents to public, caller-actionable outcomes. */
export const narrowWorkspaceSetupIntentErrors = <A, R>(program: Effect.Effect<A, IntentInternalError, R>) =>
	program.pipe(
		Effect.catchTags({
			WorkspaceSetupRowNotFoundError: (error) =>
				Effect.fail(
					new WorkspaceSetupNotFoundError({ taskId: error.taskId, hostId: error.hostId, rowId: error.rowId }),
				),
			WorkspaceSetupInvalidStateError: (error) =>
				Effect.fail(new WorkspaceSetupUnavailableError({ taskId: error.taskId, retryable: false })),
			WorkspaceSetupInvalidSpecError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						reason: 'invalid_state',
					}),
				),
			WorkspaceSetupRetryConflictError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						localPath: error.localPath,
						stage: error.stage,
						reason: 'retry_conflict',
					}),
				),
			WorkspaceSetupSkipNotAllowedError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						localPath: error.localPath,
						stage: error.stage,
						reason: 'skip_not_allowed',
					}),
				),
			WorkspaceSetupStaleIntentError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						localPath: error.localPath,
						stage: error.stage,
						reason: 'stale_intent',
					}),
				),
			WorkspaceSetupPersistenceError: (error) =>
				Effect.fail(new WorkspaceSetupUnavailableError({ taskId: error.taskId, retryable: true })),
		}),
	)

/** Narrows daemon progress updates to public, caller-actionable outcomes. */
export const narrowDaemonWorkspaceSetupUpdateErrors = <A, R>(program: Effect.Effect<A, DaemonUpdateInternalError, R>) =>
	program.pipe(
		Effect.catchTags({
			WorkspaceSetupRowNotFoundError: (error) =>
				Effect.fail(
					new WorkspaceSetupNotFoundError({ taskId: error.taskId, hostId: error.hostId, rowId: error.rowId }),
				),
			WorkspaceSetupInvalidStateError: (error) =>
				Effect.fail(new WorkspaceSetupUnavailableError({ taskId: error.taskId, retryable: false })),
			WorkspaceSetupStaleIntentError: (error) =>
				Effect.fail(
					new WorkspaceSetupIntentRejectedError({
						taskId: error.taskId,
						hostId: error.hostId,
						localPath: error.localPath,
						stage: error.stage,
						reason: 'stale_intent',
					}),
				),
			WorkspaceSetupPersistenceError: (error) =>
				Effect.fail(new WorkspaceSetupUnavailableError({ taskId: error.taskId, retryable: true })),
		}),
	)
