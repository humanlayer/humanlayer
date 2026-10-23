import { invoke } from '@tauri-apps/api/core'

export function saveArtifactTrace(json: string): Promise<string> {
	return invoke<string>('save_artifact_trace', { json })
}
