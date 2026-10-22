import {
	type WorkspaceSpec,
	WorkspaceSetupErrorSchema,
	WorkspaceSetupStateSchema,
	WorkspaceSpecSchema,
} from '@humanlayer/schemas/effect/workspace'
import { Effect, Predicate } from 'effect'
import * as Schema from 'effect/Schema'

import { Sentry } from '../../instrument'
import {
	InvalidWorkspaceSetupErrorError,
	InvalidWorkspaceSetupStateError,
	InvalidWorkspaceSpecError,
} from './workspace-schema.errors'

type WorkspaceSetupParseContext = {
	readonly taskId?: string
	readonly hostId?: string
	readonly rowId?: string
}

type WorkspaceSchemaParseError =
	| InvalidWorkspaceSpecError
	| InvalidWorkspaceSetupStateError
	| InvalidWorkspaceSetupErrorError

const safeWorkspaceSetupParseAttributes = (context: WorkspaceSetupParseContext): Record<string, string> => {
	const attributes: Record<string, string> = {}
	if (context.taskId !== undefined) attributes.task_id = context.taskId
	if (context.hostId !== undefined) attributes.host_id = context.hostId
	if (context.rowId !== undefined) attributes.row_id = context.rowId
	return attributes
}

const observeWorkspaceSetupParseFailure = (error: WorkspaceSchemaParseError) =>
	Effect.logError(error).pipe(
		Effect.annotateLogs({
			schema_name: error.schemaName,
			...safeWorkspaceSetupParseAttributes(error),
		}),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error.cause, {
					tags: { error_type: error._tag, schema_name: error.schemaName },
					extra: safeWorkspaceSetupParseAttributes(error),
				}),
			),
		),
	)

/** Parse task.workspace_spec into the daemon's Effect-native workspace spec model. */
export const parseWorkspaceSpec = (value: unknown, context: WorkspaceSetupParseContext = {}) =>
	Schema.decodeUnknownEffect(WorkspaceSpecSchema)(value).pipe(
		Effect.mapError(
			(cause) =>
				new InvalidWorkspaceSpecError({
					...context,
					schemaName: 'WorkspaceSpec',
					message: 'Invalid workspace spec payload',
					cause,
				}),
		),
		Effect.tapError(observeWorkspaceSetupParseFailure),
		Effect.withSpan('workspace_setup.parse_spec', {
			attributes: { schema_name: 'WorkspaceSpec', ...safeWorkspaceSetupParseAttributes(context) },
		}),
	)

const applyTaskSourceCommitsToHostWorkspaceSpec = (
	hostWorkspaceSpec: WorkspaceSpec,
	taskWorkspaceSpec: WorkspaceSpec,
): WorkspaceSpec => {
	const sourceCommitByLocalPath = new Map(
		taskWorkspaceSpec.repos.flatMap((repository) =>
			repository.sourceCommit === undefined ? [] : [[repository.localPath, repository.sourceCommit] as const],
		),
	)
	return {
		...hostWorkspaceSpec,
		repos: hostWorkspaceSpec.repos.map((repository) => {
			const sourceCommit = sourceCommitByLocalPath.get(repository.localPath)
			return sourceCommit === undefined ? repository : { ...repository, sourceCommit }
		}),
	}
}

/**
 * Parses the host-specific workspace layout and applies source commits pinned
 * on the task after this host row was created.
 */
export const parseWorkspaceSpecForSetup = (
	input: { readonly resolvedWorkspaceSpec: unknown; readonly taskWorkspaceSpec: unknown },
	context: WorkspaceSetupParseContext = {},
) => {
	if (Predicate.isNullish(input.resolvedWorkspaceSpec)) return parseWorkspaceSpec(input.taskWorkspaceSpec, context)
	if (Predicate.isNullish(input.taskWorkspaceSpec)) return parseWorkspaceSpec(input.resolvedWorkspaceSpec, context)
	return parseWorkspaceSpec(input.resolvedWorkspaceSpec, context).pipe(
		Effect.flatMap((hostWorkspaceSpec) =>
			parseWorkspaceSpec(input.taskWorkspaceSpec, context).pipe(
				Effect.map((taskWorkspaceSpec) =>
					applyTaskSourceCommitsToHostWorkspaceSpec(hostWorkspaceSpec, taskWorkspaceSpec),
				),
				Effect.catchTag('InvalidWorkspaceSpecError', () => Effect.succeed(hostWorkspaceSpec)),
			),
		),
	)
}

/** Parse task_workspace_setup_for_host.workspace_setup_state for daemon workspace reads. */
export const parseWorkspaceSetupState = (value: unknown, context: WorkspaceSetupParseContext = {}) =>
	Schema.decodeUnknownEffect(WorkspaceSetupStateSchema)(value).pipe(
		Effect.mapError(
			(cause) =>
				new InvalidWorkspaceSetupStateError({
					...context,
					schemaName: 'WorkspaceSetupState',
					message: 'Invalid workspace setup state payload',
					cause,
				}),
		),
		Effect.tapError(observeWorkspaceSetupParseFailure),
		Effect.withSpan('workspace_setup.parse_state', {
			attributes: { schema_name: 'WorkspaceSetupState', ...safeWorkspaceSetupParseAttributes(context) },
		}),
	)

/** Parse task_workspace_setup_for_host.error so bad error JSON is observed too. */
export const parseWorkspaceSetupError = (value: unknown, context: WorkspaceSetupParseContext = {}) =>
	Schema.decodeUnknownEffect(WorkspaceSetupErrorSchema)(value).pipe(
		Effect.mapError(
			(cause) =>
				new InvalidWorkspaceSetupErrorError({
					...context,
					schemaName: 'WorkspaceSetupError',
					message: 'Invalid workspace setup error payload',
					cause,
				}),
		),
		Effect.tapError(observeWorkspaceSetupParseFailure),
		Effect.withSpan('workspace_setup.parse_error', {
			attributes: { schema_name: 'WorkspaceSetupError', ...safeWorkspaceSetupParseAttributes(context) },
		}),
	)
