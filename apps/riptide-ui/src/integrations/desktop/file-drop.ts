import * as tauriFileDrop from '@/integrations/tauri/file-drop'
import { isElectron, isTauri } from '@/lib/utils'

export interface NativeFileDropCallbacks {
	readonly onDragOverWindow: () => void
	readonly onDragLeaveWindow: () => void
	readonly onDropPaths: (paths: string[]) => void
}

export type NativeFileDropSubscription = (() => void) | null

export function subscribeToNativeFileDrop(callbacks: NativeFileDropCallbacks): NativeFileDropSubscription {
	if (isElectron()) return null
	if (isTauri()) return tauriFileDrop.subscribeToNativeFileDrop(callbacks)
	return null
}
