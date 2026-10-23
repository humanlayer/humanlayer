/**
 * workspace-setup.ts
 *
 * Helper logic for the workspace-now pipeline:
 *   - Rendering repo input objects from effective config + task slug
 *   - Primary-repo resolution for the task's repo selection
 *   - Workspace base directory derivation (common-parent rule)
 *   - Large-workspace warning helpers
 *
 * The actual native calls live in integrations/tauri/workspace-setup.ts.
 * This module contains pure logic that is unit-testable without Tauri.
 */

import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'

import type { WorkspaceRepoInput } from '@/integrations/tauri/workspace-setup'

import { interpolateTemplate, repoBasename } from './workspace-config'
import type { EffectiveRepoEntry, EffectiveWorkspaceConfig } from './workspace-config-schema'

// ---------------------------------------------------------------------------
// Repo input rendering
// ---------------------------------------------------------------------------

/**
 * Renders a WorkspaceRepoInput object from a resolved repo entry, given the
 * task slug and the absolute selected directory.
 *
 * targetPath is tilde-prefixed (not expanded) — Rust handles tilde expansion.
 */
export function renderRepoInput(
	repo: EffectiveRepoEntry,
	{
		taskSlug,
		selectedDirectory,
		pathTemplate,
		branchTemplate,
	}: {
		taskSlug: string
		selectedDirectory: string
		pathTemplate: string
		branchTemplate: string
	},
): WorkspaceRepoInput {
	const basename = repoBasename(repo.localPath, selectedDirectory)

	const targetPath = interpolateTemplate(pathTemplate, {
		TASKSLUG: taskSlug,
		REPOBASENAME: basename,
	})

	const branch = interpolateTemplate(branchTemplate, {
		TASKSLUG: taskSlug,
	})

	const result = {
		localPath: repo.localPath,
		targetPath,
		branch,
		sourceRef: repo.sourceRef,
		branchRemote: repo.branchRemote,
		setupCommand: repo.setupCommand,
		copyGlobs: repo.copyGlobs,
	}
	console.log('[renderRepoInput] repo.copyGlobs:', repo.copyGlobs, 'result.copyGlobs:', result.copyGlobs)
	return result
}

/**
 * Renders WorkspaceRepoInput objects for all repos in the effective config.
 */
export function renderAllRepoInputs(
	config: EffectiveWorkspaceConfig,
	{
		taskSlug,
		selectedDirectory,
	}: {
		taskSlug: string
		selectedDirectory: string
	},
): WorkspaceRepoInput[] {
	return config.repos.map((repo) =>
		renderRepoInput(repo, {
			taskSlug,
			selectedDirectory,
			pathTemplate: config.pathTemplate,
			branchTemplate: config.branchTemplate,
		}),
	)
}

/** Builds the portable desired workspace shape from the same rendered inputs used by Tauri. */
export function renderWorkspaceSpec({
	config,
	selectedDirectory,
	repoInputs,
}: {
	config: EffectiveWorkspaceConfig
	selectedDirectory: string
	repoInputs: WorkspaceRepoInput[]
}): WorkspaceSpec {
	const baseDirectory = deriveWorkspaceBaseDirectory(repoInputs)
	if (!baseDirectory.ok) throw new Error(baseDirectory.error)
	const reposByLocalPath = new Map(config.repos.map((repo) => [repo.localPath, repo]))

	return {
		specVersion: 1,
		directory: selectedDirectory,
		workspaceBaseDirectory: baseDirectory.baseDir,
		setupBlocksFirstSession: config.setupBlocksFirstSession,
		repos: repoInputs.map((input) => {
			const repo = reposByLocalPath.get(input.localPath)
			if (!repo) throw new Error(`No effective repo entry found for workspace repo "${input.localPath}"`)
			const workspaceSpecRepo: WorkspaceSpec['repos'][number] = {
				localPath: input.localPath,
				targetPath: input.targetPath,
				branch: input.branch,
				sourceRef: input.sourceRef,
				copyGlobs: input.copyGlobs,
				primary: repo.primary,
			}
			if (input.branchRemote) workspaceSpecRepo.branchRemote = input.branchRemote
			if (input.setupCommand) workspaceSpecRepo.setupCommand = input.setupCommand
			return workspaceSpecRepo
		}),
	}
}

// ---------------------------------------------------------------------------
// Primary repo resolution
// ---------------------------------------------------------------------------

/**
 * Applies the per-task primary-repo override to a repo selection and
 * normalizes single-repo selections.
 *
 * Rules:
 *   - A single-repo selection is always primary (regardless of config flags)
 *   - An override matching a repo in the selection wins: that repo becomes
 *     primary and every other repo becomes non-primary
 *   - Otherwise the config-resolved `primary` flags stand unchanged (zero or
 *     multiple primaries are possible — callers prompt / assert downstream)
 */
export function applyPrimaryRepoSelection(
	repos: EffectiveRepoEntry[],
	primaryOverrideLocalPath: string | null,
): EffectiveRepoEntry[] {
	if (repos.length === 1) {
		return repos.map((repo) => ({ ...repo, primary: true }))
	}
	if (primaryOverrideLocalPath !== null && repos.some((repo) => repo.localPath === primaryOverrideLocalPath)) {
		return repos.map((repo) => ({ ...repo, primary: repo.localPath === primaryOverrideLocalPath }))
	}
	return repos
}

// ---------------------------------------------------------------------------
// Workspace base directory (common-parent rule)
// ---------------------------------------------------------------------------

/**
 * Returns the parent directory of a rendered target path, using simple string
 * manipulation (paths may be tilde-prefixed and must not be expanded here).
 * Returns null when the path has no derivable parent.
 */
export function parentDirectory(path: string): string | null {
	const trimmed = path.replace(/\/+$/, '')
	const idx = trimmed.lastIndexOf('/')
	if (idx < 0) return null
	if (idx === 0) return trimmed.length > 1 ? '/' : null
	return trimmed.slice(0, idx)
}

/**
 * Derives the workspace base directory from the rendered repo target paths.
 *
 * All targets must share a single common parent directory — that parent is the
 * multi-repo workspace base directory (e.g. "~/.humanlayer/workspaces/<slug>").
 * Single-repo selections always pass (base = the one target's parent).
 *
 * Returns a config error when the targets do not share a parent (a custom
 * pathTemplate can scatter worktrees); callers must fail before any native
 * git call is made.
 */
export function deriveWorkspaceBaseDirectory(
	inputs: WorkspaceRepoInput[],
): { ok: true; baseDir: string } | { ok: false; error: string } {
	const [first, ...rest] = inputs
	if (!first) {
		return { ok: false, error: 'No repositories selected for workspace setup' }
	}

	const baseDir = parentDirectory(first.targetPath)
	if (baseDir === null) {
		return {
			ok: false,
			error: `Cannot derive a workspace directory from target path "${first.targetPath}". Check the pathTemplate in your workspace config.`,
		}
	}

	for (const input of rest) {
		const parent = parentDirectory(input.targetPath)
		if (parent !== baseDir) {
			return {
				ok: false,
				error: `All worktree target paths must share one parent directory, but "${first.targetPath}" and "${input.targetPath}" do not. Check the pathTemplate in your workspace config.`,
			}
		}
	}

	return { ok: true, baseDir }
}

// ---------------------------------------------------------------------------
// Multi-repo warning
// ---------------------------------------------------------------------------

/** Number of repos above which the large-workspace confirmation is shown. */
export const LARGE_WORKSPACE_REPO_THRESHOLD = 5

/**
 * Returns true when the workspace has more repos than the warning threshold.
 * The threshold is a UX heuristic for v1, easy to tune.
 */
export function isLargeWorkspace(config: EffectiveWorkspaceConfig): boolean {
	return config.repos.length > LARGE_WORKSPACE_REPO_THRESHOLD
}

/**
 * Returns whether a large-workspace confirmation is needed before proceeding
 * with workspace-now.
 *
 * Confirmation is NOT needed when:
 *   - The workspace is not large (≤ 5 repos)
 *   - The user has a globally-persisted "Always allow" flag
 *   - The caller has a session-scoped "allow this time" flag
 */
export function needsLargeWorkspaceConfirmation(
	config: EffectiveWorkspaceConfig,
	{ allowedThisTime, alwaysAllow }: { allowedThisTime: boolean; alwaysAllow: boolean },
): boolean {
	if (!isLargeWorkspace(config)) return false
	if (alwaysAllow) return false
	if (allowedThisTime) return false
	return true
}
