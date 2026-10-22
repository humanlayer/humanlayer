#!/usr/bin/env bun

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { checkbox, confirm } from '@inquirer/prompts'
import { Command, CommanderError } from 'commander'
import { Effect, Layer } from 'effect'

import { AvailablePortsProbeLive } from './environment/available-ports-probe'
import { ComposeRuntimeProbeLive } from './environment/compose-runtime-probe'
import { ProcessRunnerLive } from './environment/process-runner'
import { SyncApplyEnvironmentLive, WorkOSResourcesLive } from './environment/sync-apply-environment'
import { SyncPlanningEnvironmentLive } from './environment/sync-planning-environment'
import { downStack, executeComposeCommand, formatDownResult, type ComposeExecutor } from './lib/down'
import { STACK_PORT_NAMES } from './lib/ports'
import { readRegistry, withRegistryLock, writeRegistry, type DevstackRegistry, type StackRecord } from './lib/registry'
import { OrganizationSeedLive, OrganizationSeedPersistenceLive } from './lib/seed'
import { createStackIdentity } from './lib/stack-id'
import {
	type ApiHealthProbe,
	createRegistryStatusSummary,
	createStackStatus,
	formatRegistryStatusSummary,
	formatStackStatus,
} from './lib/status'
import { inspectWorkOSResources, workOSClientFromEnv, type WorkOSResourcesClient } from './lib/workos-resources'
import { readWorkspaceConfig } from './lib/workspace-config'
import { formatStackPlan, formatStackPlanJson } from './sync/format-stack-plan'
import { StackSync, StackSyncLive } from './sync/stack-sync.service'

type CliIO = { stdout: (text: string) => void; stderr: (text: string) => void }

type CliOptions = {
	stack?: string
	globalStacks: string
	repoRoot: string
	json: boolean
	dryRun: boolean
	force: boolean
	workosOrgId?: string
	name?: string
	organizationId?: string
	compose: boolean
	seed: boolean
}

type CliAdapters = {
	executeCompose?: ComposeExecutor
	statusWorkosClient?: WorkOSResourcesClient | null
	selectStacksForDestruction?: (stacks: StackRecord[]) => Promise<string[]>
	probeApiHealth?: ApiHealthProbe
}

function defaultRegistryPath(): string {
	return join(homedir(), '.humanlayer', 'dev', 'default.json')
}

/** Commander lower-cases and camel-cases flag names; this is the shape it hands to `.action`. */
type CommanderOptionValues = {
	stack?: string
	globalStacks?: string
	repoRoot?: string
	json?: boolean
	dryRun?: boolean
	force?: boolean
	workosOrgId?: string
	name?: string
	organizationId?: string
	compose?: boolean
	seed?: boolean
}

/** Attach the options shared by every subcommand (stack selection, registry path, output shape). */
function addCommonOptions(command: Command): Command {
	return command
		.option('--stack <id>', 'target a specific stack instead of the workspace-local one')
		.option('--global-stacks <path>', 'path to the global devstack registry')
		.option('--repo-root <path>', 'repository root for the stack projection')
		.option('--json', 'emit machine-readable JSON output')
}

/** Rebuild the flat CliOptions the command handlers expect from Commander's parsed values. */
function toCliOptions(values: CommanderOptionValues): CliOptions {
	return {
		stack: values.stack,
		globalStacks: resolve(values.globalStacks ?? defaultRegistryPath()),
		repoRoot: resolve(values.repoRoot ?? process.cwd()),
		json: values.json ?? false,
		dryRun: values.dryRun ?? false,
		force: values.force ?? false,
		workosOrgId: values.workosOrgId,
		name: values.name,
		organizationId: values.organizationId,
		compose: values.compose ?? false,
		seed: values.seed ?? false,
	}
}

/** Resolve the stack id a command targets: explicit `--stack`, else the worktree-local `.devstack.json`. */
async function resolveStackId(options: CliOptions): Promise<string> {
	if (options.stack) return createStackIdentity(options.stack).id
	const localConfig = await readWorkspaceConfig(options.repoRoot)
	if (localConfig?.stackId) return localConfig.stackId
	throw new Error(
		`No stack configured for ${options.repoRoot}. Run \`bun --bun run devstack sync\` first, or pass --stack <id>.`,
	)
}

async function selectStack(registry: DevstackRegistry, options: CliOptions): Promise<StackRecord> {
	const stackId = await resolveStackId(options)
	const stack = registry.stacks[stackId]
	if (!stack) throw new Error(`Stack "${stackId}" is not registered in this devstack registry`)
	return stack
}

/** Compose the full StackSync layer (planning + apply environments and their probes). */
function buildStackSyncLayer() {
	const ConfiguredComposeRuntimeProbeLive = ComposeRuntimeProbeLive.pipe(Layer.provide(ProcessRunnerLive))
	const PlanningDependenciesLive = Layer.merge(AvailablePortsProbeLive, ConfiguredComposeRuntimeProbeLive)
	const ConfiguredSyncPlanningEnvironmentLive = SyncPlanningEnvironmentLive.pipe(
		Layer.provide(PlanningDependenciesLive),
	)

	const ConfiguredOrganizationSeedLive = OrganizationSeedLive.pipe(Layer.provide(OrganizationSeedPersistenceLive))
	const ApplyDependenciesLive = Layer.merge(WorkOSResourcesLive, ConfiguredOrganizationSeedLive)
	const ConfiguredSyncApplyEnvironmentLive = SyncApplyEnvironmentLive.pipe(Layer.provide(ApplyDependenciesLive))

	return StackSyncLive.pipe(
		Layer.provideMerge(Layer.merge(ConfiguredSyncPlanningEnvironmentLive, ConfiguredSyncApplyEnvironmentLive)),
	)
}

async function handleSync(options: CliOptions, io: CliIO): Promise<number> {
	const intent = {
		stackId: options.stack ?? '',
		repoRoot: options.repoRoot,
		registryPath: options.globalStacks,
		compose: options.compose,
		seed: options.seed,
		dryRun: options.dryRun,
	}
	const layer = buildStackSyncLayer()
	const program = Effect.gen(function* () {
		const stackSync = yield* StackSync
		const plan = yield* stackSync.plan(intent)
		if (options.dryRun) return { plan, result: null }
		return { plan, result: yield* stackSync.apply(plan) }
	})
	const { plan, result } = await Effect.runPromise(program.pipe(Effect.provide(layer)))
	if (options.dryRun) {
		io.stdout(options.json ? formatStackPlanJson(plan) : formatStackPlan(plan))
		return 0
	}
	if (result === null) throw new Error('Devstack sync completed without an apply result')
	const stack = result.stack

	const status = await createStackStatus(stack, options.globalStacks, undefined, plan.organization)
	io.stdout(options.json ? `${JSON.stringify(status, null, 2)}\n` : formatStackStatus(status))
	return 0
}

async function handleReallocate(options: CliOptions, io: CliIO): Promise<number> {
	const intent = {
		stackId: options.stack ?? '',
		repoRoot: options.repoRoot,
		registryPath: options.globalStacks,
		compose: false,
		seed: false,
	}
	const layer = buildStackSyncLayer()
	const program = Effect.gen(function* () {
		const stackSync = yield* StackSync
		return yield* stackSync.reallocate(intent)
	}).pipe(
		// The tagged failures carry their diagnostics on `reason`; surface it as an Error message so
		// runCli's top-level catch reports it instead of an empty FiberFailure render.
		Effect.mapError((error) => new Error(error.reason)),
	)
	const { previous, stack } = await Effect.runPromise(program.pipe(Effect.provide(layer)))

	const changed = STACK_PORT_NAMES.filter((name) => previous.ports[name] !== stack.ports[name])
	if (options.json) {
		const status = await createStackStatus(stack, options.globalStacks)
		io.stdout(`${JSON.stringify(status, null, 2)}\n`)
		return 0
	}
	io.stdout(`Reallocated ports for stack "${stack.id}".\n`)
	io.stdout(
		changed.length === 0
			? '  All probed ports matched the existing allocation; nothing changed.\n'
			: changed.map((name) => `  ${name}: ${previous.ports[name]} -> ${stack.ports[name]}\n`).join(''),
	)
	io.stdout('\nRestart the stack processes to pick up the new ports.\n')
	const status = await createStackStatus(stack, options.globalStacks)
	io.stdout(formatStackStatus(status))
	return 0
}

async function handleStatus(options: CliOptions, io: CliIO, adapters: CliAdapters): Promise<number> {
	const registry = await readRegistry(options.globalStacks)
	const localConfig = options.stack ? null : await readWorkspaceConfig(options.repoRoot)
	if (!options.stack && !localConfig) {
		const summary = createRegistryStatusSummary(
			Object.values(registry.stacks),
			options.globalStacks,
			registry.defaults?.organization,
		)
		io.stdout(options.json ? `${JSON.stringify(summary, null, 2)}\n` : formatRegistryStatusSummary(summary))
		return 0
	}
	let stack = await selectStack(registry, options)
	const workos = adapters.statusWorkosClient ?? null
	if (workos && stack.workos) {
		stack = { ...stack, workos: await inspectWorkOSResources(workos, stack.id, stack.workos) }
	}
	const status = await createStackStatus(
		stack,
		options.globalStacks,
		adapters.probeApiHealth,
		registry.defaults?.organization,
	)
	io.stdout(options.json ? `${JSON.stringify(status, null, 2)}\n` : formatStackStatus(status))
	return 0
}

async function handleDown(options: CliOptions, io: CliIO, adapters: CliAdapters): Promise<number> {
	let stackIds: string[]
	try {
		stackIds = [await resolveStackId(options)]
	} catch (error) {
		if (options.stack || options.dryRun || options.json) throw error
		const registry = await readRegistry(options.globalStacks)
		const stacks = Object.values(registry.stacks).sort((left, right) => left.id.localeCompare(right.id))
		if (stacks.length === 0) throw error
		if (!process.stdin.isTTY && !adapters.selectStacksForDestruction) {
			throw new Error(
				'This directory is not configured for devstack. Pass --stack <id>, or run this command in an interactive terminal to select stacks.',
			)
		}
		io.stdout(
			'This directory is not configured for devstack - pick one or more stacks to destroy below (enter/space to toggle).\n',
		)
		stackIds = await (adapters.selectStacksForDestruction ?? selectStacksForDestruction)(stacks)
		if (stackIds.length === 0) {
			io.stdout('No stacks selected; nothing to destroy.\n')
			return 0
		}
	}

	for (const stackId of stackIds) {
		if (!options.dryRun && !options.json) io.stdout(`Tearing down stack "${stackId}"...\n`)
		const result = await downStack(
			{
				stackId,
				registryPath: options.globalStacks,
				repoRoot: options.repoRoot,
				dryRun: options.dryRun,
				force: options.force,
				onProgress: options.json ? undefined : (message) => io.stdout(`  ${message}\n`),
			},
			adapters.executeCompose ?? executeComposeCommand,
		)
		io.stdout(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatDownResult(result))
	}
	return 0
}

async function selectStacksForDestruction(stacks: StackRecord[]): Promise<string[]> {
	const selected = await checkbox({
		message: 'Select stacks (up/down to move, space to toggle, enter to continue)',
		choices: stacks.map((stack) => ({ name: `${stack.id} - ${stack.worktreePath}`, value: stack.id })),
		loop: false,
	})
	if (selected.length === 0) return []
	const approved = await confirm({
		message: `\u001B[31mDestroy ${selected.length} selected stack${selected.length === 1 ? '' : 's'}?\u001B[0m`,
		default: false,
	})
	return approved ? selected : []
}

async function handleSetLocalOrg(options: CliOptions, io: CliIO): Promise<number> {
	if (!options.workosOrgId || !options.name) {
		throw new Error('Usage: devstack set-local-org --workos-org-id <id> --name <name> [--organization-id <uuid>]')
	}
	const workosOrganizationId = options.workosOrgId
	const organizationName = options.name
	let configuredOrganizationId = ''
	await withRegistryLock(options.globalStacks, async () => {
		const registry = await readRegistry(options.globalStacks)
		configuredOrganizationId = options.organizationId ?? registry.defaults?.organization?.id ?? crypto.randomUUID()
		await writeRegistry(options.globalStacks, {
			...registry,
			defaults: {
				...registry.defaults,
				organization: {
					id: configuredOrganizationId,
					workosOrganizationId,
					name: organizationName,
				},
			},
		})
	})
	io.stdout(`Configured local organization ${configuredOrganizationId} in ${options.globalStacks}.\n`)
	return 0
}

export async function runCli(
	argv: string[],
	io: CliIO = { stdout: console.log, stderr: console.error },
	adapters: CliAdapters = {},
): Promise<number> {
	// Handlers set this via their return value; Commander actions are void-returning.
	let exitCode = 0

	const program = new Command()
	program
		.name('devstack')
		.description('Manage isolated multi-instance dev stacks')
		// Throw CommanderError instead of calling process.exit so runCli stays a pure function.
		.exitOverride()
		// Route Commander's own output (errors, help) through the injected IO.
		.configureOutput({
			writeOut: (text) => io.stdout(text),
			writeErr: (text) => io.stderr(text),
		})

	addCommonOptions(program.command('sync'))
		.description('Reconcile this worktree stack; launch commands activate the generated Caddy routes')
		.option('--compose', 'bring up the full Compose bundle, wait for Postgres, and run migrations')
		.option('--seed', 'seed the configured local organization after reconciling')
		.option('--dry-run', 'print the ordered convergence plan without mutating anything')
		.action(async (values: CommanderOptionValues) => {
			exitCode = await handleSync(toCliOptions(values), io)
		})

	addCommonOptions(program.command('down'))
		.description('Tear down the worktree-local stack (or --stack) and its containers')
		.option('--dry-run', 'preview teardown without removing anything')
		.option('--force', 'remove containers even if compose reports errors')
		.action(async (values: CommanderOptionValues) => {
			exitCode = await handleDown(toCliOptions(values), io, adapters)
		})

	addCommonOptions(program.command('reallocate'))
		.description('Probe and persist a fresh set of ports for a registered stack (registry only, no convergence)')
		.action(async (values: CommanderOptionValues) => {
			exitCode = await handleReallocate(toCliOptions(values), io)
		})

	addCommonOptions(program.command('status'))
		.description('Show detailed status for a stack, or a summary of all stacks')
		.action(async (values: CommanderOptionValues) => {
			exitCode = await handleStatus(toCliOptions(values), io, adapters)
		})

	addCommonOptions(program.command('set-local-org'))
		.description('Configure the default local organization used when seeding')
		.option('--workos-org-id <id>', 'WorkOS organization ID')
		.option('--name <name>', 'organization display name')
		.option('--organization-id <uuid>', 'explicit organization UUID (generated when omitted)')
		.action(async (values: CommanderOptionValues) => {
			exitCode = await handleSetLocalOrg(toCliOptions(values), io)
		})

	try {
		await program.parseAsync(argv, { from: 'user' })
		return exitCode
	} catch (error) {
		// Commander already wrote its own error/help text through configureOutput above.
		if (error instanceof CommanderError) return error.exitCode
		io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}

if (import.meta.main) {
	process.exitCode = await runCli(
		process.argv.slice(2),
		{
			stdout: process.stdout.write.bind(process.stdout),
			stderr: process.stderr.write.bind(process.stderr),
		},
		{ statusWorkosClient: workOSClientFromEnv() },
	)
}
