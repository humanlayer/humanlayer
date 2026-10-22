import { useMountEffect } from '@/hooks/useMountEffect'
import { cleanupWindowStateListeners, initWindowStateListeners } from '@/integrations/tauri/window'

/**
 * Self-contained component that handles window state persistence.
 * Renders nothing - just sets up the window state listeners.
 * Window restoration is handled in Rust during app setup.
 */
export function WindowStateHandler() {
	useMountEffect(() => {
		void initWindowStateListeners()

		return () => {
			cleanupWindowStateListeners()
		}
	})

	return null
}
