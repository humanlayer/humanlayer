import * as Effect from 'effect/Effect'

import { FilesystemService } from '../../filesystem/filesystem-service'

export const getHomeDirectoryHandler = Effect.fn('rpc.get_home_directory')(function* () {
	return yield* (yield* FilesystemService).getHomeDirectory
})

export const statPathHandler = Effect.fn('rpc.stat_path')(function* (input: { readonly path: string }) {
	return yield* (yield* FilesystemService).statPath(input.path)
})

export const readTextFileHandler = Effect.fn('rpc.read_text_file')(function* (input: { readonly path: string }) {
	return yield* (yield* FilesystemService).readTextFile(input.path)
})

export const readFileHandler = Effect.fn('rpc.read_file')(function* (input: { readonly path: string }) {
	return yield* (yield* FilesystemService).readFile(input.path)
})

export const browseDirectoriesHandler = Effect.fn('rpc.browse_directories')(function* (input: {
	readonly path: string
}) {
	return yield* (yield* FilesystemService).browseDirectories(input.path)
})

export const listDirectoryHandler = Effect.fn('rpc.list_directory')(function* (input: {
	readonly path: string
	readonly prefix?: string
	readonly limit?: number
}) {
	return yield* (yield* FilesystemService).listDirectory(input)
})

export const fuzzySearchFilesHandler = Effect.fn('rpc.fuzzy_search_files')(function* (input: {
	readonly query: string
	readonly paths: ReadonlyArray<string>
	readonly limit?: number
}) {
	return yield* (yield* FilesystemService).fuzzySearchFiles(input)
})
