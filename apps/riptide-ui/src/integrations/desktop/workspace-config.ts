import type { Editor } from '@humanlayer/riptide-electron-rpc'

import * as electronWorkspace from '@/integrations/electron/workspace-config'
import * as tauriWorkspace from '@/integrations/tauri/workspace-config'
import { isElectron, isTauri } from '@/lib/utils'
import { patchWorkspaceLocalConfig } from '@/lib/workspace-config'
import type {
	WorkspaceConfigEnsureGitignoreInput,
	WorkspaceConfigOpenInEditorInput,
	WorkspaceConfigReadResult,
	WorkspaceConfigWriteInput,
} from '@/lib/workspace-config-schema'

export async function readWorkspaceConfig(
	directory: string,
	target: 'repo' | 'local',
): Promise<WorkspaceConfigReadResult> {
	if (isElectron()) return electronWorkspace.readWorkspaceConfig(directory, target)
	if (isTauri()) return tauriWorkspace.readWorkspaceConfig(directory, target)
	return { content: null, exists: false }
}

export async function writeWorkspaceConfig(input: WorkspaceConfigWriteInput): Promise<void> {
	if (isElectron()) return electronWorkspace.writeWorkspaceConfig(input)
	if (isTauri()) return tauriWorkspace.writeWorkspaceConfig(input)
}

export async function ensureWorkspaceLocalGitignore(input: WorkspaceConfigEnsureGitignoreInput): Promise<void> {
	if (isElectron()) return electronWorkspace.ensureWorkspaceConfigIgnored(input.directory)
	if (isTauri()) return tauriWorkspace.ensureWorkspaceLocalGitignore(input)
}

export async function openWorkspaceConfigInEditor(input: WorkspaceConfigOpenInEditorInput): Promise<void> {
	if (isElectron()) {
		return electronWorkspace.openWorkspaceConfig({ ...input, editor: input.editor as Editor | undefined })
	}
	if (isTauri()) return tauriWorkspace.openWorkspaceConfigInEditor(input)
}

export async function updateWorkspaceLocalConfig(directory: string, patch: Record<string, unknown>): Promise<void> {
	const existing = await readWorkspaceConfig(directory, 'local')
	await writeWorkspaceConfig({
		directory,
		target: 'local',
		content: patchWorkspaceLocalConfig(existing.content, patch),
	})
}

export async function getEditorEnvironment(): Promise<string | null> {
	if (isElectron()) return electronWorkspace.getEditorEnvironment()
	if (isTauri()) return (await import('@/integrations/tauri/editor')).getEditorEnv()
	return null
}
