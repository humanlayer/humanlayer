import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { useIsColocated } from '@/hooks/use-colocated'
import { readWorkspaceConfig } from '@/integrations/desktop/workspace-config'
import { isDesktop } from '@/lib/utils'
import { WORKSPACE_CONFIG_DEFAULTS } from '@/lib/workspace-config'
import { branchName, useGitPrefs } from '@/minimalist/lib/git-prefs'
import {
	type LauncherWorkspaceReadState,
	projectWorkspaceLaunch,
	resolveWorkspaceReadState,
} from '@/modules/launcher-v3/launcher-v3-workspace'

/** The worktrees a directory task starts in, and the directory its first session opens. */
export type DirectoryWorkspace = { workspaceSpec: WorkspaceSpec; defaultWorkingDirectory: string }

/**
 * Whether a directory task can start in fresh worktrees: `plan` builds them for a task slug from
 * the directory's workspace.json, or from an implied single-repository one when there is none.
 * `reason` says why not, when the configuration is there but can't be used.
 */
export type DirectoryWorktree =
	| {
			kind: 'available'
			configured: boolean
			repositories: number
			plan: (slug: string) => DirectoryWorkspace
	  }
	| { kind: 'unavailable'; reason: string | null }

type Snapshot = { readState: LauncherWorkspaceReadState; isInsideGitRepository: boolean | undefined }

/**
 * Reads the directory's workspace configuration from the desktop app. Only a colocated host
 * shares this machine's filesystem, so any other host edits the directory in place. Null while
 * the configuration loads.
 */
export function useDirectoryWorktree(directory: string | null, hostId: string | null): DirectoryWorktree | null {
	const { isColocated } = useIsColocated(hostId ?? undefined)
	const { branchPrefix } = useGitPrefs()
	const enabled = Boolean(directory) && isColocated && isDesktop()
	const query = useQuery({
		queryKey: ['minimalist-directory-worktree', directory],
		queryFn: async (): Promise<Snapshot> => {
			const path = directory ?? ''
			const [repo, local] = await Promise.all([
				readWorkspaceConfig(path, 'repo'),
				readWorkspaceConfig(path, 'local'),
			])
			return {
				readState: resolveWorkspaceReadState({
					directory: path,
					repoContent: repo.content,
					localContent: local.content,
					selectedRepository: repo.selectedRepository,
				}),
				isInsideGitRepository: repo.isInsideGitRepository,
			}
		},
		enabled,
	})
	if (!enabled || !directory) return { kind: 'unavailable', reason: null }
	if (!query.data) return query.isError ? { kind: 'unavailable', reason: null } : null
	return directoryWorktree(directory, query.data, branchPrefix)
}

/**
 * What a directory offers once its configuration is read. Branches follow workspace.json's
 * branchTemplate; without one they get the Settings → Git prefix, as project branches do.
 * Exported for tests.
 */
export function directoryWorktree(directory: string, snapshot: Snapshot, branchPrefix = ''): DirectoryWorktree {
	const readState = withBranchPrefix(snapshot.readState, branchPrefix)
	const project = (slug: string) =>
		projectWorkspaceLaunch({
			timing: 'now',
			readState,
			selection: { excludedLocalPaths: new Set(), defaultLaunchRepositoryLocalPath: null },
			desktopAvailable: true,
			isInsideGitRepository: snapshot.isInsideGitRepository ?? false,
			directory,
			taskSlug: slug,
		})
	const probe = project('task')
	if (probe.kind === 'blocked') return { kind: 'unavailable', reason: sentence(probe.reason.message) }
	if (probe.kind !== 'ready') return { kind: 'unavailable', reason: null }
	return {
		kind: 'available',
		configured: readState.status === 'ready' && readState.snapshot.source === 'configured',
		repositories: probe.workspaceSpec.repos.length,
		plan: (slug) => {
			const projection = project(slug)
			if (projection.kind === 'ready')
				return {
					workspaceSpec: projection.workspaceSpec,
					defaultWorkingDirectory: projection.defaultWorkingDirectory,
				}
			throw new Error(projection.kind === 'blocked' ? projection.reason.message : 'No worktree to set up')
		},
	}
}

function withBranchPrefix(readState: LauncherWorkspaceReadState, prefix: string): LauncherWorkspaceReadState {
	if (
		readState.status !== 'ready' ||
		readState.snapshot.config.branchTemplate !== WORKSPACE_CONFIG_DEFAULTS.branchTemplate
	)
		return readState
	const branchTemplate = branchName(prefix, WORKSPACE_CONFIG_DEFAULTS.branchTemplate)
	return {
		...readState,
		snapshot: { ...readState.snapshot, config: { ...readState.snapshot.config, branchTemplate } },
	}
}

const IN_PLACE_KEY = 'hl-min-in-place-directories'
const inPlaceListeners = new Set<() => void>()
let inPlaceCache: { raw: string | null; directories: readonly string[] } = { raw: null, directories: [] }

function readInPlaceDirectories(): readonly string[] {
	let raw: string | null = null
	try {
		raw = localStorage.getItem(IN_PLACE_KEY)
	} catch {
		return inPlaceCache.directories
	}
	if (raw === inPlaceCache.raw) return inPlaceCache.directories
	let directories: readonly string[] = []
	try {
		const parsed: unknown = raw ? JSON.parse(raw) : []
		if (Array.isArray(parsed)) directories = parsed.filter((entry): entry is string => typeof entry === 'string')
	} catch {
		// A damaged value means every directory gets worktrees again.
	}
	inPlaceCache = { raw, directories }
	return directories
}

function subscribeInPlace(listener: () => void) {
	inPlaceListeners.add(listener)
	const onStorage = (event: StorageEvent) => {
		if (event.key === IN_PLACE_KEY) listener()
	}
	window.addEventListener('storage', onStorage)
	return () => {
		inPlaceListeners.delete(listener)
		window.removeEventListener('storage', onStorage)
	}
}

/**
 * Whether you chose to edit this directory in place rather than in worktrees. The choice is kept
 * per directory on this device, so a checkout you always edit directly stays that way.
 */
export function useEditInPlace(directory: string | null): [boolean, (inPlace: boolean) => void] {
	const directories = useSyncExternalStore(subscribeInPlace, readInPlaceDirectories, () => [])
	const inPlace = directory !== null && directories.includes(directory)
	const setInPlace = (next: boolean) => {
		if (directory === null) return
		const rest = readInPlaceDirectories().filter((entry) => entry !== directory)
		const updated = next ? [directory, ...rest].slice(0, 100) : rest
		const raw = JSON.stringify(updated)
		inPlaceCache = { raw, directories: updated }
		try {
			localStorage.setItem(IN_PLACE_KEY, raw)
		} catch {
			// Storage is blocked; the choice lasts until reload.
		}
		for (const listener of inPlaceListeners) listener()
	}
	return [inPlace, setInPlace]
}

function sentence(text: string): string {
	return /[.?]$/.test(text) ? text : `${text}.`
}
