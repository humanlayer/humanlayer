import * as Config from 'effect/Config'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Predicate from 'effect/Predicate'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Stream from 'effect/Stream'

export class CliProcessFailure extends Data.TaggedError('CliProcessFailure')<{
	readonly executable: string
	readonly cause: unknown
	readonly message: string
}> {}

export class CliProcessTimeoutFailure extends Data.TaggedError('CliProcessTimeoutFailure')<{
	readonly executable: string
	readonly message: string
}> {}

export interface CliProcessOutput {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

export const collectChildProcessOutput = Effect.fn('cli_process.collect_output')(function* (input: {
	readonly executable: string
	readonly arguments: ReadonlyArray<string>
	readonly timeout: number
	readonly environment: Record<string, string> | undefined
	readonly extendEnvironment: boolean
}) {
	const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const command = ChildProcess.make(input.executable, input.arguments, {
				env: input.environment,
				extendEnv: input.extendEnvironment,
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			})
			const handle = yield* childProcessSpawner.spawn(command)
			return yield* Effect.all(
				{
					exitCode: handle.exitCode,
					stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
					stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
				},
				{ concurrency: 'unbounded' },
			).pipe(Effect.timeout(input.timeout))
		}),
	).pipe(
		Effect.mapError((cause) =>
			Predicate.isTagged(cause, 'TimeoutException')
				? new CliProcessTimeoutFailure({
						executable: input.executable,
						message: `${input.executable} timed out after ${input.timeout}ms`,
					})
				: new CliProcessFailure({
						executable: input.executable,
						cause,
						message: `Failed to execute ${input.executable}`,
					}),
		),
	)
})

const parseEnvironment = (contents: string): Record<string, string> => {
	const environment: Record<string, string> = {}
	const entries = contents.includes('\0') ? contents.split('\0') : contents.split('\n')
	for (const line of entries) {
		const separatorIndex = line.indexOf('=')
		if (separatorIndex <= 0) continue
		const key = line.slice(0, separatorIndex)
		if (key.includes('\u001b')) continue
		environment[key] = line.slice(separatorIndex + 1)
	}
	return environment
}

export const loadInteractiveShellEnvironment = Effect.fn('cli_process.load_interactive_shell_environment')(
	function* () {
		const loginShell = yield* Config.String('SHELL').pipe(Config.withDefault('/bin/zsh'))
		const output = yield* collectChildProcessOutput({
			executable: loginShell,
			// Toolchains such as Bun are commonly configured in .zshrc, which a
			// non-interactive login shell does not source.
			arguments: ['-il', '-c', 'command env -0'],
			timeout: 10_000,
			environment: undefined,
			extendEnvironment: true,
		})
		if (output.exitCode !== 0) {
			return yield* Effect.fail(
				new CliProcessFailure({
					executable: loginShell,
					cause: output.stderr,
					message: `Interactive shell exited with code ${output.exitCode}`,
				}),
			)
		}
		const environment = parseEnvironment(output.stdout)
		if (Object.keys(environment).length === 0) {
			return yield* Effect.fail(
				new CliProcessFailure({
					executable: loginShell,
					cause: output.stdout,
					message: 'Interactive shell returned no environment variables',
				}),
			)
		}
		return environment
	},
)
