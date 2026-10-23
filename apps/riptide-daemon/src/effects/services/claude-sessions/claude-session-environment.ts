import { Config, Data, Effect, Option } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import type { Path as PathService } from 'effect/Path'

export class ClaudeExecutableNotFoundError extends Data.TaggedError('ClaudeExecutableNotFoundError')<{
	readonly message: string
}> {}

export class ClaudeWorkingDirectoryError extends Data.TaggedError('ClaudeWorkingDirectoryError')<{
	readonly message: string
}> {}

const expandHomeDirectory = (input: string, homeDirectory: string, path: PathService): string => {
	if (input === '~') return homeDirectory
	return input.startsWith('~/') ? path.join(homeDirectory, input.slice(2)) : input
}

export const resolveClaudeWorkingDirectory = Effect.fn('claude.resolve_working_directory')(function* (input: {
	readonly workingDirectory: string
	readonly homeDirectory: string
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const workingDirectory = path.resolve(expandHomeDirectory(input.workingDirectory, input.homeDirectory, path))
	const information = yield* fileSystem.stat(workingDirectory).pipe(
		Effect.mapError(
			(cause) =>
				new ClaudeWorkingDirectoryError({
					message: `Cannot access working directory ${workingDirectory}: ${String(cause)}`,
				}),
		),
	)
	if (information.type !== 'Directory') {
		return yield* new ClaudeWorkingDirectoryError({
			message: `Path is not a directory: ${workingDirectory}`,
		})
	}
	return workingDirectory
})

export const locateClaudeExecutable = Effect.fn('claude.locate_executable')(function* (input: {
	readonly configuredPath: Option.Option<string>
	readonly executableSearchPath: string
	readonly homeDirectory: string
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	if (Option.isSome(input.configuredPath)) {
		const configuredPath = input.configuredPath.value
		const information = yield* fileSystem.stat(configuredPath).pipe(Effect.option)
		if (Option.isSome(information) && information.value.type === 'File') return configuredPath

		return yield* new ClaudeExecutableNotFoundError({
			message: `Claude Code binary configured by HUMANLAYER_CLAUDE_PATH was not found at ${configuredPath}`,
		})
	}

	const wellKnownCandidates = [
		path.join(input.homeDirectory, '.local', 'bin', 'claude'),
		path.join(input.homeDirectory, '.claude', 'local', 'claude'),
		path.join(input.homeDirectory, '.npm', 'bin', 'claude'),
		path.join(input.homeDirectory, '.bun', 'bin', 'claude'),
		path.join('/usr/local/bin', 'claude'),
		path.join('/opt/homebrew/bin', 'claude'),
	]

	for (const candidate of wellKnownCandidates) {
		const information = yield* fileSystem.stat(candidate).pipe(Effect.option)
		if (Option.isSome(information) && information.value.type === 'File') return candidate
	}

	const pathCandidates = input.executableSearchPath
		.split(path.sep === '\\' ? ';' : ':')
		.filter((directory) => directory.length > 0)
		.map((directory) => path.join(directory, 'claude'))

	for (const candidate of pathCandidates) {
		const information = yield* fileSystem.stat(candidate).pipe(Effect.option)
		if (Option.isSome(information) && information.value.type === 'File') return candidate
	}

	return yield* new ClaudeExecutableNotFoundError({
		message: 'Claude Code binary was not found in HUMANLAYER_CLAUDE_PATH or PATH',
	})
})

export interface ClaudeExecutableConfiguration {
	readonly configuredPath: Option.Option<string>
	readonly executableSearchPath: string
	readonly homeDirectory: string
}

const isNonEmpty = (value: string): boolean => value.trim().length > 0

// HUMANLAYER_CLAUDE_PATH wins over RIPTIDE_CLAUDE_PATH. The session runner and the login driver
// both resolve the claude binary through this, so they never disagree on where it lives.
export const readClaudeExecutableConfiguration = Effect.fn('claude.executable_configuration')(function* () {
	const humanLayerPath = Option.filter(yield* Config.option(Config.String('HUMANLAYER_CLAUDE_PATH')), isNonEmpty)
	const riptidePath = Option.filter(yield* Config.option(Config.String('RIPTIDE_CLAUDE_PATH')), isNonEmpty)
	return {
		configuredPath: Option.isSome(humanLayerPath) ? humanLayerPath : riptidePath,
		executableSearchPath: yield* Config.String('PATH').pipe(Config.withDefault('')),
		homeDirectory: yield* Config.String('HOME'),
	} satisfies ClaudeExecutableConfiguration
})

export const resolveClaudeExecutable = Effect.fn('claude.resolve_executable')(function* () {
	return yield* locateClaudeExecutable(yield* readClaudeExecutableConfiguration())
})
