import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export class FilesystemOperationError extends Schema.TaggedError<FilesystemOperationError>()(
	'FilesystemOperationError',
	{
		operation: Schema.String,
		path: Schema.String,
		message: Schema.String,
	},
) {}

export const FilesystemDirectory = Schema.Struct({ name: Schema.String, path: Schema.String })
export type FilesystemDirectory = typeof FilesystemDirectory.Type
export const PathStat = Schema.Struct({ exists: Schema.Boolean, isDirectory: Schema.Boolean, isFile: Schema.Boolean })
export type PathStat = typeof PathStat.Type
export const FileMatch = Schema.Struct({
	path: Schema.String,
	display_path: Schema.String,
	score: Schema.Number,
	matched_indexes: Schema.Array(Schema.Number),
	is_directory: Schema.Boolean,
})
export type FileMatch = typeof FileMatch.Type

export class GetHomeDirectory extends Rpc.make('GetHomeDirectory', {
	success: Schema.String,
	error: FilesystemOperationError,
}) {}

export class StatPath extends Rpc.make('StatPath', {
	payload: { path: Schema.String },
	success: PathStat,
	error: FilesystemOperationError,
}) {}

export class ReadTextFile extends Rpc.make('ReadTextFile', {
	payload: { path: Schema.String },
	success: Schema.String,
	error: FilesystemOperationError,
}) {}

export class ReadFile extends Rpc.make('ReadFile', {
	payload: { path: Schema.String },
	success: Schema.Uint8Array,
	error: FilesystemOperationError,
}) {}

export class BrowseDirectories extends Rpc.make('BrowseDirectories', {
	payload: { path: Schema.String },
	success: Schema.Array(FilesystemDirectory),
	error: FilesystemOperationError,
}) {}

/**
 * Lists one directory, without recursion, keeping only the entries whose name
 * starts with `prefix`. This is the primitive behind typed-path completion in
 * the `@` mention picker: the cost is bounded by the directory's own size
 * rather than by a scan budget, so completing a path under a large tree such
 * as the home directory stays cheap and complete.
 */
export class ListDirectory extends Rpc.make('ListDirectory', {
	payload: {
		path: Schema.String,
		prefix: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
	},
	success: Schema.Array(FileMatch),
	error: FilesystemOperationError,
}) {}

export class FuzzySearchFiles extends Rpc.make('FuzzySearchFiles', {
	payload: {
		query: Schema.String,
		paths: Schema.Array(Schema.String),
		limit: Schema.optional(Schema.Number),
	},
	success: Schema.Array(FileMatch),
	error: FilesystemOperationError,
}) {}
