import { appLogDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { logger } from './logging'

export async function notifyLogLocation() {
  try {
    let logDir: string

    // Try to get custom log directory first (dev mode)
    try {
      logDir = await invoke<string>('get_log_directory')
    } catch {
      // Fall back to default app log directory (production)
      logDir = await appLogDir()
    }

    // Log to console (visible in dev mode)
    console.log(
      `%c📁 Application logs are stored in: ${logDir}`,
      'color: #4CAF50; font-weight: bold; font-size: 14px;',
    )

    // Also log through our logging service
    logger.log(`Application logs are stored in: ${logDir}`)

    return logDir
  } catch (error) {
    logger.error('Failed to get log directory:', error)
    return null
  }
}

export async function openLogDirectory() {
  try {
    let logDir: string

    // Try to get custom log directory first (dev mode)
    try {
      logDir = await invoke<string>('get_log_directory')
    } catch {
      // Fall back to default app log directory (production)
      logDir = await appLogDir()
    }

    await openUrl(logDir)
  } catch (error) {
    logger.error('Failed to open log directory:', error)
  }
}
