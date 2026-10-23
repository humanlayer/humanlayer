import { readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { afterEach, expect } from 'vitest'

import { ComposeRuntimeProbe, ComposeRuntimeProbeLive } from '../environment/compose-runtime-probe'
import { ProcessRunner, ProcessRunnerError } from '../environment/process-runner'
import {
	createComposeUpCommand,
	createLegacyRedisContainerListCommand,
	createLegacyRedisContainerRemovalCommand,
	parseLegacyRedisContainerIds,
} from '../lib/compose'
import { STACK_PORT_NAMES, type StackPorts } from '../lib/ports'
import { emptyRegistry, type StackRecord } from '../lib/registry'
import { planStackSync } from '../sync/stack-sync-plan'

const stack: StackRecord = planStackSync(
	{
		stackId: 'compose-probe',
		repoRoot: '/repo',
		registryPath: '/registry.json',
		compose: false,
		seed: false,
	},
	{
		registry: emptyRegistry(),
		workspaceStack: null,
		composeRunning: false,
		allocations: {
			ports: Object.fromEntries(STACK_PORT_NAMES.map((name, index) => [name, index + 100])) as StackPorts,
			redisPort: 20,
			testRedisPort: 21,
		},
	},
	{ now: '2026-07-12T00:00:00.000Z', nativeIconIndex: 1, colorIndex: 0, workosConfigured: false },
).desired

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function createRegistryPath(): string {
	const stateRoot = join(tmpdir(), `devstack-compose-probe-${crypto.randomUUID()}`)
	temporaryDirectories.push(stateRoot)
	return join(stateRoot, 'default.json')
}

describe.skipIf(Boolean(process.env.CI))('ComposeRuntimeProbe', () => {
	it('removes only this Compose project orphan services during sync', () => {
		const command = createComposeUpCommand(stack)
		expect(command.args).toContain('--remove-orphans')
		expect(command.args.slice(command.args.indexOf('-p'), command.args.indexOf('-p') + 2)).toEqual([
			'-p',
			stack.composeProject,
		])
	})

	it('selects only legacy Redis containers owned by the current Compose project', () => {
		const listCommand = createLegacyRedisContainerListCommand(stack)
		expect(listCommand.args).toContain(`label=com.docker.compose.project=${stack.composeProject}`)

		const ids = parseLegacyRedisContainerIds(
			[
				`aaaaaaaaaaaa\t${stack.composeProject}\tredis-node-0`,
				`bbbbbbbbbbbb\t${stack.composeProject}\tredis-node-5`,
				`cccccccccccc\t${stack.composeProject}\tredis`,
				`dddddddddddd\t${stack.composeProject}\tpostgres`,
				'deeeeeeeeeee\tother-worktree\tredis-node-0',
			].join('\n'),
			stack.composeProject,
		)
		expect(ids).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])

		const removalCommand = createLegacyRedisContainerRemovalCommand(stack, ids)
		expect(removalCommand?.args).toEqual(['container', 'rm', '--force', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
	})

	it('fails closed on malformed Docker metadata and skips empty removals', () => {
		expect(() =>
			parseLegacyRedisContainerIds(`not-an-id\t${stack.composeProject}\tredis-node-0`, stack.composeProject),
		).toThrow('malformed container metadata')
		expect(createLegacyRedisContainerRemovalCommand(stack, [])).toBeNull()
	})

	it.effect('detects Postgres through the replaceable process seam', () => {
		const calls: Array<{ command: string; args: readonly string[]; env?: Readonly<Record<string, string>> }> = []
		const processLayer = Layer.succeed(ProcessRunner, {
			run: (input) =>
				Effect.sync(() => {
					calls.push(input)
					return { stdout: 'postgres\nredis\n', stderr: '' }
				}),
		})
		const registryPath = createRegistryPath()
		return Effect.gen(function* () {
			const probe = yield* ComposeRuntimeProbe
			expect(yield* probe.isRunning({ stack, registryPath })).toBe(true)
			expect(calls[0]?.args).toContain('--services')
			expect(calls[0]?.env?.DOCKER_CONFIG).toBe(join(dirname(registryPath), 'docker-config'))
			expect(
				JSON.parse(
					yield* Effect.promise(() =>
						readFile(join(dirname(registryPath), 'docker-config', 'config.json'), 'utf8'),
					),
				),
			).toEqual({ auths: {}, cliPluginsExtraDirs: [join(homedir(), '.docker', 'cli-plugins')] })
		}).pipe(Effect.provide(ComposeRuntimeProbeLive.pipe(Layer.provide(processLayer))))
	})

	it.effect('captures and narrows process failures', () => {
		const processLayer = Layer.succeed(ProcessRunner, {
			run: () => Effect.fail(new ProcessRunnerError({ command: 'docker' })),
		})
		const registryPath = createRegistryPath()
		return Effect.gen(function* () {
			const probe = yield* ComposeRuntimeProbe
			const error = yield* Effect.flip(probe.isRunning({ stack, registryPath }))
			expect(error.reason).toBe('Unable to inspect Compose runtime')
			expect(error.cause).toBeInstanceOf(ProcessRunnerError)
		}).pipe(Effect.provide(ComposeRuntimeProbeLive.pipe(Layer.provide(processLayer))))
	})

	it.effect('does not initialize persistent Docker state for a dry-run probe', () => {
		const processLayer = Layer.succeed(ProcessRunner, {
			run: () => Effect.succeed({ stdout: 'postgres\n', stderr: '' }),
		})
		const registryPath = createRegistryPath()
		return Effect.gen(function* () {
			const probe = yield* ComposeRuntimeProbe
			expect(yield* probe.isRunning({ stack, registryPath, initializeDockerConfig: false })).toBe(true)
			const configPath = join(dirname(registryPath), 'docker-config', 'config.json')
			expect(
				yield* Effect.promise(() =>
					readFile(configPath, 'utf8').then(
						() => true,
						() => false,
					),
				),
			).toBe(false)
		}).pipe(Effect.provide(ComposeRuntimeProbeLive.pipe(Layer.provide(processLayer))))
	})
})
