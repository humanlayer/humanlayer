import type { FileMatch, FilesystemDirectory, PathStat } from '@humanlayer/riptide-electron-rpc'
import type { FilesystemOperationError } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'

export interface FilesystemServiceShape {
	readonly getHomeDirectory: Effect.Effect<string, FilesystemOperationError>
	readonly statPath: (path: string) => Effect.Effect<PathStat, FilesystemOperationError>
	readonly readTextFile: (path: string) => Effect.Effect<string, FilesystemOperationError>
	readonly readFile: (path: string) => Effect.Effect<Uint8Array, FilesystemOperationError>
	readonly browseDirectories: (
		path: string,
	) => Effect.Effect<ReadonlyArray<FilesystemDirectory>, FilesystemOperationError>
	readonly listDirectory: (input: {
		readonly path: string
		readonly prefix?: string
		readonly limit?: number
	}) => Effect.Effect<ReadonlyArray<FileMatch>, FilesystemOperationError>
	readonly fuzzySearchFiles: (input: {
		readonly query: string
		readonly paths: ReadonlyArray<string>
		readonly limit?: number
	}) => Effect.Effect<ReadonlyArray<FileMatch>, FilesystemOperationError>
}

export class FilesystemService extends Context.Service<FilesystemService, FilesystemServiceShape>()(
	'FilesystemService',
) {}
