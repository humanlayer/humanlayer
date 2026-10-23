import { setZoom as setElectronZoom } from '@/integrations/electron/zoom'
import { applyZoomLevel as applyTauriZoomLevel } from '@/integrations/tauri/zoom'
import { isElectron, isTauri } from '@/lib/utils'

export const MIN_ZOOM_LEVEL = 0.2
export const MAX_ZOOM_LEVEL = 10
export const ZOOM_STEP = 0.1
export const DEFAULT_ZOOM_LEVEL = 1

export async function applyZoomLevel(zoomFactor: number): Promise<void> {
	if (isElectron()) return setElectronZoom(zoomFactor)
	if (isTauri()) return applyTauriZoomLevel(zoomFactor)
}
