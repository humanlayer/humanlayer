import { Data } from 'effect'

type WorkspaceSchemaParseErrorFields = {
	readonly schemaName: string
	readonly message: string
	readonly taskId?: string
	readonly hostId?: string
	readonly rowId?: string
	readonly cause: unknown
}

/** Invalid task-level workspace_spec JSONB encountered at the daemon boundary. */
export class InvalidWorkspaceSpecError extends Data.TaggedError(
	'InvalidWorkspaceSpecError',
)<WorkspaceSchemaParseErrorFields> {}

/** Invalid per-host workspace setup ledger JSONB encountered at the daemon boundary. */
export class InvalidWorkspaceSetupStateError extends Data.TaggedError(
	'InvalidWorkspaceSetupStateError',
)<WorkspaceSchemaParseErrorFields> {}

/** Invalid structured workspace setup error JSONB encountered at the daemon boundary. */
export class InvalidWorkspaceSetupErrorError extends Data.TaggedError(
	'InvalidWorkspaceSetupErrorError',
)<WorkspaceSchemaParseErrorFields> {}
