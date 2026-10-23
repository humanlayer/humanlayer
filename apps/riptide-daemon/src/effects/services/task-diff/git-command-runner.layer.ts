import * as Sentry from '@sentry/bun'
import { Config, Data, Duration, Effect, Layer, Option, type PlatformError, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import {
	GitBinaryMissingError,
	GitCommandFailedError,
	GitCommandIoError,
	GitOutputLimitExceededError,
	GitTimeoutError,
	type GitCommandRunnerError,
} from './errors'
import { reportGitCommandError } from './git-command-observability'
import { GitCommandRunner, GitRunnerConfiguration, type GitCommandOptions } from './git-command-runner.service'

class GitPlatformFailure extends Data.TaggedError('GitPlatformFailure')<{
	readonly message: string
	readonly module: string
	readonly method: string
	readonly reason: PlatformError.SystemErrorTag | 'BadArgument'
}> {}

const capturePlatformFailure = (error: PlatformError.PlatformError, phase: string) => {
	// Platform descriptions, paths, syscalls and nested causes can contain the entire command.
	const safeError = new GitPlatformFailure({
		message: 'Git platform operation failed',
		module: error.reason.module,
		method: error.reason.method,
		reason: error.reason._tag,
	})
	return reportGitCommandError(safeError, { phase }).pipe(
		Effect.andThen(
			Effect.sync(() => Sentry.captureException(safeError, { tags: { operation: 'git.run', phase } })),
		),
	)
}

class GitProcessFailure extends Data.TaggedError('GitProcessFailure')<{
	readonly message: string
	readonly reason: 'NonZeroExit' | 'Timeout' | 'OutputLimitExceeded'
	readonly exitCode?: number
	readonly maxOutputBytes?: number
}> {}

// Arguments and stderr stay in the caller's error channel, never in runner telemetry.
const observeGitProcessFailures = <A, R>(operation: Effect.Effect<A, GitCommandRunnerError, R>) =>
	operation.pipe(
		Effect.tapErrorTag('GitCommandFailedError', (error) =>
			captureProcessFailure(
				new GitProcessFailure({
					message: 'Git command failed',
					reason: 'NonZeroExit',
					exitCode: error.exitCode,
				}),
			),
		),
		Effect.tapErrorTag('GitOutputLimitExceededError', (error) =>
			captureProcessFailure(
				new GitProcessFailure({
					message: 'Git output exceeded its byte limit',
					reason: 'OutputLimitExceeded',
					maxOutputBytes: error.maxOutputBytes,
				}),
			),
		),
	)

const captureProcessFailure = (error: GitProcessFailure) =>
	reportGitCommandError(error).pipe(
		Effect.andThen(Effect.sync(() => Sentry.captureException(error, { tags: { operation: 'git.run' } }))),
	)

interface GitCommandInput extends GitCommandOptions {
	readonly argv: ReadonlyArray<string>
}

interface NonInteractiveSshTransportInput {
	readonly command: string
	readonly variant: string | undefined
}

const nonInteractiveSshTransport = (input: NonInteractiveSshTransportInput) => {
	// Recognize a literal executable, not an arbitrary shell program. Keep the remaining arguments verbatim.
	const executable = /^\s*(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"$`\\;|&()<>]+))(?=\s|$)/.exec(input.command)
	const executableName = (executable?.[1] ?? executable?.[2] ?? executable?.[3] ?? '')
		.replaceAll('\\', '/')
		.split('/')
		.at(-1)
		?.toLowerCase()
	const inferredVariant =
		executableName === 'plink' || executableName === 'plink.exe'
			? 'plink'
			: executableName === 'tortoiseplink' || executableName === 'tortoiseplink.exe'
				? 'tortoiseplink'
				: 'ssh'
	const variant = input.variant === undefined || input.variant === 'auto' ? inferredVariant : input.variant
	if (!executable || !['ssh', 'plink', 'tortoiseplink'].includes(variant)) {
		// Git executes this only for SSH, so HTTP and local transports remain usable with ssh.variant=simple.
		return {
			command:
				"printf '%s\\n' 'Noninteractive Git requires a literal SSH executable with batch support' >&2; exit 128",
			variant,
		}
	}
	const batchOptions = variant === 'ssh' ? '-o BatchMode=yes' : '-batch'
	return { command: `${executable[0]} ${batchOptions}${input.command.slice(executable[0].length)}`, variant }
}

const executeGitCommand = (input: GitCommandInput) =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const { timeout, maxOutputBytes } = yield* GitRunnerConfiguration
			const { argv, ...opts } = input
			let outputBytes = 0
			const collectOutput = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
				Effect.gen(function* () {
					const decoder = new TextDecoder()
					let text = ''
					yield* Stream.runForEach(stream, (chunk) =>
						Effect.suspend(() => {
							if (chunk.byteLength > maxOutputBytes - outputBytes) {
								return Effect.fail(
									new GitOutputLimitExceededError({
										message: `Git output exceeded the ${maxOutputBytes}-byte limit`,
										maxOutputBytes,
									}),
								)
							}
							outputBytes += chunk.byteLength
							text += decoder.decode(chunk, { stream: true })
							return Effect.void
						}),
					)
					return text + decoder.decode()
				})
			const command = ChildProcess.make('git', [...argv], {
				cwd: opts.cwd,
				env: opts.env ? { ...opts.env } : undefined,
				extendEnv: true,
				stdin: opts.nonInteractive ? 'ignore' : undefined,
				killSignal: 'SIGKILL',
			})
			const handle = yield* spawner.spawn(command).pipe(
				Effect.tapError((error) => capturePlatformFailure(error, 'spawn')),
				Effect.catchTag('PlatformError', (error) =>
					Effect.fail(error.reason).pipe(
						Effect.catchTag('NotFound', (reason) =>
							Effect.succeed(reason.module === 'ChildProcess' && reason.method === 'spawn'),
						),
						Effect.mapError(() => new GitCommandIoError({ message: 'Git process I/O failed' })),
						Effect.flatMap((missingExecutable) =>
							Effect.fail(
								missingExecutable
									? new GitBinaryMissingError({ message: 'Git executable was not found' })
									: new GitCommandIoError({ message: 'Git process I/O failed' }),
							),
						),
					),
				),
			)
			const output = yield* Effect.all(
				{
					stdout: collectOutput(handle.stdout),
					stderr: collectOutput(handle.stderr),
					exitCode: handle.exitCode,
				},
				{ concurrency: 'unbounded' },
			).pipe(
				Effect.catchTag('PlatformError', (error) =>
					capturePlatformFailure(error, 'output').pipe(
						Effect.andThen(Effect.fail(new GitCommandIoError({ message: 'Git process I/O failed' }))),
					),
				),
				Effect.timeout(opts.timeout ?? timeout),
				Effect.tapErrorTag('TimeoutError', () =>
					captureProcessFailure(
						new GitProcessFailure({ message: 'Git command timed out', reason: 'Timeout' }),
					),
				),
				Effect.catchTag('TimeoutError', (cause) =>
					handle.kill({ killSignal: 'SIGKILL' }).pipe(
						Effect.tapError((error) => capturePlatformFailure(error, 'kill')),
						Effect.ignore,
						Effect.andThen(
							Effect.fail(
								new GitTimeoutError({
									message: 'Git command timed out',
									argv,
									cause,
								}),
							),
						),
					),
				),
			)
			if (!(opts.okExitCodes ?? [0]).includes(output.exitCode)) {
				return yield* Effect.fail(
					new GitCommandFailedError({
						message: `Git command exited ${output.exitCode}`,
						argv,
						exitCode: output.exitCode,
						stderr: output.stderr,
					}),
				)
			}
			return output
		}),
	).pipe(observeGitProcessFailures, Effect.withSpan('git.run', { attributes: { git_arg_count: input.argv.length } }))

const readGitConfig = (input: {
	readonly name: string
	readonly cwd: string
	readonly env?: Readonly<Record<string, string>>
}) =>
	executeGitCommand({
		argv: ['config', '--get', input.name],
		cwd: input.cwd,
		env: input.env,
		okExitCodes: [0, 1],
	}).pipe(Effect.map((output) => (output.exitCode === 0 ? output.stdout.trim() : undefined)))

const runNonInteractive = Effect.fn('git.run_non_interactive')(function* (input: GitCommandInput) {
	const { inheritedSshCommand, inheritedSshExecutable, inheritedSshVariant } = yield* GitRunnerConfiguration
	const { argv, ...opts } = input
	const environmentCommand = opts.env?.GIT_SSH_COMMAND ?? inheritedSshCommand
	const configuredCommand = environmentCommand ?? (yield* readGitConfig({ ...opts, name: 'core.sshCommand' }))
	const executable = opts.env?.GIT_SSH ?? inheritedSshExecutable
	const command = configuredCommand ?? (executable === undefined ? 'ssh' : `'${executable.replaceAll("'", "'\\''")}'`)
	const variant =
		opts.env?.GIT_SSH_VARIANT ?? inheritedSshVariant ?? (yield* readGitConfig({ ...opts, name: 'ssh.variant' }))
	const transport = nonInteractiveSshTransport({ command, variant })
	return yield* executeGitCommand({
		argv,
		...opts,
		env: {
			...opts.env,
			GIT_TERMINAL_PROMPT: '0',
			GCM_INTERACTIVE: 'never',
			SSH_ASKPASS_REQUIRE: 'never',
			GIT_SSH_COMMAND: transport.command,
			GIT_SSH_VARIANT: transport.variant,
		},
	})
})

export const GitRunnerConfigurationLive = Layer.effect(
	GitRunnerConfiguration,
	Effect.gen(function* () {
		const timeout = yield* Config.Duration('RIPTIDE_GIT_TIMEOUT').pipe(Config.withDefault(Duration.seconds(30)))
		const maxOutputBytes = yield* Config.schema(
			Schema.Int.check(Schema.isGreaterThan(0)),
			'RIPTIDE_GIT_MAX_OUTPUT_BYTES',
		).pipe(Config.withDefault(64 * 1024 * 1024))
		const inheritedSshCommand = Option.getOrUndefined(yield* Config.option(Config.String('GIT_SSH_COMMAND')))
		const inheritedSshExecutable = Option.getOrUndefined(yield* Config.option(Config.String('GIT_SSH')))
		const inheritedSshVariant = Option.getOrUndefined(yield* Config.option(Config.String('GIT_SSH_VARIANT')))
		return GitRunnerConfiguration.of({
			timeout,
			maxOutputBytes,
			inheritedSshCommand,
			inheritedSshExecutable,
			inheritedSshVariant,
		})
	}),
)

export const GitCommandRunnerLive = Layer.succeed(GitCommandRunner, {
	run: (argv, opts) =>
		opts.nonInteractive ? runNonInteractive({ ...opts, argv }) : executeGitCommand({ ...opts, argv }),
})
