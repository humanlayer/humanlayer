import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer, Ref } from 'effect'
import { expect } from 'vitest'

import { AvailablePortsProbe } from '../environment/available-ports-probe'
import { ComposeRuntimeProbe } from '../environment/compose-runtime-probe'
import { SyncApplyEnvironment, SyncApplyEnvironmentLive, WorkOSResources } from '../environment/sync-apply-environment'
import { SyncPlanningEnvironment, SyncPlanningEnvironmentLive } from '../environment/sync-planning-environment'
import { emptyRegistry, type StackRecord } from '../lib/registry'
import { OrganizationSeed } from '../lib/seed'
import { WorkOSResourcesClient } from '../lib/workos-resources'
import { formatStackPlan } from '../sync/format-stack-plan'
import { planStackSync } from '../sync/stack-sync-plan'
import { StackSync, StackSyncLive } from '../sync/stack-sync.service'
import type { PlanningInputs, StackAllocations, SyncIntent } from '../sync/stack-sync.types'
import { createFakeWorkOSServer } from './fixtures/workos-server'

const intent: SyncIntent = {
	stackId: 'workos-recovery',
	repoRoot: '/synthetic/repo',
	registryPath: '/synthetic/registry.json',
	compose: false,
	seed: false,
}
const inputs: PlanningInputs = {
	now: '2026-07-12T00:00:00.000Z',
	nativeIconIndex: 1,
	colorIndex: 0,
	workosConfigured: false,
}
const allocations: StackAllocations = {
	ports: {
		ui: 10000,
		cloud: 10001,
		api: 10002,
		electricProxy: 10003,
		docs: 10004,
		adminApi: 10005,
		adminUi: 10006,
		postgres: 10007,
		electric: 10008,
		rivetEngine: 10009,
		rivetServices: 10010,
		minioApi: 10011,
		minioConsole: 10012,
		tanstackDevtools: 10013,
		testPostgres: 10014,
		testElectric: 10015,
		testRivetEngine: 10016,
		testRivetServices: 10017,
	},
	redisPort: 10018,
	testRedisPort: 10019,
}
const initial = planStackSync(
	intent,
	{
		registry: emptyRegistry(),
		workspaceStack: null,
		allocations,
		composeRunning: false,
	},
	inputs,
).desired

const unexpected = () => Effect.die('Unexpected side effect in WorkOS recovery test')

describe('WorkOS credential recovery', () => {
	for (const configured of [false, true]) {
		it.effect(`reads only credential availability for planning (configured=${configured})`, () =>
			Effect.gen(function* () {
				const environment = yield* SyncPlanningEnvironment
				const loaded = yield* environment.loadPlanningInputs()
				expect(loaded.workosConfigured).toBe(configured)
				expect(JSON.stringify(loaded)).not.toContain('sandbox-key')
			}).pipe(
				Effect.provide(
					SyncPlanningEnvironmentLive.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(AvailablePortsProbe, { allocate: unexpected }),
								Layer.succeed(ComposeRuntimeProbe, { isRunning: unexpected }),
							),
						),
					),
				),
				Effect.provide(
					ConfigProvider.layer(
						ConfigProvider.fromUnknown(configured ? { WORKOS_API_KEY: 'sandbox-key' } : {}),
					),
				),
			),
		)
	}

	it.effect('recovers an unchanged unconfigured stack, persists resource IDs, then converges to a no-op', () =>
		Effect.gen(function* () {
			const server = createFakeWorkOSServer()
			const client = new WorkOSResourcesClient({
				apiKey: 'sandbox-key',
				baseUrl: server.baseUrl,
				fetch: server.fetch,
			})
			const registry = yield* Ref.make({ ...emptyRegistry(), stacks: { [initial.id]: initial } })
			const workspace = yield* Ref.make<StackRecord | null>(initial)
			const configured = yield* Ref.make(false)
			const writes = yield* Ref.make<string[]>([])
			// Use the live WorkOS actuator; substitute only remote HTTP and local persistence seams.
			const liveApply = yield* SyncApplyEnvironment.pipe(
				Effect.provide(
					SyncApplyEnvironmentLive.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(WorkOSResources, client),
								Layer.succeed(OrganizationSeed, { seed: unexpected }),
							),
						),
					),
				),
			)
			const services = Layer.mergeAll(
				Layer.succeed(SyncPlanningEnvironment, {
					resolveStackId: () => Effect.succeed(initial.id),
					loadRegistry: () => Ref.get(registry),
					loadWorkspaceStack: () => Ref.get(workspace),
					loadPlanningInputs: () =>
						Ref.get(configured).pipe(Effect.map((workosConfigured) => ({ ...inputs, workosConfigured }))),
					allocate: unexpected,
					isComposeRunning: unexpected,
				}),
				Layer.succeed(SyncApplyEnvironment, {
					reconcileWorkOS: liveApply.reconcileWorkOS,
					persistRegistry: ({ stack }) =>
						Effect.gen(function* () {
							yield* Ref.update(writes, (values) => [...values, 'registry'])
							return yield* Ref.updateAndGet(registry, (value) => ({
								...value,
								stacks: { ...value.stacks, [stack.id]: stack },
							}))
						}),
					installWorkspaceProjection: ({ stack }) =>
						Ref.set(workspace, stack).pipe(
							Effect.andThen(Ref.update(writes, (values) => [...values, 'workspace'])),
						),
					installCaddyRoutes: unexpected,
					cleanupLegacyRedis: unexpected,
					startCompose: unexpected,
					setupPostgres: unexpected,
					seedOrganization: unexpected,
				}),
			)
			yield* Effect.gen(function* () {
				const sync = yield* StackSync
				const unavailable = yield* sync.plan(intent)
				expect(unavailable.actions).toEqual([])
				expect((yield* sync.apply(unavailable)).appliedActions).toBe(0)
				yield* Ref.set(configured, true)
				const dryRun = yield* sync.plan({ ...intent, dryRun: true })
				expect(dryRun.actions.map((action) => action.type)).toEqual([
					'reconcile-workos',
					'persist-registry',
					'install-workspace-projection',
				])
				expect(formatStackPlan(dryRun)).toContain('reconcile WorkOS resources: refresh')
				expect(server.requests).toEqual([])
				expect(yield* Ref.get(writes)).toEqual([])
				expect((yield* Ref.get(registry)).stacks[initial.id]).toEqual(initial)
				expect(yield* Ref.get(workspace)).toEqual(initial)
				const plan = yield* sync.plan(intent)
				expect(plan).toEqual(dryRun)
				const result = yield* sync.apply(plan)
				expect(result.appliedActions).toBe(3)
				expect(result.stack.workos?.status).toBe('healthy')
				for (const key of [
					'redirectUri',
					'corsOriginResource',
					'appRedirectUriResource',
					'appCorsOriginResource',
				] as const) {
					expect(result.stack.workos?.[key]?.id).toBeDefined()
				}
				expect((yield* Ref.get(registry)).stacks[initial.id]).toEqual(result.stack)
				expect(yield* Ref.get(workspace)).toEqual(result.stack)
				expect(yield* Ref.get(writes)).toEqual(['registry', 'workspace'])
				expect(server.resources.redirectUri).toHaveLength(2)
				expect(server.resources.corsOrigin).toHaveLength(2)
				const requestCount = server.requests.length
				const repeat = yield* sync.plan(intent)
				expect(repeat.actions).toEqual([])
				expect((yield* sync.apply(repeat)).appliedActions).toBe(0)
				expect(server.requests).toHaveLength(requestCount)
				expect(yield* Ref.get(writes)).toEqual(['registry', 'workspace'])
			}).pipe(Effect.provide(StackSyncLive.pipe(Layer.provideMerge(services))))
		}),
	)
})
