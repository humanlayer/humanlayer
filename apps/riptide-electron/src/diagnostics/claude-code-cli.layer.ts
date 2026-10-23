import {
	ClaudeCheckError,
	ClaudeNotFoundError,
	ClaudeUpdateError,
	type ClaudeInstallationSource,
	type AgentProbeFailure,
	type AgentProbeResult,
	type CodingAgent,
	type ProbeCodingAgentInput,
} from '@humanlayer/riptide-electron-rpc'
import * as Clock from 'effect/Clock'
import type * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import { ChildProcessSpawner } from 'effect/process'

import { Sentry } from '../instrument'
import {
	type CliProcessFailure,
	CliProcessTimeoutFailure,
	collectChildProcessOutput,
	loadInteractiveShellEnvironment,
} from './child-process-output'
import { ClaudeCodeCli, ClaudeCodeCliProcessFailure } from './claude-code-cli.service'

const CLAUDE_INSTALL_URL = 'https://code.claude.com/docs/en/overview'
const minimumClaudeVersion = [2, 1, 177] as const
const maximumProbeFailureDetailsLength = 4_000
const codelayerFinalMessageStart = '__CODELAYER_FINAL_MESSAGE_START__'
const codelayerFinalMessageEnd = '__CODELAYER_FINAL_MESSAGE_END__'
const claudeCandidatePaths = [
	'~/.local/bin/claude',
	'~/.claude/local/claude',
	'~/.npm/bin/claude',
	'~/.bun/bin/claude',
	'/usr/local/bin/claude',
	'/opt/homebrew/bin/claude',
] as const

type CachedLoginEnvironment = Effect.Effect<
	Record<string, string>,
	CliProcessFailure | CliProcessTimeoutFailure | Config.ConfigError
>

const processEnvironment = (): Record<string, string> =>
	Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))

const candidatePathsForAgent = (
	agent: CodingAgent,
	executable: string,
	homeDirectory: string | undefined,
): ReadonlyArray<string> => {
	const homeCandidates: string[] = []
	if (homeDirectory) {
		homeCandidates.push(`${homeDirectory}/.local/bin/${executable}`)
		if (agent === 'claude') homeCandidates.push(`${homeDirectory}/.claude/local/claude`)
		homeCandidates.push(`${homeDirectory}/.npm/bin/${executable}`, `${homeDirectory}/.bun/bin/${executable}`)
	}
	return homeCandidates
}

const classifyInstallationSource = (path: string): { source: ClaudeInstallationSource; recommended: boolean } => {
	if (path.includes('/.local/bin/') || path.includes('/.claude/local/')) {
		return { source: 'native', recommended: true }
	}
	if (path.includes('/opt/homebrew/') || path.includes('/usr/local/bin/')) {
		return { source: 'homebrew', recommended: false }
	}
	if (path.includes('/.nvm/')) return { source: 'nvm', recommended: false }
	if (path.includes('/.npm/') || path.includes('/.npm-global/')) return { source: 'npm', recommended: false }
	if (path.includes('/.bun/')) return { source: 'bun', recommended: false }
	return { source: 'other', recommended: false }
}

const installationSourceForPath = (path: string): string => classifyInstallationSource(path).source

const isAuthenticationFailureOutput = (details: string, agent: CodingAgent): boolean => {
	const normalized = details.toLowerCase()
	const authenticationMarkers = [
		'authentication',
		'not logged in',
		'please log in',
		'please login',
		'api key',
		'oauth',
		'unauthorized',
	]
	const codexAuthenticationMarkers = [
		'missing auth for provider: codex',
		'invalid auth for provider: codex',
		'missing authentication for provider: codex',
		'invalid authentication for provider: codex',
		'invalid token for provider: codex',
		'invalid credentials for provider: codex',
	]
	if (agent === 'codex') authenticationMarkers.push(...codexAuthenticationMarkers)
	return authenticationMarkers.some((marker) => normalized.includes(marker))
}

const truncatedCombinedOutput = (output: { readonly stdout: string; readonly stderr: string }): string => {
	const combined = [output.stdout, output.stderr].filter(Boolean).join('\n').trim()
	return truncatedProbeDetails(combined)
}

const truncatedProbeDetails = (details: string): string =>
	details.length <= maximumProbeFailureDetailsLength
		? details
		: `${details.slice(0, maximumProbeFailureDetailsLength)}\n[output truncated]`

const extractCodelayerFinalMessage = (stdout: string): string | null => {
	const startIndex = stdout.lastIndexOf(codelayerFinalMessageStart)
	if (startIndex === -1) return null
	const messageStart = startIndex + codelayerFinalMessageStart.length
	const endIndex = stdout.indexOf(codelayerFinalMessageEnd, messageStart)
	if (endIndex === -1) return null
	return stdout.slice(messageStart, endIndex)
}

const parseVersion = (version: string): readonly [number, number, number] | null => {
	const match = version.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
	if (match === null) return null
	return [Number(match[1]), Number(match[2] ?? '0'), Number(match[3] ?? '0')]
}

const meetsMinimumVersion = (version: string): boolean => {
	const parsed = parseVersion(version)
	if (parsed === null) return false
	for (let index = 0; index < minimumClaudeVersion.length; index += 1) {
		const current = parsed[index]
		const minimum = minimumClaudeVersion[index]
		if (current === undefined || minimum === undefined) return false
		if (current !== minimum) return current > minimum
	}
	return true
}

// ---------------------------------------------------------------------------
// Standalone effects — deps stay in R, layer provides them at the boundary
// ---------------------------------------------------------------------------

const executeWithLoginEnvironment = (
	loginEnvironment: Record<string, string>,
	input: {
		readonly executable: string
		readonly arguments: ReadonlyArray<string>
		readonly timeout: number
	},
) =>
	collectChildProcessOutput({
		...input,
		environment: loginEnvironment,
		extendEnvironment: false,
	})

const resolveClaudeExecutable = (cachedEnvironment: CachedLoginEnvironment) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const loginEnvironment = yield* cachedEnvironment

		const homeDirectory = loginEnvironment.HOME
		const overridePath = loginEnvironment.RIPTIDE_CLAUDE_PATH?.trim()
		const candidates = [overridePath, ...claudeCandidatePaths]
			.filter((path): path is string => path !== undefined && path.length > 0)
			.map((path) => (path.startsWith('~/') && homeDirectory ? `${homeDirectory}/${path.slice(2)}` : path))

		const checkCandidate = (index: number): Effect.Effect<string | null, ClaudeCodeCliProcessFailure> => {
			const candidate = candidates[index]
			if (candidate === undefined) return Effect.succeed(null)
			return fileSystem.access(candidate).pipe(
				Effect.as(candidate),
				Effect.catchTag('PlatformError', (error) =>
					Match.value(error.reason).pipe(
						Match.when({ _tag: 'NotFound' }, () => checkCandidate(index + 1)),
						Match.orElse(() =>
							Effect.fail(
								new ClaudeCodeCliProcessFailure({
									operation: 'resolve',
									cause: error,
									message: `Failed to inspect ${candidate}`,
								}),
							),
						),
					),
				),
			)
		}

		return yield* checkCandidate(0).pipe(
			Effect.flatMap((candidate) => {
				if (candidate !== null) return Effect.succeed(candidate)
				return collectChildProcessOutput({
					executable: '/usr/bin/which',
					arguments: ['claude'],
					timeout: 10_000,
					environment: loginEnvironment,
					extendEnvironment: false,
				}).pipe(
					Effect.map((output) => (output.exitCode === 0 ? output.stdout.trim() || null : null)),
					Effect.mapError(
						(error) =>
							new ClaudeCodeCliProcessFailure({
								operation: 'resolve',
								cause: error,
								message: error.message,
							}),
					),
				)
			}),
		)
	}).pipe(
		Effect.catchTag('CliProcessFailure', (error) =>
			Effect.fail(
				new ClaudeCodeCliProcessFailure({
					operation: 'load_environment',
					cause: error,
					message: error.message,
				}),
			),
		),
		Effect.catchTag('CliProcessTimeoutFailure', (error) =>
			Effect.fail(
				new ClaudeCodeCliProcessFailure({
					operation: 'load_environment',
					cause: error,
					message: error.message,
				}),
			),
		),
		Effect.tapError((e) => Effect.logError(e)),
		Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
		Effect.mapError((error) => new ClaudeCheckError({ message: error.message })),
		Effect.flatMap((resolvedPath) =>
			resolvedPath === null
				? Effect.fail(
						new ClaudeNotFoundError({
							message: `Claude Code not found. Please install Claude Code from ${CLAUDE_INSTALL_URL}`,
						}),
					)
				: Effect.succeed(resolvedPath),
		),
		Effect.withSpan('claude_code_cli.resolve_executable'),
	)

const checkInstallationEffect = (cachedEnvironment: CachedLoginEnvironment) =>
	Effect.gen(function* () {
		const resolvedPath: string = yield* resolveClaudeExecutable(cachedEnvironment)
		const loginEnvironment = yield* cachedEnvironment.pipe(
			Effect.mapError(
				(error) => new ClaudeCheckError({ message: `Failed to load login environment: ${error.message}` }),
			),
		)
		const output = yield* executeWithLoginEnvironment(loginEnvironment, {
			executable: resolvedPath,
			arguments: ['--version'],
			timeout: 10_000,
		}).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.mapError((error) => new ClaudeCheckError({ message: error.message })),
		)
		if (output.exitCode !== 0) {
			const error = new ClaudeCodeCliProcessFailure({
				operation: 'check',
				cause: output.stderr,
				message: `Claude Code version check exited with code ${output.exitCode}`,
			})
			yield* Effect.logError(error)
			yield* Effect.sync(() => Sentry.captureException(error))
			return yield* Effect.fail(
				new ClaudeCheckError({
					message: `Claude Code binary found but not executable. Try reinstalling from ${CLAUDE_INSTALL_URL}`,
				}),
			)
		}
		const version = output.stdout.trim()
		const installation = classifyInstallationSource(resolvedPath)
		return {
			path: resolvedPath,
			version,
			installationSource: installation.source,
			isRecommendedPath: installation.recommended,
			isVersionSupported: meetsMinimumVersion(version),
		}
	}).pipe(Effect.withSpan('claude_code_cli.check_installation'))

const updateToLatestEffect = (cachedEnvironment: CachedLoginEnvironment) =>
	Effect.gen(function* () {
		const resolvedPath: string = yield* resolveClaudeExecutable(cachedEnvironment).pipe(
			Effect.catchTag('ClaudeCheckError', (error) =>
				Effect.fail(new ClaudeUpdateError({ message: error.message })),
			),
		)
		const loginEnvironment = yield* cachedEnvironment.pipe(
			Effect.mapError(
				(error) => new ClaudeUpdateError({ message: `Failed to load login environment: ${error.message}` }),
			),
		)
		const output = yield* executeWithLoginEnvironment(loginEnvironment, {
			executable: resolvedPath,
			arguments: ['--update'],
			timeout: 120_000,
		}).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.mapError((error) => new ClaudeUpdateError({ message: error.message })),
		)
		if (output.exitCode !== 0) {
			const error = new ClaudeCodeCliProcessFailure({
				operation: 'update',
				cause: output.stderr,
				message: `Claude Code update exited with code ${output.exitCode}`,
			})
			yield* Effect.logError(error)
			yield* Effect.sync(() => Sentry.captureException(error))
			return yield* Effect.fail(
				new ClaudeUpdateError({ message: `claude --update failed: ${output.stderr.trim()}` }),
			)
		}
		yield* Effect.logInfo('Claude Code updated successfully')
	}).pipe(Effect.withSpan('claude_code_cli.update_to_latest'))

// ---------------------------------------------------------------------------
// Probe sub-effects
// ---------------------------------------------------------------------------

const resolveProbeExecutablePath = (
	loginEnvironment: Record<string, string>,
	input: { readonly agent: CodingAgent; readonly executableName: string; readonly exactPath: string | null },
) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const candidates =
			input.exactPath === null
				? [...candidatePathsForAgent(input.agent, input.executableName, loginEnvironment.HOME)]
				: [input.exactPath]
		if (input.exactPath === null && loginEnvironment.HOME) {
			const nvmVersions = yield* fileSystem
				.readDirectory(`${loginEnvironment.HOME}/.nvm/versions/node`)
				.pipe(Effect.catchTag('PlatformError', () => Effect.succeed([] as ReadonlyArray<string>)))
			candidates.push(
				...[...nvmVersions]
					.sort()
					.reverse()
					.map(
						(version) =>
							`${loginEnvironment.HOME}/.nvm/versions/node/${version}/bin/${input.executableName}`,
					),
			)
		}
		if (input.exactPath === null) {
			candidates.push(`/usr/local/bin/${input.executableName}`, `/opt/homebrew/bin/${input.executableName}`)
		}
		for (const candidate of candidates) {
			const available = yield* fileSystem.access(candidate).pipe(
				Effect.as(true),
				Effect.catchTag('PlatformError', () => Effect.succeed(false)),
			)
			if (available) return candidate
		}
		if (input.exactPath === null && input.agent === 'codex') {
			const whichOutput = yield* collectChildProcessOutput({
				executable: '/usr/bin/which',
				arguments: [input.executableName],
				timeout: 10_000,
				environment: loginEnvironment,
				extendEnvironment: false,
			}).pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: '', stderr: '' })))
			if (whichOutput.exitCode === 0 && whichOutput.stdout.trim()) {
				return whichOutput.stdout.trim()
			}
		}
		if (input.exactPath === null && input.agent === 'claude') {
			for (const shell of ['/bin/zsh', '/bin/bash'] as const) {
				const whichOutput = yield* collectChildProcessOutput({
					executable: shell,
					arguments: ['-l', '-c', `command -v ${input.executableName}`],
					timeout: 10_000,
					environment: loginEnvironment,
					extendEnvironment: false,
				}).pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: '', stderr: '' })))
				if (whichOutput.exitCode === 0 && whichOutput.stdout.trim()) {
					return whichOutput.stdout.trim()
				}
			}
		}
		return null
	}).pipe(Effect.withSpan('coding_agent_cli.resolve_probe_executable'))

const runProbeVersionCheck = (loginEnvironment: Record<string, string>, executablePath: string, agent: CodingAgent) =>
	executeWithLoginEnvironment(loginEnvironment, {
		executable: executablePath,
		arguments: ['--version'],
		timeout: 10_000,
	}).pipe(
		Effect.map((output) => {
			const version = (output.stdout || output.stderr).trim()
			const supported = agent === 'claude' ? meetsMinimumVersion(version) : true
			return { version, exitCode: output.exitCode, supported, output }
		}),
		Effect.withSpan('coding_agent_cli.version_check'),
	)

const runProbeSmokeTest = (loginEnvironment: Record<string, string>, executablePath: string, agent: CodingAgent) => {
	const smokeArguments =
		agent === 'claude'
			? ['-p', 'hi', '--model', 'haiku']
			: [
					'codelayer',
					'--prompt',
					'respond with hi and nothing else',
					'--model',
					'gpt-5.6-luna',
					'--provider',
					'codex',
				]
	const probeEnvironment =
		agent === 'claude'
			? Object.fromEntries(
					Object.entries(loginEnvironment).filter(
						([name]) => name !== 'CLAUDECODE' && name !== 'CLAUDE_CODE_ENTRYPOINT',
					),
				)
			: loginEnvironment

	return collectChildProcessOutput({
		executable: executablePath,
		arguments: smokeArguments,
		timeout: 30_000,
		environment: probeEnvironment,
		extendEnvironment: false,
	}).pipe(Effect.withSpan('coding_agent_cli.smoke_test'))
}

// ---------------------------------------------------------------------------
// Probe orchestrator
// ---------------------------------------------------------------------------

const probeAgentEffect = (cachedEnvironment: CachedLoginEnvironment) =>
	Effect.fn('coding_agent_cli.probe')(function* (input: ProbeCodingAgentInput) {
		const pathService = yield* Path.Path
		const loginEnvironment = yield* cachedEnvironment.pipe(Effect.catch(() => Effect.succeed(processEnvironment())))
		const executableName = input.agent === 'codex' ? 'humanlayer' : input.agent
		const exactPath = input.preferredPath
		const checkedAt = yield* Clock.currentTimeMillis

		if (exactPath !== null && !pathService.isAbsolute(exactPath)) {
			return {
				status: 'failed',
				agent: input.agent,
				path: exactPath,
				version: null,
				installationSource: null,
				failure: { reason: 'not_found', details: 'The coding-agent path must be absolute' },
				checkedAt,
			} satisfies AgentProbeResult
		}

		const executablePath = yield* resolveProbeExecutablePath(loginEnvironment, {
			agent: input.agent,
			executableName,
			exactPath,
		})

		const buildFailedResult = (failure: AgentProbeFailure, version: string | null = null): AgentProbeResult => ({
			status: 'failed',
			agent: input.agent,
			path: executablePath ?? exactPath,
			version,
			installationSource:
				executablePath === null && exactPath === null
					? null
					: installationSourceForPath(executablePath ?? exactPath ?? ''),
			failure,
			checkedAt,
		})

		if (executablePath === null) {
			return buildFailedResult({
				reason: 'not_found',
				details:
					exactPath === null
						? `${executableName} was not found in known install locations or the login-shell PATH`
						: `${executableName} was not found at the exact path: ${exactPath}`,
			})
		}

		const versionResult = yield* runProbeVersionCheck(loginEnvironment, executablePath, input.agent).pipe(
			Effect.catchTag('CliProcessTimeoutFailure', (error) =>
				Effect.succeed({ _outcome: 'timeout' as const, message: error.message }),
			),
			Effect.catchTag('CliProcessFailure', (error) =>
				Effect.succeed({ _outcome: 'failed' as const, message: error.message }),
			),
		)
		if ('_outcome' in versionResult) {
			return buildFailedResult({
				reason: versionResult._outcome === 'timeout' ? 'timed_out' : 'not_found',
				details: versionResult.message,
			})
		}
		if (versionResult.exitCode !== 0 || !versionResult.supported) {
			return buildFailedResult(
				{
					reason: 'unsupported_version',
					details: `${executableName} version is not supported: ${truncatedCombinedOutput(versionResult.output)}`,
				},
				versionResult.version,
			)
		}

		const smokeResult = yield* runProbeSmokeTest(loginEnvironment, executablePath, input.agent).pipe(
			Effect.catchTag('CliProcessTimeoutFailure', (error) =>
				Effect.succeed({ _outcome: 'timeout' as const, message: error.message }),
			),
			Effect.catchTag('CliProcessFailure', (error) =>
				Effect.succeed({ _outcome: 'failed' as const, message: error.message }),
			),
		)
		if ('_outcome' in smokeResult) {
			return buildFailedResult(
				{
					reason: smokeResult._outcome === 'timeout' ? 'timed_out' : 'smoke_test_failed',
					details: truncatedProbeDetails(smokeResult.message),
				},
				versionResult.version,
			)
		}
		const details = truncatedCombinedOutput(smokeResult)
		if (
			smokeResult.exitCode !== 0 ||
			(input.agent === 'codex'
				? extractCodelayerFinalMessage(smokeResult.stdout) !== 'hi'
				: !smokeResult.stdout.trim())
		) {
			return buildFailedResult(
				isAuthenticationFailureOutput(details, input.agent)
					? { reason: 'authentication_required', details }
					: {
							reason: 'smoke_test_failed',
							details: details || `${executableName} exited without a response`,
						},
				versionResult.version,
			)
		}
		return {
			status: 'ready',
			agent: input.agent,
			path: executablePath,
			version: versionResult.version,
			installationSource: installationSourceForPath(executablePath),
			checkedAt,
		} satisfies AgentProbeResult
	})

// ---------------------------------------------------------------------------
// Layer — yields platform deps once and provides them at each method boundary
// ---------------------------------------------------------------------------

export const ClaudeCodeCliLive = Layer.effect(
	ClaudeCodeCli,
	Effect.gen(function* () {
		const platformDependencies = Layer.mergeAll(
			Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, yield* ChildProcessSpawner.ChildProcessSpawner),
			Layer.succeed(FileSystem.FileSystem, yield* FileSystem.FileSystem),
			Layer.succeed(Path.Path, yield* Path.Path),
		)

		const cachedEnvironment: CachedLoginEnvironment = yield* loadInteractiveShellEnvironment().pipe(
			Effect.provide(platformDependencies),
			Effect.cached,
		)

		return ClaudeCodeCli.of({
			checkInstallation: checkInstallationEffect(cachedEnvironment).pipe(Effect.provide(platformDependencies)),
			updateToLatest: updateToLatestEffect(cachedEnvironment).pipe(Effect.provide(platformDependencies)),
			probeAgent: (input) =>
				probeAgentEffect(cachedEnvironment)(input).pipe(Effect.provide(platformDependencies)),
		})
	}),
)
