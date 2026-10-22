/**
 * task-workspace-preferences.ts
 *
 * Helpers for the V2 task form axis-based preference system.
 * Covers per-(hostId, directory) preference key helpers.
 */

export type V2IssueSource = 'inline' | 'linear' | 'jira' | 'github'
export type V2Workflow = 'rpi' | 'outline_only' | 'prd_tdd' | 'oneshot' | 'freeform'
export type V2WorkspaceTiming = 'now' | 'later' | 'never'

export interface RepoExclusions {
	repoLocalPaths: string[]
	excludedLocalPaths: string[]
}

export interface DirectoryAxisPreferences {
	issueSource: V2IssueSource
	workflow: V2Workflow
	workspaceTiming: V2WorkspaceTiming
	repoExclusions?: RepoExclusions
}

/**
 * Normalizes a directory path for use as a preference key:
 * - trims whitespace
 * - removes trailing slashes (except for root "/")
 *
 * Note: tilde expansion and symlink resolution are intentionally not performed here
 * so the key stays stable across shell expansions without requiring a native roundtrip.
 */
export function normalizeDirectoryForKey(directory: string): string {
	const trimmed = directory.trim()
	if (!trimmed || trimmed === '/') return trimmed
	return trimmed.replace(/\/+$/, '')
}

/**
 * Builds a preference storage key for a (hostId, directory) pair.
 */
export function buildDirectoryPreferenceKey(hostId: string, directory: string): string {
	const normalizedDir = normalizeDirectoryForKey(directory)
	return `v2-task-prefs:${hostId}:${normalizedDir}`
}
