import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sanitizeStackId } from './stack-id'

export const DEVSTACK_WORKSPACE_CONFIG = '.devstack.json'

export type DevstackWorkspaceConfig = {
	stackId: string
}

export function workspaceConfigPath(repoRoot: string): string {
	return join(repoRoot, DEVSTACK_WORKSPACE_CONFIG)
}

export async function readWorkspaceConfig(repoRoot: string): Promise<DevstackWorkspaceConfig | null> {
	const path = workspaceConfigPath(repoRoot)
	let contents: string
	try {
		contents = await readFile(path, 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
		throw error
	}

	let value: unknown
	try {
		value = JSON.parse(contents)
	} catch {
		throw new Error(`Invalid devstack workspace config at ${path}: expected valid JSON`)
	}
	if (!value || typeof value !== 'object' || typeof (value as { stackId?: unknown }).stackId !== 'string') {
		throw new Error(`Invalid devstack workspace config at ${path}: expected a string stackId`)
	}
	return { stackId: sanitizeStackId((value as { stackId: string }).stackId) }
}

export async function writeWorkspaceConfig(repoRoot: string, stackId: string): Promise<void> {
	const path = workspaceConfigPath(repoRoot)
	const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
	await writeFile(temporaryPath, `${JSON.stringify({ stackId: sanitizeStackId(stackId) }, null, 2)}\n`, {
		mode: 0o600,
	})
	await rename(temporaryPath, path)
}

export async function removeWorkspaceConfig(repoRoot: string): Promise<void> {
	await rm(workspaceConfigPath(repoRoot), { force: true })
}
