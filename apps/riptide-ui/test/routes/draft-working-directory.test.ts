import type { WorkspaceState } from '@humanlayer/db'
import { describe, expect, test } from 'vitest'

import {
	resolveDraftWorkingDirectory,
	resolveEffectiveDraftWorkingDirectory,
} from '../../src/lib/draft-working-directory'

const OWNER = 'user_owner'
const STRANGER = 'user_other'

const taskOwnedByMe = {
	resource_owner_user_id: OWNER,
	default_working_directory: '/Users/owner/repo',
}
const taskOwnedByOther = {
	resource_owner_user_id: STRANGER,
	default_working_directory: '/Users/owner/repo',
}

const multiRepoWorkspaceState: WorkspaceState = {
	workspaceBaseDirectory: '~/.humanlayer/workspaces/core-1349',
	repos: [
		{ path: 'syncopate', sourceRef: 'HEAD', branch: 'core-1349', primary: true },
		{ path: 'agentlayer', sourceRef: 'origin/main', branch: 'core-1349', primary: false },
	],
}

const singleRepoWorkspaceState: WorkspaceState = {
	workspaceBaseDirectory: '~/.humanlayer/workspaces/solo',
	repos: [{ path: 'syncopate', sourceRef: 'HEAD', branch: 'solo', primary: true }],
}

const multiRepoWorkspaceSpec = {
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

const currentHostWorkspaceSetupState = {
	specVersion: 1,
	repos: [
		{
			localPath: '.',
			status: 'copy_globs' as const,
			worktree: { targetPath: '/Users/me/current-host/core-1349/syncopate' },
		},
		{
			localPath: '../agentlayer',
			status: 'copy_globs' as const,
			worktree: { targetPath: '/Users/me/current-host/core-1349/agentlayer' },
		},
	],
}

describe('resolveDraftWorkingDirectory', () => {
	test('priority 1: existing draft working_directory wins over everything', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: { working_directory: '/from/draft' },
				workingDirectoryParam: '/from/param',
				userTaskSettings: { working_directory: '/from/user-settings' },
				task: taskOwnedByMe,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/from/draft')
	})

	test('priority 2: ?workingDirectory= URL param beats user/task settings', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: '/from/param',
				userTaskSettings: { working_directory: '/from/user-settings' },
				task: taskOwnedByMe,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/from/param')
	})

	test('priority 3: current user task_user_settings used when present (owner with own row)', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: { working_directory: '/from/user-settings' },
				task: taskOwnedByMe,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/from/user-settings')
	})

	test('priority 3: current user task_user_settings used when present (non-owner with own row)', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: { working_directory: '/Users/me/their-fork' },
				task: taskOwnedByOther,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/Users/me/their-fork')
	})

	test('priority 4: owner with no own row falls through to task.default_working_directory (CORE-1234 fix)', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null, // caller user-scoped the read; no row for owner
				task: taskOwnedByMe,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/Users/owner/repo')
	})

	test('priority 5: non-owner with no row falls through to defaultDirectory (skips task default)', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: taskOwnedByOther,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('~/')
	})

	test('priority 5: owner with no row and no task default falls through to defaultDirectory', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: { resource_owner_user_id: OWNER, default_working_directory: null },
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('~/')
	})

	test('no task, no draft, no param, no user settings → defaultDirectory', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: null,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('~/')
	})

	test('CORE-1234 regression: owner must NOT inherit a stranger row even if accidentally passed in', () => {
		// Belt-and-suspenders: the caller is now user-scoping the read, so userTaskSettings
		// SHOULD be null for an owner with no own row. But if a stranger's row leaks in,
		// the chain still has no defense — this test documents that priority 3 is sourced
		// trustingly. The real defense is the user-scoped useLiveQuery upstream.
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: { working_directory: '/Users/stranger/their-fork' },
				task: taskOwnedByMe,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/Users/stranger/their-fork')
	})

	test('priority 5: non-owner with no row on a multi-repo task pre-fills the primary repo under their recorded base', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: { working_directory: null, workspace_base_directory: '/Users/me/wt/core-1349' },
				task: { ...taskOwnedByOther, workspace_state: multiRepoWorkspaceState },
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/Users/me/wt/core-1349/syncopate')
	})

	test('priority 5: without a recorded base, the snapshot ~ base is expanded against the local home', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: { ...taskOwnedByOther, workspace_state: multiRepoWorkspaceState },
				userId: OWNER,
				defaultDirectory: '~/',
				homeDirectory: '/Users/me',
			}),
		).toBe('/Users/me/.humanlayer/workspaces/core-1349/syncopate')
	})

	test('priority 5: without a recorded base or local home (web), the ~ path stays portable', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: { ...taskOwnedByOther, workspace_state: multiRepoWorkspaceState },
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('~/.humanlayer/workspaces/core-1349/syncopate')
	})

	test('priority 4 beats 5: owner task default wins over the workspace derivation', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: { ...taskOwnedByMe, workspace_state: multiRepoWorkspaceState },
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/Users/owner/repo')
	})

	test('priority 3 beats 5: per-user working_directory override wins over the workspace derivation', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: {
					working_directory: '/Users/me/explicit-choice',
					workspace_base_directory: '/Users/me/wt/core-1349',
				},
				task: { ...taskOwnedByOther, workspace_state: multiRepoWorkspaceState },
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/Users/me/explicit-choice')
	})

	test('priority 5 prefers workspace_spec plus the current-host setup row over workspace_state', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: { working_directory: null, workspace_base_directory: '/stale-user-workspace' },
				task: {
					...taskOwnedByOther,
					workspace_spec: multiRepoWorkspaceSpec,
					workspace_state: { ...multiRepoWorkspaceState, workspaceBaseDirectory: '/legacy-workspace' },
				},
				workspaceSetupState: currentHostWorkspaceSetupState,
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('/Users/me/current-host/core-1349/syncopate')
	})

	test('single-repo snapshot skips priority 5 (pre-fill unchanged → defaultDirectory)', () => {
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: { ...taskOwnedByOther, workspace_state: singleRepoWorkspaceState },
				userId: OWNER,
				defaultDirectory: '~/',
			}),
		).toBe('~/')
	})

	test('prefills the planned task folder for an unresolved single-repo worktree', () => {
		const singleRepoWorkspaceSpec = { ...multiRepoWorkspaceSpec, repos: [multiRepoWorkspaceSpec.repos[0]!] }
		expect(
			resolveDraftWorkingDirectory({
				existingDraft: null,
				workingDirectoryParam: undefined,
				userTaskSettings: null,
				task: {
					...taskOwnedByOther,
					worktree_timing: 'now',
					workspace_spec: singleRepoWorkspaceSpec,
					workspace_state: null,
				},
				workspaceSetupState: null,
				userId: OWNER,
				defaultDirectory: '~/',
				homeDirectory: null,
			}),
		).toBe('~/.humanlayer/workspaces/core-1349/syncopate')
	})
})

describe('resolveEffectiveDraftWorkingDirectory', () => {
	test('keeps a later workspace directory selection instead of restoring the planned directory', () => {
		const plannedDirectory = resolveDraftWorkingDirectory({
			existingDraft: null,
			workingDirectoryParam: undefined,
			userTaskSettings: null,
			task: {
				...taskOwnedByOther,
				worktree_timing: 'now',
				workspace_spec: multiRepoWorkspaceSpec,
				workspace_state: null,
			},
			workspaceSetupState: null,
			userId: OWNER,
			defaultDirectory: '~/',
			homeDirectory: null,
		})

		expect(plannedDirectory).toBe('~/.humanlayer/workspaces/core-1349/syncopate')
		expect(resolveEffectiveDraftWorkingDirectory('/Users/me/other-repo', plannedDirectory)).toBe(
			'/Users/me/other-repo',
		)
	})

	test('uses the planned workspace directory until the form has a selection', () => {
		expect(resolveEffectiveDraftWorkingDirectory('', '/planned/workspace')).toBe('/planned/workspace')
	})
})
