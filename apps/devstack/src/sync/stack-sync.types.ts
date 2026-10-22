import type { OrganizationSeedDefaults } from '../lib/manifest'
import type { StackPorts } from '../lib/ports'
import type { DevstackRegistry, StackRecord } from '../lib/registry'

export type SyncIntent = {
	readonly stackId: string
	readonly repoRoot: string
	readonly registryPath: string
	readonly compose: boolean
	readonly seed: boolean
	readonly dryRun?: boolean
}

export type PlanningInputs = {
	readonly now: string
	readonly nativeIconIndex: number
	readonly colorIndex: number
	readonly workosConfigured: boolean
}

export type StackAllocations = {
	readonly ports: StackPorts
	readonly redisPort: number
	readonly testRedisPort: number
}

export type StackObservation = {
	readonly registry: DevstackRegistry
	readonly workspaceStack: StackRecord | null
	readonly allocations: StackAllocations | null
	readonly composeRunning: boolean
}

export type Change<T> =
	| { readonly kind: 'create'; readonly oldValue: null; readonly newValue: T }
	| { readonly kind: 'update'; readonly oldValue: T; readonly newValue: T }
	/** Apply-time reconciliation may change the value even when the saved snapshots match. */
	| { readonly kind: 'refresh'; readonly oldValue: T; readonly newValue: T }
	| { readonly kind: 'delete'; readonly oldValue: T; readonly newValue: null }

export type StackAction =
	| { readonly type: 'reconcile-workos'; readonly change: Change<NonNullable<StackRecord['workos']>> }
	| { readonly type: 'persist-registry'; readonly change: Change<StackRecord> }
	| { readonly type: 'install-workspace-projection'; readonly change: Change<StackRecord> }
	| { readonly type: 'install-caddy-routes'; readonly change: Change<StackRecord['routes']> }
	| { readonly type: 'cleanup-legacy-redis'; readonly stack: StackRecord }
	| { readonly type: 'start-compose'; readonly stack: StackRecord }
	| { readonly type: 'setup-postgres'; readonly stack: StackRecord }
	| {
			readonly type: 'seed-organization'
			readonly organization: OrganizationSeedDefaults
	  }

export type StackPlan = {
	readonly stackId: string
	readonly repoRoot: string
	readonly registryPath: string
	readonly desired: StackRecord
	/** Registry organization captured while planning; apply must not re-read a potentially changed default. */
	readonly organization?: OrganizationSeedDefaults
	readonly actions: readonly StackAction[]
}

export type StackSyncResult = { readonly stack: StackRecord; readonly appliedActions: number }
