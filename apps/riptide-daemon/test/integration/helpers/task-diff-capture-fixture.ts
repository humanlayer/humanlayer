import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { DurableStream } from '@durable-streams/client'
import { DurableStreamTestServer } from '@durable-streams/server'
import * as BunServices from '@effect/platform-bun/BunServices'
import {
	parseTaskDiffFileBaselineRow,
	parseTaskDiffFileRow,
	parseTaskDiffFileVersionRow,
	TaskDiffWorkspace,
	type TaskDiffFileBaselineRowType,
	type TaskDiffFileRowType,
	type TaskDiffFileVersionRowType,
} from '@humanlayer/streams/diff'
import { ConfigProvider, Effect, Layer, ManagedRuntime, Schema } from 'effect'

import { DurableStreamFetchLive } from '../../../src/effects/services/stream-producer/durable-stream-fetch'
import { TaskDiffChangeEnvelope } from '../../../src/effects/services/task-diff/diff-envelope'
import { DiffStreamWriterFactoryLive } from '../../../src/effects/services/task-diff/diff-stream-writer.layer'
import { DurableStreamsDiffProducerFactoryLive } from '../../../src/effects/services/task-diff/durable-streams-diff-producer.layer'
import {
	GitCommandRunnerLive,
	GitRunnerConfigurationLive,
} from '../../../src/effects/services/task-diff/git-command-runner.layer'
import { GitFileSystemLive } from '../../../src/effects/services/task-diff/git-file-system.layer'
import { TaskDiffLockRegistryLive } from '../../../src/effects/services/task-diff/task-diff-lock-registry.layer'
import { TaskDiffServiceRegistryLive } from '../../../src/effects/services/task-diff/task-diff-service-registry.layer'
import { TaskDiffServiceRegistry } from '../../../src/effects/services/task-diff/task-diff-service-registry.service'
import { TaskDiffServiceFactoryLive } from '../../../src/effects/services/task-diff/task-diff-service.layer'
import { TaskDiffStreamProxyTestServer } from './task-diff-stream-proxy-test-server'

const execFileAsync = promisify(execFile)
const contentType = 'application/json'

const git = async (cwd: string, ...args: ReadonlyArray<string>): Promise<string> =>
	(await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout.trim()

const readEnvelopes = async (url: string) => {
	const response = await new DurableStream({ url, contentType }).stream({ live: false, offset: '-1' })
	return Schema.decodeUnknownSync(Schema.Array(TaskDiffChangeEnvelope))(await response.json())
}

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
	return ManagedRuntime.make(TaskDiffServiceRegistryLive.pipe(Layer.provideMerge(serviceFactory)))
}

export type TaskDiffCaptureFixtureRuntime = ReturnType<typeof makeRuntime>

export interface TaskDiffCaptureFixtureContext {
	readonly root: string
	readonly worktree: string
	readonly taskId: string
	readonly sessionId: string
	readonly runtime: TaskDiffCaptureFixtureRuntime
	readonly waitForPublicationCounts: (counts: { readonly files: number; readonly versions: number }) => Promise<void>
}

export interface TaskDiffCaptureFixtureResult {
	readonly files: ReadonlyArray<TaskDiffFileRowType>
	/** Keys of `diff-files` delete events, in stream order. */
	readonly deletes: ReadonlyArray<string>
	readonly baselines: ReadonlyArray<TaskDiffFileBaselineRowType>
	readonly versions: ReadonlyArray<TaskDiffFileVersionRowType>
}

export async function runTaskDiffCaptureFixture(options: {
	readonly tempDirectoryPrefix: string
	readonly organizationId: string
	readonly taskId: string
	readonly hostId: string
	readonly sessionId: string
	readonly capture: (context: TaskDiffCaptureFixtureContext) => Promise<void>
}): Promise<TaskDiffCaptureFixtureResult> {
	const root = await mkdtemp(join(tmpdir(), options.tempDirectoryPrefix))
	const parent = join(root, 'parent')
	const worktree = join(root, 'worktree')
	const server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
	let proxy: TaskDiffStreamProxyTestServer | undefined
	let runtime: TaskDiffCaptureFixtureRuntime | undefined

	try {
		await server.start()
		proxy = new TaskDiffStreamProxyTestServer(server.url)
		await proxy.start()
		await git(root, 'init', '--initial-branch=main', parent)
		await git(parent, 'config', 'user.email', 'task-diff@example.com')
		await git(parent, 'config', 'user.name', 'Task Diff Test')
		await writeFile(join(parent, 'modified.txt'), 'before\n')
		await git(parent, 'add', '--all')
		await git(parent, 'commit', '-m', 'base')
		const sourceCommit = await git(parent, 'rev-parse', 'HEAD')
		await git(parent, 'worktree', 'add', '-b', 'task-worktree', worktree, sourceCommit)

		const workspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
			organizationId: options.organizationId,
			taskId: options.taskId,
			hostId: options.hostId,
			workspaceBaseDirectory: worktree,
			repos: [{ id: 'repo-fixture', absolutePath: worktree, sourceRef: sourceCommit }],
		})
		runtime = makeRuntime(proxy.url, server.url)
		const baseUrl = `${server.url}/v1/stream/organizations/${options.organizationId}/tasks/${options.taskId}`
		const waitForPublicationCounts = async (counts: { readonly files: number; readonly versions: number }) => {
			const deadline = Date.now() + 5_000
			while (Date.now() < deadline) {
				try {
					const [files, versionEvents] = await Promise.all([
						readEnvelopes(`${baseUrl}/diff-files`),
						readEnvelopes(`${baseUrl}/diff-file-versions`),
					])
					const versions = versionEvents.filter((envelope) => envelope.type === 'task-diff-file-version')
					if (files.length >= counts.files && versions.length >= counts.versions) return
				} catch {
					// Streams may not exist until the first capture starts.
				}
				await new Promise((resolve) => setTimeout(resolve, 10))
			}
			throw new Error(`Timed out waiting for ${counts.files} file and ${counts.versions} version publications`)
		}
		await runtime.runPromise(
			Effect.gen(function* () {
				const registry = yield* TaskDiffServiceRegistry
				yield* registry.registerWorkspace(workspace)
			}),
		)

		await options.capture({
			root,
			worktree,
			taskId: options.taskId,
			sessionId: options.sessionId,
			runtime,
			waitForPublicationCounts,
		})
		await runtime.runPromise(
			Effect.gen(function* () {
				const registry = yield* TaskDiffServiceRegistry
				yield* registry.drain
			}),
		)

		const [fileEnvelopes, versionEnvelopes] = await Promise.all([
			readEnvelopes(`${baseUrl}/diff-files`),
			readEnvelopes(`${baseUrl}/diff-file-versions`),
		])
		return {
			files: fileEnvelopes
				.filter((envelope) => envelope.type === 'task-diff-file' && envelope.headers.operation === 'insert')
				.map((envelope) => parseTaskDiffFileRow(envelope.value)),
			deletes: fileEnvelopes
				.filter((envelope) => envelope.type === 'task-diff-file' && envelope.headers.operation === 'delete')
				.map((envelope) => envelope.key),
			baselines: versionEnvelopes
				.filter((envelope) => envelope.type === 'task-diff-file-baseline')
				.map((envelope) => parseTaskDiffFileBaselineRow(envelope.value)),
			versions: versionEnvelopes
				.filter((envelope) => envelope.type === 'task-diff-file-version')
				.map((envelope) => parseTaskDiffFileVersionRow(envelope.value)),
		}
	} finally {
		if (runtime) await runtime.dispose()
		if (proxy) await proxy.stop()
		await server.stop()
		await rm(root, { recursive: true, force: true })
	}
}
