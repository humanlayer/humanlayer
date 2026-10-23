import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

import { Cause, Config, Console, Data, Effect, Option, Result } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import logger from '@/logger'

const homeDirectory = Effect.sync(homedir)
const UNIX_EXECUTABLE_PERMISSION_BITS = 0o111

/**
 * Expand ~ to home directory
 */
export const expandHome = (candidate: string) =>
	Effect.gen(function* () {
		if (!candidate.startsWith('~/')) return candidate
		const paths = yield* Path.Path
		const home = yield* homeDirectory
		return paths.join(home, candidate.slice(2))
	})

/**
 * Avoid paths that are likely stale project-local shims rather than user-installed binaries.
 */
export function shouldSkipPath(path: string): boolean {
	if (path.includes('/node_modules/')) return true
	if (path.endsWith('.bak')) return true
	return false
}

export class ClaudeBinaryStatError extends Data.TaggedError('ClaudeBinaryStatError')<{
	path: string
	cause: unknown
}> {}

export class ClaudeBinaryNotExecutableError extends Data.TaggedError('ClaudeBinaryNotExecutableError')<{
	path: string
	cause: unknown
}> {}

export class ClaudeCodeBinaryNotFound extends Data.TaggedError('ClaudeCodeBinaryNotFound')<{
	binaryName: string
	searchedPaths: string[]
	notes: string[]
}> {}

export class ClaudeBinaryDetectionMethodFailed extends Data.TaggedError('ClaudeBinaryDetectionMethodFailed')<{
	method: DetectionMethod
	binaryName: string
}> {}

const errorCode = (cause: unknown): unknown => {
	if (cause === null || typeof cause !== 'object') return undefined
	if ('code' in cause) return cause.code
	if ('error' in cause) return errorCode(cause.error)
	if ('cause' in cause) return errorCode(cause.cause)
	return undefined
}

const isNotFoundCause = (cause: unknown) => errorCode(cause) === 'ENOENT'

const reportWarning = (error: unknown, context: Record<string, unknown>) =>
	Effect.logWarning('Claude binary detection warning', error).pipe(Effect.annotateLogs(context))

const reportError = (error: unknown, context: Record<string, unknown>) =>
	Effect.logError('Claude binary detection failed', error).pipe(Effect.annotateLogs(context))

const swallowDetectionCause = (phase: string, cause: Cause.Cause<unknown>) =>
	reportWarning(Cause.squash(cause), { phase, causeDetails: Cause.pretty(cause) }).pipe(
		Effect.as(Option.none<string>()),
	)

const checkCandidatePath = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const expanded = yield* expandHome(path)

		if (shouldSkipPath(expanded)) return Option.none<string>()

		const statResult = yield* Effect.result(fs.stat(expanded))
		if (Result.isFailure(statResult)) {
			if (isNotFoundCause(statResult.failure)) return Option.none<string>()

			const error = new ClaudeBinaryStatError({ path: expanded, cause: statResult.failure })
			yield* reportWarning(error, { path: expanded })
			return Option.none<string>()
		}

		if (statResult.success.type !== 'File' || (statResult.success.mode & UNIX_EXECUTABLE_PERMISSION_BITS) === 0) {
			const error = new ClaudeBinaryNotExecutableError({
				path: expanded,
				cause: 'Path is not an executable file',
			})
			yield* reportWarning(error, { path: expanded })
			return Option.none<string>()
		}

		return Option.some(expanded)
	})

const safeCandidatePath = (path: string) =>
	checkCandidatePath(path).pipe(Effect.catchCause((cause) => swallowDetectionCause('candidate-path', cause)))

const safeDetectionMethod = (
	phase: string,
	effect: Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path>,
) => effect.pipe(Effect.catchCause((cause) => swallowDetectionCause(phase, cause)))

const firstCandidatePath = (
	paths: readonly string[],
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> => {
	const [path, ...rest] = paths
	if (!path) return Effect.succeed(Option.none())

	return safeCandidatePath(path).pipe(
		Effect.flatMap((result) => (Option.isSome(result) ? Effect.succeed(result) : firstCandidatePath(rest))),
	)
}

const shellWhichPath = (binaryName: string, shell?: string) =>
	Effect.promise(async () => {
		try {
			const command = shell ? [shell, '-lc', `which ${binaryName}`] : ['which', binaryName]
			const executable = command[0]
			if (executable === undefined) return Option.none<string>()
			const proc = spawn(executable, command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
			let output = ''
			proc.stdout.setEncoding('utf-8')
			proc.stdout.on('data', (chunk) => {
				output += chunk
			})
			const exitCode = await new Promise<number | null>((resolve) => {
				proc.on('error', () => resolve(1))
				proc.on('close', resolve)
			})
			if (exitCode !== 0) return Option.none<string>()

			const path = output.trim()
			if (!path || path.includes('not found')) return Option.none<string>()
			return Option.some(path)
		} catch {
			return Option.none<string>()
		}
	})

const validateShellCandidate = (candidate: Option.Option<string>) =>
	Option.isSome(candidate) ? safeCandidatePath(candidate.value) : Effect.succeed(Option.none<string>())

const detectViaWhichEffect = (binaryName: string) =>
	shellWhichPath(binaryName).pipe(Effect.flatMap(validateShellCandidate))

const detectViaLoginShellEffect = (binaryName: string) =>
	shellWhichPath(binaryName, 'zsh').pipe(
		Effect.flatMap((zshResult) =>
			Option.isSome(zshResult)
				? validateShellCandidate(zshResult)
				: shellWhichPath(binaryName, 'bash').pipe(Effect.flatMap(validateShellCandidate)),
		),
	)

const findBinaryViaNvm = (
	binaryName: string,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const paths = yield* Path.Path
		const home = yield* homeDirectory
		const nvmBase = paths.join(home, '.nvm/versions/node')
		const versions = yield* fs.readDirectory(nvmBase).pipe(Effect.catch(() => Effect.succeed([])))
		const matches = versions.map((version) => paths.join(nvmBase, version, 'bin', binaryName))
		return yield* firstCandidatePath(matches)
	})

export type DetectionMethod = 'env' | 'which' | 'common-paths' | 'nvm' | 'login-shell'

export interface DetectionResult {
	path: string
	method: DetectionMethod
}

/**
 * Wrap a detection function to include method name in result
 */
export function withMethod<T extends () => Promise<string>>(
	method: DetectionMethod,
	fn: T,
): () => Promise<DetectionResult> {
	return async () => {
		const path = await fn()
		return { path, method }
	}
}

/**
 * Configuration for binary detection
 */
export interface BinaryDetectionConfig {
	/** The name of the binary to detect (e.g. 'claude', 'opencode') */
	binaryName: string
	/** Environment variable name to check for explicit path override */
	envVarName?: string
	/** Additional paths specific to this binary */
	additionalPaths?: string[]
	/** Whether to log detection results (default: true) */
	enableLogging?: boolean
}

type BinaryDetectionRequirements = FileSystem.FileSystem | Path.Path

const buildCommonPaths = (
	paths: Path.Path,
	home: string,
	binaryName: string,
	additionalPaths: readonly string[] = [],
) => {
	const commonPaths = [paths.join(home, '.local/bin', binaryName)]
	if (binaryName === 'claude') commonPaths.push(paths.join(home, '.claude/local/claude'))
	commonPaths.push(
		...additionalPaths,
		paths.join(home, '.npm/bin', binaryName),
		paths.join(home, '.bun/bin', binaryName),
	)
	return commonPaths
}

const buildFallbackPaths = (paths: Path.Path, binaryName: string) => [
	paths.join('/usr/local/bin', binaryName),
	paths.join('/opt/homebrew/bin', binaryName),
]

const detectFromMethods = (
	binaryName: string,
	commonPaths: readonly string[],
	fallbackPaths: readonly string[],
): Effect.Effect<Option.Option<string>, never, BinaryDetectionRequirements> =>
	Effect.gen(function* () {
		const commonResult = yield* firstCandidatePath(commonPaths)
		if (Option.isSome(commonResult)) return commonResult

		const whichResult = yield* safeDetectionMethod('which', detectViaWhichEffect(binaryName))
		if (Option.isSome(whichResult)) return whichResult

		const loginResult = yield* safeDetectionMethod('login-shell', detectViaLoginShellEffect(binaryName))
		if (Option.isSome(loginResult)) return loginResult

		const nvmResult = yield* safeDetectionMethod('nvm', findBinaryViaNvm(binaryName))
		if (Option.isSome(nvmResult)) return nvmResult

		return yield* firstCandidatePath(fallbackPaths)
	})

export const detectBinaryPathEffect = (config: BinaryDetectionConfig) =>
	Effect.gen(function* () {
		const { binaryName, envVarName, additionalPaths = [], enableLogging = true } = config
		const paths = yield* Path.Path
		const home = yield* homeDirectory
		const commonPaths = buildCommonPaths(paths, home, binaryName, additionalPaths)
		const fallbackPaths = buildFallbackPaths(paths, binaryName)
		const searchedPaths = [...commonPaths, '$PATH', 'login-shell:$PATH', 'nvm', ...fallbackPaths]

		if (envVarName) {
			const envPath = Option.getOrUndefined(yield* Config.option(Config.String(envVarName)))
			if (envPath) {
				const envResult = yield* safeCandidatePath(envPath)
				if (Option.isSome(envResult)) {
					if (enableLogging) {
						logger.info(`${binaryName} binary detected via ${envVarName} environment variable`, {
							path: envResult.value,
							method: 'env',
						})
					}
					return envResult.value
				}
			}
		}

		const detected = yield* detectFromMethods(binaryName, commonPaths, fallbackPaths)
		if (Option.isSome(detected)) {
			if (enableLogging) {
				logger.info(`${binaryName} binary detected`, { path: detected.value })
			}
			return detected.value
		}

		return yield* Effect.fail(
			new ClaudeCodeBinaryNotFound({ binaryName, searchedPaths, notes: ['No executable candidate found'] }),
		)
	})

/**
 * Check if a file exists and is executable.
 */
export const isExecutable = (path: string): Effect.Effect<boolean, never, BinaryDetectionRequirements> =>
	checkCandidatePath(path).pipe(
		Effect.map(Option.isSome),
		Effect.catchCause(() => Effect.succeed(false)),
		Effect.withSpan('binary_detection.is_executable'),
	)

/**
 * Detect a binary via `which` command (PATH lookup)
 */
export const detectViaWhich = (
	binaryName: string,
): Effect.Effect<string, ClaudeBinaryDetectionMethodFailed, BinaryDetectionRequirements> =>
	Effect.gen(function* () {
		const result = yield* detectViaWhichEffect(binaryName)
		if (Option.isSome(result)) return result.value
		return yield* new ClaudeBinaryDetectionMethodFailed({ method: 'which', binaryName })
	}).pipe(Effect.withSpan('binary_detection.detect_via_which'))

/**
 * Configuration for common paths detection
 */
export interface CommonPathsConfig {
	/** The binary name to look for */
	binaryName: string
	/** Additional paths specific to this binary */
	additionalPaths?: string[]
}

/**
 * Detect a binary via common installation paths
 */
export const detectViaCommonPaths = (
	config: CommonPathsConfig,
): Effect.Effect<string, ClaudeBinaryDetectionMethodFailed, BinaryDetectionRequirements> =>
	Effect.gen(function* () {
		const paths = yield* Path.Path
		const home = yield* homeDirectory
		const result = yield* firstCandidatePath(
			buildCommonPaths(paths, home, config.binaryName, config.additionalPaths),
		)
		if (Option.isSome(result)) return result.value
		return yield* new ClaudeBinaryDetectionMethodFailed({ method: 'common-paths', binaryName: config.binaryName })
	}).pipe(Effect.withSpan('binary_detection.detect_via_common_paths'))

/**
 * Detect a binary via NVM installation paths
 */
export const detectViaNvm = (
	binaryName: string,
): Effect.Effect<string, ClaudeBinaryDetectionMethodFailed, BinaryDetectionRequirements> =>
	Effect.gen(function* () {
		const result = yield* findBinaryViaNvm(binaryName)
		if (Option.isSome(result)) return result.value
		return yield* new ClaudeBinaryDetectionMethodFailed({ method: 'nvm', binaryName })
	}).pipe(Effect.withSpan('binary_detection.detect_via_nvm'))

/**
 * Detect a binary via login shell (zsh/bash -lc "which <binary>")
 */
export const detectViaLoginShell = (
	binaryName: string,
): Effect.Effect<string, ClaudeBinaryDetectionMethodFailed, BinaryDetectionRequirements> =>
	Effect.gen(function* () {
		const result = yield* detectViaLoginShellEffect(binaryName)
		if (Option.isSome(result)) return result.value
		return yield* new ClaudeBinaryDetectionMethodFailed({ method: 'login-shell', binaryName })
	}).pipe(Effect.withSpan('binary_detection.detect_via_login_shell'))

/**
 * Detect a binary path using ordered methods.
 * Returns the path if found, undefined otherwise.
 */
export const detectBinaryPath = (
	config: BinaryDetectionConfig,
): Effect.Effect<string | undefined, never, BinaryDetectionRequirements> =>
	detectBinaryPathEffect(config).pipe(
		Effect.catchCause((cause) =>
			Effect.gen(function* () {
				const error = Cause.squash(cause)
				yield* reportError(error, {
					binaryName: config.binaryName,
					causeDetails: Cause.pretty(cause),
				})
				return undefined
			}),
		),
		Effect.withSpan('binary_detection.detect_binary_path'),
	)

/**
 * Create a cached binary locator for a specific binary.
 * Returns functions for initialization, getting the path, and getting the cached path.
 */
export function createCachedBinaryLocator(config: BinaryDetectionConfig) {
	let cachedPath: string | undefined
	let cacheInitialized = false

	const { binaryName, envVarName } = config

	/**
	 * Initialize binary path detection at startup.
	 * Logs errors to stderr for parent processes to capture.
	 */
	const initialize = (): Effect.Effect<void, never, BinaryDetectionRequirements> =>
		Effect.gen(function* () {
			logger.info(`Initializing ${binaryName} binary path detection...`)

			const path = yield* detectBinaryPath(config)
			cachedPath = path
			cacheInitialized = true

			if (path) {
				logger.info(`${binaryName} binary path initialized successfully`, { path })
			} else {
				const envHint = envVarName ? `, or set ${envVarName} environment variable` : ''
				const errorMessage = `Could not locate ${binaryName} binary. Please ensure ${binaryName} is installed and accessible via PATH${envHint}.`

				logger.error(errorMessage)
				yield* Console.error(`[riptide-daemon] ERROR: ${errorMessage}`)
			}
		}).pipe(Effect.withSpan('binary_detection.initialize_cached_locator'))

	/**
	 * Get the binary path.
	 * Returns cached path if available, otherwise attempts detection.
	 */
	const getPath = (): Effect.Effect<string | undefined, never, BinaryDetectionRequirements> =>
		Effect.gen(function* () {
			if (cachedPath) return cachedPath

			if (cacheInitialized) {
				logger.info(`Retrying ${binaryName} binary detection (previously failed)`)
				const path = yield* detectBinaryPath(config)
				if (path) {
					cachedPath = path
					logger.info(`${binaryName} binary found on retry`, { path })
				}
				return path
			}

			logger.warn(`${binaryName} path requested before initialization, running detection now`)
			yield* initialize()
			return cachedPath
		}).pipe(Effect.withSpan('binary_detection.get_cached_binary_path'))

	function getCachedPath(): string | undefined {
		return cachedPath
	}

	function resetCache(): void {
		cachedPath = undefined
		cacheInitialized = false
	}

	return {
		initialize,
		getPath,
		getCachedPath,
		resetCache,
	}
}
