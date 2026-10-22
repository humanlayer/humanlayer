import { getCurrentWebview } from '@tauri-apps/api/webview'

import type { NativeFileDropCallbacks } from '@/integrations/desktop/file-drop'
import { logger } from '@/lib/logger'

export function subscribeToNativeFileDrop(callbacks: NativeFileDropCallbacks): () => void {
	let unlisten: (() => void) | null = null
	let cancelled = false

	void getCurrentWebview()
		.onDragDropEvent((event) => {
			const payload = event.payload
			if (payload.type === 'enter' || payload.type === 'over') callbacks.onDragOverWindow()
			else if (payload.type === 'leave') callbacks.onDragLeaveWindow()
			else if (payload.type === 'drop') {
				callbacks.onDragLeaveWindow()
				callbacks.onDropPaths(payload.paths)
			}
		})
		.then((stop) => {
			if (cancelled) stop()
			else unlisten = stop
		})
		.catch((error) => {
			logger.warn('Could not listen for native file drops', {
				error: error instanceof Error ? error.message : String(error),
			})
		})

	return () => {
		cancelled = true
		unlisten?.()
	}
}
