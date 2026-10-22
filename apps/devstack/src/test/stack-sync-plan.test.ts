import { describe, expect, it } from 'vitest'

import { STACK_PORT_NAMES, type StackPorts } from '../lib/ports'
import { emptyRegistry, type DevstackRegistry } from '../lib/registry'
import { formatStackPlan } from '../sync/format-stack-plan'
import { planStackSync, StackPlanningError } from '../sync/stack-sync-plan'
import type { StackAllocations, StackObservation, SyncIntent } from '../sync/stack-sync.types'

const intent = (overrides: Partial<SyncIntent> = {}): SyncIntent => ({
	stackId: 'feature/one',
	repoRoot: '/repo/one',
	registryPath: '/registry.json',
	compose: false,
	seed: false,
	...overrides,
})

const allocations = (): StackAllocations => ({
	ports: Object.fromEntries(STACK_PORT_NAMES.map((name, index) => [name, 10_000 + index])) as StackPorts,
	redisPort: 20_000,
	testRedisPort: 22_000,
})

const observe = (overrides: Partial<StackObservation> = {}): StackObservation => ({
	registry: emptyRegistry(),
	workspaceStack: null,
	allocations: allocations(),
	composeRunning: false,
	...overrides,
})
const inputs = { now: '2026-07-12T00:00:00.000Z', nativeIconIndex: 3, colorIndex: 0, workosConfigured: false }

describe.skipIf(Boolean(process.env.CI))('planStackSync', () => {
	it('plans a first sync in domain execution order', () => {
		const plan = planStackSync(intent(), observe(), inputs)
		expect(plan.desired.nativeIcon).toBe('icons/devstack/icon-3.png')
		expect(plan.desired.tabColor).toBe('#d0679d')
		expect(plan.actions.map((action) => action.type)).toEqual([
			'reconcile-workos',
			'persist-registry',
			'install-workspace-projection',
			'install-caddy-routes',
		])
	})

	it('preserves values and converges to a repeat no-op', () => {
		const first = planStackSync(intent(), observe(), inputs)
		const registry: DevstackRegistry = { version: 1, stacks: { [first.stackId]: first.desired } }
		const repeat = planStackSync(
			intent(),
			observe({ registry, workspaceStack: first.desired, allocations: null }),
			{
				now: '2027-01-01T00:00:00.000Z',
				nativeIconIndex: 6,
				colorIndex: 4,
				workosConfigured: false,
			},
		)
		expect(first.desired.nativeIcon).toBe('icons/devstack/icon-3.png')
		expect(repeat.desired.nativeIcon).toBe(first.desired.nativeIcon)
		expect(repeat.desired).toBe(first.desired)
		expect(repeat.actions).toEqual([])
	})

	it('allocates an unused Poimandres color to each new stack', () => {
		const first = planStackSync(intent(), observe(), inputs)
		const registry: DevstackRegistry = { version: 1, stacks: { [first.stackId]: first.desired } }
		const second = planStackSync(
			intent({ stackId: 'feature/two', repoRoot: '/repo/two' }),
			observe({ registry }),
			inputs,
		)
		expect(second.desired.tabColor).toBe('#5de4c7')
	})

	it('plans only a changed workspace projection when registry state is current', () => {
		const first = planStackSync(intent(), observe(), inputs)
		const registry: DevstackRegistry = { version: 1, stacks: { [first.stackId]: first.desired } }
		const stale = { ...first.desired, nativeIcon: 'icons/devstack/icon-1.png' }
		const plan = planStackSync(intent(), observe({ registry, workspaceStack: stale, allocations: null }), inputs)
		expect(plan.actions.map((action) => action.type)).toEqual(['install-workspace-projection'])
		expect(formatStackPlan(plan)).toContain('update (nativeIcon)')
	})

	it('captures organization defaults in the plan-time snapshot', () => {
		const organization = { id: 'internal-id', workosOrganizationId: 'org_workos', name: 'Local Org' }
		const registry = { ...emptyRegistry(), defaults: { organization } }
		const plan = planStackSync(intent(), observe({ registry }), inputs)

		expect(plan.organization).toEqual(organization)
	})

	it.each([
		[{ compose: true }, ['cleanup-legacy-redis', 'start-compose', 'setup-postgres']],
		[{ seed: true }, ['seed-organization']],
		[
			{ compose: true, seed: true },
			['cleanup-legacy-redis', 'start-compose', 'setup-postgres', 'seed-organization'],
		],
	] as const)('adds optional actions for %o', (options, suffix) => {
		const registry = {
			...emptyRegistry(),
			defaults: {
				organization: { id: 'org-id', workosOrganizationId: 'workos-org-id', name: 'Local Org' },
			},
		}
		const plan = planStackSync(intent(options), observe({ registry }), inputs)
		expect(plan.actions.map((action) => action.type).slice(-suffix.length)).toEqual(suffix)
	})

	it('rejects seed planning when organization configuration is missing', () => {
		expect(() => planStackSync(intent({ seed: true }), observe(), inputs)).toThrow(
			'No local organization is configured',
		)
	})

	it('cleans legacy Redis without reconverging unrelated running services', () => {
		const plan = planStackSync(intent({ compose: true }), observe({ composeRunning: true }), inputs)
		expect(plan.actions.map((action) => action.type).slice(-2)).toEqual(['cleanup-legacy-redis', 'setup-postgres'])
	})

	it('preserves existing allocations without fresh allocation input', () => {
		const first = planStackSync(intent(), observe(), inputs)
		const registry: DevstackRegistry = { version: 1, stacks: { [first.stackId]: first.desired } }
		const plan = planStackSync(
			intent(),
			observe({ registry, workspaceStack: first.desired, allocations: null }),
			inputs,
		)
		expect(plan.desired.ports).toBe(first.desired.ports)
	})

	it('rejects ownership conflicts', () => {
		const first = planStackSync(intent(), observe(), inputs)
		const registry: DevstackRegistry = {
			version: 1,
			stacks: { [first.stackId]: { ...first.desired, worktreePath: '/other' } },
		}
		expect(() => planStackSync(intent(), observe({ registry }), inputs)).toThrow(StackPlanningError)
	})

	it('rejects missing or duplicate allocation input', () => {
		expect(() => planStackSync(intent(), observe({ allocations: null }), inputs)).toThrow('No available allocation')
		const base = allocations()
		const duplicate = { ...base, redisPort: base.ports.ui }
		expect(() => planStackSync(intent(), observe({ allocations: duplicate }), inputs)).toThrow('duplicate ports')
	})

	it('migrates an existing cluster-shaped record to standalone Redis', () => {
		const first = planStackSync(intent(), observe(), inputs)
		const legacy = {
			...first.desired,
			redis: {
				dataPorts: [20_000, 20_001, 20_002, 20_003, 20_004, 20_005],
				busPorts: [21_000, 21_001, 21_002, 21_003, 21_004, 21_005],
				subnet: '10.200.1.0/24',
				nodeIps: [],
				volumes: ['legacy-redis-0'],
				natMap: {},
				url: 'redis://127.0.0.1:20000',
			},
		} as unknown as typeof first.desired
		const registry: DevstackRegistry = { version: 1, stacks: { [first.stackId]: legacy } }
		const plan = planStackSync(intent(), observe({ registry, workspaceStack: legacy, allocations: null }), inputs)
		expect(plan.desired.redis).toEqual({
			port: 20_000,
			volume: 'legacy-redis-0',
			url: 'redis://127.0.0.1:20000',
		})
		expect(plan.actions.map((action) => action.type)).toContain('persist-registry')
	})
})
