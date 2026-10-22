import { Context, Effect, Layer } from 'effect'

import { SyncApplyEnvironment } from '../environment/sync-apply-environment'
import { SyncPlanningEnvironment } from '../environment/sync-planning-environment'
import type { StackRecord } from '../lib/registry'
import { allocateStackColor } from '../lib/stack-colors'
import { createStackIdentity } from '../lib/stack-id'
import { applyStackSync } from './stack-sync-apply'
import { planStackSync, projectStackRecord } from './stack-sync-plan'
import { StackSyncApplyError, StackSyncPlanError } from './stack-sync.errors'
import type { StackPlan, StackSyncResult, SyncIntent } from './stack-sync.types'

export type StackReallocation = { readonly previous: StackRecord; readonly stack: StackRecord }

export interface StackSyncShape {
	readonly plan: (intent: SyncIntent) => Effect.Effect<StackPlan, StackSyncPlanError>
	readonly apply: (plan: StackPlan) => Effect.Effect<StackSyncResult, StackSyncApplyError, SyncApplyEnvironment>
	/**
	 * Allocate a fresh, verified-available set of ports for an already-registered stack and persist
	 * it to the global registry. Unlike {@link StackSyncShape.plan}/apply this touches only the
	 * registry record — no Compose, Caddy, or workspace projection convergence runs.
	 */
	readonly reallocate: (
		intent: SyncIntent,
	) => Effect.Effect<StackReallocation, StackSyncPlanError | StackSyncApplyError>
}

export class StackSync extends Context.Service<StackSync, StackSyncShape>()('devstack/StackSync') {}

export const StackSyncLive = Layer.effect(
	StackSync,
	Effect.gen(function* () {
		const environment = yield* SyncPlanningEnvironment
		const applyEnvironment = yield* SyncApplyEnvironment
		return {
			plan: (intent) =>
				Effect.gen(function* () {
					const stackId = yield* environment.resolveStackId(intent)
					const resolvedIntent = { ...intent, stackId }
					const registry = yield* environment.loadRegistry(intent.registryPath)
					const workspaceStack = yield* environment.loadWorkspaceStack(resolvedIntent, registry)
					const allocations = registry.stacks[stackId] ? null : yield* environment.allocate(registry, stackId)
					const existing = registry.stacks[stackId]
					const composeRunning =
						intent.compose && existing
							? yield* environment.isComposeRunning({
									stack: existing,
									registryPath: intent.registryPath,
									initializeDockerConfig: intent.dryRun !== true,
								})
							: false
					const inputs = yield* environment.loadPlanningInputs()
					return yield* Effect.try({
						try: () =>
							planStackSync(
								resolvedIntent,
								{ registry, workspaceStack, allocations, composeRunning },
								inputs,
							),
						catch: (cause) => new StackSyncPlanError({ reason: 'Unable to build stack plan', cause }),
					})
				}).pipe(
					Effect.tapError(() =>
						Effect.logError('Devstack sync planning failed').pipe(
							Effect.annotateLogs({ stackId: intent.stackId ?? 'auto' }),
						),
					),
					Effect.catchTag('SyncPlanningEnvironmentError', (error) =>
						Effect.fail(
							new StackSyncPlanError({ reason: `${error.operation}: ${error.reason}`, cause: error }),
						),
					),
					Effect.withSpan('devstack.plan_sync', { attributes: { stackId: intent.stackId ?? 'auto' } }),
				),
			apply: (plan) =>
				applyStackSync(plan).pipe(
					Effect.withSpan('devstack.apply_sync', { attributes: { stackId: plan.stackId } }),
				),
			reallocate: (intent) =>
				Effect.gen(function* () {
					const stackId = yield* environment.resolveStackId(intent)
					const registry = yield* environment.loadRegistry(intent.registryPath)
					const previous = registry.stacks[stackId]
					if (!previous) {
						return yield* Effect.fail(
							new StackSyncPlanError({
								reason: `Stack "${stackId}" is not registered; run \`devstack sync\` before reallocating its ports`,
							}),
						)
					}
					if (previous.worktreePath !== intent.repoRoot && intent.stackId === '') {
						return yield* Effect.fail(
							new StackSyncPlanError({
								reason: `Stack "${stackId}" is registered to ${previous.worktreePath}; pass --stack ${stackId} to reallocate it from elsewhere`,
							}),
						)
					}
					const allocation = yield* environment.allocate(registry, stackId)
					const inputs = yield* environment.loadPlanningInputs()
					const stack = yield* Effect.try({
						try: () =>
							projectStackRecord({
								identity: createStackIdentity(stackId),
								existing: previous,
								worktreePath: previous.worktreePath,
								allocation,
								now: inputs.now,
								nativeIconIndex: inputs.nativeIconIndex,
								tabColor: previous.tabColor ?? allocateStackColor(registry, inputs.colorIndex),
							}),
						catch: (cause) =>
							new StackSyncPlanError({ reason: 'Unable to project reallocated stack', cause }),
					})
					yield* applyEnvironment.persistRegistry({ registryPath: intent.registryPath, stack }).pipe(
						Effect.catchTag('SyncApplyEnvironmentError', (error) =>
							Effect.fail(
								new StackSyncApplyError({
									action: 'persist-registry',
									actionIndex: 0,
									reason: `${error.operation}: ${error.reason}`,
									cause: error,
								}),
							),
						),
					)
					return { previous, stack }
				}).pipe(
					Effect.catchTag('SyncPlanningEnvironmentError', (error) =>
						Effect.fail(
							new StackSyncPlanError({ reason: `${error.operation}: ${error.reason}`, cause: error }),
						),
					),
					Effect.withSpan('devstack.reallocate_ports', {
						attributes: { stackId: intent.stackId ?? 'auto' },
					}),
				),
		} satisfies StackSyncShape
	}),
)
