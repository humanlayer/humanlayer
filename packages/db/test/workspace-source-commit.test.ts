import { describe, expect, test } from 'vitest'

import { pinWorkspaceSpecSourceCommit, WorkspaceSpecSourceCommitPinResult } from '../src/utils/workspace-source-commit'
import type { WorkspaceSpec } from '../src/zodschemas/workspace-spec'

const workspaceSpec: WorkspaceSpec = {
	specVersion: 1,
	directory: '~/projects/syncopate',
	workspaceBaseDirectory: '~/.humanlayer/workspaces/task',
	setupBlocksFirstSession: false,
	repos: [
		{
			localPath: '.',
			targetPath: '~/.humanlayer/workspaces/task/syncopate',
			branch: 'task',
			sourceRef: 'origin/main',
			copyGlobs: [],
			primary: true,
		},
		{
			localPath: '../api',
			targetPath: '~/.humanlayer/workspaces/task/api',
			branch: 'task',
			sourceRef: 'origin/main',
			copyGlobs: [],
			primary: false,
		},
	],
}

describe('pinWorkspaceSpecSourceCommit', () => {
	test('pins each repository independently without changing the remaining workspace spec', () => {
		const result = pinWorkspaceSpecSourceCommit({
			workspaceSpec,
			localPath: '../api',
			resolvedSourceCommit: 'b'.repeat(40),
		})

		const pinnedWorkspaceSpec = WorkspaceSpecSourceCommitPinResult.$match(result, {
			Pinned: ({ changed, workspaceSpec: resultWorkspaceSpec }) => {
				expect(changed).toBe(true)
				return resultWorkspaceSpec
			},
			RepositoryNotFound: () => {
				throw new Error('Expected the workspace source commit to be pinned')
			},
			SourceCommitConflict: () => {
				throw new Error('Expected the workspace source commit to be pinned')
			},
		})
		expect(pinnedWorkspaceSpec.repos).toEqual([
			workspaceSpec.repos[0],
			{ ...workspaceSpec.repos[1], sourceCommit: 'b'.repeat(40) },
		])
	})

	test('does not replace an already pinned source commit', () => {
		const [primaryRepository, secondaryRepository] = workspaceSpec.repos
		if (!primaryRepository || !secondaryRepository) {
			throw new Error('Expected both repositories in the workspace fixture')
		}
		const pinnedSpec = {
			...workspaceSpec,
			repos: [{ ...primaryRepository, sourceCommit: 'a'.repeat(40) }, secondaryRepository],
		}
		const result = pinWorkspaceSpecSourceCommit({
			workspaceSpec: pinnedSpec,
			localPath: '.',
			resolvedSourceCommit: 'b'.repeat(40),
		})

		expect(result).toEqual({
			_tag: 'SourceCommitConflict',
			recordedSourceCommit: 'a'.repeat(40),
		})
	})
})
