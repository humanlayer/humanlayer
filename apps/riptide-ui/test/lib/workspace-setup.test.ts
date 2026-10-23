import { describe, expect, test } from 'vitest'

import type { WorkspaceRepoInput } from '@/integrations/tauri/workspace-setup'
import type { EffectiveRepoEntry, EffectiveWorkspaceConfig } from '@/lib/workspace-config-schema'
import {
	applyPrimaryRepoSelection,
	deriveWorkspaceBaseDirectory,
	isLargeWorkspace,
	LARGE_WORKSPACE_REPO_THRESHOLD,
	needsLargeWorkspaceConfirmation,
	renderAllRepoInputs,
	renderRepoInput,
} from '@/lib/workspace-setup'

// ---------------------------------------------------------------------------
// Helpers — build a minimal EffectiveWorkspaceConfig for testing
// ---------------------------------------------------------------------------

function makeConfig(repoCount: number, overrides: Partial<EffectiveWorkspaceConfig> = {}): EffectiveWorkspaceConfig {
	const repos = Array.from({ length: repoCount }, (_, i) => ({
		localPath: i === 0 ? '.' : `../repo-${i}`,
		sourceRef: 'origin/main',
		setupCommand: '',
		copyGlobs: [] as string[],
		primary: i === 0,
	}))
	return {
		disabled: false,
		pathTemplate: '~/worktrees/{{ TASKSLUG }}/{{ REPOBASENAME }}',
		branchTemplate: '{{ TASKSLUG }}',
		sourceRef: 'origin/main',
		setupCommand: '',
		copyGlobs: [],
		repos,
		isMissingConfig: false,
		disabledSource: undefined,
		...overrides,
	}
}

function makeRepoEntry(localPath: string, overrides: Partial<EffectiveRepoEntry> = {}): EffectiveRepoEntry {
	return {
		localPath,
		sourceRef: 'origin/main',
		setupCommand: '',
		copyGlobs: [],
		primary: false,
		...overrides,
	}
}

function makeRepoInput(targetPath: string, overrides: Partial<WorkspaceRepoInput> = {}): WorkspaceRepoInput {
	return {
		localPath: '.',
		targetPath,
		branch: 'task',
		sourceRef: 'origin/main',
		setupCommand: '',
		copyGlobs: [],
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// LARGE_WORKSPACE_REPO_THRESHOLD constant
// ---------------------------------------------------------------------------

describe('LARGE_WORKSPACE_REPO_THRESHOLD', () => {
	test('is 5', () => {
		expect(LARGE_WORKSPACE_REPO_THRESHOLD).toBe(5)
	})
})

// ---------------------------------------------------------------------------
// isLargeWorkspace
// ---------------------------------------------------------------------------

describe('isLargeWorkspace', () => {
	test('returns false for 5 or fewer repos', () => {
		expect(isLargeWorkspace(makeConfig(1))).toBe(false)
		expect(isLargeWorkspace(makeConfig(5))).toBe(false)
	})

	test('returns true for more than 5 repos', () => {
		expect(isLargeWorkspace(makeConfig(6))).toBe(true)
		expect(isLargeWorkspace(makeConfig(20))).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// needsLargeWorkspaceConfirmation
// ---------------------------------------------------------------------------

describe('needsLargeWorkspaceConfirmation', () => {
	test('returns false for small workspace (≤5 repos)', () => {
		const config = makeConfig(3)
		expect(needsLargeWorkspaceConfirmation(config, { allowedThisTime: false, alwaysAllow: false })).toBe(false)
	})

	test('returns true for large workspace when not allowed', () => {
		const config = makeConfig(6)
		expect(needsLargeWorkspaceConfirmation(config, { allowedThisTime: false, alwaysAllow: false })).toBe(true)
	})

	test('returns false for large workspace when allowedThisTime is true', () => {
		const config = makeConfig(6)
		expect(needsLargeWorkspaceConfirmation(config, { allowedThisTime: true, alwaysAllow: false })).toBe(false)
	})

	test('returns false for large workspace when alwaysAllow is true', () => {
		const config = makeConfig(6)
		expect(needsLargeWorkspaceConfirmation(config, { allowedThisTime: false, alwaysAllow: true })).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// renderRepoInput
// ---------------------------------------------------------------------------

describe('renderRepoInput', () => {
	test('renders targetPath and branch from templates', () => {
		const repo = {
			localPath: '.',
			sourceRef: 'origin/main',
			setupCommand: '',
			copyGlobs: [] as string[],
			primary: true,
		}

		const result = renderRepoInput(repo, {
			taskSlug: 'my-task',
			selectedDirectory: '/home/user/repos/myrepo',
			pathTemplate: '~/worktrees/{{ TASKSLUG }}/{{ REPOBASENAME }}',
			branchTemplate: '{{ TASKSLUG }}',
		})

		expect(result.localPath).toBe('.')
		expect(result.branch).toBe('my-task')
		expect(result.targetPath).toBe('~/worktrees/my-task/myrepo')
		expect(result.sourceRef).toBe('origin/main')
	})

	test('uses repoBasename from localPath for non-dot repos', () => {
		const repo = {
			localPath: '../api',
			sourceRef: 'HEAD',
			setupCommand: 'bun install',
			copyGlobs: ['.env'] as string[],
			primary: false,
		}

		const result = renderRepoInput(repo, {
			taskSlug: 'feature-xyz',
			selectedDirectory: '/home/user/repos/ui',
			pathTemplate: '~/worktrees/{{ TASKSLUG }}/{{ REPOBASENAME }}',
			branchTemplate: '{{ TASKSLUG }}',
		})

		expect(result.branch).toBe('feature-xyz')
		expect(result.targetPath).toContain('feature-xyz')
		expect(result.setupCommand).toBe('bun install')
		expect(result.copyGlobs).toEqual(['.env'])
	})
})

// ---------------------------------------------------------------------------
// renderAllRepoInputs
// ---------------------------------------------------------------------------

describe('renderAllRepoInputs', () => {
	test('renders inputs for all repos in the config', () => {
		const config = makeConfig(3)
		const results = renderAllRepoInputs(config, {
			taskSlug: 'test-slug',
			selectedDirectory: '/home/user/projects/main',
		})

		expect(results).toHaveLength(3)
		for (const r of results) {
			expect(r.branch).toBe('test-slug')
			expect(r.targetPath).toContain('test-slug')
		}
	})

	test('returns empty array for config with no repos', () => {
		const config = makeConfig(0)
		const results = renderAllRepoInputs(config, {
			taskSlug: 'slug',
			selectedDirectory: '/tmp/dir',
		})
		expect(results).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// applyPrimaryRepoSelection
// ---------------------------------------------------------------------------

describe('applyPrimaryRepoSelection', () => {
	test('single-repo selection is always primary, regardless of config flags', () => {
		const result = applyPrimaryRepoSelection([makeRepoEntry('../api', { primary: false })], null)
		expect(result).toHaveLength(1)
		expect(result[0].primary).toBe(true)
	})

	test('override wins: the chosen repo becomes primary, all others non-primary', () => {
		const repos = [makeRepoEntry('.', { primary: true }), makeRepoEntry('../api'), makeRepoEntry('../docs')]
		const result = applyPrimaryRepoSelection(repos, '../api')
		expect(result.map((r) => r.primary)).toEqual([false, true, false])
	})

	test('no override leaves config-marked primary flags unchanged', () => {
		const repos = [makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')]
		const result = applyPrimaryRepoSelection(repos, null)
		expect(result.map((r) => r.primary)).toEqual([true, false])
	})

	test('override not matching any repo in the selection is ignored', () => {
		const repos = [makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')]
		const result = applyPrimaryRepoSelection(repos, '../excluded')
		expect(result.map((r) => r.primary)).toEqual([true, false])
	})

	test('multi-repo selection with no primary anywhere stays primary-less', () => {
		const repos = [makeRepoEntry('.'), makeRepoEntry('../api')]
		const result = applyPrimaryRepoSelection(repos, null)
		expect(result.every((r) => !r.primary)).toBe(true)
	})

	test('does not mutate the input entries', () => {
		const repos = [makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')]
		applyPrimaryRepoSelection(repos, '../api')
		expect(repos[0].primary).toBe(true)
		expect(repos[1].primary).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// deriveWorkspaceBaseDirectory
// ---------------------------------------------------------------------------

describe('deriveWorkspaceBaseDirectory', () => {
	test('single repo always passes: base = the target path parent', () => {
		const result = deriveWorkspaceBaseDirectory([makeRepoInput('~/.humanlayer/workspaces/my-task/syncopate')])
		expect(result).toEqual({ ok: true, baseDir: '~/.humanlayer/workspaces/my-task' })
	})

	test('multi-repo targets sharing one parent pass with that parent as base', () => {
		const result = deriveWorkspaceBaseDirectory([
			makeRepoInput('~/.humanlayer/workspaces/my-task/syncopate'),
			makeRepoInput('~/.humanlayer/workspaces/my-task/agentlayer', { localPath: '../agentlayer' }),
			makeRepoInput('~/.humanlayer/workspaces/my-task/metalytics', { localPath: '../metalytics' }),
		])
		expect(result).toEqual({ ok: true, baseDir: '~/.humanlayer/workspaces/my-task' })
	})

	test('tolerates trailing slashes on target paths', () => {
		const result = deriveWorkspaceBaseDirectory([
			makeRepoInput('~/ws/task/a/'),
			makeRepoInput('~/ws/task/b', { localPath: '../b' }),
		])
		expect(result).toEqual({ ok: true, baseDir: '~/ws/task' })
	})

	test('multi-repo targets NOT sharing a parent fail with a config error', () => {
		const result = deriveWorkspaceBaseDirectory([
			makeRepoInput('~/wt/syncopate/my-task'),
			makeRepoInput('~/wt/agentlayer/my-task', { localPath: '../agentlayer' }),
		])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toContain('share one parent directory')
			expect(result.error).toContain('pathTemplate')
		}
	})

	test('empty input fails', () => {
		const result = deriveWorkspaceBaseDirectory([])
		expect(result.ok).toBe(false)
	})

	test('target path without a derivable parent fails', () => {
		const result = deriveWorkspaceBaseDirectory([makeRepoInput('repo-dir-only')])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toContain('repo-dir-only')
		}
	})

	test('absolute paths derive an absolute base', () => {
		const result = deriveWorkspaceBaseDirectory([
			makeRepoInput('/Users/dev/ws/task/a'),
			makeRepoInput('/Users/dev/ws/task/b', { localPath: '../b' }),
		])
		expect(result).toEqual({ ok: true, baseDir: '/Users/dev/ws/task' })
	})
})
