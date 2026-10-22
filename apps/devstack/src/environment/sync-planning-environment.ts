import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { Config, Context, Data, DateTime, Effect, Layer, Option } from 'effect'

import { isDevstackEnvBlockFresh, renderStackEnvLines } from '../lib/env-block'
import { redisPortFromManifest } from '../lib/manifest'
import { readRegistry, type DevstackRegistry, type StackRecord } from '../lib/registry'
import { DEVSTACK_COLORS } from '../lib/stack-colors'
import { createStackIdentity } from '../lib/stack-id'
import { readWorkspaceConfig } from '../lib/workspace-config'
import type { PlanningInputs, StackAllocations, SyncIntent } from '../sync/stack-sync.types'
import { AvailablePortsProbe } from './available-ports-probe'
import { ComposeRuntimeProbe } from './compose-runtime-probe'

export class SyncPlanningEnvironmentError extends Data.TaggedError('SyncPlanningEnvironmentError')<{
	readonly operation: string
	readonly reason: string
	readonly cause?: unknown
}> {}

export interface SyncPlanningEnvironmentShape {
	readonly loadRegistry: (path: string) => Effect.Effect<DevstackRegistry, SyncPlanningEnvironmentError>
	readonly loadWorkspaceStack: (
		intent: SyncIntent,
		registry: DevstackRegistry,
	) => Effect.Effect<StackRecord | null, SyncPlanningEnvironmentError>
	readonly resolveStackId: (intent: SyncIntent) => Effect.Effect<string, SyncPlanningEnvironmentError>
	readonly loadPlanningInputs: () => Effect.Effect<PlanningInputs, SyncPlanningEnvironmentError>
	readonly allocate: (
		registry: DevstackRegistry,
		stackId: string,
	) => Effect.Effect<StackAllocations, SyncPlanningEnvironmentError>
	readonly isComposeRunning: (input: {
		readonly stack: StackRecord
		readonly registryPath: string
		readonly initializeDockerConfig?: boolean
	}) => Effect.Effect<boolean, SyncPlanningEnvironmentError>
}

export class SyncPlanningEnvironment extends Context.Service<SyncPlanningEnvironment, SyncPlanningEnvironmentShape>()(
	'devstack/SyncPlanningEnvironment',
) {}

const attempt = <A>(operation: string, evaluate: () => Promise<A>): Effect.Effect<A, SyncPlanningEnvironmentError> =>
	Effect.tryPromise({
		try: evaluate,
		catch: (cause) =>
			new SyncPlanningEnvironmentError({
				operation,
				reason: String(cause),
				cause,
			}),
	}).pipe(Effect.withSpan(`devstack.environment.${operation}`))

function collectRegistryPortExclusions(registry: DevstackRegistry, stackId: string): Set<number> {
	return new Set(
		Object.values(registry.stacks)
			.filter((stack) => stack.id !== stackId)
			.flatMap((stack) => {
				const redisPort = redisPortFromManifest(stack.redis)
				const testRedisPort = redisPortFromManifest(stack.testServices?.redis)
				const excludedPorts: number[] = [...Object.values(stack.ports)]
				if (redisPort) excludedPorts.push(redisPort)
				if (testRedisPort) excludedPorts.push(testRedisPort)
				return excludedPorts
			}),
	)
}

export const SyncPlanningEnvironmentLive = Layer.effect(
	SyncPlanningEnvironment,
	Effect.gen(function* () {
		const availablePorts = yield* AvailablePortsProbe
		const composeRuntime = yield* ComposeRuntimeProbe
		return {
			loadRegistry: (path) => attempt('load_registry', () => readRegistry(path)),
			loadWorkspaceStack: (intent, registry) =>
				attempt('load_workspace', async () => {
					const workspace = await readWorkspaceConfig(intent.repoRoot)
					const stack = workspace ? registry.stacks[workspace.stackId] : undefined
					if (!stack) return null
					const existingEnv = await readFile(join(intent.repoRoot, '.env'), 'utf8').catch(
						(error: unknown) => {
							if (
								typeof error === 'object' &&
								error !== null &&
								'code' in error &&
								error.code === 'ENOENT'
							)
								return ''
							throw error
						},
					)
					return isDevstackEnvBlockFresh(
						existingEnv,
						renderStackEnvLines(stack, intent.registryPath, registry.defaults?.organization?.id),
					)
						? stack
						: null
				}),
			resolveStackId: (intent) =>
				attempt('load_stack_identity', async () => {
					if (intent.stackId) return createStackIdentity(intent.stackId).id
					const workspace = await readWorkspaceConfig(intent.repoRoot)
					if (workspace?.stackId) return workspace.stackId
					const process = Bun.spawn(['git', '-C', intent.repoRoot, 'branch', '--show-current'], {
						stdout: 'pipe',
					})
					const output = await new Response(process.stdout).text()
					const branch = (await process.exited) === 0 ? output.trim() : ''
					return createStackIdentity(branch || basename(intent.repoRoot)).id
				}),
			loadPlanningInputs: () =>
				Effect.gen(function* () {
					const apiKey = yield* Config.option(Config.Redacted('WORKOS_API_KEY')).pipe(
						Effect.mapError(
							() =>
								new SyncPlanningEnvironmentError({
									operation: 'load_planning_inputs',
									reason: 'Unable to read WorkOS credential availability',
								}),
						),
					)
					const randomValues = yield* Effect.sync(() => crypto.getRandomValues(new Uint8Array(2)))
					const iconSeed = randomValues[0] ?? 0
					const colorSeed = randomValues[1] ?? 0
					return {
						now: DateTime.formatIso(yield* DateTime.now),
						nativeIconIndex: (iconSeed % 6) + 1,
						colorIndex: colorSeed % DEVSTACK_COLORS.length,
						workosConfigured: Option.isSome(apiKey),
					}
				}),
			allocate: (registry, stackId) => {
				const reserved = collectRegistryPortExclusions(registry, stackId)
				return availablePorts.allocate({ excludedPorts: reserved }).pipe(
					Effect.catchTag('AvailablePortsProbeError', (error) =>
						Effect.fail(
							new SyncPlanningEnvironmentError({
								operation: 'probe_available_ports',
								reason: error.reason,
								cause: error,
							}),
						),
					),
				)
			},
			isComposeRunning: (input) =>
				composeRuntime.isRunning(input).pipe(
					Effect.catchTag('ComposeRuntimeProbeError', (error) =>
						Effect.fail(
							new SyncPlanningEnvironmentError({
								operation: 'probe_compose_runtime',
								reason: error.reason,
								cause: error,
							}),
						),
					),
				),
		} satisfies SyncPlanningEnvironmentShape
	}),
)
