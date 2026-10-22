import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli'
import { caddyConfigPath, caddyStatePath } from '../lib/caddy'
import { createComposeTeardownCommands } from '../lib/compose'
import { downStack, executeComposeCommand } from '../lib/down'
import { readRegistry } from '../lib/registry'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const cliDependencies = {}

function captureIO() {
	const stdout: string[] = []
	const stderr: string[] = []
	return {
		stdout,
		stderr,
		io: { stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text) },
	}
}

async function createPaths() {
	const repoRoot = await mkdtemp(join(tmpdir(), 'devstack-down-repo-'))
	const stateRoot = await mkdtemp(join(tmpdir(), 'devstack-down-state-'))
	temporaryDirectories.push(repoRoot, stateRoot)
	return { repoRoot, registryPath: join(stateRoot, 'default.json') }
}

async function initStack(repoRoot: string, registryPath: string, stackId: string) {
	const output = captureIO()
	expect(
		await runCli(
			['sync', '--stack', stackId, '--repo-root', repoRoot, '--global-stacks', registryPath],
			output.io,
			cliDependencies,
		),
	).toBe(0)
	return (await readRegistry(registryPath)).stacks[stackId]!
}

describe.skipIf(Boolean(process.env.CI))('devstack down', () => {
	it('previews teardown without --yes and leaves state unchanged for a dry run', async () => {
		const { repoRoot, registryPath } = await createPaths()
		await initStack(repoRoot, registryPath, 'alpha')

		// Resolves the worktree-local stack from .devstack.json when --stack is omitted.
		const localDry = captureIO()
		expect(
			await runCli(['down', '--global-stacks', registryPath, '--repo-root', repoRoot, '--dry-run'], localDry.io),
		).toBe(0)
		expect(localDry.stdout.join('')).toContain('Dry run for stack "alpha"')
		expect(localDry.stdout.join('')).toContain('docker compose')

		// Explicit --stack targets the same stack for automation.
		const explicitDry = captureIO()
		expect(
			await runCli(['down', '--stack', 'alpha', '--global-stacks', registryPath, '--dry-run'], explicitDry.io),
		).toBe(0)
		expect(explicitDry.stdout.join('')).toContain('Dry run for stack "alpha"')

		expect((await readRegistry(registryPath)).stacks.alpha).toBeDefined()
		expect(await readFile(join(repoRoot, '.devstack.json'), 'utf8')).toContain('alpha')
	})

	it('tears down the worktree-local stack without requiring confirmation', async () => {
		const { repoRoot, registryPath } = await createPaths()
		await initStack(repoRoot, registryPath, 'alpha')
		const executed: string[] = []

		const output = captureIO()
		expect(
			await runCli(['down', '--global-stacks', registryPath, '--repo-root', repoRoot], output.io, {
				executeCompose: (command) => {
					executed.push(command.label)
				},
			}),
		).toBe(0)
		expect(output.stdout.join('')).toContain('Removed stack "alpha"')
		expect(output.stdout.join('')).toContain('Tearing down stack "alpha"')
		expect(output.stdout.join('')).toContain('Removing development resources...')
		expect(output.stdout.join('')).toContain('Updating Caddy routes...')
		expect(executed).toHaveLength(3)
		expect((await readRegistry(registryPath)).stacks).toEqual({})
		await expect(readFile(join(repoRoot, '.devstack.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('keeps JSON teardown output free of progress messages', async () => {
		const { repoRoot, registryPath } = await createPaths()
		await initStack(repoRoot, registryPath, 'alpha')
		const output = captureIO()

		expect(
			await runCli(['down', '--global-stacks', registryPath, '--repo-root', repoRoot, '--json'], output.io, {
				executeCompose: () => undefined,
			}),
		).toBe(0)
		const text = output.stdout.join('')
		expect(() => JSON.parse(text)).not.toThrow()
		expect(text).not.toContain('Tearing down')
		expect(text).not.toContain('Removing development')
	})

	it('errors when no stack is selected and none is workspace-local', async () => {
		const { repoRoot, registryPath } = await createPaths()
		const output = captureIO()
		expect(await runCli(['down', '--global-stacks', registryPath, '--repo-root', repoRoot], output.io)).toBe(1)
		expect(output.stderr.join('')).toContain('No stack configured')
	})

	it('allows interactive selection when the current directory has no stack', async () => {
		const first = await createPaths()
		const second = await createPaths()
		await initStack(first.repoRoot, first.registryPath, 'alpha')
		await initStack(second.repoRoot, first.registryPath, 'beta')
		const unconfigured = await mkdtemp(join(tmpdir(), 'devstack-down-unconfigured-'))
		temporaryDirectories.push(unconfigured)
		const selected: string[][] = []
		const executed: string[] = []

		const output = captureIO()
		expect(
			await runCli(['down', '--global-stacks', first.registryPath, '--repo-root', unconfigured], output.io, {
				selectStacksForDestruction: async (stacks) => {
					selected.push(stacks.map((stack) => stack.id))
					return ['alpha', 'beta']
				},
				executeCompose: (command) => {
					executed.push(command.label)
				},
			}),
		).toBe(0)
		expect(selected).toEqual([['alpha', 'beta']])
		expect(executed.length).toBeGreaterThanOrEqual(4)
		expect((await readRegistry(first.registryPath)).stacks).toEqual({})
		expect(output.stdout.join('')).toContain('This directory is not configured for devstack')
	})

	it('scopes development and test Compose teardown to stack projects', async () => {
		const { repoRoot, registryPath } = await createPaths()
		const stack = await initStack(repoRoot, registryPath, 'alpha')
		const commands = createComposeTeardownCommands(stack)
		expect(commands[0]?.args).toEqual([
			'compose',
			'-f',
			join(repoRoot, 'docker-compose.yaml'),
			'-p',
			stack.composeProject,
			'down',
			'--volumes',
			'--remove-orphans',
		])
		expect(commands[1]?.args).toContain(`${stack.composeProject}-test`)
		expect(commands[2]?.args).toContain(stack.postgres.postgresVolume)
	})

	it('uses the invoking repository and target stack environment for a removed worktree', async () => {
		const { repoRoot, registryPath } = await createPaths()
		const stack = await initStack(repoRoot, registryPath, 'alpha')
		const fallbackRepoRoot = await mkdtemp(join(tmpdir(), 'devstack-down-fallback-'))
		temporaryDirectories.push(fallbackRepoRoot)
		await rm(repoRoot, { recursive: true, force: true })
		const executed: Parameters<typeof executeComposeCommand>[0][] = []

		await downStack({ stackId: stack.id, registryPath, repoRoot: fallbackRepoRoot }, (command) => {
			executed.push(command)
		})

		expect(executed[0]?.args).toContain(join(fallbackRepoRoot, 'docker-compose.yaml'))
		expect(executed[1]?.args).toContain(join(fallbackRepoRoot, 'docker-compose.test.yml'))
		expect(executed[0]?.env).toMatchObject({
			DEVSTACK_ID: 'alpha',
			DEVSTACK_COMPOSE_PROJECT: stack.composeProject,
			DOCKER_CONFIG: join(dirname(registryPath), 'docker-config'),
		})
		expect((await readRegistry(registryPath)).stacks).toEqual({})
	})

	it('uses the target worktree and its environment when it still exists', async () => {
		const { repoRoot, registryPath } = await createPaths()
		const stack = await initStack(repoRoot, registryPath, 'alpha')
		const invokingRepoRoot = await mkdtemp(join(tmpdir(), 'devstack-down-invoking-'))
		temporaryDirectories.push(invokingRepoRoot)
		const executed: Parameters<typeof executeComposeCommand>[0][] = []

		await downStack({ stackId: stack.id, registryPath, repoRoot: invokingRepoRoot }, (command) => {
			executed.push(command)
		})

		expect(executed[0]).toMatchObject({
			cwd: repoRoot,
			env: { DOCKER_CONFIG: join(dirname(registryPath), 'docker-config') },
		})
		expect(executed[0]?.args).toContain(join(repoRoot, 'docker-compose.yaml'))
	})

	it('removes one stack projection, Compose projects, and Caddy routes', async () => {
		const { repoRoot, registryPath } = await createPaths()
		await initStack(repoRoot, registryPath, 'alpha')
		const executed: string[] = []

		const result = await downStack({ stackId: 'alpha', registryPath }, (command) => {
			executed.push(`${command.label}:${command.args.join(' ')}`)
		})

		expect(result.removed).toBe(true)
		expect(executed).toHaveLength(3)
		expect(executed[2]).toContain('volumes:volume rm --force')
		expect((await readRegistry(registryPath)).stacks).toEqual({})
		expect(await readFile(join(repoRoot, '.env'), 'utf8')).not.toContain('# <devstack-autogenerated>')
		await expect(readFile(join(repoRoot, '.devstack.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
		expect(await readFile(caddyConfigPath(registryPath), 'utf8')).not.toContain('alpha.localhost')
		expect(JSON.parse(await readFile(caddyStatePath(registryPath), 'utf8'))).toMatchObject({ active: false })
	})

	it('switches the workspace projection to the newest remaining stack', async () => {
		const { repoRoot, registryPath } = await createPaths()
		await initStack(repoRoot, registryPath, 'alpha')
		await initStack(repoRoot, registryPath, 'beta')

		const result = await downStack({ stackId: 'beta', registryPath }, () => undefined)
		expect(result.fallbackStackId).toBe('alpha')
		expect(JSON.parse(await readFile(join(repoRoot, '.devstack.json'), 'utf8'))).toEqual({ stackId: 'alpha' })
		expect(await readFile(join(repoRoot, '.env'), 'utf8')).toContain('DEVSTACK_ID=alpha')
		expect(await readFile(caddyConfigPath(registryPath), 'utf8')).toContain('ui.alpha.localhost')
		expect(await readFile(caddyConfigPath(registryPath), 'utf8')).not.toContain('ui.beta.localhost')
	})

	it('refuses unknown stacks unless force is explicit', async () => {
		const { registryPath } = await createPaths()
		await expect(downStack({ stackId: 'missing', registryPath }, () => undefined)).rejects.toThrow('not registered')
		await expect(
			downStack({ stackId: 'missing', registryPath, force: true }, () => undefined),
		).resolves.toMatchObject({
			removed: false,
		})
	})
})
