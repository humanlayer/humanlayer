import { useEffect } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { applyZoomLevel } from '@/integrations/desktop/zoom'
import { isDesktop } from '@/lib/utils'

/**
 * Self-contained component that handles zoom level persistence and restoration.
 * Renders nothing - subscribes to the settings store and applies zoom changes
 * to the Tauri webview. Handles both startup restore and live changes.
 */
export function ZoomHandler() {
	const zoomLevel = useSettingsStore((s) => s.zoomLevel)
	const zoomScrollLockEnabled = useSettingsStore((s) => s.zoomScrollLockEnabled)

	useEffect(() => {
		if (isDesktop()) {
			void applyZoomLevel(zoomLevel)
		}
	}, [zoomLevel])

	useEffect(() => {
		if (!isDesktop() || !zoomScrollLockEnabled) return
		const handler = (e: WheelEvent) => {
			if (e.ctrlKey) {
				e.stopImmediatePropagation()
				e.preventDefault()
			}
		}
		window.addEventListener('wheel', handler, { capture: true, passive: false } as AddEventListenerOptions)
		return () => window.removeEventListener('wheel', handler, { capture: true } as EventListenerOptions)
	}, [zoomScrollLockEnabled])

	return null
}
