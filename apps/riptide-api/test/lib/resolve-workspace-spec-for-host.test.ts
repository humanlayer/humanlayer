import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { describe, expect, test } from 'vitest'

import {
	resolveWorkspaceSessionWorkingDirectory,
	resolveWorkspaceSpecForHost,
} from '../../src/lib/workspace-setup/resolve-workspace-spec-for-host'

const repository = {
	localPath: '.',
	targetPath: '~/.humanlayer/workspaces/task/syncopate',
	branch: 'task',
	sourceRef: 'origin/main',
	copyGlobs: [],
	primary: true,
}

const singleRepositoryWorkspaceSpec: WorkspaceSpec = {
	specVersion: 1,
	directory: '~/creator/syncopate',
	workspaceBaseDirectory: '~/.humanlayer/workspaces/task',
	setupBlocksFirstSession: false,
	repos: [repository],
}

describe('resolveWorkspaceSpecForHost', () => {
	test('uses the selected working directory as a single repository checkout', () => {
		const resolved = resolveWorkspaceSpecForHost({
			workspaceSpec: singleRepositoryWorkspaceSpec,
			repositoryDirectory: '  ~/projects/syncopate  ',
		})

		expect(resolved?.directory).toBe('~/projects/syncopate')
		expect(resolved?.repos[0]?.localPath).toBe('.')
	})

	test('recreates a multi-repository layout below the selected working directory', () => {
		const resolved = resolveWorkspaceSpecForHost({
			workspaceSpec: {
				...singleRepositoryWorkspaceSpec,
				directory: '~/creator/team-a/syncopate',
				repos: [
					{ ...repository, localPath: '.', primary: true },
					{ ...repository, localPath: '../../team-b/fold', primary: false },
				],
			},
			repositoryDirectory: '~/projects',
		})

		expect(resolved?.directory).toBe('~/projects/team-a/syncopate')
		expect(resolved?.repos.map((repository) => repository.localPath)).toEqual(['.', '../../team-b/fold'])
	})

	test('resolves the selected host path identically for the task owner', () => {
		expect(
			resolveWorkspaceSpecForHost({
				workspaceSpec: singleRepositoryWorkspaceSpec,
				repositoryDirectory: '~/unrelated/selection',
			}),
		).toEqual({
			...singleRepositoryWorkspaceSpec,
			directory: '~/unrelated/selection',
			repos: [{ ...singleRepositoryWorkspaceSpec.repos[0], localPath: '.' }],
		})
	})

	test('requires a source repository directory for an unmapped host', () => {
		expect(() =>
			resolveWorkspaceSpecForHost({
				workspaceSpec: singleRepositoryWorkspaceSpec,
			}),
		).toThrow('Repository directory is required')
	})
})

describe('resolveWorkspaceSessionWorkingDirectory', () => {
	const multiRepositoryWorkspaceSpec: WorkspaceSpec = {
		...singleRepositoryWorkspaceSpec,
		repos: [
			repository,
			{
				...repository,
				localPath: '../effect',
				targetPath: '~/.humanlayer/workspaces/task/effect',
				primary: false,
			},
		],
	}

	test('honors a selected non-primary repository and canonicalizes an expanded home path', () => {
		expect(
			resolveWorkspaceSessionWorkingDirectory(
				multiRepositoryWorkspaceSpec,
				'/Users/test/.humanlayer/workspaces/task/effect',
			),
		).toBe('~/.humanlayer/workspaces/task/effect')
	})

	test('honors a custom directory inside the workspace', () => {
		expect(
			resolveWorkspaceSessionWorkingDirectory(
				multiRepositoryWorkspaceSpec,
				'/Users/test/.humanlayer/workspaces/task/effect/packages/core',
			),
		).toBe('~/.humanlayer/workspaces/task/effect/packages/core')
	})

	test('falls back to the primary repository for a directory outside the workspace', () => {
		expect(resolveWorkspaceSessionWorkingDirectory(multiRepositoryWorkspaceSpec, '~/wrong/path')).toBe(
			'~/.humanlayer/workspaces/task/syncopate',
		)
	})

	test('does not allow parent segments to escape the workspace', () => {
		expect(
			resolveWorkspaceSessionWorkingDirectory(
				multiRepositoryWorkspaceSpec,
				'~/.humanlayer/workspaces/task/../../outside',
			),
		).toBe('~/.humanlayer/workspaces/task/syncopate')
	})
})
