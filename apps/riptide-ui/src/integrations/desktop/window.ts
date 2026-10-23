import { openNewWindow as openElectronWindow } from '@/integrations/electron/window'
import { isElectron, isTauri } from '@/lib/utils'

export type HorizontalTabsStorageScope = 'persistent' | 'window-session'

export function openNewWindow(): Promise<void> {
	if (isElectron()) return openElectronWindow()
	if (isTauri()) return Promise.resolve()
	return Promise.resolve()
}

function electronWindowRole(): 'main' | 'additional' {
	const bridge = (window as Window & { __RIPTIDE_ELECTRON__?: { readonly windowRole?: unknown } })
		.__RIPTIDE_ELECTRON__
	return bridge?.windowRole === 'additional' ? 'additional' : 'main'
}

export function getHorizontalTabsStorageScope(): HorizontalTabsStorageScope {
	return isElectron() && electronWindowRole() === 'additional' ? 'window-session' : 'persistent'
}

export function getHorizontalTabsStorage(): Storage {
	return getHorizontalTabsStorageScope() === 'window-session' ? window.sessionStorage : window.localStorage
}
