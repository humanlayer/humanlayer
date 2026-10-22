import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Fiber, FileSystem, Layer, Path, Predicate, Stream } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { expect } from 'vitest'

import { WorkspacePathResolverLive } from '@/effects/services/workspace-path-resolver/workspace-path-resolver.layer'
import type { WorkspaceSetupCommandError } from '@/effects/services/workspace-setup-executor/workspace-setup-executor.errors'
import { WorkspaceSetupExecutorLive } from '@/effects/services/workspace-setup-executor/workspace-setup-executor.layer'
import { WorkspaceSetupExecutor } from '@/effects/services/workspace-setup-executor/workspace-setup-executor.service'
import { workspaceSetupLogDirectory } from '@/lib/log-paths'

const testConfigLayer = Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ HOME: '/test/home' }))
const workspacePathResolverDependencies = Layer.mergeAll(NodeServices.layer, testConfigLayer)
const workspacePathResolverLayer = WorkspacePathResolverLive.pipe(Layer.provideMerge(workspacePathResolverDependencies))
const executorOperationalLayer = Layer.mergeAll(NodeServices.layer, workspacePathResolverLayer)
const executorRuntimeLayer = WorkspaceSetupExecutorLive.pipe(Layer.provideMerge(executorOperationalLayer))

const runProcess = (command: string, args: readonly string[]) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const handle = yield* spawner.spawn(ChildProcess.make(command, args))
		const [stdout, stderr, exitCode] = yield* Effect.all(
			[
				Stream.decodeText(handle.stdout).pipe(Stream.mkString),
				Stream.decodeText(handle.stderr).pipe(Stream.mkString),
				handle.exitCode,
			],
			{ concurrency: 'unbounded' },
		)
		if (Number(exitCode) !== 0) {
			return yield* Effect.die(`${command} ${args.join(' ')} failed: ${stderr}`)
		}
		return stdout
	}).pipe(Effect.scoped)

const processIsRunning = (pid: number) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const handle = yield* spawner.spawn(ChildProcess.make('kill', ['-0', String(pid)]))
		return Number(yield* handle.exitCode) === 0
	}).pipe(Effect.scoped)

const waitUntil = <E, R>(predicate: Effect.Effect<boolean, E, R>, attempts = 500): Effect.Effect<void, E, R> =>
	Effect.gen(function* () {
		if (yield* predicate) return
		if (attempts <= 0) return yield* Effect.die('Timed out waiting for condition')
		yield* Effect.sleep('10 millis')
		yield* waitUntil(predicate, attempts - 1)
	})

const initGitRepo = (directory: string) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		yield* runProcess('git', ['init', directory])
		yield* runProcess('git', ['-C', directory, 'config', 'user.email', 'test@example.com'])
		yield* runProcess('git', ['-C', directory, 'config', 'user.name', 'Test User'])
		yield* fileSystem.writeFileString(path.join(directory, 'README.md'), 'fixture')
		yield* runProcess('git', ['-C', directory, 'add', 'README.md'])
		yield* runProcess('git', ['-C', directory, 'commit', '-m', 'fixture'])
	})

const commitFile = (directory: string, fileName: string) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		yield* fileSystem.writeFileString(path.join(directory, fileName), fileName)
		yield* runProcess('git', ['-C', directory, 'add', fileName])
		yield* runProcess('git', ['-C', directory, 'commit', '-m', fileName])
		return (yield* runProcess('git', ['-C', directory, 'rev-parse', 'HEAD'])).trim()
	})

const operationFor = (source: string, target: string, branch: string) =>
	({
		taskId: 'task-adopt',
		hostId: 'host-adopt',
		directory: source,
		repo: {
			localPath: '.',
			targetPath: target,
			branch,
			sourceRef: 'HEAD',
			setupCommand: 'true',
			copyGlobs: [],
			primary: true,
		},
	}) as const

describe('WorkspaceSetupExecutor', () => {
	it.effect('preflights a pinned commit and creates its worktree', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-' })
			const source = path.join(fixture, 'source')
			const target = path.join(fixture, 'target')
			yield* runProcess('git', ['init', source])
			yield* runProcess('git', ['-C', source, 'config', 'user.email', 'test@example.com'])
			yield* runProcess('git', ['-C', source, 'config', 'user.name', 'Test User'])
			yield* fileSystem.writeFileString(path.join(source, 'README.md'), 'fixture')
			yield* fileSystem.writeFileString(path.join(source, '.gitignore'), '.env\nnode_modules/\n')
			yield* runProcess('git', ['-C', source, 'add', 'README.md', '.gitignore'])
			yield* runProcess('git', ['-C', source, 'commit', '-m', 'fixture'])
			yield* fileSystem.writeFileString(path.join(source, '.env'), 'TEST_VALUE=1')
			yield* fileSystem.makeDirectory(path.join(source, 'config'), { recursive: true })
			yield* fileSystem.writeFileString(path.join(source, 'config', '.gitignore'), 'private/\n')
			yield* fileSystem.writeFileString(path.join(source, 'config', 'workspace.json'), '{"copy":true}')
			yield* fileSystem.makeDirectory(path.join(source, 'config', 'private'), { recursive: true })
			yield* fileSystem.writeFileString(path.join(source, 'config', 'private', 'secret.json'), '{"copy":false}')
			yield* fileSystem.makeDirectory(path.join(source, 'node_modules', 'fixture'), { recursive: true })
			yield* fileSystem.writeFileString(
				path.join(source, 'node_modules', 'fixture', 'package.json'),
				'{"copy":false}',
			)

			const executor = yield* WorkspaceSetupExecutor
			const operation = {
				taskId: 'task-1',
				hostId: 'host-1',
				directory: source,
				repo: {
					localPath: '.',
					targetPath: target,
					branch: 'phase-5-test',
					sourceRef: 'HEAD',
					setupCommand: 'printf setup-complete > setup.txt',
					copyGlobs: ['.env', '**/*.json'],
					primary: true,
				},
			} as const
			const preflight = yield* executor.preflightRepo(operation)
			expect(preflight.resolvedSourceCommit).toMatch(/^[0-9a-f]{40}$/)
			const worktree = yield* executor.createOrAdoptWorktree({
				...operation,
				resolvedSourceCommit: preflight.resolvedSourceCommit,
			})
			expect(worktree.targetPath).toBe(target)
			expect(worktree.adopted).toBe(false)
			const adopted = yield* executor.createOrAdoptWorktree({
				...operation,
				resolvedSourceCommit: preflight.resolvedSourceCommit,
			})
			expect(adopted.adopted).toBe(true)
			const copied = yield* executor.copyConfiguredFiles(operation)
			expect(copied.filesCopied).toEqual(['.env', 'config/workspace.json'])
			expect(yield* fileSystem.readFileString(path.join(target, '.env'))).toBe('TEST_VALUE=1')
			expect(yield* fileSystem.readFileString(path.join(target, 'config', 'workspace.json'))).toBe(
				'{"copy":true}',
			)
			const setup = yield* executor.runSetupCommand(operation)
			expect(setup.exitCode).toBe(0)
			const successfulLogPrefix = path.join(workspaceSetupLogDirectory, 'task-1-host-1-.-0')
			expect(yield* fileSystem.exists(`${successfulLogPrefix}.stdout.log`)).toBe(false)
			expect(yield* fileSystem.exists(`${successfulLogPrefix}.stderr.log`)).toBe(false)
			expect((yield* runProcess('git', ['-C', target, 'branch', '--show-current'])).trim()).toBe('phase-5-test')
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)

	it.effect('uses the recorded source commit instead of resolving a moved source ref', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-source-pin-' })
			const source = path.join(fixture, 'source')
			const target = path.join(fixture, 'target')
			yield* initGitRepo(source)
			const pinnedCommit = (yield* runProcess('git', ['-C', source, 'rev-parse', 'HEAD'])).trim()
			yield* commitFile(source, 'newer.txt')
			const executor = yield* WorkspaceSetupExecutor
			const operation = {
				...operationFor(source, target, 'source-pin-branch'),
				repo: {
					...operationFor(source, target, 'source-pin-branch').repo,
					sourceCommit: pinnedCommit,
				},
			}

			const preflight = yield* executor.preflightRepo(operation)
			expect(preflight.resolvedSourceCommit).toBe(pinnedCommit)
			yield* executor.createOrAdoptWorktree({
				...operation,
				resolvedSourceCommit: preflight.resolvedSourceCommit,
			})
			expect((yield* runProcess('git', ['-C', target, 'rev-parse', 'HEAD'])).trim()).toBe(pinnedCommit)
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)

	it.effect('fails when the recorded source commit is not available locally', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-missing-pin-' })
			const source = path.join(fixture, 'source')
			yield* initGitRepo(source)
			const executor = yield* WorkspaceSetupExecutor
			const error = yield* executor
				.preflightRepo({
					...operationFor(source, path.join(fixture, 'target'), 'missing-pin-branch'),
					repo: {
						...operationFor(source, path.join(fixture, 'target'), 'missing-pin-branch').repo,
						sourceCommit: '0'.repeat(40),
					},
				})
				.pipe(Effect.flip)

			expect(error.message).toBe(`Unable to resolve recorded source commit: ${'0'.repeat(40)}`)
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)

	it.effect('creates a local task branch without publishing it to a remote', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-remote-' })
			const remote = path.join(fixture, 'remote.git')
			const seed = path.join(fixture, 'seed')
			const source = path.join(fixture, 'source')
			const target = path.join(fixture, 'target')

			yield* runProcess('git', ['init', '--bare', '--initial-branch=main', remote])
			yield* runProcess('git', ['init', '--initial-branch=main', seed])
			yield* runProcess('git', ['-C', seed, 'config', 'user.email', 'test@example.com'])
			yield* runProcess('git', ['-C', seed, 'config', 'user.name', 'Test User'])
			yield* fileSystem.writeFileString(path.join(seed, 'README.md'), 'fixture')
			yield* runProcess('git', ['-C', seed, 'add', 'README.md'])
			yield* runProcess('git', ['-C', seed, 'commit', '-m', 'fixture'])
			yield* runProcess('git', ['-C', seed, 'remote', 'add', 'origin', remote])
			yield* runProcess('git', ['-C', seed, 'push', '--set-upstream', 'origin', 'main'])
			yield* runProcess('git', ['clone', remote, source])
			yield* fileSystem.writeFileString(path.join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n')
			yield* runProcess('chmod', ['+x', path.join(remote, 'hooks', 'pre-receive')])

			const executor = yield* WorkspaceSetupExecutor
			const operation = {
				...operationFor(source, target, 'local-task-branch'),
				repo: {
					...operationFor(source, target, 'local-task-branch').repo,
					sourceRef: 'origin/main',
				},
			}
			const preflight = yield* executor.preflightRepo(operation)
			expect(preflight.branchRemote).toBe('origin')
			const worktree = yield* executor.createOrAdoptWorktree({
				...operation,
				...preflight,
			})
			expect(worktree.remoteName).toBe('origin')
			expect(worktree.upstreamRef).toBe('origin/local-task-branch')
			expect((yield* runProcess('git', ['-C', target, 'rev-parse', 'HEAD'])).trim()).toBe(
				preflight.resolvedSourceCommit,
			)
			expect((yield* runProcess('git', ['ls-remote', remote, 'refs/heads/local-task-branch'])).trim()).toBe('')
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)

	it.live('terminates a running setup child when its Effect fiber is interrupted', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-interrupt-' })
			const target = path.join(fixture, 'target')
			const pidFile = path.join(target, 'setup-child.pid')
			yield* fileSystem.makeDirectory(target)

			const executor = yield* WorkspaceSetupExecutor
			const setup = executor.runSetupCommand({
				taskId: 'task-interrupt',
				hostId: 'host-interrupt',
				directory: fixture,
				repo: {
					localPath: '.',
					targetPath: target,
					branch: 'unused',
					sourceRef: 'HEAD',
					setupCommand: 'printf %s $$ > setup-child.pid; exec sleep 300',
					copyGlobs: [],
					primary: true,
				},
			})
			const fiber = yield* Effect.forkChild(setup)
			let childPid: number | undefined
			yield* waitUntil(
				Effect.gen(function* () {
					if (!(yield* fileSystem.exists(pidFile))) return false
					const parsed = Number.parseInt(yield* fileSystem.readFileString(pidFile), 10)
					if (!Number.isInteger(parsed)) return false
					childPid = parsed
					return yield* processIsRunning(parsed)
				}),
			)
			if (childPid === undefined) return yield* Effect.die('Setup child PID was not recorded')
			const runningChildPid = childPid

			yield* Fiber.interrupt(fiber)
			yield* waitUntil(processIsRunning(runningChildPid).pipe(Effect.map((running) => !running)))
			expect(yield* processIsRunning(runningChildPid)).toBe(false)

			const logPrefix = path.join(workspaceSetupLogDirectory, 'task-interrupt-host-interrupt-.-')
			const logFiles = yield* fileSystem.readDirectory(workspaceSetupLogDirectory)
			yield* Effect.forEach(
				logFiles.filter((file) => path.join(workspaceSetupLogDirectory, file).startsWith(logPrefix)),
				(file) => fileSystem.remove(path.join(workspaceSetupLogDirectory, file), { force: true }),
				{ discard: true },
			)
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)

	it.effect('retains failed command logs with a bounded error excerpt', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-output-' })
			const target = path.join(fixture, 'target')
			yield* fileSystem.makeDirectory(target)
			const executor = yield* WorkspaceSetupExecutor
			const exit = yield* executor
				.runSetupCommand({
					taskId: 'task-output',
					hostId: 'host-output',
					directory: fixture,
					repo: {
						localPath: '.',
						targetPath: target,
						branch: 'unused',
						sourceRef: 'HEAD',
						setupCommand:
							'printf success-output; printf error-prefix- >&2; i=0; while [ $i -lt 5000 ]; do printf x >&2; i=$((i + 1)); done; exit 7',
						copyGlobs: [],
						primary: true,
					},
				})
				.pipe(Effect.exit)
			if (!Exit.isFailure(exit)) return yield* Effect.die('Expected setup command failure')
			const failure = exit.cause.reasons.find(Cause.isFailReason)
			if (!Predicate.isTagged(failure?.error, 'WorkspaceSetupCommandError')) {
				return yield* Effect.die('Expected WorkspaceSetupCommandError')
			}
			const commandError: WorkspaceSetupCommandError = failure.error
			if (!commandError.stdoutLogPath || !commandError.stderrLogPath) {
				return yield* Effect.die('Expected retained command log paths')
			}
			const stdoutLogPath = commandError.stdoutLogPath
			const stderrLogPath = commandError.stderrLogPath
			yield* Effect.addFinalizer(() =>
				Effect.all(
					[
						fileSystem.remove(stdoutLogPath, { force: true }),
						fileSystem.remove(stderrLogPath, { force: true }),
					],
					{ concurrency: 2, discard: true },
				).pipe(
					Effect.catchTag('PlatformError', (error) =>
						Effect.logWarning('Failed to remove workspace setup test logs').pipe(
							Effect.annotateLogs({
								stdout_log_path: stdoutLogPath,
								stderr_log_path: stderrLogPath,
								error,
							}),
						),
					),
				),
			)
			expect(commandError.exitCode).toBe(7)
			expect(commandError.stderr).toMatch(/^error-prefix-/)
			expect(commandError.stderr?.length).toBeLessThanOrEqual(1_024)
			expect(yield* fileSystem.readFileString(stdoutLogPath)).toBe('success-output')
			expect(yield* fileSystem.readFileString(stderrLogPath)).toHaveLength(5_013)
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)

	it.effect('adopts an existing worktree even after new commits move its HEAD', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-adopt-' })
			const source = path.join(fixture, 'source')
			const target = path.join(fixture, 'target')
			yield* initGitRepo(source)
			const executor = yield* WorkspaceSetupExecutor
			const operation = operationFor(source, target, 'adopt-branch')
			const first = yield* executor.preflightRepo(operation)
			yield* executor.createOrAdoptWorktree({ ...operation, resolvedSourceCommit: first.resolvedSourceCommit })
			const movedHead = yield* commitFile(target, 'extra.txt')
			expect(movedHead).not.toBe(first.resolvedSourceCommit)

			const second = yield* executor.preflightRepo(operation)
			expect(second.resolvedSourceCommit).toBe(movedHead)
			const adoptedWithMovedHead = yield* executor.createOrAdoptWorktree({
				...operation,
				resolvedSourceCommit: second.resolvedSourceCommit,
			})
			expect(adoptedWithMovedHead.adopted).toBe(true)
			const operationWithRecordedSourceCommit = {
				...operation,
				repo: { ...operation.repo, sourceCommit: first.resolvedSourceCommit },
			}
			const preflightWithRecordedSourceCommit = yield* executor.preflightRepo(operationWithRecordedSourceCommit)
			expect(preflightWithRecordedSourceCommit.resolvedSourceCommit).toBe(movedHead)
			const adoptedWithStaleCommit = yield* executor.createOrAdoptWorktree({
				...operationWithRecordedSourceCommit,
				resolvedSourceCommit: first.resolvedSourceCommit,
			})
			expect(adoptedWithStaleCommit.adopted).toBe(true)
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)

	it.effect('still fails preflight when the existing target is not the task worktree', () =>
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const fixture = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'workspace-executor-conflict-' })
			const source = path.join(fixture, 'source')
			yield* initGitRepo(source)
			const executor = yield* WorkspaceSetupExecutor

			const plainDir = path.join(fixture, 'plain')
			yield* fileSystem.makeDirectory(plainDir)
			const plainError = yield* executor
				.preflightRepo(operationFor(source, plainDir, 'wanted-branch'))
				.pipe(Effect.flip)
			expect(plainError.message).toContain('is not a git worktree')

			const otherRepo = path.join(fixture, 'other-repo')
			yield* initGitRepo(otherRepo)
			const foreign = path.join(fixture, 'foreign')
			yield* runProcess('git', ['-C', otherRepo, 'worktree', 'add', '-b', 'foreign-branch', foreign])
			const foreignError = yield* executor
				.preflightRepo(operationFor(source, foreign, 'foreign-branch'))
				.pipe(Effect.flip)
			expect(foreignError.message).toContain('belongs to a different repository')

			const wrongBranch = path.join(fixture, 'wrong-branch')
			yield* runProcess('git', ['-C', source, 'worktree', 'add', '-b', 'other-branch', wrongBranch])
			const wrongBranchError = yield* executor
				.preflightRepo(operationFor(source, wrongBranch, 'wanted-branch'))
				.pipe(Effect.flip)
			expect(wrongBranchError.message).toContain("is on branch 'other-branch'")
		}).pipe(Effect.provide(executorRuntimeLayer), Effect.scoped),
	)
})
