import { join } from 'node:path'

import type { StackRecord } from './registry'

export type ComposeTeardownCommand = {
	label: 'development' | 'test' | 'volumes'
	command: string
	args: string[]
	cwd: string
	env?: Record<string, string>
}

export type ComposeUpCommand = { command: string; args: string[]; cwd: string }
export type ComposeStatusCommand = { command: string; args: string[]; cwd: string }
export type DockerCommand = { command: string; args: string[]; cwd: string }

const LEGACY_REDIS_SERVICES = new Set(Array.from({ length: 6 }, (_, index) => `redis-node-${index}`))

export function selectedStackComposeHelp(stack: StackRecord): string {
	return `Use native Compose commands from ${stack.worktreePath}; .env selects project ${stack.composeProject} (for Postgres: docker compose up -d postgres).`
}

export function createComposeTeardownCommands(
	stack: StackRecord,
	options: { repoRoot?: string; env?: Record<string, string> } = {},
): ComposeTeardownCommand[] {
	const repoRoot = options.repoRoot ?? stack.worktreePath
	const common = ['down', '--volumes', '--remove-orphans']
	const volumes = [
		stack.postgres?.postgresVolume,
		stack.rivet?.engineVolume,
		stack.minio?.volume,
		stack.redis?.volume,
		stack.testServices?.postgresVolume,
		stack.testServices?.rivetEngineVolume,
		stack.testServices?.redis?.volume,
	].filter((volume): volume is string => Boolean(volume))
	const commands: ComposeTeardownCommand[] = [
		{
			label: 'development',
			command: 'docker',
			args: ['compose', '-f', join(repoRoot, 'docker-compose.yaml'), '-p', stack.composeProject, ...common],
			cwd: repoRoot,
			env: options.env,
		},
		{
			label: 'test',
			command: 'docker',
			args: [
				'compose',
				'-f',
				join(repoRoot, 'docker-compose.test.yml'),
				'-p',
				stack.testServices?.composeProject ?? `${stack.composeProject}-test`,
				...common,
			],
			cwd: repoRoot,
			env: options.env,
		},
	]
	if (volumes.length) {
		commands.push({
			label: 'volumes',
			command: 'docker',
			args: ['volume', 'rm', '--force', ...volumes],
			cwd: repoRoot,
			env: options.env,
		})
	}
	return commands
}

/**
 * Bring up the full stack-scoped Compose bundle under its isolated project name. Used by
 * `devstack sync --compose`; the `-p <composeProject>` keeps the stack isolated from siblings.
 */
export function createComposeUpCommand(stack: StackRecord): ComposeUpCommand {
	return {
		command: 'docker',
		args: [
			'compose',
			'-f',
			join(stack.worktreePath, 'docker-compose.yaml'),
			'-p',
			stack.composeProject,
			'up',
			'-d',
			'--remove-orphans',
		],
		cwd: stack.worktreePath,
	}
}

export function createLegacyRedisContainerListCommand(stack: StackRecord): DockerCommand {
	return {
		command: 'docker',
		args: [
			'container',
			'ls',
			'--all',
			'--filter',
			`label=com.docker.compose.project=${stack.composeProject}`,
			'--format',
			'{{.ID}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}',
		],
		cwd: stack.worktreePath,
	}
}

export function parseLegacyRedisContainerIds(stdout: string, composeProject: string): string[] {
	const ids: string[] = []
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue
		const [id, project, service, ...extra] = line.split('\t')
		if (extra.length > 0 || !id || !project || !service || !/^[a-f0-9]{12,64}$/u.test(id)) {
			throw new Error('Docker returned malformed container metadata during legacy Redis cleanup')
		}
		if (project === composeProject && LEGACY_REDIS_SERVICES.has(service)) ids.push(id)
	}
	return ids
}

export function createLegacyRedisContainerRemovalCommand(
	stack: StackRecord,
	containerIds: string[],
): DockerCommand | null {
	if (containerIds.length === 0) return null
	return {
		command: 'docker',
		args: ['container', 'rm', '--force', ...containerIds],
		cwd: stack.worktreePath,
	}
}

export function createComposeStatusCommand(stack: StackRecord): ComposeStatusCommand {
	return {
		command: 'docker',
		args: [
			'compose',
			'-f',
			join(stack.worktreePath, 'docker-compose.yaml'),
			'-p',
			stack.composeProject,
			'ps',
			'--status',
			'running',
			'--services',
		],
		cwd: stack.worktreePath,
	}
}

export function formatComposeCommand(command: { command: string; args: string[] }): string {
	return [command.command, ...command.args]
		.map((part) => (part.includes(' ') ? JSON.stringify(part) : part))
		.join(' ')
}
