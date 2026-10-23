import { describe, expect, it } from 'vitest'

import {
	projectWorkspaceLaunch,
	reconcileRepositorySelection,
	resolveRememberedRepositorySelection,
	resolveWorkspaceReadState,
	type LauncherWorkspaceSnapshot,
} from './launcher-v3-workspace'

describe('resolveWorkspaceReadState', () => {
	it('synthesizes an in-memory single repository when both files are missing', () => {
		const state = resolveWorkspaceReadState({ directory: '/repo', repoContent: null, localContent: null })
		expect(state).toMatchObject({
			status: 'ready',
			snapshot: { source: 'implicit-default', directory: '/repo', repositoryLocalPaths: ['.'] },
		})
	})

	it('uses discovered repository metadata for an in-memory single repository', () => {
		const state = resolveWorkspaceReadState({
			directory: '/repo',
			repoContent: null,
			localContent: null,
			selectedRepository: {
				path: '/repo',
				name: 'repo',
				remotes: [
					{ name: 'upstream', url: 'git@example.com:acme/upstream.git' },
					{ name: 'origin', url: 'git@example.com:acme/repo.git' },
				],
				defaultRemote: 'upstream',
				defaultBranch: 'trunk',
				sourceRef: 'upstream/trunk',
			},
		})

		expect(state).toMatchObject({
			status: 'ready',
			snapshot: {
				source: 'implicit-repository',
				config: {
					sourceRef: 'upstream/trunk',
					branchRemote: 'upstream',
					repos: [{ localPath: '.', sourceRef: 'upstream/trunk', branchRemote: 'upstream' }],
				},
			},
		})
	})

	it('uses the local default branch when the discovered repository has no remote', () => {
		const state = resolveWorkspaceReadState({
			directory: '/repo',
			repoContent: null,
			localContent: null,
			selectedRepository: {
				path: '/repo',
				name: 'repo',
				remotes: [],
				defaultBranch: 'develop',
				sourceRef: 'develop',
			},
		})

		expect(state).toMatchObject({
			status: 'ready',
			snapshot: {
				config: { sourceRef: 'develop', repos: [{ localPath: '.', sourceRef: 'develop' }] },
			},
		})
	})

	it('does not treat a local override alone as a configured parent workspace', () => {
		const state = resolveWorkspaceReadState({
			directory: '/plain-directory',
			repoContent: null,
			localContent: '{}',
		})

		expect(state).toMatchObject({ status: 'ready', snapshot: { source: 'implicit-default' } })
	})

	it('merges defaults, shared configuration, and additive local overrides', () => {
		const state = resolveWorkspaceReadState({
			directory: '/repo',
			repoContent: JSON.stringify({
				pathTemplate: '~/shared/{{ TASKSLUG }}/{{ REPOBASENAME }}',
				copyGlobs: ['shared.txt'],
				repos: [{ localPath: '.', primary: true }, { localPath: 'api' }],
			}),
			localContent: JSON.stringify({
				pathTemplate: '~/local/{{ TASKSLUG }}/{{ REPOBASENAME }}',
				copyGlobs: ['local.txt'],
				repos: [{ localPath: 'api', setupCommand: 'bun install' }, { localPath: 'docs' }],
			}),
		})
		expect(state.status).toBe('ready')
		if (state.status !== 'ready') return
		expect(state.snapshot.config.pathTemplate).toBe('~/local/{{ TASKSLUG }}/{{ REPOBASENAME }}')
		expect(state.snapshot.config.copyGlobs).toEqual(expect.arrayContaining(['.env', 'shared.txt', 'local.txt']))
		expect(state.snapshot.repositoryLocalPaths).toEqual(['.', 'api', 'docs'])
		expect(state.snapshot.config.repos.find(({ localPath }) => localPath === 'api')?.setupCommand).toBe(
			'bun install',
		)
	})

	it.each([
		['workspace.json', '{'],
		['workspace.local.json', '{'],
	] as const)('reports parse failures for %s', (file, malformed) => {
		const state = resolveWorkspaceReadState({
			directory: '/repo',
			repoContent: file === 'workspace.json' ? malformed : null,
			localContent: file === 'workspace.local.json' ? malformed : null,
		})
		expect(state).toMatchObject({ status: 'error', file })
	})
})

function configuredSnapshot(): LauncherWorkspaceSnapshot {
	const state = resolveWorkspaceReadState({
		directory: '/repo',
		repoContent: JSON.stringify({
			repos: [{ localPath: 'web', primary: true }, { localPath: 'api' }],
		}),
		localContent: null,
	})
	if (state.status !== 'ready') throw new Error('fixture failed')
	return state.snapshot
}

describe('workspace selection and launch projection', () => {
	it('drops stale exclusions and defaults when snapshot paths change', () => {
		expect(
			reconcileRepositorySelection(configuredSnapshot(), {
				excludedLocalPaths: new Set(['removed']),
				defaultLaunchRepositoryLocalPath: 'removed',
			}),
		).toEqual({ excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: 'web' })
	})

	it('restores remembered choices only when the workspace repositories still match', () => {
		const snapshot = configuredSnapshot()
		const emptySelection = { excludedLocalPaths: new Set<string>(), defaultLaunchRepositoryLocalPath: null }
		const remembered = {
			repositoryLocalPaths: ['web', 'api'],
			excludedLocalPaths: ['api'],
			defaultLaunchRepositoryLocalPath: 'web',
		}

		expect(resolveRememberedRepositorySelection(snapshot, emptySelection, remembered)).toEqual({
			excludedLocalPaths: new Set(['api']),
			defaultLaunchRepositoryLocalPath: 'web',
		})
		expect(
			resolveRememberedRepositorySelection(snapshot, emptySelection, {
				...remembered,
				repositoryLocalPaths: ['web', 'docs'],
			}),
		).toEqual({ excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: 'web' })
	})

	it('keeps explicit form choices ahead of remembered repository choices', () => {
		expect(
			resolveRememberedRepositorySelection(
				configuredSnapshot(),
				{ excludedLocalPaths: new Set(['web']), defaultLaunchRepositoryLocalPath: 'api' },
				{
					repositoryLocalPaths: ['web', 'api'],
					excludedLocalPaths: ['api'],
					defaultLaunchRepositoryLocalPath: 'web',
				},
			),
		).toEqual({ excludedLocalPaths: new Set(['web']), defaultLaunchRepositoryLocalPath: 'api' })
	})

	it('requires exactly one included default and renders it as the transport primary', () => {
		const snapshot = configuredSnapshot()
		const blocked = projectWorkspaceLaunch({
			timing: 'now',
			readState: {
				status: 'ready',
				snapshot: {
					...snapshot,
					config: {
						...snapshot.config,
						repos: snapshot.config.repos.map((repo) => ({ ...repo, primary: false })),
					},
				},
			},
			selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: null },
			desktopAvailable: true,
			taskSlug: 'task',
		})
		expect(blocked).toMatchObject({ kind: 'blocked', reason: { code: 'no-default-repository' } })

		const ready = projectWorkspaceLaunch({
			timing: 'now',
			readState: { status: 'ready', snapshot },
			selection: { excludedLocalPaths: new Set(['web']), defaultLaunchRepositoryLocalPath: 'api' },
			desktopAvailable: true,
			taskSlug: 'task',
		})
		expect(ready.kind).toBe('ready')
		if (ready.kind !== 'ready') return
		expect(ready.workspaceSpec.repos).toHaveLength(1)
		expect(ready.workspaceSpec.repos[0]).toMatchObject({ localPath: 'api', primary: true })
	})

	it('renders every repository branch from the submit-time task slug', () => {
		const snapshot = configuredSnapshot()
		const ready = projectWorkspaceLaunch({
			timing: 'now',
			readState: { status: 'ready', snapshot },
			selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: 'web' },
			desktopAvailable: true,
			taskSlug: 'simple-greeting-application',
		})

		expect(ready.kind).toBe('ready')
		if (ready.kind !== 'ready') return
		expect(ready.workspaceSpec.repos.map((repo) => repo.branch)).toEqual([
			'simple-greeting-application',
			'simple-greeting-application',
		])
	})

	it('ignores immediate setup blockers for later and never', () => {
		for (const timing of ['later', 'never'] as const) {
			expect(
				projectWorkspaceLaunch({
					timing,
					readState: { status: 'error', file: 'workspace.json', message: 'bad json' },
					selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: null },
					desktopAvailable: false,
					taskSlug: 'task',
				}),
			).toEqual({ kind: 'not-now' })
		}
	})

	it('does not wait for local workspace configuration when remote worktrees are deferred', () => {
		expect(
			projectWorkspaceLaunch({
				timing: 'later',
				readState: { status: 'loading' },
				selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: null },
				desktopAvailable: true,
				isInsideGitRepository: true,
				taskSlug: 'task',
			}),
		).toEqual({ kind: 'not-now' })
	})

	it.each(['now', 'later'] as const)('runs directly for %s in a selected directory outside Git', (timing) => {
		const readState = resolveWorkspaceReadState({
			directory: '/plain-directory',
			repoContent: null,
			localContent: null,
		})
		expect(
			projectWorkspaceLaunch({
				timing,
				readState,
				selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: null },
				desktopAvailable: true,
				isInsideGitRepository: false,
				directory: '/plain-directory',
				taskSlug: 'task',
			}),
		).toEqual({ kind: 'in-place', directory: '/plain-directory' })
	})

	it('uses a configured workspace when its parent directory is outside Git', () => {
		const snapshot = configuredSnapshot()
		const projection = projectWorkspaceLaunch({
			timing: 'now',
			readState: { status: 'ready', snapshot },
			selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: 'web' },
			desktopAvailable: true,
			isInsideGitRepository: false,
			directory: '/repo',
			taskSlug: 'task',
		})

		expect(projection.kind).toBe('ready')
		if (projection.kind !== 'ready') return
		expect(projection.workspaceSpec.repos.map((repo) => repo.localPath)).toEqual(['web', 'api'])
	})

	it('reports an invalid workspace config before falling back to an in-place launch', () => {
		expect(
			projectWorkspaceLaunch({
				timing: 'now',
				readState: { status: 'error', file: 'workspace.json', message: 'bad json' },
				selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: null },
				desktopAvailable: true,
				isInsideGitRepository: false,
				directory: '/repo',
				taskSlug: 'task',
			}),
		).toMatchObject({ kind: 'blocked', reason: { code: 'config-error' } })
	})

	it('blocks disabled configuration and unavailable desktop capture', () => {
		const snapshot = configuredSnapshot()
		expect(
			projectWorkspaceLaunch({
				timing: 'now',
				readState: {
					status: 'ready',
					snapshot: {
						...snapshot,
						config: { ...snapshot.config, disabled: true, disabledSource: 'workspace.json' },
					},
				},
				selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: 'web' },
				desktopAvailable: true,
				taskSlug: 'task',
			}),
		).toMatchObject({ kind: 'blocked', reason: { code: 'disabled' } })
		expect(
			projectWorkspaceLaunch({
				timing: 'now',
				readState: { status: 'ready', snapshot },
				selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: 'web' },
				desktopAvailable: false,
				taskSlug: 'task',
			}),
		).toMatchObject({ kind: 'blocked', reason: { code: 'desktop-unavailable' } })
	})
})
