import * as electronDeepLinks from '@/integrations/electron/deep-links'
import * as tauriDeepLinks from '@/integrations/tauri/deep-links'
import { isElectron, isTauri } from '@/lib/utils'

export interface DesktopDeepLink {
	readonly url: string
}

export function takePendingDeepLink(): Promise<DesktopDeepLink | null> {
	if (isElectron()) return electronDeepLinks.takePendingDeepLink()
	if (isTauri()) return tauriDeepLinks.takePendingDeepLink()
	return Promise.resolve(null)
}

export function onDeepLink(callback: (link: DesktopDeepLink) => void): Promise<(() => void) | null> {
	if (isElectron()) return electronDeepLinks.onDeepLink(callback)
	if (isTauri()) return tauriDeepLinks.onDeepLink(callback)
	return Promise.resolve(null)
}
