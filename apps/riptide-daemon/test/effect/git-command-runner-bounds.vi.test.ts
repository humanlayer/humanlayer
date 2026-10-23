import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import {
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	Logger,
	PlatformError,
	Queue,
	Ref,
	Sink,
	Stream,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { GitCommandRunnerLive, GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'

const config = (maxOutputBytes: number) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown({ RIPTIDE_GIT_MAX_OUTPUT_BYTES: maxOutputBytes }))

const handle = (
	stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
	stderr: Stream.Stream<Uint8Array, PlatformError.PlatformError> = Stream.empty,
) =>
	ChildProcessSpawner.makeHandle({
		pid: ChildProcessSpawner.ProcessId(1),
		exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
		isRunning: Effect.succeed(true),
		kill: () => Effect.void,
		stdin: Sink.drain,
		stdout,
		stderr,
		all: Stream.empty,
		getInputFd: () => Sink.drain,
		getOutputFd: () => Stream.empty,
		unref: Effect.succeed(Effect.void),
	})

describe('Git runner bounded output and platform errors', () => {
	it.effect('uses the invocation environment rather than capturing a spawner during construction', () =>
		Effect.gen(function* () {
			const git = Context.get(yield* Layer.build(GitCommandRunnerLive), GitCommandRunner)
			for (const expected of ['first runtime', 'second runtime']) {
				const spawner = Layer.succeed(
					ChildProcessSpawner.ChildProcessSpawner,
					ChildProcessSpawner.make(() =>
						Effect.succeed(handle(Stream.make(new TextEncoder().encode(expected)))),
					),
				)
				const output = yield* git
					.run(['--version'], { cwd: '/' })
					.pipe(
						Effect.provide(spawner),
						Effect.provide(GitRunnerConfigurationLive.pipe(Layer.provide(config(100)))),
					)
				expect(output.stdout).toBe(expected)
			}
		}),
	)

	for (const reason of ['NonZeroExit', 'Timeout', 'OutputLimitExceeded'] as const) {
		it.effect(`captures safe ${reason} diagnostics and releases the process before returning failure`, () =>
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>()
				const released = yield* Ref.make(false)
				const messages: unknown[] = []
				const spawner = Layer.succeed(
					ChildProcessSpawner.ChildProcessSpawner,
					ChildProcessSpawner.make(() =>
						Effect.acquireRelease(
							Effect.succeed({
								...handle(Stream.empty, Stream.make(new TextEncoder().encode('secret-output'))),
								exitCode:
									reason === 'Timeout'
										? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
										: Effect.succeed(ChildProcessSpawner.ExitCode(128)),
							}),
							() => Ref.set(released, true),
						),
					),
				)
				const failure = yield* Effect.gen(function* () {
					const git = yield* GitCommandRunner
					const operation = Effect.flip(git.run(['secret-argument'], { cwd: '/', timeout: '1 second' }))
					if (reason !== 'Timeout') return yield* operation
					const fiber = yield* Effect.forkChild(operation)
					yield* Deferred.await(started)
					yield* TestClock.adjust('1 second')
					return yield* Fiber.join(fiber)
				}).pipe(
					Effect.provide(
						Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
							Layer.provideMerge(spawner),
							Layer.provide(config(reason === 'OutputLimitExceeded' ? 4 : 100)),
						),
					),
					Effect.provide(Logger.layer([Logger.make((entry) => messages.push(entry.message))])),
				)
				expect(failure._tag).toBe(
					reason === 'NonZeroExit'
						? 'GitCommandFailedError'
						: reason === 'Timeout'
							? 'GitTimeoutError'
							: 'GitOutputLimitExceededError',
				)
				expect(messages.flat()).toContainEqual(expect.objectContaining({ _tag: 'GitProcessFailure', reason }))
				if (reason === 'NonZeroExit') {
					expect(messages.flat()).toContainEqual(expect.objectContaining({ exitCode: 128 }))
					expect(failure).toMatchObject({ stderr: 'secret-output', argv: ['secret-argument'] })
				}
				if (reason === 'OutputLimitExceeded')
					expect(messages.flat()).toContainEqual(expect.objectContaining({ maxOutputBytes: 4 }))
				expect(JSON.stringify(messages)).not.toContain('secret-')
				expect(yield* Ref.get(released)).toBe(true)
			}),
		)
	}

	it.effect('does not report explicitly accepted nonzero exits as failures', () =>
		Effect.gen(function* () {
			const messages: unknown[] = []
			const spawner = Layer.succeed(
				ChildProcessSpawner.ChildProcessSpawner,
				ChildProcessSpawner.make(() =>
					Effect.succeed({
						...handle(Stream.empty),
						exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
					}),
				),
			)
			const output = yield* Effect.flatMap(GitCommandRunner, (git) =>
				git.run(['show-ref', '--verify', '--quiet', 'refs/heads/missing'], { cwd: '/', okExitCodes: [0, 1] }),
			).pipe(
				Effect.provide(
					Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
						Layer.provideMerge(spawner),
						Layer.provide(config(4)),
					),
				),
				Effect.provide(Logger.layer([Logger.make((entry) => messages.push(entry.message))])),
			)
			expect(output.exitCode).toBe(1)
			expect(messages).toEqual([])
		}),
	)

	it.effect('rejects invalid output budgets during layer construction', () =>
		Effect.gen(function* () {
			for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
				const failure = yield* Effect.flip(
					GitCommandRunner.pipe(
						Effect.provide(
							Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
								Layer.provide(NodeServices.layer),
								Layer.provide(config(limit)),
							),
						),
					),
				)
				expect(failure._tag).toBe('ConfigError')
			}
		}),
	)

	it.effect('shares one budget across stdout and stderr', () =>
		Effect.gen(function* () {
			const spawner = Layer.succeed(
				ChildProcessSpawner.ChildProcessSpawner,
				ChildProcessSpawner.make(() =>
					Effect.succeed(handle(Stream.make(new Uint8Array(3)), Stream.make(new Uint8Array(3)))),
				),
			)
			const failure = yield* Effect.gen(function* () {
				const git = yield* GitCommandRunner
				return yield* Effect.flip(git.run(['diff'], { cwd: '/' }))
			}).pipe(
				Effect.provide(
					Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
						Layer.provideMerge(spawner),
						Layer.provide(config(4)),
					),
				),
			)
			expect(failure._tag).toBe('GitOutputLimitExceededError')
		}),
	)

	it.effect('accepts the exact combined byte limit and decodes split UTF-8 without truncation', () =>
		Effect.gen(function* () {
			const spawner = Layer.succeed(
				ChildProcessSpawner.ChildProcessSpawner,
				ChildProcessSpawner.make(() =>
					Effect.succeed(
						handle(
							Stream.make(new Uint8Array([0xe2]), new Uint8Array([0x82, 0xac])),
							Stream.make(new Uint8Array([33])),
						),
					),
				),
			)
			const output = yield* Effect.gen(function* () {
				const git = yield* GitCommandRunner
				return yield* git.run(['diff'], { cwd: '/' })
			}).pipe(
				Effect.provide(
					Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
						Layer.provideMerge(spawner),
						Layer.provide(config(4)),
					),
				),
			)
			expect(output).toEqual({ stdout: '\u20ac', stderr: '!', exitCode: 0 })
		}),
	)

	for (const overflowingStream of ['stdout', 'stderr'] as const) {
		it.effect(`fails ${overflowingStream} overflow and releases the process and sibling stream`, () =>
			Effect.gen(function* () {
				const subscribed = yield* Deferred.make<void>()
				const released = yield* Ref.make(0)
				const siblingReleased = yield* Ref.make(false)
				const readPastLimit = yield* Ref.make(false)
				const sibling = Stream.fromEffect(
					Deferred.succeed(subscribed, undefined).pipe(
						Effect.andThen(Effect.never),
						Effect.ensuring(Ref.set(siblingReleased, true)),
					),
				)
				const overflow = Stream.fromEffect(Deferred.await(subscribed).pipe(Effect.as(new Uint8Array(5)))).pipe(
					Stream.concat(Stream.fromEffect(Ref.set(readPastLimit, true).pipe(Effect.as(new Uint8Array(1))))),
				)
				const spawner = Layer.succeed(
					ChildProcessSpawner.ChildProcessSpawner,
					ChildProcessSpawner.make((command) => {
						if (!ChildProcess.isStandardCommand(command)) return Effect.die('Unexpected pipeline')
						expect(command.options.killSignal).toBe('SIGKILL')
						return Effect.acquireRelease(
							Effect.succeed(
								handle(
									overflowingStream === 'stdout' ? overflow : sibling,
									overflowingStream === 'stderr' ? overflow : sibling,
								),
							),
							() => Ref.update(released, (count) => count + 1),
						)
					}),
				)
				const failure = yield* Effect.gen(function* () {
					const git = yield* GitCommandRunner
					return yield* Effect.flip(git.run(['diff', 'secret-argument'], { cwd: '/' }))
				}).pipe(
					Effect.provide(
						Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
							Layer.provideMerge(spawner),
							Layer.provide(config(4)),
						),
					),
				)
				expect(failure).toMatchObject({ _tag: 'GitOutputLimitExceededError', maxOutputBytes: 4 })
				expect(JSON.stringify(failure)).not.toContain('secret-argument')
				expect(yield* Ref.get(released)).toBe(1)
				expect(yield* Ref.get(siblingReleased)).toBe(true)
				expect(yield* Ref.get(readPastLimit)).toBe(false)
			}),
		)
	}

	for (const seam of ['spawn', 'stdout', 'stderr', 'exitCode'] as const) {
		it.effect(`captures safe rich diagnostics before narrowing ${seam} failures`, () =>
			Effect.gen(function* () {
				const logs: Array<unknown> = []
				const released = yield* Ref.make(false)
				const failure = PlatformError.systemError({
					_tag: 'NotFound',
					module: 'ChildProcess',
					method: seam === 'spawn' ? 'spawn' : seam,
					pathOrDescriptor: 'git secret-argument',
					description: 'secret-argument',
					cause: new Error('secret-argument'),
					syscall: 'secret-argument',
				})
				const failedStream = Stream.fail(failure)
				const spawner = Layer.succeed(
					ChildProcessSpawner.ChildProcessSpawner,
					ChildProcessSpawner.make(() =>
						seam === 'spawn'
							? Effect.fail(failure)
							: Effect.acquireRelease(
									Effect.succeed({
										...handle(
											seam === 'stdout' ? failedStream : Stream.empty,
											seam === 'stderr' ? failedStream : Stream.empty,
										),
										exitCode:
											seam === 'exitCode'
												? Effect.fail(failure)
												: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
									}),
									() => Ref.set(released, true),
								),
					),
				)
				const result = yield* Effect.gen(function* () {
					const git = yield* GitCommandRunner
					return yield* Effect.flip(git.run(['secret-argument'], { cwd: '/' }))
				}).pipe(
					Effect.provide(
						Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
							Layer.provideMerge(spawner),
							Layer.provide(config(4)),
						),
					),
					Effect.provide(Logger.layer([Logger.make((options) => logs.push(options.message))])),
				)
				expect(result._tag).toBe(seam === 'spawn' ? 'GitBinaryMissingError' : 'GitCommandIoError')
				expect(logs[0]).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							_tag: 'GitPlatformFailure',
							module: 'ChildProcess',
							method: seam,
							reason: 'NotFound',
						}),
					]),
				)
				expect(JSON.stringify(logs)).not.toContain('secret-argument')
				expect(JSON.stringify(result)).not.toContain('secret-argument')
				expect(yield* Ref.get(released)).toBe(seam !== 'spawn')
			}),
		)
	}

	it.effect('interrupts scoped child work when the caller cancels', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>()
			const released = yield* Ref.make(false)
			const spawner = Layer.succeed(
				ChildProcessSpawner.ChildProcessSpawner,
				ChildProcessSpawner.make(() =>
					Effect.acquireRelease(
						Effect.succeed(
							handle(
								Stream.fromEffect(
									Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
								),
							),
						),
						() => Ref.set(released, true),
					),
				),
			)
			yield* Effect.gen(function* () {
				const git = yield* GitCommandRunner
				const fiber = yield* Effect.forkChild(git.run(['diff'], { cwd: '/' }))
				yield* Deferred.await(started)
				yield* Fiber.interrupt(fiber)
				expect(yield* Ref.get(released)).toBe(true)
			}).pipe(
				Effect.provide(
					Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
						Layer.provideMerge(spawner),
						Layer.provide(config(4)),
					),
				),
			)
		}),
	)

	it.effect('uses the real platform for output limits, missing executables and missing cwd', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const cwd = yield* fs.makeTempDirectoryScoped()
			const git = yield* GitCommandRunner
			expect(yield* Effect.flip(git.run(['--version'], { cwd }))).toMatchObject({
				_tag: 'GitOutputLimitExceededError',
			})
			expect(yield* Effect.flip(git.run(['--version'], { cwd, env: { PATH: cwd } }))).toMatchObject({
				_tag: 'GitBinaryMissingError',
			})
			expect(yield* Effect.flip(git.run(['--version'], { cwd: `${cwd}/missing` }))).toMatchObject({
				_tag: 'GitCommandIoError',
			})
		}).pipe(
			Effect.scoped,
			Effect.provide(
				Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
					Layer.provide(NodeServices.layer),
					Layer.provide(config(1)),
				),
			),
			Effect.provide(NodeServices.layer),
		),
	)

	it.effect('terminates a real continuously writing child before returning overflow', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const cwd = yield* fs.makeTempDirectoryScoped()
			const realSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const spawned = yield* Queue.unbounded<ChildProcessSpawner.ChildProcessHandle>()
			const recordingSpawner = Layer.succeed(
				ChildProcessSpawner.ChildProcessSpawner,
				ChildProcessSpawner.make((command) =>
					realSpawner.spawn(command).pipe(Effect.tap((child) => Queue.offer(spawned, child))),
				),
			)
			const failure = yield* Effect.gen(function* () {
				const git = yield* GitCommandRunner
				return yield* Effect.flip(
					git.run(['-c', 'alias.output=!while :; do printf 12345; done', 'output'], { cwd }),
				)
			}).pipe(
				Effect.provide(
					Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
						Layer.provideMerge(recordingSpawner),
						Layer.provide(config(4)),
					),
				),
			)
			expect(failure._tag).toBe('GitOutputLimitExceededError')
			const child = yield* Queue.take(spawned)
			expect(yield* child.isRunning).toBe(false)
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	)
})
