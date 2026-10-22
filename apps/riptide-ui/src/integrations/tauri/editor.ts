import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/utils'

export async function getEditorEnv(): Promise<string | null> {
	if (!isTauri()) return null
	try {
		return await invoke<string | null>('get_editor_env')
	} catch {
		return null
	}
}
