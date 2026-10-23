import { access, readFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'

import { isDevstackEnvBlockFresh, renderStackEnvLines, stackLogDirectory } from './env-block'
import type { OrganizationSeedDefaults } from './manifest'
import { STACK_PORT_NAMES } from './ports'
import type { StackRecord } from './registry'
import { ROUTE_NAMES } from './routes'

export type StackStatus = StackRecord & {
	registryPath: string
	localOrganization?: OrganizationSeedDefaults
	envPath: string
	generatedEnvFresh: boolean
	logDirectory: string
	apiHealth: { url: string; status: 'passed' | 'failed' }
}

export type ApiHealthProbe = (url: string) => Promise<boolean>

export function probeApiHealth(url: string): Promise<boolean> {
	return new Promise((resolve) => {
		const target = new URL(url)
		const request = httpsRequest(
			{
				hostname: target.hostname,
				port: target.port || 443,
				path: `${target.pathname}${target.search}`,
				method: 'GET',
				rejectUnauthorized: false,
				timeout: 2_000,
			},
			(response) => {
				response.resume()
				resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300))
			},
		)
		request.once('error', () => resolve(false))
		request.once('timeout', () => request.destroy(new Error('API healthcheck timed out')))
		request.end()
	})
}

export type RegistryStatusSummary = {
	registryPath: string
	localOrganization?: OrganizationSeedDefaults
	stacks: Array<Pick<StackRecord, 'id' | 'worktreePath'>>
}

export async function createStackStatus(
	stack: StackRecord,
	registryPath: string,
	probe: ApiHealthProbe = probeApiHealth,
	localOrganization?: OrganizationSeedDefaults,
): Promise<StackStatus> {
	const envPath = join(stack.worktreePath, '.env')
	let generatedEnvFresh = false
	try {
		await access(envPath)
		const env = await readFile(envPath, 'utf8')
		generatedEnvFresh = isDevstackEnvBlockFresh(
			env,
			renderStackEnvLines(stack, registryPath, localOrganization?.id),
		)
	} catch {
		generatedEnvFresh = false
	}
	const healthUrl = `${stack.routes.api}/health`
	let passed = false
	try {
		passed = await probe(healthUrl)
	} catch {
		passed = false
	}
	return {
		...stack,
		registryPath,
		localOrganization,
		envPath,
		generatedEnvFresh,
		logDirectory: stackLogDirectory(stack.id),
		apiHealth: { url: healthUrl, status: passed ? 'passed' : 'failed' },
	}
}

export function formatStackStatus(status: StackStatus): string {
	const lines: string[] = [
		`Stack: ${status.id}`,
		`Display name: ${status.displayName}`,
		`Worktree: ${status.worktreePath}`,
		`Registry: ${status.registryPath}`,
		`Local organization: ${formatLocalOrganization(status.localOrganization)}`,
		`Generated env: ${status.generatedEnvFresh ? 'fresh' : 'stale'} (${status.envPath})`,
		`Logs: ${status.logDirectory}`,
		`WorkOS auth resources: ${status.workos?.status ?? 'unconfigured'}`,
		status.apiHealth.status === 'passed'
			? 'API healthcheck: passed (stack is already running via bun --bun run riptide or equivalent)'
			: 'API healthcheck: failed (stack is not running - start it in a tmux session with bun --bun run riptide)',
	]
	if (status.workos) {
		lines.push(`  callback: ${status.workos.callbackUri}`, `  CORS origin: ${status.workos.corsOrigin}`)
	}
	lines.push(
		'',
		'Service URLs:',
		...ROUTE_NAMES.map((name) => `  ${name}: ${status.routes[name]}`),
		'',
		'Backend ports:',
		...STACK_PORT_NAMES.map((name) => `  ${name}: ${status.ports[name]}`),
	)
	if (status.redis) lines.push(`  redis: ${status.redis.port}`)
	return `${lines.join('\n')}\n`
}

export function createRegistryStatusSummary(
	stacks: StackRecord[],
	registryPath: string,
	localOrganization?: OrganizationSeedDefaults,
): RegistryStatusSummary {
	return {
		registryPath,
		localOrganization,
		stacks: stacks
			.map(({ id, worktreePath }) => ({ id, worktreePath }))
			.sort((left, right) => left.id.localeCompare(right.id)),
	}
}

export function formatRegistryStatusSummary(summary: RegistryStatusSummary): string {
	const organization = `Local organization: ${formatLocalOrganization(summary.localOrganization)}\n`
	if (summary.stacks.length === 0) return `${organization}No dev stacks registered in ${summary.registryPath}.\n`
	return `${organization}\n${summary.stacks.map((stack) => `${stack.id}  ${stack.worktreePath}`).join('\n')}\n\nRun \`bun --bun run devstack status --stack <id>\` for detailed URLs and ports.\n`
}

function formatLocalOrganization(organization?: OrganizationSeedDefaults): string {
	return organization
		? `${organization.name} (internal: ${organization.id}, WorkOS: ${organization.workosOrganizationId})`
		: 'unconfigured'
}
