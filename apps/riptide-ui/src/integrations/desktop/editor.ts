import type { Editor } from '@humanlayer/riptide-electron-rpc'
import { invoke } from '@tauri-apps/api/core'

import { openInEditor as openInElectronEditor } from '@/integrations/electron/editor'
import { isElectron, isTauri } from '@/lib/utils'

export interface OpenInEditorInput {
	readonly path: string
	readonly editor: Editor | null
}

export async function openInEditor(input: OpenInEditorInput): Promise<boolean> {
	if (isElectron()) {
		await openInElectronEditor(input)
		return true
	}
	if (isTauri()) {
		await invoke('open_in_editor', { path: input.path, editor: input.editor })
		return true
	}
	return false
}
