import { FilesystemOperationError, type FileMatch } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

import { ElectronPlatform } from '../platform/electron-platform.service'
import { FilesystemService } from './filesystem-service'

const MAX_SCANNED_ENTRIES = 20_000
const DEFAULT_SEARCH_LIMIT = 100
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.turbo', 'dist', 'build'])

export const FilesystemServiceLive = Layer.effect(
	FilesystemService,
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const platform = yield* ElectronPlatform

		const expandPath = (value: string) => {
			if (value === '~') return platform.homeDirectory
			return value.startsWith('~/') ? pathService.join(platform.homeDirectory, value.slice(2)) : value
		}

		const fail = (operation: string, path: string, error: unknown) =>
			new FilesystemOperationError({
				operation,
				path,
				message: error instanceof Error ? error.message : String(error),
			})

		const statPath = Effect.fn('filesystem.stat_path')(function* (inputPath: string) {
			const path = expandPath(inputPath)
			return yield* fileSystem.stat(path).pipe(
				Effect.map((info) => ({
					exists: true,
					isDirectory: info.type === 'Directory',
					isFile: info.type === 'File',
				})),
				Effect.catchReason(
					'PlatformError',
					'NotFound',
					() => Effect.succeed({ exists: false, isDirectory: false, isFile: false }),
					(_reason, error) => Effect.fail(fail('stat', path, error)),
				),
			)
		})

		const readTextFile = Effect.fn('filesystem.read_text_file')(function* (inputPath: string) {
			const path = expandPath(inputPath)
			return yield* fileSystem
				.readFileString(path, 'utf8')
				.pipe(Effect.mapError((error) => fail('read', path, error)))
		})

		const readFile = Effect.fn('filesystem.read_file')(function* (inputPath: string) {
			const path = expandPath(inputPath)
			return yield* fileSystem.readFile(path).pipe(Effect.mapError((error) => fail('read', path, error)))
		})

		const browseDirectories = Effect.fn('filesystem.browse_directories')(function* (inputPath: string) {
			const path = expandPath(inputPath || '/')
			const names = yield* fileSystem
				.readDirectory(path)
				.pipe(Effect.mapError((error) => fail('browse', path, error)))
			const directories: Array<{ name: string; path: string }> = []
			for (const name of names) {
				const childPath = pathService.join(path, name)
				const info = yield* fileSystem.stat(childPath).pipe(Effect.option)
				if (Option.isSome(info) && info.value.type === 'Directory') directories.push({ name, path: childPath })
			}
			return directories.sort((left, right) => left.name.localeCompare(right.name))
		})

		const listDirectory = Effect.fn('filesystem.list_directory')(function* (input: {
			readonly path: string
			readonly prefix?: string
			readonly limit?: number
		}) {
			const path = expandPath(input.path || '/')
			const prefix = input.prefix ?? ''
			const names = yield* fileSystem
				.readDirectory(path)
				.pipe(Effect.mapError((error) => fail('list', path, error)))

			// Dot entries stay hidden until the typed segment asks for them, the
			// same rule a shell follows. Without it, listing a home directory
			// buries every real entry under caches and config directories.
			const includeHidden = prefix.startsWith('.')
			const normalizedPrefix = prefix.toLowerCase()
			const candidates = names.filter(
				(name) => (includeHidden || !name.startsWith('.')) && name.toLowerCase().startsWith(normalizedPrefix),
			)

			const matches: FileMatch[] = []
			for (const name of candidates) {
				const childPath = pathService.join(path, name)
				const info = yield* fileSystem.stat(childPath).pipe(Effect.option)
				if (Option.isNone(info)) continue
				const offset = childPath.length - name.length
				matches.push({
					path: childPath,
					// The directory is already visible in what the user typed, so a
					// listing shows bare names. Showing the absolute path here would
					// let the row's tail truncation hide the name itself.
					display_path: name,
					score: 0,
					// Indexed against `path`, matching what every other producer of
					// FileMatch does, so the renderer's basename math still applies.
					matched_indexes: Array.from({ length: prefix.length }, (_, index) => offset + index),
					is_directory: info.value.type === 'Directory',
				})
			}

			// Directories first, then natural order — a listing is read, not scored,
			// so the order must stay stable as the typed segment grows.
			matches.sort((left, right) => {
				if (left.is_directory !== right.is_directory) return left.is_directory ? -1 : 1
				return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' })
			})
			return matches.slice(0, input.limit ?? DEFAULT_SEARCH_LIMIT)
		})

		const scoreMatch = (query: string, candidate: string): { score: number; indexes: number[] } | null => {
			const normalizedQuery = query.toLowerCase()
			const normalizedCandidate = candidate.toLowerCase()
			const indexes: number[] = []
			let from = 0
			for (const character of normalizedQuery) {
				const index = normalizedCandidate.indexOf(character, from)
				if (index === -1) return null
				indexes.push(index)
				from = index + 1
			}
			const first = indexes[0]
			const last = indexes[indexes.length - 1]
			const span = first === undefined || last === undefined ? 0 : last - first + 1
			return { score: normalizedQuery.length * 100 - span - normalizedCandidate.length, indexes }
		}

		const fuzzySearchFiles = Effect.fn('filesystem.fuzzy_search_files')(function* (input: {
			readonly query: string
			readonly paths: ReadonlyArray<string>
			readonly limit?: number
		}) {
			const matches: FileMatch[] = []
			let scanned = 0
			const roots = input.paths.map(expandPath)
			for (const root of roots) {
				const pending = [root]
				while (scanned < MAX_SCANNED_ENTRIES) {
					const directory = pending.pop()
					if (directory === undefined) break
					const names = yield* fileSystem
						.readDirectory(directory)
						.pipe(Effect.catchTag('PlatformError', () => Effect.succeed([] as string[])))
					for (const name of names) {
						if (scanned++ >= MAX_SCANNED_ENTRIES) break
						const path = pathService.join(directory, name)
						const info = yield* fileSystem.stat(path).pipe(Effect.option)
						if (Option.isNone(info)) continue
						const isDirectory = info.value.type === 'Directory'
						if (isDirectory && !IGNORED_DIRECTORIES.has(name)) pending.push(path)
						const displayPath = pathService.relative(root, path)
						const match = scoreMatch(input.query, displayPath)
						if (match !== null) {
							matches.push({
								path,
								display_path: displayPath,
								score: match.score,
								matched_indexes: match.indexes,
								is_directory: isDirectory,
							})
						}
					}
				}
			}
			return matches.sort((left, right) => right.score - left.score).slice(0, input.limit ?? DEFAULT_SEARCH_LIMIT)
		})

		return FilesystemService.of({
			getHomeDirectory: Effect.succeed(platform.homeDirectory),
			statPath,
			readTextFile,
			readFile,
			browseDirectories,
			listDirectory,
			fuzzySearchFiles,
		})
	}),
)
