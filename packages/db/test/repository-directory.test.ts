import { describe, expect, test } from 'vitest'

import {
	deriveRepositoryPlacement,
	getPrimaryTargetDirectory,
	resolveRepositoryWorkspaceSpec,
	resolveSingleRepositoryWorkspaceSpec,
} from '../src/utils/repository-directory'
import type { WorkspaceSpec } from '../src/zodschemas/workspace-spec'

const workspaceSpec: WorkspaceSpec = {
	specVersion: 1,
	directory: '~/creator/team-a/syncopate',
	workspaceBaseDirectory: '~/.humanlayer/workspaces/shared-task',
	setupBlocksFirstSession: true,
	repos: [
		{
			localPath: '.',
			targetPath: '~/.humanlayer/workspaces/shared-task/syncopate',
			branch: 'shared-task',
			sourceRef: 'origin/main',
			copyGlobs: [],
			primary: true,
		},
		{
			localPath: '../../team-b/fold',
			targetPath: '~/.humanlayer/workspaces/shared-task/fold',
			branch: 'shared-task',
			sourceRef: 'origin/main',
			copyGlobs: [],
			primary: false,
		},
	],
}

describe('repository directory placement', () => {
	test('previews and resolves a multi-repository source layout', () => {
		const placement = deriveRepositoryPlacement(workspaceSpec)
		expect(placement.repositoryDirectory).toBe('~/creator')
		expect(placement.repositories.map((repo) => repo.relativePath)).toEqual(['team-a/syncopate', 'team-b/fold'])

		const resolved = resolveRepositoryWorkspaceSpec(workspaceSpec, '~/projects')
		expect(resolved.directory).toBe('~/projects/team-a/syncopate')
		expect(resolved.repos.map((repo) => repo.localPath)).toEqual(['.', '../../team-b/fold'])
		expect(getPrimaryTargetDirectory(resolved)).toBe('~/.humanlayer/workspaces/shared-task/syncopate')
	})

	test.each(['/Users/bob/projects/syncopate', '~/projects/syncopate'])(
		'uses %s as a single source checkout while preserving its worktree target',
		(sourceCheckout) => {
			const single = { ...workspaceSpec, repos: [workspaceSpec.repos[0]!] }
			const resolved = resolveSingleRepositoryWorkspaceSpec(single, sourceCheckout)
			expect(resolved.directory).toBe(sourceCheckout)
			expect(resolved.repos[0]?.localPath).toBe('.')
			expect(getPrimaryTargetDirectory(resolved)).toBe('~/.humanlayer/workspaces/shared-task/syncopate')
		},
	)
})
