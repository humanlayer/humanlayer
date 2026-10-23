import { describe, expect, test } from 'vitest'

import {
	checkWorkspaceNowEligibility,
	computeEffectiveConfig,
	generateLocalConfigPreview,
	generateRepoConfigPreview,
	interpolateTemplate,
	isLargeWorkspace,
	LARGE_WORKSPACE_REPO_THRESHOLD,
	parseWorkspaceConfig,
	parseWorkspaceLocalConfig,
	repoBasename,
	WORKSPACE_CONFIG_DEFAULTS,
} from '@/lib/workspace-config'
import type { EffectiveWorkspaceConfig } from '@/lib/workspace-config-schema'

// ---------------------------------------------------------------------------
// parseWorkspaceConfig
// ---------------------------------------------------------------------------

describe('parseWorkspaceConfig', () => {
	test('returns null for null input', () => {
		expect(parseWorkspaceConfig(null)).toBeNull()
	})

	test('returns null for empty string', () => {
		expect(parseWorkspaceConfig('')).toBeNull()
	})

	test('returns null for invalid JSON', () => {
		expect(parseWorkspaceConfig('{bad json')).toBeNull()
	})

	test('returns null for JSON that fails schema validation', () => {
		// disabled must be boolean, not a string
		expect(parseWorkspaceConfig(JSON.stringify({ disabled: 'yes' }))).toBeNull()
	})

	test('parses minimal valid config (empty object)', () => {
		const result = parseWorkspaceConfig('{}')
		expect(result).toEqual({})
	})

	test('parses full valid config', () => {
		const config = {
			disabled: false,
			pathTemplate: '~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}',
			branchTemplate: '{{ TASKSLUG }}',
			sourceRef: 'origin/main',
			setupCommand: 'bun install',
			copyGlobs: ['.env', '.env.local'],
			repos: [{ localPath: '.', description: 'Main repo' }],
		}
		const result = parseWorkspaceConfig(JSON.stringify(config))
		expect(result).toEqual(config)
	})

	test('rejects configs with unknown fields', () => {
		const config = { sourceRef: 'HEAD', unknownField: 42 }
		const result = parseWorkspaceConfig(JSON.stringify(config))
		// Schema uses strict mode, rejecting unknown fields
		expect(result).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// parseWorkspaceLocalConfig
// ---------------------------------------------------------------------------

describe('parseWorkspaceLocalConfig', () => {
	test('returns null for null input', () => {
		expect(parseWorkspaceLocalConfig(null)).toBeNull()
	})

	test('parses local config with $patch: delete on a repo entry', () => {
		const config = {
			repos: [{ localPath: '../legacy', $patch: 'delete' }],
		}
		const result = parseWorkspaceLocalConfig(JSON.stringify(config))
		expect(result?.repos?.[0]?.$patch).toBe('delete')
	})

	test('parses sparse local config (only pathTemplate override)', () => {
		const config = { pathTemplate: '~/wt/{{ REPOBASENAME }}/{{ TASKSLUG }}' }
		const result = parseWorkspaceLocalConfig(JSON.stringify(config))
		expect(result?.pathTemplate).toBe('~/wt/{{ REPOBASENAME }}/{{ TASKSLUG }}')
		expect(result?.disabled).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// computeEffectiveConfig — basic defaults
// ---------------------------------------------------------------------------

describe('computeEffectiveConfig — defaults', () => {
	test('returns defaults when both files are absent', () => {
		const effective = computeEffectiveConfig(null, null)
		expect(effective.disabled).toBe(false)
		expect(effective.setupBlocksFirstSession).toBe(false)
		expect(effective.disabledSource).toBe('default')
		expect(effective.pathTemplate).toBe(WORKSPACE_CONFIG_DEFAULTS.pathTemplate)
		expect(effective.branchTemplate).toBe(WORKSPACE_CONFIG_DEFAULTS.branchTemplate)
		expect(effective.sourceRef).toBe(WORKSPACE_CONFIG_DEFAULTS.sourceRef)
		expect(effective.sourceRef).toBe('origin/main')
		expect(effective.setupCommand).toBe(WORKSPACE_CONFIG_DEFAULTS.setupCommand)
		expect(effective.copyGlobs).toEqual([...WORKSPACE_CONFIG_DEFAULTS.copyGlobs])
		expect(effective.copyGlobs).not.toContain('packages/db/.env')
		expect(effective.copyGlobs).toContain('.humanlayer/workspace.json')
		expect(effective.copyGlobs).toContain('.humanlayer/workspace.local.json')
		expect(effective.isMissingConfig).toBe(true)
	})

	test('parses and resolves setupBlocksFirstSession', () => {
		const effective = computeEffectiveConfig(JSON.stringify({ setupBlocksFirstSession: true }), null)
		expect(effective.setupBlocksFirstSession).toBe(true)
	})

	test('allows local setupBlocksFirstSession override', () => {
		const effective = computeEffectiveConfig(
			JSON.stringify({ setupBlocksFirstSession: true }),
			JSON.stringify({ setupBlocksFirstSession: false }),
		)
		expect(effective.setupBlocksFirstSession).toBe(false)
	})

	test('isMissingConfig is false when workspace.json is present', () => {
		const effective = computeEffectiveConfig('{}', null)
		expect(effective.isMissingConfig).toBe(false)
	})

	test('isMissingConfig is false when workspace.local.json is present', () => {
		const effective = computeEffectiveConfig(null, '{}')
		expect(effective.isMissingConfig).toBe(false)
	})

	test('default repos include single "." entry', () => {
		const effective = computeEffectiveConfig(null, null)
		expect(effective.repos).toHaveLength(1)
		expect(effective.repos[0].localPath).toBe('.')
	})

	test('default single repo entry resolves to primary: true', () => {
		const effective = computeEffectiveConfig(null, null)
		expect(effective.repos[0].primary).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// computeEffectiveConfig — root field precedence
// ---------------------------------------------------------------------------

describe('computeEffectiveConfig — root field precedence', () => {
	test('workspace.json overrides defaults', () => {
		const repoConfig = JSON.stringify({
			pathTemplate: '~/custom/{{ TASKSLUG }}/{{ REPOBASENAME }}',
			sourceRef: 'origin/main',
		})
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.pathTemplate).toBe('~/custom/{{ TASKSLUG }}/{{ REPOBASENAME }}')
		expect(effective.sourceRef).toBe('origin/main')
	})

	test('workspace.local.json overrides workspace.json', () => {
		const repoConfig = JSON.stringify({ pathTemplate: '~/shared/{{ TASKSLUG }}/{{ REPOBASENAME }}' })
		const localConfig = JSON.stringify({ pathTemplate: '~/local/{{ REPOBASENAME }}/{{ TASKSLUG }}' })
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.pathTemplate).toBe('~/local/{{ REPOBASENAME }}/{{ TASKSLUG }}')
	})

	test('copyGlobs uses additive merge semantics: local adds to repo', () => {
		const repoConfig = JSON.stringify({ copyGlobs: ['.env', '.env.local'] })
		const localConfig = JSON.stringify({ copyGlobs: ['CLAUDE.local.md'] })
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.copyGlobs).toEqual([...WORKSPACE_CONFIG_DEFAULTS.copyGlobs, 'CLAUDE.local.md'])
	})

	test('copyGlobs from repo config adds to defaults', () => {
		const repoConfig = JSON.stringify({ copyGlobs: ['CLAUDE.local.md'] })
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.copyGlobs).toEqual([...WORKSPACE_CONFIG_DEFAULTS.copyGlobs, 'CLAUDE.local.md'])
	})
})

// ---------------------------------------------------------------------------
// computeEffectiveConfig — disabled precedence with source attribution
// ---------------------------------------------------------------------------

describe('computeEffectiveConfig — disabled', () => {
	test('disabled defaults to false with source "default"', () => {
		const effective = computeEffectiveConfig(null, null)
		expect(effective.disabled).toBe(false)
		expect(effective.disabledSource).toBe('default')
	})

	test('workspace.json can set disabled=true', () => {
		const effective = computeEffectiveConfig(JSON.stringify({ disabled: true }), null)
		expect(effective.disabled).toBe(true)
		expect(effective.disabledSource).toBe('workspace.json')
	})

	test('workspace.local.json overrides workspace.json disabled=false', () => {
		const repoConfig = JSON.stringify({ disabled: true })
		const localConfig = JSON.stringify({ disabled: false })
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.disabled).toBe(false)
		expect(effective.disabledSource).toBe('workspace.local.json')
	})

	test('workspace.local.json sets disabled=true overriding repo default', () => {
		const effective = computeEffectiveConfig('{}', JSON.stringify({ disabled: true }))
		expect(effective.disabled).toBe(true)
		expect(effective.disabledSource).toBe('workspace.local.json')
	})
})

// ---------------------------------------------------------------------------
// computeEffectiveConfig — repos[] merge
// ---------------------------------------------------------------------------

describe('computeEffectiveConfig — repos merge', () => {
	test('workspace.json repos appear in effective config', () => {
		const repoConfig = JSON.stringify({
			repos: [
				{ localPath: '.', description: 'Main' },
				{ localPath: '../api', description: 'API' },
			],
		})
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.repos).toHaveLength(2)
		expect(effective.repos[0].localPath).toBe('.')
		expect(effective.repos[1].localPath).toBe('../api')
	})

	test('local $patch: delete removes matching repo', () => {
		const repoConfig = JSON.stringify({
			repos: [{ localPath: '.' }, { localPath: '../legacy' }],
		})
		const localConfig = JSON.stringify({
			repos: [{ localPath: '../legacy', $patch: 'delete' }],
		})
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.repos).toHaveLength(1)
		expect(effective.repos[0].localPath).toBe('.')
	})

	test('local entry with new localPath adds a repo', () => {
		const repoConfig = JSON.stringify({ repos: [{ localPath: '.' }] })
		const localConfig = JSON.stringify({ repos: [{ localPath: '../extra', description: 'Extra' }] })
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.repos).toHaveLength(2)
		expect(effective.repos.some((r) => r.localPath === '../extra')).toBe(true)
	})

	test('local entry with existing localPath merges fields', () => {
		const repoConfig = JSON.stringify({
			repos: [{ localPath: '../api', sourceRef: 'HEAD', setupCommand: 'npm install' }],
		})
		const localConfig = JSON.stringify({
			repos: [{ localPath: '../api', setupCommand: 'bun install' }],
		})
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.repos).toHaveLength(1)
		expect(effective.repos[0].setupCommand).toBe('bun install')
		// sourceRef not overridden in local, so it comes from repo config
		expect(effective.repos[0].sourceRef).toBe('HEAD')
	})

	test('local repo copyGlobs adds to repo copyGlobs for that entry', () => {
		const repoConfig = JSON.stringify({
			repos: [{ localPath: '.', copyGlobs: ['.env', '.env.local'] }],
		})
		const localConfig = JSON.stringify({
			repos: [{ localPath: '.', copyGlobs: ['CLAUDE.local.md'] }],
		})
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.repos[0].copyGlobs).toEqual([...WORKSPACE_CONFIG_DEFAULTS.copyGlobs, 'CLAUDE.local.md'])
	})

	test('repo entry inherits root sourceRef when not overridden', () => {
		const repoConfig = JSON.stringify({ sourceRef: 'origin/main', repos: [{ localPath: '.' }] })
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.repos[0].sourceRef).toBe('origin/main')
	})

	test('repo entry overrides root sourceRef per-entry', () => {
		const repoConfig = JSON.stringify({
			sourceRef: 'HEAD',
			repos: [{ localPath: '.' }, { localPath: '../api', sourceRef: 'origin/stable' }],
		})
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.repos[0].sourceRef).toBe('HEAD')
		expect(effective.repos[1].sourceRef).toBe('origin/stable')
	})
})

// ---------------------------------------------------------------------------
// computeEffectiveConfig — primary repo
// ---------------------------------------------------------------------------

describe('computeEffectiveConfig — primary repo', () => {
	test('explicit primary from workspace.json is carried into effective config', () => {
		const repoConfig = JSON.stringify({
			repos: [{ localPath: '.' }, { localPath: '../api', primary: true }],
		})
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.repos.map((r) => r.primary)).toEqual([false, true])
	})

	test('multi-repo config with no primary resolves all repos to primary: false', () => {
		const repoConfig = JSON.stringify({
			repos: [{ localPath: '.' }, { localPath: '../api' }],
		})
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.repos.every((r) => r.primary === false)).toBe(true)
	})

	test('single-repo config resolves to primary: true even when unset', () => {
		const repoConfig = JSON.stringify({ repos: [{ localPath: '.' }] })
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.repos[0].primary).toBe(true)
	})

	test('single-repo config resolves to primary: true even when explicitly false', () => {
		const repoConfig = JSON.stringify({ repos: [{ localPath: '.', primary: false }] })
		const effective = computeEffectiveConfig(repoConfig, null)
		expect(effective.repos[0].primary).toBe(true)
	})

	test('workspace.local.json primary override wins for a matching repo', () => {
		const repoConfig = JSON.stringify({
			repos: [
				{ localPath: '.', primary: true },
				{ localPath: '../api', description: 'API' },
			],
		})
		const localConfig = JSON.stringify({
			repos: [
				{ localPath: '.', primary: false },
				{ localPath: '../api', primary: true },
			],
		})
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.repos.find((r) => r.localPath === '.')?.primary).toBe(false)
		expect(effective.repos.find((r) => r.localPath === '../api')?.primary).toBe(true)
	})

	test('local entry without primary leaves the workspace.json primary in place', () => {
		const repoConfig = JSON.stringify({
			repos: [{ localPath: '.', primary: true }, { localPath: '../api' }],
		})
		const localConfig = JSON.stringify({
			repos: [{ localPath: '.', setupCommand: 'bun install' }],
		})
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.repos.find((r) => r.localPath === '.')?.primary).toBe(true)
		expect(effective.repos.find((r) => r.localPath === '.')?.setupCommand).toBe('bun install')
	})

	test('deleting all but one repo via $patch resolves the survivor to primary: true', () => {
		const repoConfig = JSON.stringify({
			repos: [{ localPath: '.' }, { localPath: '../legacy', primary: true }],
		})
		const localConfig = JSON.stringify({
			repos: [{ localPath: '../legacy', $patch: 'delete' }],
		})
		const effective = computeEffectiveConfig(repoConfig, localConfig)
		expect(effective.repos).toHaveLength(1)
		expect(effective.repos[0].primary).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// interpolateTemplate
// ---------------------------------------------------------------------------

describe('interpolateTemplate', () => {
	test('replaces TASKSLUG', () => {
		expect(interpolateTemplate('~/.humanlayer/workspaces/{{ TASKSLUG }}/repo', { TASKSLUG: 'eng-123' })).toBe(
			'~/.humanlayer/workspaces/eng-123/repo',
		)
	})

	test('replaces REPOBASENAME', () => {
		expect(interpolateTemplate('/wt/{{ REPOBASENAME }}', { REPOBASENAME: 'syncopate' })).toBe('/wt/syncopate')
	})

	test('replaces both variables', () => {
		expect(
			interpolateTemplate('~/wt/{{ REPOBASENAME }}/{{ TASKSLUG }}', {
				TASKSLUG: 'eng-456',
				REPOBASENAME: 'api',
			}),
		).toBe('~/wt/api/eng-456')
	})

	test('handles variable names with or without surrounding whitespace', () => {
		// Both {{ REPOBASENAME }} (with spaces) and {{REPOBASENAME}} (no spaces) are replaced
		expect(interpolateTemplate('~/{{ TASKSLUG }}/{{REPOBASENAME}}', { TASKSLUG: 'abc', REPOBASENAME: 'xyz' })).toBe(
			'~/abc/xyz',
		)
	})

	test('leaves unknown variables unchanged', () => {
		expect(interpolateTemplate('/wt/{{ UNKNOWN }}', { TASKSLUG: 'abc' })).toBe('/wt/{{ UNKNOWN }}')
	})
})

// ---------------------------------------------------------------------------
// repoBasename
// ---------------------------------------------------------------------------

describe('repoBasename', () => {
	test('"." returns basename of selected directory', () => {
		expect(repoBasename('.', '/Users/dex/repos/syncopate')).toBe('syncopate')
	})

	test('"." with trailing slash in selected directory', () => {
		expect(repoBasename('.', '/Users/dex/repos/syncopate/')).toBe('syncopate')
	})

	test('"." without selectedDirectory returns "repo"', () => {
		expect(repoBasename('.')).toBe('repo')
	})

	test('relative sibling path returns last segment', () => {
		expect(repoBasename('../api')).toBe('api')
	})

	test('nested relative path returns last segment', () => {
		expect(repoBasename('../some/nested/repo')).toBe('repo')
	})
})

// ---------------------------------------------------------------------------
// generateRepoConfigPreview
// ---------------------------------------------------------------------------

describe('generateRepoConfigPreview', () => {
	test('includes default repos when no existing config', () => {
		const preview = generateRepoConfigPreview({}, null)
		const parsed = JSON.parse(preview)
		expect(parsed.sourceRef).toBe('origin/main')
		expect(parsed.repos).toEqual([{ localPath: '.', description: 'Selected repository', primary: true }])
	})

	test('preserves existing repos from existing config', () => {
		const existing = { repos: [{ localPath: '.', description: 'Main' }, { localPath: '../api' }] }
		const preview = generateRepoConfigPreview({}, existing)
		const parsed = JSON.parse(preview)
		expect(parsed.repos).toHaveLength(2)
	})

	test('uses form values for root fields', () => {
		const preview = generateRepoConfigPreview(
			{
				pathTemplate: '~/custom/{{ TASKSLUG }}/{{ REPOBASENAME }}',
				disabled: true,
				copyGlobs: ['.env'],
			},
			null,
		)
		const parsed = JSON.parse(preview)
		expect(parsed.pathTemplate).toBe('~/custom/{{ TASKSLUG }}/{{ REPOBASENAME }}')
		expect(parsed.disabled).toBe(true)
		expect(parsed.copyGlobs).toEqual(['.env'])
	})
})

// ---------------------------------------------------------------------------
// generateLocalConfigPreview
// ---------------------------------------------------------------------------

describe('generateLocalConfigPreview', () => {
	test('returns empty object when no non-empty form values', () => {
		const preview = generateLocalConfigPreview({})
		const parsed = JSON.parse(preview)
		expect(Object.keys(parsed)).toHaveLength(0)
	})

	test('includes only non-empty fields', () => {
		const preview = generateLocalConfigPreview({
			pathTemplate: '~/wt/{{ REPOBASENAME }}/{{ TASKSLUG }}',
			setupCommand: '',
		})
		const parsed = JSON.parse(preview)
		expect(parsed.pathTemplate).toBe('~/wt/{{ REPOBASENAME }}/{{ TASKSLUG }}')
		expect(parsed.setupCommand).toBeUndefined()
	})

	test('includes disabled even when false', () => {
		const preview = generateLocalConfigPreview({ disabled: false })
		const parsed = JSON.parse(preview)
		expect(parsed.disabled).toBe(false)
	})

	test('includes copyGlobs when provided', () => {
		const preview = generateLocalConfigPreview({ copyGlobs: ['.env'] })
		const parsed = JSON.parse(preview)
		expect(parsed.copyGlobs).toEqual(['.env'])
	})

	test('omits copyGlobs when provided as an empty array', () => {
		const preview = generateLocalConfigPreview({ copyGlobs: [] })
		const parsed = JSON.parse(preview)
		expect(parsed.copyGlobs).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// checkWorkspaceNowEligibility
// ---------------------------------------------------------------------------

const defaultEffectiveConfig: EffectiveWorkspaceConfig = {
	disabled: false,
	setupBlocksFirstSession: false,
	disabledSource: 'default',
	pathTemplate: WORKSPACE_CONFIG_DEFAULTS.pathTemplate,
	branchTemplate: WORKSPACE_CONFIG_DEFAULTS.branchTemplate,
	sourceRef: WORKSPACE_CONFIG_DEFAULTS.sourceRef,
	setupCommand: WORKSPACE_CONFIG_DEFAULTS.setupCommand,
	copyGlobs: [...WORKSPACE_CONFIG_DEFAULTS.copyGlobs],
	repos: [{ localPath: '.', sourceRef: 'HEAD', setupCommand: '', copyGlobs: [], primary: true }],
	isMissingConfig: false,
}

describe('checkWorkspaceNowEligibility', () => {
	test('eligible for a remote host in native daemon mode', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: true,
			isTauri: true,
			config: defaultEffectiveConfig,
			executionMode: 'daemon',
		})
		expect(result.eligible).toBe(true)
		expect(result.reason).toBeUndefined()
	})

	test('not eligible for a remote host in form mode', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: true,
			isTauri: true,
			config: defaultEffectiveConfig,
			executionMode: 'form',
		})
		expect(result.eligible).toBe(false)
		expect(result.reason).toMatch(/daemon-driven setup/)
	})

	test('not eligible in web (non-Tauri) mode', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: false,
			isTauri: false,
			config: defaultEffectiveConfig,
			executionMode: 'form',
		})
		expect(result.eligible).toBe(false)
		expect(result.reason).toMatch(/desktop app/)
	})

	test('not eligible when config is null (still loading)', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: false,
			isTauri: true,
			config: null,
			executionMode: 'form',
		})
		expect(result.eligible).toBe(false)
	})

	test('not eligible when config is missing (no files found)', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: false,
			isTauri: true,
			config: { ...defaultEffectiveConfig, isMissingConfig: true },
			executionMode: 'form',
		})
		expect(result.eligible).toBe(false)
		expect(result.reason).toMatch(/config is required/)
	})

	test('not eligible when disabled=true', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: false,
			isTauri: true,
			config: {
				...defaultEffectiveConfig,
				disabled: true,
				disabledSource: 'workspace.json',
			},
			executionMode: 'form',
		})
		expect(result.eligible).toBe(false)
		expect(result.reason).toMatch(/disabled/)
	})

	test('eligible with local host, tauri, and valid config', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: false,
			isTauri: true,
			config: defaultEffectiveConfig,
			executionMode: 'form',
		})
		expect(result.eligible).toBe(true)
		expect(result.reason).toBeUndefined()
	})

	test('not eligible for a remote daemon target in web mode', () => {
		const result = checkWorkspaceNowEligibility({
			isRemoteHost: true,
			isTauri: false,
			config: defaultEffectiveConfig,
			executionMode: 'daemon',
		})
		expect(result.eligible).toBe(false)
		expect(result.reason).toMatch(/desktop app/)
	})
})

// ---------------------------------------------------------------------------
// isLargeWorkspace
// ---------------------------------------------------------------------------

describe('isLargeWorkspace', () => {
	test('not large when repos.length <= threshold', () => {
		const config: EffectiveWorkspaceConfig = {
			...defaultEffectiveConfig,
			repos: Array.from({ length: LARGE_WORKSPACE_REPO_THRESHOLD }, (_, i) => ({
				localPath: `../repo-${i}`,
				sourceRef: 'HEAD',
				setupCommand: '',
				copyGlobs: [],
				primary: i === 0,
			})),
		}
		expect(isLargeWorkspace(config)).toBe(false)
	})

	test('large when repos.length > threshold', () => {
		const config: EffectiveWorkspaceConfig = {
			...defaultEffectiveConfig,
			repos: Array.from({ length: LARGE_WORKSPACE_REPO_THRESHOLD + 1 }, (_, i) => ({
				localPath: `../repo-${i}`,
				sourceRef: 'HEAD',
				setupCommand: '',
				copyGlobs: [],
				primary: i === 0,
			})),
		}
		expect(isLargeWorkspace(config)).toBe(true)
	})
})
