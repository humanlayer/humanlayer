import type { WorkspaceState } from '@humanlayer/db'
import { deriveWorkspaceView } from '@humanlayer/db/utils/workspace-view'
import { describe, expect, test } from 'vitest'

import {
	deriveWorkspaceLaunchChoices,
	deriveWorkspacePrimaryLaunchDirectory,
	requiresRepositoryDirectoryForLaunch,
	resolveHostScopedTaskDirectory,
	resolveWorkspaceBaseDirectory,
} from '@/lib/workspace-launch'

describe('requiresRepositoryDirectoryForLaunch', () => {
	test('requires a location for any now-task host without a setup row', () => {
		expect(
			requiresRepositoryDirectoryForLaunch({
				worktreeTiming: 'now',
				workspaceSpec: {} as never,
				hasHostSetupRow: false,
			}),
		).toBe(true)
	})

	test('does not prompt a host that already has a setup row, even one without a resolved mapping', () => {
		expect(
			requiresRepositoryDirectoryForLaunch({
				worktreeTiming: 'now',
				workspaceSpec: {} as never,
				hasHostSetupRow: true,
			}),
		).toBe(false)
	})

	test.each(['later', 'never'] as const)('does not affect %s tasks', (worktreeTiming) => {
		expect(
			requiresRepositoryDirectoryForLaunch({
				worktreeTiming,
				workspaceSpec: {} as never,
				hasHostSetupRow: false,
			}),
		).toBe(false)
	})
})

const multiRepoState: WorkspaceState = {
	workspaceBaseDirectory: '~/.humanlayer/workspaces/core-1349-multi-repo',
	repos: [
		{
			path: 'syncopate',
			description: 'HumanLayer monorepo',
			sourceRef: 'HEAD',
			branch: 'core-1349-multi-repo',
			primary: true,
		},
		{
			path: 'agentlayer',
			description: 'AgentLayer SDK',
			sourceRef: 'origin/main',
			branch: 'core-1349-multi-repo',
			primary: false,
		},
		{ path: 'metalytics', sourceRef: 'origin/main', branch: 'core-1349-multi-repo', primary: false },
	],
}

const singleRepoState: WorkspaceState = {
	workspaceBaseDirectory: '~/.humanlayer/workspaces/solo-task',
	repos: [{ path: 'syncopate', sourceRef: 'HEAD', branch: 'solo-task', primary: true }],
}

function legacyWorkspaceView(state: WorkspaceState) {
	const workspaceView = deriveWorkspaceView({ workspaceSpec: null, legacyWorkspaceState: state })
	if (!workspaceView) throw new Error('Expected legacy workspace fixture to resolve')
	return workspaceView
}

const multiRepoSpec = {
	specVersion: 1,
	directory: '~/projects/syncopate',
	workspaceBaseDirectory: '~/.humanlayer/workspaces/core-1349',
	setupBlocksFirstSession: false,
	repos: [
		{
			localPath: '.',
			targetPath: '~/.humanlayer/workspaces/core-1349/syncopate',
			branch: 'core-1349',
			sourceRef: 'HEAD',
			copyGlobs: [],
			primary: true,
		},
		{
			localPath: '../agentlayer',
			targetPath: '~/.humanlayer/workspaces/core-1349/agentlayer',
			branch: 'core-1349',
			sourceRef: 'origin/main',
			copyGlobs: [],
			primary: false,
		},
	],
}

const currentHostSetupState = {
	specVersion: 1,
	repos: [
		{
			localPath: '.',
			status: 'copy_globs' as const,
			worktree: { targetPath: '/Users/bob/current-host/core-1349/syncopate' },
		},
		{
			localPath: '../agentlayer',
			status: 'copy_globs' as const,
			worktree: { targetPath: '/Users/bob/current-host/core-1349/agentlayer' },
		},
	],
}

describe('resolveWorkspaceBaseDirectory', () => {
	test('null for legacy tasks (no workspace_state)', () => {
		expect(resolveWorkspaceBaseDirectory(null)).toBeNull()
		expect(resolveWorkspaceBaseDirectory(undefined)).toBeNull()
	})

	test('null for single-repo snapshots (multi-repo behavior is gated on repos.length > 1)', () => {
		expect(
			resolveWorkspaceBaseDirectory(legacyWorkspaceView(singleRepoState), '/Users/bob/wt/solo-task'),
		).toBeNull()
	})

	test('prefers the user recorded local base over the snapshot base', () => {
		expect(resolveWorkspaceBaseDirectory(legacyWorkspaceView(multiRepoState), '/Users/bob/custom/core-1349')).toBe(
			'/Users/bob/custom/core-1349',
		)
	})

	test('falls back to the snapshot non-expanded base when the user has no recorded base', () => {
		expect(resolveWorkspaceBaseDirectory(legacyWorkspaceView(multiRepoState), null)).toBe(
			'~/.humanlayer/workspaces/core-1349-multi-repo',
		)
		expect(resolveWorkspaceBaseDirectory(legacyWorkspaceView(multiRepoState), '   ')).toBe(
			'~/.humanlayer/workspaces/core-1349-multi-repo',
		)
	})
})

describe('deriveWorkspaceLaunchChoices', () => {
	test('empty for legacy and single-repo tasks', () => {
		expect(deriveWorkspaceLaunchChoices({ workspaceState: null })).toEqual([])
		expect(deriveWorkspaceLaunchChoices({ workspaceState: undefined })).toEqual([])
		expect(deriveWorkspaceLaunchChoices({ workspaceState: singleRepoState })).toEqual([])
	})

	test('workspace root first, then repos in config-declared order with primary flagged', () => {
		const choices = deriveWorkspaceLaunchChoices({
			workspaceState: multiRepoState,
			userWorkspaceBaseDirectory: '/Users/bob/wt/core-1349',
		})

		expect(choices).toEqual([
			{ path: '/Users/bob/wt/core-1349', label: 'workspace root', kind: 'root', primary: false },
			{
				path: '/Users/bob/wt/core-1349/syncopate',
				label: 'syncopate',
				kind: 'repo',
				primary: true,
				description: 'HumanLayer monorepo',
			},
			{
				path: '/Users/bob/wt/core-1349/agentlayer',
				label: 'agentlayer',
				kind: 'repo',
				primary: false,
				description: 'AgentLayer SDK',
			},
			{ path: '/Users/bob/wt/core-1349/metalytics', label: 'metalytics', kind: 'repo', primary: false },
		])
	})

	test('omits description rather than fabricating one', () => {
		const choices = deriveWorkspaceLaunchChoices({
			workspaceState: multiRepoState,
			userWorkspaceBaseDirectory: '/Users/bob/wt/core-1349',
		})
		const metalytics = choices.find((c) => c.label === 'metalytics')
		expect(metalytics).toBeDefined()
		expect(metalytics ? 'description' in metalytics : true).toBe(false)
	})

	test('prefers workspace_spec plus current-host worktree paths over workspace_state', () => {
		const choices = deriveWorkspaceLaunchChoices({
			workspaceSpec: multiRepoSpec,
			workspaceSetupState: currentHostSetupState,
			workspaceState: { ...multiRepoState, workspaceBaseDirectory: '/legacy-workspace' },
			userWorkspaceBaseDirectory: '/stale-user-workspace',
		})

		expect(choices.map((choice) => choice.path)).toEqual([
			'/Users/bob/current-host/core-1349',
			'/Users/bob/current-host/core-1349/syncopate',
			'/Users/bob/current-host/core-1349/agentlayer',
		])
	})

	test('uses workspace_spec without falling back to workspace_state when host setup has not arrived', () => {
		const choices = deriveWorkspaceLaunchChoices({
			workspaceSpec: multiRepoSpec,
			workspaceState: { ...multiRepoState, workspaceBaseDirectory: '/legacy-workspace' },
			homeDirectory: '/Users/bob',
		})

		expect(choices[0]?.path).toBe('/Users/bob/.humanlayer/workspaces/core-1349')
		expect(choices[1]?.path).toBe('/Users/bob/.humanlayer/workspaces/core-1349/syncopate')
	})

	test('expands the snapshot ~ base against the provided home directory', () => {
		const choices = deriveWorkspaceLaunchChoices({
			workspaceState: multiRepoState,
			homeDirectory: '/Users/bob',
		})
		expect(choices[0]?.path).toBe('/Users/bob/.humanlayer/workspaces/core-1349-multi-repo')
		expect(choices[1]?.path).toBe('/Users/bob/.humanlayer/workspaces/core-1349-multi-repo/syncopate')
	})

	test('keeps the ~ base portable when no home directory is known (web mode)', () => {
		const choices = deriveWorkspaceLaunchChoices({ workspaceState: multiRepoState })
		expect(choices[0]?.path).toBe('~/.humanlayer/workspaces/core-1349-multi-repo')
		expect(choices[2]?.path).toBe('~/.humanlayer/workspaces/core-1349-multi-repo/agentlayer')
	})

	test('does not expand ~ inside a user-recorded base (only a leading ~ is a home reference)', () => {
		const choices = deriveWorkspaceLaunchChoices({
			workspaceState: multiRepoState,
			userWorkspaceBaseDirectory: '/Users/bob/wt~archive/core-1349',
			homeDirectory: '/Users/bob',
		})
		expect(choices[0]?.path).toBe('/Users/bob/wt~archive/core-1349')
	})

	test('tolerates trailing slashes on the base and home directory', () => {
		const fromUserBase = deriveWorkspaceLaunchChoices({
			workspaceState: multiRepoState,
			userWorkspaceBaseDirectory: '/Users/bob/wt/core-1349/',
		})
		expect(fromUserBase[1]?.path).toBe('/Users/bob/wt/core-1349/syncopate')

		const fromHome = deriveWorkspaceLaunchChoices({
			workspaceState: multiRepoState,
			homeDirectory: '/Users/bob/',
		})
		expect(fromHome[1]?.path).toBe('/Users/bob/.humanlayer/workspaces/core-1349-multi-repo/syncopate')
	})
})

describe('deriveWorkspacePrimaryLaunchDirectory', () => {
	test('null for legacy and single-repo tasks (pre-fill unchanged)', () => {
		expect(deriveWorkspacePrimaryLaunchDirectory({ workspaceState: null })).toBeNull()
		expect(deriveWorkspacePrimaryLaunchDirectory({ workspaceState: singleRepoState })).toBeNull()
	})

	test('primary repo directory under the user recorded base', () => {
		expect(
			deriveWorkspacePrimaryLaunchDirectory({
				workspaceState: multiRepoState,
				userWorkspaceBaseDirectory: '/Users/bob/wt/core-1349',
			}),
		).toBe('/Users/bob/wt/core-1349/syncopate')
	})

	test('primary repo directory under the tilde-expanded snapshot base', () => {
		expect(
			deriveWorkspacePrimaryLaunchDirectory({
				workspaceState: multiRepoState,
				homeDirectory: '/Users/bob',
			}),
		).toBe('/Users/bob/.humanlayer/workspaces/core-1349-multi-repo/syncopate')
	})

	test('non-expanded ~ path when no local base or home is known', () => {
		expect(deriveWorkspacePrimaryLaunchDirectory({ workspaceState: multiRepoState })).toBe(
			'~/.humanlayer/workspaces/core-1349-multi-repo/syncopate',
		)
	})

	test('falls back to the first repo in config order when no repo is flagged primary', () => {
		const noPrimary: WorkspaceState = {
			...multiRepoState,
			repos: multiRepoState.repos.map((repo) => ({ ...repo, primary: false })),
		}
		expect(
			deriveWorkspacePrimaryLaunchDirectory({
				workspaceState: noPrimary,
				userWorkspaceBaseDirectory: '/Users/bob/wt/core-1349',
			}),
		).toBe('/Users/bob/wt/core-1349/syncopate')
	})
})

describe('resolveHostScopedTaskDirectory', () => {
	test('uses the planned workspace directory when switching to an unmapped host', () => {
		expect(
			resolveHostScopedTaskDirectory({
				taskOwnerUserId: 'owner',
				userId: 'owner',
				hostId: 'host-b',
				userSettings: { host_id: 'host-a', working_directory: '/host-a/task-worktree' },
				setupRows: [{ host_id: 'host-a', resolved_workspace_spec: multiRepoSpec }],
				plannedWorkspaceDirectory: '/planned/unmapped-workspace',
				fallback: '/unrelated/default',
			}),
		).toBe('/planned/unmapped-workspace')
	})

	test('uses the mapped primary directory when an owner switches to a mapped host', () => {
		expect(
			resolveHostScopedTaskDirectory({
				taskOwnerUserId: 'owner',
				userId: 'owner',
				hostId: 'host-b',
				userSettings: null,
				setupRows: [{ host_id: 'host-b', resolved_workspace_spec: multiRepoSpec }],
				plannedWorkspaceDirectory: '/planned/unmapped-workspace',
				fallback: '/unrelated/default',
			}),
		).toBe('~/.humanlayer/workspaces/core-1349/syncopate')
	})

	test('uses a collaborator default only on the host where it was saved', () => {
		const input = {
			taskOwnerUserId: 'owner',
			userId: 'collaborator',
			userSettings: { host_id: 'host-a', working_directory: '/host-a/task-worktree' },
			setupRows: [],
			fallback: '/fallback',
		}
		expect(resolveHostScopedTaskDirectory({ ...input, hostId: 'host-a' })).toBe('/host-a/task-worktree')
		expect(resolveHostScopedTaskDirectory({ ...input, hostId: 'host-b' })).toBe('/fallback')
	})

	test('falls back to the selected host mapping primary worktree', () => {
		expect(
			resolveHostScopedTaskDirectory({
				taskOwnerUserId: 'owner',
				userId: 'collaborator',
				hostId: 'host-b',
				userSettings: { host_id: 'host-a', working_directory: '/host-a/task-worktree' },
				setupRows: [{ host_id: 'host-b', resolved_workspace_spec: multiRepoSpec }],
				fallback: '/fallback',
			}),
		).toBe('~/.humanlayer/workspaces/core-1349/syncopate')
	})
})
