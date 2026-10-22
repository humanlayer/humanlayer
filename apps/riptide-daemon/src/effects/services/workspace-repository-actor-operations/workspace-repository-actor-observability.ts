import * as Sentry from '@sentry/node'
import { Cause, Effect, Option } from 'effect'
import * as Schema from 'effect/Schema'

import { WorkspaceRepositoryLocalOperationError } from './workspace-repository-local-operation-error'

interface WorkspaceRepositoryOperationContext {
	readonly workspaceId: string
	readonly repositoryIdentity: string
	readonly stage: string
}

const annotations = (context: WorkspaceRepositoryOperationContext) => ({
	workspace_id: context.workspaceId,
	repository_identity: context.repositoryIdentity,
	workspace_repository_stage: context.stage,
})

const WorkspaceRepositoryLocalOperationErrorShape = Schema.TaggedStruct('WorkspaceRepositoryLocalOperationError', {
	message: Schema.String,
	command: Schema.optionalKey(Schema.String),
	exitCode: Schema.optionalKey(Schema.Int),
	stderr: Schema.optionalKey(Schema.String),
	stdoutLogPath: Schema.optionalKey(Schema.String),
	stderrLogPath: Schema.optionalKey(Schema.String),
})

export const decodeWorkspaceRepositoryLocalOperationError = (
	error: unknown,
): WorkspaceRepositoryLocalOperationError | undefined => {
	const decoded = Option.getOrUndefined(
		Schema.decodeUnknownOption(WorkspaceRepositoryLocalOperationErrorShape)(error),
	)
	return decoded === undefined ? undefined : new WorkspaceRepositoryLocalOperationError(decoded)
}

const logExpectedWorkspaceRepositoryOperationFailure = (
	error: WorkspaceRepositoryLocalOperationError,
	context: WorkspaceRepositoryOperationContext,
) =>
	Effect.logError('Workspace repository stage failed').pipe(
		Effect.annotateLogs({
			...annotations(context),
			failure_message: error.message,
			exit_code: error.exitCode,
			stdout_log_path: error.stdoutLogPath,
			stderr_log_path: error.stderrLogPath,
		}),
	)

const reportWorkspaceRepositoryOperationError = (error: unknown, context: WorkspaceRepositoryOperationContext) =>
	Effect.logError('Workspace repository operation failed', error).pipe(
		Effect.annotateLogs(annotations(context)),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { error_type: 'workspace_repository_operation', ...annotations(context) },
				}),
			),
		),
	)

export const observeWorkspaceRepositoryStageFailures =
	(context: WorkspaceRepositoryOperationContext) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		effect.pipe(
			Effect.tapError((error) => {
				const localError = decodeWorkspaceRepositoryLocalOperationError(error)
				return localError === undefined
					? reportWorkspaceRepositoryOperationError(error, context)
					: logExpectedWorkspaceRepositoryOperationFailure(localError, context)
			}),
		)

export const observeUnexpectedWorkspaceRepositoryCauses =
	(context: WorkspaceRepositoryOperationContext) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		effect.pipe(
			Effect.tapCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.void
					: reportWorkspaceRepositoryOperationError(Cause.squash(cause), context),
			),
		)
