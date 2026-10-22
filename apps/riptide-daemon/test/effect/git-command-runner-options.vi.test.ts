import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Fiber, FileSystem, Layer, Path, Queue, Ref, Sink, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunnerLive, GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'

describe('Git operation timeout and transport', () => {
	it.effect('uses the configured clone timeout while ordinary commands retain the 30-second default', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const started = yield* Queue.unbounded<string>()
			const killed = yield* Ref.make(0)
			const controlledSpawner = Layer.succeed(
				ChildProcessSpawner.ChildProcessSpawner,
				ChildProcessSpawner.make((command) => {
					if (!ChildProcess.isStandardCommand(command)) return Effect.die('Unexpected pipeline')
					const operation = command.args[0]
					if (operation !== 'clone' && operation !== 'status') return spawner.spawn(command)
					return Effect.succeed(
						ChildProcessSpawner.makeHandle({
							pid: ChildProcessSpawner.ProcessId(1),
							exitCode: Queue.offer(started, operation).pipe(Effect.andThen(Effect.never)),
							isRunning: Effect.succeed(true),
							kill: () => Ref.update(killed, (count) => count + 1),
							stdin: Sink.drain,
							stdout: Stream.empty,
							stderr: Stream.empty,
							all: Stream.empty,
							getInputFd: () => Sink.drain,
							getOutputFd: () => Stream.empty,
							unref: Effect.succeed(Effect.void),
						}),
					)
				}),
			)
			const config = ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					HOME: fixture.home,
					RIPTIDE_MANAGED_REPOSITORY_ROOT: fixture.cacheRoot,
					RIPTIDE_MANAGED_REPOSITORY_CLONE_TIMEOUT: '2 minutes',
				}),
			)
			const gitLayer = Layer.fresh(
				Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
					Layer.provideMerge(controlledSpawner),
					Layer.provide(config),
				),
			)
			const cacheLayer = Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
				Layer.provideMerge(Layer.mergeAll(NodeServices.layer, gitLayer, config)),
			)
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const git = yield* GitCommandRunner
				const clone = yield* Effect.forkChild(
					Effect.flip(
						cache.prepare({
							repositoryIdentity: 'github.com/acme/repo',
							remoteUrl: 'https://github.com/acme/repo.git',
						}),
					),
				)
				expect(yield* Queue.take(started)).toBe('clone')
				yield* TestClock.adjust('30 seconds')
				expect(yield* Ref.get(killed)).toBe(0)
				yield* TestClock.adjust('90 seconds')
				expect(yield* Fiber.join(clone)).toMatchObject({
					_tag: 'ManagedRepositoryCacheError',
					command: 'git clone',
				})
				expect(yield* Ref.get(killed)).toBe(1)
				const ordinary = yield* Effect.forkChild(Effect.flip(git.run(['status'], { cwd: fixture.source })))
				expect(yield* Queue.take(started)).toBe('status')
				yield* TestClock.adjust('29 seconds')
				expect(yield* Ref.get(killed)).toBe(1)
				yield* TestClock.adjust('1 second')
				expect(yield* Fiber.join(ordinary)).toMatchObject({ _tag: 'GitTimeoutError' })
				expect(yield* Ref.get(killed)).toBe(2)
			}).pipe(Effect.provide(cacheLayer))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('preserves core.sshCommand and inherited SSH wrappers, keys and proxy options in real Git', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const wrapper = path.join(fixture.root, 'ssh-wrapper')
			const log = path.join(fixture.root, 'ssh-arguments')
			// This test transport records SSH arguments then serves the real local Git remote.
			yield* fs.writeFileString(
				wrapper,
				'#!/bin/sh\nprintf "%s\\n" "$@" > "$SSH_TEST_LOG"\nssh -G -F /dev/null "$@" > "$SSH_TEST_CONFIG" || exit $?\nexec git-upload-pack "$SSH_TEST_REMOTE"\n',
			)
			yield* fs.chmod(wrapper, 0o700)
			const coreCommand = `'${wrapper}' -o BatchMode=no -i configured-key -o ProxyCommand=configured-proxy`
			yield* fixture.run(['config', 'core.sshCommand', coreCommand], fixture.source)
			const environment = {
				HOME: fixture.home,
				GIT_SSH_VARIANT: 'ssh',
				SSH_TEST_LOG: log,
				SSH_TEST_REMOTE: fixture.remote,
				SSH_TEST_CONFIG: path.join(fixture.root, 'effective-ssh-config'),
			}
			const run = Effect.gen(function* () {
				const git = yield* GitCommandRunner
				const output = yield* git.run(['ls-remote', 'git@ssh.example.test:acme/repo.git', 'refs/heads/main'], {
					cwd: fixture.source,
					env: environment,
					nonInteractive: true,
				})
				expect(output.stdout).toContain(fixture.commit)
			})
			yield* run.pipe(
				Effect.provide(
					Layer.fresh(
						Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
							Layer.provide(NodeServices.layer),
							Layer.provide(fixture.config()),
						),
					),
				),
			)
			const coreArguments = yield* fs.readFileString(log)
			expect(coreArguments).toContain('configured-key')
			expect(coreArguments).toContain('ProxyCommand=configured-proxy')
			expect(coreArguments).toContain('BatchMode=yes')
			expect(coreArguments.indexOf('BatchMode=yes')).toBeLessThan(coreArguments.indexOf('BatchMode=no'))
			expect(yield* fs.readFileString(environment.SSH_TEST_CONFIG)).toContain('batchmode yes\n')
			const inherited = ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GIT_SSH_COMMAND: `'${wrapper}' -oBatchMode=no -i inherited-key -o ProxyCommand=inherited-proxy`,
				}),
			)
			yield* run.pipe(
				Effect.provide(
					Layer.fresh(
						Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
							Layer.provide(NodeServices.layer),
							Layer.provide(inherited),
						),
					),
				),
			)
			const inheritedArguments = yield* fs.readFileString(log)
			expect(inheritedArguments).toContain('inherited-key')
			expect(inheritedArguments).toContain('ProxyCommand=inherited-proxy')
			expect(inheritedArguments).not.toContain('configured-key')
			expect(inheritedArguments).toContain('BatchMode=yes')
			expect(inheritedArguments.indexOf('BatchMode=yes')).toBeLessThan(inheritedArguments.indexOf('BatchMode=no'))
			expect(yield* fs.readFileString(environment.SSH_TEST_CONFIG)).toContain('batchmode yes\n')
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('allows non-SSH transfers with ssh.variant=simple and rejects it only when Git invokes SSH', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			yield* fixture.run(['config', 'ssh.variant', 'simple'], fixture.source)
			yield* Effect.gen(function* () {
				const git = yield* GitCommandRunner
				// The HTTPS URL uses the fixture's real local transport, not a network request.
				const output = yield* git.run(['ls-remote', 'https://github.com/acme/repo.git', 'HEAD'], {
					cwd: fixture.source,
					env: { HOME: fixture.home },
					nonInteractive: true,
				})
				expect(output.stdout).toContain(fixture.commit)
				const failure = yield* Effect.flip(
					git.run(['ls-remote', 'git@ssh.example.test:acme/repo.git', 'HEAD'], {
						cwd: fixture.source,
						env: { HOME: fixture.home },
						nonInteractive: true,
					}),
				)
				expect(failure).toMatchObject({
					_tag: 'GitCommandFailedError',
					stderr: expect.stringContaining('requires a literal SSH executable with batch support'),
				})
			}).pipe(
				Effect.provide(
					Layer.fresh(
						Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
							Layer.provide(NodeServices.layer),
							Layer.provide(fixture.config()),
						),
					),
				),
			)
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect(
		'uses batch and PuTTY port flags for quoted plink commands and inherited executable paths with spaces',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const directory = path.join(fixture.root, 'SSH tools')
				const log = path.join(fixture.root, 'plink-arguments')
				yield* fs.makeDirectory(directory)
				for (const name of ['plink', 'tortoiseplink.exe', 'custom-transport']) {
					const executable = path.join(directory, name)
					yield* fs.writeFileString(
						executable,
						'#!/bin/sh\nprintf "%s\\n" "$@" > "$SSH_TEST_LOG"\nexec git-upload-pack "$SSH_TEST_REMOTE"\n',
					)
					yield* fs.chmod(executable, 0o700)
					const inherited = name === 'tortoiseplink.exe'
					if (!inherited)
						yield* fixture.run(
							['config', 'core.sshCommand', `"${executable}" -i configured-key`],
							fixture.source,
						)
					const config = ConfigProvider.layer(
						ConfigProvider.fromUnknown(
							inherited
								? { GIT_SSH: executable }
								: name === 'custom-transport'
									? { GIT_SSH_VARIANT: 'plink' }
									: {},
						),
					)
					yield* Effect.gen(function* () {
						const git = yield* GitCommandRunner
						const output = yield* git.run(
							['ls-remote', 'ssh://git@ssh.example.test:2222/acme/repo.git', 'HEAD'],
							{
								cwd: fixture.source,
								env: { HOME: fixture.home, SSH_TEST_LOG: log, SSH_TEST_REMOTE: fixture.remote },
								nonInteractive: true,
							},
						)
						expect(output.stdout).toContain(fixture.commit)
					}).pipe(
						Effect.provide(
							Layer.fresh(
								Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
									Layer.provide(NodeServices.layer),
									Layer.provide(config),
								),
							),
						),
					)
					const args = (yield* fs.readFileString(log)).trim().split('\n')
					expect(args[0]).toBe('-batch')
					expect(args).toContain('-P')
					expect(args).toContain('2222')
					expect(args).not.toContain('-o')
					expect(args).not.toContain('BatchMode=yes')
					if (!inherited) {
						expect(args).toContain('configured-key')
						yield* fixture.run(['config', '--unset', 'core.sshCommand'], fixture.source)
					}
				}
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)
})
