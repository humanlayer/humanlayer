import { invoke } from '@tauri-apps/api/core'

import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

/**
 * Set the native window appearance directly; 'system' follows the OS.
 * No-ops when not running in Tauri.
 */
export async function setWindowAppearance(appearance: 'light' | 'dark' | 'system'): Promise<void> {
	if (!isTauri()) {
		return
	}

	try {
		await invoke<void>('set_window_theme', { theme: appearance })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to set window theme', { error: message })
	}
}
