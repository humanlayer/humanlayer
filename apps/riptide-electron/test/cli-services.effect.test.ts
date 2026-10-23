import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { ClaudeNotFoundError, ClaudeUpdateError } from '@humanlayer/riptide-electron-rpc'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as PlatformError from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Ref from 'effect/Ref'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { ClaudeCodeCliLive } from '../src/diagnostics/claude-code-cli.layer'
import { ClaudeCodeCli } from '../src/diagnostics/claude-code-cli.service'
import { makeHumanLayerCliLive } from '../src/diagnostics/humanlayer-cli.layer'
import { HumanLayerCli } from '../src/diagnostics/humanlayer-cli.service'

interface CommandFixture {
	readonly executable: string
	readonly arguments: ReadonlyArray<string>
	readonly exitCode: number
	readonly stdout?: string
	readonly stderr?: string
}

interface CommandCall {
	readonly executable: string
	readonly arguments: ReadonlyArray<string>
}

const textEncoder = new TextEncoder()
const loginShell = process.env.SHELL ?? '/bin/zsh'
const loginEnvironmentCommand: CommandFixture = {
	executable: loginShell,
	arguments: ['-il', '-c', 'command env -0'],
	exitCode: 0,
	stdout: 'HOME=/Users/test\0PATH=/usr/local/bin:/usr/bin\0',
}

const makeDiagnosticsLayer = (input: {
	readonly cliUpdateEnabled?: boolean
	readonly accessiblePaths?: ReadonlyArray<string>
	readonly commands: ReadonlyArray<CommandFixture>
	readonly calls: Array<CommandCall>
	readonly onSpawn?: (call: CommandCall) => Effect.Effect<void>
}) => {
	const childProcessSpawner = ChildProcessSpawner.make((command) =>
		Effect.gen(function* () {
			if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Piped commands are not expected')
			const call = { executable: command.command, arguments: command.args }
			input.calls.push(call)
			if (input.onSpawn !== undefined) yield* input.onSpawn(call)
			const fixture = input.commands.find(
				(candidate) =>
					candidate.executable === command.command &&
					candidate.arguments.length === command.args.length &&
					candidate.arguments.every((argument, index) => argument === command.args[index]),
			)
			if (fixture === undefined)
				return yield* Effect.die(`Unexpected command: ${command.command} ${command.args.join(' ')}`)
			const stdout = fixture.stdout === undefined ? Stream.empty : Stream.make(textEncoder.encode(fixture.stdout))
			const stderr = fixture.stderr === undefined ? Stream.empty : Stream.make(textEncoder.encode(fixture.stderr))
			return ChildProcessSpawner.makeHandle({
				pid: ChildProcessSpawner.ProcessId(100),
				exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(fixture.exitCode)),
				isRunning: Effect.succeed(false),
				kill: () => Effect.void,
				stdin: Sink.drain,
				stdout,
				stderr,
				all: Stream.merge(stdout, stderr),
				getInputFd: () => Sink.drain,
				getOutputFd: () => Stream.empty,
				unref: Effect.succeed(Effect.void),
			})
		}),
	)
	const accessiblePaths = new Set(input.accessiblePaths ?? [])
	const fileSystem = FileSystem.layerNoop({
		access: (path) =>
			accessiblePaths.has(path)
				? Effect.void
				: Effect.fail(
						PlatformError.systemError({
							_tag: 'NotFound',
							module: 'FileSystem',
							method: 'access',
							pathOrDescriptor: path,
						}),
					),
	})

	const platformLayer = Layer.mergeAll(
		Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
		fileSystem,
		NodePath.layer,
		ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: loginShell })),
	)
	return Layer.mergeAll(
		ClaudeCodeCliLive.pipe(Layer.provide(platformLayer)),
		makeHumanLayerCliLive({ updateEnabled: input.cliUpdateEnabled ?? true }).pipe(Layer.provide(platformLayer)),
		platformLayer,
	)
}

describe('ClaudeCodeCli and HumanLayerCli', () => {
	it.effect('resolves Claude, classifies its installation, and reads its version', () => {
		const calls: CommandCall[] = []
		const layer = makeDiagnosticsLayer({
			calls,
			accessiblePaths: ['/Users/test/.local/bin/claude'],
			commands: [
				loginEnvironmentCommand,
				{
					executable: '/Users/test/.local/bin/claude',
					arguments: ['--version'],
					exitCode: 0,
					stdout: '2.1.177 (Claude Code)\n',
				},
			],
		})

		return Effect.gen(function* () {
			const claudeCodeCli = yield* ClaudeCodeCli
			const result = yield* claudeCodeCli.checkInstallation

			expect(result).toEqual({
				path: '/Users/test/.local/bin/claude',
				version: '2.1.177 (Claude Code)',
				installationSource: 'native',
				isRecommendedPath: true,
				isVersionSupported: true,
			})
			expect(calls).toEqual([
				{ executable: loginShell, arguments: ['-il', '-c', 'command env -0'] },
				{ executable: '/Users/test/.local/bin/claude', arguments: ['--version'] },
			])
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

	it.effect('returns a caller-actionable error when Claude is missing', () => {
		const calls: CommandCall[] = []
		const layer = makeDiagnosticsLayer({
			calls,
			commands: [loginEnvironmentCommand, { executable: '/usr/bin/which', arguments: ['claude'], exitCode: 1 }],
		})

		return Effect.gen(function* () {
			const claudeCodeCli = yield* ClaudeCodeCli
			const error = yield* Effect.flip(claudeCodeCli.checkInstallation)

			expect(error).toBeInstanceOf(ClaudeNotFoundError)
			expect(calls.at(-1)).toEqual({ executable: '/usr/bin/which', arguments: ['claude'] })
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

	it.effect('maps a failed Claude update and preserves its stderr', () => {
		const calls: CommandCall[] = []
		const layer = makeDiagnosticsLayer({
			calls,
			accessiblePaths: ['/opt/homebrew/bin/claude'],
			commands: [
				loginEnvironmentCommand,
				{
					executable: '/opt/homebrew/bin/claude',
					arguments: ['--update'],
					exitCode: 1,
					stderr: 'permission denied',
				},
			],
		})

		return Effect.gen(function* () {
			const claudeCodeCli = yield* ClaudeCodeCli
			const error = yield* Effect.flip(claudeCodeCli.updateToLatest)

			expect(error).toStrictEqual(new ClaudeUpdateError({ message: 'claude --update failed: permission denied' }))
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

	it.effect('probes an exact Claude path with version and smoke commands', () => {
		const calls: CommandCall[] = []
		const path = '/Users/test/.local/bin/claude'
		const layer = makeDiagnosticsLayer({
			calls,
			accessiblePaths: [path],
			commands: [
				loginEnvironmentCommand,
				{ executable: path, arguments: ['--version'], exitCode: 0, stdout: '2.1.177 (Claude Code)' },
				{ executable: path, arguments: ['-p', 'hi', '--model', 'haiku'], exitCode: 0, stdout: 'Hello' },
			],
		})

		return Effect.gen(function* () {
			const claudeCodeCli = yield* ClaudeCodeCli
			const result = yield* claudeCodeCli.probeAgent({ agent: 'claude', preferredPath: path })

			expect(result).toMatchObject({
				status: 'ready',
				agent: 'claude',
				path,
				installationSource: 'native',
			})
			expect(calls.slice(1)).toEqual([
				{ executable: path, arguments: ['--version'] },
				{ executable: path, arguments: ['-p', 'hi', '--model', 'haiku'] },
			])
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

	it.effect('probes Codex through the HumanLayer CLI and requires the final hi marker', () => {
		const calls: CommandCall[] = []
		const path = '/Users/test/.nvm/versions/node/v22/bin/humanlayer'
		const smokeArguments = [
			'codelayer',
			'--prompt',
			'respond with hi and nothing else',
			'--model',
			'gpt-5.6-luna',
			'--provider',
			'codex',
		]
		const layer = makeDiagnosticsLayer({
			calls,
			commands: [
				loginEnvironmentCommand,
				{
					executable: '/usr/bin/which',
					arguments: ['humanlayer'],
					exitCode: 0,
					stdout: path,
				},
				{ executable: path, arguments: ['--version'], exitCode: 0, stdout: 'humanlayer 1.0.0' },
				{
					executable: path,
					arguments: smokeArguments,
					exitCode: 0,
					stdout: 'codelayer output\n__CODELAYER_FINAL_MESSAGE_START__hi__CODELAYER_FINAL_MESSAGE_END__\n[Done]',
				},
			],
		})

		return Effect.gen(function* () {
			const claudeCodeCli = yield* ClaudeCodeCli
			const result = yield* claudeCodeCli.probeAgent({ agent: 'codex', preferredPath: null })

			expect(result).toMatchObject({
				status: 'ready',
				agent: 'codex',
				path,
				installationSource: 'nvm',
			})
			expect(calls.slice(1)).toEqual([
				{ executable: '/usr/bin/which', arguments: ['humanlayer'] },
				{ executable: path, arguments: ['--version'] },
				{ executable: path, arguments: smokeArguments },
			])
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

	it.effect('rejects a Codex probe response that is not exactly the hi marker', () => {
		const calls: CommandCall[] = []
		const path = '/Users/test/.local/bin/humanlayer'
		const layer = makeDiagnosticsLayer({
			calls,
			accessiblePaths: [path],
			commands: [
				loginEnvironmentCommand,
				{ executable: path, arguments: ['--version'], exitCode: 0, stdout: 'humanlayer 1.0.0' },
				{
					executable: path,
					arguments: [
						'codelayer',
						'--prompt',
						'respond with hi and nothing else',
						'--model',
						'gpt-5.6-luna',
						'--provider',
						'codex',
					],
					exitCode: 0,
					stdout: 'hello',
					stderr: 'unexpected response',
				},
			],
		})

		return Effect.gen(function* () {
			const claudeCodeCli = yield* ClaudeCodeCli
			const result = yield* claudeCodeCli.probeAgent({ agent: 'codex', preferredPath: path })

			expect(result).toMatchObject({
				status: 'failed',
				failure: { reason: 'smoke_test_failed', details: 'hello\nunexpected response' },
			})
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

	it.effect('classifies AgentLayer Codex authentication failures', () => {
		const calls: CommandCall[] = []
		const path = '/Users/test/.local/bin/humanlayer'
		const layer = makeDiagnosticsLayer({
			calls,
			accessiblePaths: [path],
			commands: [
				loginEnvironmentCommand,
				{ executable: path, arguments: ['--version'], exitCode: 0, stdout: 'humanlayer 1.0.0' },
				{
					executable: path,
					arguments: [
						'codelayer',
						'--prompt',
						'respond with hi and nothing else',
						'--model',
						'gpt-5.6-luna',
						'--provider',
						'codex',
					],
					exitCode: 1,
					stderr: 'AgentLayer Codex authentication is missing',
				},
			],
		})

		return Effect.gen(function* () {
			const claudeCodeCli = yield* ClaudeCodeCli
			const result = yield* claudeCodeCli.probeAgent({ agent: 'codex', preferredPath: path })

			expect(result).toMatchObject({
				status: 'failed',
				failure: { reason: 'authentication_required', details: 'AgentLayer Codex authentication is missing' },
			})
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

	it.effect('queues the best-effort CLI update only once in the application scope', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>()
			const executions = yield* Ref.make(0)
			const calls: CommandCall[] = []
			const layer = makeDiagnosticsLayer({
				calls,
				commands: [
					loginEnvironmentCommand,
					{ executable: 'npm', arguments: ['install', '-g', '@humanlayer/cli@latest'], exitCode: 0 },
				],
				onSpawn: (call) =>
					call.executable === 'npm'
						? Ref.update(executions, (count) => count + 1).pipe(
								Effect.andThen(Deferred.succeed(started, undefined)),
							)
						: Effect.void,
			})

			yield* Effect.gen(function* () {
				const humanLayerCli = yield* HumanLayerCli
				yield* humanLayerCli.updateToLatest
				yield* humanLayerCli.updateToLatest
				yield* Deferred.await(started)
				expect(yield* Ref.get(executions)).toBe(1)
			}).pipe(Effect.provide(layer), Effect.scoped)
		}),
	)

	it.effect('skips the CLI update in local source builds', () => {
		const calls: CommandCall[] = []
		const layer = makeDiagnosticsLayer({ calls, cliUpdateEnabled: false, commands: [] })

		return Effect.gen(function* () {
			const humanLayerCli = yield* HumanLayerCli
			yield* humanLayerCli.updateToLatest
			expect(calls).toEqual([])
		}).pipe(Effect.provide(layer), Effect.scoped)
	})
})
