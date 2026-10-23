import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readWorkspaceConfig, writeWorkspaceConfig } from '../lib/workspace-config'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(Boolean(process.env.CI))('workspace-local devstack config', () => {
	it('writes and reads a sanitized stack ID', async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), 'devstack-workspace-config-test-'))
		temporaryDirectories.push(repoRoot)
		await writeWorkspaceConfig(repoRoot, 'Feature/One')

		await expect(readWorkspaceConfig(repoRoot)).resolves.toEqual({ stackId: 'feature-one' })
		expect(JSON.parse(await readFile(join(repoRoot, '.devstack.json'), 'utf8'))).toEqual({ stackId: 'feature-one' })
	})

	it('returns null when absent and rejects malformed local state', async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), 'devstack-workspace-config-invalid-test-'))
		temporaryDirectories.push(repoRoot)
		await expect(readWorkspaceConfig(repoRoot)).resolves.toBeNull()

		await writeFile(join(repoRoot, '.devstack.json'), '{"stackId": 42}\n')
		await expect(readWorkspaceConfig(repoRoot)).rejects.toThrow('expected a string stackId')
	})
})
