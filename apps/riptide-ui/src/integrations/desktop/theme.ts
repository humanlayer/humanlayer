import type { WindowTheme } from '@humanlayer/riptide-electron-rpc'
import type { Theme } from '@humanlayer/ui/components/theme-provider'
import { themeToAppearance } from '@humanlayer/ui/lib/theme-appearance-mapping'

import { setElectronWindowTheme } from '@/integrations/electron/theme'
import { setWindowAppearance as setTauriWindowAppearance } from '@/integrations/tauri/theme'
import { logger } from '@/lib/logger'
import { isElectron, isTauri } from '@/lib/utils'

export function setWindowTheme(theme: Theme): Promise<void> {
	return setWindowAppearance(themeToAppearance[theme])
}

/** Set the window appearance without a named theme; 'system' lets the OS decide again. */
export async function setWindowAppearance(appearance: WindowTheme): Promise<void> {
	if (isTauri()) return setTauriWindowAppearance(appearance)
	if (!isElectron()) return

	try {
		await setElectronWindowTheme(appearance)
	} catch (error) {
		logger.error('Failed to set window theme', {
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
