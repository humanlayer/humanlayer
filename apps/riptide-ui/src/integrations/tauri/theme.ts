import type { Theme } from '@humanlayer/ui/components/theme-provider'
import { themeToAppearance } from '@humanlayer/ui/lib/theme-appearance-mapping'
import { invoke } from '@tauri-apps/api/core'

import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

/**
 * Set the native window appearance (light/dark traffic lights) to match the given theme.
 * No-ops when not running in Tauri.
 */
export async function setWindowTheme(theme: Theme): Promise<void> {
	if (!isTauri()) {
		return
	}

	const appearance = themeToAppearance[theme]

	try {
		await invoke<void>('set_window_theme', { theme: appearance })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to set window theme', { error: message })
	}
}
