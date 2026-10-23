import { Data } from 'effect'

import {
	createApiManifest,
	createRivetManifest,
	createElectricManifest,
	createMinioManifest,
	createPostgresManifest,
	createRedisManifest,
	createTestServicesManifest,
	createWorkOSResourceState,
	redisPortFromManifest,
	redisVolumeFromManifest,
} from '../lib/manifest'
import type { StackPorts } from '../lib/ports'
import type { StackRecord } from '../lib/registry'
import { createStackRoutes } from '../lib/routes'
import { allocateStackColor } from '../lib/stack-colors'
import { createStackIdentity, type StackIdentity } from '../lib/stack-id'
import type { Change, PlanningInputs, StackAction, StackObservation, StackPlan, SyncIntent } from './stack-sync.types'

/** The concrete port assignments a {@link StackRecord} is projected from. */
export type StackRecordAllocation = {
	readonly ports: StackPorts
	readonly redisPort: number
	readonly testRedisPort: number
}

/**
 * Project a {@link StackRecord} from a resolved set of ports/subnets, carrying every non-port
 * datum (secrets, volumes, createdAt, workos) forward from `existing`. Both `sync` (which prefers
 * the ports already on the record) and `reallocate` (which forces a fresh set) build records here
 * so the two paths can never drift in how a record is shaped.
 */
export function projectStackRecord(params: {
	readonly identity: StackIdentity
	readonly existing: StackRecord | null
	readonly worktreePath: string
	readonly allocation: StackRecordAllocation
	readonly now: string
	readonly nativeIconIndex: number
	readonly tabColor: string
}): StackRecord {
	const { identity, existing, worktreePath, allocation, now, nativeIconIndex, tabColor } = params
	const { ports } = allocation
	const routes = createStackRoutes(identity.id)
	return {
		id: identity.id,
		displayName: identity.displayName,
		worktreePath,
		composeProject: identity.dockerName,
		tauriSuffix: identity.tauriSuffix,
		nativeIcon: existing?.nativeIcon ?? `icons/devstack/icon-${nativeIconIndex}.png`,
		tabColor,
		ports,
		routes,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		postgres: createPostgresManifest({
			composeProject: identity.dockerName,
			postgresPort: ports.postgres,
			postgresPassword: existing?.postgres.postgresPassword,
			postgresVolume: existing?.postgres.postgresVolume ?? `riptide-${identity.id}-postgres`,
		}),
		api: createApiManifest(ports.api, routes.api),
		electric: createElectricManifest({
			stackId: identity.id,
			electricPort: ports.electric,
			electricProxyPort: ports.electricProxy,
			electricSecret: existing?.electric.electricSecret,
		}),
		rivet: createRivetManifest({
			composeProject: identity.dockerName,
			enginePort: ports.rivetEngine,
			servicesPort: ports.rivetServices,
		}),
		minio: createMinioManifest({
			composeProject: identity.dockerName,
			apiPort: ports.minioApi,
			consolePort: ports.minioConsole,
			volume: existing?.minio?.volume,
			bucket: existing?.minio?.bucket,
			accessKeyId: existing?.minio?.accessKeyId,
			secretAccessKey: existing?.minio?.secretAccessKey,
		}),
		redis: createRedisManifest({
			composeProject: identity.dockerName,
			port: allocation.redisPort,
			volume: redisVolumeFromManifest(existing?.redis),
		}),
		testServices: createTestServicesManifest({
			stackId: identity.id,
			composeProject: identity.dockerName,
			postgresPort: ports.testPostgres,
			electricPort: ports.testElectric,
			rivetEnginePort: ports.testRivetEngine,
			rivetServicesPort: ports.testRivetServices,
			redisPort: allocation.testRedisPort,
			existing: existing?.testServices,
		}),
		workos: { ...createWorkOSResourceState(identity.id), ...existing?.workos },
	}
}

export class StackPlanningError extends Data.TaggedError('StackPlanningError')<{ readonly reason: string }> {
	override get message(): string {
		return this.reason
	}
}

const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

function change<T>(oldValue: T | null, newValue: T, refresh = false): Change<T> | null {
	if (oldValue === null) return { kind: 'create', oldValue: null, newValue }
	if (!equal(oldValue, newValue)) return { kind: 'update', oldValue, newValue }
	return refresh ? { kind: 'refresh', oldValue, newValue } : null
}

function assertAllocationsAvailable(observation: StackObservation): NonNullable<StackObservation['allocations']> {
	const allocations = observation.allocations
	if (!allocations) throw new StackPlanningError({ reason: 'No available allocation input was provided' })
	const ports = [...Object.values(allocations.ports), allocations.redisPort, allocations.testRedisPort]
	if (new Set(ports).size !== ports.length)
		throw new StackPlanningError({ reason: 'Allocation input contains duplicate ports' })
	return allocations
}

/**
 * Resolve the concrete ports a stack projects from. Fresh allocations are required only for new
 * stacks; an existing stack carries its ports forward from its own manifest, so the two cases never
 * share a nullable allocation.
 */
function resolveStackAllocation(existing: StackRecord | null, observation: StackObservation): StackRecordAllocation {
	if (!existing) {
		const allocations = assertAllocationsAvailable(observation)
		return { ports: allocations.ports, redisPort: allocations.redisPort, testRedisPort: allocations.testRedisPort }
	}
	const redisPort = redisPortFromManifest(existing.redis)
	const testRedisPort = redisPortFromManifest(existing.testServices?.redis)
	if (redisPort === undefined || testRedisPort === undefined) {
		throw new StackPlanningError({ reason: `Existing stack "${existing.id}" is missing its Redis port manifest` })
	}
	return { ports: existing.ports, redisPort, testRedisPort }
}

export function planStackSync(intent: SyncIntent, observation: StackObservation, inputs: PlanningInputs): StackPlan {
	const identity = createStackIdentity(intent.stackId)
	const existing = observation.registry.stacks[identity.id] ?? null
	if (existing && existing.worktreePath !== intent.repoRoot) {
		throw new StackPlanningError({
			reason: `Stack "${identity.id}" is already registered to ${existing.worktreePath}`,
		})
	}
	const candidate = projectStackRecord({
		identity,
		existing,
		worktreePath: intent.repoRoot,
		allocation: resolveStackAllocation(existing, observation),
		now: inputs.now,
		nativeIconIndex: inputs.nativeIconIndex,
		tabColor: existing?.tabColor ?? allocateStackColor(observation.registry, inputs.colorIndex),
	})
	const unchangedCandidate = existing ? { ...candidate, updatedAt: existing.updatedAt } : candidate
	const desired = existing && equal(existing, unchangedCandidate) ? existing : candidate
	const actions: StackAction[] = []
	const desiredWorkos = desired.workos
	// Credentials can become available without any change to the registered resource snapshot.
	const retryWorkos = inputs.workosConfigured && desiredWorkos?.status === 'unconfigured'
	let reconcileWorkos = false
	if (desiredWorkos) {
		const workosChange = change(existing?.workos ?? null, desiredWorkos, retryWorkos)
		reconcileWorkos = workosChange !== null
		if (workosChange) actions.push({ type: 'reconcile-workos', change: workosChange })
	}
	// Persist and project the apply-time result, not only changes known while planning.
	const registryChange = change(existing, desired, reconcileWorkos)
	if (registryChange) actions.push({ type: 'persist-registry', change: registryChange })
	const projectionChange = change(observation.workspaceStack, desired, reconcileWorkos)
	if (projectionChange) actions.push({ type: 'install-workspace-projection', change: projectionChange })
	const routesChange = change(existing?.routes ?? null, desired.routes)
	if (routesChange) actions.push({ type: 'install-caddy-routes', change: routesChange })
	if (intent.compose) {
		actions.push({ type: 'cleanup-legacy-redis', stack: desired })
		if (!observation.composeRunning) actions.push({ type: 'start-compose', stack: desired })
		actions.push({ type: 'setup-postgres', stack: desired })
	}
	if (intent.seed) {
		const organization = observation.registry.defaults?.organization
		if (!organization) {
			throw new StackPlanningError({
				reason: 'No local organization is configured; run devstack set-local-org before using --seed',
			})
		}
		actions.push({ type: 'seed-organization', organization })
	}
	return {
		stackId: identity.id,
		repoRoot: intent.repoRoot,
		registryPath: intent.registryPath,
		desired,
		organization: observation.registry.defaults?.organization,
		actions,
	}
}
