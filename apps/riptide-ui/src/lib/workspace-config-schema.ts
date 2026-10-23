/**
 * workspace-config-schema.ts
 *
 * Shared Zod schemas for workspace config files:
 *   .humanlayer/workspace.json         shared repo/team configuration
 *   .humanlayer/workspace.local.json   sparse user/machine-specific overrides
 *
 * These schemas are used by:
 *   - workspace-config.ts (runtime parsing and merge)
 *   - NewTaskFormV2Pure.tsx (workspace setup summary and repo selection)
 *   - riptide-native workspace_setup.rs bridge payloads (via JSON serialisation)
 */

import z from 'zod/v4'

// ---------------------------------------------------------------------------
// Repo entry schemas
// ---------------------------------------------------------------------------

/**
 * A single repo entry in the shared workspace.json repos[].
 * The entry identifies the repo by local path relative to the selected directory.
 */
export const WorkspaceRepoEntrySchema = z
	.object({
		/** Path to the repo, relative to the selected working directory. "." means the selected repo itself. */
		localPath: z.string().min(1, 'localPath is required'),
		/** Human-readable description shown in UI */
		description: z.string().optional(),
		/** Git ref to create the worktree from. Defaults to the root-level sourceRef. */
		sourceRef: z.string().optional(),
		/** Remote used to publish and track task branches. Inferred from sourceRef when omitted. */
		branchRemote: z.string().min(1).optional(),
		/** Shell command to run after worktree creation and copy-glob copy. */
		setupCommand: z.string().optional(),
		/** Glob patterns for files to copy into the created worktree. Additive with inherited/root copyGlobs. */
		copyGlobs: z.array(z.string()).optional(),
		/**
		 * Marks the default launch / config repo for multi-repo workspaces. At most one.
		 * Sessions launch in the primary repo by default, so its repo-local Claude
		 * settings / MCP configuration governs sessions.
		 */
		primary: z.boolean().optional(),
	})
	.strict()

export type WorkspaceRepoEntry = z.infer<typeof WorkspaceRepoEntrySchema>

/**
 * A repo entry inside a local-override file. Same as above but additionally
 * supports $patch: "delete" to remove the repo from the effective config.
 */
export const WorkspaceLocalRepoEntrySchema = WorkspaceRepoEntrySchema.extend({
	$patch: z.literal('delete').optional(),
})

export type WorkspaceLocalRepoEntry = z.infer<typeof WorkspaceLocalRepoEntrySchema>

// ---------------------------------------------------------------------------
// Root config schemas
// ---------------------------------------------------------------------------

/**
 * Shared repo workspace.json schema.
 * All fields are optional so partially-written configs still parse.
 */
export const WorkspaceConfigFileSchema = z
	.object({
		/**
		 * When true, workspace setup choices that require worktree creation are
		 * disabled. Effective disabled = root default (false) → workspace.json → workspace.local.json.
		 */
		disabled: z.boolean().optional(),
		/** When true, the first session waits until all workspace setup commands finish. */
		setupBlocksFirstSession: z.boolean().optional(),
		/**
		 * Template for the created worktree path.
		 * Template variables: {{ TASKSLUG }}, {{ REPOBASENAME }}
		 * Default: "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}"
		 */
		pathTemplate: z.string().optional(),
		/**
		 * Template for the created branch name.
		 * Template variables: {{ TASKSLUG }}
		 * Default: "{{ TASKSLUG }}"
		 */
		branchTemplate: z.string().optional(),
		/**
		 * Default git ref for all repos unless overridden per repo.
		 * Default: "HEAD"
		 */
		sourceRef: z.string().optional(),
		/** Default remote used to publish and track task branches. */
		branchRemote: z.string().min(1).optional(),
		/**
		 * Default setup command to run in each worktree after creation.
		 * Default: "" (no command)
		 */
		setupCommand: z.string().optional(),
		/**
		 * Default glob patterns for files to copy into each worktree.
		 * Uses additive merge semantics when set by workspace.json or workspace.local.json.
		 */
		copyGlobs: z.array(z.string()).optional(),
		/** Repo entries that participate in workspace creation. */
		repos: z.array(WorkspaceRepoEntrySchema).optional(),
	})
	.strict()

export type WorkspaceConfigFile = z.infer<typeof WorkspaceConfigFileSchema>

/**
 * Local override workspace.local.json schema.
 * Same as the shared config but repos use WorkspaceLocalRepoEntrySchema,
 * allowing $patch: "delete".
 */
export const WorkspaceLocalConfigFileSchema = WorkspaceConfigFileSchema.extend({
	repos: z.array(WorkspaceLocalRepoEntrySchema).optional(),
})

export type WorkspaceLocalConfigFile = z.infer<typeof WorkspaceLocalConfigFileSchema>

// ---------------------------------------------------------------------------
// Effective config (post-merge)
// ---------------------------------------------------------------------------

/**
 * A fully-resolved repo entry after merging workspace.json and workspace.local.json.
 * No $patch field — deleted repos do not appear in the effective config.
 */
export const EffectiveRepoEntrySchema = z.object({
	localPath: z.string(),
	description: z.string().optional(),
	sourceRef: z.string(),
	branchRemote: z.string().min(1).optional(),
	setupCommand: z.string(),
	copyGlobs: z.array(z.string()),
	/**
	 * Whether this repo is the default launch / config repo. Single-repo configs
	 * always resolve to primary: true; multi-repo configs resolve from the
	 * explicit `primary` field (false when unset).
	 */
	primary: z.boolean(),
})

export type EffectiveRepoEntry = z.infer<typeof EffectiveRepoEntrySchema>

/**
 * The fully-resolved effective workspace configuration, combining root defaults,
 * workspace.json, and workspace.local.json with precedence rules.
 */
const EffectiveWorkspaceConfigSchema = z.object({
	disabled: z.boolean(),
	setupBlocksFirstSession: z.boolean(),
	/** Which config file contributed the disabled value, for UX attribution. */
	disabledSource: z.enum(['default', 'workspace.json', 'workspace.local.json']),
	pathTemplate: z.string(),
	branchTemplate: z.string(),
	sourceRef: z.string(),
	branchRemote: z.string().min(1).optional(),
	setupCommand: z.string(),
	copyGlobs: z.array(z.string()),
	repos: z.array(EffectiveRepoEntrySchema),
	/** True when neither workspace.json nor workspace.local.json was found. */
	isMissingConfig: z.boolean(),
})

export type EffectiveWorkspaceConfig = z.infer<typeof EffectiveWorkspaceConfigSchema>

// ---------------------------------------------------------------------------
// Read/write payloads (Tauri bridge)
// ---------------------------------------------------------------------------

const WorkspaceConfigReadResultSchema = z.object({
	/** Raw file content, null when file does not exist */
	content: z.string().nullable(),
	/** Whether the file exists */
	exists: z.boolean(),
	/** Present for the shared config read; reports whether the selected directory is in Git. */
	isInsideGitRepository: z.boolean().optional(),
	/** Present when the selected directory is itself a Git repository root. */
	selectedRepository: z
		.object({
			path: z.string(),
			name: z.string(),
			remotes: z.array(z.object({ name: z.string(), url: z.string() })).readonly(),
			defaultRemote: z.string().optional(),
			defaultBranch: z.string(),
			sourceRef: z.string().optional(),
		})
		.optional(),
})

export type WorkspaceConfigReadResult = z.infer<typeof WorkspaceConfigReadResultSchema>

const WorkspaceConfigWriteInputSchema = z.object({
	/** Absolute path to the selected working directory */
	directory: z.string(),
	/** 'repo' writes workspace.json, 'local' writes workspace.local.json */
	target: z.enum(['repo', 'local']),
	/** JSON content to write */
	content: z.string(),
})

export type WorkspaceConfigWriteInput = z.infer<typeof WorkspaceConfigWriteInputSchema>

const WorkspaceConfigEnsureGitignoreInputSchema = z.object({
	/** Absolute path to the selected working directory */
	directory: z.string(),
})

export type WorkspaceConfigEnsureGitignoreInput = z.infer<typeof WorkspaceConfigEnsureGitignoreInputSchema>

const WorkspaceConfigOpenInEditorInputSchema = z.object({
	/** Absolute path to the selected working directory */
	directory: z.string(),
	/** 'repo' opens workspace.json, 'local' opens workspace.local.json */
	target: z.enum(['repo', 'local']),
	/** Preview/template content to write if the file does not yet exist */
	previewContent: z.string(),
	/** Optional editor command (cursor, code, zed). If omitted uses system default. */
	editor: z.string().optional(),
})

export type WorkspaceConfigOpenInEditorInput = z.infer<typeof WorkspaceConfigOpenInEditorInputSchema>
