import { describe, expect, it } from '@effect/vitest'
import { ActorSystemDefault, ActorSystemService } from '@humanlayer/effect-machine'
import type {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupStage,
} from '@humanlayer/schemas/effect/project-workspace'
import { Effect, Layer, Ref } from 'effect'

import { DaemonWorkspaceRepositoryStatusChanged } from '@/effects/services/daemon-api/daemon-api.errors'
import {
	WorkspaceRepositoryActorOperations,
	WorkspaceRepositoryParked,
} from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'
import {
	makeWorkspaceRepositorySetupMachine,
	WorkspaceRepositorySetupState,
} from '@/effects/services/workspace-repository-setup/workspace-repository-setup.machine'

import { UnusedRepositoryOperationRequirements } from '../helpers/unused-repository-requirements'
import {
	remainingWorkspaceSetupOperationStubs,
	workspaceRepositorySnapshotAt as snapshotAt,
} from '../helpers/workspace-repository-snapshot'

const next = (snapshot: WorkspaceRepositoryActorSnapshot, status: WorkspaceRepositorySetupStage) => ({
	...snapshot,
	status: { ...snapshot.status, status, updatedAt: snapshot.status.updatedAt + 1 },
})

describe('workspace repository setup machine', () => {
	it.effect('runs real state tasks through a provided operations layer', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<string>>([])
			const record =
				(name: string, status: WorkspaceRepositorySetupStage) => (snapshot: WorkspaceRepositoryActorSnapshot) =>
					Ref.update(calls, (seen) => [...seen, name]).pipe(Effect.as(next(snapshot, status)))
			const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
				start: record('start', 'checking_source'),
				checkSource: record('checkSource', 'cloning_source'),
				cloneSource: record('cloneSource', 'refreshing_source'),
				refreshSource: record('refreshSource', 'resolving_commit'),
				resolveCommit: (snapshot) =>
					Ref.update(calls, (seen) => [...seen, 'resolveCommit']).pipe(
						Effect.as({
							...next(snapshot, 'materializing'),
							status: { ...next(snapshot, 'materializing').status, resolvedCommit: 'a'.repeat(40) },
						}),
					),
				materialize: record('materialize', 'copying_files'),
				publishBranch: () => Effect.die('unused'),
				copyFiles: record('copyFiles', 'running_setup_command'),
				runSetupCommand: record('runSetupCommand', 'done'),
			})

			const final = yield* Effect.gen(function* () {
				const system = yield* ActorSystemService
				const actor = yield* system.spawn(
					'workspace-repository-success',
					makeWorkspaceRepositorySetupMachine(snapshotAt('setup_requested')),
				)
				return yield* actor.awaitFinal
			}).pipe(
				Effect.provide(ActorSystemDefault),
				Effect.provide(OperationsTest),
				Effect.provide(UnusedRepositoryOperationRequirements),
			)

			expect(final._tag).toBe('Done')
			expect(yield* Ref.get(calls)).toEqual([
				'start',
				'checkSource',
				'cloneSource',
				'refreshSource',
				'resolveCommit',
				'materialize',
				'copyFiles',
				'runSetupCommand',
			])
		}),
	)

	it.effect('reconciles a conflict snapshot instead of advancing from local success', () =>
		Effect.gen(function* () {
			const current = snapshotAt('refreshing_source', 10)
			const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
				...remainingWorkspaceSetupOperationStubs,
				start: () => Effect.fail(new DaemonWorkspaceRepositoryStatusChanged({ snapshot: current })),
				checkSource: () => Effect.die('unused'),
				refreshSource: (snapshot) => Effect.succeed(next(snapshot, 'resolving_commit')),
				resolveCommit: (snapshot) => Effect.succeed(next(snapshot, 'materializing')),
				materialize: (snapshot) => Effect.succeed(next(snapshot, 'done')),
			})
			const final = yield* Effect.gen(function* () {
				const system = yield* ActorSystemService
				const actor = yield* system.spawn(
					'workspace-repository-conflict',
					makeWorkspaceRepositorySetupMachine(snapshotAt('setup_requested')),
				)
				return yield* actor.awaitFinal
			}).pipe(
				Effect.provide(ActorSystemDefault),
				Effect.provide(OperationsTest),
				Effect.provide(UnusedRepositoryOperationRequirements),
			)
			expect(final._tag).toBe('Done')
		}),
	)

	it.effect('parks when a stage failure has been durably acknowledged', () =>
		Effect.gen(function* () {
			const failed = {
				...snapshotAt('checking_source', 2),
				status: {
					...snapshotAt('checking_source', 2).status,
					error: { stage: 'checking_source' as const, message: 'source missing' },
				},
			}
			const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
				...remainingWorkspaceSetupOperationStubs,
				start: () => Effect.die('unused'),
				checkSource: () => Effect.fail(new WorkspaceRepositoryParked({ snapshot: failed })),
				refreshSource: () => Effect.die('unused'),
				resolveCommit: () => Effect.die('unused'),
				materialize: () => Effect.die('unused'),
			})
			const final = yield* Effect.gen(function* () {
				const system = yield* ActorSystemService
				const actor = yield* system.spawn(
					'workspace-repository-parked',
					makeWorkspaceRepositorySetupMachine(snapshotAt('checking_source')),
				)
				return yield* actor.awaitFinal
			}).pipe(
				Effect.provide(ActorSystemDefault),
				Effect.provide(OperationsTest),
				Effect.provide(UnusedRepositoryOperationRequirements),
			)
			expect(final).toEqual(WorkspaceRepositorySetupState.Parked({ snapshot: failed }))
		}),
	)

	it.effect('reports unexpected failures through the failed state', () =>
		Effect.gen(function* () {
			const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
				...remainingWorkspaceSetupOperationStubs,
				start: () => Effect.die(new Error('unexpected setup defect')),
				checkSource: () => Effect.die('unused'),
				refreshSource: () => Effect.die('unused'),
				resolveCommit: () => Effect.die('unused'),
				materialize: () => Effect.die('unused'),
			})
			const final = yield* Effect.gen(function* () {
				const system = yield* ActorSystemService
				const actor = yield* system.spawn(
					'workspace-repository-defect',
					makeWorkspaceRepositorySetupMachine(snapshotAt('setup_requested')),
				)
				return yield* actor.awaitFinal
			}).pipe(
				Effect.provide(ActorSystemDefault),
				Effect.provide(OperationsTest),
				Effect.provide(UnusedRepositoryOperationRequirements),
			)
			expect(final._tag).toBe('Failed')
		}),
	)
})
