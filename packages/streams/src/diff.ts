import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from 'effect'

export const TaskId = Schema.String.pipe(Schema.brand('TaskId'))
export const SessionId = Schema.String.pipe(Schema.brand('SessionId'))
export const RepoId = Schema.String.pipe(Schema.brand('RepoId'))
/** `${fileKey}:${blobId}`: one immutable file body, named by Git's blob hash. */
export const VersionId = Schema.String.pipe(Schema.brand('VersionId'))
export const OrganizationId = Schema.String.pipe(Schema.brand('OrganizationId'))
export const HostId = Schema.String.pipe(Schema.brand('HostId'))

export class TaskDiffFileRow extends Schema.Class<TaskDiffFileRow>('TaskDiffFileRow')({
	id: Schema.String,
	taskId: TaskId,
	repoId: RepoId,
	repoDisplayName: Schema.optional(Schema.String),
	sessionId: SessionId,
	path: Schema.String,
	prevPath: Schema.optional(Schema.String),
	changeType: Schema.Literals(['modified', 'added', 'deleted', 'renamed']),
	additions: Schema.Number,
	deletions: Schema.Number,
	binary: Schema.Boolean,
	generated: Schema.Boolean,
	/** Current version in `diff-file-versions`. Absent only for binary files. */
	versionId: Schema.optional(VersionId),
	updatedAt: Schema.String,
}) {}

export type TaskDiffFileRowType = typeof TaskDiffFileRow.Type
export const parseTaskDiffFileRow = Schema.decodeUnknownSync(TaskDiffFileRow)

export class TaskDiffFileId extends Schema.Class<TaskDiffFileId>('TaskDiffFileId')({
	taskId: TaskId,
	repoId: RepoId,
	path: Schema.String,
}) {}

export type TaskDiffFileIdType = typeof TaskDiffFileId.Type

const TaskDiffFileIdFromString = Schema.String.pipe(
	Schema.decodeTo(
		TaskDiffFileId,
		SchemaTransformation.transformEffect({
			decode: (id) => {
				const parsed = splitTaskDiffFileId(id)
				return parsed
					? Effect.succeed(parsed)
					: Effect.fail(
							new SchemaIssue.InvalidValue({
								message: 'Expected a task diff file ID in taskId:repoId:path format',
							}),
						)
			},
			encode: ({ taskId, repoId, path }) => Effect.succeed(`${taskId}:${repoId}:${path}`),
		}),
	),
)

function splitTaskDiffFileId(id: string): { taskId: string; repoId: string; path: string } | null {
	const taskSeparator = id.indexOf(':')
	const repoSeparator = id.indexOf(':', taskSeparator + 1)
	if (taskSeparator <= 0 || repoSeparator <= taskSeparator + 1 || repoSeparator === id.length - 1) return null
	return {
		taskId: id.slice(0, taskSeparator),
		repoId: id.slice(taskSeparator + 1, repoSeparator),
		path: id.slice(repoSeparator + 1),
	}
}

/** Parses a diff file ID even when its referenced file is no longer present in synchronized rows. */
export function parseTaskDiffFileId(id: string): TaskDiffFileIdType | null {
	return Option.getOrNull(Schema.decodeUnknownOption(TaskDiffFileIdFromString)(id))
}

/**
 * Rename-stable file identity: the repository plus Git's task-start path when a rename is
 * detected, otherwise the current path.
 */
export const fileKeyFor = (repoId: string, path: string, prevPath?: string): string => `${repoId}:${prevPath ?? path}`

export const versionIdFor = (fileKey: string, blobId: string): typeof VersionId.Type =>
	VersionId.make(`${fileKey}:${blobId}`)

/** Git blob IDs: 40-character SHA-1 or 64-character SHA-256. */
export const BlobId = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/))

const fileBodyFields = {
	fileKey: Schema.String,
	taskId: TaskId,
	repoId: RepoId,
	/** Path of the file at this version. */
	path: Schema.String,
	/** Complete body. `null` means this side does not exist (added or deleted file). */
	content: Schema.NullOr(Schema.String),
	byteLength: Schema.Number,
	/** Set when the body exists but was not published; `content` is then `null`. */
	omittedReason: Schema.optional(Schema.Literals(['too_large'])),
	updatedAt: Schema.String,
}

/** The file at task start. Keyed by `fileKey`; updated when the task's Git base changes. */
export class TaskDiffFileBaselineRow extends Schema.Class<TaskDiffFileBaselineRow>('TaskDiffFileBaselineRow')({
	id: Schema.String,
	...fileBodyFields,
}) {}

export type TaskDiffFileBaselineRowType = typeof TaskDiffFileBaselineRow.Type
export const parseTaskDiffFileBaselineRow = Schema.decodeUnknownSync(TaskDiffFileBaselineRow)

/** One immutable body of a file. Keyed by `versionId`. */
export class TaskDiffFileVersionRow extends Schema.Class<TaskDiffFileVersionRow>('TaskDiffFileVersionRow')({
	id: VersionId,
	blobId: BlobId,
	...fileBodyFields,
}) {}

export type TaskDiffFileVersionRowType = typeof TaskDiffFileVersionRow.Type
export const parseTaskDiffFileVersionRow = Schema.decodeUnknownSync(TaskDiffFileVersionRow)

export class WorkspaceStateRepoEffectSchema extends Schema.Class<WorkspaceStateRepoEffectSchema>('WorkspaceStateRepo')({
	path: Schema.String,
	description: Schema.optional(Schema.String),
	remoteUrl: Schema.optional(Schema.String),
	sourceRef: Schema.String,
	sourceCommit: Schema.optional(Schema.String),
	branch: Schema.String,
	primary: Schema.Boolean,
}) {}

/** Effect-native counterpart to the database WorkspaceStateSchema. */
export class WorkspaceStateEffectSchema extends Schema.Class<WorkspaceStateEffectSchema>('WorkspaceState')({
	workspaceBaseDirectory: Schema.String,
	repos: Schema.Array(WorkspaceStateRepoEffectSchema),
}) {}

export type WorkspaceStateEffect = typeof WorkspaceStateEffectSchema.Type

export const TaskDiffWorkspaceRepo = Schema.Struct({
	id: RepoId,
	displayName: Schema.optional(Schema.String),
	absolutePath: Schema.String,
	sourceRef: Schema.String,
	sourceCommit: Schema.optional(Schema.String),
})
export interface TaskDiffWorkspaceRepo extends Schema.Schema.Type<typeof TaskDiffWorkspaceRepo> {}

/** Fully parsed logical + host-local workspace consumed by daemon capture services. */
export const TaskDiffWorkspace = Schema.Struct({
	organizationId: OrganizationId,
	taskId: TaskId,
	hostId: HostId,
	workspaceBaseDirectory: Schema.String,
	repos: Schema.Array(TaskDiffWorkspaceRepo),
})
export interface TaskDiffWorkspace extends Schema.Schema.Type<typeof TaskDiffWorkspace> {}

export type TaskDiffWorkspaceType = typeof TaskDiffWorkspace.Type

export const TaskDiffFileRowStandardSchema = Schema.toStandardSchemaV1(TaskDiffFileRow)
export const TaskDiffFileBaselineRowStandardSchema = Schema.toStandardSchemaV1(TaskDiffFileBaselineRow)
export const TaskDiffFileVersionRowStandardSchema = Schema.toStandardSchemaV1(TaskDiffFileVersionRow)
export const WorkspaceStateStandardSchema = Schema.toStandardSchemaV1(WorkspaceStateEffectSchema)
