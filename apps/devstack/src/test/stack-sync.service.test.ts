import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { SyncApplyEnvironment, type SyncApplyEnvironmentShape } from '../environment/sync-apply-environment'
import { SyncPlanningEnvironment, type SyncPlanningEnvironmentShape } from '../environment/sync-planning-environment'
import { STACK_PORT_NAMES, type StackPorts } from '../lib/ports'
import { emptyRegistry } from '../lib/registry'
import { StackSync, StackSyncLive } from '../sync/stack-sync.service'

const allocations = {
	ports: Object.fromEntries(STACK_PORT_NAMES.map((name, index) => [name, 30_000 + index])) as StackPorts,
	redisPort: 31_000,
	testRedisPort: 33_000,
}

const calls: string[] = []
const environment: SyncPlanningEnvironmentShape = {
	resolveStackId: (intent) => Effect.sync(() => (calls.push('identity'), intent.stackId)),
	loadRegistry: () => Effect.sync(() => (calls.push('registry'), emptyRegistry())),
	loadWorkspaceStack: () => Effect.sync(() => (calls.push('workspace'), null)),
	allocate: () => Effect.sync(() => (calls.push('ports'), allocations)),
	loadPlanningInputs: () =>
		Effect.sync(() => {
			calls.push('inputs')
			return { now: '2026-07-12T00:00:00.000Z', nativeIconIndex: 4, colorIndex: 2, workosConfigured: false }
		}),
	isComposeRunning: () => Effect.succeed(false),
}

const applyEnvironment: SyncApplyEnvironmentShape = {
	reconcileWorkOS: (stack) => Effect.succeed(stack),
	persistRegistry: () => Effect.succeed(emptyRegistry()),
	installWorkspaceProjection: () => Effect.void,
	installCaddyRoutes: () => Effect.void,
	cleanupLegacyRedis: () => Effect.void,
	startCompose: () => Effect.void,
	setupPostgres: () => Effect.void,
	seedOrganization: () => Effect.void,
}

const testLayer = StackSyncLive.pipe(
	Layer.provideMerge(
		Layer.merge(
			Layer.succeed(SyncPlanningEnvironment, environment),
			Layer.succeed(SyncApplyEnvironment, applyEnvironment),
		),
	),
)

describe.skipIf(Boolean(process.env.CI))('StackSync', () => {
	it.effect('plans through replaceable Effect environment seams', () =>
		Effect.gen(function* () {
			calls.length = 0
			const sync = yield* StackSync
			const plan = yield* sync.plan({
				stackId: 'effect-test',
				repoRoot: '/tmp/effect-test',
				registryPath: '/tmp/registry.json',
				compose: false,
				seed: false,
			})
			expect(calls).toEqual(['identity', 'registry', 'workspace', 'ports', 'inputs'])
			expect(plan.stackId).toBe('effect-test')
			expect(plan.desired.nativeIcon).toBe('icons/devstack/icon-4.png')
		}).pipe(Effect.provide(testLayer)),
	)

	it.effect('applies an empty plan through the deep interface', () =>
		Effect.gen(function* () {
			const sync = yield* StackSync
			const result = yield* sync.apply({
				stackId: 'unused',
				repoRoot: '/tmp/unused',
				registryPath: '/tmp/unused-registry.json',
				desired: {} as never,
				actions: [],
			})
			expect(result.appliedActions).toBe(0)
		}).pipe(Effect.provide(testLayer)),
	)
})
