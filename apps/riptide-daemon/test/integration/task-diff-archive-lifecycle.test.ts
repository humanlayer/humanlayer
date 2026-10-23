import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { DurableStream } from '@durable-streams/client'
import { DurableStreamTestServer } from '@durable-streams/server'
import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { parseTaskDiffFileRow, TaskDiffWorkspace } from '@humanlayer/streams/diff'
import { ConfigProvider, Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { expect } from 'vitest'

import { DurableStreamFetchLive } from '../../src/effects/services/stream-producer/durable-stream-fetch'
import { TaskDiffChangeEnvelope } from '../../src/effects/services/task-diff/diff-envelope'
import { DiffStreamWriterFactoryLive } from '../../src/effects/services/task-diff/diff-stream-writer.layer'
import { DurableStreamsDiffProducerFactoryLive } from '../../src/effects/services/task-diff/durable-streams-diff-producer.layer'
import {
	GitCommandRunnerLive,
	GitRunnerConfigurationLive,
} from '../../src/effects/services/task-diff/git-command-runner.layer'
import { GitFileSystemLive } from '../../src/effects/services/task-diff/git-file-system.layer'
import { TaskDiffLifecycleObserverLive } from '../../src/effects/services/task-diff/task-diff-lifecycle-observer.layer'
import { TaskDiffLifecycleObserver } from '../../src/effects/services/task-diff/task-diff-lifecycle-observer.service'
import { TaskDiffLockRegistryLive } from '../../src/effects/services/task-diff/task-diff-lock-registry.layer'
import { TaskDiffServiceRegistryLive } from '../../src/effects/services/task-diff/task-diff-service-registry.layer'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { TaskDiffServiceFactoryLive } from '../../src/effects/services/task-diff/task-diff-service.layer'
import { TaskDiffStreamProxyTestServer } from './helpers/task-diff-stream-proxy-test-server'

const execFileAsync = promisify(execFile)
const git = async (cwd: string, ...args: ReadonlyArray<string>): Promise<string> =>
	(await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout.trim()

const makeRuntime = (proxyOrigin: string, durableStreamsOrigin: string) => {
	const config = Layer.succeed(
		ConfigProvider.ConfigProvider,
		ConfigProvider.fromUnknown({
			RIPTIDE_SYNC_ORIGIN: proxyOrigin,
			RIPTIDE_DURABLE_STREAMS_ORIGIN: durableStreamsOrigin,
			RIPTIDE_DAEMON_TOKEN: 'fixture-daemon-token',
		}),
	)
	const gitFileSystem = GitFileSystemLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
				Layer.provideMerge(BunServices.layer),
			),
		),
	)
	const producerFactory = DurableStreamsDiffProducerFactoryLive.pipe(
		Layer.provide(
			DiffStreamWriterFactoryLive.pipe(
				Layer.provide(config),
				Layer.provide(DurableStreamFetchLive.pipe(Layer.provide(config))),
			),
		),
	)
	const serviceFactory = TaskDiffServiceFactoryLive.pipe(
		Layer.provideMerge(Layer.mergeAll(gitFileSystem, producerFactory, TaskDiffLockRegistryLive, BunServices.layer)),
	)
	const registry = TaskDiffServiceRegistryLive.pipe(Layer.provideMerge(serviceFactory))
	return ManagedRuntime.make(Layer.merge(registry, TaskDiffLifecycleObserverLive.pipe(Layer.provide(registry))))
}

const readFiles = async (url: string) => {
	const response = await new DurableStream({ url, contentType: 'application/json' }).stream({
		live: false,
		offset: '-1',
	})
	return Schema.decodeUnknownSync(Schema.Array(TaskDiffChangeEnvelope))(await response.json())
		.filter((event) => event.type === 'task-diff-file' && event.headers.operation === 'insert')
		.map((event) => parseTaskDiffFileRow(event.value))
}

const waitForFiles = async (url: string, count: number) => {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			const files = await readFiles(url)
			if (files.length >= count) return files
		} catch {
			// The resumed producer may still be recreating the stream.
		}
		await new Promise((resolve) => setTimeout(resolve, 20))
	}
	throw new Error(`Timed out waiting for ${count} task diff files`)
}

describe('task diff archive lifecycle integration', () => {
	it.effect('deletes both streams on archive and rebuilds them on eligible unarchive', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'task-diff-archive-lifecycle-')))
			const parent = join(root, 'parent')
			const worktree = join(root, 'worktree')
			const server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
			let proxy: TaskDiffStreamProxyTestServer | undefined
			let runtime: ReturnType<typeof makeRuntime> | undefined

			try {
				yield* Effect.promise(() => server.start())
				const activeProxy = new TaskDiffStreamProxyTestServer(server.url)
				proxy = activeProxy
				yield* Effect.promise(() => activeProxy.start())
				yield* Effect.promise(() => git(root, 'init', '--initial-branch=main', parent))
				yield* Effect.promise(() => git(parent, 'config', 'user.email', 'task-diff@example.com'))
				yield* Effect.promise(() => git(parent, 'config', 'user.name', 'Task Diff Test'))
				yield* Effect.promise(() => writeFile(join(parent, 'base.txt'), 'base\n'))
				yield* Effect.promise(() => git(parent, 'add', '--all'))
				yield* Effect.promise(() => git(parent, 'commit', '-m', 'base'))
				const sourceCommit = yield* Effect.promise(() => git(parent, 'rev-parse', 'HEAD'))
				yield* Effect.promise(() =>
					git(parent, 'worktree', 'add', '-b', 'task-worktree', worktree, sourceCommit),
				)

				const workspace = yield* Schema.decodeUnknownEffect(TaskDiffWorkspace)({
					organizationId: 'org-archive',
					taskId: 'task-archive',
					hostId: 'host-archive',
					workspaceBaseDirectory: worktree,
					repos: [{ id: 'repo-archive', absolutePath: worktree, sourceRef: sourceCommit }],
				})
				runtime = makeRuntime(activeProxy.url, server.url)
				const activeRuntime = runtime
				yield* Effect.promise(() =>
					activeRuntime.runPromise(
						Effect.gen(function* () {
							const observer = yield* TaskDiffLifecycleObserver
							yield* observer.initialize({
								tasks: [{ taskId: 'task-archive', archived: false }],
								workspaces: [{ taskId: 'task-archive', workspace }],
							})
						}),
					),
				)
				yield* Effect.promise(() => writeFile(join(worktree, 'before-archive.txt'), 'before archive\n'))
				yield* Effect.promise(() =>
					activeRuntime.runPromise(
						Effect.gen(function* () {
							const registry = yield* TaskDiffServiceRegistry
							yield* registry.requestCapture({ taskId: 'task-archive', sessionId: 'session-archive' })
							const observer = yield* TaskDiffLifecycleObserver
							yield* observer.observeTask({ taskId: 'task-archive', archived: true })
						}),
					),
				)

				const baseUrl = `${server.url}/v1/stream/organizations/org-archive/tasks/task-archive`
				const fileUrl = `${baseUrl}/diff-files`
				const versionUrl = `${baseUrl}/diff-file-versions`
				yield* Effect.promise(() =>
					Promise.all([DurableStream.delete({ url: fileUrl }), DurableStream.delete({ url: versionUrl })]),
				)
				yield* Effect.promise(() => writeFile(join(worktree, 'while-archived.txt'), 'while archived\n'))
				yield* Effect.promise(() =>
					activeRuntime.runPromise(
						Effect.gen(function* () {
							const registry = yield* TaskDiffServiceRegistry
							yield* registry.requestCapture({ taskId: 'task-archive', sessionId: 'ignored-session' })
						}),
					),
				)

				const [fileHead, versionHead] = yield* Effect.promise(() =>
					Promise.all([DurableStream.head({ url: fileUrl }), DurableStream.head({ url: versionUrl })]),
				)
				expect(fileHead.exists).toBe(false)
				expect(versionHead.exists).toBe(false)

				yield* Effect.promise(() =>
					activeRuntime.runPromise(
						Effect.gen(function* () {
							const observer = yield* TaskDiffLifecycleObserver
							yield* observer.observeTask({ taskId: 'task-archive', archived: false })
						}),
					),
				)
				const files = yield* Effect.promise(() => waitForFiles(fileUrl, 2))
				expect(files.map((file) => file.path).sort()).toEqual(['before-archive.txt', 'while-archived.txt'])
				expect((yield* Effect.promise(() => DurableStream.head({ url: versionUrl }))).exists).toBe(true)
			} finally {
				if (runtime) {
					const activeRuntime = runtime
					yield* Effect.promise(() =>
						activeRuntime.runPromise(
							Effect.gen(function* () {
								const registry = yield* TaskDiffServiceRegistry
								yield* registry.drain
							}),
						),
					)
					yield* Effect.promise(() => activeRuntime.dispose())
				}
				if (proxy) {
					const activeProxy = proxy
					yield* Effect.promise(() => activeProxy.stop())
				}
				yield* Effect.promise(() => server.stop())
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }))
			}
		}),
	)
})
