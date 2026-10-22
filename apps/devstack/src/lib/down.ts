import { execFile } from 'node:child_process'
import { access, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { regenerateCaddyConfig } from './caddy'
import { createComposeTeardownCommands, formatComposeCommand, type ComposeTeardownCommand } from './compose'
import { createDevstackDockerProcessEnvironment } from './docker-config'
import { removeDevstackEnvBlock, renderStackEnvLines, replaceDevstackEnvBlock } from './env-block'
import { removeNativeStackConfig, writeNativeStackConfig } from './native-config'
import {
	deleteStack,
	fallbackStackForWorktree,
	readRegistry,
	withRegistryLock,
	writeRegistry,
	type StackRecord,
} from './registry'
import { retainedWorkOSResourceActions } from './workos-resources'
import { readWorkspaceConfig, removeWorkspaceConfig, writeWorkspaceConfig } from './workspace-config'

export type DownOptions = {
	stackId: string
	registryPath: string
	repoRoot?: string
	dryRun?: boolean
	force?: boolean
	onProgress?: (message: string) => void
}

export type DownResult = {
	stackId: string
	dryRun: boolean
	removed: boolean
	composeCommands: string[]
	fallbackStackId: string | null
	workosActions: string[]
}

export type ComposeExecutor = (command: ComposeTeardownCommand) => void | Promise<void>

const execFileAsync = promisify(execFile)

export const executeComposeCommand: ComposeExecutor = async (command) => {
	try {
		await execFileAsync(command.command, command.args, {
			cwd: command.cwd,
			encoding: 'utf8',
			env: command.env ? { ...process.env, ...command.env } : process.env,
		})
	} catch (error) {
		const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
		if (failure.code === 'ENOENT') throw error
		const details = failure.stderr?.trim() || failure.stdout?.trim() || failure.message
		throw new Error(`Failed to tear down ${command.label}: ${details}`, { cause: error })
	}
}

async function readEnv(path: string): Promise<string> {
	try {
		return await readFile(path, 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
		throw error
	}
}

async function writeEnv(path: string, contents: string): Promise<void> {
	const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
	await writeFile(temporaryPath, contents, { mode: 0o600 })
	await rename(temporaryPath, path)
}

async function updateWorktreeProjection(
	removed: StackRecord,
	fallback: StackRecord | null,
	registryPath: string,
	organizationId?: string,
): Promise<void> {
	const localConfig = await readWorkspaceConfig(removed.worktreePath)
	if (localConfig?.stackId !== removed.id) return

	const envPath = join(removed.worktreePath, '.env')
	const existingEnv = await readEnv(envPath)
	if (fallback) {
		await writeEnv(
			envPath,
			replaceDevstackEnvBlock(existingEnv, renderStackEnvLines(fallback, registryPath, organizationId)),
		)
		await writeWorkspaceConfig(removed.worktreePath, fallback.id)
		await writeNativeStackConfig(removed.worktreePath, fallback)
	} else {
		await writeEnv(envPath, removeDevstackEnvBlock(existingEnv))
		await removeWorkspaceConfig(removed.worktreePath)
		await removeNativeStackConfig(removed.worktreePath)
	}
}

export async function downStack(
	options: DownOptions,
	executeCompose: ComposeExecutor = executeComposeCommand,
): Promise<DownResult> {
	return withRegistryLock(options.registryPath, async () => {
		const currentRegistry = await readRegistry(options.registryPath)
		const deletion = deleteStack(currentRegistry, options.stackId, { force: options.force })
		if (!deletion.removed) {
			return {
				stackId: options.stackId,
				dryRun: options.dryRun ?? false,
				removed: false,
				composeCommands: [],
				fallbackStackId: null,
				workosActions: [],
			}
		}

		const worktreeExists = await access(deletion.removed.worktreePath).then(
			() => true,
			() => false,
		)
		const fallbackEnv = worktreeExists
			? undefined
			: Object.fromEntries(
					renderStackEnvLines(
						deletion.removed,
						options.registryPath,
						currentRegistry.defaults?.organization?.id,
					).map((line) => {
						const separator = line.indexOf('=')
						if (separator < 1) throw new Error(`Invalid generated environment line: ${line}`)
						return [line.slice(0, separator), line.slice(separator + 1)]
					}),
				)
		const commands = createComposeTeardownCommands(
			deletion.removed,
			worktreeExists ? {} : { repoRoot: options.repoRoot ?? process.cwd(), env: fallbackEnv },
		)
		const fallback = fallbackStackForWorktree(deletion.registry, deletion.removed.worktreePath)
		const result: DownResult = {
			stackId: options.stackId,
			dryRun: options.dryRun ?? false,
			removed: true,
			composeCommands: commands.map(formatComposeCommand),
			fallbackStackId: fallback?.id ?? null,
			workosActions: [],
		}
		if (options.dryRun) return result

		const dockerEnvironment = await createDevstackDockerProcessEnvironment(options.registryPath)
		const executableCommands = commands.map((command) => ({
			...command,
			env: { ...command.env, ...dockerEnvironment },
		}))
		for (const command of executableCommands) {
			options.onProgress?.(`Removing ${command.label} resources...`)
			await executeCompose(command)
		}
		if (deletion.removed.workos) result.workosActions = retainedWorkOSResourceActions(deletion.removed.workos)
		options.onProgress?.('Updating workspace projection...')
		await updateWorktreeProjection(
			deletion.removed,
			fallback,
			options.registryPath,
			deletion.registry.defaults?.organization?.id,
		)
		options.onProgress?.('Updating Caddy routes...')
		await regenerateCaddyConfig(options.registryPath, deletion.registry)
		options.onProgress?.('Updating stack registry...')
		await writeRegistry(options.registryPath, deletion.registry)
		return result
	})
}

export function formatDownResult(result: DownResult): string {
	if (!result.removed) return `Stack "${result.stackId}" was not registered; nothing to remove.\n`
	const heading = result.dryRun ? `Dry run for stack "${result.stackId}":` : `Removed stack "${result.stackId}".`
	const lines = [heading, ...result.composeCommands.map((command) => `  ${command}`)]
	lines.push(...result.workosActions.map((action) => `  WorkOS ${action}`))
	if (result.fallbackStackId) lines.push(`Selected workspace stack: ${result.fallbackStackId}`)
	else lines.push('Selected workspace stack: none')
	return `${lines.join('\n')}\n`
}
