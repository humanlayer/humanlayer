import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { it } from '@effect/vitest'
import {
	AgentId,
	type HookConfig,
	HookRunner,
	layerInMemoryEventLog,
	layerHookRunner,
	layerLiveIdFactory,
	type PostToolUseHookInput,
	StopController,
	ToolCallId,
} from '@humanlayer/fold-core'
import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, vi } from 'vitest'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import {
	makeFoldArtifactBashSyncHook,
	makeFoldArtifactWriteSyncHook,
	makeFoldCommitAttributionHook,
	makeFoldTaskDiffCaptureHook,
	makeFoldWorkflowRoutingHook,
} from '@/effects/services/fold-sessions/fold-product-hooks'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'

import { createUniqueTempDir } from '../helpers/concurrency'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'
import { makeMockDaemonApi } from '../mocks/daemon-api.mock'

// Artifact storage lives under homedir(); point it at a private folder so these tests never read
// files another test (or a real task) left in ~/.humanlayer/riptide/artifacts.
const testHome = vi.hoisted(async () => {
	const { mkdtemp } = await import('node:fs/promises')
	const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os')
	const { join } = await import('node:path')
	return mkdtemp(join(tmpdir(), 'fold-product-hooks-home-'))
})
vi.mock('node:os', async (importOriginal) => {
	const os = await importOriginal<typeof import('node:os')>()
	const home = await testHome
	return { ...os, default: { ...os, homedir: () => home }, homedir: () => home }
})
afterAll(async () => rm(await testHome, { recursive: true, force: true }))

const runPostToolHooks = (
	hooks: HookConfig['postToolUse'],
	input: Pick<PostToolUseHookInput, 'toolName' | 'originalInput' | 'executedInput' | 'handlerResult' | 'result'>,
) =>
	Effect.gen(function* () {
		const runner = yield* HookRunner
		return yield* runner.postToolUse({
			...input,
			agentId: AgentId.create(),
			parentAgentId: null,
			toolCallId: ToolCallId.create(),
			isFailure: false,
		})
	}).pipe(
		Effect.provideService(StopController, {
			requestStop: () => Effect.void,
			isStopRequested: Effect.succeed(false),
		}),
		Effect.provide(
			layerHookRunner({ postToolUse: hooks }).pipe(
				Layer.provide(Layer.mergeAll(layerInMemoryEventLog, layerLiveIdFactory)),
			),
		),
	)

describe('Fold product hooks', () => {
	it.effect('routes only the executed namespaced RPI skill and appends guidance', () =>
		Effect.gen(function* () {
			const hook = yield* makeFoldWorkflowRoutingHook({
				sessionId: 'session-1',
				workflowType: 'rpi',
				worktreeTiming: 'now',
				isInWorktree: false,
			})

			const routed = yield* runPostToolHooks([hook], {
				toolName: 'skill',
				originalInput: { name: 'create-plan' },
				executedInput: { name: 'rpi:create-plan' },
				handlerResult: { _tag: 'text', text: 'loaded' },
				result: { _tag: 'text', text: 'loaded' },
			})
			const bare = yield* runPostToolHooks([hook], {
				toolName: 'skill',
				originalInput: { name: 'create-plan' },
				executedInput: { name: 'create-plan' },
				handlerResult: { _tag: 'text', text: 'loaded' },
				result: { _tag: 'text', text: 'loaded' },
			})

			expect(routed).toMatchObject({ _tag: 'replace', isFailure: false })
			if (routed._tag === 'replace')
				expect(routed.result).toMatchObject({
					_tag: 'text',
					text: expect.stringContaining('/rpi:implement-plan'),
				})
			expect(bare).toEqual({ _tag: 'keep' })
		}),
	)

	it.effect('preserves a preceding hook result when artifact synchronization fails', () =>
		Effect.gen(function* () {
			const hook = yield* makeFoldArtifactWriteSyncHook({
				syncManager: {
					upsertArtifact: () => Promise.reject(new Error('sync unavailable')),
					uploadS3Artifact: () => Promise.reject(new Error('sync unavailable')),
					getCollection: () => undefined,
				},
				sessionId: 'session-1',
				workingDirectory: '/repo',
				taskId: 'task-1',
				taskSlug: 'task-slug',
				ticketId: null,
				ticketProvider: null,
			}).pipe(Effect.provideService(DaemonApi, makeMockDaemonApi()))
			const result = yield* runPostToolHooks(
				[
					{
						name: 'decorate',
						handler: () =>
							Effect.succeed({ _tag: 'replace' as const, result: 'decorated', isFailure: false }),
					},
					hook,
				],
				{
					toolName: 'write',
					originalInput: { file_path: '/repo/.humanlayer/tasks/task-slug/plan.md', content: 'one' },
					executedInput: { file_path: '/repo/.humanlayer/tasks/task-slug/plan.md', content: 'two' },
					handlerResult: 'written',
					result: 'written',
				},
			)

			expect(result).toEqual({ _tag: 'replace', result: 'decorated', isFailure: false })
		}),
	)

	it.effect('uploads files a shell command left in the task directory', () =>
		Effect.gen(function* () {
			const cwd = yield* Effect.promise(() => createUniqueTempDir('fold-artifact-bash-sync-test'))
			const taskId = crypto.randomUUID()
			const taskDir = join(cwd, '.humanlayer', 'tasks', 'task-slug')
			yield* Effect.promise(() => mkdir(taskDir, { recursive: true }))
			yield* Effect.promise(() => writeFile(join(taskDir, 'shot.png'), Buffer.from([1, 2, 3])))
			yield* Effect.promise(() => writeFile(join(taskDir, 'notes.md'), '# notes'))

			const upserts: Array<{ fileName: string }> = []
			const uploads: Array<{ fileName: string }> = []
			const hook = yield* makeFoldArtifactBashSyncHook({
				syncManager: {
					upsertArtifact: async (input) => {
						upserts.push(input)
						return { artifactId: `text-${upserts.length}` }
					},
					uploadS3Artifact: async (input) => {
						uploads.push(input)
						return { artifactId: `binary-${uploads.length}` }
					},
					getCollection: () => undefined,
				},
				sessionId: 'session-1',
				workingDirectory: cwd,
				taskId,
				taskSlug: 'task-slug',
				ticketId: null,
				ticketProvider: null,
			}).pipe(Effect.provideService(DaemonApi, makeMockDaemonApi()))

			const result = yield* runPostToolHooks([hook], {
				toolName: 'bash',
				originalInput: { command: 'cp /tmp/shot.png .' },
				executedInput: { command: 'cp /tmp/shot.png .' },
				handlerResult: 'copied',
				result: 'copied',
			})

			yield* Effect.promise(() => rm(cwd, { recursive: true, force: true }))
			expect(uploads.map((upload) => upload.fileName)).toEqual(['shot.png'])
			expect(upserts.map((upsert) => upsert.fileName)).toEqual(['notes.md'])
			expect(result).toEqual({ _tag: 'keep' })
		}),
	)

	it.effect('schedules task diff capture only after successful mutating tools', () =>
		Effect.gen(function* () {
			const captures: Array<{ taskId: string; sessionId: string }> = []
			const hook = yield* makeFoldTaskDiffCaptureHook({ taskId: 'task-1', sessionId: 'session-1' }).pipe(
				Effect.provide(UnusedGitRequirements),
				Effect.provideService(TaskDiffServiceRegistry, {
					requestCapture: (input) =>
						Effect.sync(() => {
							captures.push(input)
						}),
					registerWorkspace: () => Effect.void,
					suspendWorkspace: () => Effect.void,
					resumeWorkspace: () => Effect.void,
					drain: Effect.void,
				}),
			)

			for (const toolName of ['write', 'edit', 'apply_patch', 'bash']) {
				yield* runPostToolHooks([hook], {
					toolName,
					originalInput: {},
					executedInput: {},
					handlerResult: {},
					result: {},
				})
			}
			yield* runPostToolHooks([hook], {
				toolName: 'read',
				originalInput: {},
				executedInput: {},
				handlerResult: {},
				result: {},
			})

			expect(captures).toEqual([
				{ taskId: 'task-1', sessionId: 'session-1' },
				{ taskId: 'task-1', sessionId: 'session-1' },
				{ taskId: 'task-1', sessionId: 'session-1' },
				{ taskId: 'task-1', sessionId: 'session-1' },
			])
		}),
	)

	it.effect('records successful Fold tool inputs and preserves results when attribution fails', () =>
		Effect.gen(function* () {
			const recorded: unknown[] = []
			const hook = yield* makeFoldCommitAttributionHook({
				sessionId: 'session-1',
				workingDirectory: '/workspace',
				recordActivity: (input) => {
					recorded.push(input)
					throw new Error('injected attribution failure')
				},
			})

			const result = yield* runPostToolHooks([hook], {
				toolName: 'edit',
				originalInput: { oldText: 'before' },
				executedInput: { oldText: 'before', newText: 'after' },
				handlerResult: { _tag: 'text', text: 'edited' },
				result: { _tag: 'text', text: 'edited' },
			})

			expect(result).toEqual({ _tag: 'keep' })
			expect(recorded).toEqual([
				{
					workingDirectory: '/workspace',
					sessionId: 'session-1',
					toolName: 'edit',
					toolInput: { oldText: 'before', newText: 'after' },
				},
			])
		}),
	)
})
