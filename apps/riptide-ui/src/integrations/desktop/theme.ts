import type { Theme } from '@humanlayer/ui/components/theme-provider'
import { themeToAppearance } from '@humanlayer/ui/lib/theme-appearance-mapping'

import { setElectronWindowTheme } from '@/integrations/electron/theme'
import { setWindowTheme as setTauriWindowTheme } from '@/integrations/tauri/theme'
import { logger } from '@/lib/logger'
import { isElectron, isTauri } from '@/lib/utils'

export async function setWindowTheme(theme: Theme): Promise<void> {
	if (isTauri()) return setTauriWindowTheme(theme)
	if (!isElectron()) return

	try {
		await setElectronWindowTheme(themeToAppearance[theme])
	} catch (error) {
		logger.error('Failed to set window theme', {
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
