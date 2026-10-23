/**
 * workspace-config.ts
 *
 * Runtime loading, merging, and preview generation for workspace config files.
 *
 * Config file locations relative to the selected working directory:
 *   .humanlayer/workspace.json         shared repo/team configuration
 *   .humanlayer/workspace.local.json   sparse user/machine-specific overrides
 *
 * Merge rules:
 *   - Effective root fields: defaults → workspace.json → workspace.local.json
 *   - repos[]: additive merge by localPath
 *     - Local entry with existing localPath merges into that entry
 *     - Local entry with new localPath adds a repo
 *     - Local entry with $patch: "delete" removes the repo
 *   - copyGlobs: additive merge with de-duplication
 *   - disabled: sourced from the most specific file that sets it
 */

import type {
	EffectiveRepoEntry,
	EffectiveWorkspaceConfig,
	WorkspaceConfigFile,
	WorkspaceLocalConfigFile,
	WorkspaceLocalRepoEntry,
	WorkspaceRepoEntry,
} from './workspace-config-schema'
import { WorkspaceConfigFileSchema, WorkspaceLocalConfigFileSchema } from './workspace-config-schema'

export type WorkspaceConfigParseErrorType = 'missing' | 'invalid_json' | 'schema_error'

export type WorkspaceConfigParseResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: { type: WorkspaceConfigParseErrorType; message: string } }

export type WorkspaceConfigLoadState =
	| { status: 'loading'; isInsideGitRepository?: boolean }
	| { status: 'ready'; config: EffectiveWorkspaceConfig; isInsideGitRepository?: boolean }
	| { status: 'missing'; isInsideGitRepository?: boolean }
	| {
			status: 'error'
			file: 'workspace.json' | 'workspace.local.json'
			message: string
			isInsideGitRepository?: boolean
	  }

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const WORKSPACE_CONFIG_DEFAULTS = {
	disabled: false,
	setupBlocksFirstSession: false,
	pathTemplate: '~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}',
	branchTemplate: '{{ TASKSLUG }}',
	sourceRef: 'origin/main',
	setupCommand: '',
	copyGlobs: [
		'.env',
		'.env.local',
		'.env.development.local',
		'.claude/settings.local.json',
		'.humanlayer/workspace.json',
		'.humanlayer/workspace.local.json',
	],
} as const

export const DEFAULT_SINGLE_REPO_ENTRY: WorkspaceRepoEntry = {
	localPath: '.',
	description: 'Selected repository',
	primary: true,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function formatSchemaError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
	const firstIssue = error.issues[0]
	if (!firstIssue) return 'Invalid workspace config schema'
	const path = firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : ''
	return `${path}${firstIssue.message}`
}

/**
 * Parses raw JSON string as a workspace.json config with explicit error metadata.
 */
export function parseWorkspaceConfigResult(
	content: string | null | undefined,
): WorkspaceConfigParseResult<WorkspaceConfigFile> {
	if (!content?.trim()) {
		return { ok: false, error: { type: 'missing', message: 'File does not exist' } }
	}

	let json: unknown
	try {
		json = JSON.parse(content)
	} catch (error) {
		return {
			ok: false,
			error: {
				type: 'invalid_json',
				message: error instanceof SyntaxError ? error.message : 'Invalid JSON',
			},
		}
	}

	const result = WorkspaceConfigFileSchema.safeParse(json)
	if (!result.success) {
		return { ok: false, error: { type: 'schema_error', message: formatSchemaError(result.error) } }
	}

	return { ok: true, data: result.data }
}

/**
 * Parses raw JSON string as a workspace.json config.
 * Returns null when the content is empty, missing, or unparseable.
 */
export function parseWorkspaceConfig(content: string | null | undefined): WorkspaceConfigFile | null {
	const result = parseWorkspaceConfigResult(content)
	return result.ok ? result.data : null
}

/**
 * Parses raw JSON string as a workspace.local.json config with explicit error metadata.
 */
export function parseWorkspaceLocalConfigResult(
	content: string | null | undefined,
): WorkspaceConfigParseResult<WorkspaceLocalConfigFile> {
	if (!content?.trim()) {
		return { ok: false, error: { type: 'missing', message: 'File does not exist' } }
	}

	let json: unknown
	try {
		json = JSON.parse(content)
	} catch (error) {
		return {
			ok: false,
			error: {
				type: 'invalid_json',
				message: error instanceof SyntaxError ? error.message : 'Invalid JSON',
			},
		}
	}

	const result = WorkspaceLocalConfigFileSchema.safeParse(json)
	if (!result.success) {
		return { ok: false, error: { type: 'schema_error', message: formatSchemaError(result.error) } }
	}

	return { ok: true, data: result.data }
}

/**
 * Parses raw JSON string as a workspace.local.json config.
 * Returns null when the content is empty, missing, or unparseable.
 */
export function parseWorkspaceLocalConfig(content: string | null | undefined): WorkspaceLocalConfigFile | null {
	const result = parseWorkspaceLocalConfigResult(content)
	return result.ok ? result.data : null
}

// ---------------------------------------------------------------------------
// Repo merge
// ---------------------------------------------------------------------------

/**
 * Merges the shared repos[] with local repos[] override entries.
 *
 * Rules:
 * - Local entry with $patch: "delete" removes matching localPath
 * - Local entry with existing localPath merges field-by-field (local wins non-undefined)
 * - Local entry with new localPath adds a new repo
 * - copyGlobs are additive and de-duplicated rather than replaced
 */
function mergeRepos(baseRepos: WorkspaceRepoEntry[], localRepos: WorkspaceLocalRepoEntry[]): WorkspaceRepoEntry[] {
	// Start with a mutable map keyed by localPath
	const result = new Map<string, WorkspaceRepoEntry>(baseRepos.map((r) => [r.localPath, { ...r }]))

	for (const localEntry of localRepos) {
		if (localEntry.$patch === 'delete') {
			result.delete(localEntry.localPath)
			continue
		}

		const existing = result.get(localEntry.localPath)
		if (existing) {
			// Merge: local non-undefined fields win
			const merged: WorkspaceRepoEntry = { ...existing }
			if (localEntry.description !== undefined) merged.description = localEntry.description
			if (localEntry.sourceRef !== undefined) merged.sourceRef = localEntry.sourceRef
			if (localEntry.branchRemote !== undefined) merged.branchRemote = localEntry.branchRemote
			if (localEntry.setupCommand !== undefined) merged.setupCommand = localEntry.setupCommand
			if (localEntry.primary !== undefined) merged.primary = localEntry.primary
			if (localEntry.copyGlobs !== undefined) {
				merged.copyGlobs = mergeUniqueStrings(existing.copyGlobs, localEntry.copyGlobs)
			}
			result.set(localEntry.localPath, merged)
		} else {
			// New repo from local override
			const { $patch: _patch, ...entryWithoutPatch } = localEntry
			result.set(localEntry.localPath, entryWithoutPatch)
		}
	}

	return Array.from(result.values())
}

function mergeUniqueStrings(...arrays: readonly (readonly string[] | undefined)[]): string[] {
	const result: string[] = []
	const seen = new Set<string>()

	for (const array of arrays) {
		for (const value of array ?? []) {
			if (seen.has(value)) continue
			seen.add(value)
			result.push(value)
		}
	}

	return result
}

// ---------------------------------------------------------------------------
// Effective config computation
// ---------------------------------------------------------------------------

/**
 * Computes the effective workspace configuration from raw file content.
 * Both content strings may be null (file doesn't exist).
 */
export function computeEffectiveConfig(
	repoConfigContent: string | null | undefined,
	localConfigContent: string | null | undefined,
): EffectiveWorkspaceConfig {
	const repoConfig = parseWorkspaceConfig(repoConfigContent)
	const localConfig = parseWorkspaceLocalConfig(localConfigContent)
	return computeEffectiveConfigFromParsed(repoConfig, localConfig)
}

export function computeEffectiveConfigFromParsed(
	repoConfig: WorkspaceConfigFile | null | undefined,
	localConfig: WorkspaceLocalConfigFile | null | undefined,
): EffectiveWorkspaceConfig {
	const isMissingConfig = repoConfig === null && localConfig === null

	// Root field resolution: defaults → repo config → local config
	const disabled =
		localConfig?.disabled !== undefined
			? localConfig.disabled
			: repoConfig?.disabled !== undefined
				? repoConfig.disabled
				: WORKSPACE_CONFIG_DEFAULTS.disabled

	const disabledSource: EffectiveWorkspaceConfig['disabledSource'] =
		localConfig?.disabled !== undefined
			? 'workspace.local.json'
			: repoConfig?.disabled !== undefined
				? 'workspace.json'
				: 'default'

	const setupBlocksFirstSession =
		localConfig?.setupBlocksFirstSession ??
		repoConfig?.setupBlocksFirstSession ??
		WORKSPACE_CONFIG_DEFAULTS.setupBlocksFirstSession

	const pathTemplate = localConfig?.pathTemplate ?? repoConfig?.pathTemplate ?? WORKSPACE_CONFIG_DEFAULTS.pathTemplate

	const branchTemplate =
		localConfig?.branchTemplate ?? repoConfig?.branchTemplate ?? WORKSPACE_CONFIG_DEFAULTS.branchTemplate

	const sourceRef = localConfig?.sourceRef ?? repoConfig?.sourceRef ?? WORKSPACE_CONFIG_DEFAULTS.sourceRef
	const branchRemote = localConfig?.branchRemote ?? repoConfig?.branchRemote

	const setupCommand = localConfig?.setupCommand ?? repoConfig?.setupCommand ?? WORKSPACE_CONFIG_DEFAULTS.setupCommand

	const copyGlobs = mergeUniqueStrings(
		WORKSPACE_CONFIG_DEFAULTS.copyGlobs,
		repoConfig?.copyGlobs,
		localConfig?.copyGlobs,
	)

	// Repos: start with repo config (or default single-repo if missing), merge local
	const baseRepos: WorkspaceRepoEntry[] =
		repoConfig?.repos !== undefined ? repoConfig.repos : [DEFAULT_SINGLE_REPO_ENTRY]

	const mergedRepos = localConfig?.repos ? mergeRepos(baseRepos, localConfig.repos) : baseRepos

	// Resolve per-repo effective fields using root defaults.
	// A single-repo config always resolves to primary: true; multi-repo configs
	// resolve from the explicit `primary` field (false when unset).
	const repos: EffectiveRepoEntry[] = mergedRepos.map((repo) => ({
		localPath: repo.localPath,
		description: repo.description,
		sourceRef: repo.sourceRef ?? sourceRef,
		branchRemote: repo.branchRemote ?? branchRemote,
		setupCommand: repo.setupCommand ?? setupCommand,
		copyGlobs: mergeUniqueStrings(copyGlobs, repo.copyGlobs),
		primary: mergedRepos.length === 1 ? true : (repo.primary ?? false),
	}))

	return {
		disabled,
		disabledSource,
		setupBlocksFirstSession,
		pathTemplate,
		branchTemplate,
		sourceRef,
		branchRemote,
		setupCommand,
		copyGlobs,
		repos,
		isMissingConfig,
	}
}

// ---------------------------------------------------------------------------
// Template variable rendering
// ---------------------------------------------------------------------------

/**
 * Renders template variables in a path/branch template string.
 * Template variables: {{ TASKSLUG }}, {{ REPOBASENAME }}
 */
export function interpolateTemplate(template: string, variables: { TASKSLUG?: string; REPOBASENAME?: string }): string {
	let result = template
	if (variables.TASKSLUG !== undefined) {
		result = result.replace(/\{\{\s*TASKSLUG\s*\}\}/g, variables.TASKSLUG)
	}
	if (variables.REPOBASENAME !== undefined) {
		result = result.replace(/\{\{\s*REPOBASENAME\s*\}\}/g, variables.REPOBASENAME)
	}
	return result
}

/**
 * Derives REPOBASENAME from a repo's localPath.
 * For "." returns the basename of the selected working directory.
 */
export function repoBasename(localPath: string, selectedDirectory?: string): string {
	if (localPath === '.') {
		if (!selectedDirectory) return 'repo'
		const parts = selectedDirectory.replace(/\/+$/, '').split('/')
		return parts[parts.length - 1] || 'repo'
	}
	const parts = localPath.replace(/\/+$/, '').split('/')
	return parts[parts.length - 1] || localPath
}

export function formatJiraTicketMd(issue: {
	key: string
	summary: string
	status?: string | null
	description?: string | null
	url: string
}): string {
	const lines = [
		`[${issue.key}] ${issue.summary}`,
		issue.status ? `Status: ${issue.status}` : null,
		'',
		issue.description ? `Description:\n${issue.description}` : null,
		'',
		`View in Jira: ${issue.url}`,
	]
	return lines.filter((line): line is string => line !== null).join('\n')
}

// ---------------------------------------------------------------------------
// Preview JSON generation
// ---------------------------------------------------------------------------

/**
 * Generates the JSON preview string for the workspace.json file that would be
 * written given the current form values (root fields only — no repos[] editing in v1).
 *
 * When workspace.json does not yet exist, a default single-repo repos[] is included.
 */
export function generateRepoConfigPreview(
	formValues: {
		disabled?: boolean
		pathTemplate?: string
		branchTemplate?: string
		setupBlocksFirstSession?: boolean
		sourceRef?: string
		branchRemote?: string
		setupCommand?: string
		copyGlobs?: string[]
	},
	existingConfig: WorkspaceConfigFile | null,
): string {
	const repos = existingConfig?.repos ?? [DEFAULT_SINGLE_REPO_ENTRY]

	const preview: WorkspaceConfigFile = {
		disabled: formValues.disabled ?? false,
		setupBlocksFirstSession:
			formValues.setupBlocksFirstSession ?? WORKSPACE_CONFIG_DEFAULTS.setupBlocksFirstSession,
		pathTemplate: formValues.pathTemplate ?? WORKSPACE_CONFIG_DEFAULTS.pathTemplate,
		branchTemplate: formValues.branchTemplate ?? WORKSPACE_CONFIG_DEFAULTS.branchTemplate,
		sourceRef: formValues.sourceRef ?? WORKSPACE_CONFIG_DEFAULTS.sourceRef,
		branchRemote: formValues.branchRemote ?? existingConfig?.branchRemote,
		setupCommand: formValues.setupCommand ?? WORKSPACE_CONFIG_DEFAULTS.setupCommand,
		copyGlobs: formValues.copyGlobs ?? [...WORKSPACE_CONFIG_DEFAULTS.copyGlobs],
		repos,
	}

	return JSON.stringify(preview, null, 2)
}

/**
 * Generates the JSON preview string for the workspace.local.json file.
 * Only includes non-empty root fields (no repos[] in v1 modal form).
 * Omits fields that are empty/default so the local file stays sparse.
 */
export function generateLocalConfigPreview(formValues: {
	disabled?: boolean
	pathTemplate?: string
	branchTemplate?: string
	setupBlocksFirstSession?: boolean
	sourceRef?: string
	branchRemote?: string
	setupCommand?: string
	copyGlobs?: string[]
}): string {
	const preview: WorkspaceLocalConfigFile = {}

	if (formValues.disabled !== undefined) preview.disabled = formValues.disabled
	if (formValues.setupBlocksFirstSession !== undefined) {
		preview.setupBlocksFirstSession = formValues.setupBlocksFirstSession
	}
	if (formValues.pathTemplate?.trim()) preview.pathTemplate = formValues.pathTemplate.trim()
	if (formValues.branchTemplate?.trim()) preview.branchTemplate = formValues.branchTemplate.trim()
	if (formValues.sourceRef?.trim()) preview.sourceRef = formValues.sourceRef.trim()
	if (formValues.branchRemote?.trim()) preview.branchRemote = formValues.branchRemote.trim()
	if (formValues.setupCommand?.trim()) preview.setupCommand = formValues.setupCommand.trim()
	if (formValues.copyGlobs !== undefined && formValues.copyGlobs.length > 0) preview.copyGlobs = formValues.copyGlobs

	return JSON.stringify(preview, null, 2)
}

// ---------------------------------------------------------------------------
// Workspace-now eligibility checks
// ---------------------------------------------------------------------------

export interface WorkspaceNowEligibility {
	eligible: boolean
	/** Why workspace-now is not available, for display in the UI */
	reason?: string
}

export type WorkspaceNowExecutionMode = 'daemon' | 'form'

/**
 * Determines whether workspace-now is available for the current state.
 */
export function checkWorkspaceNowEligibility({
	isRemoteHost,
	isTauri,
	config,
	executionMode,
}: {
	isRemoteHost: boolean
	isTauri: boolean
	config: EffectiveWorkspaceConfig | null
	executionMode: WorkspaceNowExecutionMode
}): WorkspaceNowEligibility {
	if (!isTauri) {
		return { eligible: false, reason: 'Worktree setup requires the desktop app' }
	}

	if (isRemoteHost && executionMode !== 'daemon') {
		return { eligible: false, reason: 'Worktree setup on a remote host requires daemon-driven setup' }
	}

	if (config === null) {
		return { eligible: false, reason: 'Worktree config not yet loaded' }
	}

	if (config.isMissingConfig) {
		return {
			eligible: false,
			reason: 'Worktree config is required to use "Now". Configure it to continue.',
		}
	}

	if (config.disabled) {
		return {
			eligible: false,
			reason: `Worktree setup is disabled in ${config.disabledSource}. Enable it to use "Now".`,
		}
	}

	return { eligible: true }
}

/**
 * Returns true if the effective config has more repos than the warning threshold.
 * The threshold is a UX heuristic and is intentionally easy to change.
 */
export const LARGE_WORKSPACE_REPO_THRESHOLD = 5

export function isLargeWorkspace(config: EffectiveWorkspaceConfig): boolean {
	return config.repos.length > LARGE_WORKSPACE_REPO_THRESHOLD
}

// ---------------------------------------------------------------------------
// Config patching utilities
// ---------------------------------------------------------------------------

/**
 * Merges a partial update into existing workspace.local.json content.
 * Returns the merged config as a formatted JSON string.
 *
 * @param existingContent  Raw JSON string from workspace.local.json (may be null/empty)
 * @param patch            Partial fields to merge (shallow merge, patch wins)
 */
export function patchWorkspaceLocalConfig(
	existingContent: string | null | undefined,
	patch: Partial<WorkspaceLocalConfigFile>,
): string {
	const existing = parseWorkspaceLocalConfig(existingContent) ?? {}
	const merged = { ...existing, ...patch }
	return JSON.stringify(merged, null, 2)
}

// ---------------------------------------------------------------------------
// Async config loading (for Tauri filesystem)
// ---------------------------------------------------------------------------

/**
 * Reads and parses both workspace config files for a directory.
 * Returns the load state suitable for the newTaskFormStore.
 *
 * @param directory The directory to read configs from
 * @param readWorkspaceConfig The Tauri filesystem reader function
 */
export async function readWorkspaceConfigLoadState(
	directory: string,
	readWorkspaceConfig: (
		dir: string,
		target: 'repo' | 'local',
	) => Promise<{ content: string | null; isInsideGitRepository?: boolean }>,
): Promise<WorkspaceConfigLoadState> {
	const [repoResult, localResult] = await Promise.all([
		readWorkspaceConfig(directory, 'repo'),
		readWorkspaceConfig(directory, 'local'),
	])

	const repoParsed = parseWorkspaceConfigResult(repoResult.content)
	const localParsed = parseWorkspaceLocalConfigResult(localResult.content)
	const repositoryState = { isInsideGitRepository: repoResult.isInsideGitRepository }

	if (!repoParsed.ok && repoParsed.error.type !== 'missing') {
		return { status: 'error', file: 'workspace.json', message: repoParsed.error.message, ...repositoryState }
	}

	if (!localParsed.ok && localParsed.error.type !== 'missing') {
		return { status: 'error', file: 'workspace.local.json', message: localParsed.error.message, ...repositoryState }
	}

	if (!repoParsed.ok && !localParsed.ok) {
		return { status: 'missing', ...repositoryState }
	}

	return {
		status: 'ready',
		...repositoryState,
		config: computeEffectiveConfigFromParsed(
			repoParsed.ok ? repoParsed.data : null,
			localParsed.ok ? localParsed.data : null,
		),
	}
}
