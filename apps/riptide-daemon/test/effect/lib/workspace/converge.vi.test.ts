import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { expect } from 'vitest'

import { WorkspacePathResolver } from '@/effects/services/workspace-path-resolver/workspace-path-resolver.service'
import { WorkspaceSetupCommandError } from '@/effects/services/workspace-setup-executor/workspace-setup-executor.errors'
import {
	WorkspaceSetupExecutor,
	type WorkspaceSetupExecutorService,
} from '@/effects/services/workspace-setup-executor/workspace-setup-executor.service'
import { convergeWorkspace } from '@/lib/workspace/converge'

import { makeMockDaemonApiLayer } from '../../../mocks/daemon-api.mock'

const spec = {
	specVersion: 1,
	directory: '/repo',
	workspaceBaseDirectory: '/wt/task',
	setupBlocksFirstSession: false,
	repos: [
		{
			localPath: '.',
			targetPath: '/wt/task/repo',
			branch: 'task',
			sourceRef: 'HEAD',
			setupCommand: 'bun install',
			copyGlobs: ['.env'],
			primary: true,
		},
	],
} as const

const input = {
	spec,
	setupRowId: 'row-1',
	setupState: { specVersion: 1, repos: [{ localPath: '.', status: 'setup_requested' as const }] },
	taskId: 'task-1',
	sessionId: 'session-1',
	hostId: 'host-1',
}

const makeApiLayer = (updates: unknown[]) =>
	makeMockDaemonApiLayer({
		updateWorkspaceSetup: (update) => {
			updates.push(update)
			return Effect.succeed({ transactionId: `tx-${updates.length}` })
		},
	})

const successfulExecutor: WorkspaceSetupExecutorService = {
	preflightRepo: () => Effect.succeed({ resolvedSourceCommit: 'abc123' }),
	createOrAdoptWorktree: () => Effect.succeed({ targetPath: '/wt/task/repo', adopted: false }),
	copyConfiguredFiles: () => Effect.succeed({ filesCopied: ['.env'] }),
	runSetupCommand: () => Effect.succeed({ command: 'bun install', exitCode: 0 }),
}

const workspacePathResolverLayer = Layer.succeed(
	WorkspacePathResolver,
	WorkspacePathResolver.of({
		resolveSourceDirectory: (input) => Effect.succeed(input.directory),
		resolveTargetDirectory: (input) => Effect.succeed(input.targetPath),
	}),
)
const convergenceOperationalLayer = Layer.mergeAll(NodeServices.layer, workspacePathResolverLayer)

describe('convergeWorkspace', () => {
	it.effect('persists every ordered stage and writes compatibility state at the worktree gate', () => {
		const updates: Array<{ repo?: { status: string }; workspaceState?: unknown }> = []
		const layer = Layer.mergeAll(
			makeApiLayer(updates),
			Layer.succeed(WorkspaceSetupExecutor, successfulExecutor),
			convergenceOperationalLayer,
		)
		return convergeWorkspace(input).pipe(
			Effect.provide(layer),
			Effect.andThen(
				Effect.sync(() => {
					expect(updates.map((update) => update.repo?.status)).toEqual([
						'preflight',
						'worktree',
						'copy_globs',
						'setup_command',
						'done',
					])
					expect(updates[2]?.workspaceState).toBeDefined()
				}),
			),
		)
	})

	it.effect('converges every stage without session context', () => {
		const updates: Array<{ repo?: { status: string } }> = []
		const layer = Layer.mergeAll(
			makeApiLayer(updates),
			Layer.succeed(WorkspaceSetupExecutor, successfulExecutor),
			convergenceOperationalLayer,
		)
		const { sessionId: _sessionId, ...withoutSession } = input
		return convergeWorkspace(withoutSession).pipe(
			Effect.provide(layer),
			Effect.andThen(
				Effect.sync(() => {
					expect(updates.at(-1)?.repo?.status).toBe('done')
				}),
			),
		)
	})

	it.effect('parks the row once when setup command execution fails', () => {
		const updates: Array<{ error?: { stage: string } | null }> = []
		const failingExecutor: WorkspaceSetupExecutorService = {
			...successfulExecutor,
			runSetupCommand: (operation) =>
				Effect.fail(
					new WorkspaceSetupCommandError({
						taskId: operation.taskId,
						hostId: operation.hostId,
						localPath: operation.repo.localPath,
						stage: 'setup_command',
						message: 'install failed',
						exitCode: 1,
					}),
				),
		}
		const layer = Layer.mergeAll(
			makeApiLayer(updates),
			Layer.succeed(WorkspaceSetupExecutor, failingExecutor),
			convergenceOperationalLayer,
		)
		return convergeWorkspace(input).pipe(
			Effect.provide(layer),
			Effect.andThen(
				Effect.sync(() => {
					expect(updates.at(-1)?.error?.stage).toBe('setup_command')
					expect(updates.filter((update) => update.error !== undefined)).toHaveLength(1)
				}),
			),
		)
	})

	it.effect('persists each repo as soon as its setup command completes', () =>
		Effect.gen(function* () {
			const releaseSlowCommand = yield* Deferred.make<void>()
			const fastRepoPersisted = yield* Deferred.make<void>()
			const updates: Array<{ repo?: { localPath: string; status: string } }> = []
			const twoRepoSpec = {
				...spec,
				repos: [
					{ ...spec.repos[0], localPath: '.', targetPath: '/wt/task/repo' },
					{ ...spec.repos[0], localPath: '../slow', targetPath: '/wt/task/slow', primary: false },
				],
			} as const
			const setupCommandInput = {
				...input,
				spec: twoRepoSpec,
				setupState: {
					specVersion: 1 as const,
					repos: [
						{ localPath: '.', status: 'setup_command' as const },
						{ localPath: '../slow', status: 'setup_command' as const },
					],
				},
			}
			const executor: WorkspaceSetupExecutorService = {
				...successfulExecutor,
				runSetupCommand: (operation) =>
					operation.repo.localPath === '../slow'
						? Deferred.await(releaseSlowCommand).pipe(Effect.as({ command: 'bun install', exitCode: 0 }))
						: Effect.succeed({ command: 'bun install', exitCode: 0 }),
			}
			const apiLayer = makeMockDaemonApiLayer({
				updateWorkspaceSetup: (update) =>
					Effect.sync(() => updates.push(update)).pipe(
						Effect.andThen(
							update.repo?.localPath === '.'
								? Deferred.succeed(fastRepoPersisted, undefined)
								: Effect.void,
						),
						Effect.as({ transactionId: `tx-${updates.length}` }),
					),
			})
			const layer = Layer.mergeAll(
				apiLayer,
				Layer.succeed(WorkspaceSetupExecutor, executor),
				convergenceOperationalLayer,
			)

			const fiber = yield* convergeWorkspace(setupCommandInput).pipe(Effect.provide(layer), Effect.forkChild)
			yield* Deferred.await(fastRepoPersisted)
			expect(updates).toEqual([
				{
					rowId: 'row-1',
					taskId: 'task-1',
					repo: { localPath: '.', status: 'done', setupCommand: { command: 'bun install', exitCode: 0 } },
				},
			])

			yield* Deferred.succeed(releaseSlowCommand, undefined)
			yield* Fiber.join(fiber)
			expect(updates.map((update) => update.repo?.localPath)).toEqual(['.', '../slow'])
		}),
	)
})
