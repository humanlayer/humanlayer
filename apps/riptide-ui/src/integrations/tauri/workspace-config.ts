/**
 * workspace-config.ts — Tauri frontend wrappers for native workspace config commands.
 *
 * These wrappers call into workspace_setup.rs via Tauri's invoke() bridge.
 * All functions degrade gracefully (return null / no-op) in web/non-Tauri mode.
 */

import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/utils'
import { patchWorkspaceLocalConfig } from '@/lib/workspace-config'
import type {
	WorkspaceConfigEnsureGitignoreInput,
	WorkspaceConfigOpenInEditorInput,
	WorkspaceConfigReadResult,
	WorkspaceConfigWriteInput,
} from '@/lib/workspace-config-schema'

/**
 * Reads a workspace config file from the given directory.
 *
 * @param directory  Absolute path to the working directory
 * @param target     'repo' reads workspace.json, 'local' reads workspace.local.json
 */
export async function readWorkspaceConfig(
	directory: string,
	target: 'repo' | 'local',
): Promise<WorkspaceConfigReadResult> {
	if (!isTauri()) return { content: null, exists: false }
	try {
		return await invoke<WorkspaceConfigReadResult>('workspace_config_read', { directory, target })
	} catch (err) {
		console.error('[workspace-config] readWorkspaceConfig failed:', err)
		return { content: null, exists: false }
	}
}

/**
 * Writes content to a workspace config file.
 * Creates parent directories (.humanlayer/) as needed.
 */
export async function writeWorkspaceConfig(input: WorkspaceConfigWriteInput): Promise<void> {
	if (!isTauri()) return
	await invoke<void>('workspace_config_write', input)
}

/**
 * Ensures that .humanlayer/workspace.local.json is listed in the repo's
 * .gitignore (creating or appending as needed).
 */
export async function ensureWorkspaceLocalGitignore(input: WorkspaceConfigEnsureGitignoreInput): Promise<void> {
	if (!isTauri()) return
	await invoke<void>('workspace_config_ensure_gitignore', input)
}

/**
 * Opens a workspace config file in the user's configured editor.
 *
 * If the file does not yet exist, it is created from previewContent before
 * the editor is launched, matching the design intent for "Open in editor".
 */
export async function openWorkspaceConfigInEditor(input: WorkspaceConfigOpenInEditorInput): Promise<void> {
	if (!isTauri()) return
	await invoke<void>('workspace_config_open_in_editor', input)
}

/**
 * Atomically patches workspace.local.json by reading, merging, and writing.
 * Handles the common pattern of updating a single field while preserving others.
 *
 * @param directory  Absolute path to the working directory
 * @param patch      Partial fields to merge into the existing config
 */
export async function updateWorkspaceLocalConfig(directory: string, patch: Record<string, unknown>): Promise<void> {
	if (!isTauri()) return
	const existing = await readWorkspaceConfig(directory, 'local')
	const content = patchWorkspaceLocalConfig(existing.content, patch)
	await writeWorkspaceConfig({ directory, target: 'local', content })
}
