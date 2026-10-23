import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Config, Context, Data, Effect, Layer, Option, Redacted, Schedule } from 'effect'

import { regenerateCaddyConfig } from '../lib/caddy'
import {
	createComposeUpCommand,
	createLegacyRedisContainerListCommand,
	createLegacyRedisContainerRemovalCommand,
	parseLegacyRedisContainerIds,
} from '../lib/compose'
import { createDevstackDockerProcessEnvironment } from '../lib/docker-config'
import { renderStackEnvLines, replaceDevstackEnvBlock } from '../lib/env-block'
import type { OrganizationSeedDefaults } from '../lib/manifest'
import { writeNativeStackConfig } from '../lib/native-config'
import { waitForPostgres } from '../lib/postgres'
import { readRegistry, withRegistryLock, writeRegistry, type DevstackRegistry, type StackRecord } from '../lib/registry'
import { OrganizationSeed } from '../lib/seed'
import { reconcileWorkOSResources, WorkOSResourcesClient } from '../lib/workos-resources'
import { writeWorkspaceConfig } from '../lib/workspace-config'

export class SyncApplyEnvironmentError extends Data.TaggedError('SyncApplyEnvironmentError')<{
	readonly operation: string
	readonly reason: string
	readonly cause?: unknown
}> {}

export interface SyncApplyEnvironmentShape {
	readonly reconcileWorkOS: (stack: StackRecord) => Effect.Effect<StackRecord, SyncApplyEnvironmentError>
	readonly persistRegistry: (input: {
		readonly registryPath: string
		readonly stack: StackRecord
	}) => Effect.Effect<DevstackRegistry, SyncApplyEnvironmentError>
	readonly installWorkspaceProjection: (input: {
		readonly repoRoot: string
		readonly registryPath: string
		readonly stack: StackRecord
		readonly organization?: OrganizationSeedDefaults
	}) => Effect.Effect<void, SyncApplyEnvironmentError>
	readonly installCaddyRoutes: (input: {
		readonly registryPath: string
		readonly registry: DevstackRegistry
	}) => Effect.Effect<void, SyncApplyEnvironmentError>
	readonly cleanupLegacyRedis: (stack: StackRecord) => Effect.Effect<void, SyncApplyEnvironmentError>
	readonly startCompose: (input: {
		readonly registryPath: string
		readonly stack: StackRecord
		readonly organization?: OrganizationSeedDefaults
	}) => Effect.Effect<void, SyncApplyEnvironmentError>
	readonly setupPostgres: (stack: StackRecord) => Effect.Effect<void, SyncApplyEnvironmentError>
	readonly seedOrganization: (input: {
		readonly stack: StackRecord
		readonly organization: OrganizationSeedDefaults
	}) => Effect.Effect<void, SyncApplyEnvironmentError>
}

export class SyncApplyEnvironment extends Context.Service<SyncApplyEnvironment, SyncApplyEnvironmentShape>()(
	'devstack/SyncApplyEnvironment',
) {}

const attempt = <A>(operation: string, evaluate: () => Promise<A>): Effect.Effect<A, SyncApplyEnvironmentError> =>
	Effect.tryPromise({
		try: evaluate,
		catch: (cause) =>
			new SyncApplyEnvironmentError({
				operation,
				reason: String(cause),
				cause,
			}),
	}).pipe(Effect.withSpan(`devstack.environment.${operation}`))

async function readEnv(path: string): Promise<string> {
	try {
		return await readFile(path, 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
		throw error
	}
}

async function installWorkspaceProjection(
	repoRoot: string,
	registryPath: string,
	stack: StackRecord,
	organization?: OrganizationSeedDefaults,
): Promise<void> {
	const envPath = join(repoRoot, '.env')
	const existing = await readEnv(envPath)
	const updated = replaceDevstackEnvBlock(existing, renderStackEnvLines(stack, registryPath, organization?.id))
	const temporaryPath = `${envPath}.${process.pid}.${crypto.randomUUID()}.tmp`
	await writeFile(temporaryPath, updated, { mode: 0o600 })
	await rename(temporaryPath, envPath)
	await writeNativeStackConfig(repoRoot, stack)
	await writeWorkspaceConfig(repoRoot, stack.id)
}

async function runCommand(input: {
	readonly command: string
	readonly args: readonly string[]
	readonly cwd: string
	readonly env?: Record<string, string>
}): Promise<void> {
	const child = Bun.spawn([input.command, ...input.args], {
		cwd: input.cwd,
		env: input.env ? { ...process.env, ...input.env } : process.env,
		stdout: 'inherit',
		stderr: 'inherit',
	})
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(`${input.command} exited with code ${exitCode}`)
}

async function readCommand(input: {
	readonly command: string
	readonly args: readonly string[]
	readonly cwd: string
	readonly env?: Record<string, string>
}): Promise<string> {
	const child = Bun.spawn([input.command, ...input.args], {
		cwd: input.cwd,
		env: input.env ? { ...process.env, ...input.env } : process.env,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	if (exitCode !== 0) throw new Error(stderr.trim() || `${input.command} exited with code ${exitCode}`)
	return stdout
}

async function removeLegacyRedisContainers(stack: StackRecord): Promise<void> {
	const listCommand = createLegacyRedisContainerListCommand(stack)
	const stdout = await readCommand(listCommand)
	const containerIds = parseLegacyRedisContainerIds(stdout, stack.composeProject)
	const removalCommand = createLegacyRedisContainerRemovalCommand(stack, containerIds)
	if (removalCommand) await runCommand(removalCommand)
}

function createStackProcessEnvironment(
	stack: StackRecord,
	registryPath: string,
	organization?: OrganizationSeedDefaults,
): Record<string, string> {
	return Object.fromEntries(
		renderStackEnvLines(stack, registryPath, organization?.id).map((line) => {
			const separator = line.indexOf('=')
			if (separator < 1) throw new Error(`Invalid generated environment line: ${line}`)
			return [line.slice(0, separator), line.slice(separator + 1)]
		}),
	)
}

export class WorkOSResources extends Context.Service<WorkOSResources, WorkOSResourcesClient | null>()(
	'devstack/WorkOSResources',
) {}

export const WorkOSResourcesLive = Layer.effect(
	WorkOSResources,
	Effect.gen(function* () {
		const apiKey = Option.getOrUndefined(yield* Config.option(Config.Redacted('WORKOS_API_KEY')))
		if (!apiKey) return null
		const baseUrl = Option.getOrUndefined(yield* Config.option(Config.String('DEVSTACK_WORKOS_API_BASE_URL')))
		return new WorkOSResourcesClient({ apiKey: Redacted.value(apiKey), baseUrl })
	}),
)

export const SyncApplyEnvironmentLive = Layer.effect(
	SyncApplyEnvironment,
	Effect.gen(function* () {
		const workos = yield* WorkOSResources
		const organizationSeed = yield* OrganizationSeed
		return {
			reconcileWorkOS: (stack) => {
				const workosState = stack.workos
				return workos && workosState
					? attempt('reconcile_workos', async () => ({
							...stack,
							workos: await reconcileWorkOSResources(workos, stack.id, workosState),
						}))
					: Effect.succeed(stack)
			},
			persistRegistry: ({ registryPath, stack }) =>
				attempt('persist_registry', () =>
					withRegistryLock(registryPath, async () => {
						const registry = await readRegistry(registryPath)
						const next = { ...registry, stacks: { ...registry.stacks, [stack.id]: stack } }
						await writeRegistry(registryPath, next)
						return next
					}),
				),
			installWorkspaceProjection: ({ repoRoot, registryPath, stack, organization }) =>
				attempt('install_workspace_projection', () =>
					installWorkspaceProjection(repoRoot, registryPath, stack, organization),
				),
			installCaddyRoutes: ({ registryPath, registry }) =>
				attempt('install_caddy_routes', () => regenerateCaddyConfig(registryPath, registry, { reload: false })),
			cleanupLegacyRedis: (stack) => attempt('cleanup_legacy_redis', () => removeLegacyRedisContainers(stack)),
			startCompose: ({ registryPath, stack, organization }) =>
				attempt('start_compose', async () => {
					const dockerEnvironment = await createDevstackDockerProcessEnvironment(registryPath)
					const command = createComposeUpCommand(stack)
					await runCommand({
						...command,
						env: {
							...createStackProcessEnvironment(stack, registryPath, organization),
							...dockerEnvironment,
						},
					})
				}).pipe(Effect.retry({ times: 2, schedule: Schedule.spaced('1 second') })),
			setupPostgres: (stack) =>
				attempt('setup_postgres', async () => {
					await waitForPostgres(stack.postgres.databaseUrl)
					await runCommand({
						command: 'bun',
						args: ['--bun', '--cwd', 'packages/db', 'drizzle-kit', 'migrate'],
						cwd: stack.worktreePath,
						env: { DATABASE_URL: stack.postgres.databaseUrl },
					})
				}),
			seedOrganization: ({ stack, organization }) =>
				organizationSeed.seed({ databaseUrl: stack.postgres.databaseUrl, organization }).pipe(
					Effect.catchTag('OrganizationSeedError', (error) =>
						Effect.fail(
							new SyncApplyEnvironmentError({
								operation: 'seed_organization',
								reason: error.reason,
								cause: error,
							}),
						),
					),
				),
		} satisfies SyncApplyEnvironmentShape
	}),
)
