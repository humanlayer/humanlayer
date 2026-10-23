import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'

import { prepareWorkspaceNowTaskCreation } from '@/lib/new-task-form-helpers'
import {
	computeEffectiveConfigFromParsed,
	parseWorkspaceConfigResult,
	parseWorkspaceLocalConfigResult,
} from '@/lib/workspace-config'
import type { EffectiveWorkspaceConfig } from '@/lib/workspace-config-schema'

export type LauncherWorkspaceReadState =
	| { status: 'loading' }
	| { status: 'error'; file: 'workspace.json' | 'workspace.local.json'; message: string }
	| { status: 'ready'; snapshot: LauncherWorkspaceSnapshot }

export type LauncherWorkspaceSnapshot = {
	source: 'configured' | 'implicit-repository' | 'implicit-default'
	directory: string
	config: EffectiveWorkspaceConfig
	repositoryLocalPaths: readonly string[]
}

export type LauncherRepositorySelection = {
	excludedLocalPaths: ReadonlySet<string>
	defaultLaunchRepositoryLocalPath: string | null
}

export type LauncherRepositorySelectionPreference = {
	repositoryLocalPaths: readonly string[]
	excludedLocalPaths: readonly string[]
	defaultLaunchRepositoryLocalPath: string | null
}

export type WorkspaceLaunchBlocker =
	| { code: 'desktop-unavailable'; message: string }
	| { code: 'loading'; message: string }
	| { code: 'config-error'; message: string }
	| { code: 'disabled'; message: string }
	| { code: 'no-repositories'; message: string }
	| { code: 'no-default-repository'; message: string }
	| { code: 'invalid-default-repository'; message: string }
	| { code: 'invalid-spec'; message: string }

export type LauncherWorkspaceLaunchProjection =
	| { kind: 'not-now' }
	| { kind: 'in-place'; directory: string }
	| { kind: 'blocked'; reason: WorkspaceLaunchBlocker }
	| { kind: 'ready'; workspaceSpec: WorkspaceSpec; defaultWorkingDirectory: string }

export type LauncherV3WorkspaceLaunchTarget =
	| { kind: 'workspace'; workspaceSpec: WorkspaceSpec; defaultWorkingDirectory: string }
	| { kind: 'in-place'; defaultWorkingDirectory: string }

export function workspaceForLaunch(projection: LauncherWorkspaceLaunchProjection) {
	if (projection.kind === 'ready') {
		return {
			kind: 'workspace' as const,
			workspaceSpec: projection.workspaceSpec,
			defaultWorkingDirectory: projection.defaultWorkingDirectory,
		}
	}
	if (projection.kind === 'in-place') {
		return { kind: 'in-place' as const, defaultWorkingDirectory: projection.directory }
	}
	return undefined
}

export function resolveWorkspaceReadState({
	directory,
	repoContent,
	localContent,
	selectedRepository,
}: {
	directory: string
	repoContent: string | null
	localContent: string | null
	selectedRepository?: DiscoveredGitRepository
}): LauncherWorkspaceReadState {
	const repo = parseWorkspaceConfigResult(repoContent)
	const local = parseWorkspaceLocalConfigResult(localContent)
	if (!repo.ok && repo.error.type !== 'missing') {
		return { status: 'error', file: 'workspace.json', message: repo.error.message }
	}
	if (!local.ok && local.error.type !== 'missing') {
		return { status: 'error', file: 'workspace.local.json', message: local.error.message }
	}
	const selectedRemote = selectedRepository
		? (selectedRepository.remotes.find((remote) => remote.name === selectedRepository.defaultRemote) ??
			selectedRepository.remotes.find((remote) => remote.name === 'origin') ??
			selectedRepository.remotes[0])
		: undefined
	const discoveredSourceRef = selectedRepository
		? (selectedRepository.sourceRef ??
			(selectedRemote
				? `${selectedRemote.name}/${selectedRepository.defaultBranch}`
				: selectedRepository.defaultBranch))
		: undefined
	const discoveredConfig =
		selectedRepository && discoveredSourceRef
			? {
					sourceRef: discoveredSourceRef,
					branchRemote: selectedRemote?.name,
					repos: [
						{
							localPath: '.',
							primary: true,
							sourceRef: discoveredSourceRef,
							branchRemote: selectedRemote?.name,
						},
					],
				}
			: null
	const config = computeEffectiveConfigFromParsed(
		repo.ok ? repo.data : discoveredConfig,
		local.ok ? local.data : null,
	)
	return {
		status: 'ready',
		snapshot: {
			source: repo.ok ? 'configured' : selectedRepository ? 'implicit-repository' : 'implicit-default',
			directory,
			config,
			repositoryLocalPaths: config.repos.map(({ localPath }) => localPath),
		},
	}
}

function resolveDefaultLaunchRepository(
	included: readonly string[],
	savedDefault: string | null,
	configuredDefault: string | null,
): string | null {
	if (savedDefault && included.includes(savedDefault)) return savedDefault
	if (configuredDefault && included.includes(configuredDefault)) return configuredDefault
	if (included.length === 1) return included[0] ?? null
	return null
}

export function reconcileRepositorySelection(
	snapshot: LauncherWorkspaceSnapshot,
	selection: LauncherRepositorySelection,
): LauncherRepositorySelection {
	const paths = new Set(snapshot.repositoryLocalPaths)
	const excludedLocalPaths = new Set([...selection.excludedLocalPaths].filter((path) => paths.has(path)))
	const included = snapshot.repositoryLocalPaths.filter((path) => !excludedLocalPaths.has(path))
	const savedDefault = selection.defaultLaunchRepositoryLocalPath
	const configuredDefault = snapshot.config.repos.find((repo) => repo.primary)?.localPath ?? null
	const defaultLaunchRepositoryLocalPath = resolveDefaultLaunchRepository(included, savedDefault, configuredDefault)
	return { excludedLocalPaths, defaultLaunchRepositoryLocalPath }
}

export function resolveRememberedRepositorySelection(
	snapshot: LauncherWorkspaceSnapshot,
	selection: LauncherRepositorySelection,
	remembered: LauncherRepositorySelectionPreference | null,
): LauncherRepositorySelection {
	const hasFormSelection =
		selection.excludedLocalPaths.size > 0 || selection.defaultLaunchRepositoryLocalPath !== null
	const snapshotPaths = new Set(snapshot.repositoryLocalPaths)
	const sameRepositories =
		remembered !== null &&
		remembered.repositoryLocalPaths.length === snapshot.repositoryLocalPaths.length &&
		remembered.repositoryLocalPaths.every((path) => snapshotPaths.has(path))
	const candidate =
		!hasFormSelection && sameRepositories
			? {
					excludedLocalPaths: new Set(remembered.excludedLocalPaths),
					defaultLaunchRepositoryLocalPath: remembered.defaultLaunchRepositoryLocalPath,
				}
			: selection
	return reconcileRepositorySelection(snapshot, candidate)
}

export function projectWorkspaceLaunch({
	timing,
	readState,
	selection,
	desktopAvailable,
	isInsideGitRepository = true,
	directory = '',
	taskSlug,
}: {
	timing: 'now' | 'later' | 'never'
	readState: LauncherWorkspaceReadState
	selection: LauncherRepositorySelection
	desktopAvailable: boolean
	isInsideGitRepository?: boolean | null
	directory?: string
	taskSlug: string
}): LauncherWorkspaceLaunchProjection {
	if (timing === 'never') return { kind: 'not-now' }
	if (timing === 'later' && !desktopAvailable) return { kind: 'not-now' }
	if (!desktopAvailable) {
		return {
			kind: 'blocked',
			reason: { code: 'desktop-unavailable', message: 'Worktree now requires the desktop app.' },
		}
	}
	if (isInsideGitRepository === null) {
		return { kind: 'blocked', reason: { code: 'loading', message: 'Checking selected directory...' } }
	}
	if (timing === 'later' && isInsideGitRepository) return { kind: 'not-now' }
	if (readState.status === 'loading') {
		return { kind: 'blocked', reason: { code: 'loading', message: 'Reading workspace configuration...' } }
	}
	if (readState.status === 'error') {
		return {
			kind: 'blocked',
			reason: { code: 'config-error', message: `${readState.file} could not be read: ${readState.message}` },
		}
	}
	const { snapshot } = readState
	if (snapshot.source === 'implicit-default' && !isInsideGitRepository) {
		return { kind: 'in-place', directory }
	}
	if (timing === 'later') return { kind: 'not-now' }
	if (snapshot.config.disabled) {
		return {
			kind: 'blocked',
			reason: {
				code: 'disabled',
				message: `Workspace setup is disabled in ${snapshot.config.disabledSource}.`,
			},
		}
	}
	const reconciled = reconcileRepositorySelection(snapshot, selection)
	const repos = snapshot.config.repos.filter((repo) => !reconciled.excludedLocalPaths.has(repo.localPath))
	if (repos.length === 0) {
		return { kind: 'blocked', reason: { code: 'no-repositories', message: 'Include at least one repository.' } }
	}
	if (!reconciled.defaultLaunchRepositoryLocalPath) {
		return {
			kind: 'blocked',
			reason: { code: 'no-default-repository', message: 'Choose where sessions launch by default.' },
		}
	}
	if (!repos.some((repo) => repo.localPath === reconciled.defaultLaunchRepositoryLocalPath)) {
		return {
			kind: 'blocked',
			reason: { code: 'invalid-default-repository', message: 'The default session repository must be included.' },
		}
	}
	const selectedConfig = {
		...snapshot.config,
		repos: repos.map((repo) => ({
			...repo,
			primary: repo.localPath === reconciled.defaultLaunchRepositoryLocalPath,
		})),
	}
	try {
		const prepared = prepareWorkspaceNowTaskCreation({
			config: selectedConfig,
			selectedDirectory: snapshot.directory,
			taskSlug,
		})
		return {
			kind: 'ready',
			workspaceSpec: prepared.workspaceSpec,
			defaultWorkingDirectory: prepared.primaryWorkingDirectory,
		}
	} catch (error) {
		return {
			kind: 'blocked',
			reason: { code: 'invalid-spec', message: error instanceof Error ? error.message : String(error) },
		}
	}
}
